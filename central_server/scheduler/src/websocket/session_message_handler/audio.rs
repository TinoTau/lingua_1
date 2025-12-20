use crate::core::AppState;
use crate::messages::{ErrorCode, UiEventStatus, UiEventType};
use crate::websocket::{create_job_assign_message, send_error, send_ui_event};
use crate::websocket::job_creator::create_translation_jobs;
use crate::websocket::session_actor::SessionEvent;
use axum::extract::ws::Message;
use tokio::sync::mpsc;
use tracing::{info, warn};

#[derive(Debug, Clone, Copy)]
enum FinalizeReason {
    Send,
    Pause,
}

pub(super) async fn handle_audio_chunk(
    state: &AppState,
    _tx: &mpsc::UnboundedSender<Message>,
    sess_id: String,
    is_final: bool,
    payload: Option<String>,
) -> Result<(), anyhow::Error> {
    // 验证会话
    let _session = state
        .session_manager
        .get_session(&sess_id)
        .await
        .ok_or_else(|| anyhow::anyhow!("Session does not exist: {}", sess_id))?;

    // 获取 Session Actor Handle
    let actor_handle = state
        .session_manager
        .get_actor_handle(&sess_id)
        .await
        .ok_or_else(|| anyhow::anyhow!("Session Actor not found: {}", sess_id))?;

    // 解码音频数据
    let chunk = if let Some(payload_str) = payload {
        use base64::{engine::general_purpose, Engine as _};
        general_purpose::STANDARD
            .decode(&payload_str)
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    let now_ms = chrono::Utc::now().timestamp_millis();

    // 发送音频块事件到 Actor
    actor_handle.send(SessionEvent::AudioChunkReceived {
        chunk,
        is_final,
        timestamp_ms: now_ms,
    })?;

    // 如果是 is_final，发送 IsFinalReceived 事件
    if is_final {
        actor_handle.send(SessionEvent::IsFinalReceived)?;
    }

    Ok(())
}

// 保留旧的 finalize_audio_utterance 函数用于向后兼容（如果其他地方还在使用）
#[allow(dead_code)]
async fn finalize_audio_utterance(
    state: &AppState,
    tx: &mpsc::UnboundedSender<Message>,
    sess_id: &str,
    utterance_index: u64,
    reason: FinalizeReason,
) -> Result<bool, anyhow::Error> {
    let session = match state.session_manager.get_session(sess_id).await {
        Some(s) => s,
        None => return Ok(false),
    };

    // 去重检查：如果当前的 utterance_index 已经大于传入的 utterance_index，
    // 说明这个 utterance_index 已经被其他操作 finalize 了，直接返回 false
    // 这是一个轻量级的检查，避免重复 finalize 导致的重复 job 创建
    if session.utterance_index > utterance_index {
        tracing::debug!(
            session_id = %sess_id,
            requested_utterance_index = utterance_index,
            current_utterance_index = session.utterance_index,
            reason = ?reason,
            "Skipping finalize: utterance_index already finalized by another operation"
        );
        return Ok(false);
    }

    // 获取累积的音频数据
    let audio_data_opt = state.audio_buffer.take_combined(sess_id, utterance_index).await;
    let Some(audio_data) = audio_data_opt else {
        tracing::warn!(
            session_id = %sess_id,
            utterance_index = utterance_index,
            reason = ?reason,
            "No audio buffer found for utterance_index (may have been already finalized)"
        );
        return Ok(false);
    };
    if audio_data.is_empty() {
        tracing::warn!(
            session_id = %sess_id,
            utterance_index = utterance_index,
            reason = ?reason,
            "Audio buffer is empty"
        );
        return Ok(false);
    }
    
    tracing::info!(
        session_id = %sess_id,
        utterance_index = utterance_index,
        reason = ?reason,
        audio_size_bytes = audio_data.len(),
        "Finalizing audio utterance with audio data"
    );

    // 使用会话的默认配置
    let src_lang = session.src_lang.clone();
    let tgt_lang = session.tgt_lang.clone();
    let dialect = session.dialect.clone();
    let final_features = session.default_features.clone();

    // AudioChunk 默认启用流式 ASR（部分结果输出）
    let enable_streaming_asr = Some(true);
    let partial_update_interval_ms = Some(1000u64);

    // 创建翻译任务（支持房间模式多语言）
    let jobs = create_translation_jobs(
        state,
        sess_id,
        utterance_index,
        src_lang.clone(),
        tgt_lang.clone(),
        dialect.clone(),
        final_features.clone(),
        session.tenant_id.clone(),
        audio_data,
        "pcm16".to_string(),
        16000,
        session.paired_node_id.clone(),
        session.mode.clone(),
        session.lang_a.clone(),
        session.lang_b.clone(),
        session.auto_langs.clone(),
        enable_streaming_asr,
        partial_update_interval_ms,
        session.trace_id.clone(),
    )
    .await?;

    // 增加 utterance_index（任务结束）
    let old_index = utterance_index;
    state
        .session_manager
        .update_session(sess_id, crate::core::session::SessionUpdate::IncrementUtteranceIndex)
        .await;
    tracing::info!(
        session_id = %sess_id,
        old_utterance_index = old_index,
        new_utterance_index = old_index + 1,
        "Incremented utterance_index after finalizing audio"
    );

    // 为每个 Job 发送到节点
    for job in jobs {
        info!(
            trace_id = %job.trace_id,
            job_id = %job.job_id,
            node_id = ?job.assigned_node_id,
            tgt_lang = %job.tgt_lang,
            "Job created (from audio_chunk)"
        );

        if let Some(ref node_id) = job.assigned_node_id {
            // Phase 1: Task-level idempotency. If job has been successfully dispatched, don't repeat dispatch
            if let Some(existing) = state.dispatcher.get_job(&job.job_id).await {
                if existing.dispatched_to_node {
                    continue;
                }
            }

            if let Some(job_assign_msg) = create_job_assign_message(&job, None, None, None) {
                if crate::phase2::send_node_message_routed(state, node_id, job_assign_msg).await {
                    state.dispatcher.mark_job_dispatched(&job.job_id).await;
                    send_ui_event(
                        tx,
                        &job.trace_id,
                        sess_id,
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
                    // 发送失败：释放 reserved 并发槽（幂等）
                    state.node_registry.release_job_slot(node_id, &job.job_id).await;
                    if let Some(rt) = state.phase2.as_ref() {
                        rt.release_node_slot(node_id, &job.job_id).await;
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
                    send_ui_event(
                        tx,
                        &job.trace_id,
                        sess_id,
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
            warn!("Job {} has no available nodes", job.job_id);
            send_error(tx, ErrorCode::NodeUnavailable, "No available nodes").await;
            send_ui_event(
                tx,
                &job.trace_id,
                sess_id,
                &job.job_id,
                utterance_index,
                UiEventType::Error,
                None,
                UiEventStatus::Error,
                Some(ErrorCode::NoAvailableNode),
            )
            .await;
        }
    }

    match reason {
        FinalizeReason::Send => crate::metrics::on_web_task_finalized_by_send(),
        FinalizeReason::Pause => crate::metrics::on_web_task_finalized_by_pause(),
    }

    Ok(true)
}
