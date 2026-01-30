use crate::core::AppState;
use crate::messages::SessionMessage;
use crate::websocket::send_message;
use axum::extract::ws::Message;
use tokio::sync::mpsc;
use tracing::{info, warn};

fn require_session_id(session_id: &Option<String>) -> anyhow::Result<&String> {
    session_id.as_ref().ok_or_else(|| anyhow::anyhow!("Session not initialized"))
}

pub(super) async fn handle_room_create(
    state: &AppState,
    tx: &mpsc::UnboundedSender<Message>,
    session_id: &Option<String>,
    display_name: Option<String>,
    preferred_lang: Option<String>,
) -> Result<(), anyhow::Error> {
    let sess_id = require_session_id(session_id)?;

    // 创建房间（创建者自动成为第一个成员）
    let (room_code, room_id) = state
        .room_manager
        .create_room(sess_id.clone(), display_name, preferred_lang)
        .await;

    // 获取成员列表（包含创建者）
    if let Some(members) = state.room_manager.get_room_members(&room_code).await {
        // 发送确认消�?
        let ack = SessionMessage::RoomCreateAck {
            room_code: room_code.clone(),
            room_id: Some(room_id),
        };
        send_message(tx, &ack).await?;

        // 发送成员列表给创建�?
        let members_msg = SessionMessage::RoomMembers {
            room_code: room_code.clone(),
            members: members.clone(),
        };
        send_message(tx, &members_msg).await?;

        info!(session_id = %sess_id, room_code = %room_code, "Room created, creator automatically joined");
    } else {
        // 这种情况不应该发生，但为了安全起见处理一�?
        let ack = SessionMessage::RoomCreateAck {
            room_code: room_code.clone(),
            room_id: Some(room_id),
        };
        send_message(tx, &ack).await?;
        warn!(session_id = %sess_id, room_code = %room_code, "Room created but failed to get member list");
    }

    Ok(())
}

pub(super) async fn handle_room_join(
    state: &AppState,
    tx: &mpsc::UnboundedSender<Message>,
    session_id: &Option<String>,
    room_code: String,
    display_name: Option<String>,
    preferred_lang: Option<String>,
) -> Result<(), anyhow::Error> {
    let sess_id = require_session_id(session_id)?;

    match state
        .room_manager
        .join_room(&room_code, sess_id.clone(), display_name, preferred_lang)
        .await
    {
        Ok(()) => {
            // Get updated member list
            if let Some(members) = state.room_manager.get_room_members(&room_code).await {
                // Send member list to joiner
                let members_msg = SessionMessage::RoomMembers {
                    room_code: room_code.clone(),
                    members: members.clone(),
                };
                send_message(tx, &members_msg).await?;

                // Broadcast member list update to other members in room
                for member in members {
                    if member.session_id != *sess_id {
                        if let Some(member_tx) = state.session_connections.get(&member.session_id).await {
                            let _ = send_message(&member_tx, &members_msg).await;
                        }
                    }
                }
            }

            info!(session_id = %sess_id, room_code = %room_code, "Member joined room");
        }
        Err(e) => {
            let error_code = match e {
                crate::managers::room_manager::RoomError::RoomNotFound => "ROOM_NOT_FOUND",
                crate::managers::room_manager::RoomError::AlreadyInRoom => "ALREADY_IN_ROOM",
            };
            let error_msg = SessionMessage::RoomError {
                code: error_code.to_string(),
                message: Some(e.to_string()),
            };
            send_message(tx, &error_msg).await?;
        }
    }

    Ok(())
}

pub(super) async fn handle_room_leave(
    state: &AppState,
    tx: &mpsc::UnboundedSender<Message>,
    session_id: &Option<String>,
    room_code: String,
) -> Result<(), anyhow::Error> {
    let sess_id = require_session_id(session_id)?;

    match state.room_manager.leave_room(&room_code, sess_id).await {
        Ok(is_empty) => {
            if !is_empty {
                // 房间未空，广播成员列表更�?
                if let Some(members) = state.room_manager.get_room_members(&room_code).await {
                    let members_msg = SessionMessage::RoomMembers {
                        room_code: room_code.clone(),
                        members: members.clone(),
                    };
                    // 向房间内所有成员广�?
                    for member in members {
                        if let Some(member_tx) = state.session_connections.get(&member.session_id).await {
                            let _ = send_message(&member_tx, &members_msg).await;
                        }
                    }
                }
            }
            info!(room_code = %room_code, "Member left room");
        }
        Err(e) => {
            let error_code = match e {
                crate::managers::room_manager::RoomError::RoomNotFound => "ROOM_NOT_FOUND",
                _ => "INTERNAL_ERROR",
            };
            let error_msg = SessionMessage::RoomError {
                code: error_code.to_string(),
                message: Some(e.to_string()),
            };
            send_message(tx, &error_msg).await?;
        }
    }

    Ok(())
}

pub(super) async fn handle_room_raw_voice_preference(
    state: &AppState,
    tx: &mpsc::UnboundedSender<Message>,
    session_id: &Option<String>,
    room_code: String,
    target_session_id: String,
    receive_raw_voice: bool,
) -> Result<(), anyhow::Error> {
    let sess_id = require_session_id(session_id)?;

    match state
        .room_manager
        .update_raw_voice_preference(&room_code, sess_id, &target_session_id, receive_raw_voice)
        .await
    {
        Ok(()) => {
            // 广播成员列表更新（包含更新后的偏好设置）
            if let Some(members) = state.room_manager.get_room_members(&room_code).await {
                let members_msg = SessionMessage::RoomMembers {
                    room_code: room_code.clone(),
                    members: members.clone(),
                };
                // 向房间内所有成员广�?
                for member in members {
                    if let Some(member_tx) = state.session_connections.get(&member.session_id).await {
                        let _ = send_message(&member_tx, &members_msg).await;
                    }
                }
            }
            info!(
                room_code = %room_code,
                session_id = %sess_id,
                target_session_id = %target_session_id,
                receive_raw_voice = receive_raw_voice,
                "Raw voice preference updated"
            );
        }
        Err(e) => {
            let error_code = match e {
                crate::managers::room_manager::RoomError::RoomNotFound => "ROOM_NOT_FOUND",
                _ => "INTERNAL_ERROR",
            };
            let error_msg = SessionMessage::RoomError {
                code: error_code.to_string(),
                message: Some(e.to_string()),
            };
            send_message(tx, &error_msg).await?;
        }
    }

    Ok(())
}


