    async fn phase2_cluster_acceptance_smoke() {
        // Cluster 自动化验收专用：
        // - 只在 LINGUA_TEST_REDIS_MODE=cluster 时跑（避免本地 single 环境变慢）
        // - 覆盖：presence/owner、Streams（含 DLQ + XCLAIM）、Lua（reservation/FSM）、request 幂等、snapshot 清理
        let redis_cfg = test_redis_config();
        if redis_cfg.mode != "cluster" {
            eprintln!("skip: not in cluster mode (set LINGUA_TEST_REDIS_MODE=cluster)");
            return;
        }
        if !can_connect_redis(&redis_cfg).await {
            eprintln!("skip: redis cluster not available");
            return;
        }

        let key_prefix = format!(
            "lingua_test_{}",
            uuid::Uuid::new_v4().to_string().replace('-', "")
        );

        let mut cfg = crate::config::Phase2Config::default();
        cfg.enabled = true;
        cfg.redis = redis_cfg.clone();
        cfg.redis.key_prefix = key_prefix;
        cfg.stream_block_ms = 50;
        cfg.stream_count = 10;
        cfg.stream_maxlen = 200;
        cfg.dlq_enabled = true;
        cfg.dlq_maxlen = 200;
        cfg.dlq_max_deliveries = 1;
        cfg.dlq_min_idle_ms = 1;
        cfg.dlq_scan_interval_ms = 1000;
        cfg.dlq_scan_count = 50;
        cfg.node_snapshot.enabled = true;
        cfg.node_snapshot.presence_ttl_seconds = 30;
        cfg.node_snapshot.refresh_interval_ms = 500;
        cfg.node_snapshot.remove_stale_after_seconds = 1;

        let rt_a = Phase2Runtime::new(
            {
                let mut c = cfg.clone();
                c.instance_id = "acc-a".to_string();
                c
            },
            5,
        )
        .await
        .unwrap()
        .unwrap();
        let rt_b = Phase2Runtime::new(
            {
                let mut c = cfg.clone();
                c.instance_id = "acc-b".to_string();
                c
            },
            5,
        )
        .await
        .unwrap()
        .unwrap();

        // ===== 1) presence + owner 解析（需要 presence 才会返回 owner）=====
        let _ = rt_a
            .redis
            .set_ex_string(&rt_a.scheduler_presence_key(), "1", 10)
            .await;
        let _ = rt_b
            .redis
            .set_ex_string(&rt_b.scheduler_presence_key(), "1", 10)
            .await;

        rt_a.set_node_owner("node-1").await;
        // 强行让 node-1 归属于 B（模拟 node 连接在 B）
        let _ = rt_a
            .redis
            .set_ex_string(&rt_a.node_owner_key("node-1"), &rt_b.instance_id, 10)
            .await;
        assert_eq!(rt_a.resolve_node_owner("node-1").await, Some(rt_b.instance_id.clone()));
        // 删除 B presence 后应认为 owner 不可用
        let _ = rt_a.redis.del(&rt_b.scheduler_presence_key()).await;
        assert_eq!(rt_a.resolve_node_owner("node-1").await, None);
        // 恢复 B presence
        let _ = rt_b
            .redis
            .set_ex_string(&rt_b.scheduler_presence_key(), "1", 10)
            .await;

        // ===== 2) Streams：A -> B inbox；制造 pending；DLQ 搬运（XPENDING + XCLAIM）=====
        let stream_b = rt_b.instance_inbox_stream_key(&rt_b.instance_id);
        rt_b.ensure_group(&stream_b).await;

        let evt = InterInstanceEvent::SendToSession {
            session_id: "sess-offline".to_string(),
            message: SessionMessage::ServerHeartbeat {
                session_id: "sess-offline".to_string(),
                timestamp: 1,
            },
        };
        assert!(rt_a.enqueue_to_instance(&rt_b.instance_id, &evt).await);
        // 读一次但不 ack/del，使其进入 pending
        let items = rt_b.xreadgroup(&stream_b, ">", 200, 10).await.unwrap();
        assert!(!items.is_empty());
        let (pending_id, _payload) = &items[0];
        // 等待一点点让 idle > dlq_min_idle_ms
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        // 直接触发 DLQ 扫描
        rt_b.scan_pending_to_dlq(&stream_b).await.unwrap();
        // DLQ 应该至少有 1 条
        let dlq = rt_b.instance_dlq_stream_key(&rt_b.instance_id);
        let dlq_len: u64 = rt_b
            .redis
            .query({
                let mut c = redis::cmd("XLEN");
                c.arg(&dlq);
                c
            })
            .await
            .unwrap_or(0);
        assert!(dlq_len >= 1);
        // 原 stream 上这条消息应已被删除（best-effort：XDEL 后 XLEN 可能仍>0，但该 id 不应存在）
        let v: redis::Value = rt_b
            .redis
            .query({
                let mut c = redis::cmd("XRANGE");
                c.arg(&stream_b).arg(pending_id).arg(pending_id);
                c
            })
            .await
            .unwrap();
        match v {
            redis::Value::Bulk(items) => assert!(items.is_empty()),
            _ => {}
        }

        // ===== 3) Lua：node reservation（capacity）=====
        let ok1 = rt_a.reserve_node_slot("node-cap", "job-1", 30, 0, 1).await;
        let ok2 = rt_a.reserve_node_slot("node-cap", "job-2", 30, 0, 1).await;
        assert!(ok1);
        assert!(!ok2);
        rt_a.release_node_slot("node-cap", "job-1").await;
        let ok3 = rt_a.reserve_node_slot("node-cap", "job-2", 30, 0, 1).await;
        assert!(ok3);

        // ===== 4) Job FSM：Lua 迁移（同 slot hash tag {job:<id>}) =====
        let job_id = "job-cluster-1";
        rt_a.job_fsm_init(job_id, Some("node-1"), 1, 60).await;
        assert!(rt_a.job_fsm_to_dispatched(job_id, 1).await);
        assert!(rt_a.job_fsm_to_accepted(job_id, 1).await);
        assert!(rt_a.job_fsm_to_running(job_id).await);
        assert!(rt_a.job_fsm_to_finished(job_id, 1, true).await);
        assert!(rt_a.job_fsm_to_released(job_id).await);

        // ===== 5) request lock/binding 幂等 =====
        let rid = "req-1";
        assert!(rt_a.acquire_request_lock(rid, "o1", 5000).await);
        assert!(!rt_a.acquire_request_lock(rid, "o2", 5000).await);
        rt_a.release_request_lock(rid, "o1").await;
        assert!(rt_a.acquire_request_lock(rid, "o2", 5000).await);
        rt_a.set_request_binding(rid, "job-bind-1", Some("node-1"), 10, false).await;
        let b = rt_a.get_request_binding(rid).await.unwrap();
        assert_eq!(b.job_id, "job-bind-1");

        // ===== 6) snapshot 清理：nodes:all + last_seen =====
        let node = sample_node("node-stale");
        rt_a.upsert_node_snapshot(&node).await;
        // 模拟离线：删 presence，并把 last_seen 设置为旧值
        let _ = rt_a.redis.del(&rt_a.node_presence_key("node-stale")).await;
        let old_ms = chrono::Utc::now().timestamp_millis() - 10_000;
        let _ = rt_a
            .redis
            .zadd_score(&rt_a.nodes_last_seen_zset_key(), "node-stale", old_ms)
            .await;
        rt_a.cleanup_stale_nodes().await;
        let ids = rt_a.redis.smembers_strings(&rt_a.nodes_all_set_key()).await.unwrap();
        assert!(!ids.contains(&"node-stale".to_string()));
    }
