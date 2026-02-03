    use super::*;
    use crate::core::config::RedisRuntimeConfig;
    use crate::messages::{
        CapabilityByType, DeviceType, FeatureFlags, HardwareInfo, GpuInfo, InstalledModel, InstalledService,
        NodeStatus, ResourceUsage, ServiceStatus, ServiceType,
    };
    use base64::Engine as _;
    use futures_util::{SinkExt, StreamExt};

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

