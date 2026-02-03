    /// 测试 try_reserve: 成功预留
    #[tokio::test]
    async fn test_try_reserve_success() {
        let redis_cfg = test_redis_config();
        if !can_connect_redis(&redis_cfg).await {
            eprintln!("skip: redis not available");
            return;
        }

        let key_prefix = format!(
            "lingua_test_{}",
            uuid::Uuid::new_v4().to_string().replace('-', "")
        );
        let mut cfg = crate::core::config::RedisRuntimeConfig::default();
        cfg.enabled = true;
        cfg.redis = redis_cfg;
        cfg.redis.key_prefix = key_prefix;

        let scheduler_cfg = crate::core::config::SchedulerConfig::default();
        let rt = RedisRuntime::new(cfg, 5, &scheduler_cfg).await.unwrap().unwrap();

        let node_id = "node-resv-1";
        let node_cap_key = rt.node_cap_key(node_id);
        let node_meta_key = rt.node_meta_key(node_id);
        let resv_key = rt.resv_key("job-1", 1);

        // 初始化节点容量和元数据
        let _ = rt
            .sync_node_capacity_to_redis(node_id, 2, 0, "ready")
            .await;

        // 创建 reservation 值
        let resv_value = json!({
            "node_id": node_id,
            "job_id": "job-1",
            "attempt_id": 1,
            "created_ms": chrono::Utc::now().timestamp_millis(),
            "ttl_ms": 5000
        });
        let resv_value_json = serde_json::to_string(&resv_value).unwrap();

        // 测试预留成功
        let (status, reason) = rt
            .redis
            .try_reserve(&node_cap_key, &node_meta_key, &resv_key, 5000, &resv_value_json)
            .await
            .unwrap();
        assert_eq!(status, 1);
        assert_eq!(reason, "OK");

        // 验证 reserved 计数增加
        let reserved: i64 = rt
            .redis
            .query({
                let mut c = redis::cmd("HGET");
                c.arg(&node_cap_key).arg("reserved");
                c
            })
            .await
            .unwrap_or(0);
        assert_eq!(reserved, 1);

        // 验证 reservation 记录存在
        let exists: bool = rt.redis.exists(&resv_key).await.unwrap_or(false);
        assert!(exists);
    }

    /// 测试 try_reserve: 容量已满
    #[tokio::test]
    async fn test_try_reserve_full() {
        let redis_cfg = test_redis_config();
        if !can_connect_redis(&redis_cfg).await {
            eprintln!("skip: redis not available");
            return;
        }

        let key_prefix = format!(
            "lingua_test_{}",
            uuid::Uuid::new_v4().to_string().replace('-', "")
        );
        let mut cfg = crate::core::config::RedisRuntimeConfig::default();
        cfg.enabled = true;
        cfg.redis = redis_cfg;
        cfg.redis.key_prefix = key_prefix;

        let scheduler_cfg = crate::core::config::SchedulerConfig::default();
        let rt = RedisRuntime::new(cfg, 5, &scheduler_cfg).await.unwrap().unwrap();

        let node_id = "node-resv-2";
        let node_cap_key = rt.node_cap_key(node_id);
        let node_meta_key = rt.node_meta_key(node_id);

        // 初始化节点容量: max=2, running=1, reserved=1 (已满)
        let _ = rt
            .sync_node_capacity_to_redis(node_id, 2, 1, "ready")
            .await;
        // 手动设置 reserved=1
        let _: () = rt
            .redis
            .query({
                let mut c = redis::cmd("HSET");
                c.arg(&node_cap_key).arg("reserved").arg(1);
                c
            })
            .await
            .unwrap();

        let resv_key = rt.resv_key("job-2", 1);
        let resv_value = json!({
            "node_id": node_id,
            "job_id": "job-2",
            "attempt_id": 1,
            "created_ms": chrono::Utc::now().timestamp_millis(),
            "ttl_ms": 5000
        });
        let resv_value_json = serde_json::to_string(&resv_value).unwrap();

        // 测试预留失败（容量已满）
        let (status, reason) = rt
            .redis
            .try_reserve(&node_cap_key, &node_meta_key, &resv_key, 5000, &resv_value_json)
            .await
            .unwrap();
        assert_eq!(status, 0);
        assert_eq!(reason, "FULL");
    }

    /// 测试 try_reserve: 节点不健康
    #[tokio::test]
    async fn test_try_reserve_not_ready() {
        let redis_cfg = test_redis_config();
        if !can_connect_redis(&redis_cfg).await {
            eprintln!("skip: redis not available");
            return;
        }

        let key_prefix = format!(
            "lingua_test_{}",
            uuid::Uuid::new_v4().to_string().replace('-', "")
        );
        let mut cfg = crate::core::config::RedisRuntimeConfig::default();
        cfg.enabled = true;
        cfg.redis = redis_cfg;
        cfg.redis.key_prefix = key_prefix;

        let scheduler_cfg = crate::core::config::SchedulerConfig::default();
        let rt = RedisRuntime::new(cfg, 5, &scheduler_cfg).await.unwrap().unwrap();

        let node_id = "node-resv-3";
        let node_cap_key = rt.node_cap_key(node_id);
        let node_meta_key = rt.node_meta_key(node_id);

        // 初始化节点容量，但健康状态为 "busy"
        let _ = rt
            .sync_node_capacity_to_redis(node_id, 2, 0, "busy")
            .await;

        let resv_key = rt.resv_key("job-3", 1);
        let resv_value = json!({
            "node_id": node_id,
            "job_id": "job-3",
            "attempt_id": 1,
            "created_ms": chrono::Utc::now().timestamp_millis(),
            "ttl_ms": 5000
        });
        let resv_value_json = serde_json::to_string(&resv_value).unwrap();

        // 测试预留失败（节点不健康）
        let (status, reason) = rt
            .redis
            .try_reserve(&node_cap_key, &node_meta_key, &resv_key, 5000, &resv_value_json)
            .await
            .unwrap();
        assert_eq!(status, 0);
        assert_eq!(reason, "NOT_READY");
    }
