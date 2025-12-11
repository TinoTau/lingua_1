use axum::{
    extract::Request,
    middleware::Next,
    response::Response,
};
use crate::AppState;

pub async fn auth_middleware(
    mut req: Request,
    next: Next,
) -> Result<Response, axum::http::StatusCode> {
    // 从 Header 中提取 API Key
    let api_key = req.headers()
        .get("Authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(|s| s.to_string());

    if let Some(api_key) = api_key {
        // 从 AppState 获取 TenantManager
        let state = req.extensions()
            .get::<AppState>()
            .ok_or(axum::http::StatusCode::INTERNAL_SERVER_ERROR)?;

        if let Some(tenant_id) = state.tenant_manager.validate_api_key(&api_key).await {
            // 将 tenant_id 放入请求扩展中
            req.extensions_mut().insert(tenant_id);
            return Ok(next.run(req).await);
        }
    }

    Err(axum::http::StatusCode::UNAUTHORIZED)
}

