use crate::app_state::AppState;
use crate::messages::{SessionMessage, NodeMessage, ErrorCode};
use crate::session::SessionUpdate;
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

// 节点端 WebSocket 处理
pub async fn handle_node(socket: WebSocket, state: AppState) {
    info!("新的节点 WebSocket 连接");
    
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
    
    let mut node_id: Option<String> = None;
    
    // 接收消息循环
    while let Some(msg) = receiver.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                debug!("收到节点消息: {}", text);
                
                match serde_json::from_str::<NodeMessage>(&text) {
                    Ok(message) => {
                        match handle_node_message(message, &state, &mut node_id, &tx).await {
                            Ok(()) => {}
                            Err(e) => {
                                error!("处理节点消息失败: {}", e);
                            }
                        }
                    }
                    Err(e) => {
                        warn!("解析节点消息失败: {}", e);
                    }
                }
            }
            Ok(Message::Close(_)) => {
                info!("节点 WebSocket 连接关闭");
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
    if let Some(ref nid) = node_id {
        state.node_connections.unregister(nid).await;
        state.node_registry.mark_node_offline(nid).await;
        info!("节点 {} 已清理", nid);
    }
    
    send_task.abort();
}

// 处理节点消息
async fn handle_node_message(
    message: NodeMessage,
    state: &AppState,
    node_id: &mut Option<String>,
    tx: &mpsc::UnboundedSender<Message>,
) -> Result<(), anyhow::Error> {
    match message {
        NodeMessage::NodeRegister {
            node_id: provided_node_id,
            version,
            platform,
            hardware,
            installed_models,
            features_supported,
            accept_public_jobs,
        } => {
            // 注册节点
            let node = state.node_registry.register_node(
                provided_node_id,
                format!("Node-{}", uuid::Uuid::new_v4().to_string()[..8].to_uppercase()),
                version,
                platform,
                hardware,
                installed_models,
                features_supported,
                accept_public_jobs,
            ).await;
            
            *node_id = Some(node.node_id.clone());
            
            // 注册连接
            state.node_connections.register(node.node_id.clone(), tx.clone()).await;
            
            // 发送确认消息
            let ack = NodeMessage::NodeRegisterAck {
                node_id: node.node_id.clone(),
                message: "registered".to_string(),
            };
            
            send_node_message(tx, &ack).await?;
            info!("节点 {} 已注册", node.node_id);
        }
        
        NodeMessage::NodeHeartbeat {
            node_id: nid,
            timestamp: _,
            resource_usage,
            installed_models,
        } => {
            // 更新节点心跳
            state.node_registry.update_node_heartbeat(
                &nid,
                resource_usage.cpu_percent,
                resource_usage.gpu_percent,
                resource_usage.mem_percent,
                installed_models,
                resource_usage.running_jobs,
            ).await;
        }
        
        NodeMessage::JobResult {
            job_id,
            node_id: nid,
            session_id,
            utterance_index,
            success,
            text_asr,
            text_translated,
            tts_audio,
            tts_format,
            extra,
            processing_time_ms: _,
            error: job_error,
        } => {
            // 更新 job 状态
            if success {
                state.dispatcher.update_job_status(&job_id, crate::dispatcher::JobStatus::Completed).await;
            } else {
                state.dispatcher.update_job_status(&job_id, crate::dispatcher::JobStatus::Failed).await;
            }
            
            if success {
                // 创建翻译结果消息
                let result = SessionMessage::TranslationResult {
                    session_id: session_id.clone(),
                    utterance_index,
                    job_id,
                    text_asr: text_asr.unwrap_or_default(),
                    text_translated: text_translated.unwrap_or_default(),
                    tts_audio: tts_audio.unwrap_or_default(),
                    tts_format: tts_format.unwrap_or("pcm16".to_string()),
                    extra,
                };
                
                // 添加到结果队列
                state.result_queue.add_result(&session_id, utterance_index, result).await;
                
                // 尝试发送就绪的结果
                let ready_results = state.result_queue.get_ready_results(&session_id).await;
                for result in ready_results {
                    let result_json = serde_json::to_string(&result)?;
                    if !state.session_connections.send(
                        &session_id,
                        Message::Text(result_json)
                    ).await {
                        warn!("无法发送结果到会话 {}", session_id);
                    }
                }
            } else {
                // 发送错误给客户端
                if let Some(err) = job_error {
                    let error_msg = SessionMessage::Error {
                        code: err.code,
                        message: err.message,
                        details: err.details,
                    };
                    let error_json = serde_json::to_string(&error_msg)?;
                    state.session_connections.send(
                        &session_id,
                        Message::Text(error_json)
                    ).await;
                }
            }
        }
        
        NodeMessage::NodeError { node_id: nid, code, message, details: _ } => {
            error!("节点 {} 报告错误: {} - {}", nid, code, message);
            // 可以在这里处理节点错误，例如标记节点为离线
        }
        
        _ => {
            warn!("收到未处理的节点消息类型");
        }
    }
    
    Ok(())
}

// 辅助函数：发送消息
async fn send_message(tx: &mpsc::UnboundedSender<Message>, message: &SessionMessage) -> Result<(), anyhow::Error> {
    let json = serde_json::to_string(message)?;
    tx.send(Message::Text(json))
        .map_err(|e| anyhow::anyhow!("发送消息失败: {}", e))?;
    Ok(())
}

// 辅助函数：发送节点消息
async fn send_node_message(tx: &mpsc::UnboundedSender<Message>, message: &NodeMessage) -> Result<(), anyhow::Error> {
    let json = serde_json::to_string(message)?;
    tx.send(Message::Text(json))
        .map_err(|e| anyhow::anyhow!("发送消息失败: {}", e))?;
    Ok(())
}

// 辅助函数：发送错误消息
async fn send_error(tx: &mpsc::UnboundedSender<Message>, code: ErrorCode, message: &str) {
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
fn create_job_assign_message(job: &crate::dispatcher::Job) -> Option<NodeMessage> {
    use base64::{Engine as _, engine::general_purpose};
    let audio_base64 = general_purpose::STANDARD.encode(&job.audio_data);
    
    Some(NodeMessage::JobAssign {
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
    })
}
