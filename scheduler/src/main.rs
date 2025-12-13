use anyhow::Result;
use axum::{
    extract::ws::WebSocketUpgrade,
    response::Response,
    routing::get,
    Router,
};
use std::net::SocketAddr;
use tracing::info;
use tracing_subscriber;

mod config;
mod messages;
mod session;
mod dispatcher;
mod node_registry;
mod pairing;
mod model_hub;
mod websocket;
mod connection_manager;
mod result_queue;
mod app_state;
mod audio_buffer;
mod module_resolver;
mod logging_config;
mod group_manager;
mod node_status_manager;

use session::SessionManager;
use dispatcher::JobDispatcher;
use node_registry::NodeRegistry;
use pairing::PairingService;
use model_hub::ModelHub;

use config::Config;
use websocket::{handle_session, handle_node};
use connection_manager::{SessionConnectionManager, NodeConnectionManager};
use result_queue::ResultQueueManager;
use app_state::AppState;
use audio_buffer::AudioBufferManager;
use group_manager::{GroupManager, GroupConfig};
use node_status_manager::NodeStatusManager;

#[tokio::main]
async fn main() -> Result<()> {
    // 加载日志配置（支持模块级日志开关）
    let logging_config = logging_config::LoggingConfig::load();
    
    // 构建日志过滤器（合并配置文件和环境变量）
    let env_filter = logging_config.build_env_filter();
    
    // 初始化日志（JSON 格式）
    // 使用环境变量 LOG_FORMAT 控制输出格式：json（默认）或 pretty
    // 日志级别由配置文件（observability.json）或环境变量（RUST_LOG）控制
    let log_format = std::env::var("LOG_FORMAT").unwrap_or_else(|_| "json".to_string());
    
    if log_format == "pretty" {
        // Pretty 格式（用于开发调试）
        tracing_subscriber::fmt()
            .with_env_filter(env_filter)
            .init();
    } else {
        // JSON 格式（用于生产环境）
        tracing_subscriber::fmt()
            .json()
            .with_env_filter(env_filter)
            .with_current_span(false)
            .with_span_list(false)
            .init();
    }

    info!("启动 Lingua 调度服务器...");

    // 加载配置
    let config = Config::load()?;
    info!("配置加载成功: {:?}", config);

    // 初始化各个模块
    let session_manager = SessionManager::new();
    let resource_threshold = config.scheduler.load_balancer.resource_threshold;
    let node_registry = std::sync::Arc::new(NodeRegistry::with_resource_threshold(resource_threshold));
    let dispatcher = JobDispatcher::new(node_registry.clone());
    let pairing_service = PairingService::new();
    let model_hub = ModelHub::new(&config.model_hub)?;
    let session_connections = SessionConnectionManager::new();
    let node_connections = NodeConnectionManager::new();
    let result_queue = ResultQueueManager::new();
    let audio_buffer = AudioBufferManager::new();
    
    // 初始化 GroupManager（使用默认配置）
    let group_config = GroupConfig::default();
    let group_manager = GroupManager::new(group_config);
    
    // 初始化 NodeStatusManager
    let node_status_manager = NodeStatusManager::new(
        node_registry.clone(),
        std::sync::Arc::new(node_connections.clone()),
        config.scheduler.node_health.clone(),
    );
    
    // 启动定期扫描任务
    node_status_manager.start_periodic_scan();

    // 创建应用状态
    let app_state = AppState {
        session_manager,
        dispatcher,
        node_registry,
        pairing_service,
        model_hub,
        session_connections,
        node_connections,
        result_queue,
        audio_buffer,
        group_manager,
        node_status_manager,
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


// WebSocket 处理函数
async fn handle_session_ws(
    ws: WebSocketUpgrade,
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Response {
    ws.on_upgrade(|socket| handle_session(socket, state))
}

async fn handle_node_ws(
    ws: WebSocketUpgrade,
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Response {
    ws.on_upgrade(|socket| handle_node(socket, state))
}

// 健康检查
async fn health_check() -> &'static str {
    "OK"
}

// 模型列表 API
async fn list_models(
    axum::extract::State(_state): axum::extract::State<AppState>,
) -> axum::Json<serde_json::Value> {
    // TODO: 实现模型列表查询
    axum::Json(serde_json::json!({
        "models": []
    }))
}

