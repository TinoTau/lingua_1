use anyhow::Result;
use axum::{
    extract::{ws::WebSocketUpgrade, State},
    http::StatusCode,
    response::Response,
    routing::get,
    Router,
};
use std::net::SocketAddr;
use std::sync::Arc;
use tracing::{info, error};
use tracing_subscriber;

mod config;
mod tenant;
mod auth;
mod rate_limit;
mod scheduler_client;
mod rest_api;
mod ws_api;

use config::Config;
use tenant::TenantManager;
use rate_limit::RateLimiter;
use scheduler_client::SchedulerClient;
use rest_api::create_rest_router;
use ws_api::handle_public_websocket;

#[derive(Clone)]
pub struct AppState {
    pub tenant_manager: Arc<TenantManager>,
    pub rate_limiter: Arc<RateLimiter>,
    pub scheduler_client: Arc<SchedulerClient>,
    pub config: Config,
}

// 从请求扩展中提取 tenant_id
#[derive(Clone)]
struct TenantId(String);

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    info!("启动 Lingua API Gateway...");

    let config = Config::load()?;
    info!("配置加载成功: {:?}", config);

    let tenant_manager = Arc::new(TenantManager::new());
    let rate_limiter = Arc::new(RateLimiter::new());
    let scheduler_client = Arc::new(SchedulerClient::new(config.scheduler.url.clone()));

    let app_state = AppState {
        tenant_manager,
        rate_limiter,
        scheduler_client,
        config: config.clone(),
    };

    let app = Router::new()
        .route("/v1/stream", get(handle_ws))
        .merge(create_rest_router())
        .with_state(app_state);

    let addr = SocketAddr::from(([0, 0, 0, 0], config.server.port));
    info!("API Gateway 监听地址: {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn handle_ws(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    axum::extract::Extension(tenant_id): axum::extract::Extension<String>,
) -> Response {
    ws.on_upgrade(move |socket| handle_public_websocket(socket, tenant_id, state))
}

