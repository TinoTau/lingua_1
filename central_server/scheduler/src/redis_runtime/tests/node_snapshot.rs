    use crate::redis_runtime::Phase2Runtime;
    use crate::node_registry::Node as RegistryNode;

    fn sample_node(node_id: &str) -> RegistryNode {
        let now = chrono::Utc::now();

        RegistryNode {
            language_capabilities: None,
            node_id: node_id.to_string(),
            name: "Node-Sample".to_string(),
            version: "0.0.1".to_string(),
            platform: "windows".to_string(),
            hardware: HardwareInfo {
                cpu_cores: 8,
                memory_gb: 32,
                gpus: Some(vec![GpuInfo { name: "RTX".to_string(), memory_gb: 8 }]),
            },
            status: NodeStatus::Ready,
            online: true,
            cpu_usage: 1.0,
            processing_metrics: None,
            gpu_usage: Some(2.0),
            memory_usage: 3.0,
            installed_models: vec![InstalledModel {
                model_id: "dummy".to_string(),
                kind: "asr".to_string(),
                src_lang: None,
                tgt_lang: None,
                dialect: None,
                version: "1".to_string(),
                enabled: Some(true),
            }],
            installed_services: vec![InstalledService {
                service_id: "node-inference".to_string(),
                r#type: ServiceType::Asr,
                device: DeviceType::Gpu,
                status: ServiceStatus::Running,
                version: Some("1".to_string()),
                model_id: None,
                engine: None,
                mem_mb: None,
                warmup_ms: None,
                last_error: None,
            }],
            features_supported: FeatureFlags {
                emotion_detection: None,
                voice_style_detection: None,
                speech_rate_detection: None,
                speech_rate_control: None,
                speaker_identification: None,
                persona_adaptation: None,
            },
            accept_public_jobs: true,
            // capability_by_type 和 capability_by_type_map 已从 Node 结构体中移除，能力信息存储在 Redis
            current_jobs: 0,
            max_concurrent_jobs: 4,
            last_heartbeat: now,
            registered_at: now,
        }
    }

    #[tokio::test]
    async fn phase2_node_snapshot_roundtrip_smoke() {
        let redis_cfg = test_redis_config();
        if !can_connect_redis(&redis_cfg).await {
            eprintln!("skip: redis not available (mode={})", redis_cfg.mode);
            return;
        }

        let mut cfg = crate::core::config::RedisRuntimeConfig::default();
        cfg.enabled = true;
        cfg.instance_id = "test-a".to_string();
        cfg.redis = redis_cfg.clone();
        cfg.redis.key_prefix = format!("lingua_test_{}", uuid::Uuid::new_v4().to_string().replace('-', ""));
        cfg.node_snapshot.enabled = true;
        cfg.node_snapshot.presence_ttl_seconds = 10;
        cfg.node_snapshot.refresh_interval_ms = 1000;

        let scheduler_cfg = crate::core::config::SchedulerConfig::default();
        let rt_a = Phase2Runtime::new(cfg.clone(), 5, &scheduler_cfg).await.unwrap().unwrap();
        let rt_b = Phase2Runtime::new(
            {
                let mut c = cfg.clone();
                c.instance_id = "test-b".to_string();
                c
            },
            5,
            &scheduler_cfg,
        )
        .await
        .unwrap()
        .unwrap();

        // 写 snapshot
        let node = sample_node("node-xyz");
        rt_a.upsert_node_snapshot(&node).await;

        // B 读出来（通过 nodes:all + GET snapshot）
        let ids = rt_b.redis.smembers_strings(&rt_b.nodes_all_set_key()).await.unwrap();
        assert!(ids.contains(&"node-xyz".to_string()));
        let json = rt_b.redis.get_string(&rt_b.node_snapshot_key("node-xyz")).await.unwrap().unwrap();
        let parsed: RegistryNode = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.node_id, "node-xyz");
        assert!(rt_b.redis.exists(&rt_b.node_presence_key("node-xyz")).await.unwrap());
    }

