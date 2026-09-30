//! Bidirectional WebSocket session proxy: Browser ↔ Scheduler.
//! Injects server-owned user_id + UserProfile into session_init (Browser cannot forge identity).

use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio_tungstenite::{connect_async, tungstenite::Message as TMessage};
use tracing::{error, info, warn};

use crate::user_identity::{AuthContext, User};
use crate::user_profile_repository::UserProfileRepository;
use crate::AppState;

pub async fn handle_session_proxy(socket: WebSocket, auth: AuthContext, state: AppState) {
    let scheduler_url = state.config.scheduler.url.clone();
    let (mut client_tx, mut client_rx) = socket.split();

    let (scheduler_ws, _) = match connect_async(&scheduler_url).await {
        Ok(v) => v,
        Err(e) => {
            error!(error = %e, "session proxy: failed to connect scheduler");
            let _ = client_tx
                .send(Message::Text(
                    json!({"type":"error","code":"SCHEDULER_UNAVAILABLE","message": e.to_string()})
                        .to_string(),
                ))
                .await;
            return;
        }
    };
    let (mut sched_tx, mut sched_rx) = scheduler_ws.split();

    let user = User {
        user_id: auth.user_id.clone(),
        tenant_id: auth.tenant_id.clone(),
        display_name: format!("user:{}", auth.user_id),
        created_at: chrono::Utc::now(),
    };
    let profile = match state.profile_repo.get_or_create_default(&user) {
        Ok(p) => p,
        Err(e) => {
            let _ = client_tx
                .send(Message::Text(
                    json!({"type":"error","code":"PROFILE_ERROR","message": e.to_string()}).to_string(),
                ))
                .await;
            return;
        }
    };
    let profile_version = profile.profile_version;
    let profile_value = match serde_json::to_value(&profile) {
        Ok(v) => v,
        Err(e) => {
            let _ = client_tx
                .send(Message::Text(
                    json!({"type":"error","code":"PROFILE_SERIALIZE","message": e.to_string()})
                        .to_string(),
                ))
                .await;
            return;
        }
    };

    info!(
        user_id = %auth.user_id,
        tenant_id = %auth.tenant_id,
        profile_version = profile_version,
        "session proxy connected; will inject UserProfile on session_init"
    );

    let auth_c = auth.clone();
    let profile_value_c = profile_value.clone();
    let forward_client_to_sched = async move {
        while let Some(msg) = client_rx.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    let forwarded = inject_identity_into_session_init(
                        &text,
                        &auth_c,
                        profile_version,
                        &profile_value_c,
                    );
                    if let Err(e) = sched_tx.send(TMessage::Text(forwarded)).await {
                        warn!(error = %e, "proxy: scheduler send failed");
                        break;
                    }
                }
                Ok(Message::Binary(bin)) => {
                    if let Err(e) = sched_tx.send(TMessage::Binary(bin)).await {
                        warn!(error = %e, "proxy: scheduler binary send failed");
                        break;
                    }
                }
                Ok(Message::Ping(p)) => {
                    let _ = sched_tx.send(TMessage::Ping(p)).await;
                }
                Ok(Message::Pong(p)) => {
                    let _ = sched_tx.send(TMessage::Pong(p)).await;
                }
                Ok(Message::Close(_)) | Err(_) => break,
            }
        }
    };

    let forward_sched_to_client = async move {
        while let Some(msg) = sched_rx.next().await {
            match msg {
                Ok(TMessage::Text(text)) => {
                    if client_tx.send(Message::Text(text)).await.is_err() {
                        break;
                    }
                }
                Ok(TMessage::Binary(bin)) => {
                    if client_tx.send(Message::Binary(bin)).await.is_err() {
                        break;
                    }
                }
                Ok(TMessage::Ping(p)) => {
                    let _ = client_tx.send(Message::Ping(p)).await;
                }
                Ok(TMessage::Pong(p)) => {
                    let _ = client_tx.send(Message::Pong(p)).await;
                }
                Ok(TMessage::Close(_)) | Err(_) => break,
                _ => {}
            }
        }
    };

    tokio::select! {
        _ = forward_client_to_sched => {},
        _ = forward_sched_to_client => {},
    }
}

/// Inject server identity/profile into session_init. Strip any client-supplied user_id/user_profile.
pub fn inject_identity_into_session_init(
    text: &str,
    auth: &AuthContext,
    profile_version: u64,
    profile_value: &Value,
) -> String {
    let mut v: Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => return text.to_string(),
    };
    if v.get("type").and_then(|t| t.as_str()) != Some("session_init") {
        return text.to_string();
    }
    if let Some(obj) = v.as_object_mut() {
        // Never trust client identity fields
        obj.remove("user_id");
        obj.remove("user_profile");
        obj.remove("profile_version");
        obj.insert("user_id".into(), json!(auth.user_id));
        obj.insert("tenant_id".into(), json!(auth.tenant_id));
        obj.insert("profile_version".into(), json!(profile_version));
        obj.insert("user_profile".into(), profile_value.clone());
        // Ensure gateway platform tag if missing
        if !obj.contains_key("platform") {
            obj.insert("platform".into(), json!("web"));
        }
    }
    v.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::user_identity::AuthContext;

    #[test]
    fn injects_and_strips_forged_user() {
        let auth = AuthContext {
            tenant_id: "tenant-1".into(),
            user_id: "user-real".into(),
        };
        let profile = json!({"schema_version":1,"profile_version":0});
        let input = json!({
            "type": "session_init",
            "client_version": "1",
            "platform": "web",
            "src_lang": "zh",
            "tgt_lang": "en",
            "user_id": "user-forged",
            "user_profile": {"schema_version":1,"profile_version":99}
        })
        .to_string();
        let out: Value = serde_json::from_str(&inject_identity_into_session_init(
            &input, &auth, 0, &profile,
        ))
        .unwrap();
        assert_eq!(out["user_id"], "user-real");
        assert_eq!(out["tenant_id"], "tenant-1");
        assert_eq!(out["profile_version"], 0);
        assert_eq!(out["user_profile"]["profile_version"], 0);
    }

    #[test]
    fn non_init_passthrough() {
        let auth = AuthContext {
            tenant_id: "t".into(),
            user_id: "u".into(),
        };
        let s = r#"{"type":"utterance","session_id":"s"}"#;
        assert_eq!(
            inject_identity_into_session_init(s, &auth, 0, &json!({})),
            s
        );
    }
}
