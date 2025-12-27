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
    src_lang: String,
    tgt_lang: String,
    dialect: Option<String>,
    features: Option<crate::messages::FeatureFlags>,
    audio: String,
    audio_format: String,
    sample_rate: u32,
    utterance_trace_id: Option<String>,
) -> Result<(), anyhow::Error> {
    // 验证会话
    let session = state
        .session_manager
        .get_session(&sess_id)
        .await
        .ok_or_else(|| anyhow::anyhow!("Session does not exist: {}", sess_id))?;

    // 使用 Utterance 中的 trace_id（如果提供），否则使�?Session �?trace_id
    let trace_id = utterance_trace_id.unwrap_or_else(|| session.trace_id.clone());

    // 解码音频
    use base64::{engine::general_purpose, Engine as _};
    let audio_data = general_purpose::STANDARD
        .decode(&audio)
        .map_err(|e| anyhow::anyhow!("Audio decode failed: {}", e))?;

    // 使用会话的默�?features（如果请求中没有指定�?
    let final_features = features.or(session.default_features.clone());

    // 创建 job（从 session 获取流式 ASR 配置，默认启用）
    let enable_streaming_asr = Some(true); // 默认启用流式 ASR
    let partial_update_interval_ms = Some(1000u64); // 默认 1 秒更新间�?

    // 创建翻译任务（支持房间模式多语言�?
    let jobs = create_translation_jobs(
        state,
        &sess_id,
        utterance_index,
        src_lang.clone(),
        tgt_lang.clone(),
        dialect.clone(),
        final_features.clone(),
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
    )
    .await?;

    // 为每�?Job 发送到节点
    for job in jobs {
        info!(
            trace_id = %trace_id,
            job_id = %job.job_id,
            node_id = ?job.assigned_node_id,
            tgt_lang = %job.tgt_lang,
            audio_format = %job.audio_format,
            audio_size_bytes = job.audio_data.len(),
            "Job created"
        );

        // If node is assigned, send job to node
        if let Some(ref node_id) = job.assigned_node_id {
            // Phase 1: Task-level idempotency. If job has been successfully dispatched, don't repeat dispatch
            if let Some(existing) = state.dispatcher.get_job(&job.job_id).await {
                if existing.dispatched_to_node {
                    continue;
                }
            }

            // Note: In current implementation, JobAssign doesn't have ASR result yet, so group_id, part_index, context_text are None
            if let Some(job_assign_msg) = create_job_assign_message(state, &job, None, None, None).await {
                if crate::phase2::send_node_message_routed(state, node_id, job_assign_msg).await {
                    state.dispatcher.mark_job_dispatched(&job.job_id).await;
                    // Send DISPATCHED event
                    send_ui_event(
                        tx,
                        &trace_id,
                        &sess_id,
                        &job.job_id,
                        utterance_index,
                        UiEventType::Dispatched,
                        None,
                        UiEventStatus::Ok,
                        None,
                    )
                    .await;
                } else {
                    warn!("Failed to send job to node {}", node_id);
                    // 发送失败：释放 reserved 并发槽（幂等�?
                    state.node_registry.release_job_slot(node_id, &job.job_id).await;
                    if let Some(rt) = state.phase2.as_ref() {
                        rt.release_node_slot(node_id, &job.job_id).await;
                        let _ = rt
                            .job_fsm_to_finished(&job.job_id, job.dispatch_attempt_id.max(1), false)
                            .await;
                        let _ = rt.job_fsm_to_released(&job.job_id).await;
                    }
                    // 标记 job 为失�?
                    state
                        .dispatcher
                        .update_job_status(&job.job_id, crate::core::dispatcher::JobStatus::Failed)
                        .await;
                    // 推�?ERROR 事件
                    send_ui_event(
                        tx,
                        &trace_id,
                        &sess_id,
                        &job.job_id,
                        utterance_index,
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
                utterance_index = utterance_index,
                "Job has no available nodes (internal scheduling issue, not sent to client)"
            );
            // 不发送错误给Web端，让任务在超时后自然失败
        }
    }

    Ok(())
}