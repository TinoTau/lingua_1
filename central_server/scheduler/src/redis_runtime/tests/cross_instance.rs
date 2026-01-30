    async fn phase2_cross_instance_delivery_e2e_minimal() {
        // 目标：无需启动完整 scheduler server，仅验证 A -> Redis inbox -> B 读取并解析 payload 的链路。
        let redis_cfg = test_redis_config();
        if !can_connect_redis(&redis_cfg).await {
            eprintln!("skip: redis not available (mode={})", redis_cfg.mode);
            return;
        }

        let mut cfg = crate::core::config::Phase2Config::default();
        cfg.enabled = true;
        cfg.redis = redis_cfg.clone();
        cfg.redis.key_prefix = format!("lingua_test_{}", uuid::Uuid::new_v4().to_string().replace('-', ""));
        cfg.stream_block_ms = 50;
        cfg.stream_count = 10;
        cfg.stream_maxlen = 1000;
        cfg.dlq_enabled = true;

        let scheduler_cfg = crate::core::config::SchedulerConfig::default();
        let rt_a = Phase2Runtime::new(
            {
                let mut c = cfg.clone();
                c.instance_id = "test-a".to_string();
                c
            },
            5,
            &scheduler_cfg,
        )
        .await
        .unwrap()
        .unwrap();
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

        let stream_b = rt_b.instance_inbox_stream_key(&rt_b.instance_id);
        rt_b.ensure_group(&stream_b).await;

        // A 投递到 B 的 inbox
        let evt = InterInstanceEvent::SendToSession {
            session_id: "sess-1".to_string(),
            message: SessionMessage::ServerHeartbeat {
                session_id: "sess-1".to_string(),
                timestamp: 123,
            },
        };
        assert!(rt_a.enqueue_to_instance(&rt_b.instance_id, &evt).await);

        // B 读新消息并解析
        let items = rt_b.xreadgroup(&stream_b, ">", 200, 10).await.unwrap();
        assert!(!items.is_empty());
        let (_id, payload) = &items[0];
        let parsed: InterInstanceEvent = serde_json::from_str(payload).unwrap();
        match parsed {
            InterInstanceEvent::SendToSession { session_id, .. } => assert_eq!(session_id, "sess-1"),
            _ => panic!("unexpected event type"),
        }
    }

