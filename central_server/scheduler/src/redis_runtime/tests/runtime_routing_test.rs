// 测试：Phase2Runtime 节点能力 Redis 存储和读取
// 注意：此文件通过 include! 包含在 phase2.rs 的 mod tests 块中
// common.rs 中的函数（test_redis_config, can_connect_redis）和类型在同一个命名空间中可用
// 注意：由于所有测试文件共享同一个命名空间，避免重复导入已在 common.rs 中导入的类型

/// 清理测试 Redis 键（节点能力专用）
async fn cleanup_test_keys(rt: &Phase2Runtime) {
    let key_prefix = rt.key_prefix();
    let redis_url = std::env::var("LINGUA_TEST_REDIS_URL")
        .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
    if let Ok(client) = redis::Client::open(redis_url.as_str()) {
        if let Ok(mut conn) = client.get_connection() {
            use redis::Commands;
            let pattern = format!("{}:*", key_prefix);
            if let Ok(keys) = conn.keys::<_, Vec<String>>(pattern) {
                for key in keys {
                    let _: Result<(), _> = conn.del::<_, ()>(key);
                }
            }
        }
    }
}

/// 测试：同步节点能力到 Redis
#[tokio::test]
async fn test_sync_node_capabilities_to_redis() {
    let redis_cfg = test_redis_config();
    if !can_connect_redis(&redis_cfg).await {
        eprintln!("skip: redis not available");
        return;
    }

    let mut cfg = RedisRuntimeConfig::default();
    cfg.enabled = true;
    cfg.instance_id = "test-capabilities".to_string();
    cfg.redis = redis_cfg;

    let scheduler_cfg = crate::core::config::SchedulerConfig::default();
    let rt = Phase2Runtime::new(cfg.clone(), 5, &scheduler_cfg).await.unwrap().unwrap();
    let rt = std::sync::Arc::new(rt);

    let node_id = "node-test-capabilities";
    let capabilities = vec![
        CapabilityByType {
            r#type: ServiceType::Asr,
            ready: true,
            reason: None,
            ready_impl_ids: Some(vec!["asr-impl".to_string()]),
        },
        CapabilityByType {
            r#type: ServiceType::Nmt,
            ready: true,
            reason: None,
            ready_impl_ids: Some(vec!["nmt-impl".to_string()]),
        },
        CapabilityByType {
            r#type: ServiceType::Tts,
            ready: false,
            reason: Some("not_installed".to_string()),
            ready_impl_ids: None,
        },
    ];

    // 同步到 Redis
    rt.sync_node_capabilities_to_redis(node_id, &capabilities).await;

    // 从 Redis 读取并验证
    let has_asr = rt.has_node_capability(node_id, &ServiceType::Asr).await;
    let has_nmt = rt.has_node_capability(node_id, &ServiceType::Nmt).await;
    let has_tts = rt.has_node_capability(node_id, &ServiceType::Tts).await;

    assert!(has_asr, "ASR 能力应该为 true");
    assert!(has_nmt, "NMT 能力应该为 true");
    assert!(!has_tts, "TTS 能力应该为 false");

    // 清理
    cleanup_test_keys(&rt).await;
}

/// 测试：从 Redis 读取节点能力
#[tokio::test]
async fn test_get_node_capabilities_from_redis() {
    let redis_cfg = test_redis_config();
    if !can_connect_redis(&redis_cfg).await {
        eprintln!("skip: redis not available");
        return;
    }

    let mut cfg = RedisRuntimeConfig::default();
    cfg.enabled = true;
    cfg.instance_id = "test-capabilities-read".to_string();
    cfg.redis = redis_cfg;

    let scheduler_cfg = crate::core::config::SchedulerConfig::default();
    let rt = Phase2Runtime::new(cfg.clone(), 5, &scheduler_cfg).await.unwrap().unwrap();
    let rt = std::sync::Arc::new(rt);

    let node_id = "node-test-read";
    let capabilities = vec![
        CapabilityByType {
            r#type: ServiceType::Asr,
            ready: true,
            reason: None,
            ready_impl_ids: Some(vec!["asr-impl".to_string()]),
        },
        CapabilityByType {
            r#type: ServiceType::Semantic,
            ready: true,
            reason: None,
            ready_impl_ids: Some(vec!["semantic-impl".to_string()]),
        },
    ];

    // 同步到 Redis
    rt.sync_node_capabilities_to_redis(node_id, &capabilities).await;

    // 从 Redis 读取完整的能力映射
    let capabilities_map = rt.get_node_capabilities_from_redis(node_id).await;
    assert!(capabilities_map.is_some(), "应该能够从 Redis 读取节点能力");

    let capabilities_map = capabilities_map.unwrap();
    assert_eq!(
        capabilities_map.get(&ServiceType::Asr),
        Some(&true),
        "ASR 能力应该为 true"
    );
    assert_eq!(
        capabilities_map.get(&ServiceType::Semantic),
        Some(&true),
        "Semantic 能力应该为 true"
    );
    assert_eq!(
        capabilities_map.get(&ServiceType::Nmt),
        None,
        "NMT 能力不应该存在"
    );

    // 清理
    cleanup_test_keys(&rt).await;
}
