    async fn build_test_state(
        instance_id: &str,
        redis_cfg: crate::config::Phase2RedisConfig,
        key_prefix: String,
    ) -> (crate::app_state::AppState, Arc<Phase2Runtime>) {
        use crate::app_state::AppState;
        use crate::audio_buffer::AudioBufferManager;
        use crate::config::{CoreServicesConfig, ModelHubConfig, NodeHealthConfig, TaskBindingConfig, WebTaskSegmentationConfig};
        use crate::connection_manager::{NodeConnectionManager, SessionConnectionManager};
        use crate::dashboard_snapshot::DashboardSnapshotCache;
        use crate::dispatcher::JobDispatcher;
        use crate::group_manager::{GroupConfig, GroupManager};
        use crate::model_hub::ModelHub;
        use crate::model_not_available::ModelNotAvailableBus;
        use crate::node_registry::NodeRegistry;
        use crate::node_status_manager::NodeStatusManager;
        use crate::pairing::PairingService;
        use crate::result_queue::ResultQueueManager;
        use crate::room_manager::RoomManager;
        use crate::service_catalog::ServiceCatalogCache;
        use crate::session::SessionManager;
        use std::time::Duration;

        let mut p2 = crate::config::Phase2Config::default();
        p2.enabled = true;
        p2.instance_id = instance_id.to_string();
        p2.redis = redis_cfg;
        p2.redis.key_prefix = key_prefix;
        p2.stream_block_ms = 50;
        p2.stream_count = 32;
        p2.stream_maxlen = 1000;
        p2.dlq_enabled = true;
        p2.dlq_scan_interval_ms = 200;
        p2.node_snapshot.enabled = true;
        p2.node_snapshot.refresh_interval_ms = 100;
        p2.node_snapshot.presence_ttl_seconds = 30;
        // 测试中不关心清理逻辑，避免误删干扰
        p2.node_snapshot.remove_stale_after_seconds = 0;

        let rt = Phase2Runtime::new(p2.clone(), 5).await.unwrap().unwrap();
        let rt = Arc::new(rt);

        let session_manager = SessionManager::new();
        let node_registry = std::sync::Arc::new(NodeRegistry::with_resource_threshold(100.0));
        let mut dispatcher = JobDispatcher::new_with_phase1_config(
            node_registry.clone(),
            TaskBindingConfig::default(),
            CoreServicesConfig::default(),
        );
        dispatcher.set_phase2(Some(rt.clone()));

        let pairing_service = PairingService::new();

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

        let session_connections = SessionConnectionManager::new();
        let node_connections = NodeConnectionManager::new();
        let result_queue = ResultQueueManager::new();
        let audio_buffer = AudioBufferManager::new();

        let group_manager = GroupManager::new(GroupConfig::default());

        let node_status_manager = NodeStatusManager::new(
            node_registry.clone(),
            std::sync::Arc::new(node_connections.clone()),
            NodeHealthConfig::default(),
        );

        let room_manager = RoomManager::new();

        let state = AppState {
            session_manager,
            dispatcher,
            node_registry,
            pairing_service,
            model_hub,
            service_catalog,
            dashboard_snapshot,
            model_not_available_bus,
            core_services: CoreServicesConfig::default(),
            web_task_segmentation: WebTaskSegmentationConfig::default(),
            session_connections: session_connections.clone(),
            node_connections,
            result_queue,
            audio_buffer,
            group_manager,
            node_status_manager,
            room_manager,
            phase2: Some(rt.clone()),
        };

        // 启动 Phase2 后台任务（presence + owner 续约 + Streams inbox + snapshot refresh）
        rt.clone().spawn_background_tasks(state.clone());

        (state, rt)
    }

    async fn spawn_ws_server(state: crate::app_state::AppState) -> (std::net::SocketAddr, tokio::sync::oneshot::Sender<()>) {
        use axum::extract::State;
        use axum::extract::ws::WebSocketUpgrade;
        use axum::response::Response;
        use axum::routing::get;
        use axum::Router;

        async fn handle_session_ws(
            ws: WebSocketUpgrade,
            State(state): State<crate::app_state::AppState>,
        ) -> Response {
            ws.on_upgrade(move |socket| crate::websocket::handle_session(socket, state))
        }

        async fn handle_node_ws(
            ws: WebSocketUpgrade,
            State(state): State<crate::app_state::AppState>,
        ) -> Response {
            ws.on_upgrade(move |socket| crate::websocket::handle_node(socket, state))
        }

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let app = Router::new()
            .route("/ws/session", get(handle_session_ws))
            .route("/ws/node", get(handle_node_ws))
            .with_state(state);

        let (tx, rx) = tokio::sync::oneshot::channel::<()>();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app)
                .with_graceful_shutdown(async move {
                    let _ = rx.await;
                })
                .await;
        });

        (addr, tx)
    }

    fn sample_node_register(node_id: &str) -> crate::messages::NodeMessage {
        let mut capability_state: HashMap<String, ModelStatus> = HashMap::new();
        capability_state.insert("node-inference".to_string(), ModelStatus::Ready);
        capability_state.insert("nmt-m2m100".to_string(), ModelStatus::Ready);
        capability_state.insert("piper-tts".to_string(), ModelStatus::Ready);

        crate::messages::NodeMessage::NodeRegister {
            node_id: Some(node_id.to_string()),
            version: "test".to_string(),
            capability_schema_version: Some("1.0".to_string()),
            platform: "test".to_string(),
            hardware: HardwareInfo {
                cpu_cores: 8,
                memory_gb: 32,
                gpus: Some(vec![GpuInfo { name: "RTX".to_string(), memory_gb: 8 }]),
            },
            installed_models: vec![InstalledModel {
                model_id: "dummy".to_string(),
                kind: "asr".to_string(),
                src_lang: None,
                tgt_lang: None,
                dialect: None,
                version: "1".to_string(),
                enabled: Some(true),
            }],
            installed_services: Some(vec![
                InstalledService { service_id: "node-inference".to_string(), version: "1".to_string(), platform: "test".to_string() },
                InstalledService { service_id: "nmt-m2m100".to_string(), version: "1".to_string(), platform: "test".to_string() },
                InstalledService { service_id: "piper-tts".to_string(), version: "1".to_string(), platform: "test".to_string() },
            ]),
            features_supported: FeatureFlags {
                emotion_detection: None,
                voice_style_detection: None,
                speech_rate_detection: None,
                speech_rate_control: None,
                speaker_identification: None,
                persona_adaptation: None,
            },
            advanced_features: None,
            accept_public_jobs: true,
            capability_state: Some(capability_state),
        }
    }

    fn sample_node_heartbeat(node_id: &str) -> crate::messages::NodeMessage {
        let mut capability_state: HashMap<String, ModelStatus> = HashMap::new();
        capability_state.insert("node-inference".to_string(), ModelStatus::Ready);
        capability_state.insert("nmt-m2m100".to_string(), ModelStatus::Ready);
        capability_state.insert("piper-tts".to_string(), ModelStatus::Ready);

        crate::messages::NodeMessage::NodeHeartbeat {
            node_id: node_id.to_string(),
            timestamp: chrono::Utc::now().timestamp_millis(),
            resource_usage: ResourceUsage {
                cpu_percent: 1.0,
                gpu_percent: Some(1.0),
                gpu_mem_percent: Some(1.0),
                mem_percent: 1.0,
                running_jobs: 0,
            },
            installed_models: None,
            installed_services: Some(vec![
                InstalledService { service_id: "node-inference".to_string(), version: "1".to_string(), platform: "test".to_string() },
                InstalledService { service_id: "nmt-m2m100".to_string(), version: "1".to_string(), platform: "test".to_string() },
                InstalledService { service_id: "piper-tts".to_string(), version: "1".to_string(), platform: "test".to_string() },
            ]),
            capability_state: Some(capability_state),
        }
    }

