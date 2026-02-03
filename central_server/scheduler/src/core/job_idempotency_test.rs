//! Job 幂等性管理器单元测试
//! 验证移除本地锁后，改用 Redis 实现的功能

#[cfg(test)]
mod tests {
    use super::super::job_idempotency::{JobIdempotencyManager, make_job_key, JobType};
    use crate::redis_runtime::RedisRuntime;
    use crate::core::config::RedisRuntimeConfig;
    use std::sync::Arc;

    /// 测试 Redis 配置（从环境变量读取，或使用默认值）
    fn test_redis_config() -> crate::core::config::RedisConnectionConfig {
        let mut cfg = crate::core::config::RedisConnectionConfig::default();
        let mode = std::env::var("LINGUA_TEST_REDIS_MODE").unwrap_or_else(|_| "single".to_string());
        if mode == "cluster" {
            cfg.mode = "cluster".to_string();
            if let Ok(s) = std::env::var("LINGUA_TEST_REDIS_CLUSTER_URLS") {
                cfg.cluster_urls = s
                    .split(',')
                    .map(|x| x.trim().to_string())
                    .filter(|x| !x.is_empty())
                    .collect();
            }
            if cfg.cluster_urls.is_empty() {
                cfg.cluster_urls = vec![std::env::var("LINGUA_TEST_REDIS_URL")
                    .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string())];
            }
        } else {
            cfg.mode = "single".to_string();
            cfg.url = std::env::var("LINGUA_TEST_REDIS_URL")
                .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
        }
        cfg
    }

    /// 检查是否可以连接到 Redis
    async fn can_connect_redis(cfg: &crate::core::config::RedisConnectionConfig) -> bool {
        match cfg.mode.as_str() {
            "cluster" => {
                let urls = if cfg.cluster_urls.is_empty() {
                    vec![cfg.url.clone()]
                } else {
                    cfg.cluster_urls.clone()
                };
                let client = match redis::cluster::ClusterClient::new(urls) {
                    Ok(c) => c,
                    Err(_) => return false,
                };
                let mut conn = match client.get_async_connection().await {
                    Ok(c) => c,
                    Err(_) => return false,
                };
                let pong: redis::RedisResult<String> = redis::cmd("PING").query_async(&mut conn).await;
                pong.is_ok()
            }
            _ => {
                let client = match redis::Client::open(cfg.url.as_str()) {
                    Ok(c) => c,
                    Err(_) => return false,
                };
                let mut conn = match client.get_multiplexed_tokio_connection().await {
                    Ok(c) => c,
                    Err(_) => return false,
                };
                let pong: redis::RedisResult<String> = redis::cmd("PING").query_async(&mut conn).await;
                pong.is_ok()
            }
        }
    }

    /// 清理测试 Redis 键
    async fn cleanup_test_keys(rt: &RedisRuntime) {
        let key_prefix = rt.key_prefix();
        let cfg = test_redis_config();
        match cfg.mode.as_str() {
            "cluster" => {
                let urls = if cfg.cluster_urls.is_empty() {
                    vec![cfg.url.clone()]
                } else {
                    cfg.cluster_urls.clone()
                };
                if let Ok(client) = redis::cluster::ClusterClient::new(urls) {
                    if let Ok(mut conn) = client.get_async_connection().await {
                        use redis::AsyncCommands;
                        let pattern = format!("{}:*", key_prefix);
                        if let Ok(keys) = conn.keys::<_, Vec<String>>(pattern).await {
                            for key in keys {
                                let _: Result<(), _> = conn.del::<_, ()>(key).await;
                            }
                        }
                    }
                }
            }
            _ => {
                if let Ok(client) = redis::Client::open(cfg.url.as_str()) {
                    if let Ok(mut conn) = client.get_multiplexed_tokio_connection().await {
                        use redis::AsyncCommands;
                        let pattern = format!("{}:*", key_prefix);
                        if let Ok(keys) = conn.keys::<_, Vec<String>>(pattern).await {
                            for key in keys {
                                let _: Result<(), _> = conn.del::<_, ()>(key).await;
                            }
                        }
                    }
                }
            }
        }
    }

    #[tokio::test]
    async fn test_job_idempotency_without_phase2() {
        // 测试：没有 Phase2 时的行为（应该直接返回 job_id，无幂等保护）
        let manager = JobIdempotencyManager::new();
        
        let job_key = make_job_key(
            None,
            "session-1",
            1,
            JobType::Translation,
            "en",
            None,
        );
        
        let job_id = "job-1".to_string();
        let result = manager.get_or_create_job_id(&job_key, job_id.clone()).await;
        
        // 没有 Phase2 时，应该直接返回传入的 job_id
        assert_eq!(result, job_id);
        
        // 获取不存在的 job_key 应该返回 None
        let non_existent_key = make_job_key(
            None,
            "session-2",
            1,
            JobType::Translation,
            "en",
            None,
        );
        let result = manager.get_job_id(&non_existent_key).await;
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_job_idempotency_with_phase2() {
        let redis_cfg = test_redis_config();
        if !can_connect_redis(&redis_cfg).await {
            eprintln!("skip: redis not available");
            return;
        }

        // 创建 RedisRuntime
        let mut cfg = RedisRuntimeConfig::default();
        cfg.enabled = true;
        cfg.instance_id = format!("test-idempotency-{}", uuid::Uuid::new_v4());
        cfg.redis = redis_cfg;
        
        let scheduler_cfg = crate::core::config::SchedulerConfig::default();
        let rt = RedisRuntime::new(cfg.clone(), 5, &scheduler_cfg).await.unwrap().unwrap();
        let rt = Arc::new(rt);
        
        // 清理测试键
        cleanup_test_keys(&rt).await;

        // 创建 JobIdempotencyManager 并设置 Phase2
        let mut manager = JobIdempotencyManager::new();
        manager.set_redis_runtime(Some(rt.clone()));

        let job_key = make_job_key(
            None,
            "session-test",
            1,
            JobType::Translation,
            "en",
            None,
        );

        // 测试：第一次创建应该返回新的 job_id
        let job_id_1 = "job-test-1".to_string();
        let result_1 = manager.get_or_create_job_id(&job_key, job_id_1.clone()).await;
        assert_eq!(result_1, job_id_1);

        // 测试：第二次使用相同的 job_key 应该返回已存在的 job_id
        let job_id_2 = "job-test-2".to_string();
        let result_2 = manager.get_or_create_job_id(&job_key, job_id_2.clone()).await;
        assert_eq!(result_2, job_id_1); // 应该返回第一次创建的 job_id

        // 测试：get_job_id 应该能获取到已存在的 job_id
        let result_3 = manager.get_job_id(&job_key).await;
        assert_eq!(result_3, Some(job_id_1));

        // 测试：不同的 job_key 应该返回不同的 job_id
        let job_key_2 = make_job_key(
            None,
            "session-test",
            2, // 不同的 utterance_index
            JobType::Translation,
            "en",
            None,
        );
        let job_id_3 = "job-test-3".to_string();
        let result_4 = manager.get_or_create_job_id(&job_key_2, job_id_3.clone()).await;
        assert_eq!(result_4, job_id_3); // 应该返回新的 job_id

        // 清理测试键
        cleanup_test_keys(&rt).await;
    }

    #[tokio::test]
    async fn test_job_idempotency_ttl_expiration() {
        let redis_cfg = test_redis_config();
        if !can_connect_redis(&redis_cfg).await {
            eprintln!("skip: redis not available");
            return;
        }

        // 创建 RedisRuntime
        let mut cfg = RedisRuntimeConfig::default();
        cfg.enabled = true;
        cfg.instance_id = format!("test-ttl-{}", uuid::Uuid::new_v4());
        cfg.redis = redis_cfg;
        
        let scheduler_cfg = crate::core::config::SchedulerConfig::default();
        let rt = RedisRuntime::new(cfg.clone(), 5, &scheduler_cfg).await.unwrap().unwrap();
        let rt = Arc::new(rt);
        
        // 清理测试键
        cleanup_test_keys(&rt).await;

        // 创建 JobIdempotencyManager 并设置 Phase2
        let mut manager = JobIdempotencyManager::new();
        manager.set_redis_runtime(Some(rt.clone()));

        let job_key = make_job_key(
            None,
            "session-ttl",
            1,
            JobType::Translation,
            "en",
            None,
        );

        // 创建 job_id
        let job_id = "job-ttl-1".to_string();
        let result = manager.get_or_create_job_id(&job_key, job_id.clone()).await;
        assert_eq!(result, job_id);

        // 验证可以获取到
        let result = manager.get_job_id(&job_key).await;
        assert_eq!(result, Some(job_id.clone()));

        // 注意：TTL 测试需要等待 Redis 键过期，这里只测试基本功能
        // 实际的 TTL 由 Phase2 的 request_binding 管理（默认 5 分钟）

        // 清理测试键
        cleanup_test_keys(&rt).await;
    }

    #[test]
    fn test_make_job_key() {
        // 测试 job_key 生成的一致性
        let key1 = make_job_key(
            None,
            "session-1",
            1,
            JobType::Translation,
            "en",
            None,
        );
        let key2 = make_job_key(
            None,
            "session-1",
            1,
            JobType::Translation,
            "en",
            None,
        );
        assert_eq!(key1, key2);

        // 测试不同的参数生成不同的 key
        let key3 = make_job_key(
            None,
            "session-2", // 不同的 session_id
            1,
            JobType::Translation,
            "en",
            None,
        );
        assert_ne!(key1, key3);

        let key4 = make_job_key(
            None,
            "session-1",
            2, // 不同的 utterance_index
            JobType::Translation,
            "en",
            None,
        );
        assert_ne!(key1, key4);
    }
}
