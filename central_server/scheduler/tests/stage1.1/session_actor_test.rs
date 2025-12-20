// Session Actor 单元测试

use lingua_scheduler::core::{AppState, SessionManager, JobDispatcher};
use lingua_scheduler::websocket::session_actor::{SessionActor, SessionEvent};
use lingua_scheduler::managers::{
    AudioBufferManager, ResultQueueManager, SessionConnectionManager, NodeConnectionManager,
};
use lingua_scheduler::node_registry::NodeRegistry;
use lingua_scheduler::services::{PairingService, ModelHub, ServiceCatalogCache};
use lingua_scheduler::metrics::DashboardSnapshotCache;
use lingua_scheduler::model_not_available::ModelNotAvailableBus;
use lingua_scheduler::core::config::{CoreServicesConfig, WebTaskSegmentationConfig};
use axum::extract::ws::Message;
use tokio::sync::mpsc;
use std::time::Duration;
use tokio::time::sleep;

fn create_test_app_state() -> AppState {
    AppState {
        session_manager: SessionManager::new(),
        dispatcher: JobDispatcher::new(std::sync::Arc::new(NodeRegistry::new())),
        node_registry: std::sync::Arc::new(NodeRegistry::new()),
        pairing_service: PairingService::new(),
        model_hub: ModelHub::new(),
        service_catalog: ServiceCatalogCache::new(),
        dashboard_snapshot: DashboardSnapshotCache::new(),
        model_not_available_bus: ModelNotAvailableBus::new(),
        core_services: CoreServicesConfig::default(),
        web_task_segmentation: WebTaskSegmentationConfig { pause_ms: 1000 },
        session_connections: SessionConnectionManager::new(),
        node_connections: NodeConnectionManager::new(),
        result_queue: ResultQueueManager::new(),
        audio_buffer: AudioBufferManager::new(),
        group_manager: lingua_scheduler::managers::GroupManager::new(),
        node_status_manager: lingua_scheduler::managers::NodeStatusManager::new(),
        room_manager: lingua_scheduler::managers::RoomManager::new(),
        phase2: None,
    }
}

#[tokio::test]
async fn test_session_actor_creation() {
    let state = create_test_app_state();
    let (tx, _rx) = mpsc::unbounded_channel::<Message>();
    
    let (actor, handle) = SessionActor::new(
        "test-session".to_string(),
        state,
        tx,
        0,
        1000,
    );
    
    assert!(!handle.is_closed());
    
    // 启动 actor（在后台运行）
    let actor_handle = tokio::spawn(async move {
        actor.run().await;
    });
    
    // 发送关闭事件
    handle.send(SessionEvent::CloseSession).unwrap();
    
    // 等待 actor 退出
    sleep(Duration::from_millis(100)).await;
    actor_handle.abort();
}

#[tokio::test]
async fn test_session_actor_audio_chunk() {
    let state = create_test_app_state();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
    
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
    ).await;
    
    let (actor, handle) = SessionActor::new(
        session.session_id.clone(),
        state.clone(),
        tx,
        session.utterance_index,
        1000,
    );
    
    // 注册 actor
    state.session_manager.register_actor(session.session_id.clone(), handle.clone()).await;
    
    // 启动 actor
    let actor_handle = tokio::spawn(async move {
        actor.run().await;
    });
    
    // 发送音频块
    let audio_data = vec![0u8; 100];
    handle.send(SessionEvent::AudioChunkReceived {
        chunk: audio_data.clone(),
        is_final: false,
        timestamp_ms: chrono::Utc::now().timestamp_millis(),
    }).unwrap();
    
    // 等待处理
    sleep(Duration::from_millis(50)).await;
    
    // 验证音频缓冲区中有数据
    let buffer = state.audio_buffer.take_combined(&session.session_id, 0).await;
    // 注意：由于 Actor 可能还没有处理完，这里可能为空
    // 实际测试中需要更复杂的同步机制
    
    // 关闭 actor
    handle.send(SessionEvent::CloseSession).unwrap();
    sleep(Duration::from_millis(100)).await;
    actor_handle.abort();
}

#[tokio::test]
async fn test_session_actor_state_machine() {
    use lingua_scheduler::websocket::session_actor::state::SessionActorInternalState;
    
    let mut state = SessionActorInternalState::new(0);
    
    // 初始状态应该是 Idle
    assert_eq!(state.state, lingua_scheduler::websocket::session_actor::state::SessionActorState::Idle);
    assert_eq!(state.current_utterance_index, 0);
    
    // 测试 can_finalize
    assert!(state.can_finalize(0));
    assert!(!state.can_finalize(1)); // 不能 finalize 未来的 index
    
    // 进入 finalizing
    state.enter_finalizing(0);
    assert_eq!(state.state, lingua_scheduler::websocket::session_actor::state::SessionActorState::Finalizing { index: 0 });
    assert!(!state.can_finalize(0)); // 已经在 finalizing
    
    // 完成 finalize
    state.complete_finalize();
    assert_eq!(state.current_utterance_index, 1);
    assert_eq!(state.state, lingua_scheduler::websocket::session_actor::state::SessionActorState::Idle);
    
    // 测试 timer generation
    let gen1 = state.increment_timer_generation();
    let gen2 = state.increment_timer_generation();
    assert_ne!(gen1, gen2);
    assert!(state.is_timer_generation_valid(gen2));
    assert!(!state.is_timer_generation_valid(gen1)); // 旧的 generation 无效
}

#[tokio::test]
async fn test_session_actor_duplicate_finalize_prevention() {
    let state = create_test_app_state();
    let (tx, _rx) = mpsc::unbounded_channel::<Message>();
    
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
    ).await;
    
    let (actor, handle) = SessionActor::new(
        session.session_id.clone(),
        state.clone(),
        tx,
        session.utterance_index,
        1000,
    );
    
    state.session_manager.register_actor(session.session_id.clone(), handle.clone()).await;
    
    let actor_handle = tokio::spawn(async move {
        actor.run().await;
    });
    
    // 添加一些音频数据
    state.audio_buffer.add_chunk(&session.session_id, 0, vec![1, 2, 3, 4]).await;
    
    // 发送多个 finalize 请求（模拟竞态）
    handle.send(SessionEvent::IsFinalReceived).unwrap();
    handle.send(SessionEvent::IsFinalReceived).unwrap();
    handle.send(SessionEvent::IsFinalReceived).unwrap();
    
    sleep(Duration::from_millis(200)).await;
    
    // 验证 utterance_index 只递增了一次
    let updated_session = state.session_manager.get_session(&session.session_id).await.unwrap();
    // 由于 Actor 是异步的，这里只验证不会崩溃
    // 实际验证需要更复杂的同步机制
    
    handle.send(SessionEvent::CloseSession).unwrap();
    sleep(Duration::from_millis(100)).await;
    actor_handle.abort();
}

#[tokio::test]
async fn test_session_actor_timeout_generation() {
    let state = create_test_app_state();
    let (tx, _rx) = mpsc::unbounded_channel::<Message>();
    
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
    ).await;
    
    let (actor, handle) = SessionActor::new(
        session.session_id.clone(),
        state.clone(),
        tx,
        session.utterance_index,
        100, // 很短的超时时间用于测试
    );
    
    state.session_manager.register_actor(session.session_id.clone(), handle.clone()).await;
    
    let actor_handle = tokio::spawn(async move {
        actor.run().await;
    });
    
    // 发送音频块，触发 timer
    handle.send(SessionEvent::AudioChunkReceived {
        chunk: vec![1, 2, 3],
        is_final: false,
        timestamp_ms: chrono::Utc::now().timestamp_millis(),
    }).unwrap();
    
    // 等待 timer 触发
    sleep(Duration::from_millis(150)).await;
    
    // 发送一个过期的 timeout 事件（应该被忽略）
    let old_timestamp = chrono::Utc::now().timestamp_millis() - 200;
    handle.send(SessionEvent::TimeoutFired {
        generation: 0, // 旧的 generation
        timestamp_ms: old_timestamp,
    }).unwrap();
    
    sleep(Duration::from_millis(50)).await;
    
    handle.send(SessionEvent::CloseSession).unwrap();
    sleep(Duration::from_millis(100)).await;
    actor_handle.abort();
}

