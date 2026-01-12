use axum::{
    extract::{Request, State},
    middleware::Next,
    response::Response,
};

use crate::AppState;

pub async fn auth_middleware(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Result<Response, axum::http::StatusCode> {
    // 从 Header 中提取 API Key
    let api_key = req.headers()
        .get("Authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(|s| s.to_string());

    let api_key = api_key.ok_or(axum::http::StatusCode::UNAUTHORIZED)?;

    let tenant_id = state
        .tenant_manager
        .validate_api_key(&api_key)
        .await
        .ok_or(axum::http::StatusCode::UNAUTHORIZED)?;

    // 限流（按租户）
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

    // 将 tenant_id 放入请求扩展中，供 handler 使用
    req.extensions_mut().insert(tenant_id);
    Ok(next.run(req).await)
}

