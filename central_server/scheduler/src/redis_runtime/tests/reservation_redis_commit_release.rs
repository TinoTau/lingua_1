    /// 测试 commit_reserve: reserved -> running
    #[tokio::test]
    async fn test_commit_reserve() {
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

        let node_id = "node-resv-4";
        let node_cap_key = rt.node_cap_key(node_id);
        let node_meta_key = rt.node_meta_key(node_id);
        let resv_key = rt.resv_key("job-4", 1);

        // 初始化节点容量
        let _ = rt
            .sync_node_capacity_to_redis(node_id, 2, 0, "ready")
            .await;

        // 先预留
        let resv_value = json!({
            "node_id": node_id,
            "job_id": "job-4",
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

        // 验证初始状态: reserved=1, running=0
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

        // 提交预留
        let ok = rt.redis.commit_reserve(&node_cap_key, &resv_key).await.unwrap();
        assert!(ok);

        // 验证状态转换: reserved=0, running=1
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

        // 验证 reservation 记录已删除
        let exists: bool = rt.redis.exists(&resv_key).await.unwrap_or(false);
        assert!(!exists);
    }

    /// 测试 release_reserve: 释放预留
    #[tokio::test]
    async fn test_release_reserve() {
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

        let node_id = "node-resv-5";
        let node_cap_key = rt.node_cap_key(node_id);
        let node_meta_key = rt.node_meta_key(node_id);
        let resv_key = rt.resv_key("job-5", 1);

        // 初始化节点容量
        let _ = rt
            .sync_node_capacity_to_redis(node_id, 2, 0, "ready")
            .await;

        // 先预留
        let resv_value = json!({
            "node_id": node_id,
            "job_id": "job-5",
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

        // 验证初始状态: reserved=1
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

        // 释放预留
        let ok = rt.redis.release_reserve(&node_cap_key, &resv_key).await.unwrap();
        assert!(ok);

        // 验证状态: reserved=0
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

        // 验证 reservation 记录已删除
        let exists: bool = rt.redis.exists(&resv_key).await.unwrap_or(false);
        assert!(!exists);
    }
