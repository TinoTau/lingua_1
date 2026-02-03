    /// 测试 dec_running: 任务完成时 running -= 1
    #[tokio::test]
    async fn test_dec_running() {
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

        let node_id = "node-resv-6";
        let node_cap_key = rt.node_cap_key(node_id);

        // 初始化节点容量: running=2
        let _ = rt
            .sync_node_capacity_to_redis(node_id, 2, 2, "ready")
            .await;

        // 验证初始状态: running=2
        let running: i64 = rt
            .redis
            .query({
                let mut c = redis::cmd("HGET");
                c.arg(&node_cap_key).arg("running");
                c
            })
            .await
            .unwrap_or(0);
        assert_eq!(running, 2);

        // 减少 running
        let ok = rt.redis.dec_running(&node_cap_key).await.unwrap();
        assert!(ok);

        // 验证状态: running=1
        let running: i64 = rt
            .redis
            .query({
                let mut c = redis::cmd("HGET");
                c.arg(&node_cap_key).arg("running");
                c
            })
            .await
            .unwrap_or(0);
        assert_eq!(running, 1);

        // 再次减少 running
        let ok = rt.redis.dec_running(&node_cap_key).await.unwrap();
        assert!(ok);

        // 验证状态: running=0
        let running: i64 = rt
            .redis
            .query({
                let mut c = redis::cmd("HGET");
                c.arg(&node_cap_key).arg("running");
                c
            })
            .await
            .unwrap_or(0);
        assert_eq!(running, 0);

        // running=0 时再次减少，应该仍然成功（不会变成负数）
        let ok = rt.redis.dec_running(&node_cap_key).await.unwrap();
        assert!(ok);
        let running: i64 = rt
            .redis
            .query({
                let mut c = redis::cmd("HGET");
                c.arg(&node_cap_key).arg("running");
                c
            })
            .await
            .unwrap_or(0);
        assert_eq!(running, 0);
    }

    /// 测试完整的 Reservation 生命周期
    #[tokio::test]
    async fn test_reservation_lifecycle() {
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

        let node_id = "node-resv-lifecycle";
        let node_cap_key = rt.node_cap_key(node_id);
        let node_meta_key = rt.node_meta_key(node_id);
        let resv_key = rt.resv_key("job-lifecycle", 1);

        // 初始化节点容量: max=3, running=0
        let _ = rt
            .sync_node_capacity_to_redis(node_id, 3, 0, "ready")
            .await;

        // 1. 预留
        let resv_value = json!({
            "node_id": node_id,
            "job_id": "job-lifecycle",
            "attempt_id": 1,
            "created_ms": chrono::Utc::now().timestamp_millis(),
            "ttl_ms": 5000
        });
        let resv_value_json = serde_json::to_string(&resv_value).unwrap();
        let (status, _) = rt
            .redis
            .try_reserve(&node_cap_key, &node_meta_key, &resv_key, 5000, &resv_value_json)
            .await
            .unwrap();
        assert_eq!(status, 1);

        // 验证: reserved=1, running=0
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

        // 2. 提交预留 (reserved -> running)
        let ok = rt.redis.commit_reserve(&node_cap_key, &resv_key).await.unwrap();
        assert!(ok);

        // 验证: reserved=0, running=1
        let reserved: i64 = rt
            .redis
            .query({
                let mut c = redis::cmd("HGET");
                c.arg(&node_cap_key).arg("reserved");
                c
            })
            .await
            .unwrap_or(0);
        assert_eq!(reserved, 0);
        let running: i64 = rt
            .redis
            .query({
                let mut c = redis::cmd("HGET");
                c.arg(&node_cap_key).arg("running");
                c
            })
            .await
            .unwrap_or(0);
        assert_eq!(running, 1);

        // 3. 任务完成 (running -= 1)
        let ok = rt.redis.dec_running(&node_cap_key).await.unwrap();
        assert!(ok);

        // 验证: running=0
        let running: i64 = rt
            .redis
            .query({
                let mut c = redis::cmd("HGET");
                c.arg(&node_cap_key).arg("running");
                c
            })
            .await
            .unwrap_or(0);
        assert_eq!(running, 0);
    }
