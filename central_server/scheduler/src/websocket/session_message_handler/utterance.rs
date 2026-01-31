use base64::{engine::general_purpose, Engine as _};
use crate::core::AppState;
use crate::messages::{ErrorCode, UiEventStatus, UiEventType};
use crate::websocket::{create_job_assign_message, send_ui_event};
use crate::websocket::job_creator::create_translation_jobs;
use axum::extract::ws::Message;
use tokio::sync::mpsc;
use tracing::{info, warn};

pub(super) async fn handle_utterance(
    state: &AppState,
    tx: &mpsc::UnboundedSender<Message>,
    sess_id: String,
    utterance_index: u64,
    manual_cut: bool,
    src_lang: String,
    tgt_lang: String,
    dialect: Option<String>,
    features: Option<crate::messages::FeatureFlags>,
    audio: String,
    audio_format: String,
    sample_rate: u32,
    utterance_trace_id: Option<String>,
    pipeline: Option<crate::messages::PipelineConfig>,
) -> Result<(), anyhow::Error> {
    // 验证会话
    let session = state
        .session_manager
        .get_session(&sess_id)
        .await
        .ok_or_else(|| anyhow::anyhow!("Session does not exist: {}", sess_id))?;

    // 使用 Utterance 中的 trace_id（如果提供），否则使用 Session 的 trace_id
    let trace_id = utterance_trace_id.unwrap_or_else(|| session.trace_id.clone());

    let audio_data = general_purpose::STANDARD
        .decode(&audio)
        .map_err(|e| anyhow::anyhow!("Audio decode failed: {}", e))?;

    // 使用会话的默认 features（如果请求中没有指定）
    let final_features = features.or(session.default_features.clone());

    // 使用请求中的 pipeline 配置，如果没有则使用默认值
    let final_pipeline = pipeline.unwrap_or_else(|| crate::messages::PipelineConfig {
        use_asr: true,
        use_nmt: true,
        use_tts: true,
        use_semantic: false, // 语义修复由节点端自己决定
        use_tone: false, // 默认不使用音色克隆
    });

    // 创建 job（从 session 获取流式 ASR 配置，默认启用）
    let enable_streaming_asr = Some(true); // 默认启用流式 ASR
    let partial_update_interval_ms = Some(1000u64); // 默认 1 秒更新间隔

    info!(
        session_id = %sess_id,
        utterance_index = utterance_index,
        src_lang = %src_lang,
        tgt_lang = %tgt_lang,
        lang_a = ?session.lang_a,
        lang_b = ?session.lang_b,
        mode = ?session.mode,
        audio_bytes = audio_data.len(),
        "【Utterance】开始创建翻译任务"
    );

    let turn_id = uuid::Uuid::new_v4().to_string();
    let jobs = create_translation_jobs(
        state,
        &turn_id,
        &sess_id,
        utterance_index,
        src_lang.clone(),
        tgt_lang.clone(),
        dialect.clone(),
        final_features.clone(),
        final_pipeline,
        session.tenant_id.clone(),
        audio_data,
        audio_format,
        sample_rate,
        session.paired_node_id.clone(),
        session.mode.clone(),
        session.lang_a.clone(),
        session.lang_b.clone(),
        session.auto_langs.clone(),
        enable_streaming_asr,
        partial_update_interval_ms,
        trace_id.clone(), // Use trace_id from Utterance or Session
        None, // Utterance 消息没有客户端时间戳
        None, // EDGE-4: Padding 配置（Utterance 消息不传递 padding_ms，由 finalize 时计算）
        manual_cut,
        false,
        false,
    )
    .await?;

    // 按 utterance_index 顺序派发：客户端可能乱序发送 Utterance，此处缓冲后按序派发
    state.pending_job_dispatches.add(&sess_id, utterance_index, jobs).await;
    while let Some((ui, batch)) = state.pending_job_dispatches.take_next(&sess_id).await {
        for job in batch {
            info!(
                trace_id = %trace_id,
                job_id = %job.job_id,
                node_id = ?job.assigned_node_id,
                tgt_lang = %job.tgt_lang,
                utterance_index = ui,
                "【Utterance】按序派发 Job"
            );

            if let Some(ref node_id) = job.assigned_node_id {
            // 优化: 使用本地内存字段作为短路条件（性能优化）
            // 注意：跨实例正确性必须通过 Redis Lua 原子占用保证，不能仅依赖本地字段
            if job.dispatched_to_node {
                continue;  // 已派发，跳过（本地判断）
            }

            // 关键：必须以 Redis Lua 原子占用作为唯一闸门
            // 先执行 Lua 原子占用 → 占用成功后再向节点发送任务
            // 优化：使用 mark_job_dispatched，它内部会进行原子占用
            let dispatch_result = state.dispatcher.mark_job_dispatched(&job.job_id, Some(&job.request_id), Some(job.dispatch_attempt_id)).await;
            
            if !dispatch_result {
                tracing::debug!(
                    trace_id = %trace_id,
                    job_id = %job.job_id,
                    node_id = %node_id,
                    "【Utterance】原子占用失败，跳过派发"
                );
                continue;
            }
            
            // 原子占用成功，可以安全派发
            // Note: In current implementation, JobAssign doesn't have ASR result yet, so group_id, part_index, context_text are None
            // 记录派发开始时间（用于计算 dispatch_latency）
            let dispatch_start = std::time::Instant::now();
            if let Some(job_assign_msg) = create_job_assign_message(state, &job, None, None, None).await {
                if crate::redis_runtime::send_node_message_routed(state, node_id, job_assign_msg).await {
                    // 记录派发延迟
                    let dispatch_latency = dispatch_start.elapsed().as_secs_f64();
                    crate::metrics::prometheus_metrics::observe_dispatch_latency(dispatch_latency);
                    
                    info!(
                        trace_id = %trace_id,
                        job_id = %job.job_id,
                        node_id = %node_id,
                        dispatch_latency_seconds = dispatch_latency,
                        "【派发】任务派发成功"
                    );
                    // Send DISPATCHED event（使用本批次的 ui，不是当前消息的 utterance_index）
                    send_ui_event(
                        tx,
                        &trace_id,
                        &sess_id,
                        &job.job_id,
                        ui,
                        UiEventType::Dispatched,
                        None,
                        UiEventStatus::Ok,
                        None,
                    )
                    .await;
                } else {
                    warn!(
                        trace_id = %trace_id,
                        job_id = %job.job_id,
                        node_id = %node_id,
                        "【派发】发往节点失败"
                    );
                    // 发送失败：释放 reserved 并发槽（幂等）
                    if let Some(rt) = state.phase2.as_ref() {
                        rt.release_node_slot(node_id, &job.job_id, job.dispatch_attempt_id).await;
                        let _ = rt
                            .job_fsm_to_finished(&job.job_id, job.dispatch_attempt_id.max(1), false)
                            .await;
                        let _ = rt.job_fsm_to_released(&job.job_id).await;
                    }
                    // 标记 job 为失败
                    state
                        .dispatcher
                        .update_job_status(&job.job_id, crate::core::dispatcher::JobStatus::Failed)
                        .await;
                    // 推送 ERROR 事件（使用本批次的 ui）
                    send_ui_event(
                        tx,
                        &trace_id,
                        &sess_id,
                        &job.job_id,
                        ui,
                        UiEventType::Error,
                        None,
                        UiEventStatus::Error,
                        Some(ErrorCode::NodeUnavailable),
                    )
                    .await;
                }
            }
            } else {
                // 节点不可用是内部调度问题，只记录日志，不发送错误给Web端
                warn!(
                    job_id = %job.job_id,
                    session_id = %sess_id,
                    utterance_index = ui,
                    "【任务创建】无可用节点（调度问题，未下发给客户端）"
                );
                // 不发送错误给Web端，让任务在超时后自然失败
            }
        }
    }

    Ok(())
}
