use anyhow::Result;
use axum::{
    extract::ws::WebSocketUpgrade,
    response::Response,
    routing::get,
    Router,
};
use std::net::SocketAddr;
use std::path::PathBuf;
use tracing::info;
use tracing_subscriber;
use tracing_subscriber::filter::EnvFilter;
use tracing_subscriber::fmt::time::UtcTime;
use tracing_appender::non_blocking;
use file_rotate::{compression::Compression, suffix::{AppendTimestamp, FileLimit}, ContentLimit, FileRotate};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::Layer;

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
mod room_manager;

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
use room_manager::RoomManager;

#[tokio::main]
async fn main() -> Result<()> {
    // 加载日志配置（支持模块级日志开关）
    let logging_config = logging_config::LoggingConfig::load();
    
    // 构建日志过滤器（合并配置文件和环境变量）
    let env_filter = logging_config.build_env_filter();
    
    // 创建日志目录
    let log_dir = PathBuf::from("logs");
    std::fs::create_dir_all(&log_dir)?;
    let log_path = log_dir.join("scheduler.log");
    
    // 配置文件日志（所有级别，附带时间戳，按 5MB 轮转，保留最近 5 个）
    let rotating_appender = FileRotate::new(
        log_path,
        AppendTimestamp::default(FileLimit::MaxFiles(5)),
        ContentLimit::Bytes(5 * 1024 * 1024),
        Compression::None,
    );
    let (non_blocking_appender, guard) = non_blocking(rotating_appender);
    
    // 文件日志格式（完整信息，使用完整的过滤器）
    let file_layer = tracing_subscriber::fmt::layer()
        .with_timer(UtcTime::rfc_3339())
        .with_writer(non_blocking_appender)
        .with_target(true)
        .with_thread_ids(true)
        .with_file(true)
        .with_line_number(true)
        .with_level(true)
        .with_ansi(false)
        .json()
        .with_filter(env_filter.clone());
    
    // 终端日志格式（显示 INFO 及以上级别，简洁格式）
    let console_filter = EnvFilter::new("info");
    let stderr_layer = tracing_subscriber::fmt::layer()
        .with_writer(std::io::stderr)
        .with_target(false)
        .with_thread_ids(false)
        .with_thread_names(false)
        .with_file(false)
        .with_line_number(false)
        .with_level(true)
        .without_time()
        .compact()
        .with_filter(console_filter);
    
    // 初始化日志系统（文件 + 终端 INFO 及以上）
    tracing_subscriber::registry()
        .with(file_layer)
        .with(stderr_layer)
        .init();
    
    // 保持 guard 不被释放（确保日志缓冲区被刷新）
    // 使用 Box::leak 确保 guard 在程序运行期间一直存在
    Box::leak(Box::new(guard));

    info!("启动 Lingua 调度服务器...");
    
    // 加载配置
    let config = Config::load()?;
    info!("配置加载成功");

    // 明确记录服务监听地址和端口，方便排查
    info!("  服务器监听地址: {}:{}", config.server.host, config.server.port);
    let http_url = format!("http://{}:{}", config.server.host, config.server.port);
    let session_ws_url = format!("ws://{}:{}/ws/session", config.server.host, config.server.port);
    let node_ws_url = format!("ws://{}:{}/ws/node", config.server.host, config.server.port);
    info!("  HTTP 服务 URL: {}", http_url);
    info!("  会话 WebSocket: {}", session_ws_url);
    info!("  节点 WebSocket: {}", node_ws_url);
    info!("  模型中心: {} (存储路径: {})", config.model_hub.base_url, config.model_hub.storage_path.display());
    info!("  调度器: 每节点最大并发任务={}, 任务超时={}秒, 心跳间隔={}秒", 
        config.scheduler.max_concurrent_jobs_per_node,
        config.scheduler.job_timeout_seconds,
        config.scheduler.heartbeat_interval_seconds);
    info!("  负载均衡: 策略={}, 资源阈值={}%", 
        config.scheduler.load_balancer.strategy,
        config.scheduler.load_balancer.resource_threshold);
    info!("  节点健康: 心跳超时={}秒, 健康检查次数={}, 预热超时={}秒, 扫描间隔={}秒",
        config.scheduler.node_health.heartbeat_timeout_seconds,
        config.scheduler.node_health.health_check_count,
        config.scheduler.node_health.warmup_timeout_seconds,
        config.scheduler.node_health.status_scan_interval_seconds);

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

    // 初始化 RoomManager
    let room_manager = RoomManager::new();

    // 创建应用状态
    let app_state = AppState {
        session_manager,
        dispatcher,
        node_registry,
        pairing_service,
        model_hub,
        session_connections: session_connections.clone(),
        node_connections,
        result_queue,
        audio_buffer,
        group_manager,
        node_status_manager,
        room_manager: room_manager.clone(),
    };
    
    // 启动房间过期清理任务（每1分钟扫描一次）
    let app_state_for_cleanup = app_state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(60));
        loop {
            interval.tick().await;
            let expired_rooms = app_state_for_cleanup.room_manager.cleanup_expired_rooms().await;
            if !expired_rooms.is_empty() {
                info!("清理了 {} 个过期房间", expired_rooms.len());
                
                // 向房间成员发送 room_expired 消息
                for (room_code, members) in expired_rooms {
                    let expired_msg = crate::messages::SessionMessage::RoomExpired {
                        room_code: room_code.clone(),
                        message: "30分钟无人发言，房间已过期".to_string(),
                    };
                    let expired_json = serde_json::to_string(&expired_msg).unwrap_or_default();
                    
                    for member in members {
                        if let Some(member_tx) = app_state_for_cleanup.session_connections.get(&member.session_id).await {
                            let _ = member_tx.send(axum::extract::ws::Message::Text(expired_json.clone()));
                        }
                    }
                }
            }
        }
    });

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

