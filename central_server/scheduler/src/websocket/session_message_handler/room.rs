use crate::app_state::AppState;
use crate::messages::SessionMessage;
use crate::websocket::send_message;
use axum::extract::ws::Message;
use tokio::sync::mpsc;
use tracing::{info, warn};

fn require_session_id(session_id: &Option<String>) -> anyhow::Result<&String> {
    session_id.as_ref().ok_or_else(|| anyhow::anyhow!("会话未初始化"))
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
        // 发送确认消息
        let ack = SessionMessage::RoomCreateAck {
            room_code: room_code.clone(),
            room_id: Some(room_id),
        };
        send_message(tx, &ack).await?;

        // 发送成员列表给创建者
        let members_msg = SessionMessage::RoomMembers {
            room_code: room_code.clone(),
            members: members.clone(),
        };
        send_message(tx, &members_msg).await?;

        info!(session_id = %sess_id, room_code = %room_code, "房间已创建，创建者已自动加入");
    } else {
        // 这种情况不应该发生，但为了安全起见处理一下
        let ack = SessionMessage::RoomCreateAck {
            room_code: room_code.clone(),
            room_id: Some(room_id),
        };
        send_message(tx, &ack).await?;
        warn!(session_id = %sess_id, room_code = %room_code, "房间已创建，但无法获取成员列表");
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
            // 获取更新后的成员列表
            if let Some(members) = state.room_manager.get_room_members(&room_code).await {
                // 向加入者发送成员列表
                let members_msg = SessionMessage::RoomMembers {
                    room_code: room_code.clone(),
                    members: members.clone(),
                };
                send_message(tx, &members_msg).await?;

                // 向房间内其他成员广播成员列表更新
                for member in members {
                    if member.session_id != *sess_id {
                        if let Some(member_tx) = state.session_connections.get(&member.session_id).await {
                            let _ = send_message(&member_tx, &members_msg).await;
                        }
                    }
                }
            }

            info!(session_id = %sess_id, room_code = %room_code, "成员已加入房间");
        }
        Err(e) => {
            let error_code = match e {
                crate::room_manager::RoomError::RoomNotFound => "ROOM_NOT_FOUND",
                crate::room_manager::RoomError::AlreadyInRoom => "ALREADY_IN_ROOM",
                crate::room_manager::RoomError::InvalidRoomCode => "INVALID_ROOM_CODE",
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
                // 房间未空，广播成员列表更新
                if let Some(members) = state.room_manager.get_room_members(&room_code).await {
                    let members_msg = SessionMessage::RoomMembers {
                        room_code: room_code.clone(),
                        members: members.clone(),
                    };
                    // 向房间内所有成员广播
                    for member in members {
                        if let Some(member_tx) = state.session_connections.get(&member.session_id).await {
                            let _ = send_message(&member_tx, &members_msg).await;
                        }
                    }
                }
            }
            info!(room_code = %room_code, "成员已退出房间");
        }
        Err(e) => {
            let error_code = match e {
                crate::room_manager::RoomError::RoomNotFound => "ROOM_NOT_FOUND",
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
                // 向房间内所有成员广播
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
                "原声传递偏好已更新"
            );
        }
        Err(e) => {
            let error_code = match e {
                crate::room_manager::RoomError::RoomNotFound => "ROOM_NOT_FOUND",
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


