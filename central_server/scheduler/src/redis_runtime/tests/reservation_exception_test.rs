#[cfg(test)]
mod tests {
    use crate::redis_runtime::runtime_routing::Phase2Runtime;
    use crate::redis_runtime::redis_handle::RedisHandle;
    use crate::redis_runtime::tests::common::*;
    use serde_json::json;

    /// 测试 try_reserve 失败：节点已满（FULL）
    #[tokio::test]
    async fn test_try_reserve_failure_full() {
        let redis_cfg = test_redis_config();
        if !can_connect_redis(&redis_cfg).await {
            eprintln!("skip: redis not available");
            return;
        }

        let key_prefix = format!(
            "lingua_test_exception_{}",
            uuid::Uuid::new_v4().to_string().replace('-', "")
        );
        let mut cfg = crate::core::config::RedisRuntimeConfig::default();
        cfg.enabled = true;
        cfg.redis = redis_cfg;
        cfg.redis.key_prefix = key_prefix;

        let scheduler_cfg = crate::core::config::SchedulerConfig::default();
        let rt = Phase2Runtime::new(cfg, 5, &scheduler_cfg).await.unwrap().unwrap();

        let node_id = "node-exception-1";
        let node_cap_key = rt.node_cap_key(node_id);
        let node_meta_key = rt.node_meta_key(node_id);

        // 初始化节点容量：max=2, running=1, reserved=1（已满）
        let _ = rt.sync_node_capacity_to_redis(node_id, 2, 1, "ready").await;
        
        // 手动设置 reserved=1（因为 sync_node_capacity_to_redis 不设置 reserved）
        use redis::Commands;
        let redis_url = std::env::var("LINGUA_TEST_REDIS_URL")
            .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
        if let Ok(client) = redis::Client::open(redis_url.as_str()) {
            if let Ok(mut conn) = client.get_connection() {
                let _: Result<(), _> = conn.hset::<_, _, _, ()>(&node_cap_key, "reserved", "1");
            }
        }

        // 尝试预留：应该失败（FULL）
        let resv_key = rt.resv_key("job-1", 1);
        let resv_value = json!({
            "node_id": node_id,
            "job_id": "job-1",
            "attempt_id": 1,
            "created_ms": chrono::Utc::now().timestamp_millis(),
            "ttl_ms": 5000
        });
        let resv_value_json = serde_json::to_string(&resv_value).unwrap();

        let (status, reason) = rt
            .redis
            .try_reserve(&node_cap_key, &node_meta_key, &resv_key, 5000, &resv_value_json)
            .await
            .unwrap();

        assert_eq!(status, 0, "预留应该失败");
        assert_eq!(reason, "FULL", "失败原因应该是 FULL");
    }

    /// 测试 try_reserve 失败：节点不健康（NOT_READY）
    #[tokio::test]
    async fn test_try_reserve_failure_not_ready() {
        let redis_cfg = test_redis_config();
        if !can_connect_redis(&redis_cfg).await {
            eprintln!("skip: redis not available");
            return;
        }

        let key_prefix = format!(
            "lingua_test_exception_{}",
            uuid::Uuid::new_v4().to_string().replace('-', "")
        );
        let mut cfg = crate::core::config::RedisRuntimeConfig::default();
        cfg.enabled = true;
        cfg.redis = redis_cfg;
        cfg.redis.key_prefix = key_prefix;

        let scheduler_cfg = crate::core::config::SchedulerConfig::default();
        let rt = Phase2Runtime::new(cfg, 5, &scheduler_cfg).await.unwrap().unwrap();

        let node_id = "node-exception-2";
        let node_cap_key = rt.node_cap_key(node_id);
        let node_meta_key = rt.node_meta_key(node_id);

        // 初始化节点容量：health=degraded（不健康）
        let _ = rt.sync_node_capacity_to_redis(node_id, 2, 0, "degraded").await;

        // 尝试预留：应该失败（NOT_READY）
        let resv_key = rt.resv_key("job-1", 1);
        let resv_value = json!({
            "node_id": node_id,
            "job_id": "job-1",
            "attempt_id": 1,
            "created_ms": chrono::Utc::now().timestamp_millis(),
            "ttl_ms": 5000
        });
        let resv_value_json = serde_json::to_string(&resv_value).unwrap();

        let (status, reason) = rt
            .redis
            .try_reserve(&node_cap_key, &node_meta_key, &resv_key, 5000, &resv_value_json)
            .await
            .unwrap();

        assert_eq!(status, 0, "预留应该失败");
        assert_eq!(reason, "NOT_READY", "失败原因应该是 NOT_READY");
    }

    /// 测试 release_reserve：resv_key 不存在（已过期）
    #[tokio::test]
    async fn test_release_reserve_expired() {
        let redis_cfg = test_redis_config();
        if !can_connect_redis(&redis_cfg).await {
            eprintln!("skip: redis not available");
            return;
        }

        let key_prefix = format!(
            "lingua_test_exception_{}",
            uuid::Uuid::new_v4().to_string().replace('-', "")
        );
        let mut cfg = crate::core::config::RedisRuntimeConfig::default();
        cfg.enabled = true;
        cfg.redis = redis_cfg;
        cfg.redis.key_prefix = key_prefix;

        let scheduler_cfg = crate::core::config::SchedulerConfig::default();
        let rt = Phase2Runtime::new(cfg, 5, &scheduler_cfg).await.unwrap().unwrap();

        let node_id = "node-exception-3";
        let node_cap_key = rt.node_cap_key(node_id);
        let resv_key = rt.resv_key("job-1", 1);

        // 初始化节点容量
        let _ = rt.sync_node_capacity_to_redis(node_id, 2, 0, "ready").await;

        // 尝试释放不存在的 resv_key（已过期）
        let released = rt.release_node_slot(node_id, "job-1", 1).await;

        // 应该返回 false（resv_key 不存在）
        assert!(!released, "释放已过期的 reservation 应该返回 false");

        // 验证 reserved 计数没有变化（不应该变成负数）
        use redis::Commands;
        let redis_url = std::env::var("LINGUA_TEST_REDIS_URL")
            .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
        if let Ok(client) = redis::Client::open(redis_url.as_str()) {
            if let Ok(mut conn) = client.get_connection() {
                let reserved: Option<String> = conn.hget(&node_cap_key, "reserved").ok();
                let reserved_val = reserved.and_then(|v| v.parse::<i32>().ok()).unwrap_or(0);
                assert!(reserved_val >= 0, "reserved 不应该变成负数");
            }
        }
    }

    /// 测试 commit_reserve：resv_key 不存在（已过期，ACK 迟到）
    #[tokio::test]
    async fn test_commit_reserve_expired() {
        let redis_cfg = test_redis_config();
        if !can_connect_redis(&redis_cfg).await {
            eprintln!("skip: redis not available");
            return;
        }

        let key_prefix = format!(
            "lingua_test_exception_{}",
            uuid::Uuid::new_v4().to_string().replace('-', "")
        );
        let mut cfg = crate::core::config::RedisRuntimeConfig::default();
        cfg.enabled = true;
        cfg.redis = redis_cfg;
        cfg.redis.key_prefix = key_prefix;

        let scheduler_cfg = crate::core::config::SchedulerConfig::default();
        let rt = Phase2Runtime::new(cfg, 5, &scheduler_cfg).await.unwrap().unwrap();

        let node_id = "node-exception-4";
        let node_cap_key = rt.node_cap_key(node_id);
        let resv_key = rt.resv_key("job-1", 1);

        // 初始化节点容量
        let _ = rt.sync_node_capacity_to_redis(node_id, 2, 0, "ready").await;

        // 尝试 commit 不存在的 resv_key（已过期，ACK 迟到）
        let committed = rt.commit_node_reservation(node_id, &resv_key).await;

        // 应该返回 false（resv_key 不存在）
        assert!(!committed, "commit 已过期的 reservation 应该返回 false");

        // 验证 running 计数没有增加
        use redis::Commands;
        let redis_url = std::env::var("LINGUA_TEST_REDIS_URL")
            .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
        if let Ok(client) = redis::Client::open(redis_url.as_str()) {
            if let Ok(mut conn) = client.get_connection() {
                let running: Option<String> = conn.hget(&node_cap_key, "running").ok();
                let running_val = running.and_then(|v| v.parse::<i32>().ok()).unwrap_or(0);
                assert_eq!(running_val, 0, "running 不应该增加（resv_key 不存在）");
            }
        }
    }

    /// 测试 dec_running：下限保护（running 不能 < 0）
    #[tokio::test]
    async fn test_dec_running_lower_bound() {
        let redis_cfg = test_redis_config();
        if !can_connect_redis(&redis_cfg).await {
            eprintln!("skip: redis not available");
            return;
        }

        let key_prefix = format!(
            "lingua_test_exception_{}",
            uuid::Uuid::new_v4().to_string().replace('-', "")
        );
        let mut cfg = crate::core::config::RedisRuntimeConfig::default();
        cfg.enabled = true;
        cfg.redis = redis_cfg;
        cfg.redis.key_prefix = key_prefix;

        let scheduler_cfg = crate::core::config::SchedulerConfig::default();
        let rt = Phase2Runtime::new(cfg, 5, &scheduler_cfg).await.unwrap().unwrap();

        let node_id = "node-exception-5";
        let node_cap_key = rt.node_cap_key(node_id);

        // 初始化节点容量：running=0
        let _ = rt.sync_node_capacity_to_redis(node_id, 2, 0, "ready").await;

        // 尝试 decrement running（已经是 0）
        rt.dec_node_running(node_id).await;

        // 验证 running 仍然是 0（不应该变成负数）
        use redis::Commands;
        let redis_url = std::env::var("LINGUA_TEST_REDIS_URL")
            .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
        if let Ok(client) = redis::Client::open(redis_url.as_str()) {
            if let Ok(mut conn) = client.get_connection() {
                let running: Option<String> = conn.hget(&node_cap_key, "running").ok();
                let running_val = running.and_then(|v| v.parse::<i32>().ok()).unwrap_or(0);
                assert!(running_val >= 0, "running 不应该变成负数");
            }
        }
    }
}
