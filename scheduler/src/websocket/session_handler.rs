// 会话端 WebSocket 处理

use crate::app_state::AppState;
use crate::messages::{SessionMessage, ErrorCode};
use crate::session::SessionUpdate;
use crate::websocket::{send_message, send_error, create_job_assign_message};
use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tracing::{info, error, warn, debug};
use serde_json;

// 会话端 WebSocket 处理
pub async fn handle_session(socket: WebSocket, state: AppState) {
    info!("新的会话 WebSocket 连接");
    
    let (mut sender, mut receiver) = socket.split();
    
    // 创建消息通道
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
    
    // 启动发送任务
    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if sender.send(msg).await.is_err() {
                break;
            }
        }
    });
    
    let mut session_id: Option<String> = None;
    
    // 接收消息循环
    while let Some(msg) = receiver.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                debug!("收到会话消息: {}", text);
                
                match serde_json::from_str::<SessionMessage>(&text) {
                    Ok(message) => {
                        match handle_session_message(message, &state, &mut session_id, &tx).await {
                            Ok(()) => {}
                            Err(e) => {
                                error!("处理会话消息失败: {}", e);
                                send_error(&tx, ErrorCode::InternalError, &format!("处理消息失败: {}", e)).await;
                            }
                        }
                    }
                    Err(e) => {
                        warn!("解析会话消息失败: {}", e);
                        send_error(&tx, ErrorCode::InvalidMessage, &format!("无效的消息格式: {}", e)).await;
                    }
                }
            }
            Ok(Message::Close(_)) => {
                info!("会话 WebSocket 连接关闭");
                break;
            }
            Err(e) => {
                error!("WebSocket 错误: {}", e);
                break;
            }
            _ => {}
        }
    }
    
    // 清理
    if let Some(ref sess_id) = session_id {
        state.session_connections.unregister(sess_id).await;
        state.result_queue.remove_session(sess_id).await;
        state.session_manager.remove_session(sess_id).await;
        info!("会话 {} 已清理", sess_id);
    }
    
    send_task.abort();
}

// 处理会话消息
async fn handle_session_message(
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
               } => {
                   // 处理配对码
                   let paired_node_id = if let Some(code) = pairing_code {
                       state.pairing_service.validate_pairing_code(&code).await
                   } else {
                       None
                   };

                   // 创建会话
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
            
            // 发送确认消息
            let ack = SessionMessage::SessionInitAck {
                session_id: session.session_id.clone(),
                assigned_node_id: paired_node_id,
                message: "session created".to_string(),
            };
            
            send_message(tx, &ack).await?;
            info!("会话 {} 已创建", session.session_id);
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
        } => {
            // 验证会话
            let session = state.session_manager.get_session(&sess_id).await
                .ok_or_else(|| anyhow::anyhow!("会话不存在: {}", sess_id))?;
            
            // 解码音频
            use base64::{Engine as _, engine::general_purpose};
            let audio_data = general_purpose::STANDARD.decode(&audio)
                .map_err(|e| anyhow::anyhow!("音频解码失败: {}", e))?;
            
            // 使用会话的默认 features（如果请求中没有指定）
            let final_features = features.or(session.default_features.clone());
            
            // 创建 job
            let job = state.dispatcher.create_job(
                sess_id.clone(),
                utterance_index,
                src_lang.clone(),
                tgt_lang.clone(),
                dialect.clone(),
                final_features.clone(),
                crate::messages::PipelineConfig {
                    use_asr: true,
                    use_nmt: true,
                    use_tts: true,
                },
                audio_data,
                audio_format,
                sample_rate,
                session.paired_node_id.clone(),
            ).await;
            
            info!("Job {} 已创建，分配给节点: {:?}", job.job_id, job.assigned_node_id);
            
            // 如果节点已分配，发送 job 给节点
            if let Some(ref node_id) = job.assigned_node_id {
                if let Some(job_assign_msg) = create_job_assign_message(&job) {
                    if !state.node_connections.send(node_id, Message::Text(serde_json::to_string(&job_assign_msg)?)).await {
                        warn!("无法发送 job 到节点 {}", node_id);
                        // 标记 job 为失败
                        state.dispatcher.update_job_status(&job.job_id, crate::dispatcher::JobStatus::Failed).await;
                    }
                }
            } else {
                warn!("Job {} 没有可用的节点", job.job_id);
                send_error(tx, ErrorCode::NodeUnavailable, "没有可用的节点").await;
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
        
        SessionMessage::SessionClose { session_id: sess_id, reason: _ } => {
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
        
        _ => {
            warn!("收到未处理的会话消息类型");
        }
    }
    
    Ok(())
}

