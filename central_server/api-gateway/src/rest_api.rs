use axum::{
    extract::{Multipart, State, Extension},
    response::Json,
    routing::post,
    Router,
};
use serde_json::json;
use crate::AppState;

pub fn create_rest_router() -> Router<AppState> {
    Router::new()
        .route("/v1/speech/translate", post(handle_translate))
}

async fn handle_translate(
    State(state): State<AppState>,
    Extension(tenant_id): Extension<String>, // 从中间件提取
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, axum::http::StatusCode> {
    let mut audio_data = Vec::new();
    let mut src_lang = None;
    let mut tgt_lang = None;
    let mut audio_format = Some("pcm16".to_string());
    let mut sample_rate = Some(16000u32);

    // 解析 multipart 请求
    while let Some(field) = multipart.next_field().await
        .map_err(|_| axum::http::StatusCode::BAD_REQUEST)? {
        let name = field.name().unwrap_or("");
        match name {
            "audio" => {
                audio_data = field.bytes().await
                    .map_err(|_| axum::http::StatusCode::BAD_REQUEST)?
                    .to_vec();
            }
            "src_lang" => {
                src_lang = Some(
                    String::from_utf8(field.bytes().await
                        .map_err(|_| axum::http::StatusCode::BAD_REQUEST)?
                        .to_vec())
                    .map_err(|_| axum::http::StatusCode::BAD_REQUEST)?
                );
            }
            "tgt_lang" => {
                tgt_lang = Some(
                    String::from_utf8(field.bytes().await
                        .map_err(|_| axum::http::StatusCode::BAD_REQUEST)?
                        .to_vec())
                    .map_err(|_| axum::http::StatusCode::BAD_REQUEST)?
                );
            }
            "audio_format" => {
                audio_format = Some(
                    String::from_utf8(field.bytes().await
                        .map_err(|_| axum::http::StatusCode::BAD_REQUEST)?
                        .to_vec())
                    .map_err(|_| axum::http::StatusCode::BAD_REQUEST)?
                );
            }
            "sample_rate" => {
                sample_rate = Some(
                    String::from_utf8(field.bytes().await
                        .map_err(|_| axum::http::StatusCode::BAD_REQUEST)?
                        .to_vec())
                    .parse::<u32>()
                    .map_err(|_| axum::http::StatusCode::BAD_REQUEST)?
                );
            }
            _ => {}
        }
    }

    if audio_data.is_empty() {
        return Err(axum::http::StatusCode::BAD_REQUEST);
    }

    let src_lang = src_lang.unwrap_or_else(|| "zh".to_string());
    let tgt_lang = tgt_lang.unwrap_or_else(|| "en".to_string());

    // 创建会话
    let session_id = state.scheduler_client
        .create_session(
            tenant_id.clone(),
            src_lang.clone(),
            tgt_lang.clone(),
            None,
            None,
        )
        .await
        .map_err(|_| axum::http::StatusCode::INTERNAL_SERVER_ERROR)?;

    // 发送 utterance
    let result = state.scheduler_client
        .send_utterance(
            session_id,
            0,
            audio_data,
            src_lang,
            tgt_lang,
            None,
            None,
            audio_format.unwrap(),
            sample_rate.unwrap(),
        )
        .await
        .map_err(|_| axum::http::StatusCode::INTERNAL_SERVER_ERROR)?;

    // 转换为对外格式
    Ok(Json(json!({
        "text": result.text_translated,
        "audio_tts": result.tts_audio,
        "duration_ms": result.processing_time_ms.unwrap_or(0),
    })))
}

