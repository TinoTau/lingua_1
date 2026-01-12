use crate::core::AppState;
use crate::messages::SessionMessage;
use crate::websocket::send_message;
use tracing::{info, warn};

fn require_session_id(session_id: &Option<String>) -> anyhow::Result<&String> {
    session_id.as_ref().ok_or_else(|| anyhow::anyhow!("会话未初始化"))
}

pub(super) async fn handle_webrtc_offer(
    state: &AppState,
    session_id: &Option<String>,
    room_code: String,
    to: String,
    sdp: serde_json::Value,
) -> Result<(), anyhow::Error> {
    let sess_id = require_session_id(session_id)?;

    // 检查接收者是否愿意接收发送者的原声
    let should_forward = state
        .room_manager
        .should_receive_raw_voice(&room_code, &to, sess_id)
        .await;

    if !should_forward {
        info!(room_code = %room_code, from = %sess_id, to = %to, "WebRTC Offer 被阻止：接收者屏蔽了发送者的原声");
        return Ok(());
    }

    // 转发 offer 给目标成�?
    if let Some(target_tx) = state.session_connections.get(&to).await {
        let offer_msg = SessionMessage::WebRTCOffer {
            room_code: room_code.clone(),
            to: sess_id.clone(), // 反转方向：to 变成 from
            sdp: sdp.clone(),
        };
        send_message(&target_tx, &offer_msg).await?;
        info!(room_code = %room_code, from = %sess_id, to = %to, "WebRTC Offer 已转�?);
    } else {
        warn!(room_code = %room_code, to = %to, "WebRTC Offer 转发失败：目标成员不在线");
    }
    Ok(())
}

pub(super) async fn handle_webrtc_answer(
    state: &AppState,
    session_id: &Option<String>,
    room_code: String,
    to: String,
    sdp: serde_json::Value,
) -> Result<(), anyhow::Error> {
    let sess_id = require_session_id(session_id)?;

    // 检查接收者是否愿意接收发送者的原声
    let should_forward = state
        .room_manager
        .should_receive_raw_voice(&room_code, &to, sess_id)
        .await;

    if !should_forward {
        info!(room_code = %room_code, from = %sess_id, to = %to, "WebRTC Answer 被阻止：接收者屏蔽了发送者的原声");
        return Ok(());
    }

    // 转发 answer 给目标成�?
    if let Some(target_tx) = state.session_connections.get(&to).await {
        let answer_msg = SessionMessage::WebRTCAnswer {
            room_code: room_code.clone(),
            to: sess_id.clone(), // 反转方向：to 变成 from
            sdp: sdp.clone(),
        };
        send_message(&target_tx, &answer_msg).await?;
        info!(room_code = %room_code, from = %sess_id, to = %to, "WebRTC Answer 已转�?);
    } else {
        warn!(room_code = %room_code, to = %to, "WebRTC Answer 转发失败：目标成员不在线");
    }
    Ok(())
}

pub(super) async fn handle_webrtc_ice(
    state: &AppState,
    session_id: &Option<String>,
    room_code: String,
    to: String,
    candidate: serde_json::Value,
) -> Result<(), anyhow::Error> {
    let sess_id = require_session_id(session_id)?;

    // 检查接收者是否愿意接收发送者的原声
    let should_forward = state
        .room_manager
        .should_receive_raw_voice(&room_code, &to, sess_id)
        .await;

    if !should_forward {
        // ICE candidate 消息较多，不记录日志以避免日志过�?
        return Ok(());
    }

    // 转发 ICE candidate 给目标成�?
    if let Some(target_tx) = state.session_connections.get(&to).await {
        let ice_msg = SessionMessage::WebRTCIce {
            room_code: room_code.clone(),
            to: sess_id.clone(), // 反转方向：to 变成 from
            candidate: candidate.clone(),
        };
        send_message(&target_tx, &ice_msg).await?;
    } else {
        warn!(room_code = %room_code, to = %to, "WebRTC ICE 转发失败：目标成员不在线");
    }

    Ok(())
}


