use super::JobDispatcher;
use super::job::Job;
use crate::messages::{FeatureFlags, PipelineConfig};
use uuid::Uuid;

mod job_creation_phase2;
mod job_creation_phase1;
mod job_creation_node_selection;

impl JobDispatcher {
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
        is_manual_cut: bool, // 是否由用户手动发送
        is_pause_triggered: bool, // 是否由3秒静音触发
        is_timeout_triggered: bool, // 是否由10秒超时触发
    ) -> Job {
        let request_id = request_id.unwrap_or_else(|| format!("req-{}", Uuid::new_v4().to_string()[..12].to_uppercase()));
        let now_ms = chrono::Utc::now().timestamp_millis();
        // Phase 3：routing_key 优先 tenant_id，其次 session_id（保证同租户/同会话稳定落 pool；不影响 request_id 幂等）
        let routing_key = tenant_id
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(session_id.as_str());

        // Phase 2：跨实例幂等（优先使用 Redis request_id bind）
        if self.phase2.is_some() {
            // 先做一次无锁读取（快速路径）
            if let Some(job) = self.check_phase2_idempotency(
                &request_id,
                &session_id,
                utterance_index,
                &src_lang,
                &tgt_lang,
                &dialect,
                &features,
                &pipeline,
                &audio_data,
                &audio_format,
                sample_rate,
                &mode,
                &lang_a,
                &lang_b,
                &auto_langs,
                &enable_streaming_asr,
                &partial_update_interval_ms,
                &trace_id,
                &tenant_id,
                &target_session_ids,
                first_chunk_client_timestamp_ms,
            ).await {
                return job;
            }

            // 计算 exclude_node_id（用于节点选择）
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

            // 加锁路径：尝试获取锁并创建新 Job
            if let Some(job) = self.create_job_with_phase2_lock(
                &request_id,
                &session_id,
                utterance_index,
                &src_lang,
                &tgt_lang,
                dialect.clone(),
                features.clone(),
                pipeline.clone(),
                audio_data.clone(),
                audio_format.clone(),
                sample_rate,
                preferred_node_id.clone(),
                mode.clone(),
                lang_a.clone(),
                lang_b.clone(),
                auto_langs.clone(),
                enable_streaming_asr,
                partial_update_interval_ms,
                trace_id.clone(),
                tenant_id.clone(),
                routing_key,
                exclude_node_id,
                now_ms,
                target_session_ids.clone(),
                first_chunk_client_timestamp_ms,
                padding_ms,
                is_manual_cut,
                is_pause_triggered,
                is_timeout_triggered,
            ).await {
                return job;
            }
        }

        // Phase 1：本地幂等检查
        if let Some(job) = self.check_phase1_idempotency(&request_id, now_ms).await {
            return job;
        }

        // 创建新 Job（Phase 1 模式）
        let job_id = format!("job-{}", Uuid::new_v4().to_string()[..8].to_uppercase());

        // 节点选择（exclude_node_id 在 select_node_for_job_creation 内部计算）
        let (assigned_node_id, no_available_node_metric) = self.select_node_for_job_creation(
            routing_key,
            &session_id,
            &src_lang,
            &tgt_lang,
            &features,
            &pipeline,
            preferred_node_id,
            &trace_id,
            &request_id,
            now_ms,
        ).await;

        // 创建 Job（Phase 1 模式）
        self.create_job_phase1(
            job_id,
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
            assigned_node_id,
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
            padding_ms,
            is_manual_cut,
            is_pause_triggered,
            is_timeout_triggered,
            no_available_node_metric,
        ).await
    }
}
