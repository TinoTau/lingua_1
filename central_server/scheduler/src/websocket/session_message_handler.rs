// 会话消息处理模块

use crate::app_state::AppState;
use crate::messages::{SessionMessage, ErrorCode, UiEventType, UiEventStatus};
use crate::session::SessionUpdate;
use crate::websocket::{send_message, send_error, create_job_assign_message, send_ui_event};
use crate::websocket::job_creator::create_translation_jobs;
use axum::extract::ws::Message;
use tokio::sync::mpsc;
use tracing::{info, warn};
use serde_json;

/// 处理会话消息
pub(crate) async fn handle_session_message(
    message: SessionMessage,
    state: &AppState,
    session_id: &mut Option<String>,
    tx: &mpsc::UnboundedSender<Message>,
) -> Result<(), anyhow::Error> {
    match message {
        SessionMessage::SessionInit {
            client_version,
            platform,
            src_lang,
            tgt_lang,
            dialect,
            features,
            pairing_code,
            tenant_id,
            mode,
            lang_a,
            lang_b,
            auto_langs,
            enable_streaming_asr: _,
            partial_update_interval_ms: _,
            trace_id,
        } => {
            // 处理配对码
            let paired_node_id = if let Some(code) = pairing_code {
                state.pairing_service.validate_pairing_code(&code).await
            } else {
                None
            };

            // 创建会话（传递 trace_id）
            let session = state.session_manager.create_session(
                client_version,
                platform,
                src_lang,
                tgt_lang,
                dialect.clone(),
                features.clone(),
                tenant_id,
                mode.clone(),
                lang_a.clone(),
                lang_b.clone(),
                auto_langs.clone(),
                trace_id,
            ).await;
    
            // 如果配对成功，更新会话
            if let Some(ref node_id) = paired_node_id {
                state.session_manager.update_session(
                    &session.session_id,
                    SessionUpdate::PairNode(node_id.clone()),
                ).await;
            }
            
            *session_id = Some(session.session_id.clone());
            
            // 注册连接
            state.session_connections.register(session.session_id.clone(), tx.clone()).await;
            
            // 初始化结果队列
            state.result_queue.initialize_session(session.session_id.clone()).await;
            
            // 发送确认消息（包含 trace_id）
            let ack = SessionMessage::SessionInitAck {
                session_id: session.session_id.clone(),
                assigned_node_id: paired_node_id,
                message: "session created".to_string(),
                trace_id: session.trace_id.clone(),
            };
            
            send_message(tx, &ack).await?;
            info!(trace_id = %session.trace_id, session_id = %session.session_id, "会话已创建");
        }
        
        SessionMessage::AudioChunk {
            session_id: sess_id,
            seq: _,
            is_final,
            payload,
        } => {
            // 验证会话
            let session = state.session_manager.get_session(&sess_id).await
                .ok_or_else(|| anyhow::anyhow!("会话不存在: {}", sess_id))?;
            
            // 获取当前 utterance_index
            let utterance_index = session.utterance_index;
            
            // 如果有 payload，解码并累积音频块
            if let Some(payload_str) = payload {
                use base64::{Engine as _, engine::general_purpose};
                if let Ok(audio_chunk) = general_purpose::STANDARD.decode(&payload_str) {
                    state.audio_buffer.add_chunk(&sess_id, utterance_index, audio_chunk).await;
                }
            }
            
            // 如果是最终块，创建 job
            if is_final {
                // 获取累积的音频数据
                if let Some(audio_data) = state.audio_buffer.take_combined(&sess_id, utterance_index).await {
                    // 使用会话的默认配置
                    let src_lang = session.src_lang.clone();
                    let tgt_lang = session.tgt_lang.clone();
                    let dialect = session.dialect.clone();
                    let final_features = session.default_features.clone();
                    
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
                        "pcm16".to_string(), // Web 客户端使用 PCM16
                        16000, // 16kHz
                        session.paired_node_id.clone(),
                        session.mode.clone(),
                        session.lang_a.clone(),
                        session.lang_b.clone(),
                        session.auto_langs.clone(),
                        enable_streaming_asr,
                        partial_update_interval_ms,
                        session.trace_id.clone(), // AudioChunk 使用 Session 的 trace_id
                    ).await?;
                    
                    // 增加 utterance_index
                    state.session_manager.update_session(&sess_id, crate::session::SessionUpdate::IncrementUtteranceIndex).await;
                    
                    // 为每个 Job 发送到节点
                    for job in jobs {
                        info!(trace_id = %job.trace_id, job_id = %job.job_id, node_id = ?job.assigned_node_id, tgt_lang = %job.tgt_lang, "Job 已创建（来自 audio_chunk）");
                        
                        // 如果节点已分配，发送 job 给节点
                        if let Some(ref node_id) = job.assigned_node_id {
                            // 注意：当前实现中，JobAssign 时还没有 ASR 结果，所以 group_id、part_index、context_text 为 None
                            // 后续优化：可以在 ASR Final 后重新发送 NMT 请求（包含上下文）
                            if let Some(job_assign_msg) = create_job_assign_message(&job, None, None, None) {
                                if state.node_connections.send(node_id, Message::Text(serde_json::to_string(&job_assign_msg)?)).await {
                                    // 推送 DISPATCHED 事件
                                    send_ui_event(
                                        tx,
                                        &job.trace_id,
                                        &sess_id,
                                        &job.job_id,
                                        utterance_index,
                                        UiEventType::Dispatched,
                                        None,
                                        UiEventStatus::Ok,
                                        None,
                                    ).await;
                                } else {
                                    warn!("无法发送 job 到节点 {}", node_id);
                                    // 标记 job 为失败
                                    state.dispatcher.update_job_status(&job.job_id, crate::dispatcher::JobStatus::Failed).await;
                                    // 推送 ERROR 事件
                                    send_ui_event(
                                        tx,
                                        &job.trace_id,
                                        &sess_id,
                                        &job.job_id,
                                        utterance_index,
                                        UiEventType::Error,
                                        None,
                                        UiEventStatus::Error,
                                        Some(ErrorCode::NodeUnavailable),
                                    ).await;
                                }
                            }
                        } else {
                            warn!("Job {} has no available nodes", job.job_id);
                            send_error(tx, ErrorCode::NodeUnavailable, "No available nodes").await;
                            // 推送 ERROR 事件
                            send_ui_event(
                                tx,
                                &job.trace_id,
                                &sess_id,
                                &job.job_id,
                                utterance_index,
                                UiEventType::Error,
                                None,
                                UiEventStatus::Error,
                                Some(ErrorCode::NoAvailableNode),
                            ).await;
                        }
                    }
                } else {
                    warn!("音频缓冲区为空，无法创建 job");
                }
            }
        }
        
        SessionMessage::Utterance {
            session_id: sess_id,
            utterance_index,
            manual_cut: _,
            src_lang,
            tgt_lang,
            dialect,
            features,
            audio,
            audio_format,
            sample_rate,
            mode: _,
            lang_a: _,
            lang_b: _,
            auto_langs: _,
            enable_streaming_asr: _,
            partial_update_interval_ms: _,
            trace_id: utterance_trace_id,
        } => {
            // 验证会话
            let session = state.session_manager.get_session(&sess_id).await
                .ok_or_else(|| anyhow::anyhow!("会话不存在: {}", sess_id))?;
            
            // 使用 Utterance 中的 trace_id（如果提供），否则使用 Session 的 trace_id
            let trace_id = utterance_trace_id.unwrap_or_else(|| session.trace_id.clone());
            
            // 解码音频
            use base64::{Engine as _, engine::general_purpose};
            let audio_data = general_purpose::STANDARD.decode(&audio)
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
            ).await?;
            
            // 为每个 Job 发送到节点
            for job in jobs {
                info!(trace_id = %trace_id, job_id = %job.job_id, node_id = ?job.assigned_node_id, tgt_lang = %job.tgt_lang, "Job 已创建");
                
                // 如果节点已分配，发送 job 给节点
                if let Some(ref node_id) = job.assigned_node_id {
                    // 注意：当前实现中，JobAssign 时还没有 ASR 结果，所以 group_id、part_index、context_text 为 None
                    // 后续优化：可以在 ASR Final 后重新发送 NMT 请求（包含上下文）
                    if let Some(job_assign_msg) = create_job_assign_message(&job, None, None, None) {
                        if state.node_connections.send(node_id, Message::Text(serde_json::to_string(&job_assign_msg)?)).await {
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
                            ).await;
                        } else {
                            warn!("无法发送 job 到节点 {}", node_id);
                            // 标记 job 为失败
                            state.dispatcher.update_job_status(&job.job_id, crate::dispatcher::JobStatus::Failed).await;
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
                            ).await;
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
                    ).await;
                }
            }
        }
        
        SessionMessage::ClientHeartbeat { session_id: sess_id, timestamp: _ } => {
            // 验证会话存在
            if state.session_manager.get_session(&sess_id).await.is_none() {
                send_error(tx, ErrorCode::InvalidSession, "会话不存在").await;
                return Ok(());
            }
            
            // 发送服务器心跳响应
            let heartbeat = SessionMessage::ServerHeartbeat {
                session_id: sess_id,
                timestamp: chrono::Utc::now().timestamp_millis(),
            };
            send_message(tx, &heartbeat).await?;
        }
        
        SessionMessage::TtsPlayEnded {
            session_id: sess_id,
            trace_id: _,
            group_id,
            ts_end_ms,
        } => {
            // 更新 Group 的 last_tts_end_at（Scheduler 权威时间）
            state.group_manager.on_tts_play_ended(&group_id, ts_end_ms).await;
            info!(session_id = %sess_id, group_id = %group_id, ts_end_ms = ts_end_ms, "TTS 播放结束，更新 Group last_tts_end_at");
        }
        
        SessionMessage::SessionClose { session_id: sess_id, reason } => {
            // 清理 Group（必须在清理会话之前）
            state.group_manager.on_session_end(&sess_id, &reason).await;
            
            // 如果会话在房间中，退出房间
            if let Some(room_code) = state.room_manager.find_room_by_session(&sess_id).await {
                let _ = state.room_manager.leave_room(&room_code, &sess_id).await;
                // 广播成员列表更新
                if let Some(members) = state.room_manager.get_room_members(&room_code).await {
                    let members_msg = SessionMessage::RoomMembers {
                        room_code: room_code.clone(),
                        members: members.clone(),
                    };
                    // 向房间内所有成员广播
                    for member in members {
                        if member.session_id != sess_id {
                            if let Some(member_tx) = state.session_connections.get(&member.session_id).await {
                                let _ = send_message(&member_tx, &members_msg).await;
                            }
                        }
                    }
                }
            }
            
            // 清理会话
            state.session_connections.unregister(&sess_id).await;
            state.result_queue.remove_session(&sess_id).await;
            state.session_manager.remove_session(&sess_id).await;
            
            // 发送确认
            let ack = SessionMessage::SessionCloseAck {
                session_id: sess_id.clone(),
            };
            send_message(tx, &ack).await?;
            info!("会话 {} 已关闭", sess_id);
        }
        
        // ===== 房间相关消息处理 =====
        SessionMessage::RoomCreate { client_ts: _, display_name, preferred_lang } => {
            // 验证会话已创建
            let sess_id = session_id.as_ref()
                .ok_or_else(|| anyhow::anyhow!("会话未初始化"))?;
            
            // 创建房间（创建者自动成为第一个成员）
            let (room_code, room_id) = state.room_manager.create_room(
                sess_id.clone(),
                display_name,
                preferred_lang,
            ).await;
            
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
        }
        
        SessionMessage::RoomJoin { room_code, display_name, preferred_lang } => {
            // 验证会话已创建
            let sess_id = session_id.as_ref()
                .ok_or_else(|| anyhow::anyhow!("会话未初始化"))?;
            
            // 加入房间
            match state.room_manager.join_room(&room_code, sess_id.clone(), display_name, preferred_lang).await {
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
        }
        
        SessionMessage::RoomLeave { room_code } => {
            // 验证会话已创建
            let sess_id = session_id.as_ref()
                .ok_or_else(|| anyhow::anyhow!("会话未初始化"))?;
            
            // 退出房间
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
                    // 如果房间为空，已经在 leave_room 中清理
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
        }
        
        SessionMessage::RoomRawVoicePreference { room_code, target_session_id, receive_raw_voice } => {
            // 验证会话已创建
            let sess_id = session_id.as_ref()
                .ok_or_else(|| anyhow::anyhow!("会话未初始化"))?;
            
            // 更新原声传递偏好
            match state.room_manager.update_raw_voice_preference(
                &room_code,
                sess_id,
                &target_session_id,
                receive_raw_voice,
            ).await {
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
                    info!(room_code = %room_code, session_id = %sess_id, target_session_id = %target_session_id, receive_raw_voice = receive_raw_voice, "原声传递偏好已更新");
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
        }
        
        // ===== WebRTC 信令消息处理 =====
        SessionMessage::WebRTCOffer { room_code, to, sdp } => {
            // 验证会话已创建
            let sess_id = session_id.as_ref()
                .ok_or_else(|| anyhow::anyhow!("会话未初始化"))?;
            
            // 检查接收者是否愿意接收发送者的原声
            let should_forward = state.room_manager.should_receive_raw_voice(
                &room_code,
                &to, // 接收者
                sess_id, // 发送者
            ).await;
            
            if !should_forward {
                // 接收者屏蔽了发送者的原声，不转发信令
                info!(room_code = %room_code, from = %sess_id, to = %to, "WebRTC Offer 被阻止：接收者屏蔽了发送者的原声");
                return Ok(());
            }
            
            // 转发 offer 给目标成员
            if let Some(target_tx) = state.session_connections.get(&to).await {
                let offer_msg = SessionMessage::WebRTCOffer {
                    room_code: room_code.clone(),
                    to: sess_id.clone(), // 反转方向：to 变成 from
                    sdp: sdp.clone(),
                };
                send_message(&target_tx, &offer_msg).await?;
                info!(room_code = %room_code, from = %sess_id, to = %to, "WebRTC Offer 已转发");
            } else {
                warn!(room_code = %room_code, to = %to, "WebRTC Offer 转发失败：目标成员不在线");
            }
        }
        
        SessionMessage::WebRTCAnswer { room_code, to, sdp } => {
            // 验证会话已创建
            let sess_id = session_id.as_ref()
                .ok_or_else(|| anyhow::anyhow!("会话未初始化"))?;
            
            // 检查接收者是否愿意接收发送者的原声
            let should_forward = state.room_manager.should_receive_raw_voice(
                &room_code,
                &to, // 接收者
                sess_id, // 发送者
            ).await;
            
            if !should_forward {
                // 接收者屏蔽了发送者的原声，不转发信令
                info!(room_code = %room_code, from = %sess_id, to = %to, "WebRTC Answer 被阻止：接收者屏蔽了发送者的原声");
                return Ok(());
            }
            
            // 转发 answer 给目标成员
            if let Some(target_tx) = state.session_connections.get(&to).await {
                let answer_msg = SessionMessage::WebRTCAnswer {
                    room_code: room_code.clone(),
                    to: sess_id.clone(), // 反转方向：to 变成 from
                    sdp: sdp.clone(),
                };
                send_message(&target_tx, &answer_msg).await?;
                info!(room_code = %room_code, from = %sess_id, to = %to, "WebRTC Answer 已转发");
            } else {
                warn!(room_code = %room_code, to = %to, "WebRTC Answer 转发失败：目标成员不在线");
            }
        }
        
        SessionMessage::WebRTCIce { room_code, to, candidate } => {
            // 验证会话已创建
            let sess_id = session_id.as_ref()
                .ok_or_else(|| anyhow::anyhow!("会话未初始化"))?;
            
            // 检查接收者是否愿意接收发送者的原声
            let should_forward = state.room_manager.should_receive_raw_voice(
                &room_code,
                &to, // 接收者
                sess_id, // 发送者
            ).await;
            
            if !should_forward {
                // 接收者屏蔽了发送者的原声，不转发信令
                // ICE candidate 消息较多，不记录日志以避免日志过多
                return Ok(());
            }
            
            // 转发 ICE candidate 给目标成员
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
        }
        
        _ => {
            warn!("收到未处理的会话消息类型");
        }
    }
    
    Ok(())
}

