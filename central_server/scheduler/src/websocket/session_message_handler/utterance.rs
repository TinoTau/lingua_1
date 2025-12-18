use crate::app_state::AppState;
use crate::messages::{ErrorCode, UiEventStatus, UiEventType};
use crate::websocket::{create_job_assign_message, send_error, send_ui_event};
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
        .ok_or_else(|| anyhow::anyhow!("会话不存在: {}", sess_id))?;

    // 使用 Utterance 中的 trace_id（如果提供），否则使用 Session 的 trace_id
    let trace_id = utterance_trace_id.unwrap_or_else(|| session.trace_id.clone());

    // 解码音频
    use base64::{engine::general_purpose, Engine as _};
    let audio_data = general_purpose::STANDARD
        .decode(&audio)
        .map_err(|e| anyhow::anyhow!("音频解码失败: {}", e))?;

    // 使用会话的默认 features（如果请求中没有指定）
    let final_features = features.or(session.default_features.clone());

    // 创建 job（从 session 获取流式 ASR 配置，默认启用）
    let enable_streaming_asr = Some(true); // 默认启用流式 ASR
    let partial_update_interval_ms = Some(1000u64); // 默认 1 秒更新间隔

    // 创建翻译任务（支持房间模式多语言）
    let jobs = create_translation_jobs(
        state,
        &sess_id,
        utterance_index,
        src_lang.clone(),
        tgt_lang.clone(),
        dialect.clone(),
        final_features.clone(),
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
    )
    .await?;

    // 为每个 Job 发送到节点
    for job in jobs {
        info!(
            trace_id = %trace_id,
            job_id = %job.job_id,
            node_id = ?job.assigned_node_id,
            tgt_lang = %job.tgt_lang,
            "Job 已创建"
        );

        // 如果节点已分配，发送 job 给节点
        if let Some(ref node_id) = job.assigned_node_id {
            // Phase 1：任务级幂等。若该 job 已成功下发过，则不重复派发
            if let Some(existing) = state.dispatcher.get_job(&job.job_id).await {
                if existing.dispatched_to_node {
                    continue;
                }
            }

            // 注意：当前实现中，JobAssign 时还没有 ASR 结果，所以 group_id、part_index、context_text 为 None
            if let Some(job_assign_msg) = create_job_assign_message(&job, None, None, None) {
                if state
                    .node_connections
                    .send(node_id, Message::Text(serde_json::to_string(&job_assign_msg)?))
                    .await
                {
                    state.dispatcher.mark_job_dispatched(&job.job_id).await;
                    // 推送 DISPATCHED 事件
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
                    warn!("无法发送 job 到节点 {}", node_id);
                    // 发送失败：释放 reserved 并发槽（幂等）
                    state.node_registry.release_job_slot(node_id, &job.job_id).await;
                    // 标记 job 为失败
                    state
                        .dispatcher
                        .update_job_status(&job.job_id, crate::dispatcher::JobStatus::Failed)
                        .await;
                    // 推送 ERROR 事件
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
            warn!("Job {} 没有可用的节点", job.job_id);
            send_error(tx, ErrorCode::NodeUnavailable, "没有可用的节点").await;
            // 推送 ERROR 事件
            send_ui_event(
                tx,
                &trace_id,
                &sess_id,
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

    Ok(())
}


