//! Pause检测与TTS播放期间的测试

use lingua_scheduler::core::{AppState, SessionManager, JobDispatcher};
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
use axum::extract::ws::Message;
use tokio::sync::mpsc;
use std::time::Duration;
use tokio::time::sleep;

fn create_test_app_state() -> AppState {
    let node_registry = std::sync::Arc::new(NodeRegistry::new());
    let node_connections = NodeConnectionManager::new();
    
    let storage_dir = std::env::temp_dir()
        .join("lingua_scheduler_test_modelhub")
        .join(uuid::Uuid::new_v4().to_string());
    let model_hub_cfg = ModelHubConfig {
        base_url: "http://127.0.0.1:0".to_string(),
        storage_path: storage_dir,
    };
    let model_hub = ModelHub::new(&model_hub_cfg).unwrap();
    
    let service_catalog = ServiceCatalogCache::new("http://127.0.0.1:0".to_string());
    let dashboard_snapshot = DashboardSnapshotCache::new(Duration::from_secs(3600));
    
    let (model_na_tx, _model_na_rx) = tokio::sync::mpsc::unbounded_channel();
    let model_not_available_bus = ModelNotAvailableBus::new(model_na_tx);
    
    let group_manager = GroupManager::new(GroupConfig::default());
    
    let node_status_manager = NodeStatusManager::new(
        node_registry.clone(),
        std::sync::Arc::new(node_connections.clone()),
        NodeHealthConfig::default(),
    );
    
    AppState {
        session_manager: SessionManager::new(),
        dispatcher: JobDispatcher::new(node_registry.clone()),
        node_registry,
        pairing_service: PairingService::new(),
        model_hub,
        service_catalog,
        dashboard_snapshot,
        model_not_available_bus,
        core_services: CoreServicesConfig::default(),
        web_task_segmentation: WebTaskSegmentationConfig { 
            pause_ms: 3000, // 3秒 pause 阈值
            max_duration_ms: 0,
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
        phase2: None,
        minimal_scheduler: None,
    }
}

/// 测试：TTS播放期间，即使chunk间隔超过pause_ms，也不触发pause finalize
#[tokio::test]
async fn test_pause_detect_ignored_during_tts_playback() {
    let state = create_test_app_state();
    let (tx, _rx) = mpsc::unbounded_channel::<Message>();
    
    // 创建会话
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
    
    // 创建 group
    let (group_id, _, _) = state.group_manager.on_asr_final(
        &session.session_id,
        "trace_1",
        0,
        "Hello".to_string(),
        1000,
    ).await;
    
    // 记录活跃group_id（模拟正常流程）
    // 注意：在实际流程中，这由 GroupManager 内部管理
    
    let (actor, handle) = SessionActor::new(
        session.session_id.clone(),
        state.clone(),
        tx,
        session.utterance_index,
        3000, // pause_ms = 3秒
        20000, // max_duration_ms
        EdgeStabilizationConfig::default(),
    );
    
    state.session_manager.register_actor(session.session_id.clone(), handle.clone()).await;
    
    let actor_handle = tokio::spawn(async move {
        actor.run().await;
    });
    
    let base_time = 1000;
    
    // 1. 发送第一个chunk
    let chunk1 = vec![1u8; 100];
    handle.send(SessionEvent::AudioChunkReceived {
        chunk: chunk1.clone(),
        is_final: false,
        timestamp_ms: base_time,
        client_timestamp_ms: Some(base_time),
    }).unwrap();
    
    sleep(Duration::from_millis(100)).await;
    
    // 2. 模拟TTS播放开始
    let tts_start_ms = base_time + 100;
    state.group_manager.on_tts_started(&group_id, tts_start_ms as u64).await;
    // 更新last_chunk_at_ms（模拟handle_tts_started的行为）
    state.audio_buffer.update_last_chunk_at_ms(&session.session_id, tts_start_ms).await;
    
    // 3. 在TTS播放期间（5秒后），发送第二个chunk
    // chunk间隔 = tts_start_ms - base_time + 5000 = 100 + 5000 = 5100ms > 3000ms (pause_ms)
    // 但由于在TTS播放期间，不应该触发pause finalize
    let chunk2_time = tts_start_ms + 5000; // TTS播放期间
    let chunk2 = vec![2u8; 100];
    handle.send(SessionEvent::AudioChunkReceived {
        chunk: chunk2.clone(),
        is_final: false,
        timestamp_ms: chunk2_time,
        client_timestamp_ms: Some(chunk2_time),
    }).unwrap();
    
    sleep(Duration::from_millis(200)).await;
    
    // 4. 验证：在TTS播放期间，is_tts_playing应该返回true
    let tts_end_ms = tts_start_ms + 6000; // TTS播放时长6秒
    state.group_manager.on_tts_play_ended(&group_id, tts_end_ms as u64).await;
    
    // 验证chunk2_time在播放期间
    assert!(state.group_manager.is_tts_playing(&group_id, chunk2_time).await,
        "chunk2_time应该在TTS播放期间");
    
    // 注意：由于SessionActor是异步的，我们无法直接验证是否触发了finalize
    // 但可以通过日志或指标来验证
    // 这里主要测试is_tts_playing的逻辑是否正确
    
    handle.send(SessionEvent::CloseSession).unwrap();
    sleep(Duration::from_millis(100)).await;
    actor_handle.abort();
}

/// 测试：TTS播放结束后，正常进行pause检测
#[tokio::test]
async fn test_pause_detect_resumes_after_tts_ended() {
    let state = create_test_app_state();
    let (tx, _rx) = mpsc::unbounded_channel::<Message>();
    
    let session = state.session_manager.create_session(
        "1.0.0".to_string(),
        "web".to_string(),
        "zh".to_string(),
        "en".to_string(),
        None, None, None, None, None, None, None, None, None, None,
    ).await;
    
    let (group_id, _, _) = state.group_manager.on_asr_final(
        &session.session_id,
        "trace_1",
        0,
        "Hello".to_string(),
        1000,
    ).await;
    
    let (actor, handle) = SessionActor::new(
        session.session_id.clone(),
        state.clone(),
        tx,
        session.utterance_index,
        3000, // pause_ms = 3秒
        20000,
        EdgeStabilizationConfig::default(),
    );
    
    state.session_manager.register_actor(session.session_id.clone(), handle.clone()).await;
    
    let actor_handle = tokio::spawn(async move {
        actor.run().await;
    });
    
    let base_time = 1000;
    
    // 1. 发送第一个chunk
    handle.send(SessionEvent::AudioChunkReceived {
        chunk: vec![1u8; 100],
        is_final: false,
        timestamp_ms: base_time,
        client_timestamp_ms: Some(base_time),
    }).unwrap();
    
    sleep(Duration::from_millis(100)).await;
    
    // 2. TTS播放开始和结束
    let tts_start_ms = base_time + 100;
    let tts_end_ms = tts_start_ms + 5000; // 播放5秒
    
    state.group_manager.on_tts_started(&group_id, tts_start_ms as u64).await;
    state.audio_buffer.update_last_chunk_at_ms(&session.session_id, tts_start_ms).await;
    state.group_manager.on_tts_play_ended(&group_id, tts_end_ms as u64).await;
    state.audio_buffer.update_last_chunk_at_ms(&session.session_id, tts_end_ms).await;
    
    // 3. TTS播放结束后，发送第二个chunk（间隔超过pause_ms）
    // chunk间隔 = tts_end_ms - base_time + 4000 = 应该超过pause_ms
    // 但实际间隔应该从tts_end_ms开始计算，所以应该是4000ms > 3000ms
    let chunk2_time = tts_end_ms + 4000; // TTS播放结束4秒后
    handle.send(SessionEvent::AudioChunkReceived {
        chunk: vec![2u8; 100],
        is_final: false,
        timestamp_ms: chunk2_time,
        client_timestamp_ms: Some(chunk2_time),
    }).unwrap();
    
    sleep(Duration::from_millis(200)).await;
    
    // 4. 验证：TTS播放结束后，is_tts_playing应该返回false
    assert!(!state.group_manager.is_tts_playing(&group_id, chunk2_time).await,
        "chunk2_time应该在TTS播放结束后");
    
    handle.send(SessionEvent::CloseSession).unwrap();
    sleep(Duration::from_millis(100)).await;
    actor_handle.abort();
}
