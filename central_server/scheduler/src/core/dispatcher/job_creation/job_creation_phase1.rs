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
        // Phase 1：并发一致性（reserve）——绑定成功 ≈ 占用 1 个槽
        let mut final_assigned_node_id = assigned_node_id.clone();
        if let Some(node_id) = &assigned_node_id {
            let ttl = std::time::Duration::from_secs(self.reserved_ttl_seconds);
            let reserved = self
                .node_registry
                .reserve_job_slot(node_id, &job_id, ttl)
                .await;
            if !reserved {
                final_assigned_node_id = None;
                // 选择到了节点但 reserve 失败：多数是并发槽竞争/心跳滞后导致
                warn!(
                    trace_id = %trace_id,
                    job_id = %job_id,
                    node_id = %node_id,
                    "Node selected but reserve failed, falling back to no node"
                );
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

