use axum::{
    extract::{Request, State},
    middleware::Next,
    response::Response,
};

use crate::user_identity::{derive_stable_user_id, AuthContext, User};
use crate::user_profile_repository::UserProfileRepository;
use crate::AppState;

fn extract_api_key(req: &Request) -> Option<String> {
    if let Some(api_key) = req
        .headers()
        .get("Authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(|s| s.to_string())
    {
        return Some(api_key);
    }
    // Browser WebSocket cannot set Authorization headers — allow query token.
    let q = req.uri().query().unwrap_or("");
    for pair in q.split('&') {
        let mut it = pair.splitn(2, '=');
        let k = it.next().unwrap_or("");
        let v = it.next().unwrap_or("");
        if (k == "access_token" || k == "api_key") && !v.is_empty() {
            return Some(v.replace("%2D", "-").replace("%2d", "-"));
        }
    }
    None
}

pub async fn auth_middleware(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Result<Response, axum::http::StatusCode> {
    let api_key = extract_api_key(&req).ok_or(axum::http::StatusCode::UNAUTHORIZED)?;

    let tenant_id = state
        .tenant_manager
        .validate_api_key(&api_key)
        .await
        .ok_or(axum::http::StatusCode::UNAUTHORIZED)?;

    let max_rps = state
        .tenant_manager
        .get_tenant(&tenant_id)
        .await
        .map(|t| t.max_requests_per_second)
        .unwrap_or(state.config.rate_limit.default_max_rps);

    state
        .rate_limiter
        .check_rate_limit(&tenant_id, max_rps)
        .map_err(|_| axum::http::StatusCode::TOO_MANY_REQUESTS)?;

    let user_id = derive_stable_user_id(&tenant_id, &api_key);
    let user = User {
        user_id: user_id.clone(),
        tenant_id: tenant_id.clone(),
        display_name: format!("user:{}", user_id),
        created_at: chrono::Utc::now(),
    };
    let _ = state.profile_repo.get_or_create_default(&user);

    let auth = AuthContext {
        tenant_id: tenant_id.clone(),
        user_id,
    };

    req.extensions_mut().insert(tenant_id);
    req.extensions_mut().insert(auth);
    Ok(next.run(req).await)
}
