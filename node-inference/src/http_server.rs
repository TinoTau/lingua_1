//! HTTP 服务器，用于 Electron 节点调用推理服务

use anyhow::Result;
use axum::{
    extract::{ws::WebSocketUpgrade, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{error, info};

use crate::inference::{InferenceRequest, InferenceService, PartialResultCallback};
use crate::asr::ASRPartialResult;

/// HTTP 服务器状态
#[derive(Clone)]
pub struct ServerState {
    pub inference_service: Arc<RwLock<InferenceService>>,
}

/// 推理请求（HTTP 格式）
#[derive(Debug, Deserialize)]
pub struct HttpInferenceRequest {
    pub job_id: String,
    pub src_lang: String,
    pub tgt_lang: String,
    pub audio: String, // base64 encoded audio
    pub audio_format: Option<String>,
    pub sample_rate: Option<u32>,
    pub features: Option<serde_json::Value>,
    pub mode: Option<String>,
    pub lang_a: Option<String>,
    pub lang_b: Option<String>,
    pub auto_langs: Option<Vec<String>>,
    pub enable_streaming_asr: Option<bool>,
    pub partial_update_interval_ms: Option<u64>,
    /// 追踪 ID（用于全链路日志追踪）
    pub trace_id: Option<String>,
    /// 上下文文本（可选，用于 NMT 翻译质量提升）
    pub context_text: Option<String>,
}

/// 推理响应（HTTP 格式）
#[derive(Debug, Serialize)]
pub struct HttpInferenceResponse {
    pub success: bool,
    pub job_id: String,
    pub transcript: Option<String>,
    pub translation: Option<String>,
    pub audio: Option<String>, // base64 encoded audio
    pub audio_format: Option<String>,
    pub extra: Option<serde_json::Value>,
    pub error: Option<ErrorInfo>,
}

/// 错误信息
#[derive(Debug, Serialize)]
pub struct ErrorInfo {
    pub code: String,
    pub message: String,
}

/// 启动 HTTP 服务器
pub async fn start_server(
    inference_service: InferenceService,
    port: u16,
) -> Result<()> {
    let state = ServerState {
        inference_service: Arc::new(RwLock::new(inference_service)),
    };

    let app = Router::new()
        .route("/health", get(health_check))
        .route("/v1/inference", post(handle_inference))
        .route("/v1/inference/stream", get(handle_inference_stream_ws))
        .with_state(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    info!("推理服务 HTTP 服务器启动在: {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

/// 健康检查
async fn health_check() -> impl IntoResponse {
    (StatusCode::OK, "OK")
}

/// 处理推理请求（同步，不支持流式 ASR）
async fn handle_inference(
    State(state): State<ServerState>,
    Json(request): Json<HttpInferenceRequest>,
) -> Result<Json<HttpInferenceResponse>, StatusCode> {
    // 解码 base64 音频
    use base64::{Engine as _, engine::general_purpose};
    let audio_data = general_purpose::STANDARD.decode(&request.audio)
        .map_err(|e| {
            error!("解码音频数据失败: {}", e);
            StatusCode::BAD_REQUEST
        })?;

    // 转换为 InferenceRequest
    let inference_request = InferenceRequest {
        job_id: request.job_id.clone(),
        src_lang: request.src_lang,
        tgt_lang: request.tgt_lang,
        audio_data,
        features: request.features.and_then(|f| {
            serde_json::from_value(f).ok()
        }),
        mode: request.mode,
        lang_a: request.lang_a,
        lang_b: request.lang_b,
        auto_langs: request.auto_langs,
        enable_streaming_asr: Some(false), // HTTP 同步请求不支持流式
        partial_update_interval_ms: None,
        trace_id: request.trace_id, // Added: propagate trace_id
        context_text: request.context_text, // Added: propagate context_text
    };

    // 调用推理服务
    let service = state.inference_service.read().await;
    match service.process(inference_request, None).await {
        Ok(result) => {
            // 编码音频为 base64
            use base64::{Engine as _, engine::general_purpose};
            let audio_base64 = general_purpose::STANDARD.encode(&result.audio);
            
            // 构建 extra 字段
            let mut extra = serde_json::Map::new();
            if let Some(speaker_id) = result.speaker_id {
                extra.insert("speaker_id".to_string(), serde_json::Value::String(speaker_id));
            }
            if let Some(speech_rate) = result.speech_rate {
                extra.insert("speech_rate".to_string(), serde_json::Value::Number(
                    serde_json::Number::from_f64(speech_rate as f64).unwrap()
                ));
            }
            if let Some(emotion) = result.emotion {
                extra.insert("emotion".to_string(), serde_json::Value::String(emotion));
            }

            Ok(Json(HttpInferenceResponse {
                success: true,
                job_id: request.job_id,
                transcript: Some(result.transcript),
                translation: Some(result.translation),
                audio: Some(audio_base64),
                audio_format: request.audio_format.or(Some("pcm16".to_string())),
                extra: if extra.is_empty() { None } else { Some(serde_json::Value::Object(extra)) },
                error: None,
            }))
        }
        Err(e) => {
            error!("推理失败: {}", e);
            Ok(Json(HttpInferenceResponse {
                success: false,
                job_id: request.job_id,
                transcript: None,
                translation: None,
                audio: None,
                audio_format: None,
                extra: None,
                error: Some(ErrorInfo {
                    code: "INFERENCE_ERROR".to_string(),
                    message: e.to_string(),
                }),
            }))
        }
    }
}

/// 处理流式推理请求（WebSocket）
async fn handle_inference_stream_ws(
    ws: WebSocketUpgrade,
    State(state): State<ServerState>,
) -> Response {
    ws.on_upgrade(|socket| handle_inference_stream(socket, state))
}

/// 处理 WebSocket 流式推理
async fn handle_inference_stream(
    socket: axum::extract::ws::WebSocket,
    state: ServerState,
) {
    use axum::extract::ws::Message;
    use futures_util::{SinkExt, StreamExt};
    use std::sync::Arc;

    let (mut sender, mut receiver) = socket.split();
    let mut current_job_id: Option<String> = None;

    // 创建消息通道用于发送部分结果
    let (tx_msg, mut rx_msg) = tokio::sync::mpsc::unbounded_channel::<Message>();
    
    // 创建部分结果回调通道
    let (tx_partial, mut rx_partial) = tokio::sync::mpsc::unbounded_channel::<ASRPartialResult>();
    let callback: PartialResultCallback = Arc::new(move |partial: ASRPartialResult| {
        if let Err(e) = tx_partial.send(partial) {
            error!("发送部分结果失败: {}", e);
        }
    });

    // 启动部分结果发送任务（将部分结果转换为消息并发送）
    let tx_msg_clone = tx_msg.clone();
    let partial_task = tokio::spawn(async move {
        while let Some(partial) = rx_partial.recv().await {
            let message = serde_json::json!({
                "type": "asr_partial",
                "text": partial.text,
                "is_final": partial.is_final,
                "confidence": partial.confidence,
            });
            if let Err(e) = tx_msg_clone.send(Message::Text(serde_json::to_string(&message).unwrap())) {
                error!("发送部分结果消息失败: {}", e);
                break;
            }
        }
    });

    // 启动消息发送任务
    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx_msg.recv().await {
            if sender.send(msg).await.is_err() {
                break;
            }
        }
    });

    // 处理接收到的消息
    while let Some(msg) = receiver.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                // 解析推理请求
                match serde_json::from_str::<HttpInferenceRequest>(&text) {
                    Ok(request) => {
                        current_job_id = Some(request.job_id.clone());

                        // 解码 base64 音频
                        use base64::{Engine as _, engine::general_purpose};
                        let audio_data = match general_purpose::STANDARD.decode(&request.audio) {
                            Ok(data) => data,
                            Err(e) => {
                                error!("解码音频数据失败: {}", e);
                        let error_msg = serde_json::json!({
                            "type": "error",
                            "code": "INVALID_AUDIO",
                            "message": format!("解码音频数据失败: {}", e),
                        });
                        let _ = tx_msg.send(Message::Text(serde_json::to_string(&error_msg).unwrap()));
                                continue;
                            }
                        };

                        // 转换为 InferenceRequest
                        let inference_request = InferenceRequest {
                            job_id: request.job_id.clone(),
                            src_lang: request.src_lang,
                            tgt_lang: request.tgt_lang,
                            audio_data,
                            features: request.features.and_then(|f| {
                                serde_json::from_value(f).ok()
                            }),
                            mode: request.mode,
                            lang_a: request.lang_a,
                            lang_b: request.lang_b,
                            auto_langs: request.auto_langs,
                            enable_streaming_asr: request.enable_streaming_asr.or(Some(false)),
                            partial_update_interval_ms: request.partial_update_interval_ms,
                            trace_id: request.trace_id, // Added: propagate trace_id
                            context_text: request.context_text.clone(), // Added: propagate context_text
                        };

                        // 调用推理服务
                        let service = state.inference_service.read().await;
                        match service.process(inference_request, Some(callback.clone())).await {
                            Ok(result) => {
                                // 编码音频为 base64
                                use base64::{Engine as _, engine::general_purpose};
                                let audio_base64 = general_purpose::STANDARD.encode(&result.audio);
                                
                                // 构建响应
                                let response = serde_json::json!({
                                    "type": "result",
                                    "success": true,
                                    "job_id": request.job_id,
                                    "transcript": result.transcript,
                                    "translation": result.translation,
                                    "audio": audio_base64,
                                    "audio_format": request.audio_format.unwrap_or("pcm16".to_string()),
                                    "extra": {
                                        "speaker_id": result.speaker_id,
                                        "speech_rate": result.speech_rate,
                                        "emotion": result.emotion,
                                    },
                                });
                                
                                if let Err(e) = tx_msg.send(Message::Text(serde_json::to_string(&response).unwrap())) {
                                    error!("发送推理结果失败: {}", e);
                                }
                            }
                            Err(e) => {
                                error!("推理失败: {}", e);
                                let error_msg = serde_json::json!({
                                    "type": "error",
                                    "code": "INFERENCE_ERROR",
                                    "message": e.to_string(),
                                });
                                let _ = tx_msg.send(Message::Text(serde_json::to_string(&error_msg).unwrap()));
                            }
                        }
                    }
                    Err(e) => {
                        error!("解析推理请求失败: {}", e);
                        let error_msg = serde_json::json!({
                            "type": "error",
                            "code": "INVALID_REQUEST",
                            "message": format!("解析请求失败: {}", e),
                        });
                        let _ = tx_msg.send(Message::Text(serde_json::to_string(&error_msg).unwrap()));
                    }
                }
            }
            Ok(Message::Close(_)) => {
                info!("WebSocket 连接关闭");
                break;
            }
            Err(e) => {
                error!("WebSocket 错误: {}", e);
                break;
            }
            _ => {}
        }
    }

    // 等待发送任务完成
    send_task.abort();
    partial_task.abort();
}

