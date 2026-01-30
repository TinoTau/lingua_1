use crate::core::{AppState, Config, JobDispatcher, PendingJobDispatches, SessionManager};
use crate::managers::{
    AudioBufferManager, GroupManager, GroupConfig,
    ResultQueueManager, RoomManager, SessionConnectionManager, NodeConnectionManager,
};
use crate::services::{PairingService, ServiceCatalogCache};
use crate::metrics::DashboardSnapshotCache;
use crate::timeout::start_job_timeout_manager;
use crate::model_not_available::start_worker;
use crate::node_registry::NodeRegistry;
use crate::redis_runtime::Phase2Runtime;
use std::sync::Arc;
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
    // ModelHub 已删除（未实现）
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
    
    // 阶段3：NodeRegistry 将在 Phase2 初始化后创建（需要 RedisHandle）
    // 临时：先创建其他不依赖 NodeRegistry 的组件
    
    let pairing_service = PairingService::new();
    // ModelHub 已删除（未实现）
    // ServiceCatalog：优先走 ModelHub HTTP；若失败则可用本地 services_index.json 兜底（单机冷启动/离线）
    let local_services_index = config.model_hub.storage_path.join("services_index.json");
    let service_catalog = ServiceCatalogCache::new(config.model_hub.base_url.clone())
        .with_local_services_index_path(local_services_index);
    let dashboard_snapshot = DashboardSnapshotCache::new(Duration::from_secs(
        config.scheduler.background_tasks.dashboard_snapshot_cache_ttl_seconds
    ));
    let (model_na_tx, model_na_rx) = tokio::sync::mpsc::unbounded_channel();
    let model_not_available_bus = crate::model_not_available::ModelNotAvailableBus::new(model_na_tx);
    let session_connections = SessionConnectionManager::new();
    let node_connections = NodeConnectionManager::new();
    let result_queue = ResultQueueManager::new();
    let audio_buffer = AudioBufferManager::new();
    
    // 初始化 GroupManager（使用默认配置）
    let group_config = GroupConfig::default();
    let group_manager = GroupManager::new(group_config);
    
    // NodeStatusManager 将在创建 NodeRegistry 后初始化
    
    // 初始化 RoomManager
    let room_manager = RoomManager::new();

    // Phase 2：Redis/多实例运行时（可选）
    let phase2_runtime = Phase2Runtime::new(
        config.scheduler.phase2.clone(),
        config.scheduler.heartbeat_interval_seconds,
        &config.scheduler,
    )
    .await?
    .map(std::sync::Arc::new);

    // 阶段3：初始化 Redis 连接（Phase2 启用或降级到本地连接）
    use crate::redis_runtime::RedisHandle;
    let redis_arc = if phase2_runtime.is_some() {
        // Phase2 启用：使用配置的 Redis
        match RedisHandle::connect(&config.scheduler.phase2.redis, &config.scheduler).await {
            Ok(redis) => Arc::new(redis),
            Err(e) => {
                tracing::error!(error = %e, "连接 Phase2 Redis 失败");
                return Err(e.into());
            }
        }
    } else {
        // Phase2 未启用：使用本地 Redis（降级模式）
        tracing::warn!("Phase2 未启用，使用本地 Redis 连接（降级模式）");
        match RedisHandle::connect(&config.scheduler.phase2.redis, &config.scheduler).await {
            Ok(redis) => Arc::new(redis),
            Err(e) => {
                tracing::error!(error = %e, "连接本地 Redis 失败");
                return Err(e.into());
            }
        }
    };
    
    // 阶段3：创建 NodeRegistry（使用 Redis 直查架构）
    let mut node_registry = NodeRegistry::new(redis_arc.clone());
    node_registry.set_resource_threshold(resource_threshold);
    let node_registry = Arc::new(node_registry);
    // NodeRegistry::new() 内部已打印初始化日志，无需重复
    
    // NodeStatusManager 已删除（与Redis直查架构冲突）
    
    // 初始化极简无锁调度服务和 Pool 服务（需要 Phase2 启用）
    let (minimal_scheduler, pool_service) = if phase2_runtime.is_some() {
        // 初始化 MinimalScheduler
        let scheduler = match crate::services::MinimalSchedulerService::new(redis_arc.clone()).await {
            Ok(s) => {
                info!("极简无锁调度服务已初始化");
                Some(std::sync::Arc::new(s))
            }
            Err(e) => {
                tracing::warn!(error = %e, "极简无锁调度服务初始化失败");
                None
            }
        };
        
        // 初始化 PoolService（TTL = 3 × 心跳周期，用于被动清理）
        let pool_svc = match crate::pool::PoolService::new(
            redis_arc.clone(),
            config.scheduler.node_health.heartbeat_interval_seconds,
        ).await {
            Ok(ps) => {
                info!("Pool 服务已初始化");
                Some(std::sync::Arc::new(ps))
            }
            Err(e) => {
                tracing::warn!(error = %e, "Pool 服务初始化失败");
                None
            }
        };
        
        // 阶段3：关联 PoolService 到 NodeRegistry
        if let Some(ref ps) = pool_svc {
            node_registry.set_pool_service(ps.clone()).await;
            info!("NodeRegistry 已关联 PoolService");
        }
        
        (scheduler, pool_svc)
    } else {
        (None, None)
    };
    
    // 创建 dispatcher（使用Redis存储Job状态，SSOT）
    let mut dispatcher = JobDispatcher::new_with_task_binding_config(
        node_registry.clone(),
        redis_arc.clone(),
        config.scheduler.task_binding.clone(),
    );
    dispatcher.set_phase2(phase2_runtime.clone());

    // 初始化 Job 幂等键管理器
    let mut job_idempotency = crate::core::JobIdempotencyManager::new();
    // 设置 Phase2 运行时（如果可用）
    job_idempotency.set_phase2(phase2_runtime.clone());

    // 初始化 JobResult 去重管理器
    let job_result_deduplicator = crate::core::JobResultDeduplicator::new();
    // Utterance 路径：按 utterance_index 顺序派发
    let pending_job_dispatches = PendingJobDispatches::new();

    // 创建应用状态
    let app_state = AppState {
        session_manager,
        dispatcher,
        node_registry,
        pairing_service,
        service_catalog,
        dashboard_snapshot,
        model_not_available_bus,
        web_task_segmentation: config.scheduler.web_task_segmentation.clone(),
        session_connections: session_connections.clone(),
        node_connections,
        result_queue,
        audio_buffer,
        group_manager,
        room_manager: room_manager.clone(),
        job_idempotency,
        job_result_deduplicator,
        pending_job_dispatches,
        phase2: phase2_runtime.clone(),
        minimal_scheduler,
        pool_service,
    };

    // Phase 2：启动后台任务（presence + owner 续约 + Streams inbox）
    if let Some(ref rt) = phase2_runtime {
        let rt_for_log = rt.clone();
        rt.clone().spawn_background_tasks(app_state.clone());
        info!(instance_id = %rt_for_log.instance_id, key_prefix = %rt_for_log.key_prefix(), "Phase2 已启用");
        
        // Phase 2：冷启动预加载（按照 NODE_JOB_FLOW_MERGED_TECH_SPEC_v1.0.md 规范）
        // 启动时加载全体节点、全体 pool、全体 lang-index，避免启动后 100-300ms 的抖动
        let rt_for_preload = rt.clone();
        let app_state_for_preload = app_state.clone();
        let preload_delay_secs = config.scheduler.background_tasks.preload_delay_seconds;
        tokio::spawn(async move {
            // 延迟后执行预加载，给后台任务一些时间初始化
            tokio::time::sleep(std::time::Duration::from_secs(preload_delay_secs)).await;
            
            if let Err(e) = rt_for_preload.cold_start_preload(&app_state_for_preload).await {
                tracing::warn!(error = %e, "冷启动预加载失败，但继续运行");
            }
        });
    }

    // Job 超时/重派管理（含 best-effort cancel）
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
    
    // 启动JobResult去重管理器清理任务
    let job_result_deduplicator_for_cleanup = app_state.job_result_deduplicator.clone();
    let job_dedup_interval_secs = config.scheduler.background_tasks.job_result_dedup_cleanup_interval_seconds;
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(job_dedup_interval_secs));
        loop {
            interval.tick().await;
            job_result_deduplicator_for_cleanup.cleanup_expired().await;
        }
    });

    // 启动房间过期清理任务
    let app_state_for_cleanup = app_state.clone();
    let session_cleanup_interval_secs = config.scheduler.background_tasks.session_cleanup_interval_seconds;
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(session_cleanup_interval_secs));
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

    // 启动已完成 Job 清理任务
    let dispatcher_for_cleanup = app_state.dispatcher.clone();
    let job_cleanup_interval_secs = config.scheduler.background_tasks.job_cleanup_interval_seconds;
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(job_cleanup_interval_secs));
        loop {
            interval.tick().await;
            // 清理 5 分钟前完成的任务
            let cleaned_count = dispatcher_for_cleanup.cleanup_completed_jobs(300).await;
            if cleaned_count > 0 {
                info!(cleaned_count = cleaned_count, "已清理完成的 Job");
            }
        }
    });

    // 启动结果队列超时检查任务
    let app_state_for_result_check = app_state.clone();
    let result_check_interval_secs = config.scheduler.background_tasks.session_active_result_check_interval_seconds;
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(result_check_interval_secs));
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

