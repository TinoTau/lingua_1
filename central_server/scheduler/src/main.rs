use anyhow::Result;
use axum::{
    extract::ws::WebSocketUpgrade,
    response::Response,
    routing::get,
    Router,
};
use axum::extract::Query;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;
use tracing::info;
use tracing_subscriber;
use tracing_subscriber::filter::EnvFilter;
use tracing_subscriber::fmt::time::UtcTime;
use tracing_appender::non_blocking;
use file_rotate::{compression::Compression, suffix::{AppendTimestamp, FileLimit}, ContentLimit, FileRotate};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::Layer;

mod core;
mod messages;
mod node_registry;
mod websocket;
mod utils;
mod managers;
mod services;
mod metrics;
mod timeout;
mod model_not_available;
mod phase2;
mod phase3;

use core::{AppState, Config, JobDispatcher, SessionManager};
use managers::{
    AudioBufferManager, GroupManager, GroupConfig, NodeStatusManager,
    ResultQueueManager, RoomManager, SessionConnectionManager, NodeConnectionManager,
};
use services::{ModelHub, PairingService, ServiceCatalogCache};
use metrics::{DashboardSnapshotCache, collect};
use timeout::start_job_timeout_manager;
use model_not_available::start_worker;
use node_registry::NodeRegistry;
use websocket::{handle_session, handle_node};
use phase2::Phase2Runtime;

#[tokio::main]
async fn main() -> Result<()> {
    // 加载日志配置（支持模块级日志开关）
    let logging_config = utils::LoggingConfig::load();
    
    // 构建日志过滤器（合并配置文件和环境变量）
    let env_filter = logging_config.build_env_filter();
    
    // 创建日志目录
    let log_dir = PathBuf::from("logs");
    std::fs::create_dir_all(&log_dir)?;
    let log_path = log_dir.join("scheduler.log");
    
    // 配置文件日志（所有级别，附带时间戳，按 5MB 轮转，保留最近 5 个）
    // file-rotate 在不同平台的 new() 签名不同：
    // - unix: 额外带一个 Option<u32>（文件权限 mode）
    // - windows: 无该参数
    #[cfg(unix)]
    let rotating_appender = FileRotate::new(
        log_path,
        AppendTimestamp::default(FileLimit::MaxFiles(5)),
        ContentLimit::Bytes(5 * 1024 * 1024),
        Compression::None,
        None,
    );
    #[cfg(not(unix))]
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

    // 方向A：设置观测阈值（锁等待/关键路径）
    metrics::observability::set_thresholds(
        config.scheduler.observability.lock_wait_warn_ms,
        config.scheduler.observability.path_warn_ms,
    );

    // 方向B：初始化 Prometheus registry（/metrics）
    metrics::prometheus_metrics::init();

    // 明确记录服务监听地址和端口，方便排查
    info!("  服务器监听地址: {}:{}", config.server.host, config.server.port);
    let http_url = format!("http://{}:{}", config.server.host, config.server.port);
    let session_ws_url = format!("ws://{}:{}/ws/session", config.server.host, config.server.port);
    let node_ws_url = format!("ws://{}:{}/ws/node", config.server.host, config.server.port);
    info!("  HTTP 服务 URL: {}", http_url);
    info!("  会话 WebSocket: {}", session_ws_url);
    info!("  节点 WebSocket: {}", node_ws_url);
    info!("  模型中心: {} (存储路径: {})", config.model_hub.base_url, config.model_hub.storage_path.display());
    info!(
        "  调度器: 每节点最大并发任务={}, dispatched 超时={}秒, pending 超时={}秒, failover_max_attempts={}, 心跳间隔={}秒",
        config.scheduler.max_concurrent_jobs_per_node,
        config.scheduler.job_timeout_seconds,
        config.scheduler.job_timeout.pending_timeout_seconds,
        config.scheduler.job_timeout.failover_max_attempts,
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
    // Phase 1：核心服务包映射（用于 Phase3 pool 核心能力缓存/快速跳过）
    node_registry
        .set_core_services_config(config.scheduler.core_services.clone())
        .await;
    // Phase 3：两级调度配置（pool_count/hash_seed 等）
    node_registry.set_phase3_config(config.scheduler.phase3.clone()).await;
    let mut dispatcher = JobDispatcher::new_with_phase1_config(
        node_registry.clone(),
        config.scheduler.task_binding.clone(),
        config.scheduler.core_services.clone(),
    );
    let pairing_service = PairingService::new();
    let model_hub = ModelHub::new(&config.model_hub)?;
    // ServiceCatalog：优先走 ModelHub HTTP；若失败则可用本地 services_index.json 兜底（单机冷启动/离线）
    let local_services_index = config.model_hub.storage_path.join("services_index.json");
    let service_catalog = ServiceCatalogCache::new(config.model_hub.base_url.clone())
        .with_local_services_index_path(local_services_index);
    let dashboard_snapshot = DashboardSnapshotCache::new(Duration::from_secs(5));
    let (model_na_tx, model_na_rx) = tokio::sync::mpsc::unbounded_channel();
    let model_not_available_bus = model_not_available::ModelNotAvailableBus::new(model_na_tx);
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

    // Phase 2：Redis/多实例运行时（可选）
    let phase2_runtime = Phase2Runtime::new(
        config.scheduler.phase2.clone(),
        config.scheduler.heartbeat_interval_seconds,
    )
    .await?
    .map(std::sync::Arc::new);

    // Phase 2：将 runtime 注入 dispatcher（用于 request_id bind/lock + node reserved）
    dispatcher.set_phase2(phase2_runtime.clone());

    // 创建应用状态
    let app_state = AppState {
        session_manager,
        dispatcher,
        node_registry,
        pairing_service,
        model_hub,
        service_catalog,
        dashboard_snapshot,
        model_not_available_bus,
        core_services: config.scheduler.core_services.clone(),
        web_task_segmentation: config.scheduler.web_task_segmentation.clone(),
        session_connections: session_connections.clone(),
        node_connections,
        result_queue,
        audio_buffer,
        group_manager,
        node_status_manager,
        room_manager: room_manager.clone(),
        phase2: phase2_runtime.clone(),
    };

    // Phase 2：启动后台任务（presence + owner 续约 + Streams inbox）
    if let Some(rt) = phase2_runtime {
        let rt_for_log = rt.clone();
        rt.spawn_background_tasks(app_state.clone());
        info!(instance_id = %rt_for_log.instance_id, key_prefix = %rt_for_log.key_prefix(), "Phase2 已启用");
    }

    // Phase 1：Job 超时/重派管理（含 best-effort cancel）
    start_job_timeout_manager(
        app_state.clone(),
        config.scheduler.job_timeout_seconds,
        config.scheduler.job_timeout.clone(),
        config.scheduler.task_binding.reserved_ttl_seconds,
    );

    // 启动后台缓存刷新：服务目录缓存 + Dashboard stats 快照缓存
    app_state.service_catalog.start_background_refresh();
    app_state.dashboard_snapshot.start_background_refresh(app_state.clone());

    // 启动 MODEL_NOT_AVAILABLE 后台处理（主路径只入队）
    start_worker(
        model_na_rx,
        app_state.node_registry.clone(),
        config.scheduler.model_not_available.clone(),
        app_state.phase2.clone(),
    );
    
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

    // 设置优雅关闭信号处理（需要在构建路由之前克隆）
    let app_state_for_shutdown = app_state.clone();
    
    // 构建路由
    let app = Router::new()
        .route("/ws/session", get(handle_session_ws))
        .route("/ws/node", get(handle_node_ws))
        .route("/health", get(health_check))
        .route("/api/v1/stats", get(get_stats))
        .route("/api/v1/phase3/pools", get(get_phase3_pools))
        .route("/api/v1/phase3/simulate", get(get_phase3_simulate))
        .route("/api/v1/metrics", get(get_metrics))
        .route("/metrics", get(get_prometheus_metrics))
        .route("/dashboard", get(serve_dashboard))
        .route("/compute-power", get(serve_compute_power))
        .route("/models", get(serve_models))
        .route("/languages", get(serve_languages))
        .with_state(app_state);

    // 启动服务器
    let addr = SocketAddr::from(([0, 0, 0, 0], config.server.port));
    info!("调度服务器监听地址: {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    let shutdown_signal = async move {
        tokio::signal::ctrl_c()
            .await
            .expect("无法安装 Ctrl+C 信号处理器");
        info!("收到关闭信号，开始优雅关闭...");
        
        // 清理节点连接
        let nodes = app_state_for_shutdown.node_registry.nodes.read().await;
        if !nodes.is_empty() {
            info!("清理 {} 个节点连接", nodes.len());
            let node_ids: Vec<String> = nodes.keys().cloned().collect();
            drop(nodes);
            for node_id in node_ids {
                app_state_for_shutdown.node_connections.unregister(&node_id).await;
                app_state_for_shutdown.node_registry.mark_node_offline(&node_id).await;
            }
        }
        
        info!("资源清理完成，等待连接关闭...");
    };
    
    // 使用优雅关闭启动服务器
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal)
        .await?;
    
    info!("调度服务器已优雅关闭");
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

// 统计API端点
async fn get_stats(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> impl axum::response::IntoResponse {
    let t0 = std::time::Instant::now();
    // v1.1 规范：请求路径不做现场生成；冷启动直接返回空快照，并触发一次后台刷新（SingleFlight + 频率限制）。
    if state.dashboard_snapshot.last_updated_at_ms().await == 0 {
        state.dashboard_snapshot.try_trigger_refresh_nonblocking(state.clone());
    }

    let json = state.dashboard_snapshot.get_json().await;
    let updated_at = state.dashboard_snapshot.last_updated_at_ms().await;
    let now_ms = chrono::Utc::now().timestamp_millis();
    let is_stale = updated_at == 0 || (now_ms - updated_at) > 10_000; // 简单阈值：>10s 视为 stale（Phase 1 先用经验值）
    metrics::metrics::on_stats_response(is_stale);
    metrics::prometheus_metrics::observe_stats_request_duration_seconds(t0.elapsed().as_secs_f64());
    (
        axum::http::StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        json,
    )
}

async fn get_metrics(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> axum::Json<metrics::metrics::MetricsSnapshot> {
    axum::Json(collect(&state).await)
}

#[derive(serde::Serialize)]
struct Phase3PoolsResponse {
    config: core::config::Phase3Config,
    pools: Vec<Phase3PoolEntry>,
}

#[derive(serde::Serialize)]
struct Phase3PoolEntry {
    pool_id: u16,
    #[serde(skip_serializing_if = "String::is_empty")]
    pool_name: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pool_required_services: Vec<String>,
    total_nodes: usize,
    online_nodes: usize,
    ready_nodes: usize,
    core_services_installed: std::collections::HashMap<String, usize>,
    core_services_ready: std::collections::HashMap<String, usize>,
    sample_node_ids: Vec<String>,
}

async fn get_phase3_pools(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> axum::Json<Phase3PoolsResponse> {
    let cfg = state.node_registry.phase3_config().await;
    let sizes: std::collections::HashMap<u16, usize> =
        state.node_registry.phase3_pool_sizes().await.into_iter().collect();
    let core_cache = state.node_registry.phase3_pool_core_cache_snapshot().await;

    // pool 列表来源：
    // - capability pools：使用 cfg.pools（可非连续 pool_id）
    // - hash pools：使用 0..pool_count
    let pool_defs: Vec<(u16, String, Vec<String>)> = if !cfg.pools.is_empty() {
        cfg.pools
            .iter()
            .map(|p| (p.pool_id, p.name.clone(), p.required_services.clone()))
            .collect()
    } else {
        let pool_count = cfg.pool_count.max(1);
        (0..pool_count).map(|pid| (pid, "".to_string(), vec![])).collect()
    };

    let mut pools: Vec<Phase3PoolEntry> = Vec::with_capacity(pool_defs.len());
    for (pid, name, reqs) in pool_defs {
        let total_nodes = sizes.get(&pid).copied().unwrap_or(0);
        let pc = core_cache
            .get(&pid)
            .cloned()
            .unwrap_or_default();

        // 只输出核心服务（低基数）
        let mut core_services_installed: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
        let mut core_services_ready: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
        if !state.core_services.asr_service_id.is_empty() {
            core_services_installed.insert(state.core_services.asr_service_id.clone(), pc.asr_installed);
            core_services_ready.insert(state.core_services.asr_service_id.clone(), pc.asr_ready);
        }
        if !state.core_services.nmt_service_id.is_empty() {
            core_services_installed.insert(state.core_services.nmt_service_id.clone(), pc.nmt_installed);
            core_services_ready.insert(state.core_services.nmt_service_id.clone(), pc.nmt_ready);
        }
        if !state.core_services.tts_service_id.is_empty() {
            core_services_installed.insert(state.core_services.tts_service_id.clone(), pc.tts_installed);
            core_services_ready.insert(state.core_services.tts_service_id.clone(), pc.tts_ready);
        }

        let sample_node_ids = state.node_registry.phase3_pool_sample_node_ids(pid, 5).await;
        pools.push(Phase3PoolEntry {
            pool_id: pid,
            pool_name: name,
            pool_required_services: reqs,
            total_nodes,
            online_nodes: pc.online_nodes,
            ready_nodes: pc.ready_nodes,
            core_services_installed,
            core_services_ready,
            sample_node_ids,
        });
    }

    pools.sort_by_key(|p| p.pool_id);
    axum::Json(Phase3PoolsResponse { config: cfg, pools })
}

#[derive(Debug, Deserialize)]
struct Phase3SimulateQuery {
    /// 显式指定 routing_key（优先级最高）
    routing_key: Option<String>,
    /// 便捷：与线上语义保持一致（若 routing_key 为空，则优先 tenant_id，其次 session_id）
    tenant_id: Option<String>,
    session_id: Option<String>,
    /// required service_id 列表（可重复传参）：?required=a&required=b
    #[serde(default)]
    required: Vec<String>,
    /// 语言仅用于日志/兼容现有选择函数参数，不影响 required 过滤本身
    src_lang: Option<String>,
    tgt_lang: Option<String>,
    /// 是否允许 public 节点（默认 true）
    accept_public: Option<bool>,
    /// 排除某个节点（可选）
    exclude_node_id: Option<String>,
}

#[derive(Debug, Serialize)]
struct Phase3SimulateResponse {
    routing_key: String,
    required: Vec<String>,
    selected_node_id: Option<String>,
    debug: node_registry::Phase3TwoLevelDebug,
    breakdown: node_registry::NoAvailableNodeBreakdown,
}

async fn get_phase3_simulate(
    axum::extract::State(state): axum::extract::State<AppState>,
    Query(q): Query<Phase3SimulateQuery>,
) -> axum::Json<Phase3SimulateResponse> {
    let routing_key = q
        .routing_key
        .or(q.tenant_id)
        .or(q.session_id)
        .unwrap_or_else(|| "default".to_string());
    let src_lang = q.src_lang.unwrap_or_else(|| "zh".to_string());
    let tgt_lang = q.tgt_lang.unwrap_or_else(|| "en".to_string());
    let accept_public = q.accept_public.unwrap_or(true);
    let exclude = q.exclude_node_id.as_deref();

    let (nid, dbg, bd) = state
        .node_registry
        .select_node_with_models_two_level_excluding_with_breakdown(
            &routing_key,
            &src_lang,
            &tgt_lang,
            &q.required,
            accept_public,
            exclude,
            Some(&state.core_services),
        )
        .await;

    axum::Json(Phase3SimulateResponse {
        routing_key,
        required: q.required,
        selected_node_id: nid,
        debug: dbg,
        breakdown: bd,
    })
}

async fn get_prometheus_metrics(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> impl axum::response::IntoResponse {
    let (body, content_type) = metrics::prometheus_metrics::render_text(&state).await;
    let hv = axum::http::HeaderValue::from_str(&content_type).unwrap_or_else(|_| {
        axum::http::HeaderValue::from_static("text/plain; charset=utf-8")
    });
    (
        axum::http::StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, hv)],
        body,
    )
}

// 仪表盘页面
async fn serve_dashboard() -> axum::response::Html<&'static str> {
    axum::response::Html(include_str!("../dashboard.html"))
}

// 算力页面
async fn serve_compute_power() -> axum::response::Html<&'static str> {
    axum::response::Html(include_str!("../compute-power.html"))
}

// 模型页面
async fn serve_models() -> axum::response::Html<&'static str> {
    axum::response::Html(include_str!("../models.html"))
}

// 语言页面
async fn serve_languages() -> axum::response::Html<&'static str> {
    axum::response::Html(include_str!("../languages.html"))
}

