// WebSocket 处理模块
// 包含会话端和节点端的 WebSocket 处理逻辑

pub mod session_handler;
pub mod node_handler;
pub mod job_creator;
pub mod session_message_handler;

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

// 辅助函数：发送节点消息
pub(crate) async fn send_node_message(tx: &mpsc::UnboundedSender<Message>, message: &NodeMessage) -> Result<(), anyhow::Error> {
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

// 创建 JobAssign 消息
pub(crate) fn create_job_assign_message(
    job: &crate::dispatcher::Job,
    group_id: Option<String>,
    part_index: Option<u64>,
    context_text: Option<String>,
) -> Option<NodeMessage> {
    use base64::{Engine as _, engine::general_purpose};
    let audio_base64 = general_purpose::STANDARD.encode(&job.audio_data);
    
    Some(NodeMessage::JobAssign {
        group_id,
        part_index,
        context_text,
        job_id: job.job_id.clone(),
        session_id: job.session_id.clone(),
        utterance_index: job.utterance_index,
        src_lang: job.src_lang.clone(),
        tgt_lang: job.tgt_lang.clone(),
        dialect: job.dialect.clone(),
        features: job.features.clone(),
        pipeline: job.pipeline.clone(),
        audio: audio_base64,
        audio_format: job.audio_format.clone(),
        sample_rate: job.sample_rate,
        mode: job.mode.clone(),
        lang_a: job.lang_a.clone(),
        lang_b: job.lang_b.clone(),
        auto_langs: job.auto_langs.clone(),
        enable_streaming_asr: job.enable_streaming_asr,
        partial_update_interval_ms: job.partial_update_interval_ms,
        trace_id: job.trace_id.clone(),
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

