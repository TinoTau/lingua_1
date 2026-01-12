#[cfg(test)]
mod tests {
    use crate::phase2::runtime_routing::Phase2Runtime;
    use crate::phase2::redis_handle::RedisHandle;
    use crate::phase2::tests::common::*;
    use serde_json::json;

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
        let mut cfg = crate::core::config::Phase2Config::default();
        cfg.enabled = true;
        cfg.redis = redis_cfg;
        cfg.redis.key_prefix = key_prefix;

        let rt = Phase2Runtime::new(cfg, 5).await.unwrap().unwrap();

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
        let mut cfg = crate::core::config::Phase2Config::default();
        cfg.enabled = true;
        cfg.redis = redis_cfg;
        cfg.redis.key_prefix = key_prefix;

        let rt = Phase2Runtime::new(cfg, 5).await.unwrap().unwrap();

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
        let mut cfg = crate::core::config::Phase2Config::default();
        cfg.enabled = true;
        cfg.redis = redis_cfg;
        cfg.redis.key_prefix = key_prefix;

        let rt = Phase2Runtime::new(cfg, 5).await.unwrap().unwrap();

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
        let mut cfg = crate::core::config::Phase2Config::default();
        cfg.enabled = true;
        cfg.redis = redis_cfg;
        cfg.redis.key_prefix = key_prefix;

        let rt = Phase2Runtime::new(cfg, 5).await.unwrap().unwrap();

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
        let mut cfg = crate::core::config::Phase2Config::default();
        cfg.enabled = true;
        cfg.redis = redis_cfg;
        cfg.redis.key_prefix = key_prefix;

        let rt = Phase2Runtime::new(cfg, 5).await.unwrap().unwrap();

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
        let mut cfg = crate::core::config::Phase2Config::default();
        cfg.enabled = true;
        cfg.redis = redis_cfg;
        cfg.redis.key_prefix = key_prefix;

        let rt = Phase2Runtime::new(cfg, 5).await.unwrap().unwrap();

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
        let mut cfg = crate::core::config::Phase2Config::default();
        cfg.enabled = true;
        cfg.redis = redis_cfg;
        cfg.redis.key_prefix = key_prefix;

        let rt = Phase2Runtime::new(cfg, 5).await.unwrap().unwrap();

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
}
