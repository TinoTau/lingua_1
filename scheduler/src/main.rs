use anyhow::Result;
use axum::{
    extract::ws::WebSocketUpgrade,
    response::Response,
    routing::get,
    Router,
};
use std::net::SocketAddr;
use tracing::{info, error};
use tracing_subscriber;

mod config;
mod messages;
mod session;
mod dispatcher;
mod node_registry;
mod pairing;
mod model_hub;
mod websocket;

// 临时定义 AppState，稍后移到单独文件
use session::SessionManager;
use dispatcher::JobDispatcher;
use node_registry::NodeRegistry;
use pairing::PairingService;
use model_hub::ModelHub;

use config::Config;
use websocket::handle_websocket;

#[tokio::main]
async fn main() -> Result<()> {
    // 初始化日志
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    info!("启动 Lingua 调度服务器...");

    // 加载配置
    let config = Config::load()?;
    info!("配置加载成功: {:?}", config);

    // 初始化各个模块
    let session_manager = SessionManager::new();
    let node_registry = std::sync::Arc::new(NodeRegistry::new());
    let dispatcher = JobDispatcher::new(node_registry.clone());
    let pairing_service = PairingService::new();
    let model_hub = ModelHub::new(&config.model_hub)?;

    // 创建应用状态
    let app_state = AppState {
        session_manager,
        dispatcher,
        node_registry,
        pairing_service,
        model_hub,
    };

    // 构建路由
    let app = Router::new()
        .route("/ws/session", get(handle_session_ws))
        .route("/ws/node", get(handle_node_ws))
        .route("/health", get(health_check))
        .route("/api/v1/models", get(list_models))
        .with_state(app_state);

    // 启动服务器
    let addr = SocketAddr::from(([0, 0, 0, 0], config.server.port));
    info!("调度服务器监听地址: {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

// 应用状态
#[derive(Clone)]
pub struct AppState {
    pub session_manager: SessionManager,
    pub dispatcher: JobDispatcher,
    pub node_registry: std::sync::Arc<NodeRegistry>,
    pub pairing_service: PairingService,
    pub model_hub: ModelHub,
}

// WebSocket 处理函数
async fn handle_session_ws(
    ws: WebSocketUpgrade,
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Response {
    ws.on_upgrade(|socket| handle_websocket::handle_session(socket, state))
}

async fn handle_node_ws(
    ws: WebSocketUpgrade,
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Response {
    ws.on_upgrade(|socket| handle_websocket::handle_node(socket, state))
}

// 健康检查
async fn health_check() -> &'static str {
    "OK"
}

// 模型列表 API
async fn list_models(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> axum::Json<serde_json::Value> {
    // TODO: 实现模型列表查询
    axum::Json(serde_json::json!({
        "models": []
    }))
}

