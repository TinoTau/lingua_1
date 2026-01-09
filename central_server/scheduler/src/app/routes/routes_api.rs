use crate::core::AppState;
use crate::messages::ServiceType;
use axum::extract::Query;
use axum::response::IntoResponse;
use serde::{Deserialize, Serialize};
use std::str::FromStr;

// 健康检查
pub async fn health_check() -> &'static str {
    "OK"
}

// 统计API端点
pub async fn get_stats(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> impl axum::response::IntoResponse {
    let t0 = std::time::Instant::now();
    // v1.1 规范：请求路径不做现场生成；冷启动直接返回空快照，并触发一次后台刷新（SingleFlight + 频率限制）。
    if state.dashboard_snapshot.last_updated_at_ms().await == 0 {
        state.dashboard_snapshot.try_trigger_refresh_nonblocking(state.clone());
    }

    let json = state.dashboard_snapshot.get_json().await;
    let updated_at = state.dashboard_snapshot.last_updated_at_ms().await;
    let now_ms = chrono::Utc::now().timestamp_millis();
    let is_stale = updated_at == 0 || (now_ms - updated_at) > 10_000; // 简单阈值：>10s 视为 stale（Phase 1 先用经验值）
    crate::metrics::metrics::on_stats_response(is_stale);
    crate::metrics::prometheus_metrics::observe_stats_request_duration_seconds(t0.elapsed().as_secs_f64());
    (
        axum::http::StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        json,
    )
}

pub async fn get_metrics(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> axum::Json<crate::metrics::metrics::MetricsSnapshot> {
    axum::Json(crate::metrics::collect(&state).await)
}

// 集群监控 API 端点
#[derive(serde::Serialize)]
pub struct ClusterStatsResponse {
    instances: Vec<InstanceInfo>,
    total_instances: usize,
    online_instances: usize,
    total_nodes: usize,
    online_nodes: usize,
    ready_nodes: usize, // 服务就绪的节点数
    total_sessions: usize,
    total_pending: u64,
    total_dlq: u64,
    redis_key_prefix: String,
    nodes: Vec<NodeInfo>, // 节点列表（包含服务状态）
}

#[derive(serde::Serialize)]
pub struct NodeInfo {
    node_id: String,
    platform: String,
    online: bool,
    status: String, // NodeStatus 的字符串表示
    cpu_usage: f32,
    gpu_usage: Option<f32>,
    memory_usage: f32,
    current_jobs: usize,
    max_concurrent_jobs: usize,
    last_heartbeat: i64, // 时间戳（毫秒）
    // 服务状态信息
    services: Vec<ServiceStatusInfo>,
    // 能力状态（按 ServiceType）
    capabilities: Vec<CapabilityStatusInfo>,
}

#[derive(serde::Serialize)]
pub struct ServiceStatusInfo {
    service_id: String,
    service_type: String, // ServiceType 的字符串表示
    status: String, // ServiceStatus 的字符串表示
}

#[derive(serde::Serialize)]
pub struct CapabilityStatusInfo {
    service_type: String, // ServiceType 的字符串表示
    ready: bool,
    reason: Option<String>,
    ready_impl_ids: Option<Vec<String>>,
}

#[derive(serde::Serialize)]
pub struct InstanceInfo {
    instance_id: String,
    hostname: String,
    pid: u32,
    version: String,
    started_at_ms: i64,
    uptime_seconds: i64,
    is_online: bool,
    inbox_length: u64,
    inbox_pending: u64,
    dlq_length: u64,
    nodes_owned: usize,
    sessions_owned: usize,
}

pub async fn get_cluster_stats(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> axum::response::Response {
    let phase2 = match &state.phase2 {
        Some(rt) => rt,
        None => {
            tracing::warn!("Cluster stats API called but Phase2 is not enabled");
            return (
                axum::http::StatusCode::SERVICE_UNAVAILABLE,
                [(axum::http::header::CONTENT_TYPE, "application/json")],
                r#"{"error":"Phase2 not enabled","message":"Please enable Phase2 in config.toml: [scheduler.phase2] enabled = true"}"#,
            )
                .into_response();
        }
    };

    let key_prefix = phase2.key_prefix();
    let now_ms = chrono::Utc::now().timestamp_millis();

    // 获取所有实例的 presence keys
    let presence_pattern = format!("{}:schedulers:presence:*", key_prefix);
    let mut cmd = redis::cmd("KEYS");
    cmd.arg(&presence_pattern);
    
    let instance_keys: Vec<String> = match phase2.redis_query::<Vec<String>>(cmd).await {
        Ok(keys) => {
            tracing::debug!("Found {} instance keys from Redis", keys.len());
            keys
        },
        Err(e) => {
            tracing::error!("Failed to get instance keys from Redis: {} (pattern: {})", e, presence_pattern);
            // 返回错误响应而不是空数组
            return (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                [(axum::http::header::CONTENT_TYPE, "application/json")],
                format!(r#"{{"error":"Redis query failed","message":"Failed to query instance keys: {}"}}"#, e),
            )
                .into_response();
        }
    };

    let total_instances_count = instance_keys.len();
    let mut instances = Vec::new();
    let mut total_pending = 0u64;
    let mut total_dlq = 0u64;
    let mut online_count = 0;

    for key in instance_keys {
        // 提取 instance_id
        let instance_id = key
            .strip_prefix(&format!("{}:schedulers:presence:", key_prefix))
            .unwrap_or("")
            .to_string();

        // 读取 presence 信息
        let presence_json: Option<String> = phase2.redis_get_string(&key).await.ok().flatten();

        #[derive(serde::Deserialize)]
        struct SchedulerPresence {
            started_at: i64,
            hostname: String,
            pid: u32,
            version: String,
        }
        
        let presence: SchedulerPresence = match presence_json {
            Some(json) => match serde_json::from_str(&json) {
                Ok(p) => p,
                Err(_) => continue,
            },
            None => continue,
        };

        let is_online = true; // key 存在说明在线
        if is_online {
            online_count += 1;
        }

        let uptime_seconds = (now_ms - presence.started_at) / 1000;

        // 获取 inbox 信息
        let inbox_key = format!("{}:streams:{{instance:{}}}:inbox", key_prefix, instance_id);
        let mut xlen_cmd = redis::cmd("XLEN");
        xlen_cmd.arg(&inbox_key);
        let inbox_length: u64 = match phase2.redis_query::<u64>(xlen_cmd).await {
            Ok(v) => v,
            Err(_) => 0,
        };

        // 获取 pending 信息
        let stream_group = phase2.stream_group();
        let mut xpending_cmd = redis::cmd("XPENDING");
        xpending_cmd.arg(&inbox_key).arg(stream_group);
        let pending_summary: Option<Vec<redis::Value>> = match phase2.redis_query::<Vec<redis::Value>>(xpending_cmd).await {
            Ok(v) => Some(v),
            Err(_) => None,
        };
        let inbox_pending = pending_summary
            .and_then(|v| v.first().and_then(|v| redis::from_redis_value::<u64>(v).ok()))
            .unwrap_or(0);
        total_pending += inbox_pending;

        // 获取 DLQ 信息
        let dlq_key = format!("{}:streams:{{instance:{}}}:dlq", key_prefix, instance_id);
        let mut dlq_xlen_cmd = redis::cmd("XLEN");
        dlq_xlen_cmd.arg(&dlq_key);
        let dlq_length: u64 = match phase2.redis_query::<u64>(dlq_xlen_cmd).await {
            Ok(v) => v,
            Err(_) => 0,
        };
        total_dlq += dlq_length;

        // 统计该实例拥有的 nodes 和 sessions（简化：只统计 owner keys）
        // 注意：这里只做粗略统计，完整统计需要扫描所有 owner keys
        let nodes_owned = 0; // TODO: 可以通过 SCAN 统计，但性能开销较大
        let sessions_owned = 0;

        instances.push(InstanceInfo {
            instance_id: instance_id.clone(),
            hostname: presence.hostname,
            pid: presence.pid,
            version: presence.version,
            started_at_ms: presence.started_at,
            uptime_seconds,
            is_online,
            inbox_length,
            inbox_pending,
            dlq_length,
            nodes_owned,
            sessions_owned,
        });
    }

    // 获取节点列表和服务状态（从本地 NodeRegistry 和 Redis）
    let (total_nodes, online_nodes, ready_nodes, nodes_list) = {
        // 使用 ManagementRegistry（统一管理锁）
        let mgmt = state.node_registry.management_registry.read().await;
        let total = mgmt.nodes.len();
        let online = mgmt.nodes.values().filter(|state| state.node.online).count();
        
        // 从 Redis 读取节点能力信息来统计 ready 节点
        let ready = if let Some(rt) = state.phase2.as_ref() {
            let mut ready_count = 0;
            for node_state in mgmt.nodes.values() {
                if !node_state.node.online {
                    continue;
                }
                // 检查所有核心服务是否就绪（从 Redis 读取）
                let has_asr = rt.has_node_capability(&node_state.node.node_id, &crate::messages::ServiceType::Asr).await;
                let has_nmt = rt.has_node_capability(&node_state.node.node_id, &crate::messages::ServiceType::Nmt).await;
                let has_tts = rt.has_node_capability(&node_state.node.node_id, &crate::messages::ServiceType::Tts).await;
                if has_asr && has_nmt && has_tts {
                    ready_count += 1;
                }
            }
            ready_count
        } else {
            // 如果没有 Phase2Runtime，无法从 Redis 读取，返回 0
            0
        };
        
        let nodes_list: Vec<NodeInfo> = {
            let mut result = Vec::new();
            for node_state in mgmt.nodes.values() {
                let node = &node_state.node;
                // 构建服务状态列表
                let services: Vec<ServiceStatusInfo> = node.installed_services.iter().map(|s| {
                    ServiceStatusInfo {
                        service_id: s.service_id.clone(),
                        service_type: format!("{:?}", s.r#type),
                        status: format!("{:?}", s.status),
                    }
                }).collect();
                
                // 构建能力状态列表（从 Redis 读取）
                let capabilities: Vec<CapabilityStatusInfo> = if let Some(rt) = state.phase2.as_ref() {
                    let mut caps = Vec::new();
                    for service_type in &[
                        crate::messages::ServiceType::Asr,
                        crate::messages::ServiceType::Nmt,
                        crate::messages::ServiceType::Tts,
                        crate::messages::ServiceType::Tone,
                        crate::messages::ServiceType::Semantic,
                    ] {
                        let ready = rt.has_node_capability(&node.node_id, service_type).await;
                        caps.push(CapabilityStatusInfo {
                            service_type: format!("{:?}", service_type),
                            ready,
                            reason: None, // Redis 中不存储 reason
                            ready_impl_ids: None, // Redis 中不存储 ready_impl_ids
                        });
                    }
                    caps
                } else {
                    Vec::new()
                };
            
                result.push(NodeInfo {
                    node_id: node.node_id.clone(),
                    platform: node.platform.clone(),
                    online: node.online,
                    status: format!("{:?}", node.status),
                    cpu_usage: node.cpu_usage,
                    gpu_usage: node.gpu_usage,
                    memory_usage: node.memory_usage,
                    current_jobs: node.current_jobs,
                    max_concurrent_jobs: node.max_concurrent_jobs,
                    last_heartbeat: node.last_heartbeat.timestamp_millis(),
                    services,
                    capabilities,
                });
            }
            result
        };
        
        (total, online, ready, nodes_list)
    };
    tracing::debug!("Total nodes: {}, online: {}, ready: {}", total_nodes, online_nodes, ready_nodes);

    // 获取会话数（简化：从本地状态获取，多实例需要从 Redis 聚合）
    let total_sessions = state.session_manager.list_all_sessions().await.len();
    tracing::debug!("Total sessions from local state: {}", total_sessions);

    let response = ClusterStatsResponse {
        instances,
        total_instances: total_instances_count,
        online_instances: online_count,
        total_nodes,
        online_nodes,
        ready_nodes,
        total_sessions,
        total_pending,
        total_dlq,
        redis_key_prefix: key_prefix.to_string(),
        nodes: nodes_list,
    };

    tracing::info!(
        "Cluster stats: {} instances ({} online), {} nodes ({} online, {} ready), {} sessions, {} pending, {} dlq",
        total_instances_count,
        online_count,
        total_nodes,
        online_nodes,
        ready_nodes,
        total_sessions,
        total_pending,
        total_dlq
    );

    (
        axum::http::StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        serde_json::to_string(&response).unwrap_or_else(|e| {
            tracing::error!("Failed to serialize cluster stats response: {}", e);
            r#"{"error":"Serialization failed"}"#.to_string()
        }),
    )
        .into_response()
}

#[derive(serde::Serialize)]
pub struct Phase3PoolsResponse {
    config: crate::core::config::Phase3Config,
    pools: Vec<Phase3PoolEntry>,
}

#[derive(serde::Serialize)]
pub struct Phase3PoolEntry {
    pool_id: u16,
    #[serde(skip_serializing_if = "String::is_empty")]
    pool_name: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pool_required_services: Vec<String>,
    total_nodes: usize,
    online_nodes: usize,
    ready_nodes: usize,
    core_services_installed: std::collections::HashMap<String, usize>,
    core_services_ready: std::collections::HashMap<String, usize>,
    sample_node_ids: Vec<String>,
}

pub async fn get_phase3_pools(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> axum::Json<Phase3PoolsResponse> {
    let cfg = state.node_registry.phase3_config().await;
    let phase2_runtime = state.phase2.as_ref().map(|rt| rt.as_ref());
    let sizes: std::collections::HashMap<u16, usize> =
        state.node_registry.phase3_pool_sizes(phase2_runtime).await.into_iter().collect();
    let core_cache = state.node_registry.phase3_pool_core_cache_snapshot().await;

    // pool 列表来源：
    // - capability pools：使用 cfg.pools（可非连续 pool_id）
    // - hash pools：使用 0..pool_count
    let pool_defs: Vec<(u16, String, Vec<String>)> = if !cfg.pools.is_empty() {
        cfg.pools
            .iter()
            .map(|p| (p.pool_id, p.name.clone(), p.required_services.clone()))
            .collect()
    } else {
        let pool_count = cfg.pool_count.max(1);
        (0..pool_count).map(|pid| (pid, "".to_string(), vec![])).collect()
    };

    let mut pools: Vec<Phase3PoolEntry> = Vec::with_capacity(pool_defs.len());
    for (pid, name, reqs) in pool_defs {
        let total_nodes = sizes.get(&pid).copied().unwrap_or(0);
        let pc = core_cache
            .get(&pid)
            .cloned()
            .unwrap_or_default();

        // 只输出核心服务（低基数）
        let mut core_services_installed: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
        let mut core_services_ready: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
        if !state.core_services.asr_service_id.is_empty() {
            core_services_installed.insert(state.core_services.asr_service_id.clone(), pc.asr_installed);
            core_services_ready.insert(state.core_services.asr_service_id.clone(), pc.asr_ready);
        }
        if !state.core_services.nmt_service_id.is_empty() {
            core_services_installed.insert(state.core_services.nmt_service_id.clone(), pc.nmt_installed);
            core_services_ready.insert(state.core_services.nmt_service_id.clone(), pc.nmt_ready);
        }
        if !state.core_services.tts_service_id.is_empty() {
            core_services_installed.insert(state.core_services.tts_service_id.clone(), pc.tts_installed);
            core_services_ready.insert(state.core_services.tts_service_id.clone(), pc.tts_ready);
        }

        let sample_node_ids = state.node_registry.phase3_pool_sample_node_ids(pid, 5, phase2_runtime).await;
        pools.push(Phase3PoolEntry {
            pool_id: pid,
            pool_name: name,
            pool_required_services: reqs,
            total_nodes,
            online_nodes: pc.online_nodes,
            ready_nodes: pc.ready_nodes,
            core_services_installed,
            core_services_ready,
            sample_node_ids,
        });
    }

    pools.sort_by_key(|p| p.pool_id);
    axum::Json(Phase3PoolsResponse { config: cfg, pools })
}

#[derive(Debug, Deserialize)]
pub struct Phase3SimulateQuery {
    /// 显式指定 routing_key（优先级最高）
    routing_key: Option<String>,
    /// 便捷：与线上语义保持一致（若 routing_key 为空，则优先 tenant_id，其次 session_id）
    tenant_id: Option<String>,
    session_id: Option<String>,
    /// required ServiceType 列表（可重复传参）：?required=ASR&required=NMT（使用 ServiceType 字符串）
    #[serde(default)]
    required: Vec<String>,
    /// 语言仅用于日志/兼容现有选择函数参数，不影响 required 过滤本身
    src_lang: Option<String>,
    tgt_lang: Option<String>,
    /// 是否允许 public 节点（默认 true）
    accept_public: Option<bool>,
    /// 排除某个节点（可选）
    exclude_node_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Phase3SimulateResponse {
    routing_key: String,
    required: Vec<String>,
    selected_node_id: Option<String>,
    debug: crate::node_registry::Phase3TwoLevelDebug,
    breakdown: crate::node_registry::NoAvailableNodeBreakdown,
}

pub async fn get_phase3_simulate(
    axum::extract::State(state): axum::extract::State<AppState>,
    Query(q): Query<Phase3SimulateQuery>,
) -> axum::Json<Phase3SimulateResponse> {
    let routing_key = q
        .routing_key
        .or(q.tenant_id)
        .or(q.session_id)
        .unwrap_or_else(|| "default".to_string());
    let src_lang = q.src_lang.unwrap_or_else(|| "zh".to_string());
    let tgt_lang = q.tgt_lang.unwrap_or_else(|| "en".to_string());
    let accept_public = q.accept_public.unwrap_or(true);
    let exclude = q.exclude_node_id.as_deref();

    // 将 required ServiceType 字符串转换为 ServiceType 枚举
    let required_types: Vec<ServiceType> = q.required
        .iter()
        .filter_map(|s| ServiceType::from_str(s).ok())
        .collect();

    let (nid, dbg, bd) = state
        .node_registry
        .select_node_with_types_two_level_excluding_with_breakdown(
            &routing_key,
            &src_lang,
            &tgt_lang,
            &required_types,
            accept_public,
            exclude,
            Some(&state.core_services),
            state.phase2.as_ref().map(|rt| rt.as_ref()),
        )
        .await;

    axum::Json(Phase3SimulateResponse {
        routing_key,
        required: q.required,
        selected_node_id: nid,
        debug: dbg,
        breakdown: bd,
    })
}

pub async fn get_prometheus_metrics(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> impl axum::response::IntoResponse {
    let (body, content_type) = crate::metrics::prometheus_metrics::render_text(&state).await;
    let hv = axum::http::HeaderValue::from_str(&content_type).unwrap_or_else(|_| {
        axum::http::HeaderValue::from_static("text/plain; charset=utf-8")
    });
    (
        axum::http::StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, hv)],
        body,
    )
}

