use crate::core::AppState;
use crate::messages::SessionMessage;
use crate::websocket::send_message;
use tracing::{info, warn};

fn require_session_id(session_id: &Option<String>) -> anyhow::Result<&String> {
    session_id.as_ref().ok_or_else(|| anyhow::anyhow!("Session not initialized"))
}

pub(super) async fn handle_webrtc_offer(
    state: &AppState,
    session_id: &Option<String>,
    room_code: String,
    to: String,
    sdp: serde_json::Value,
) -> Result<(), anyhow::Error> {
    let sess_id = require_session_id(session_id)?;

    // Check if receiver is willing to receive sender's raw voice
    let should_forward = state
        .room_manager
        .should_receive_raw_voice(&room_code, &to, sess_id)
        .await;

    if !should_forward {
        info!(room_code = %room_code, from = %sess_id, to = %to, "WebRTC Offer blocked: receiver muted sender's raw voice");
        return Ok(());
    }

    // Forward offer to target member
    if let Some(target_tx) = state.session_connections.get(&to).await {
        let offer_msg = SessionMessage::WebRTCOffer {
            room_code: room_code.clone(),
            to: sess_id.clone(), // Reverse direction: to becomes from
            sdp: sdp.clone(),
        };
        send_message(&target_tx, &offer_msg).await?;
        info!(room_code = %room_code, from = %sess_id, to = %to, "WebRTC Offer forwarded");
    } else {
        warn!(room_code = %room_code, to = %to, "WebRTC Offer forward failed: target member offline");
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

    // Check if receiver is willing to receive sender's raw voice
    let should_forward = state
        .room_manager
        .should_receive_raw_voice(&room_code, &to, sess_id)
        .await;

    if !should_forward {
        info!(room_code = %room_code, from = %sess_id, to = %to, "WebRTC Answer blocked: receiver muted sender's raw voice");
        return Ok(());
    }

    // Forward answer to target member
    if let Some(target_tx) = state.session_connections.get(&to).await {
        let answer_msg = SessionMessage::WebRTCAnswer {
            room_code: room_code.clone(),
            to: sess_id.clone(), // Reverse direction: to becomes from
            sdp: sdp.clone(),
        };
        send_message(&target_tx, &answer_msg).await?;
        info!(room_code = %room_code, from = %sess_id, to = %to, "WebRTC Answer forwarded");
    } else {
        warn!(room_code = %room_code, to = %to, "WebRTC Answer forward failed: target member offline");
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

    // Check if receiver is willing to receive sender's raw voice
    let should_forward = state
        .room_manager
        .should_receive_raw_voice(&room_code, &to, sess_id)
        .await;

    if !should_forward {
        // ICE candidate messages are frequent, don't log to avoid log spam
        return Ok(());
    }

    // Forward ICE candidate to target member
    if let Some(target_tx) = state.session_connections.get(&to).await {
        let ice_msg = SessionMessage::WebRTCIce {
            room_code: room_code.clone(),
            to: sess_id.clone(), // Reverse direction: to becomes from
            candidate: candidate.clone(),
        };
        send_message(&target_tx, &ice_msg).await?;
    } else {
        warn!(room_code = %room_code, to = %to, "WebRTC ICE forward failed: target member offline");
    }

    Ok(())
}
