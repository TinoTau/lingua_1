// WebSocket 处理模块
// 包含会话端和节点端的 WebSocket 处理逻辑

pub mod session_handler;
pub mod node_handler;
pub mod job_creator;
pub mod session_message_handler;
pub mod session_actor;

pub use session_handler::handle_session;
pub use node_handler::handle_node;

// 公共辅助函数
use crate::messages::{SessionMessage, NodeMessage, ErrorCode};
use axum::extract::ws::Message;
use tokio::sync::mpsc;
use tracing::error;
use serde_json;

// 辅助函数：发送会话消息
pub(crate) async fn send_message(tx: &mpsc::UnboundedSender<Message>, message: &SessionMessage) -> Result<(), anyhow::Error> {
    let json = serde_json::to_string(message)?;
    tx.send(Message::Text(json))
        .map_err(|e| anyhow::anyhow!("发送消息失败: {}", e))?;
    Ok(())
}


// 辅助函数：发送错误消息
pub(crate) async fn send_error(tx: &mpsc::UnboundedSender<Message>, code: ErrorCode, message: &str) {
    let error_msg = SessionMessage::Error {
        code: code.to_string(),
        message: message.to_string(),
        details: None,
    };
    if let Err(e) = send_message(tx, &error_msg).await {
        error!("发送错误消息失败: {}", e);
    }
}

// 创建 JobAssign 消息（与备份一致：使用 Job 内 audio_base64，不依赖 buffer）
pub(crate) async fn create_job_assign_message(
    _state: &crate::core::AppState,
    job: &crate::core::dispatcher::Job,
    group_id: Option<String>,
    part_index: Option<u64>,
    context_text: Option<String>,
) -> Option<NodeMessage> {
    if job.audio_base64.is_empty() {
        tracing::warn!(
            job_id = %job.job_id,
            session_id = %job.session_id,
            utterance_index = job.utterance_index,
            "Job 无音频数据，跳过 JobAssign"
        );
        return None;
    }
    tracing::info!(
        job_id = %job.job_id,
        session_id = %job.session_id,
        utterance_index = job.utterance_index,
        node_id = ?job.assigned_node_id,
        audio_base64_len = job.audio_base64.len(),
        "【JobAssign】已构建，即将发往节点"
    );
    Some(NodeMessage::JobAssign {
        group_id,
        part_index,
        context_text,
        job_id: job.job_id.clone(),
        attempt_id: job.dispatch_attempt_id.max(1),
        session_id: job.session_id.clone(),
        utterance_index: job.utterance_index,
        src_lang: job.src_lang.clone(),
        tgt_lang: job.tgt_lang.clone(),
        dialect: job.dialect.clone(),
        features: job.features.clone(),
        pipeline: job.pipeline.clone(),
        audio: job.audio_base64.clone(),
        audio_format: job.audio_format.clone(),
        sample_rate: job.sample_rate,
        mode: job.mode.clone(),
        lang_a: job.lang_a.clone(),
        lang_b: job.lang_b.clone(),
        auto_langs: job.auto_langs.clone(),
        enable_streaming_asr: job.enable_streaming_asr,
        partial_update_interval_ms: job.partial_update_interval_ms,
        trace_id: job.trace_id.clone(),
        padding_ms: job.padding_ms, // EDGE-4: Padding 配置
        is_manual_cut: job.is_manual_cut,
        is_timeout_triggered: job.is_timeout_triggered,
        is_max_duration_triggered: job.is_max_duration_triggered,
        turn_id: job.turn_id.clone(),
    })
}

// 发送 UI 事件消息
pub(crate) async fn send_ui_event(
    tx: &mpsc::UnboundedSender<Message>,
    trace_id: &str,
    session_id: &str,
    job_id: &str,
    utterance_index: u64,
    event: crate::messages::UiEventType,
    elapsed_ms: Option<u64>,
    status: crate::messages::UiEventStatus,
    error_code: Option<crate::messages::ErrorCode>,
) {
    let hint = error_code.as_ref().map(|code| crate::messages::get_error_hint(code).to_string());
    
    let ui_event = SessionMessage::UiEvent {
        trace_id: trace_id.to_string(),
        session_id: session_id.to_string(),
        job_id: job_id.to_string(),
        utterance_index,
        event,
        elapsed_ms,
        status,
        error_code: error_code.clone(),
        hint,
    };
    
    if let Err(e) = send_message(tx, &ui_event).await {
        error!("发送 UI 事件失败: {}", e);
    }
}
