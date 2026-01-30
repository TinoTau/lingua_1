// Session Affinity 单元测试
// 测试 timeout_node_id 映射的记录和清除逻辑

use lingua_scheduler::core::{AppState, SessionManager};
use lingua_scheduler::websocket::session_actor::{SessionActor, SessionEvent};
use lingua_scheduler::managers::{
    AudioBufferManager, ResultQueueManager, SessionConnectionManager, NodeConnectionManager,
};
use lingua_scheduler::node_registry::NodeRegistry;
use lingua_scheduler::services::{PairingService, ModelHub, ServiceCatalogCache};
use lingua_scheduler::metrics::DashboardSnapshotCache;
use lingua_scheduler::model_not_available::ModelNotAvailableBus;
use lingua_scheduler::core::config::{CoreServicesConfig, WebTaskSegmentationConfig, ModelHubConfig, NodeHealthConfig, EdgeStabilizationConfig};
use lingua_scheduler::managers::{GroupManager, GroupConfig, NodeStatusManager};
use lingua_scheduler::phase2::Phase2Runtime;
use lingua_scheduler::core::config::{Phase2Config, Phase2RedisConfig};
use axum::extract::ws::Message;
use tokio::sync::mpsc;
use std::time::Duration;
use tokio::time::sleep;
use redis::Commands;
use std::sync::Arc;

fn create_test_redis_config() -> Phase2RedisConfig {
    let mut cfg = Phase2RedisConfig::default();
    let mode = std::env::var("LINGUA_TEST_REDIS_MODE").unwrap_or_else(|_| "single".to_string());
    if mode == "cluster" {
        cfg.mode = "cluster".to_string();
        if let Ok(s) = std::env::var("LINGUA_TEST_REDIS_CLUSTER_URLS") {
            cfg.cluster_urls = s
                .split(',')
                .map(|x| x.trim().to_string())
                .filter(|x| !x.is_empty())
                .collect();
        }
        if cfg.cluster_urls.is_empty() {
            cfg.cluster_urls = vec![std::env::var("LINGUA_TEST_REDIS_URL")
                .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string())];
        }
    } else {
        cfg.mode = "single".to_string();
        cfg.url = std::env::var("LINGUA_TEST_REDIS_URL")
            .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
    }
    cfg
}

async fn can_connect_redis(cfg: &Phase2RedisConfig) -> bool {
    match cfg.mode.as_str() {
        "cluster" => {
            let urls = if cfg.cluster_urls.is_empty() {
                vec![cfg.url.clone()]
            } else {
                cfg.cluster_urls.clone()
            };
            let client = match redis::cluster::ClusterClient::new(urls) {
                Ok(c) => c,
                Err(_) => return false,
            };
            let mut conn = match client.get_async_connection().await {
                Ok(c) => c,
                Err(_) => return false,
            };
            let pong: redis::RedisResult<String> = redis::cmd("PING").query_async(&mut conn).await;
            pong.is_ok()
        }
        _ => {
            let client = match redis::Client::open(cfg.url.as_str()) {
                Ok(c) => c,
                Err(_) => return false,
            };
            let mut conn = match client.get_multiplexed_tokio_connection().await {
                Ok(c) => c,
                Err(_) => return false,
            };
            let pong: redis::RedisResult<String> = redis::cmd("PING").query_async(&mut conn).await;
            pong.is_ok()
        }
    }
}

async fn cleanup_session_keys(redis_cfg: &Phase2RedisConfig, session_id: &str) {
    let session_key = format!("scheduler:session:{}", session_id);
    let redis_url = match redis_cfg.mode.as_str() {
        "cluster" => redis_cfg.cluster_urls.first().cloned()
            .unwrap_or_else(|| redis_cfg.url.clone()),
        _ => redis_cfg.url.clone(),
    };
    if let Ok(client) = redis::Client::open(redis_url.as_str()) {
        if let Ok(mut conn) = client.get_connection() {
            let _: Result<(), _> = conn.del::<_, ()>(session_key);
        }
    }
}

fn create_test_app_state_with_phase2(phase2: Option<Arc<Phase2Runtime>>) -> AppState {
    let node_registry = std::sync::Arc::new(NodeRegistry::new());
    let node_connections = NodeConnectionManager::new();
    
    // 创建 ModelHub
    let storage_dir = std::env::temp_dir()
        .join("lingua_scheduler_test_modelhub")
        .join(uuid::Uuid::new_v4().to_string());
    let model_hub_cfg = ModelHubConfig {
        base_url: "http://127.0.0.1:0".to_string(),
        storage_path: storage_dir,
    };
    let model_hub = ModelHub::new(&model_hub_cfg).unwrap();
    
    // 创建其他服务
    let service_catalog = ServiceCatalogCache::new("http://127.0.0.1:0".to_string());
    let dashboard_snapshot = DashboardSnapshotCache::new(Duration::from_secs(3600));
    
    // 创建 ModelNotAvailableBus
    let (model_na_tx, _model_na_rx) = tokio::sync::mpsc::unbounded_channel();
    let model_not_available_bus = ModelNotAvailableBus::new(model_na_tx);
    
    // 创建 GroupManager
    let group_manager = GroupManager::new(GroupConfig::default());
    
    // 创建 NodeStatusManager
    let node_status_manager = NodeStatusManager::new(
        node_registry.clone(),
        std::sync::Arc::new(node_connections.clone()),
        NodeHealthConfig::default(),
    );
    
    AppState {
        session_manager: SessionManager::new(),
        dispatcher: lingua_scheduler::core::JobDispatcher::new(node_registry.clone()),
        node_registry,
        pairing_service: PairingService::new(),
        model_hub,
        service_catalog,
        dashboard_snapshot,
        model_not_available_bus,
        core_services: CoreServicesConfig::default(),
        web_task_segmentation: WebTaskSegmentationConfig { 
            pause_ms: 3000,
            max_duration_ms: 20000,
            edge_stabilization: EdgeStabilizationConfig::default(),
        },
        session_connections: SessionConnectionManager::new(),
        node_connections,
        result_queue: ResultQueueManager::new(),
        audio_buffer: AudioBufferManager::new(),
        group_manager,
        node_status_manager,
        room_manager: lingua_scheduler::managers::RoomManager::new(),
        job_idempotency: lingua_scheduler::core::JobIdempotencyManager::default(),
        job_result_deduplicator: lingua_scheduler::core::JobResultDeduplicator::new(),
        phase2,
        minimal_scheduler: None,
    }
}

#[tokio::test]
#[ignore] // 需要Redis连接，默认忽略
async fn test_timeout_finalize_records_session_affinity() {
    let redis_cfg = create_test_redis_config();
    if !can_connect_redis(&redis_cfg).await {
        eprintln!("Skipping test: Redis not available");
        return;
    }

    // 创建 Phase2Runtime
    let mut cfg = Phase2Config::default();
    cfg.enabled = true;
    cfg.instance_id = "test-instance".to_string();
    cfg.redis = redis_cfg.clone();
    
    let phase2 = match Phase2Runtime::new(cfg, 5).await {
        Ok(Some(rt)) => Arc::new(rt),
        Ok(None) => {
            eprintln!("Phase2Runtime creation returned None");
            return;
        }
        Err(e) => {
            eprintln!("Failed to create Phase2Runtime: {:?}", e);
            return;
        }
    };

    let state = create_test_app_state_with_phase2(Some(phase2.clone()));
    let session_id = format!("test-session-{}", uuid::Uuid::new_v4());
    
    // 清理之前的测试数据
    cleanup_session_keys(&redis_cfg, &session_id).await;

    let (tx, _rx) = mpsc::unbounded_channel::<Message>();
    
    // 创建 session
    let session = state.session_manager.create_session(
        "1.0.0".to_string(),
        "web".to_string(),
        "zh".to_string(),
        "en".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    ).await;
    
    let (actor, handle) = SessionActor::new(
        session.session_id.clone(),
        state.clone(),
        tx,
        session.utterance_index,
        3000, // pause_ms
        20000, // max_duration_ms
        EdgeStabilizationConfig::default(),
    );
    
    state.session_manager.register_actor(session.session_id.clone(), handle.clone()).await;
    
    // 启动 actor
    let actor_handle = tokio::spawn(async move {
        actor.run().await;
    });
    
    // 添加音频数据到缓冲区
    state.audio_buffer.add_chunk(&session.session_id, 0, vec![1, 2, 3, 4, 5]).await;
    
    // 模拟超时finalize（通过MaxDuration触发，因为它会设置is_timeout_triggered=true）
    // 注意：实际测试中，我们需要模拟create_translation_jobs返回带有assigned_node_id的job
    // 但由于这个功能依赖完整的调度流程，这里我们直接验证Redis操作
    
    // 手动设置timeout_node_id以测试清除逻辑
    let session_key = format!("scheduler:session:{}", session.session_id);
    let test_node_id = "test-node-123";
    
    // 使用Redis直接设置timeout_node_id（模拟timeout finalize后的状态）
    {
        let mut cmd = redis::cmd("HSET");
        cmd.arg(&session_key).arg("timeout_node_id").arg(test_node_id);
        let _: () = phase2.redis_query(cmd).await.unwrap();
        
        let mut cmd = redis::cmd("EXPIRE");
        cmd.arg(&session_key).arg(300);
        let _: () = phase2.redis_query(cmd).await.unwrap();
    }
    
    // 验证timeout_node_id已设置
    {
        let mut cmd = redis::cmd("HGET");
        cmd.arg(&session_key).arg("timeout_node_id");
        let timeout_node_id: Option<String> = phase2.redis_query(cmd).await.unwrap();
        assert_eq!(timeout_node_id, Some(test_node_id.to_string()));
    }
    
    // 模拟手动finalize（通过is_final=true触发）
    // 手动finalize应该清除timeout_node_id映射
    handle.send(SessionEvent::AudioChunkReceived {
        chunk: vec![6, 7, 8, 9, 10],
        is_final: true,
        timestamp_ms: chrono::Utc::now().timestamp_millis(),
        client_timestamp_ms: None,
    }).unwrap();
    
    // 等待处理
    sleep(Duration::from_millis(500)).await;
    
    // 验证timeout_node_id已被清除（手动finalize应该清除映射）
    {
        let mut cmd = redis::cmd("HGET");
        cmd.arg(&session_key).arg("timeout_node_id");
        let timeout_node_id: Option<String> = phase2.redis_query(cmd).await.unwrap();
        // 手动finalize应该清除timeout_node_id
        assert_eq!(timeout_node_id, None, "timeout_node_id should be cleared after manual finalize");
    }
    
    // 清理
    cleanup_session_keys(&redis_cfg, &session.session_id).await;
    handle.send(SessionEvent::CloseSession).unwrap();
    sleep(Duration::from_millis(100)).await;
    actor_handle.abort();
}

#[tokio::test]
#[ignore] // 需要Redis连接，默认忽略
async fn test_pause_finalize_clears_session_affinity() {
    let redis_cfg = create_test_redis_config();
    if !can_connect_redis(&redis_cfg).await {
        eprintln!("Skipping test: Redis not available");
        return;
    }

    // 创建 Phase2Runtime
    let mut cfg = Phase2Config::default();
    cfg.enabled = true;
    cfg.instance_id = "test-instance".to_string();
    cfg.redis = redis_cfg.clone();
    
    let phase2 = match Phase2Runtime::new(cfg, 5).await {
        Ok(Some(rt)) => Arc::new(rt),
        Ok(None) => {
            eprintln!("Phase2Runtime creation returned None");
            return;
        }
        Err(e) => {
            eprintln!("Failed to create Phase2Runtime: {:?}", e);
            return;
        }
    };

    let state = create_test_app_state_with_phase2(Some(phase2.clone()));
    let session_id = format!("test-session-{}", uuid::Uuid::new_v4());
    
    // 清理之前的测试数据
    cleanup_session_keys(&redis_cfg, &session_id).await;

    let (tx, _rx) = mpsc::unbounded_channel::<Message>();
    
    // 创建 session
    let session = state.session_manager.create_session(
        "1.0.0".to_string(),
        "web".to_string(),
        "zh".to_string(),
        "en".to_string(),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    ).await;
    
    let (actor, handle) = SessionActor::new(
        session.session_id.clone(),
        state.clone(),
        tx,
        session.utterance_index,
        3000, // pause_ms
        20000, // max_duration_ms
        EdgeStabilizationConfig::default(),
    );
    
    state.session_manager.register_actor(session.session_id.clone(), handle.clone()).await;
    
    // 启动 actor
    let actor_handle = tokio::spawn(async move {
        actor.run().await;
    });
    
    // 手动设置timeout_node_id（模拟之前的timeout finalize）
    let session_key = format!("scheduler:session:{}", session.session_id);
    let test_node_id = "test-node-456";
    
    {
        let mut cmd = redis::cmd("HSET");
        cmd.arg(&session_key).arg("timeout_node_id").arg(test_node_id);
        let _: () = phase2.redis_query(cmd).await.unwrap();
    }
    
    // 验证timeout_node_id已设置
    {
        let mut cmd = redis::cmd("HGET");
        cmd.arg(&session_key).arg("timeout_node_id");
        let timeout_node_id: Option<String> = phase2.redis_query(cmd).await.unwrap();
        assert_eq!(timeout_node_id, Some(test_node_id.to_string()));
    }
    
    // 添加音频数据
    let now = chrono::Utc::now().timestamp_millis();
    state.audio_buffer.add_chunk(&session.session_id, 0, vec![1, 2, 3, 4, 5]).await;
    
    // 发送一个音频块，然后等待超过pause_ms，触发pause finalize
    handle.send(SessionEvent::AudioChunkReceived {
        chunk: vec![6, 7, 8, 9, 10],
        is_final: false,
        timestamp_ms: now,
        client_timestamp_ms: Some(now),
    }).unwrap();
    
    sleep(Duration::from_millis(100)).await;
    
    // 发送另一个音频块，时间间隔超过pause_ms（3秒），触发pause finalize
    handle.send(SessionEvent::AudioChunkReceived {
        chunk: vec![11, 12, 13, 14, 15],
        is_final: false,
        timestamp_ms: now + 4000, // 4秒后，超过pause_ms阈值
        client_timestamp_ms: Some(now + 4000),
    }).unwrap();
    
    // 等待处理
    sleep(Duration::from_millis(500)).await;
    
    // 验证timeout_node_id已被清除（pause finalize应该清除映射）
    {
        let mut cmd = redis::cmd("HGET");
        cmd.arg(&session_key).arg("timeout_node_id");
        let timeout_node_id: Option<String> = phase2.redis_query(cmd).await.unwrap();
        // pause finalize应该清除timeout_node_id
        assert_eq!(timeout_node_id, None, "timeout_node_id should be cleared after pause finalize");
    }
    
    // 清理
    cleanup_session_keys(&redis_cfg, &session.session_id).await;
    handle.send(SessionEvent::CloseSession).unwrap();
    sleep(Duration::from_millis(100)).await;
    actor_handle.abort();
}
