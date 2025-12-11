// 节点端 WebSocket 处理

use crate::app_state::AppState;
use crate::messages::{NodeMessage, SessionMessage};
use crate::websocket::send_node_message;
use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tracing::{info, error, warn, debug};
use serde_json;

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
            node_id: _nid,
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

