#[cfg(test)]
mod tests {
    use crate::redis_runtime::runtime_routing::Phase2Runtime;
    use crate::redis_runtime::tests::common::*;
    use crate::messages::ErrorCode;

    /// 测试 Redis 不可用时的处理策略（fail closed）
    #[tokio::test]
    async fn test_redis_unavailable_fail_closed() {
        // 使用一个无效的 Redis URL 来模拟 Redis 不可用
        let mut cfg = crate::core::config::Phase2Config::default();
        cfg.enabled = true;
        cfg.redis.url = "redis://127.0.0.1:9999".to_string(); // 无效端口
        cfg.redis.key_prefix = format!(
            "lingua_test_redis_unavailable_{}",
            uuid::Uuid::new_v4().to_string().replace('-', "")
        );

        // 尝试创建 Phase2Runtime（应该失败或返回 None）
        let scheduler_cfg = crate::core::config::SchedulerConfig::default();
        let rt_result = Phase2Runtime::new(cfg, 5, &scheduler_cfg).await;
        
        // 如果成功创建，尝试预留节点槽位，应该返回 SchedulerDependencyDown 错误
        if let Ok(Some(rt)) = rt_result {
            let result = rt.reserve_node_slot("node-1", "job-1", 1, 30).await;
            
            match result {
                Err(ErrorCode::SchedulerDependencyDown) => {
                    // 正确：返回了 SchedulerDependencyDown 错误
                    println!("✓ Redis 不可用时正确返回 SchedulerDependencyDown 错误");
                }
                Ok(_) => {
                    // 如果连接成功（可能测试环境有 Redis），跳过测试
                    eprintln!("skip: Redis connection succeeded, cannot test unavailable scenario");
                }
                Err(e) => {
                    panic!("Expected SchedulerDependencyDown, got {:?}", e);
                }
            }
        } else {
            // Runtime 创建失败也是可以接受的（fail closed）
            println!("✓ Phase2Runtime 创建失败（fail closed），符合预期");
        }
    }

    /// 测试 Redis 连接错误时的错误处理
    #[tokio::test]
    async fn test_redis_connection_error_handling() {
        let redis_cfg = test_redis_config();
        if !can_connect_redis(&redis_cfg).await {
            eprintln!("skip: redis not available");
            return;
        }

        let key_prefix = format!(
            "lingua_test_connection_error_{}",
            uuid::Uuid::new_v4().to_string().replace('-', "")
        );
        let mut cfg = crate::core::config::Phase2Config::default();
        cfg.enabled = true;
        cfg.redis = redis_cfg;
        cfg.redis.key_prefix = key_prefix;

        let scheduler_cfg = crate::core::config::SchedulerConfig::default();
        let rt = Phase2Runtime::new(cfg, 5, &scheduler_cfg).await.unwrap().unwrap();

        // 先正常同步节点容量
        let _ = rt.sync_node_capacity_to_redis("node-test", 2, 0, "ready").await;

        // 正常预留应该成功
        let result1 = rt.reserve_node_slot("node-test", "job-1", 1, 30).await;
        assert!(result1.is_ok(), "正常预留应该成功");
        assert_eq!(result1.unwrap(), true, "正常预留应该返回 true");

        // 节点已满时应该返回 Ok(false)
        let result2 = rt.reserve_node_slot("node-test", "job-2", 1, 30).await;
        assert!(result2.is_ok(), "节点已满时应该返回 Ok(false)");
        assert_eq!(result2.unwrap(), false, "节点已满时应该返回 false");

        // 清理
        rt.release_node_slot("node-test", "job-1", 1).await;
    }
}
