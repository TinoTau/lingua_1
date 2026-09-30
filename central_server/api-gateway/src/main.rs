use anyhow::Result;
use axum::{
    extract::{ws::WebSocketUpgrade, State},
    middleware,
    response::Response,
    routing::get,
    Router,
};
use std::net::SocketAddr;
use std::sync::Arc;
use tracing::info;
use uuid::Uuid;

use lingua_api_gateway::auth;
use lingua_api_gateway::config::Config;
use lingua_api_gateway::rate_limit::RateLimiter;
use lingua_api_gateway::rest_api::create_rest_router;
use lingua_api_gateway::scheduler_client::SchedulerClient;
use lingua_api_gateway::session_proxy::handle_session_proxy;
use lingua_api_gateway::tenant::TenantManager;
use lingua_api_gateway::user_identity::AuthContext;
use lingua_api_gateway::user_profile_repository::SqliteUserProfileRepository;
use lingua_api_gateway::ws_api::handle_public_websocket;
use lingua_api_gateway::AppState;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    info!("启动 Lingua API Gateway / Web User Gateway...");

    let config = Config::load()?;
    info!(
        port = config.server.port,
        scheduler_url = %config.scheduler.url,
        profile_db = %config.persistence.user_profile_db_path,
        correction_token_configured = config
            .scheduler
            .correction_api_token
            .as_ref()
            .map(|t| !t.is_empty())
            .unwrap_or(false)
            || std::env::var("LINGUA_CORRECTION_API_TOKEN").is_ok(),
        "配置加载成功 (secrets redacted)"
    );

    let tenant_manager = Arc::new(TenantManager::new());
    let rate_limiter = Arc::new(RateLimiter::new());
    let scheduler_client = Arc::new(SchedulerClient::new(config.scheduler.url.clone()));
    let profile_repo = Arc::new(SqliteUserProfileRepository::open(
        &config.persistence.user_profile_db_path,
    )?);
    let lexicon = lingua_api_gateway::lexicon_readonly::try_open_lexicon(
        config.persistence.lexicon_db_path.as_deref(),
    );

    let app_state = AppState {
        tenant_manager,
        rate_limiter,
        scheduler_client,
        profile_repo,
        lexicon,
        config: config.clone(),
    };

    let default_api_key =
        std::env::var("LINGUA_API_KEY").unwrap_or_else(|_| Uuid::new_v4().to_string());
    let default_tenant = app_state
        .tenant_manager
        .create_tenant("default".to_string(), default_api_key.clone())
        .await;
    info!(
        "默认租户已创建: tenant_id={}, api_key_len={} (api_key redacted; 仅开发/测试)",
        default_tenant.tenant_id,
        default_api_key.len()
    );

    let protected = Router::new()
        .route("/v1/stream", get(handle_ws_stream))
        .route("/v1/session", get(handle_ws_session))
        .merge(create_rest_router())
        .route_layer(middleware::from_fn_with_state(
            app_state.clone(),
            auth::auth_middleware,
        ));

    let app = Router::new()
        .route("/health", get(health_check))
        .merge(protected)
        .with_state(app_state);

    let addr = SocketAddr::from(([0, 0, 0, 0], config.server.port));
    info!("API Gateway 监听地址: {} (session proxy: /v1/session)", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn handle_ws_stream(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    axum::extract::Extension(tenant_id): axum::extract::Extension<String>,
) -> Response {
    ws.on_upgrade(move |socket| handle_public_websocket(socket, tenant_id, state))
}

async fn handle_ws_session(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    axum::extract::Extension(auth): axum::extract::Extension<AuthContext>,
) -> Response {
    ws.on_upgrade(move |socket| handle_session_proxy(socket, auth, state))
}

async fn health_check() -> &'static str {
    "OK"
}
