//! Browser → Gateway correction proxy → Scheduler CorrectionHistory SSOT.

use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use crate::user_identity::AuthContext;
use crate::user_profile_repository::UserProfileRepository;
use crate::AppState;

const MAX_TEXT_CHARS: usize = 8_000;

#[derive(Debug, Deserialize)]
pub struct BrowserCorrectionRequest {
    pub session_id: String,
    pub utterance_index: u64,
    pub system_text: String,
    pub corrected_text: String,
    pub client_correction_id: String,
    #[serde(default)]
    pub source_profile_version: Option<u64>,
    #[serde(default)]
    pub pipeline_version: Option<String>,
    /// Browser must NOT authoritatively set user_id; ignored if present.
    #[serde(default)]
    pub user_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GatewayCorrectionResponse {
    pub accepted: bool,
    pub correction_id: String,
    pub duplicate: bool,
    pub profile_delta: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_version_before: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_version_after: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_apply_skipped: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostics: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
struct SchedulerCorrectionRequest {
    user_id: String,
    session_id: String,
    utterance_index: u64,
    system_text: String,
    corrected_text: String,
    corrections: Vec<serde_json::Value>,
    source_profile_version: Option<u64>,
    pipeline_version: Option<String>,
    idempotency_key: String,
}

pub fn scheduler_http_base_from_ws(ws_url: &str) -> String {
    let u = ws_url
        .replace("ws://", "http://")
        .replace("wss://", "https://");
    if let Some(idx) = u.find("/ws/") {
        return u[..idx].to_string();
    }
    u.trim_end_matches('/').to_string()
}

pub fn validate_browser_correction(req: &BrowserCorrectionRequest) -> Result<(), String> {
    if req.session_id.trim().is_empty() {
        return Err("session_id required".into());
    }
    if !req.session_id.starts_with("s-") {
        return Err("session_id invalid format".into());
    }
    if req.client_correction_id.trim().is_empty() {
        return Err("client_correction_id required".into());
    }
    if req.system_text.trim().is_empty() {
        return Err("system_text required".into());
    }
    if req.corrected_text.trim().is_empty() {
        return Err("corrected_text required".into());
    }
    if req.system_text.trim() == req.corrected_text.trim() {
        return Err("NO_OP_CORRECTION: corrected_text must differ from system_text".into());
    }
    if req.system_text.chars().count() > MAX_TEXT_CHARS
        || req.corrected_text.chars().count() > MAX_TEXT_CHARS
    {
        return Err("text payload too large".into());
    }
    Ok(())
}

pub async fn proxy_correction_to_scheduler(
    state: &AppState,
    auth: &AuthContext,
    mut req: BrowserCorrectionRequest,
) -> Result<GatewayCorrectionResponse, (axum::http::StatusCode, String)> {
    if let Some(ref forged) = req.user_id {
        if forged != &auth.user_id {
            warn!(
                forged = %forged,
                auth_user = %auth.user_id,
                "Browser attempted to supply user_id; ignored"
            );
        }
    }
    req.user_id = None;

    validate_browser_correction(&req).map_err(|e| (axum::http::StatusCode::BAD_REQUEST, e))?;

    let profile_version = req.source_profile_version.or_else(|| {
        state
            .profile_repo
            .get_profile(&auth.user_id)
            .ok()
            .map(|p| p.profile_version)
    });

    let token = state
        .config
        .scheduler
        .correction_api_token
        .clone()
        .filter(|t| !t.is_empty())
        .or_else(|| std::env::var("LINGUA_CORRECTION_API_TOKEN").ok())
        .ok_or((
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            "CORRECTION_TOKEN_NOT_CONFIGURED".into(),
        ))?;

    let http_base = state
        .config
        .scheduler
        .http_base_url
        .clone()
        .unwrap_or_else(|| scheduler_http_base_from_ws(&state.config.scheduler.url));

    let url = format!("{}/api/v1/corrections", http_base.trim_end_matches('/'));

    let body = SchedulerCorrectionRequest {
        user_id: auth.user_id.clone(),
        session_id: req.session_id.clone(),
        utterance_index: req.utterance_index,
        system_text: req.system_text.clone(),
        corrected_text: req.corrected_text.clone(),
        corrections: vec![],
        source_profile_version: profile_version,
        pipeline_version: req.pipeline_version.clone(),
        idempotency_key: req.client_correction_id.clone(),
    };

    info!(
        user_id = %auth.user_id,
        session_id = %req.session_id,
        utterance_index = req.utterance_index,
        "Gateway proxying correction to Scheduler"
    );

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {}", token))
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            (
                axum::http::StatusCode::BAD_GATEWAY,
                format!("SCHEDULER_UNAVAILABLE: {}", e),
            )
        })?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| (axum::http::StatusCode::BAD_GATEWAY, e.to_string()))?;

    if !status.is_success() {
        return Err((
            axum::http::StatusCode::from_u16(status.as_u16())
                .unwrap_or(axum::http::StatusCode::BAD_GATEWAY),
            text,
        ));
    }

    let parsed: serde_json::Value = serde_json::from_str(&text).map_err(|e| {
        (
            axum::http::StatusCode::BAD_GATEWAY,
            format!("invalid scheduler response: {}", e),
        )
    })?;

    // Never leak scheduler token; only forward safe fields.
    let profile_delta_val = parsed.get("profile_delta").cloned().and_then(|v| {
        if v.is_null() {
            None
        } else {
            Some(v)
        }
    });
    let diagnostics = parsed.get("diagnostics").cloned();
    let duplicate = parsed
        .get("duplicate")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let correction_id = parsed
        .get("correction_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let mut profile_version_before = None;
    let mut profile_version_after = None;
    let mut profile_apply_skipped = None;

    // Apply ProfileDelta locally (Gateway SSOT). Skip on duplicate or superseded.
    if let Some(ref delta_json) = profile_delta_val {
        if !duplicate {
            match serde_json::from_value::<crate::profile_delta::ProfileDeltaV1>(delta_json.clone())
            {
                Ok(delta) => {
                    let lex_ref = state.lexicon.as_ref().map(|l| l.as_ref());
                    match state.profile_repo.apply_profile_delta_with_lexicon(
                        &auth.user_id,
                        &delta,
                        lex_ref,
                    ) {
                        Ok(applied) => {
                            profile_version_before = Some(applied.profile_version_before);
                            profile_version_after = Some(applied.profile_version_after);
                            profile_apply_skipped = Some(applied.skipped);
                            info!(
                                user_id = %auth.user_id,
                                event_id = %delta.source_event_id,
                                before = applied.profile_version_before,
                                after = applied.profile_version_after,
                                skipped = applied.skipped,
                                "ProfileDelta applied on Gateway"
                            );
                            if !applied.skipped {
                                let _ = push_session_profile_refresh(
                                    &http_base,
                                    &token,
                                    &req.session_id,
                                    &applied.profile,
                                )
                                .await;
                            }
                        }
                        Err(e) => {
                            warn!(error = %e, "ProfileDelta apply failed; correction fact already stored");
                            profile_apply_skipped = Some(true);
                        }
                    }
                }
                Err(e) => {
                    warn!(error = %e, "invalid ProfileDelta JSON from Scheduler");
                }
            }
        } else {
            profile_apply_skipped = Some(true);
        }
    }

    Ok(GatewayCorrectionResponse {
        accepted: parsed
            .get("accepted")
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
        correction_id,
        duplicate,
        profile_delta: profile_delta_val,
        profile_version_before,
        profile_version_after,
        profile_apply_skipped,
        diagnostics,
    })
}

/// Notify Scheduler to refresh in-memory session profile and re-bootstrap Node.
async fn push_session_profile_refresh(
    http_base: &str,
    token: &str,
    session_id: &str,
    profile: &crate::user_profile::UserProfileV1,
) -> Result<(), String> {
    let url = format!(
        "{}/api/v1/sessions/profile-refresh",
        http_base.trim_end_matches('/')
    );
    let body = serde_json::json!({
        "session_id": session_id,
        "profile_version": profile.profile_version,
        "user_profile": profile,
    });
    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {}", token))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("PROFILE_REFRESH_UNAVAILABLE: {e}"))?;
    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        warn!(session_id = %session_id, body = %text, "session profile refresh failed (non-fatal)");
        return Err(text);
    }
    info!(session_id = %session_id, version = profile.profile_version, "session profile refresh requested");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn derive_http_base() {
        assert_eq!(
            scheduler_http_base_from_ws("ws://localhost:5010/ws/session"),
            "http://localhost:5010"
        );
    }

    #[test]
    fn reject_no_op_and_forged_fields_validated() {
        let ok = BrowserCorrectionRequest {
            session_id: "s-ABCDEF12".into(),
            utterance_index: 1,
            system_text: "系统".into(),
            corrected_text: "纠正".into(),
            client_correction_id: "c1".into(),
            source_profile_version: None,
            pipeline_version: None,
            user_id: Some("forged".into()),
        };
        assert!(validate_browser_correction(&ok).is_ok());

        let mut noop = ok;
        noop.corrected_text = "系统".into();
        assert!(validate_browser_correction(&noop)
            .unwrap_err()
            .contains("NO_OP"));
    }

    #[test]
    fn validate_bounds_and_session_format() {
        let mut req = BrowserCorrectionRequest {
            session_id: "bad".into(),
            utterance_index: 0,
            system_text: "a".into(),
            corrected_text: "b".into(),
            client_correction_id: "c".into(),
            source_profile_version: None,
            pipeline_version: None,
            user_id: None,
        };
        assert!(validate_browser_correction(&req)
            .unwrap_err()
            .contains("invalid format"));
        req.session_id = "s-OK".into();
        assert!(validate_browser_correction(&req).is_ok());
        req.system_text = "x".repeat(8001);
        assert!(validate_browser_correction(&req)
            .unwrap_err()
            .contains("too large"));
    }

    #[test]
    fn response_never_includes_token_fields() {
        let resp = GatewayCorrectionResponse {
            accepted: true,
            correction_id: "corr-1".into(),
            duplicate: false,
            profile_delta: None,
            profile_version_before: None,
            profile_version_after: None,
            profile_apply_skipped: None,
            diagnostics: None,
        };
        let s = serde_json::to_string(&resp).unwrap();
        assert!(!s.to_lowercase().contains("token"));
        assert!(!s.contains("LINGUA"));
    }

    #[tokio::test]
    async fn proxy_injects_auth_user_ignores_forged_and_forwards_token() {
        use axum::{routing::post, Json, Router};
        use std::sync::{Arc, Mutex};
        use tokio::net::TcpListener;

        let captured: Arc<Mutex<Option<(String, serde_json::Value)>>> =
            Arc::new(Mutex::new(None));
        let cap = captured.clone();

        let mock = Router::new().route(
            "/api/v1/corrections",
            post(move |headers: axum::http::HeaderMap, Json(body): Json<serde_json::Value>| {
                let cap = cap.clone();
                async move {
                    let auth = headers
                        .get(axum::http::header::AUTHORIZATION)
                        .and_then(|h| h.to_str().ok())
                        .unwrap_or("")
                        .to_string();
                    *cap.lock().unwrap() = Some((auth, body));
                    Json(serde_json::json!({
                        "accepted": true,
                        "correction_id": "corr-mock-1",
                        "duplicate": false,
                        "profile_delta": null
                    }))
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, mock).await.unwrap();
        });

        let profile_repo = Arc::new(
            crate::user_profile_repository::SqliteUserProfileRepository::open_in_memory().unwrap(),
        );
        let mut config = crate::config::Config::default();
        config.scheduler.http_base_url = Some(format!("http://{}", addr));
        config.scheduler.correction_api_token = Some("server-side-secret".into());
        let state = crate::AppState {
            tenant_manager: Arc::new(crate::tenant::TenantManager::new()),
            rate_limiter: Arc::new(crate::rate_limit::RateLimiter::new()),
            scheduler_client: Arc::new(crate::scheduler_client::SchedulerClient::new(
                config.scheduler.url.clone(),
            )),
            profile_repo,
            lexicon: None,
            config,
        };
        let auth = AuthContext {
            tenant_id: "tenant-t".into(),
            user_id: "user-authoritative".into(),
        };
        let req = BrowserCorrectionRequest {
            session_id: "s-ABCDEF12".into(),
            utterance_index: 3,
            system_text: "系统".into(),
            corrected_text: "纠正".into(),
            client_correction_id: "client-idem-1".into(),
            source_profile_version: None,
            pipeline_version: Some("v4".into()),
            user_id: Some("forged-user".into()),
        };
        let resp = proxy_correction_to_scheduler(&state, &auth, req)
            .await
            .expect("proxy ok");
        assert_eq!(resp.correction_id, "corr-mock-1");
        assert!(!resp.duplicate);

        let (auth_hdr, body) = captured.lock().unwrap().clone().unwrap();
        assert_eq!(auth_hdr, "Bearer server-side-secret");
        assert_eq!(body["user_id"], "user-authoritative");
        assert_eq!(body["idempotency_key"], "client-idem-1");
        assert_eq!(body["session_id"], "s-ABCDEF12");
        assert_eq!(body["utterance_index"], 3);
    }

    #[tokio::test]
    async fn proxy_scheduler_unavailable_is_controlled() {
        let profile_repo = Arc::new(
            crate::user_profile_repository::SqliteUserProfileRepository::open_in_memory().unwrap(),
        );
        let mut config = crate::config::Config::default();
        // Closed port
        config.scheduler.http_base_url = Some("http://127.0.0.1:9".into());
        config.scheduler.correction_api_token = Some("t".into());
        let state = crate::AppState {
            tenant_manager: Arc::new(crate::tenant::TenantManager::new()),
            rate_limiter: Arc::new(crate::rate_limit::RateLimiter::new()),
            scheduler_client: Arc::new(crate::scheduler_client::SchedulerClient::new(
                config.scheduler.url.clone(),
            )),
            profile_repo,
            lexicon: None,
            config,
        };
        let auth = AuthContext {
            tenant_id: "t".into(),
            user_id: "u".into(),
        };
        let req = BrowserCorrectionRequest {
            session_id: "s-ABCDEF12".into(),
            utterance_index: 1,
            system_text: "a".into(),
            corrected_text: "b".into(),
            client_correction_id: "c".into(),
            source_profile_version: None,
            pipeline_version: None,
            user_id: None,
        };
        let err = proxy_correction_to_scheduler(&state, &auth, req)
            .await
            .unwrap_err();
        assert_eq!(err.0, axum::http::StatusCode::BAD_GATEWAY);
        assert!(err.1.contains("SCHEDULER_UNAVAILABLE"));
    }
}
