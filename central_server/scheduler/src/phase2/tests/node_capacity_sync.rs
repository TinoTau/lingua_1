#[cfg(test)]
mod tests {
    use crate::phase2::runtime_routing::Phase2Runtime;
    use crate::phase2::tests::common::*;

    /// 测试 sync_node_capacity_to_redis: 同步节点容量到Redis
    #[tokio::test]
    async fn test_sync_node_capacity_to_redis() {
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

        let node_id = "node-cap-1";
        let node_cap_key = rt.node_cap_key(node_id);
        let node_meta_key = rt.node_meta_key(node_id);

        // 同步节点容量: max=5, running=2, health=ready
        let ok = rt
            .sync_node_capacity_to_redis(node_id, 5, 2, "ready")
            .await;
        assert!(ok);

        // 验证容量Hash
        let max: i64 = rt
            .redis
            .query({
                let mut c = redis::cmd("HGET");
                c.arg(&node_cap_key).arg("max");
                c
            })
            .await
            .unwrap_or(0);
        assert_eq!(max, 5);

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

        // 验证元数据Hash
        let health: String = rt
            .redis
            .query({
                let mut c = redis::cmd("HGET");
                c.arg(&node_meta_key).arg("health");
                c
            })
            .await
            .unwrap_or_default();
        assert_eq!(health, "ready");

        let max_concurrent_jobs: i64 = rt
            .redis
            .query({
                let mut c = redis::cmd("HGET");
                c.arg(&node_meta_key).arg("max_concurrent_jobs");
                c
            })
            .await
            .unwrap_or(0);
        assert_eq!(max_concurrent_jobs, 5);

        // 验证TTL
        let ttl: i64 = rt
            .redis
            .query({
                let mut c = redis::cmd("TTL");
                c.arg(&node_cap_key);
                c
            })
            .await
            .unwrap_or(0);
        assert!(ttl > 0 && ttl <= 3600); // TTL应该在1小时内
    }

    /// 测试 sync_node_capacity_to_redis: 更新容量
    #[tokio::test]
    async fn test_sync_node_capacity_update() {
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

        let node_id = "node-cap-2";
        let node_cap_key = rt.node_cap_key(node_id);

        // 第一次同步: max=5, running=2
        let ok = rt
            .sync_node_capacity_to_redis(node_id, 5, 2, "ready")
            .await;
        assert!(ok);

        // 手动设置 reserved=1（模拟reservation机制）
        let _: () = rt
            .redis
            .query({
                let mut c = redis::cmd("HSET");
                c.arg(&node_cap_key).arg("reserved").arg(1);
                c
            })
            .await
            .unwrap();

        // 第二次同步: max=5, running=3 (reserved应该保持不变)
        let ok = rt
            .sync_node_capacity_to_redis(node_id, 5, 3, "ready")
            .await;
        assert!(ok);

        // 验证 running 已更新
        let running: i64 = rt
            .redis
            .query({
                let mut c = redis::cmd("HGET");
                c.arg(&node_cap_key).arg("running");
                c
            })
            .await
            .unwrap_or(0);
        assert_eq!(running, 3);

        // 验证 reserved 保持不变
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
    }

    /// 测试 sync_node_capacity_to_redis: 健康状态更新
    #[tokio::test]
    async fn test_sync_node_capacity_health_update() {
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

        let node_id = "node-cap-3";
        let node_meta_key = rt.node_meta_key(node_id);

        // 初始状态: ready
        let ok = rt
            .sync_node_capacity_to_redis(node_id, 5, 0, "ready")
            .await;
        assert!(ok);

        let health: String = rt
            .redis
            .query({
                let mut c = redis::cmd("HGET");
                c.arg(&node_meta_key).arg("health");
                c
            })
            .await
            .unwrap_or_default();
        assert_eq!(health, "ready");

        // 更新状态: busy
        let ok = rt
            .sync_node_capacity_to_redis(node_id, 5, 0, "busy")
            .await;
        assert!(ok);

        let health: String = rt
            .redis
            .query({
                let mut c = redis::cmd("HGET");
                c.arg(&node_meta_key).arg("health");
                c
            })
            .await
            .unwrap_or_default();
        assert_eq!(health, "busy");
    }
}
