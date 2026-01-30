// 翻译任务创建模块

use base64::{engine::general_purpose, Engine as _};
use crate::core::AppState;
use crate::core::job_idempotency::{make_job_key, JobType};
use crate::core::dispatcher::{Job, JobStatus};
use crate::messages::FeatureFlags;
use tracing::info;

/// 检查 Job 是否已存在（幂等性检查）
/// 
/// 如果存在且可用，返回已有的 Job，并记录重复任务指标
async fn check_and_get_existing_job(
    state: &AppState,
    tenant_id: Option<&str>,
    session_id: &str,
    utterance_index: u64,
    target_lang: &str,
    features: Option<&FeatureFlags>,
) -> Option<Job> {
    let job_key = make_job_key(
        tenant_id,
        session_id,
        utterance_index,
        JobType::Translation,
        target_lang,
        features,
    );
    
    if let Some(existing_job_id) = state.job_idempotency.get_job_id(&job_key).await {
        if let Some(existing_job) = state.dispatcher.get_job(&existing_job_id).await {
            crate::metrics::on_duplicate_job_blocked();
            return Some(existing_job);
        }
    }
    
    None
}


/// 创建翻译任务（支持房间模式多语言）
/// 与备份一致：音频随 Job 存储，支持房间多 Job 与 failover 重派
pub(crate) async fn create_translation_jobs(
    state: &AppState,
    session_id: &str,
    utterance_index: u64,
    src_lang: String,
    default_tgt_lang: String, // 单会话模式使用的目标语言
    dialect: Option<String>,
    features: Option<FeatureFlags>,
    pipeline: crate::messages::PipelineConfig,
    tenant_id: Option<String>,
    audio_data: Vec<u8>,
    audio_format: String,
    sample_rate: u32,
    _paired_node_id: Option<String>,
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
    is_timeout_triggered: bool, // 是否由 Timeout（超时）触发，节点端缓存到 pendingTimeoutAudio
    is_max_duration_triggered: bool, // 是否由 MaxDuration（持续说话超长）触发，节点端切片处理
) -> Result<Vec<crate::core::dispatcher::Job>, anyhow::Error> {
    // 检查是否在房间中
    if let Some(room_code) = state.room_manager.find_room_by_session(session_id).await {
        // 会议室模式：为每个不同的 preferred_lang 创建独立的 Job
        let lang_groups = state.room_manager.get_distinct_target_languages(&room_code, session_id).await;
        
        if lang_groups.is_empty() {
            // 房间内没有其他成员，回退到单会话模式
            // 检查是否已存在相同的 job
            if let Some(existing_job) = check_and_get_existing_job(
                state,
                tenant_id.as_deref(),
                session_id,
                utterance_index,
                &default_tgt_lang,
                features.as_ref(),
            ).await {
                return Ok(vec![existing_job]);
            }
            
            let request_id = make_request_id(session_id, utterance_index, &default_tgt_lang, &trace_id);
            
            // 保存用于生成 job_key 的值（避免 borrow moved）
            let job_key_tenant = tenant_id.clone();
            let job_key_tgt_lang = default_tgt_lang.clone();
            let job_key_features = features.clone();
            
            let audio_base64 = general_purpose::STANDARD.encode(&audio_data);
            let job = create_job_with_minimal_scheduler(
                state,
                session_id,
                utterance_index,
                src_lang,
                default_tgt_lang,
                dialect.clone(),
                features,
                pipeline.clone(),
                audio_base64,
                audio_format.clone(),
                sample_rate,
                mode.clone(),
                lang_a.clone(),
                lang_b.clone(),
                auto_langs.clone(),
                enable_streaming_asr,
                partial_update_interval_ms,
                trace_id.clone(),
                tenant_id,
                request_id.clone(),
                None, // 单会话模式
                first_chunk_client_timestamp_ms,
                padding_ms,
                is_manual_cut,
                is_timeout_triggered,
                is_max_duration_triggered,
            ).await?;
            
            let job_key = make_job_key(
                job_key_tenant.as_deref(),
                session_id,
                utterance_index,
                JobType::Translation,
                &job_key_tgt_lang,
                job_key_features.as_ref(),
            );
            state.job_idempotency.get_or_create_job_id(&job_key, job.job_id.clone()).await;
            
            return Ok(vec![job]);
        }
        
        let audio_base64 = general_purpose::STANDARD.encode(&audio_data);
        let mut jobs = Vec::new();
        for (target_lang, members) in lang_groups {
            let target_session_ids: Vec<String> = members.iter().map(|m| m.session_id.clone()).collect();
            
            // 检查是否已存在相同的 job
            if let Some(existing_job) = check_and_get_existing_job(
                state,
                tenant_id.as_deref(),
                session_id,
                utterance_index,
                &target_lang,
                features.as_ref(),
            ).await {
                jobs.push(existing_job);
                continue;
            }
            
            // 为每个目标语言创建独立的 Job
            let request_id = make_request_id(session_id, utterance_index, &target_lang, &trace_id);
            
            // 保存用于生成 job_key 的值（避免 borrow moved）
            let job_key_tenant = tenant_id.clone();
            let job_key_tgt_lang = target_lang.clone();
            let job_key_features = features.clone();
            
            let job = create_job_with_minimal_scheduler(
                state,
                session_id,
                utterance_index,
                src_lang.clone(),
                target_lang,
                dialect.clone(),
                job_key_features.clone(),
                pipeline.clone(),
                audio_base64.clone(),
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
                is_timeout_triggered,
                is_max_duration_triggered,
            ).await?;
            
            let job_key = make_job_key(
                job_key_tenant.as_deref(),
                session_id,
                utterance_index,
                JobType::Translation,
                &job_key_tgt_lang,
                job_key_features.as_ref(),
            );
            state.job_idempotency.get_or_create_job_id(&job_key, job.job_id.clone()).await;
            
            jobs.push(job);
        }
        
        Ok(jobs)
    } else {
        // 单会话模式：只创建一个 Job
        // 检查是否已存在相同的 job
        if let Some(existing_job) = check_and_get_existing_job(
            state,
            tenant_id.as_deref(),
            session_id,
            utterance_index,
            &default_tgt_lang,
            features.as_ref(),
        ).await {
            return Ok(vec![existing_job]);
        }
        
        let request_id = make_request_id(session_id, utterance_index, &default_tgt_lang, &trace_id);
        
        // 保存用于生成 job_key 的值（避免 borrow moved）
        let job_key_tenant = tenant_id.clone();
        let job_key_tgt_lang = default_tgt_lang.clone();
        let job_key_features = features.clone();
        
        let audio_base64 = general_purpose::STANDARD.encode(&audio_data);
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
                use_semantic: false,
                use_tone: false,
            },
            audio_base64,
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
            None,
            first_chunk_client_timestamp_ms,
            padding_ms,
            is_manual_cut,
            is_timeout_triggered,
            is_max_duration_triggered,
        ).await?;
        
        // 注册 job_key 到 job_id 的映射
        let job_key = make_job_key(
            job_key_tenant.as_deref(),
            session_id,
            utterance_index,
            JobType::Translation,
            &job_key_tgt_lang,
            job_key_features.as_ref(),
        );
        state.job_idempotency.get_or_create_job_id(&job_key, job.job_id.clone()).await;
        
        Ok(vec![job])
    }
}

fn make_request_id(session_id: &str, utterance_index: u64, tgt_lang: &str, trace_id: &str) -> String {
    // Phase 1：任务级绑定（会话打散）。request_id 的目标是"同一任务重试幂等"，不做会话级粘滞
    // 选择稳定字段组合：session_id + utterance_index + tgt_lang + trace_id
    format!("{}:{}:{}:{}", session_id, utterance_index, tgt_lang, trace_id)
}

/// 判断是否需要绑定 job 到同一节点
///
/// - Manual / Timeout：不绑定
/// - MaxDuration：用户持续说话超长，产生多 job，需绑定同一节点以保证音频连续性
fn should_bind_job_to_node(is_manual_cut: bool, is_max_duration_triggered: bool) -> bool {
    is_max_duration_triggered && !is_manual_cut
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
    audio_base64: String,
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
    is_timeout_triggered: bool,
    is_max_duration_triggered: bool,
) -> Result<Job, anyhow::Error> {
    let job_id = format!("job-{}", uuid::Uuid::new_v4());
    let job_id_for_binding = if should_bind_job_to_node(is_manual_cut, is_max_duration_triggered) {
        Some(job_id.as_str())
    } else {
        None
    };

    // Pool 查找用语言对：与已删除的 dispatch_task 一致
    // src_lang == "auto" 且有两向 lang_a/lang_b 时，用 (lang_a, lang_b) 查池；否则用 (src_lang, tgt_lang)
    let (pool_src, pool_tgt) = if src_lang == "auto" && lang_a.is_some() && lang_b.is_some() {
        let a = lang_a.as_ref().unwrap().as_str();
        let b = lang_b.as_ref().unwrap().as_str();
        info!(
            session_id = %session_id,
            utterance_index = utterance_index,
            pool_src = %a,
            pool_tgt = %b,
            "【任务创建】Pool 查找使用 lang_a/lang_b（src=auto）"
        );
        (a, b)
    } else {
        info!(
            session_id = %session_id,
            utterance_index = utterance_index,
            pool_src = %src_lang,
            pool_tgt = %tgt_lang,
            "【任务创建】Pool 查找使用 src_lang/tgt_lang"
        );
        (src_lang.as_str(), tgt_lang.as_str())
    };

    let pool_service = state.pool_service.as_ref()
        .ok_or_else(|| anyhow::anyhow!("PoolService not initialized"))?;
    let node_id_str = pool_service.select_node(pool_src, pool_tgt, job_id_for_binding, Some(session_id)).await?;
    
    let node_id = Some(node_id_str);

    info!(
        trace_id = %trace_id,
        job_id = %job_id,
        node_id = ?node_id,
        session_id = %session_id,
        utterance_index = utterance_index,
        "【任务创建】Job 创建成功（已选节点）"
    );

    // 注意：不再使用 request_binding，幂等性通过 JobIdempotencyManager 管理

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
        audio_base64,
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
        is_timeout_triggered,
        is_max_duration_triggered,
        expected_duration_ms: None, // 默认不设置预计时长
    };

    // 保存 Job 到 Redis（SSOT）
    state.dispatcher.save_job(&job).await?;

    Ok(job)
}
