// MODEL_NOT_AVAILABLE 处理（Phase 1）：异步入队 → 标记节点的服务包暂不可用（TTL）→ 调度时跳过
//
// 设计要点：
// - 主路径仅入队（不做重计算/阻塞）
// - 标记不可用是“快速纠偏”机制：弥补心跳快照的延迟与运行时状态漂移

use std::collections::HashMap;
use std::time::Duration;
use tokio::sync::mpsc;
use std::sync::Arc;

use crate::redis_runtime::RedisRuntime;

#[derive(Debug, Clone)]
pub struct ModelNotAvailableEvent {
    pub node_id: String,
    /// 这里的 “model_id” 在当前项目语义下等价于服务包 id（service_id）
    pub service_id: String,
    /// 可选：服务包版本（Phase 1 仅用于观测/日志；调度侧通常无法按版本路由）
    pub service_version: Option<String>,
    pub reason: Option<String>,
}

#[derive(Clone)]
pub struct ModelNotAvailableBus {
    tx: mpsc::UnboundedSender<ModelNotAvailableEvent>,
}

impl ModelNotAvailableBus {
    pub fn new(tx: mpsc::UnboundedSender<ModelNotAvailableEvent>) -> Self {
        Self { tx }
    }

    /// 主路径调用：只入队，不阻塞
    pub fn enqueue(&self, event: ModelNotAvailableEvent) {
        let _ = self.tx.send(event);
    }
}

pub fn start_worker(
    mut rx: mpsc::UnboundedReceiver<ModelNotAvailableEvent>,
    node_registry: std::sync::Arc<crate::node_registry::NodeRegistry>,
    config: crate::core::config::ModelNotAvailableConfig,
    redis_runtime: Option<Arc<RedisRuntime>>,
) {
    tokio::spawn(async move {
        // Phase 1：TTL（推荐 30–120s，支持配置）
        let ttl = Duration::from_secs(config.unavailable_ttl_seconds.max(0));
        let debounce_window = Duration::from_secs(config.debounce_window_seconds.clamp(1, 60));
        let node_rl_window = Duration::from_secs(config.node_ratelimit_window_seconds.clamp(1, 300));
        let node_rl_max = config.node_ratelimit_max.max(1);

        // Phase 1 兼容：当 Phase2 未启用 Redis 时，继续使用进程内去抖/限流
        // 去抖表：key=(service_id@version) → expire_at_ms
        let mut debounce: HashMap<String, i64> = HashMap::new();
        // 节点级限流：node_id → (window_start_ms, count)
        let mut node_rate: HashMap<String, (i64, u32)> = HashMap::new();

        while let Some(ev) = rx.recv().await {
            crate::metrics::on_model_na_received();
            crate::metrics::on_model_na_received_detail(
                &ev.node_id,
                &ev.service_id,
                ev.reason.as_deref(),
            );
            let now_ms = chrono::Utc::now().timestamp_millis();

            // 节点级限流（防止单节点异常刷屏/风暴）
            // Phase 2：使用 Redis key，保证跨实例一致
            if let Some(ref rt) = redis_runtime {
                let allowed = rt
                    .model_na_node_ratelimit_allow(
                        &ev.node_id,
                        node_rl_window.as_millis() as u64,
                        node_rl_max,
                    )
                    .await;
                if !allowed {
                    crate::metrics::on_model_na_rate_limited();
                    crate::metrics::on_model_na_rate_limited_detail(&ev.node_id);
                    continue;
                }
            } else {
                let (win_start, count) = node_rate.entry(ev.node_id.clone()).or_insert((now_ms, 0));
                if now_ms.saturating_sub(*win_start) > node_rl_window.as_millis() as i64 {
                    *win_start = now_ms;
                    *count = 0;
                }
                if *count >= node_rl_max {
                    crate::metrics::on_model_na_rate_limited();
                    crate::metrics::on_model_na_rate_limited_detail(&ev.node_id);
                    continue;
                }
                *count += 1;
            }

            // 始终对该节点做“暂不可用标记”（这是我们 Phase 1 选择的快速纠偏策略）
            node_registry
                .mark_service_temporarily_unavailable(
                    &ev.node_id,
                    &ev.service_id,
                    ev.service_version.clone(),
                    ev.reason.clone(),
                    ttl,
                )
                .await;
            crate::metrics::on_model_na_marked();
            crate::metrics::on_model_na_marked_detail(&ev.node_id);

            // 去抖：对同一 (service_id, version) 在窗口内只打印一次聚合日志（“昂贵操作预算”的替代实现）
            let key = format!(
                "{}@{}",
                ev.service_id,
                ev.service_version.clone().unwrap_or_else(|| "any".to_string())
            );
            if let Some(ref rt) = redis_runtime {
                // Phase 2：Redis 去抖（SET NX PX window）
                let first = rt
                    .model_na_debounce_first_hit(&ev.service_id, ev.service_version.as_deref(), debounce_window.as_millis() as u64)
                    .await;
                if first {
                    tracing::warn!(
                        service_key = %key,
                        ttl_seconds = ttl.as_secs(),
                        "MODEL_NOT_AVAILABLE：已进入去抖窗口（Redis），后续同类事件将被合并日志（仍会继续标记节点暂不可用）"
                    );
                }
            } else {
                debounce.retain(|_k, exp| *exp > now_ms);
                let exp = debounce.get(&key).copied().unwrap_or(0);
                if exp <= now_ms {
                    debounce.insert(key.clone(), now_ms + debounce_window.as_millis() as i64);
                    tracing::warn!(
                        service_key = %key,
                        ttl_seconds = ttl.as_secs(),
                        "MODEL_NOT_AVAILABLE：已进入去抖窗口，后续同类事件将被合并日志（仍会继续标记节点暂不可用）"
                    );
                }
            }
        }
    });
}


