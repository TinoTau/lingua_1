use crate::node_registry::NodeRegistry;
use crate::messages::{FeatureFlags, PipelineConfig};
use crate::module_resolver::ModuleResolver;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

#[derive(Debug, Clone)]
struct SelectionOutcome {
    node_id: Option<String>,
    selector: &'static str,
    breakdown: crate::node_registry::NoAvailableNodeBreakdown,
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
    core_services: crate::config::CoreServicesConfig,
    /// session_id -> (last_dispatched_node_id, ts_ms)
    last_dispatched_node_by_session: Arc<RwLock<std::collections::HashMap<String, (String, i64)>>>,
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
            core_services: crate::config::CoreServicesConfig::default(),
            last_dispatched_node_by_session: Arc::new(RwLock::new(std::collections::HashMap::new())),
        }
    }

    pub fn new_with_task_binding_config(
        node_registry: Arc<NodeRegistry>,
        cfg: crate::config::TaskBindingConfig,
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
        task_binding: crate::config::TaskBindingConfig,
        core_services: crate::config::CoreServicesConfig,
    ) -> Self {
        let mut s = Self::new_with_task_binding_config(node_registry, task_binding);
        s.core_services = core_services;
        s
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
        // Phase 1：任务级幂等 request_id（建议调用方传入稳定值）
        request_id: Option<String>,
        target_session_ids: Option<Vec<String>>, // 目标接收者 session_id 列表（会议室模式使用）
    ) -> Job {
        let request_id = request_id.unwrap_or_else(|| format!("req-{}", Uuid::new_v4().to_string()[..12].to_uppercase()));
        let now_ms = chrono::Utc::now().timestamp_millis();

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
                            self.get_required_models_for_features(&pipeline, Some(features), &src_lang, &tgt_lang)
                        {
                        if !self.node_registry.check_node_has_models_ready(&node_id, &required_models).await {
                            // 节点不具备所需模型，回退到功能感知选择
                            let o = self
                                .select_node_with_module_expansion_with_breakdown(
                                    &src_lang,
                                    &tgt_lang,
                                    Some(features.clone()),
                                    &pipeline,
                                    true,
                                    None,
                                )
                                .await;
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
                        &src_lang,
                        &tgt_lang,
                        features.clone(),
                        &pipeline,
                        true,
                        None,
                    )
                    .await;
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
                    &src_lang,
                    &tgt_lang,
                    features.clone(),
                    &pipeline,
                    true,
                    excluded,
                )
                .await;
            if first.node_id.is_some() {
                first.node_id
            } else {
                let second = self
                    .select_node_with_module_expansion_with_breakdown(
                        &src_lang,
                        &tgt_lang,
                        features.clone(),
                        &pipeline,
                        true,
                        None,
                    )
                    .await;
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
                crate::prometheus_metrics::on_no_available_node(selector, reason);
            } else {
                crate::prometheus_metrics::on_no_available_node("unknown", "unknown");
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
            job.assigned_node_id = Some(new_node_id);
            job.status = JobStatus::Assigned;
            job.dispatched_to_node = false;
            job.dispatched_at_ms = None;
            job.failover_attempts = job.failover_attempts.saturating_add(1);
            job.dispatch_attempt_id = job.dispatch_attempt_id.saturating_add(1).max(1);
            true
        } else {
            false
        }
    }

    pub async fn required_services_for_job(&self, job: &Job) -> anyhow::Result<Vec<String>> {
        self.get_required_models_for_features(&job.pipeline, job.features.as_ref(), &job.src_lang, &job.tgt_lang)
    }

    /// 使用模块依赖展开算法选择节点
    /// 
    /// 按照 v2 技术说明书的步骤：
    /// 1. 解析用户请求 features
    /// 2. 递归展开依赖链
    /// 3. 收集 required_models
    /// 4. 过滤 capability_state == ready 的节点
    /// 5. 负载均衡选节点
    async fn select_node_with_module_expansion_with_breakdown(
        &self,
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
                };
            }
        };

        // 步骤 3: 收集 required_models
        let required_models =
            match self.get_required_models_for_features(pipeline, features.as_ref(), src_lang, tgt_lang)
            {
            Ok(models) => models,
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
                };
            }
        };

        // 步骤 4 & 5: 过滤 capability_state == ready 的节点，并负载均衡
        let (node_id, breakdown) = self
            .node_registry
            .select_node_with_models_excluding_with_breakdown(
                src_lang,
                tgt_lang,
                &required_models,
                accept_public,
                exclude_node_id,
            )
            .await;
        SelectionOutcome {
            node_id,
            selector: "models",
            breakdown,
        }
    }

    /// 获取功能所需的模型列表
    fn get_required_models_for_features(
        &self,
        pipeline: &PipelineConfig,
        features: Option<&FeatureFlags>,
        _src_lang: &str,
        _tgt_lang: &str,
    ) -> anyhow::Result<Vec<String>> {
        let mut model_ids = Vec::new();

        // Phase 1：核心链路服务包（可配置，默认与 repo 内 services_index.json 对齐）
        if pipeline.use_asr && !self.core_services.asr_service_id.is_empty() {
            model_ids.push(self.core_services.asr_service_id.clone());
        }
        if pipeline.use_nmt && !self.core_services.nmt_service_id.is_empty() {
            model_ids.push(self.core_services.nmt_service_id.clone());
        }
        if pipeline.use_tts && !self.core_services.tts_service_id.is_empty() {
            model_ids.push(self.core_services.tts_service_id.clone());
        }

        // 可选模块的模型
        if let Some(features) = features {
            let module_names = ModuleResolver::parse_features_to_modules(features);
            let optional_models = ModuleResolver::collect_required_models(&module_names)?;
            model_ids.extend(optional_models);
        }

        Ok(model_ids)
    }

    pub async fn mark_job_dispatched(&self, job_id: &str) -> bool {
        let mut jobs = self.jobs.write().await;
        if let Some(job) = jobs.get_mut(job_id) {
            job.dispatched_to_node = true;
            job.dispatched_at_ms = Some(chrono::Utc::now().timestamp_millis());
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

