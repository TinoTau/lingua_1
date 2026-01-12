// 翻译任务创建模块

use crate::core::AppState;
use crate::core::job_idempotency::{make_job_key, JobType};
use crate::core::dispatcher::{Job, JobStatus};
use crate::services::minimal_scheduler::DispatchRequest;
use crate::messages::FeatureFlags;
use tracing::debug;


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
    is_manual_cut: bool, // 是否由用户手动发送
    is_pause_triggered: bool, // 是否由3秒静音触发
    is_timeout_triggered: bool, // 是否由10秒超时触发
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
            
            // 使用新的极简无锁调度服务
            let job = create_job_with_minimal_scheduler(
                state,
                session_id,
                utterance_index,
                src_lang,
                default_tgt_lang.clone(),
                dialect.clone(),
                features.clone(),
                crate::messages::PipelineConfig {
                    use_asr: true,
                    use_nmt: true,
                    use_tts: true,
                    use_semantic: false, // 语义修复由节点端自己决定，调度服务器不干预
                },
                audio_data.clone(),
                audio_format.clone(),
                sample_rate,
                mode.clone(),
                lang_a.clone(),
                lang_b.clone(),
                auto_langs.clone(),
                enable_streaming_asr,
                partial_update_interval_ms,
                trace_id.clone(),
                tenant_id.clone(),
                request_id.clone(),
                None, // 单会话模式
                first_chunk_client_timestamp_ms,
                padding_ms,
                is_manual_cut,
                is_pause_triggered,
                is_timeout_triggered,
            ).await?;
            
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
            
            // 使用新的极简无锁调度服务
            let job = create_job_with_minimal_scheduler(
                state,
                session_id,
                utterance_index,
                src_lang.clone(),
                target_lang.clone(),
                dialect.clone(),
                features.clone(),
                crate::messages::PipelineConfig {
                    use_asr: true,
                    use_nmt: true,
                    use_tts: true,
                    use_semantic: false, // 语义修复由节点端自己决定，调度服务器不干预
                },
                audio_data.clone(),
                audio_format.clone(),
                sample_rate,
                mode.clone(),
                lang_a.clone(),
                lang_b.clone(),
                auto_langs.clone(),
                enable_streaming_asr,
                partial_update_interval_ms,
                trace_id.clone(),
                tenant_id.clone(),
                request_id.clone(),
                Some(target_session_ids.clone()),
                first_chunk_client_timestamp_ms,
                padding_ms,
                is_manual_cut,
                is_pause_triggered,
                is_timeout_triggered,
            ).await?;
            
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
        
        // 使用新的极简无锁调度服务
        let job = create_job_with_minimal_scheduler(
            state,
            session_id,
            utterance_index,
            src_lang,
            default_tgt_lang,
            dialect,
            features,
            crate::messages::PipelineConfig {
                use_asr: true,
                use_nmt: true,
                use_tts: true,
                use_semantic: false, // 初始为 false
            },
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
            request_id,
            None, // 单会话模式
            first_chunk_client_timestamp_ms,
            padding_ms,
            is_manual_cut,
            is_pause_triggered,
            is_timeout_triggered,
        ).await?;
        
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

/// 使用极简无锁调度服务创建任务
async fn create_job_with_minimal_scheduler(
    state: &AppState,
    session_id: &str,
    utterance_index: u64,
    src_lang: String,
    tgt_lang: String,
    dialect: Option<String>,
    features: Option<FeatureFlags>,
    pipeline: crate::messages::PipelineConfig,
    audio_data: Vec<u8>,
    audio_format: String,
    sample_rate: u32,
    mode: Option<String>,
    lang_a: Option<String>,
    lang_b: Option<String>,
    auto_langs: Option<Vec<String>>,
    enable_streaming_asr: Option<bool>,
    partial_update_interval_ms: Option<u64>,
    trace_id: String,
    tenant_id: Option<String>,
    request_id: String,
    target_session_ids: Option<Vec<String>>,
    first_chunk_client_timestamp_ms: Option<i64>,
    padding_ms: Option<u64>,
    is_manual_cut: bool,
    is_pause_triggered: bool,
    is_timeout_triggered: bool,
) -> Result<Job, anyhow::Error> {
    let scheduler = state.minimal_scheduler.as_ref()
        .ok_or_else(|| anyhow::anyhow!("MinimalSchedulerService not initialized (Phase2 not enabled)"))?;

    // 构建 payload_json（存储任务元数据，实际在 Lua 脚本中只是存储）
    let payload_json = serde_json::json!({
        "trace_id": trace_id,
        "tenant_id": tenant_id,
    }).to_string();

    // 调用新的调度服务
    let src_lang_clone = src_lang.clone();
    let dispatch_resp = scheduler.dispatch_task(DispatchRequest {
        session_id: session_id.to_string(),
        src_lang: src_lang_clone,
        tgt_lang: tgt_lang.clone(),
        payload_json,
    }).await?;

    let node_id = Some(dispatch_resp.node_id);
    let job_id = dispatch_resp.job_id;

    debug!(
        trace_id = %trace_id,
        job_id = %job_id,
        node_id = ?node_id,
        session_id = %session_id,
        utterance_index = utterance_index,
        "任务创建成功（使用极简无锁调度服务）"
    );

    // 写入 request_id lease
    let now_ms = chrono::Utc::now().timestamp_millis();
    let lease_ms = (state.dispatcher.lease_seconds as i64) * 1000;
    let exp_ms = now_ms + lease_ms;
    state.dispatcher.request_bindings
        .write()
        .await
        .insert(request_id.clone(), (job_id.clone(), exp_ms));

    // 构建 Job 对象
    let job = Job {
        job_id: job_id.clone(),
        request_id,
        dispatched_to_node: false,
        dispatched_at_ms: None,
        failover_attempts: 0,
        dispatch_attempt_id: if node_id.is_some() { 1 } else { 0 },
        session_id: session_id.to_string(),
        utterance_index,
        src_lang,
        tgt_lang,
        dialect,
        features,
        pipeline,
        audio_data,
        audio_format,
        sample_rate,
        assigned_node_id: node_id.clone(),
        status: if node_id.is_some() {
            JobStatus::Assigned
        } else {
            JobStatus::Pending
        },
        created_at: chrono::Utc::now(),
        trace_id,
        mode,
        lang_a,
        lang_b,
        auto_langs,
        enable_streaming_asr,
        partial_update_interval_ms,
        target_session_ids,
        tenant_id,
        first_chunk_client_timestamp_ms,
        padding_ms,
        is_manual_cut,
        is_pause_triggered,
        is_timeout_triggered,
    };

    // 写入 jobs 映射
    state.dispatcher.jobs.write().await.insert(job_id, job.clone());

    Ok(job)
}
