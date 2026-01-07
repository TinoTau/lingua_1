use crate::core::{AppState, Config, JobDispatcher, SessionManager};
use crate::managers::{
    AudioBufferManager, GroupManager, GroupConfig, NodeStatusManager,
    ResultQueueManager, RoomManager, SessionConnectionManager, NodeConnectionManager,
};
use crate::services::{ModelHub, PairingService, ServiceCatalogCache};
use crate::metrics::DashboardSnapshotCache;
use crate::timeout::start_job_timeout_manager;
use crate::model_not_available::start_worker;
use crate::node_registry::NodeRegistry;
use crate::phase2::Phase2Runtime;
use std::time::Duration;
use tracing::info;

pub async fn initialize_app(config: &Config) -> anyhow::Result<AppState> {
    info!("启动 Lingua 调度服务器...");
    
    // 方向A：设置观测阈值（锁等待/关键路径）
    crate::metrics::observability::set_thresholds(
        config.scheduler.observability.lock_wait_warn_ms,
        config.scheduler.observability.path_warn_ms,
    );

    // 方向B：初始化 Prometheus registry（/metrics）
    crate::metrics::prometheus_metrics::init();

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
    let model_not_available_bus = crate::model_not_available::ModelNotAvailableBus::new(model_na_tx);
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

    // 初始化 Job 幂等键管理器
    let job_idempotency = crate::core::JobIdempotencyManager::new();

    // 初始化 JobResult 去重管理器
    let job_result_deduplicator = crate::core::JobResultDeduplicator::new();

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
        job_idempotency,
        job_result_deduplicator,
        phase2: phase2_runtime.clone(),
    };

    // Phase 2：启动后台任务（presence + owner 续约 + Streams inbox）
    if let Some(ref rt) = phase2_runtime {
        let rt_for_log = rt.clone();
        rt.clone().spawn_background_tasks(app_state.clone());
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
    
    // 启动 Pool 定期清理任务（自动生成模式）
    if config.scheduler.phase3.auto_generate_language_pools {
        app_state.node_registry.start_pool_cleanup_task(phase2_runtime.clone());
    }

    // 启动 MODEL_NOT_AVAILABLE 后台处理（主路径只入队）
    start_worker(
        model_na_rx,
        app_state.node_registry.clone(),
        config.scheduler.model_not_available.clone(),
        app_state.phase2.clone(),
    );
    
    // 启动JobResult去重管理器清理任务（每30秒清理一次过期记录）
    let job_result_deduplicator_for_cleanup = app_state.job_result_deduplicator.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(30));
        loop {
            interval.tick().await;
            job_result_deduplicator_for_cleanup.cleanup_expired().await;
        }
    });

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

    // 启动结果队列超时检查任务（每10秒检查一次）
    let app_state_for_result_check = app_state.clone();
    tokio::spawn(async move {
        // 优化：缩短结果检查间隔，从10秒降到1秒，减少延迟
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(1));
        // 跳过第一次立即触发
        interval.tick().await;
        
        loop {
            interval.tick().await;
            
            // 添加错误处理，避免任务崩溃
            if let Err(e) = async {
                // 获取所有活跃会话
                let sessions = app_state_for_result_check.session_manager.list_all_sessions().await;
                
                // 限制每次处理的会话数量，避免长时间阻塞
                let max_sessions_per_cycle = 100;
                let sessions_to_process: Vec<_> = sessions.into_iter().take(max_sessions_per_cycle).collect();
                
                for session in sessions_to_process {
                    // 调用 get_ready_results 会触发超时检测
                    let ready_results = app_state_for_result_check
                        .result_queue
                        .get_ready_results(&session.session_id)
                        .await;
                    
                    // 如果有就绪的结果（包括超时生成的失败结果），发送给客户端
                    if !ready_results.is_empty() {
                        if let Some(tx) = app_state_for_result_check
                            .session_connections
                            .get(&session.session_id)
                            .await
                        {
                            for result in ready_results {
                                let result_json = match serde_json::to_string(&result) {
                                    Ok(json) => json,
                                    Err(e) => {
                                        tracing::warn!(
                                            session_id = %session.session_id,
                                            error = %e,
                                            "Failed to serialize result"
                                        );
                                        continue;
                                    }
                                };
                                if tx.send(axum::extract::ws::Message::Text(result_json)).is_err() {
                                    // 发送失败，连接可能已关闭，继续处理下一个
                                    break;
                                }
                            }
                        }
                    }
                }
                Ok::<(), anyhow::Error>(())
            }.await {
                tracing::error!(
                    error = %e,
                    "Error in result queue timeout checker task"
                );
            }
        }
    });

    Ok(app_state)
}

