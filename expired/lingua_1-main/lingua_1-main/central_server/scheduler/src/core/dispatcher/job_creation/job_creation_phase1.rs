use super::super::JobDispatcher;
use super::super::job::{Job, JobStatus};
use crate::messages::{FeatureFlags, PipelineConfig};
use tracing::{debug, warn};

impl JobDispatcher {
    /// Phase 1: 本地幂等检查
    /// 如果找到已存在的绑定，返回对应的 Job；否则返回 None
    pub(crate) async fn check_phase1_idempotency(
        &self,
        request_id: &str,
        now_ms: i64,
    ) -> Option<Job> {
        if let Some((existing_job_id, exp_ms)) = self.request_bindings.read().await.get(request_id).cloned() {
            if exp_ms > now_ms {
                if let Some(job) = self.get_job(&existing_job_id).await {
                    return Some(job);
                }
            }
        }
        None
    }

    /// Phase 1: 创建 Job（本地模式，无 Phase 2）
    pub(crate) async fn create_job_phase1(
        &self,
        job_id: String,
        request_id: String,
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
        assigned_node_id: Option<String>,
        mode: Option<String>,
        lang_a: Option<String>,
        lang_b: Option<String>,
        auto_langs: Option<Vec<String>>,
        enable_streaming_asr: Option<bool>,
        partial_update_interval_ms: Option<u64>,
        trace_id: String,
        tenant_id: Option<String>,
        target_session_ids: Option<Vec<String>>,
        first_chunk_client_timestamp_ms: Option<i64>,
        padding_ms: Option<u64>,
        is_manual_cut: bool,
        is_pause_triggered: bool,
        is_timeout_triggered: bool,
        no_available_node_metric: Option<(&'static str, &'static str)>,
    ) -> Job {
        // Phase 2：统一使用Redis Reservation机制
        let mut final_assigned_node_id = assigned_node_id.clone();
        if let Some(node_id) = &assigned_node_id {
            if let Some(rt) = self.phase2.as_ref() {
                let attempt_id = 1; // 首次创建，attempt_id=1
                let ttl_s = self.reserved_ttl_seconds.max(1);
                let reserved = match rt.reserve_node_slot(node_id, &job_id, attempt_id, ttl_s).await {
                    Ok(true) => true,
                    Ok(false) => {
                        // 预留失败（节点已满等），继续执行但标记为无节点
                        false
                    }
                    Err(crate::messages::ErrorCode::SchedulerDependencyDown) => {
                        // Redis 不可用：fail closed，拒绝新任务
                        // 注意：由于函数返回类型是 Job 而不是 Option<Job>，我们创建一个失败的 Job
                        // 通过设置 assigned_node_id = None 和记录错误日志来处理
                        tracing::error!(
                            job_id = %job_id,
                            node_id = %node_id,
                            "Redis 不可用，无法预留节点槽位，拒绝任务（SCHEDULER_DEPENDENCY_DOWN）"
                        );
                        // 标记为无节点，后续可以通过检查 assigned_node_id 来判断是否因 Redis 不可用而失败
                        false
                    }
                    Err(_) => false, // 其他错误，按失败处理
                };
                if !reserved {
                    final_assigned_node_id = None;
                    warn!(
                        trace_id = %trace_id,
                        job_id = %job_id,
                        node_id = %node_id,
                        "Node selected but reserve failed, falling back to no node"
                    );
                }
            } else {
                // Phase2未启用：无法进行reservation，直接失败
                warn!(
                    trace_id = %trace_id,
                    job_id = %job_id,
                    node_id = %node_id,
                    "Phase2未启用，无法进行reservation"
                );
                final_assigned_node_id = None;
            }
        }

        // 写入 request_id lease（只在成功创建时写入；无论是否分配到节点，都写入以避免短时间重复创建）
        let now_ms = chrono::Utc::now().timestamp_millis();
        let lease_ms = (self.lease_seconds as i64) * 1000;
        let exp_ms = now_ms + lease_ms;
        self.request_bindings
            .write()
            .await
            .insert(request_id.clone(), (job_id.clone(), exp_ms));

        debug!(trace_id = %trace_id, job_id = %job_id, request_id = %request_id, session_id = %session_id, utterance_index = utterance_index, node_id = ?final_assigned_node_id, "创建 Job");

        if final_assigned_node_id.is_none() {
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
            dispatch_attempt_id: if final_assigned_node_id.is_some() { 1 } else { 0 },
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
            assigned_node_id: final_assigned_node_id.clone(),
            status: if final_assigned_node_id.is_some() {
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
            is_manual_cut,
            is_pause_triggered,
            is_timeout_triggered,
        };

        let mut jobs = self.jobs.write().await;
        jobs.insert(job_id, job.clone());
        job
    }
}

