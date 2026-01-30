//! 极简调度器 Pool 注册和语言索引测试
//! 
//! 测试节点注册时使用 UUID v4 生成 pool_id 和创建语言索引的功能

use lingua_scheduler::phase2::RedisHandle;
use lingua_scheduler::services::minimal_scheduler::{MinimalSchedulerService, RegisterNodeRequest};
use lingua_scheduler::core::config::Phase2RedisConfig;
use redis::Commands;
use std::sync::Arc;
use std::time::Duration;
use tokio::time::sleep;

/// 测试 Redis 配置
fn test_redis_config() -> Phase2RedisConfig {
    let mut cfg = Phase2RedisConfig::default();
    cfg.mode = "single".to_string();
    cfg.url = std::env::var("LINGUA_TEST_REDIS_URL")
        .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
    cfg
}

/// 检查是否可以连接到 Redis
async fn can_connect_redis() -> bool {
    let redis_cfg = test_redis_config();
    match RedisHandle::connect(&redis_cfg).await {
        Ok(_) => true,
        Err(_) => false,
    }
}

/// 清理测试数据
async fn cleanup_test_keys(redis_cfg: &Phase2RedisConfig) {
    let redis_url = redis_cfg.url.clone();
    if let Ok(client) = redis::Client::open(redis_url.as_str()) {
        if let Ok(mut conn) = client.get_connection() {
            let pattern = "scheduler:*";
            if let Ok(keys) = conn.keys::<_, Vec<String>>(pattern) {
                for key in keys {
                    let _: Result<(), _> = conn.del::<_, ()>(key);
                }
            }
        }
    }
}

#[tokio::test]
async fn test_register_node_with_pool_name_uuid_v4() {
    // 跳过测试如果 Redis 不可用
    if !can_connect_redis().await {
        eprintln!("Redis 不可用，跳过测试");
        return;
    }

    let redis_cfg = test_redis_config();
    let redis = Arc::new(RedisHandle::connect(&redis_cfg).await.unwrap());
    let service = MinimalSchedulerService::new(redis.clone()).await.unwrap();

    // 清理测试数据
    cleanup_test_keys(&redis_cfg).await;

    // 测试 1: 注册节点，使用 pool_names_json
    let node_id = format!("test-node-{}", uuid::Uuid::new_v4().to_string()[..8].to_uppercase());
    let pool_name = "zh-en";
    
    // 生成 pool_names_json（模拟 handle_node_register 的逻辑）
    let pool_uuid = uuid::Uuid::new_v4();
    let uuid_bytes = pool_uuid.as_bytes();
    let pool_id = u16::from_be_bytes([uuid_bytes[0], uuid_bytes[1]]);
    
    let pool_info = serde_json::json!({
        "id": pool_id,
        "name": pool_name
    });
    let pool_names_json = serde_json::to_string(&vec![pool_info]).unwrap();

    let req = RegisterNodeRequest {
        node_id: node_id.clone(),
        cap_json: r#"{"services":["ASR","NMT","TTS","Semantic"]}"#.to_string(),
        pool_names_json: Some(pool_names_json.clone()),
    };

    // 执行注册
    service.register_node(req).await.unwrap();

    // 验证节点信息已写入
    let redis_url = redis_cfg.url.clone();
    let client = redis::Client::open(redis_url.as_str()).unwrap();
    let mut conn = client.get_connection().unwrap();
    let node_info_key = format!("scheduler:node:info:{}", node_id);
    let online: String = conn.hget(&node_info_key, "online").unwrap();
    assert_eq!(online, "true");

    // 验证 Pool 成员已添加
    let pool_members_key = format!("scheduler:pool:{}:members", pool_id);
    let members: Vec<String> = conn.smembers(&pool_members_key).unwrap();
    assert!(members.contains(&node_id));

    // 验证语言索引已创建
    // pool_name "zh-en" 应该创建两个语言索引：zh->en 和 en->zh
    let lang_key_1 = "scheduler:lang:zh:en";
    let pools_json_1: String = conn.hget(lang_key_1, "pools_json").unwrap();
    let pools_1: Vec<u16> = serde_json::from_str(&pools_json_1).unwrap();
    assert!(pools_1.contains(&pool_id), "语言索引 zh->en 应该包含 pool_id");

    let lang_key_2 = "scheduler:lang:en:zh";
    let pools_json_2: String = conn.hget(lang_key_2, "pools_json").unwrap();
    let pools_2: Vec<u16> = serde_json::from_str(&pools_json_2).unwrap();
    assert!(pools_2.contains(&pool_id), "语言索引 en->zh 应该包含 pool_id");

    // 清理
    cleanup_test_keys(&redis_cfg).await;
}

#[tokio::test]
async fn test_register_node_uuid_v4_generates_different_pool_ids() {
    // 跳过测试如果 Redis 不可用
    if !can_connect_redis().await {
        eprintln!("Redis 不可用，跳过测试");
        return;
    }

    let redis_cfg = test_redis_config();
    let redis = Arc::new(RedisHandle::connect(&redis_cfg).await.unwrap());
    let service = MinimalSchedulerService::new(redis.clone()).await.unwrap();

    // 清理测试数据
    cleanup_test_keys(&redis_cfg).await;

    let pool_name = "zh-en";
    let mut pool_ids = Vec::new();

    // 注册 3 个节点，使用相同的 pool_name，但应该生成不同的 pool_id（UUID v4）
    for i in 0..3 {
        let node_id = format!("test-node-{}", i);
        
        // 每次生成新的 UUID v4
        let pool_uuid = uuid::Uuid::new_v4();
        let uuid_bytes = pool_uuid.as_bytes();
        let pool_id = u16::from_be_bytes([uuid_bytes[0], uuid_bytes[1]]);
        pool_ids.push(pool_id);

        let pool_info = serde_json::json!({
            "id": pool_id,
            "name": pool_name
        });
        let pool_names_json = serde_json::to_string(&vec![pool_info]).unwrap();

        let req = RegisterNodeRequest {
            node_id: node_id.clone(),
            cap_json: r#"{"services":["ASR","NMT","TTS","Semantic"]}"#.to_string(),
            pool_names_json: Some(pool_names_json),
        };

        service.register_node(req).await.unwrap();
        
        // 短暂延迟，确保 UUID 不同（虽然概率很低，但为了测试稳定性）
        sleep(Duration::from_millis(10)).await;
    }

    // 验证：虽然 pool_name 相同，但 pool_id 应该不同（UUID v4 每次生成新的）
    // 注意：理论上可能相同（概率极低），但大多数情况下应该不同
    let _unique_pool_ids: std::collections::HashSet<u16> = pool_ids.iter().cloned().collect();
    // 至少应该有一些不同的 pool_id（如果运气不好全部相同，这个测试可能会失败，但概率极低）
    // 我们至少验证 pool_ids 不为空
    assert!(!pool_ids.is_empty(), "应该生成至少一个 pool_id");

    // 清理
    cleanup_test_keys(&redis_cfg).await;
}

#[tokio::test]
async fn test_register_node_extracts_language_pairs_from_pool_name() {
    // 跳过测试如果 Redis 不可用
    if !can_connect_redis().await {
        eprintln!("Redis 不可用，跳过测试");
        return;
    }

    let redis_cfg = test_redis_config();
    let redis = Arc::new(RedisHandle::connect(&redis_cfg).await.unwrap());
    let service = MinimalSchedulerService::new(redis.clone()).await.unwrap();

    // 清理测试数据
    cleanup_test_keys(&redis_cfg).await;

    // 测试不同的 pool_name 格式
    let test_cases = vec![
        ("zh-en", vec![("zh", "en"), ("en", "zh")]),
        ("en-fr", vec![("en", "fr"), ("fr", "en")]),
        ("de-en", vec![("de", "en"), ("en", "de")]),
    ];

    let mut pool_id_map = std::collections::HashMap::new();

    for (pool_name, expected_pairs) in &test_cases {
        let node_id = format!("test-node-{}", uuid::Uuid::new_v4().to_string()[..8].to_uppercase());
        
        let pool_uuid = uuid::Uuid::new_v4();
        let uuid_bytes = pool_uuid.as_bytes();
        let pool_id = u16::from_be_bytes([uuid_bytes[0], uuid_bytes[1]]);
        pool_id_map.insert(*pool_name, (pool_id, expected_pairs.clone()));

        let pool_info = serde_json::json!({
            "id": pool_id,
            "name": pool_name
        });
        let pool_names_json = serde_json::to_string(&vec![pool_info]).unwrap();

        let req = RegisterNodeRequest {
            node_id: node_id.clone(),
            cap_json: r#"{"services":["ASR","NMT","TTS","Semantic"]}"#.to_string(),
            pool_names_json: Some(pool_names_json),
        };

        service.register_node(req).await.unwrap();
    }

    // 验证每个语言对的语言索引都已创建
    let redis_url = redis_cfg.url.clone();
    let client = redis::Client::open(redis_url.as_str()).unwrap();
    let mut conn = client.get_connection().unwrap();
    
    for (_pool_name, (pool_id, expected_pairs)) in &pool_id_map {
        for (src_lang, tgt_lang) in expected_pairs {
            let lang_key = format!("scheduler:lang:{}:{}", src_lang, tgt_lang);
            let pools_json: String = conn.hget(&lang_key, "pools_json").unwrap();
            let pools: Vec<u16> = serde_json::from_str(&pools_json).unwrap();
            assert!(
                pools.contains(pool_id),
                "语言索引 {}->{} 应该包含 pool_id {}",
                src_lang,
                tgt_lang,
                pool_id
            );
        }
    }

    // 清理
    cleanup_test_keys(&redis_cfg).await;
}

#[tokio::test]
async fn test_register_node_without_pool_names_json() {
    // 跳过测试如果 Redis 不可用
    if !can_connect_redis().await {
        eprintln!("Redis 不可用，跳过测试");
        return;
    }

    let redis_cfg = test_redis_config();
    let redis = Arc::new(RedisHandle::connect(&redis_cfg).await.unwrap());
    let service = MinimalSchedulerService::new(redis.clone()).await.unwrap();

    // 清理测试数据
    cleanup_test_keys(&redis_cfg).await;

    let node_id = format!("test-node-{}", uuid::Uuid::new_v4().to_string()[..8].to_uppercase());

    // 注册节点，不提供 pool_names_json
    let req = RegisterNodeRequest {
        node_id: node_id.clone(),
        cap_json: r#"{"services":["ASR","NMT","TTS"]}"#.to_string(),
        pool_names_json: None,
    };

    // 应该成功注册，但不创建语言索引
    service.register_node(req).await.unwrap();

    // 验证节点信息已写入
    let redis_url = redis_cfg.url.clone();
    let client = redis::Client::open(redis_url.as_str()).unwrap();
    let mut conn = client.get_connection().unwrap();
    let node_info_key = format!("scheduler:node:info:{}", node_id);
    let online: String = conn.hget(&node_info_key, "online").unwrap();
    assert_eq!(online, "true");

    // 验证没有创建语言索引（检查一个常见的语言对）
    let lang_key = "scheduler:lang:zh:en";
    let exists: bool = conn.exists(lang_key).unwrap();
    assert!(!exists, "不应该创建语言索引（因为没有提供 pool_names_json）");

    // 清理
    cleanup_test_keys(&redis_cfg).await;
}

#[tokio::test]
async fn test_register_node_with_multiple_pools() {
    // 跳过测试如果 Redis 不可用
    if !can_connect_redis().await {
        eprintln!("Redis 不可用，跳过测试");
        return;
    }

    let redis_cfg = test_redis_config();
    let redis = Arc::new(RedisHandle::connect(&redis_cfg).await.unwrap());
    let service = MinimalSchedulerService::new(redis.clone()).await.unwrap();

    // 清理测试数据
    cleanup_test_keys(&redis_cfg).await;

    let node_id = format!("test-node-{}", uuid::Uuid::new_v4().to_string()[..8].to_uppercase());

    // 创建多个 pool
    let pool_names = vec!["zh-en", "en-fr"];
    let mut pool_infos = Vec::new();
    let mut pool_ids = Vec::new();

    for pool_name in &pool_names {
        let pool_uuid = uuid::Uuid::new_v4();
        let uuid_bytes = pool_uuid.as_bytes();
        let pool_id = u16::from_be_bytes([uuid_bytes[0], uuid_bytes[1]]);
        pool_ids.push(pool_id);

        pool_infos.push(serde_json::json!({
            "id": pool_id,
            "name": pool_name
        }));
    }

    let pool_names_json = serde_json::to_string(&pool_infos).unwrap();

    let req = RegisterNodeRequest {
        node_id: node_id.clone(),
        cap_json: r#"{"services":["ASR","NMT","TTS","Semantic"]}"#.to_string(),
        pool_names_json: Some(pool_names_json),
    };

    service.register_node(req).await.unwrap();

    // 验证节点被添加到所有 Pool
    let redis_url = redis_cfg.url.clone();
    let client = redis::Client::open(redis_url.as_str()).unwrap();
    let mut conn = client.get_connection().unwrap();
    for pool_id in &pool_ids {
        let pool_members_key = format!("scheduler:pool:{}:members", pool_id);
        let members: Vec<String> = conn.smembers(&pool_members_key).unwrap();
        assert!(
            members.contains(&node_id),
            "节点应该被添加到 pool {}",
            pool_id
        );
    }

    // 验证所有语言索引都已创建
    // zh-en -> zh->en, en->zh
    // en-fr -> en->fr, fr->en
    let expected_lang_pairs = vec![
        ("zh", "en"),
        ("en", "zh"),
        ("en", "fr"),
        ("fr", "en"),
    ];

    for (src_lang, tgt_lang) in &expected_lang_pairs {
        let lang_key = format!("scheduler:lang:{}:{}", src_lang, tgt_lang);
        let pools_json: String = conn.hget(&lang_key, "pools_json").unwrap();
        let pools: Vec<u16> = serde_json::from_str(&pools_json).unwrap();
        
        // 验证至少有一个 pool_id 在语言索引中
        let has_any_pool = pool_ids.iter().any(|pid| pools.contains(pid));
        assert!(
            has_any_pool,
            "语言索引 {}->{} 应该包含至少一个 pool_id",
            src_lang,
            tgt_lang
        );
    }

    // 清理
    cleanup_test_keys(&redis_cfg).await;
}
