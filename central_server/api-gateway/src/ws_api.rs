use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use crate::AppState;

pub async fn handle_public_websocket(
    socket: WebSocket,
    tenant_id: String,
    state: AppState,
) {
    let (mut sender, mut receiver) = socket.split();
    let mut session_id: Option<String> = None;
    let mut utterance_index = 0u64;
    let mut src_lang = "zh".to_string();
    let mut tgt_lang = "en".to_string();

    while let Some(msg) = receiver.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                let message: serde_json::Value = match serde_json::from_str(&text) {
                    Ok(m) => m,
                    Err(_) => {
                        let _ = sender.send(Message::Text(
                            json!({"type": "error", "message": "Invalid JSON"}).to_string()
                        )).await;
                        continue;
                    }
                };

                match message["type"].as_str() {
                    Some("start") => {
                        src_lang = message["src_lang"]
                            .as_str()
                            .unwrap_or("zh")
                            .to_string();
                        tgt_lang = message["tgt_lang"]
                            .as_str()
                            .unwrap_or("en")
                            .to_string();

                        match state.scheduler_client
                            .create_session(
                                tenant_id.clone(),
                                src_lang.clone(),
                                tgt_lang.clone(),
                                None,
                                None,
                            )
                            .await
                        {
                            Ok(sess_id) => {
                                session_id = Some(sess_id);
                                let _ = sender.send(Message::Text(
                                    json!({"type": "started", "session_id": session_id}).to_string()
                                )).await;
                            }
                            Err(e) => {
                                let _ = sender.send(Message::Text(
                                    json!({"type": "error", "message": format!("Failed to create session: {}", e)}).to_string()
                                )).await;
                            }
                        }
                    }
                    Some("audio") => {
                        if let Some(ref sess_id) = session_id {
                            let audio_base64 = match message["chunk"].as_str() {
                                Some(chunk) => chunk,
                                None => {
                                    let _ = sender.send(Message::Text(
                                        json!({"type": "error", "message": "Missing audio chunk"}).to_string()
                                    )).await;
                                    continue;
                                }
                            };

                            let audio_data = match base64::decode(audio_base64) {
                                Ok(data) => data,
                                Err(_) => {
                                    let _ = sender.send(Message::Text(
                                        json!({"type": "error", "message": "Invalid base64 audio"}).to_string()
                                    )).await;
                                    continue;
                                }
                            };

                            match state.scheduler_client
                                .send_utterance(
                                    sess_id.clone(),
                                    utterance_index,
                                    audio_data,
                                    src_lang.clone(),
                                    tgt_lang.clone(),
                                    None,
                                    None,
                                    "pcm16".to_string(),
                                    16000,
                                )
                                .await
                            {
                                Ok(result) => {
                                    let _ = sender.send(Message::Text(
                                        json!({
                                            "type": "final",
                                            "text": result.text_translated,
                                            "audio": result.tts_audio,
                                        }).to_string()
                                    )).await;
                                    utterance_index += 1;
                                }
                                Err(e) => {
                                    let _ = sender.send(Message::Text(
                                        json!({"type": "error", "message": format!("Translation failed: {}", e)}).to_string()
                                    )).await;
                                }
                            }
                        } else {
                            let _ = sender.send(Message::Text(
                                json!({"type": "error", "message": "Session not started"}).to_string()
                            )).await;
                        }
                    }
                    _ => {
                        let _ = sender.send(Message::Text(
                            json!({"type": "error", "message": "Unknown message type"}).to_string()
                        )).await;
                    }
                }
            }
            Ok(Message::Close(_)) => break,
            Err(e) => {
                tracing::error!("WebSocket error: {}", e);
                break;
            }
            _ => {}
        }
    }
}

