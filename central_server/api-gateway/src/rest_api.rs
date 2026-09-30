use axum::{
    extract::{Extension, State},
    response::Json,
    routing::{get, post},
    Router,
};
use serde::Deserialize;
use serde_json::json;

use crate::user_identity::AuthContext;
use crate::user_profile::{UserProfileError, UserProfileV1};
use crate::user_profile_repository::UserProfileRepository;
use crate::AppState;

pub fn create_rest_router() -> Router<AppState> {
    Router::new()
        .route("/v1/speech/translate", post(handle_translate))
        .route("/v1/me", get(handle_me))
        .route("/v1/me/profile", get(handle_get_profile).put(handle_put_profile))
        .route("/v1/corrections", post(handle_submit_correction))
}

async fn handle_submit_correction(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Json(body): Json<crate::correction_proxy::BrowserCorrectionRequest>,
) -> Result<Json<crate::correction_proxy::GatewayCorrectionResponse>, (axum::http::StatusCode, Json<serde_json::Value>)>
{
    match crate::correction_proxy::proxy_correction_to_scheduler(&state, &auth, body).await {
        Ok(resp) => Ok(Json(resp)),
        Err((status, msg)) => {
            // Never leak Authorization / Bearer secrets; keep known public error codes.
            let safe = if msg.contains("Bearer ") {
                "upstream_error".to_string()
            } else {
                msg
            };
            Err((status, Json(json!({"error": safe}))))
        }
    }
}

async fn handle_me(
    Extension(auth): Extension<AuthContext>,
) -> Json<serde_json::Value> {
    Json(json!({
        "user_id": auth.user_id,
        "tenant_id": auth.tenant_id,
        "note": "user_id is server-owned and distinct from tenant_id"
    }))
}

async fn handle_get_profile(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
) -> Result<Json<UserProfileV1>, axum::http::StatusCode> {
    state
        .profile_repo
        .get_profile(&auth.user_id)
        .map(Json)
        .map_err(|e| match e {
            UserProfileError::UserNotFound(_) => axum::http::StatusCode::NOT_FOUND,
            _ => axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        })
}

#[derive(Debug, Deserialize)]
pub struct PutProfileRequest {
    pub expected_profile_version: u64,
    pub profile: UserProfileV1,
}

async fn handle_put_profile(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Json(body): Json<PutProfileRequest>,
) -> Result<Json<UserProfileV1>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    match state.profile_repo.update_profile(
        &auth.user_id,
        body.expected_profile_version,
        &body.profile,
    ) {
        Ok(p) => Ok(Json(p)),
        Err(UserProfileError::PayloadTooLarge { size, max }) => Err((
            axum::http::StatusCode::PAYLOAD_TOO_LARGE,
            Json(json!({"error":"PROFILE_TOO_LARGE","size":size,"max":max})),
        )),
        Err(UserProfileError::StaleVersion { expected, actual }) => Err((
            axum::http::StatusCode::CONFLICT,
            Json(json!({"error":"STALE_PROFILE_VERSION","expected":expected,"actual":actual})),
        )),
        Err(UserProfileError::UserNotFound(_)) => Err((
            axum::http::StatusCode::NOT_FOUND,
            Json(json!({"error":"USER_NOT_FOUND"})),
        )),
        Err(e) => Err((
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )),
    }
}

async fn handle_translate(
    State(state): State<AppState>,
    Extension(tenant_id): Extension<String>,
    mut multipart: axum::extract::Multipart,
) -> Result<Json<serde_json::Value>, axum::http::StatusCode> {
    let mut audio_data = Vec::new();
    let mut src_lang = None;
    let mut tgt_lang = None;
    let mut audio_format = Some("pcm16".to_string());
    let mut sample_rate = Some(16000u32);

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|_| axum::http::StatusCode::BAD_REQUEST)?
    {
        let name = field.name().unwrap_or("");
        match name {
            "audio" => {
                audio_data = field
                    .bytes()
                    .await
                    .map_err(|_| axum::http::StatusCode::BAD_REQUEST)?
                    .to_vec();
            }
            "src_lang" => {
                src_lang = Some(
                    String::from_utf8(
                        field
                            .bytes()
                            .await
                            .map_err(|_| axum::http::StatusCode::BAD_REQUEST)?
                            .to_vec(),
                    )
                    .map_err(|_| axum::http::StatusCode::BAD_REQUEST)?,
                );
            }
            "tgt_lang" => {
                tgt_lang = Some(
                    String::from_utf8(
                        field
                            .bytes()
                            .await
                            .map_err(|_| axum::http::StatusCode::BAD_REQUEST)?
                            .to_vec(),
                    )
                    .map_err(|_| axum::http::StatusCode::BAD_REQUEST)?,
                );
            }
            "audio_format" => {
                audio_format = Some(
                    String::from_utf8(
                        field
                            .bytes()
                            .await
                            .map_err(|_| axum::http::StatusCode::BAD_REQUEST)?
                            .to_vec(),
                    )
                    .map_err(|_| axum::http::StatusCode::BAD_REQUEST)?,
                );
            }
            "sample_rate" => {
                sample_rate = Some(
                    String::from_utf8(
                        field
                            .bytes()
                            .await
                            .map_err(|_| axum::http::StatusCode::BAD_REQUEST)?
                            .to_vec(),
                    )
                    .map_err(|_| axum::http::StatusCode::BAD_REQUEST)?
                    .parse::<u32>()
                    .map_err(|_| axum::http::StatusCode::BAD_REQUEST)?,
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

    let session_id = state
        .scheduler_client
        .create_session(
            tenant_id.clone(),
            src_lang.clone(),
            tgt_lang.clone(),
            None,
            None,
        )
        .await
        .map_err(|_| axum::http::StatusCode::BAD_GATEWAY)?;

    let result = state
        .scheduler_client
        .send_utterance(
            session_id.clone(),
            0,
            audio_data,
            src_lang,
            tgt_lang,
            None,
            None,
            audio_format.unwrap_or_else(|| "pcm16".to_string()),
            sample_rate.unwrap_or(16000),
        )
        .await
        .map_err(|_| axum::http::StatusCode::BAD_GATEWAY)?;

    Ok(Json(json!({
        "session_id": session_id,
        "text_asr": result.text_asr,
        "text_translated": result.text_translated,
        "tts_audio": result.tts_audio,
        "tenant_id": tenant_id,
    })))
}
