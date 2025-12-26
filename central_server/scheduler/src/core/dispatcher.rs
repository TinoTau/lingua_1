use crate::node_registry::NodeRegistry;
use crate::messages::{FeatureFlags, PipelineConfig};
use crate::utils::ModuleResolver;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::warn;
use uuid::Uuid;

#[derive(Debug, Clone)]
struct SelectionOutcome {
    node_id: Option<String>,
    selector: &'static str,
    breakdown: crate::node_registry::NoAvailableNodeBreakdown,
    phase3_debug: Option<crate::node_registry::Phase3TwoLevelDebug>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    pub job_id: String,
    /// 幂等请求 ID（Phase 1：任务级绑定使用）
    #[serde(skip_serializing_if = "String::is_empty")]
    pub request_id: String,
    /// 是否已成功下发到节点（Phase 1：用于避免 request_id 重试导致重复派发）
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub dispatched_to_node: bool,
    /// 最近一次成功下发到节点的时间戳（ms），用于 job_timeout_seconds 的计时起点（从 dispatched 开始）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dispatched_at_ms: Option<i64>,
    /// 超时后的自动重派次数（不包含首次派发）
    #[serde(skip_serializing_if = "is_zero_u32")]
    pub failover_attempts: u32,
    /// 下发 attempt 序号（从 1 开始）。用于同一节点重派时的结果去重/竞态保护。
    #[serde(skip_serializing_if = "is_zero_u32")]
    pub dispatch_attempt_id: u32,
    pub session_id: String, // 发送者的 session_id
    pub utterance_index: u64,
    pub src_lang: String,  // 支持 "auto" | "zh" | "en" | "ja" | "ko"
    pub tgt_lang: String,
    pub dialect: Option<String>,
    pub features: Option<FeatureFlags>,
    pub pipeline: PipelineConfig,
    pub audio_data: Vec<u8>,
    pub audio_format: String,
    pub sample_rate: u32,
    pub assigned_node_id: Option<String>,
    pub status: JobStatus,
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// 追踪 ID（用于全链路日志追踪）
    pub trace_id: String,
    /// 翻译模式："one_way" | "two_way_auto"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    /// 双向模式的语言 A（当 mode == "two_way_auto" 时使用）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lang_a: Option<String>,
    /// 双向模式的语言 B（当 mode == "two_way_auto" 时使用）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lang_b: Option<String>,
    /// 自动识别时限制的语言范围（可选）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_langs: Option<Vec<String>>,
    /// 是否启用流式 ASR（部分结果输出）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable_streaming_asr: Option<bool>,
    /// 部分结果更新间隔（毫秒），仅在 enable_streaming_asr 为 true 时有效
    #[serde(skip_serializing_if = "Option::is_none")]
    pub partial_update_interval_ms: Option<u64>,
    /// 目标接收者 session_id 列表（会议室模式使用，用于多语言翻译）
    /// 如果为 None，表示单会话模式，翻译结果发送给发送者
    /// 如果为 Some，表示会议室模式，翻译结果发送给列表中的所有成员
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_session_ids: Option<Vec<String>>,
    /// Phase 3：租户 ID（用于两级调度 routing_key 与运维排障）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tenant_id: Option<String>,
    /// 第一个音频块的客户端发送时间戳（毫秒，UTC时区），用于计算网络传输耗时
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_chunk_client_timestamp_ms: Option<i64>,
    /// EDGE-4: Padding 配置（毫秒），用于在音频末尾添加静音
    #[serde(skip_serializing_if = "Option::is_none")]
    pub padding_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum JobStatus {
    Pending,
    Assigned,
    Processing,
    Completed,
    Failed,
}

#[derive(Clone)]
pub struct JobDispatcher {
    node_registry: Arc<NodeRegistry>,
    jobs: Arc<RwLock<std::collections::HashMap<String, Job>>>,
    /// request_id -> job_id（带 lease 过期时间）
    request_bindings: Arc<RwLock<std::collections::HashMap<String, (String, i64)>>>,
    lease_seconds: u64,
    reserved_ttl_seconds: u64,
    spread_enabled: bool,
    spread_window_ms: i64,
    core_services: crate::core::config::CoreServicesConfig,
    /// session_id -> (last_dispatched_node_id, ts_ms)
    last_dispatched_node_by_session: Arc<RwLock<std::collections::HashMap<String, (String, i64)>>>,
    /// Phase 2：Redis 运行时（request_id bind/lock + node reserved）
    phase2: Option<Arc<crate::phase2::Phase2Runtime>>,
}

fn is_zero_u32(v: &u32) -> bool {
    *v == 0
}

impl JobDispatcher {
    pub fn new(node_registry: Arc<NodeRegistry>) -> Self {
        Self {
            node_registry,
            jobs: Arc::new(RwLock::new(std::collections::HashMap::new())),
            request_bindings: Arc::new(RwLock::new(std::collections::HashMap::new())),
            lease_seconds: 90,
            reserved_ttl_seconds: 90,
            spread_enabled: false,
            spread_window_ms: 30_000,
            core_services: crate::core::config::CoreServicesConfig::default(),
            last_dispatched_node_by_session: Arc::new(RwLock::new(std::collections::HashMap::new())),
            phase2: None,
        }
    }

    pub fn new_with_task_binding_config(
        node_registry: Arc<NodeRegistry>,
        cfg: crate::core::config::TaskBindingConfig,
    ) -> Self {
        let mut s = Self::new(node_registry);
        s.lease_seconds = cfg.lease_seconds.max(1);
        s.reserved_ttl_seconds = cfg.reserved_ttl_seconds.max(1);
        s.spread_enabled = cfg.spread_enabled;
        s.spread_window_ms = (cfg.spread_window_seconds.max(1) as i64) * 1000;
        s
    }

    pub fn new_with_phase1_config(
        node_registry: Arc<NodeRegistry>,
        task_binding: crate::core::config::TaskBindingConfig,
        core_services: crate::core::config::CoreServicesConfig,
    ) -> Self {
        let mut s = Self::new_with_task_binding_config(node_registry, task_binding);
        s.core_services = core_services;
        s
    }

    pub fn set_phase2(&mut self, phase2: Option<Arc<crate::phase2::Phase2Runtime>>) {
        self.phase2 = phase2;
    }

    pub async fn create_job(
        &self,
        session_id: String,
        utterance_index: u64,
        src_lang: String,
        tgt_lang: String,
        dialect: Option<String>,
        features: Option<FeatureFlags>,
        pipeline: PipelineConfig,
        audio_data: Vec<u8>,
        audio_format: String,
        sample_rate: u32,
        preferred_node_id: Option<String>,
        mode: Option<String>,
        lang_a: Option<String>,
        lang_b: Option<String>,
        auto_langs: Option<Vec<String>>,
        enable_streaming_asr: Option<bool>,
        partial_update_interval_ms: Option<u64>,
        trace_id: String,
        tenant_id: Option<String>,
        // Phase 1：任务级幂等 request_id（建议调用方传入稳定值）
        request_id: Option<String>,
        target_session_ids: Option<Vec<String>>, // 目标接收者 session_id 列表（会议室模式使用）
        first_chunk_client_timestamp_ms: Option<i64>, // 第一个音频块的客户端发送时间戳
        padding_ms: Option<u64>, // EDGE-4: Padding 配置（毫秒）
    ) -> Job {
        let request_id = request_id.unwrap_or_else(|| format!("req-{}", Uuid::new_v4().to_string()[..12].to_uppercase()));
        let now_ms = chrono::Utc::now().timestamp_millis();
        // Phase 3：routing_key 优先 tenant_id，其次 session_id（保证同租户/同会话稳定落 pool；不影响 request_id 幂等）
        let routing_key = tenant_id
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(session_id.as_str());

        // Phase 2：跨实例幂等（优先使用 Redis request_id bind）
        if let Some(rt) = self.phase2.clone() {
            // 先做一次无锁读取（快速路径）
            if let Some(b) = rt.get_request_binding(&request_id).await {
                let job_id = b.job_id.clone();
                if let Some(job) = self.get_job(&job_id).await {
                    return job;
                }
                let assigned_node_id = b.node_id.clone();
                let job = Job {
                    job_id: job_id.clone(),
                    request_id: request_id.clone(),
                    dispatched_to_node: b.dispatched_to_node,
                    dispatched_at_ms: None,
                    failover_attempts: 0,
                    dispatch_attempt_id: if assigned_node_id.is_some() { 1 } else { 0 },
                    session_id: session_id.clone(),
                    utterance_index,
                    src_lang: src_lang.clone(),
                    tgt_lang: tgt_lang.clone(),
                    dialect: dialect.clone(),
                    features: features.clone(),
                    pipeline: pipeline.clone(),
                    audio_data: audio_data.clone(),
                    audio_format: audio_format.clone(),
                    sample_rate,
                    assigned_node_id: assigned_node_id.clone(),
                    status: if assigned_node_id.is_some() { JobStatus::Assigned } else { JobStatus::Pending },
                    created_at: chrono::Utc::now(),
                    trace_id: trace_id.clone(),
                    mode: mode.clone(),
                    lang_a: lang_a.clone(),
                    lang_b: lang_b.clone(),
                    auto_langs: auto_langs.clone(),
                    enable_streaming_asr,
                    partial_update_interval_ms,
                    target_session_ids: target_session_ids.clone(),
                    tenant_id: tenant_id.clone(),
                    first_chunk_client_timestamp_ms,
                    padding_ms: None, // EDGE-4: Padding 配置（在 Phase2 幂等检查时，padding_ms 尚未确定）
                };
                self.jobs.write().await.insert(job_id, job.clone());
                return job;
            }

            // 加锁路径：避免同 request_id 并发创建/占用
            let lock_owner = format!("{}:{}", rt.instance_id, Uuid::new_v4().to_string());
            let deadline = tokio::time::Instant::now() + std::time::Duration::from_millis(1000);
            let mut locked = false;
            while tokio::time::Instant::now() < deadline {
                if rt.acquire_request_lock(&request_id, &lock_owner, 1500).await {
                    locked = true;
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }

            if locked {
                // lock 后复查
                if let Some(b) = rt.get_request_binding(&request_id).await {
                    rt.release_request_lock(&request_id, &lock_owner).await;
                    let job_id = b.job_id.clone();
                    if let Some(job) = self.get_job(&job_id).await {
                        return job;
                    }
                    let assigned_node_id = b.node_id.clone();
                    let job = Job {
                        job_id: job_id.clone(),
                        request_id: request_id.clone(),
                        dispatched_to_node: b.dispatched_to_node,
                        dispatched_at_ms: None,
                        failover_attempts: 0,
                        dispatch_attempt_id: if assigned_node_id.is_some() { 1 } else { 0 },
                        session_id: session_id.clone(),
                        utterance_index,
                        src_lang: src_lang.clone(),
                        tgt_lang: tgt_lang.clone(),
                        dialect: dialect.clone(),
                        features: features.clone(),
                        pipeline: pipeline.clone(),
                        audio_data: audio_data.clone(),
                        audio_format: audio_format.clone(),
                        sample_rate,
                        assigned_node_id: assigned_node_id.clone(),
                        status: if assigned_node_id.is_some() { JobStatus::Assigned } else { JobStatus::Pending },
                        created_at: chrono::Utc::now(),
                        trace_id: trace_id.clone(),
                        mode: mode.clone(),
                        lang_a: lang_a.clone(),
                        lang_b: lang_b.clone(),
                        auto_langs: auto_langs.clone(),
                        enable_streaming_asr,
                        partial_update_interval_ms,
                        target_session_ids: target_session_ids.clone(),
                        tenant_id: tenant_id.clone(),
                        first_chunk_client_timestamp_ms,
                        padding_ms: None, // EDGE-4: Padding 配置（在 Phase2 幂等检查时，padding_ms 尚未确定）
                    };
                    self.jobs.write().await.insert(job_id, job.clone());
                    return job;
                }

                // 还没有绑定：创建新 job_id，并走“本地选节点 -> Redis reserve -> 写 bind”
                let job_id = format!("job-{}", Uuid::new_v4().to_string()[..8].to_uppercase());

                // Prometheus：若最终 NO_AVAILABLE_NODE，则记录“按原因拆分”的一次计数
                let mut no_available_node_metric: Option<(&'static str, &'static str)> = None;

                // Phase 1：可选“打散”策略
                let exclude_node_id = if self.spread_enabled {
                    self.last_dispatched_node_by_session
                        .read()
                        .await
                        .get(&session_id)
                        .and_then(|(nid, ts)| {
                            if now_ms - *ts <= self.spread_window_ms {
                                Some(nid.clone())
                            } else {
                                None
                            }
                        })
                } else {
                    None
                };

                let mut assigned_node_id = if let Some(node_id) = preferred_node_id.clone() {
                    if self.node_registry.is_node_available(&node_id).await {
                        Some(node_id)
                    } else {
                        None
                    }
                } else {
                    let excluded = exclude_node_id.as_deref();
                    let first = self
                        .select_node_with_module_expansion_with_breakdown(
                            routing_key,
                            &src_lang,
                            &tgt_lang,
                            features.clone(),
                            &pipeline,
                            true,
                            excluded,
                        )
                        .await;
                    if first.selector == "phase3" {
                        if let Some(ref dbg) = first.phase3_debug {
                            if dbg.fallback_used || dbg.selected_pool.is_none() {
                                tracing::warn!(
                                    trace_id = %trace_id,
                                    request_id = %request_id,
                                    pool_count = dbg.pool_count,
                                    preferred_pool = dbg.preferred_pool,
                                    selected_pool = ?dbg.selected_pool,
                                    fallback_used = dbg.fallback_used,
                                    attempts = ?dbg.attempts,
                                    "Phase3 two-level scheduling used fallback or failed"
                                );
                            } else {
                                tracing::debug!(
                                    trace_id = %trace_id,
                                    request_id = %request_id,
                                    pool_count = dbg.pool_count,
                                    preferred_pool = dbg.preferred_pool,
                                    selected_pool = ?dbg.selected_pool,
                                    attempts = ?dbg.attempts,
                                    "Phase3 two-level scheduling decision"
                                );
                            }
                        }
                    }
                    if first.node_id.is_some() {
                        first.node_id
                    } else {
                        let second = self
                            .select_node_with_module_expansion_with_breakdown(
                                routing_key,
                                &src_lang,
                                &tgt_lang,
                                features.clone(),
                                &pipeline,
                                true,
                                None,
                            )
                            .await;
                        if second.selector == "phase3" {
                            if let Some(ref dbg) = second.phase3_debug {
                                tracing::warn!(
                                    trace_id = %trace_id,
                                    request_id = %request_id,
                                    pool_count = dbg.pool_count,
                                    preferred_pool = dbg.preferred_pool,
                                    selected_pool = ?dbg.selected_pool,
                                    fallback_used = dbg.fallback_used,
                                    attempts = ?dbg.attempts,
                                    "Phase3 two-level scheduling second attempt"
                                );
                            }
                        }
                        if second.node_id.is_none() {
                            no_available_node_metric =
                                Some((second.selector, second.breakdown.best_reason_label()));
                        }
                        second.node_id
                    }
                };

                // Phase 2：全局并发占用（Redis reserve）
                if let Some(ref node_id) = assigned_node_id {
                    let ttl_s = self.reserved_ttl_seconds.max(1);
                    let node = self.node_registry.get_node_snapshot(node_id).await;
                    let (running_jobs, max_jobs) = node
                        .as_ref()
                        .map(|n| (n.current_jobs, n.max_concurrent_jobs))
                        .unwrap_or((0, 1));
                    let ok = rt
                        .reserve_node_slot(node_id, &job_id, ttl_s, running_jobs, max_jobs)
                        .await;
                    if !ok {
                        assigned_node_id = None;
                        no_available_node_metric = Some(("reserve", "reserve_denied"));
                    }
                }

                // 写入 request_id bind（即使未分配到节点，也写入以避免短时间重复创建）
                rt.set_request_binding(
                    &request_id,
                    &job_id,
                    assigned_node_id.as_deref(),
                    self.lease_seconds.max(1),
                    false,
                )
                .await;

                // Phase 2：初始化 Job FSM（CREATED）
                let fsm_ttl = std::cmp::max(self.lease_seconds, self.reserved_ttl_seconds).saturating_add(300);
                rt.job_fsm_init(&job_id, assigned_node_id.as_deref(), 1, fsm_ttl).await;
                rt.release_request_lock(&request_id, &lock_owner).await;

                if assigned_node_id.is_none() {
                    if let Some((selector, reason)) = no_available_node_metric {
                        crate::metrics::prometheus_metrics::on_no_available_node(selector, reason);
                    } else {
                        crate::metrics::prometheus_metrics::on_no_available_node("unknown", "unknown");
                    }
                }

                let job = Job {
                    job_id: job_id.clone(),
                    request_id: request_id.clone(),
                    dispatched_to_node: false,
                    dispatched_at_ms: None,
                    failover_attempts: 0,
                    dispatch_attempt_id: if assigned_node_id.is_some() { 1 } else { 0 },
                    session_id,
                    utterance_index,
                    src_lang,
                    tgt_lang,
                    dialect,
                    features,
                    pipeline,
                    audio_data,
                    audio_format,
                    sample_rate,
                    assigned_node_id: assigned_node_id.clone(),
                    status: if assigned_node_id.is_some() { JobStatus::Assigned } else { JobStatus::Pending },
                    created_at: chrono::Utc::now(),
                    trace_id: trace_id.clone(),
                    mode,
                    lang_a,
                    lang_b,
                    auto_langs,
                    enable_streaming_asr,
                    partial_update_interval_ms,
                    target_session_ids,
                    tenant_id: tenant_id.clone(),
                    first_chunk_client_timestamp_ms,
                    padding_ms,
                };
                self.jobs.write().await.insert(job_id, job.clone());
                return job;
            }
        }

        // 幂等：若 request_id 在 lease 内已生成过 job，则直接返回同一个 job（避免重复派发/重复占用并发槽）
        if let Some((existing_job_id, exp_ms)) = self.request_bindings.read().await.get(&request_id).cloned() {
            if exp_ms > now_ms {
                if let Some(job) = self.get_job(&existing_job_id).await {
                    return job;
                }
            }
        }

        let job_id = format!("job-{}", Uuid::new_v4().to_string()[..8].to_uppercase());
        
        // 用于 Prometheus：若最终 NO_AVAILABLE_NODE，则记录“按原因拆分”的一次计数
        let mut no_available_node_metric: Option<(&'static str, &'static str)> = None;

        // Phase 1：可选“打散”策略。若开启且窗口内存在上一次已派发节点，则优先避开（若无其他候选则回退）
        let exclude_node_id = if self.spread_enabled {
            self.last_dispatched_node_by_session
                .read()
                .await
                .get(&session_id)
                .and_then(|(nid, ts)| {
                    if now_ms - *ts <= self.spread_window_ms {
                        Some(nid.clone())
                    } else {
                        None
                    }
                })
        } else {
            None
        };

        // 根据 v2 技术说明书，使用模块依赖展开算法选择节点
        let mut assigned_node_id = if let Some(node_id) = preferred_node_id {
            // 如果指定了节点，检查节点是否可用
            if self.node_registry.is_node_available(&node_id).await {
                // 还需要检查节点是否具备所需的模型能力
                if let Some(features) = &features {
                        if let Ok(required_models) =
                            self.get_required_types_for_features(&pipeline, Some(features), &src_lang, &tgt_lang)
                        {
                        if !self.node_registry.check_node_has_types_ready(&node_id, &required_models).await {
                            // 节点不具备所需模型，回退到功能感知选择
                            let o = self
                                .select_node_with_module_expansion_with_breakdown(
                                    routing_key,
                                    &src_lang,
                                    &tgt_lang,
                                    Some(features.clone()),
                                    &pipeline,
                                    true,
                                    None,
                                )
                                .await;
                            if o.selector == "phase3" {
                                if let Some(ref dbg) = o.phase3_debug {
                                    tracing::debug!(
                                        trace_id = %trace_id,
                                        request_id = %request_id,
                                        pool_count = dbg.pool_count,
                                        preferred_pool = dbg.preferred_pool,
                                        selected_pool = ?dbg.selected_pool,
                                        fallback_used = dbg.fallback_used,
                                        attempts = ?dbg.attempts,
                                        "Phase3 two-level scheduling fallback from preferred node"
                                    );
                                }
                            }
                            if o.node_id.is_none() {
                                no_available_node_metric =
                                    Some((o.selector, o.breakdown.best_reason_label()));
                            }
                            o.node_id
                        } else {
                            Some(node_id)
                        }
                    } else {
                        Some(node_id)
                    }
                } else {
                    Some(node_id)
                }
            } else {
                // 回退到功能感知选择
                let o = self
                    .select_node_with_module_expansion_with_breakdown(
                        routing_key,
                        &src_lang,
                        &tgt_lang,
                        features.clone(),
                        &pipeline,
                        true,
                        None,
                    )
                    .await;
                if o.selector == "phase3" {
                    if let Some(ref dbg) = o.phase3_debug {
                        tracing::debug!(
                            trace_id = %trace_id,
                            request_id = %request_id,
                            pool_count = dbg.pool_count,
                            preferred_pool = dbg.preferred_pool,
                            selected_pool = ?dbg.selected_pool,
                            fallback_used = dbg.fallback_used,
                            attempts = ?dbg.attempts,
                            "Phase3 two-level scheduling fallback from unavailable preferred node"
                        );
                    }
                }
                if o.node_id.is_none() {
                    no_available_node_metric = Some((o.selector, o.breakdown.best_reason_label()));
                }
                o.node_id
            }
        } else {
            // 使用模块依赖展开算法选择节点
            // 先尝试避开上一节点；如果无候选再回退不避开
            let excluded = exclude_node_id.as_deref();
            let first = self
                .select_node_with_module_expansion_with_breakdown(
                    routing_key,
                    &src_lang,
                    &tgt_lang,
                    features.clone(),
                    &pipeline,
                    true,
                    excluded,
                )
                .await;
            if first.selector == "phase3" {
                if let Some(ref dbg) = first.phase3_debug {
                    if dbg.fallback_used || dbg.selected_pool.is_none() {
                        tracing::warn!(
                            trace_id = %trace_id,
                            request_id = %request_id,
                                pool_count = dbg.pool_count,
                            preferred_pool = dbg.preferred_pool,
                            selected_pool = ?dbg.selected_pool,
                            fallback_used = dbg.fallback_used,
                            attempts = ?dbg.attempts,
                            "Phase3 two-level scheduling used fallback or failed"
                        );
                    }
                }
            }
            if first.node_id.is_some() {
                first.node_id
            } else {
                let second = self
                    .select_node_with_module_expansion_with_breakdown(
                        routing_key,
                        &src_lang,
                        &tgt_lang,
                        features.clone(),
                        &pipeline,
                        true,
                        None,
                    )
                    .await;
                if second.selector == "phase3" {
                    if let Some(ref dbg) = second.phase3_debug {
                        tracing::warn!(
                            trace_id = %trace_id,
                            request_id = %request_id,
                            pool_count = dbg.pool_count,
                            preferred_pool = dbg.preferred_pool,
                            selected_pool = ?dbg.selected_pool,
                            fallback_used = dbg.fallback_used,
                            attempts = ?dbg.attempts,
                            "Phase3 two-level scheduling second attempt"
                        );
                    }
                }
                if second.node_id.is_none() {
                    // 仅记录最终失败的原因（第二次：不避开上一节点）
                    no_available_node_metric =
                        Some((second.selector, second.breakdown.best_reason_label()));
                }
                second.node_id
            }
        };

        // Phase 1：并发一致性（reserve）——绑定成功 ≈ 占用 1 个槽
        if let Some(ref node_id) = assigned_node_id {
            let ttl = std::time::Duration::from_secs(self.reserved_ttl_seconds);
            let reserved = self
                .node_registry
                .reserve_job_slot(node_id, &job_id, ttl)
                .await;
            if !reserved {
                assigned_node_id = None;
                // 选择到了节点但 reserve 失败：多数是并发槽竞争/心跳滞后导致
                no_available_node_metric = Some(("reserve", "reserve_denied"));
            }
        }

        // 写入 request_id lease（只在成功创建时写入；无论是否分配到节点，都写入以避免短时间重复创建）
        let lease_ms = (self.lease_seconds as i64) * 1000;
        let exp_ms = now_ms + lease_ms;
        self.request_bindings
            .write()
            .await
            .insert(request_id.clone(), (job_id.clone(), exp_ms));

        use tracing::debug;
        debug!(trace_id = %trace_id, job_id = %job_id, request_id = %request_id, session_id = %session_id, utterance_index = utterance_index, node_id = ?assigned_node_id, "创建 Job");

        if assigned_node_id.is_none() {
            if let Some((selector, reason)) = no_available_node_metric {
                crate::metrics::prometheus_metrics::on_no_available_node(selector, reason);
                // 添加详细的诊断日志
                warn!(
                    trace_id = %trace_id,
                    job_id = %job_id,
                    session_id = %session_id,
                    utterance_index = utterance_index,
                    selector = selector,
                    reason = reason,
                    "Job创建时未找到可用节点，请检查节点状态和服务包安装情况"
                );
            } else {
                crate::metrics::prometheus_metrics::on_no_available_node("unknown", "unknown");
                warn!(
                    trace_id = %trace_id,
                    job_id = %job_id,
                    session_id = %session_id,
                    utterance_index = utterance_index,
                    "Job创建时未找到可用节点（原因未知）"
                );
            }
        }

        let job = Job {
            job_id: job_id.clone(),
            request_id: request_id.clone(),
            dispatched_to_node: false,
            dispatched_at_ms: None,
            failover_attempts: 0,
            dispatch_attempt_id: if assigned_node_id.is_some() { 1 } else { 0 },
            session_id,
            utterance_index,
            src_lang,
            tgt_lang,
            dialect,
            features,
            pipeline,
            audio_data,
            audio_format,
            sample_rate,
            assigned_node_id: assigned_node_id.clone(),
            status: if assigned_node_id.is_some() {
                JobStatus::Assigned
            } else {
                JobStatus::Pending
            },
            created_at: chrono::Utc::now(),
            trace_id: trace_id.clone(),
            mode,
            lang_a,
            lang_b,
            auto_langs,
            enable_streaming_asr,
            partial_update_interval_ms,
            target_session_ids,
            tenant_id: tenant_id.clone(),
            first_chunk_client_timestamp_ms,
            padding_ms,
        };

        let mut jobs = self.jobs.write().await;
        jobs.insert(job_id, job.clone());
        job
    }

    pub async fn get_job(&self, job_id: &str) -> Option<Job> {
        let jobs = self.jobs.read().await;
        jobs.get(job_id).cloned()
    }

    pub async fn list_jobs_snapshot(&self) -> Vec<Job> {
        let jobs = self.jobs.read().await;
        jobs.values().cloned().collect()
    }

    pub async fn update_job_status(&self, job_id: &str, status: JobStatus) -> bool {
        let mut jobs = self.jobs.write().await;
        if let Some(job) = jobs.get_mut(job_id) {
            let is_terminal = matches!(status, JobStatus::Completed | JobStatus::Failed);
            job.status = status;
            // 完成/失败后清理 request_id 绑定（避免内存增长；任务级绑定不需要长期保留）
            if is_terminal && !job.request_id.is_empty() {
                self.request_bindings.write().await.remove(&job.request_id);
            }
            true
        } else {
            false
        }
    }

    /// Phase 1：用于超时/重派的内部状态更新
    /// - 设置新节点
    /// - 重置 dispatched 标记与 dispatched_at_ms
    /// - 递增 failover_attempts
    pub async fn set_job_assigned_node_for_failover(&self, job_id: &str, new_node_id: String) -> bool {
        let mut jobs = self.jobs.write().await;
        if let Some(job) = jobs.get_mut(job_id) {
            if matches!(job.status, JobStatus::Completed | JobStatus::Failed) {
                return false;
            }
            let request_id = job.request_id.clone();
            let next_attempt = job.dispatch_attempt_id.saturating_add(1).max(1);
            job.assigned_node_id = Some(new_node_id.clone());
            job.status = JobStatus::Assigned;
            job.dispatched_to_node = false;
            job.dispatched_at_ms = None;
            job.failover_attempts = job.failover_attempts.saturating_add(1);
            job.dispatch_attempt_id = next_attempt;
            // Phase 2：更新 bind 的 node_id，并清理 dispatched 标记
            if let Some(ref rt) = self.phase2 {
                if !request_id.is_empty() {
                    rt.update_request_binding_node(&request_id, &new_node_id).await;
                }
                // Phase 2：Job FSM reset -> CREATED（新 attempt）
                let fsm_ttl = std::cmp::max(self.lease_seconds, self.reserved_ttl_seconds).saturating_add(300);
                rt.job_fsm_reset_created(job_id, Some(&new_node_id), next_attempt, fsm_ttl).await;
            }
            true
        } else {
            false
        }
    }

    pub async fn required_types_for_job(&self, job: &Job) -> anyhow::Result<Vec<crate::messages::ServiceType>> {
        self.get_required_types_for_features(&job.pipeline, job.features.as_ref(), &job.src_lang, &job.tgt_lang)
    }

    /// 使用模块依赖展开算法选择节点
    /// 
    /// 按照 v2 技术说明书的步骤：
    /// 1. 解析用户请求 features
    /// 2. 递归展开依赖链
    /// 3. 收集 required_types (ServiceType)
    /// 4. 过滤 capability_by_type ready 的节点
    /// 5. 负载均衡选节点
    async fn select_node_with_module_expansion_with_breakdown(
        &self,
        routing_key: &str,
        src_lang: &str,
        tgt_lang: &str,
        features: Option<FeatureFlags>,
        pipeline: &PipelineConfig,
        accept_public: bool,
        exclude_node_id: Option<&str>,
    ) -> SelectionOutcome {
        // 步骤 1: 解析用户请求 features
        let module_names = if let Some(ref features) = features {
            ModuleResolver::parse_features_to_modules(features)
        } else {
            // 如果没有 features，只使用核心模块
            vec!["asr".to_string(), "nmt".to_string(), "tts".to_string()]
        };

        // 步骤 2: 递归展开依赖链
        let _expanded_modules = match ModuleResolver::expand_dependencies(&module_names) {
            Ok(modules) => modules,
            Err(e) => {
                tracing::warn!("Failed to expand module dependencies: {}", e);
                // 回退到原来的方法
                let (node_id, breakdown) = self
                    .node_registry
                    .select_node_with_features_excluding_with_breakdown(
                        src_lang,
                        tgt_lang,
                        &features,
                        accept_public,
                        exclude_node_id,
                    )
                    .await;
                return SelectionOutcome {
                    node_id,
                    selector: "features",
                    breakdown,
                    phase3_debug: None,
                };
            }
        };

        // 步骤 3: 收集 required_types
        let required_types =
            match self.get_required_types_for_features(pipeline, features.as_ref(), src_lang, tgt_lang)
            {
            Ok(types) => types,
            Err(e) => {
                tracing::warn!("Failed to collect required models: {}", e);
                // 回退到原来的方法
                let (node_id, breakdown) = self
                    .node_registry
                    .select_node_with_features_excluding_with_breakdown(
                        src_lang,
                        tgt_lang,
                        &features,
                        accept_public,
                        exclude_node_id,
                    )
                    .await;
                return SelectionOutcome {
                    node_id,
                    selector: "features",
                    breakdown,
                    phase3_debug: None,
                };
            }
        };

        // 步骤 4 & 5: 过滤 type ready 的节点，并负载均衡
        let p3 = self.node_registry.phase3_config().await;
        if p3.enabled && p3.mode == "two_level" {
            let (node_id, dbg, breakdown) = self
                .node_registry
                .select_node_with_types_two_level_excluding_with_breakdown(
                    routing_key,
                    src_lang,
                    tgt_lang,
                    &required_types,
                    accept_public,
                    exclude_node_id,
                    Some(&self.core_services),
                )
                .await;
            // Prometheus：记录 pool 命中/回退
            if let Some(pid) = dbg.selected_pool {
                crate::metrics::prometheus_metrics::on_phase3_pool_selected(pid, true, dbg.fallback_used);
            } else {
                crate::metrics::prometheus_metrics::on_phase3_pool_selected(dbg.preferred_pool, false, false);
            }
            SelectionOutcome {
                node_id,
                selector: "phase3_type",
                breakdown,
                phase3_debug: Some(dbg),
            }
        } else {
            let (node_id, breakdown) = self
                .node_registry
                .select_node_with_types_excluding_with_breakdown(
                    src_lang,
                    tgt_lang,
                    &required_types,
                    accept_public,
                    exclude_node_id,
                )
                .await;
            SelectionOutcome {
                node_id,
                selector: "types",
                breakdown,
                phase3_debug: None,
            }
        }
    }

    /// 获取功能所需的类型列表
    fn get_required_types_for_features(
        &self,
        pipeline: &PipelineConfig,
        features: Option<&FeatureFlags>,
        _src_lang: &str,
        _tgt_lang: &str,
    ) -> anyhow::Result<Vec<crate::messages::ServiceType>> {
        let mut types = Vec::new();

        if pipeline.use_asr {
            types.push(crate::messages::ServiceType::Asr);
        }
        if pipeline.use_nmt {
            types.push(crate::messages::ServiceType::Nmt);
        }
        if pipeline.use_tts {
            types.push(crate::messages::ServiceType::Tts);
        }

        // 可选模块映射到类型（当前仅 tone 可选）
        if let Some(features) = features {
            let module_names = ModuleResolver::parse_features_to_modules(features);
            let optional_models = ModuleResolver::collect_required_models(&module_names)?;
            // tone: 若模块包含 tone（例如 voice_cloning 相关）则加入
            if optional_models.iter().any(|m| m.contains("tone") || m.contains("speaker") || m.contains("voice")) {
                types.push(crate::messages::ServiceType::Tone);
            }
        }

        types.sort();
        types.dedup();

        Ok(types)
    }

    pub async fn mark_job_dispatched(&self, job_id: &str) -> bool {
        let mut jobs = self.jobs.write().await;
        if let Some(job) = jobs.get_mut(job_id) {
            job.dispatched_to_node = true;
            job.dispatched_at_ms = Some(chrono::Utc::now().timestamp_millis());
            // Phase 2：同步更新 request_id bind 的 dispatched 标记，避免跨实例重复派发
            if let Some(ref rt) = self.phase2 {
                if !job.request_id.is_empty() {
                    rt.mark_request_dispatched(&job.request_id).await;
                }
                // Phase 2：Job FSM -> DISPATCHED（幂等）
                let _ = rt.job_fsm_to_dispatched(&job.job_id, job.dispatch_attempt_id.max(1)).await;
            }
            if let Some(ref nid) = job.assigned_node_id {
                let now_ms = chrono::Utc::now().timestamp_millis();
                self.last_dispatched_node_by_session
                    .write()
                    .await
                    .insert(job.session_id.clone(), (nid.clone(), now_ms));
            }
            true
        } else {
            false
        }
    }
}

