// 翻译任务创建模块

use crate::core::AppState;
use crate::core::job_idempotency::{make_job_key, JobType};
use crate::messages::FeatureFlags;

/// 创建翻译任务（支持房间模式多语言）
/// 如果是房间模式，为每个不同的 preferred_lang 创建独立的 Job
pub(crate) async fn create_translation_jobs(
    state: &AppState,
    session_id: &str,
    utterance_index: u64,
    src_lang: String,
    default_tgt_lang: String, // 单会话模式使用的目标语言
    dialect: Option<String>,
    features: Option<FeatureFlags>,
    tenant_id: Option<String>,
    audio_data: Vec<u8>,
    audio_format: String,
    sample_rate: u32,
    paired_node_id: Option<String>,
    mode: Option<String>,
    lang_a: Option<String>,
    lang_b: Option<String>,
    auto_langs: Option<Vec<String>>,
    enable_streaming_asr: Option<bool>,
    partial_update_interval_ms: Option<u64>,
    trace_id: String,
    first_chunk_client_timestamp_ms: Option<i64>,
    padding_ms: Option<u64>, // EDGE-4: Padding 配置（毫秒）
) -> Result<Vec<crate::core::dispatcher::Job>, anyhow::Error> {
    // 检查是否在房间中
    if let Some(room_code) = state.room_manager.find_room_by_session(session_id).await {
        // 会议室模式：为每个不同的 preferred_lang 创建独立的 Job
        let lang_groups = state.room_manager.get_distinct_target_languages(&room_code, session_id).await;
        
        if lang_groups.is_empty() {
            // 房间内没有其他成员，回退到单会话模式
            // 使用 job_key 进行幂等检查
            let job_key = make_job_key(
                tenant_id.as_deref(),
                session_id,
                utterance_index,
                JobType::Translation,
                &default_tgt_lang,
                features.as_ref(),
            );
            
            // 检查是否已存在相同的 job
            if let Some(existing_job_id) = state.job_idempotency.get_job_id(&job_key).await {
                // 如果已存在，返回已存在的 job
                if let Some(existing_job) = state.dispatcher.get_job(&existing_job_id).await {
                    crate::metrics::on_duplicate_job_blocked();
                    return Ok(vec![existing_job]);
                }
            }
            
            let request_id = make_request_id(session_id, utterance_index, &default_tgt_lang, &trace_id);
            let job = state.dispatcher.create_job(
                session_id.to_string(),
                utterance_index,
                src_lang,
                default_tgt_lang,
                dialect,
                features,
                crate::messages::PipelineConfig {
                    use_asr: true,
                    use_nmt: true,
                    use_tts: true,
                },
                audio_data.clone(),
                audio_format.clone(),
                sample_rate,
                paired_node_id.clone(),
                mode.clone(),
                lang_a.clone(),
                lang_b.clone(),
                auto_langs.clone(),
                enable_streaming_asr,
                partial_update_interval_ms,
                trace_id.clone(),
                tenant_id.clone(),
                Some(request_id),
                None, // 单会话模式
                first_chunk_client_timestamp_ms,
                padding_ms, // EDGE-4: Padding 配置
            ).await;
            
            // 注册 job_key 到 job_id 的映射
            state.job_idempotency.get_or_create_job_id(&job_key, job.job_id.clone()).await;
            
            return Ok(vec![job]);
        }
        
        // 为每个不同的 preferred_lang 创建 Job
        let mut jobs = Vec::new();
        for (target_lang, members) in lang_groups {
            let target_session_ids: Vec<String> = members.iter().map(|m| m.session_id.clone()).collect();
            
            // 使用 job_key 进行幂等检查
            let job_key = make_job_key(
                tenant_id.as_deref(),
                session_id,
                utterance_index,
                JobType::Translation,
                &target_lang,
                features.as_ref(),
            );
            
            // 检查是否已存在相同的 job
            if let Some(existing_job_id) = state.job_idempotency.get_job_id(&job_key).await {
                // 如果已存在，返回已存在的 job
                if let Some(existing_job) = state.dispatcher.get_job(&existing_job_id).await {
                    crate::metrics::on_duplicate_job_blocked();
                    jobs.push(existing_job);
                    continue;
                }
            }
            
            // 为每个目标语言创建独立的 Job
            let request_id = make_request_id(session_id, utterance_index, &target_lang, &trace_id);
            let job = state.dispatcher.create_job(
                session_id.to_string(),
                utterance_index,
                src_lang.clone(),
                target_lang.clone(), // 使用目标语言
                dialect.clone(),
                features.clone(),
                crate::messages::PipelineConfig {
                    use_asr: true,
                    use_nmt: true,
                    use_tts: true,
                },
                audio_data.clone(), // 复制音频数据
                audio_format.clone(),
                sample_rate,
                paired_node_id.clone(),
                mode.clone(),
                lang_a.clone(),
                lang_b.clone(),
                auto_langs.clone(),
                enable_streaming_asr,
                partial_update_interval_ms,
                trace_id.clone(),
                tenant_id.clone(),
                Some(request_id),
                Some(target_session_ids), // 指定目标接收者
                first_chunk_client_timestamp_ms,
                padding_ms, // EDGE-4: Padding 配置
            ).await;
            
            // 注册 job_key 到 job_id 的映射
            state.job_idempotency.get_or_create_job_id(&job_key, job.job_id.clone()).await;
            
            jobs.push(job);
        }
        
        Ok(jobs)
    } else {
        // 单会话模式：只创建一个 Job
        // 使用 job_key 进行幂等检查
        let job_key = make_job_key(
            tenant_id.as_deref(),
            session_id,
            utterance_index,
            JobType::Translation,
            &default_tgt_lang,
            features.as_ref(),
        );
        
        // 检查是否已存在相同的 job
        if let Some(existing_job_id) = state.job_idempotency.get_job_id(&job_key).await {
            // 如果已存在，返回已存在的 job
            if let Some(existing_job) = state.dispatcher.get_job(&existing_job_id).await {
                crate::metrics::on_duplicate_job_blocked();
                return Ok(vec![existing_job]);
            }
        }
        
        let request_id = make_request_id(session_id, utterance_index, &default_tgt_lang, &trace_id);
        let job = state.dispatcher.create_job(
            session_id.to_string(),
            utterance_index,
            src_lang,
            default_tgt_lang,
            dialect,
            features,
            crate::messages::PipelineConfig {
                use_asr: true,
                use_nmt: true,
                use_tts: true,
            },
            audio_data,
            audio_format,
            sample_rate,
            paired_node_id,
            mode,
            lang_a,
            lang_b,
            auto_langs,
            enable_streaming_asr,
            partial_update_interval_ms,
            trace_id,
            tenant_id,
            Some(request_id),
            None, // 单会话模式
            first_chunk_client_timestamp_ms,
            padding_ms, // EDGE-4: Padding 配置
        ).await;
        
        // 注册 job_key 到 job_id 的映射
        state.job_idempotency.get_or_create_job_id(&job_key, job.job_id.clone()).await;
        
        Ok(vec![job])
    }
}

fn make_request_id(session_id: &str, utterance_index: u64, tgt_lang: &str, trace_id: &str) -> String {
    // Phase 1：任务级绑定（会话打散）。request_id 的目标是"同一任务重试幂等"，不做会话级粘滞
    // 选择稳定字段组合：session_id + utterance_index + tgt_lang + trace_id
    format!("{}:{}:{}:{}", session_id, utterance_index, tgt_lang, trace_id)
}
