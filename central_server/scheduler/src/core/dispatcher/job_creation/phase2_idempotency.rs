//! Phase 2 幂等性检查模块

use super::super::JobDispatcher;
use super::super::job::Job;
use super::job_builder::build_job_from_binding;
use crate::messages::{FeatureFlags, PipelineConfig};

impl JobDispatcher {
    /// Phase 2: 跨实例幂等检查（Redis request_id bind）- 测试用
    /// 如果找到已存在的绑定，返回对应的 Job；否则返回 None
    #[cfg(any(test, feature = "test-helpers"))]
    pub async fn check_phase2_idempotency_test(
        &self,
        request_id: &str,
        session_id: &str,
        utterance_index: u64,
        src_lang: &str,
        tgt_lang: &str,
        dialect: &Option<String>,
        features: &Option<FeatureFlags>,
        pipeline: &PipelineConfig,
        audio_data: &Vec<u8>,
        audio_format: &str,
        sample_rate: u32,
        mode: &Option<String>,
        lang_a: &Option<String>,
        lang_b: &Option<String>,
        auto_langs: &Option<Vec<String>>,
        enable_streaming_asr: &Option<bool>,
        partial_update_interval_ms: &Option<u64>,
        trace_id: &str,
        tenant_id: &Option<String>,
        target_session_ids: &Option<Vec<String>>,
        first_chunk_client_timestamp_ms: Option<i64>,
    ) -> Option<Job> {
        self.check_phase2_idempotency(
            request_id,
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
            mode,
            lang_a,
            lang_b,
            auto_langs,
            enable_streaming_asr,
            partial_update_interval_ms,
            trace_id,
            tenant_id,
            target_session_ids,
            first_chunk_client_timestamp_ms,
        ).await
    }

    /// Phase 2: 跨实例幂等检查（Redis request_id bind）
    /// 如果找到已存在的绑定，返回对应的 Job；否则返回 None
    pub(crate) async fn check_phase2_idempotency(
        &self,
        request_id: &str,
        session_id: &str,
        utterance_index: u64,
        src_lang: &str,
        tgt_lang: &str,
        dialect: &Option<String>,
        features: &Option<FeatureFlags>,
        pipeline: &PipelineConfig,
        audio_data: &Vec<u8>,
        audio_format: &str,
        sample_rate: u32,
        mode: &Option<String>,
        lang_a: &Option<String>,
        lang_b: &Option<String>,
        auto_langs: &Option<Vec<String>>,
        enable_streaming_asr: &Option<bool>,
        partial_update_interval_ms: &Option<u64>,
        trace_id: &str,
        tenant_id: &Option<String>,
        target_session_ids: &Option<Vec<String>>,
        first_chunk_client_timestamp_ms: Option<i64>,
    ) -> Option<Job> {
        let rt = self.phase2.clone()?;

        // 先做一次无锁读取（快速路径）
        if let Some(b) = rt.get_request_binding(request_id).await {
            let job_id = b.job_id.clone();
            if let Some(job) = self.get_job(&job_id).await {
                return Some(job);
            }
            let assigned_node_id = b.node_id.clone();
            let job = build_job_from_binding(
                job_id.clone(),
                request_id.to_string(),
                session_id.to_string(),
                utterance_index,
                src_lang.to_string(),
                tgt_lang.to_string(),
                dialect.clone(),
                features.clone(),
                pipeline.clone(),
                audio_data.clone(),
                audio_format.to_string(),
                sample_rate,
                assigned_node_id.clone(),
                b.dispatched_to_node,
                mode.clone(),
                lang_a.clone(),
                lang_b.clone(),
                auto_langs.clone(),
                *enable_streaming_asr,
                *partial_update_interval_ms,
                trace_id.to_string(),
                tenant_id.clone(),
                target_session_ids.clone(),
                first_chunk_client_timestamp_ms,
                None, // EDGE-4: Padding 配置（在 Phase2 幂等检查时，padding_ms 尚未确定）
                false,
                false,
                false,
            );
            self.jobs.write().await.insert(job_id, job.clone());
            return Some(job);
        }

        None
    }
}
