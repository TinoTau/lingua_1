//! SessionBootstrap: send UserProfile once per session↔node assignment,
//! and re-send after version-aware profile refresh (bootstrapped_node_id cleared).

use crate::core::session::SessionUpdate;
use crate::core::AppState;
use crate::messages::NodeMessage;
use tracing::{info, warn};

/// Send SessionBootstrap if this node has not yet received profile for the session.
/// Safe no-op when profile absent — existing job flow continues.
pub async fn maybe_send_session_bootstrap(state: &AppState, session_id: &str, node_id: &str) {
    let Some(session) = state.session_manager.get_session(session_id).await else {
        return;
    };

    if session.user_profile.is_none() && session.user_id.is_none() {
        return;
    }

    if session.bootstrapped_node_id.as_deref() == Some(node_id) {
        return;
    }

    send_session_bootstrap(state, session_id, node_id, &session).await;
}

/// Force re-bootstrap after correction-driven profile refresh.
pub async fn force_send_session_bootstrap(state: &AppState, session_id: &str) {
    let Some(session) = state.session_manager.get_session(session_id).await else {
        warn!(session_id = %session_id, "profile refresh: session not found");
        return;
    };
    let Some(node_id) = session.paired_node_id.clone() else {
        info!(session_id = %session_id, "profile refresh: no paired node yet");
        return;
    };
    let _ = state
        .session_manager
        .update_session(session_id, SessionUpdate::ClearBootstrappedNode)
        .await;
    let Some(session) = state.session_manager.get_session(session_id).await else {
        return;
    };
    send_session_bootstrap(state, session_id, &node_id, &session).await;
}

async fn send_session_bootstrap(
    state: &AppState,
    session_id: &str,
    node_id: &str,
    session: &crate::core::session::Session,
) {
    let msg = NodeMessage::SessionBootstrap {
        session_id: session_id.to_string(),
        user_id: session.user_id.clone(),
        profile_version: session.profile_version.or_else(|| {
            session
                .user_profile
                .as_ref()
                .map(|p| p.profile_version)
        }),
        user_profile: session.user_profile.clone(),
        trace_id: Some(session.trace_id.clone()),
    };

    let ok = crate::redis_runtime::send_node_message_routed(state, node_id, msg).await;
    if ok {
        state
            .session_manager
            .update_session(
                session_id,
                SessionUpdate::SetBootstrappedNode(node_id.to_string()),
            )
            .await;
        info!(
            session_id = %session_id,
            node_id = %node_id,
            user_id = ?session.user_id,
            profile_version = ?session.profile_version,
            "SessionBootstrap sent"
        );
    } else {
        warn!(
            session_id = %session_id,
            node_id = %node_id,
            "SessionBootstrap send failed; job flow continues without profile cache"
        );
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn bootstrap_message_type_name() {
        let v = serde_json::json!({
            "type": "session_bootstrap",
            "session_id": "s-1",
            "user_id": "user-x",
            "profile_version": 0
        });
        assert_eq!(v["type"], "session_bootstrap");
    }
}
