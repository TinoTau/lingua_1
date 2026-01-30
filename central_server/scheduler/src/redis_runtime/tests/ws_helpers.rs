    async fn build_test_state(
        instance_id: &str,
        redis_cfg: crate::core::config::Phase2RedisConfig,
        key_prefix: String,
    ) -> (crate::core::AppState, Arc<Phase2Runtime>) {
        use crate::core::{AppState, JobDispatcher, SessionManager};
        use crate::core::config::{CoreServicesConfig, TaskBindingConfig, WebTaskSegmentationConfig};
        use crate::managers::{AudioBufferManager, GroupConfig, GroupManager, ResultQueueManager, RoomManager, NodeConnectionManager, SessionConnectionManager};
        use crate::metrics::DashboardSnapshotCache;
        use crate::services::{PairingService, ServiceCatalogCache};
        use crate::model_not_available::ModelNotAvailableBus;
        use crate::node_registry::NodeRegistry;
        use std::time::Duration;

        let mut p2 = crate::core::config::Phase2Config::default();
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

        let scheduler_cfg = create_test_scheduler_config();
        let rt = Phase2Runtime::new(p2.clone(), 5, &scheduler_cfg).await.unwrap().unwrap();
        let rt = Arc::new(rt);

        let session_manager = SessionManager::new();
        // 从Phase2Runtime获取RedisHandle
        use crate::redis_runtime::RedisHandle;
        let redis_handle = Arc::new(rt.redis.clone());
        let node_registry = std::sync::Arc::new(NodeRegistry::new(redis_handle.clone()));
        
        // Phase3 Pool配置已废弃，现在使用MinimalScheduler + PoolService（Lua脚本自动管理）
        
        let mut dispatcher = JobDispatcher::new_with_config(
            node_registry.clone(),
            redis_handle,
            TaskBindingConfig::default(),
            CoreServicesConfig::default(),
        );
        dispatcher.set_phase2(Some(rt.clone()));

        let pairing_service = PairingService::new();

        // ModelHub 已删除（未实现）
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
            minimal_scheduler: None,
            session_manager,
            dispatcher,
            node_registry: node_registry.clone(),
            pairing_service,
            // model_hub 已删除
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
            job_idempotency: crate::core::JobIdempotencyManager::default(),
            job_result_deduplicator: crate::core::JobResultDeduplicator::new(),
            phase2: Some(rt.clone()),
        };

        // 启动 Phase2 后台任务（presence + owner 续约 + Streams inbox + snapshot refresh）
        rt.clone().spawn_background_tasks(state.clone());

        // Phase3自动Pool生成已废弃，现在由PoolService通过Lua脚本自动管理

        (state, rt)
    }

    async fn spawn_ws_server(state: crate::core::AppState) -> (std::net::SocketAddr, tokio::sync::oneshot::Sender<()>) {
        use axum::extract::State;
        use axum::extract::ws::WebSocketUpgrade;
        use axum::response::Response;
        use axum::routing::get;
        use axum::Router;

        async fn handle_session_ws(
            ws: WebSocketUpgrade,
            State(state): State<crate::core::AppState>,
        ) -> Response {
            ws.on_upgrade(move |socket| crate::websocket::handle_session(socket, state))
        }

        async fn handle_node_ws(
            ws: WebSocketUpgrade,
            State(state): State<crate::core::AppState>,
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
        let capability_by_type = vec![
            CapabilityByType { r#type: ServiceType::Asr, ready: true, reason: None, ready_impl_ids: Some(vec!["node-inference".into()]) },
            CapabilityByType { r#type: ServiceType::Nmt, ready: true, reason: None, ready_impl_ids: Some(vec!["nmt-m2m100".into()]) },
            CapabilityByType { r#type: ServiceType::Tts, ready: true, reason: None, ready_impl_ids: Some(vec!["piper-tts".into()]) },
        ];

        // 添加语言能力，支持 en→zh 翻译
        use crate::messages::common::{NodeLanguageCapabilities, NmtCapability, LanguagePair};
        let language_capabilities = Some(NodeLanguageCapabilities {
            semantic_languages: Some(vec!["en".to_string(), "zh".to_string()]),
            asr_languages: Some(vec!["en".to_string()]),
            tts_languages: Some(vec!["zh".to_string()]),
            nmt_capabilities: Some(vec![NmtCapability {
                model_id: "nmt-m2m100".to_string(),
                languages: vec!["en".to_string(), "zh".to_string()],
                rule: "any_to_any".to_string(),
                blocked_pairs: None,
                supported_pairs: Some(vec![LanguagePair { 
                    src: "en".to_string(), 
                    tgt: "zh".to_string(),
                    semantic_on_src: Some(true),
                    semantic_on_tgt: Some(true),
                }]),
            }]),
            supported_language_pairs: Some(vec![LanguagePair { 
                src: "en".to_string(), 
                tgt: "zh".to_string(),
                semantic_on_src: Some(true),
                semantic_on_tgt: Some(true),
            }]),
            semantic_core_ready: Some(true),
        });

        crate::messages::NodeMessage::NodeRegister {
            language_capabilities,
            node_id: Some(node_id.to_string()),
            version: "test".to_string(),
            capability_schema_version: Some("2.0".to_string()),
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
                InstalledService { service_id: "node-inference".to_string(), r#type: ServiceType::Asr, device: DeviceType::Gpu, status: ServiceStatus::Running, version: Some("1".to_string()), model_id: None, engine: None, mem_mb: None, warmup_ms: None, last_error: None },
                InstalledService { service_id: "nmt-m2m100".to_string(), r#type: ServiceType::Nmt, device: DeviceType::Gpu, status: ServiceStatus::Running, version: Some("1".to_string()), model_id: None, engine: None, mem_mb: None, warmup_ms: None, last_error: None },
                InstalledService { service_id: "piper-tts".to_string(), r#type: ServiceType::Tts, device: DeviceType::Gpu, status: ServiceStatus::Running, version: Some("1".to_string()), model_id: None, engine: None, mem_mb: None, warmup_ms: None, last_error: None },
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
            capability_by_type,
        }
    }

    fn sample_node_heartbeat(node_id: &str) -> crate::messages::NodeMessage {
        let capability_by_type = vec![
            CapabilityByType { r#type: ServiceType::Asr, ready: true, reason: None, ready_impl_ids: Some(vec!["node-inference".into()]) },
            CapabilityByType { r#type: ServiceType::Nmt, ready: true, reason: None, ready_impl_ids: Some(vec!["nmt-m2m100".into()]) },
            CapabilityByType { r#type: ServiceType::Tts, ready: true, reason: None, ready_impl_ids: Some(vec!["piper-tts".into()]) },
        ];

        // 添加语言能力，支持 en→zh 翻译
        use crate::messages::common::{NodeLanguageCapabilities, NmtCapability, LanguagePair};
        let language_capabilities = Some(NodeLanguageCapabilities {
            semantic_languages: Some(vec!["en".to_string(), "zh".to_string()]),
            asr_languages: Some(vec!["en".to_string()]),
            tts_languages: Some(vec!["zh".to_string()]),
            nmt_capabilities: Some(vec![NmtCapability {
                model_id: "nmt-m2m100".to_string(),
                languages: vec!["en".to_string(), "zh".to_string()],
                rule: "any_to_any".to_string(),
                blocked_pairs: None,
                supported_pairs: Some(vec![LanguagePair { 
                    src: "en".to_string(), 
                    tgt: "zh".to_string(),
                    semantic_on_src: Some(true),
                    semantic_on_tgt: Some(true),
                }]),
            }]),
            supported_language_pairs: Some(vec![LanguagePair { 
                src: "en".to_string(), 
                tgt: "zh".to_string(),
                semantic_on_src: Some(true),
                semantic_on_tgt: Some(true),
            }]),
            semantic_core_ready: Some(true),
        });

        crate::messages::NodeMessage::NodeHeartbeat {
            language_capabilities,
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
            installed_services: vec![
                InstalledService { service_id: "node-inference".to_string(), r#type: ServiceType::Asr, device: DeviceType::Gpu, status: ServiceStatus::Running, version: Some("1".to_string()), model_id: None, engine: None, mem_mb: None, warmup_ms: None, last_error: None },
                InstalledService { service_id: "nmt-m2m100".to_string(), r#type: ServiceType::Nmt, device: DeviceType::Gpu, status: ServiceStatus::Running, version: Some("1".to_string()), model_id: None, engine: None, mem_mb: None, warmup_ms: None, last_error: None },
                InstalledService { service_id: "piper-tts".to_string(), r#type: ServiceType::Tts, device: DeviceType::Gpu, status: ServiceStatus::Running, version: Some("1".to_string()), model_id: None, engine: None, mem_mb: None, warmup_ms: None, last_error: None },
            ],
            capability_by_type,
            rerun_metrics: None,
            asr_metrics: None,
            processing_metrics: None,
        }
    }

