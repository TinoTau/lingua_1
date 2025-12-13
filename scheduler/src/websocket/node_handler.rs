// 节点端 WebSocket 处理

use crate::app_state::AppState;
use crate::messages::{NodeMessage, SessionMessage, UiEventType, UiEventStatus, ErrorCode};
use crate::websocket::send_node_message;
use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tracing::{info, error, warn, debug};
use serde_json;
use chrono;

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
            capability_state,
        } => {
            // 注册节点（要求必须有 GPU）
            match state.node_registry.register_node(
                provided_node_id,
                format!("Node-{}", uuid::Uuid::new_v4().to_string()[..8].to_uppercase()),
                version,
                platform,
                hardware,
                installed_models,
                features_supported,
                accept_public_jobs,
                capability_state,
            ).await {
                Ok(node) => {
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
                Err(err) => {
                    // 注册失败（没有 GPU），发送错误消息
                    let error_msg = NodeMessage::Error {
                        code: crate::messages::ErrorCode::NoGpuAvailable.to_string(),
                        message: err.clone(),
                        details: None,
                    };
                    send_node_message(tx, &error_msg).await?;
                    warn!("节点注册失败（没有 GPU）: {}", err);
                    return Ok(()); // 返回，不再继续处理
                }
            }
        }
        
        NodeMessage::NodeHeartbeat {
            node_id: nid,
            timestamp: _,
            resource_usage,
            installed_models,
            capability_state,
        } => {
            // 更新节点心跳
            state.node_registry.update_node_heartbeat(
                &nid,
                resource_usage.cpu_percent,
                resource_usage.gpu_percent,
                resource_usage.mem_percent,
                installed_models,
                resource_usage.running_jobs,
                capability_state,
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
            trace_id,
            group_id: _group_id,
            part_index: _part_index,
        } => {
            // 更新 job 状态
            if success {
                state.dispatcher.update_job_status(&job_id, crate::dispatcher::JobStatus::Completed).await;
            } else {
                state.dispatcher.update_job_status(&job_id, crate::dispatcher::JobStatus::Failed).await;
            }
            
            // 获取 job 创建时间以计算 elapsed_ms
            let job = state.dispatcher.get_job(&job_id).await;
            let elapsed_ms = job.as_ref().map(|j| {
                chrono::Utc::now().signed_duration_since(j.created_at).num_milliseconds() as u64
            });
            
            // Utterance Group 处理：在收到 JobResult 时，如果有 ASR 结果，调用 GroupManager
            let (group_id, part_index) = if let Some(ref text_asr) = text_asr {
                if !text_asr.is_empty() {
                    let now_ms = chrono::Utc::now().timestamp_millis() as u64;
                    let (gid, _context, pidx) = state.group_manager.on_asr_final(
                        &session_id,
                        &trace_id,
                        utterance_index,
                        text_asr.clone(),
                        now_ms,
                    ).await;
                    
                    // 如果有翻译结果，更新 Group
                    if let Some(ref text_translated) = text_translated {
                        if !text_translated.is_empty() {
                            state.group_manager.on_nmt_done(
                                &gid,
                                pidx,
                                Some(text_translated.clone()),
                                None,
                            ).await;
                        }
                    }
                    
                    (Some(gid), Some(pidx))
                } else {
                    (None, None)
                }
            } else {
                (None, None)
            };
            
            if success {
                // 推送 ASR_FINAL 事件（ASR 完成）
                if let Some(ref text_asr) = text_asr {
                    if !text_asr.is_empty() {
                        let ui_event = SessionMessage::UiEvent {
                            trace_id: trace_id.clone(),
                            session_id: session_id.clone(),
                            job_id: job_id.clone(),
                            utterance_index,
                            event: UiEventType::AsrFinal,
                            elapsed_ms,
                            status: UiEventStatus::Ok,
                            error_code: None,
                            hint: None,
                        };
                        let ui_event_json = serde_json::to_string(&ui_event)?;
                        state.session_connections.send(
                            &session_id,
                            Message::Text(ui_event_json)
                        ).await;
                    }
                }
                
                // 推送 NMT_DONE 事件（翻译完成）
                if let Some(ref text_translated) = text_translated {
                    if !text_translated.is_empty() {
                        let ui_event = SessionMessage::UiEvent {
                            trace_id: trace_id.clone(),
                            session_id: session_id.clone(),
                            job_id: job_id.clone(),
                            utterance_index,
                            event: UiEventType::NmtDone,
                            elapsed_ms,
                            status: UiEventStatus::Ok,
                            error_code: None,
                            hint: None,
                        };
                        let ui_event_json = serde_json::to_string(&ui_event)?;
                        state.session_connections.send(
                            &session_id,
                            Message::Text(ui_event_json)
                        ).await;
                    }
                }
                
                // 创建翻译结果消息
                let result = SessionMessage::TranslationResult {
                    session_id: session_id.clone(),
                    utterance_index,
                    job_id: job_id.clone(),
                    text_asr: text_asr.clone().unwrap_or_default(),
                    text_translated: text_translated.clone().unwrap_or_default(),
                    tts_audio: tts_audio.clone().unwrap_or_default(),
                    tts_format: tts_format.clone().unwrap_or("pcm16".to_string()),
                    extra: extra.clone(),
                    trace_id: trace_id.clone(), // Added: propagate trace_id
                    group_id: group_id.clone(), // Added: propagate group_id
                    part_index, // Added: propagate part_index
                };
                
                info!(trace_id = %trace_id, job_id = %job_id, session_id = %session_id, utterance_index = utterance_index, "收到 JobResult，添加到结果队列");
                
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
                        warn!(trace_id = %trace_id, session_id = %session_id, "无法发送结果到会话");
                    }
                }
            } else {
                // 推送 ERROR 事件
                let error_code = job_error.as_ref().and_then(|e| {
                    // 尝试将错误码字符串转换为 ErrorCode 枚举
                    match e.code.as_str() {
                        "NO_AVAILABLE_NODE" => Some(ErrorCode::NoAvailableNode),
                        "MODEL_NOT_AVAILABLE" => Some(ErrorCode::ModelNotAvailable),
                        "WS_DISCONNECTED" => Some(ErrorCode::WsDisconnected),
                        "NMT_TIMEOUT" => Some(ErrorCode::NmtTimeout),
                        "TTS_TIMEOUT" => Some(ErrorCode::TtsTimeout),
                        "MODEL_VERIFY_FAILED" => Some(ErrorCode::ModelVerifyFailed),
                        "MODEL_CORRUPTED" => Some(ErrorCode::ModelCorrupted),
                        _ => None,
                    }
                });
                
                let ui_event = SessionMessage::UiEvent {
                    trace_id: trace_id.clone(),
                    session_id: session_id.clone(),
                    job_id: job_id.clone(),
                    utterance_index,
                    event: UiEventType::Error,
                    elapsed_ms,
                    status: UiEventStatus::Error,
                    error_code: error_code.clone(),
                    hint: error_code.as_ref().map(|code| crate::messages::get_error_hint(code).to_string()),
                };
                let ui_event_json = serde_json::to_string(&ui_event)?;
                state.session_connections.send(
                    &session_id,
                    Message::Text(ui_event_json)
                ).await;
                
                // 发送错误给客户端
                error!(trace_id = %trace_id, job_id = %job_id, session_id = %session_id, "Job 处理失败");
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
        
        NodeMessage::AsrPartial {
            job_id: _,
            node_id: _nid,
            session_id,
            utterance_index,
            text,
            is_final,
            trace_id,
        } => {
            // 转发 ASR 部分结果给客户端
            let partial_msg = SessionMessage::AsrPartial {
                session_id: session_id.clone(),
                utterance_index,
                job_id: String::new(), // 部分结果不需要 job_id
                text: text.clone(),
                is_final,
                trace_id: trace_id.clone(),
            };
            debug!(trace_id = %trace_id, session_id = %session_id, utterance_index = utterance_index, is_final = is_final, "转发 ASR 部分结果");
            let partial_json = serde_json::to_string(&partial_msg)?;
            if !state.session_connections.send(
                &session_id,
                Message::Text(partial_json)
            ).await {
                warn!(trace_id = %trace_id, session_id = %session_id, "无法发送 ASR 部分结果到会话");
            }
            
            // 推送 ASR_PARTIAL 事件
            let ui_event = SessionMessage::UiEvent {
                trace_id: trace_id.clone(),
                session_id: session_id.clone(),
                job_id: String::new(), // 部分结果不需要 job_id
                utterance_index,
                event: UiEventType::AsrPartial,
                elapsed_ms: None, // 部分结果不计算耗时
                status: UiEventStatus::Ok,
                error_code: None,
                hint: None,
            };
            let ui_event_json = serde_json::to_string(&ui_event)?;
            state.session_connections.send(
                &session_id,
                Message::Text(ui_event_json)
            ).await;
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

