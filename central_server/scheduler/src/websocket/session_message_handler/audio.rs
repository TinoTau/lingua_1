use crate::app_state::AppState;
use crate::messages::{ErrorCode, UiEventStatus, UiEventType};
use crate::websocket::{create_job_assign_message, send_error, send_ui_event};
use crate::websocket::job_creator::create_translation_jobs;
use axum::extract::ws::Message;
use tokio::sync::mpsc;
use tracing::{info, warn};
use std::time::Duration;

#[derive(Debug, Clone, Copy)]
enum FinalizeReason {
    Send,
    Pause,
}

pub(super) async fn handle_audio_chunk(
    state: &AppState,
    tx: &mpsc::UnboundedSender<Message>,
    sess_id: String,
    is_final: bool,
    payload: Option<String>,
) -> Result<(), anyhow::Error> {
    // 验证会话
    let session = state
        .session_manager
        .get_session(&sess_id)
        .await
        .ok_or_else(|| anyhow::anyhow!("会话不存在: {}", sess_id))?;

    // 获取当前 utterance_index
    let mut utterance_index = session.utterance_index;

    // Web 端分段规则：超过 pause_ms 视为一个任务结束（自动切句）
    let now_ms = chrono::Utc::now().timestamp_millis();
    let pause_ms = state.web_task_segmentation.pause_ms;
    let pause_exceeded = state
        .audio_buffer
        .record_chunk_and_check_pause(&sess_id, now_ms, pause_ms)
        .await;
    if pause_exceeded {
        // 自动结束上一句（如果上一句缓冲区有内容）
        let finalized = finalize_audio_utterance(
            state,
            tx,
            &sess_id,
            utterance_index,
            FinalizeReason::Pause,
        )
        .await?;
        if finalized {
            // utterance_index 增加已在 finalize 中完成；刷新本地索引
            if let Some(updated) = state.session_manager.get_session(&sess_id).await {
                utterance_index = updated.utterance_index;
            }
        }
    }

    // 如果有 payload，解码并累积音频块
    if let Some(payload_str) = payload {
        use base64::{engine::general_purpose, Engine as _};
        if let Ok(audio_chunk) = general_purpose::STANDARD.decode(&payload_str) {
            state
                .audio_buffer
                .add_chunk(&sess_id, utterance_index, audio_chunk)
                .await;
        }
    }

    // 自动切句（停顿）需要“无新 chunk 的超时触发”：每次收到 chunk 都安排一个延迟任务
    if !is_final && pause_ms > 0 {
        let state_for_timer = state.clone();
        let tx_for_timer = tx.clone();
        let sess_id_for_timer = sess_id.clone();
        let utterance_index_for_timer = utterance_index;
        let last_ts = now_ms;
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(pause_ms)).await;
            // 若之后还有新 chunk 到来，则 last_chunk_at_ms 会更新，本次 timer 不触发
            if state_for_timer
                .audio_buffer
                .get_last_chunk_at_ms(&sess_id_for_timer)
                .await
                != Some(last_ts)
            {
                return;
            }
            // 超时触发：将当前缓冲区视为一个任务结束
            let _ = finalize_audio_utterance(
                &state_for_timer,
                &tx_for_timer,
                &sess_id_for_timer,
                utterance_index_for_timer,
                FinalizeReason::Pause,
            )
            .await;
        });
    }

    // 如果是最终块，创建 job
    if is_final {
        let _ = finalize_audio_utterance(state, tx, &sess_id, utterance_index, FinalizeReason::Send).await?;
    }

    Ok(())
}

/// 将指定 utterance_index 的音频缓冲区“封口”为一个任务（创建 job 并派发），并推进 session 的 utterance_index。
/// 返回 true 表示本次确实产生了任务；false 表示缓冲区为空（不产生任务）。
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

    // 获取累积的音频数据
    let Some(audio_data) = state.audio_buffer.take_combined(sess_id, utterance_index).await else {
        return Ok(false);
    };
    if audio_data.is_empty() {
        return Ok(false);
    }

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
    state
        .session_manager
        .update_session(sess_id, crate::session::SessionUpdate::IncrementUtteranceIndex)
        .await;

    // 为每个 Job 发送到节点
    for job in jobs {
        info!(
            trace_id = %job.trace_id,
            job_id = %job.job_id,
            node_id = ?job.assigned_node_id,
            tgt_lang = %job.tgt_lang,
            "Job 已创建（来自 audio_chunk）"
        );

        if let Some(ref node_id) = job.assigned_node_id {
            // Phase 1：任务级幂等。若该 job 已成功下发过，则不重复派发
            if let Some(existing) = state.dispatcher.get_job(&job.job_id).await {
                if existing.dispatched_to_node {
                    continue;
                }
            }

            if let Some(job_assign_msg) = create_job_assign_message(&job, None, None, None) {
                if state
                    .node_connections
                    .send(node_id, Message::Text(serde_json::to_string(&job_assign_msg)?))
                    .await
                {
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
                    warn!("无法发送 job 到节点 {}", node_id);
                    // 发送失败：释放 reserved 并发槽（幂等）
                    state.node_registry.release_job_slot(node_id, &job.job_id).await;
                    // 标记 job 为失败
                    state
                        .dispatcher
                        .update_job_status(&job.job_id, crate::dispatcher::JobStatus::Failed)
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


