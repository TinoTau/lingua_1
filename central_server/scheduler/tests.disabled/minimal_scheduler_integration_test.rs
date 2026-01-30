//! 极简调度器集成测试
//! 
//! 测试实际运行中的调度服务器，包括之前遇到的错误场景

use lingua_scheduler::services::minimal_scheduler::{
    CompleteTaskRequest, DispatchRequest, MinimalSchedulerService, RegisterNodeRequest,
};
use lingua_scheduler::phase2::RedisHandle;
use lingua_scheduler::core::config::Phase2RedisConfig;
use redis::Commands;
use std::sync::Arc;

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

/// 测试：之前遇到的 NO_POOL_FOR_LANG_PAIR 错误
/// 场景：语言索引不存在时，任务调度应该失败并返回明确的错误信息
#[tokio::test]
async fn test_dispatch_task_without_lang_index_error() {
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

    let redis_url = redis_cfg.url.clone();
    let client = redis::Client::open(redis_url.as_str()).unwrap();
    let mut conn = client.get_connection().unwrap();
    use redis::Commands;

    // 1. 注册节点（但不创建语言索引）
    let node_id = "test-node-no-lang-index";
    let pool_uuid = uuid::Uuid::new_v4();
    let uuid_bytes = pool_uuid.as_bytes();
    let pool_id = u16::from_be_bytes([uuid_bytes[0], uuid_bytes[1]]);

    let register_req = RegisterNodeRequest {
        node_id: node_id.to_string(),
        cap_json: r#"{"services":["ASR","NMT"]}"#.to_string(),
        pool_names_json: None, // 不创建语言索引
    };
    service.register_node(register_req).await.unwrap();

    // 2. 确保 Pool 存在
    let pool_key = format!("scheduler:pool:{}:members", pool_id);
    conn.sadd::<_, _, ()>(&pool_key, node_id).unwrap();
    conn.expire::<_, ()>(&pool_key, 3600).unwrap();

    // 3. 初始化 job 序列号
    conn.set::<_, _, ()>("scheduler:job:id_seq", "0").unwrap();

    // 4. 尝试调度任务（应该失败，因为语言索引不存在）
    let dispatch_req = DispatchRequest {
        session_id: "test-session-no-lang-index".to_string(),
        src_lang: "zh".to_string(),
        tgt_lang: "en".to_string(),
        payload_json: r#"{"audio":"base64data"}"#.to_string(),
        lang_a: None,
        lang_b: None,
    };

    let result = service.dispatch_task(dispatch_req).await;
    assert!(
        result.is_err(),
        "任务调度应该失败（语言索引不存在）: {:?}",
        result
    );

    // 验证错误信息包含 NO_POOL_FOR_LANG_PAIR
    let error_msg = result.unwrap_err().to_string();
    assert!(
        error_msg.contains("NO_POOL_FOR_LANG_PAIR") || error_msg.contains("语言索引"),
        "错误信息应该包含 NO_POOL_FOR_LANG_PAIR 或相关提示: {}",
        error_msg
    );

    // 清理
    cleanup_test_keys(&redis_cfg).await;
}

/// 测试：完整流程（注册 → 创建语言索引 → 调度 → 完成）
/// 这是正常流程，确保之前修复的问题不会再次出现
#[tokio::test]
async fn test_full_workflow_with_pool_names() {
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

    let redis_url = redis_cfg.url.clone();
    let client = redis::Client::open(redis_url.as_str()).unwrap();
    let mut conn = client.get_connection().unwrap();
    use redis::Commands;

    let node_id = "test-node-full-workflow";
    let session_id = "test-session-full-workflow";
    let pool_name = "zh-en";

    // 1. 注册节点（使用 pool_names_json，自动创建语言索引）
    let pool_uuid = uuid::Uuid::new_v4();
    let uuid_bytes = pool_uuid.as_bytes();
    let pool_id = u16::from_be_bytes([uuid_bytes[0], uuid_bytes[1]]);

    let pool_info = serde_json::json!({
        "id": pool_id,
        "name": pool_name
    });
    let pool_names_json = serde_json::to_string(&vec![pool_info]).unwrap();

    let register_req = RegisterNodeRequest {
        node_id: node_id.to_string(),
        cap_json: r#"{"services":["ASR","NMT","TTS","Semantic"]}"#.to_string(),
        pool_names_json: Some(pool_names_json),
    };
    service.register_node(register_req).await.unwrap();

    // 验证语言索引已创建
    let lang_key = "scheduler:lang:zh:en";
    let pools_json: String = conn.hget(lang_key, "pools_json").unwrap();
    let pools: Vec<u16> = serde_json::from_str(&pools_json).unwrap();
    assert!(
        pools.contains(&pool_id),
        "语言索引 zh->en 应该包含 pool_id {}",
        pool_id
    );

    // 2. 初始化 job 序列号
    conn.set::<_, _, ()>("scheduler:job:id_seq", "0").unwrap();

    // 3. 调度任务（应该成功，因为语言索引已创建）
    let dispatch_req = DispatchRequest {
        session_id: session_id.to_string(),
        src_lang: "zh".to_string(),
        tgt_lang: "en".to_string(),
        payload_json: r#"{"audio":"base64data","tenant_id":null,"trace_id":"test-trace-id"}"#.to_string(),
        lang_a: None,
        lang_b: None,
    };

    let dispatch_result = service.dispatch_task(dispatch_req).await;
    assert!(
        dispatch_result.is_ok(),
        "任务调度应该成功（语言索引已创建）: {:?}",
        dispatch_result
    );

    let response = dispatch_result.unwrap();
    assert_eq!(response.node_id, node_id, "应该调度到正确的节点");
    assert!(!response.job_id.is_empty(), "job_id 不应该为空");

    // 4. 验证 Redis 中的数据
    let job_key = format!("scheduler:job:{}", response.job_id);
    let job_node_id: Option<String> = conn.hget(&job_key, "node_id").unwrap();
    assert_eq!(
        job_node_id,
        Some(node_id.to_string()),
        "job 应该属于正确的节点"
    );

    // 注意：current_jobs 已移除，不再检查

    // 5. 完成任务
    let complete_req = CompleteTaskRequest {
        job_id: response.job_id.clone(),
        node_id: node_id.to_string(),
        status: "finished".to_string(),
    };

    let complete_result = service.complete_task(complete_req).await;
    assert!(
        complete_result.is_ok(),
        "任务完成应该成功: {:?}",
        complete_result
    );

    // 验证最终状态
    let job_status: Option<String> = conn.hget(&job_key, "status").unwrap();
    assert_eq!(
        job_status,
        Some("finished".to_string()),
        "job 状态应该是 finished"
    );

    // 注意：current_jobs 已移除，不再检查

    // 清理
    cleanup_test_keys(&redis_cfg).await;
}

/// 测试：Lua 脚本错误处理
/// 场景：验证错误信息是否正确传递
#[tokio::test]
async fn test_lua_script_error_handling() {
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

    // 测试：使用无效的节点 ID 完成任务（应该失败）
    let complete_req = CompleteTaskRequest {
        job_id: "nonexistent-job".to_string(),
        node_id: "nonexistent-node".to_string(),
        status: "finished".to_string(),
    };

    let result = service.complete_task(complete_req).await;
    assert!(
        result.is_err(),
        "完成任务应该失败（job 不存在）: {:?}",
        result
    );

    // 验证错误信息包含有用的信息
    let error_msg = result.unwrap_err().to_string();
    assert!(
        error_msg.contains("job") || error_msg.contains("不存在") || error_msg.contains("NOT_FOUND"),
        "错误信息应该包含有用的提示: {}",
        error_msg
    );

    // 清理
    cleanup_test_keys(&redis_cfg).await;
}

/// 测试：多个节点注册并调度任务
/// 场景：验证多个节点时任务调度的正确性
#[tokio::test]
async fn test_multiple_nodes_dispatch() {
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

    let redis_url = redis_cfg.url.clone();
    let client = redis::Client::open(redis_url.as_str()).unwrap();
    let mut conn = client.get_connection().unwrap();
    use redis::Commands;

    let pool_name = "zh-en";
    let mut node_ids = Vec::new();
    let mut pool_id = 0;

    // 1. 注册 3 个节点（每个节点生成不同的 pool_id，但使用相同的 pool_name）
    for i in 0..3 {
        let node_id = format!("test-node-multi-{}", i);
        node_ids.push(node_id.clone());

        // 每次生成新的 UUID v4
        let pool_uuid = uuid::Uuid::new_v4();
        let uuid_bytes = pool_uuid.as_bytes();
        pool_id = u16::from_be_bytes([uuid_bytes[0], uuid_bytes[1]]);

        let pool_info = serde_json::json!({
            "id": pool_id,
            "name": pool_name
        });
        let pool_names_json = serde_json::to_string(&vec![pool_info]).unwrap();

        let register_req = RegisterNodeRequest {
            node_id: node_id.clone(),
            cap_json: r#"{"services":["ASR","NMT","TTS","Semantic"]}"#.to_string(),
            pool_names_json: Some(pool_names_json),
        };

        service.register_node(register_req).await.unwrap();
    }

    // 2. 验证语言索引包含所有 pool_id（实际上每个节点都创建了语言索引，但 pool_id 不同）
    // 这里我们只验证语言索引存在即可
    let lang_key = "scheduler:lang:zh:en";
    let pools_json: String = conn.hget(lang_key, "pools_json").unwrap();
    let pools: Vec<u16> = serde_json::from_str(&pools_json).unwrap();
    assert!(!pools.is_empty(), "语言索引应该包含至少一个 pool_id");

    // 3. 初始化 job 序列号
    conn.set::<_, _, ()>("scheduler:job:id_seq", "0").unwrap();

    // 4. 调度任务（应该成功，语言索引存在）
    let dispatch_req = DispatchRequest {
        session_id: "test-session-multi".to_string(),
        src_lang: "zh".to_string(),
        tgt_lang: "en".to_string(),
        payload_json: r#"{"audio":"base64data"}"#.to_string(),
        lang_a: None,
        lang_b: None,
    };

    let dispatch_result = service.dispatch_task(dispatch_req).await;
    assert!(
        dispatch_result.is_ok(),
        "任务调度应该成功: {:?}",
        dispatch_result
    );

    let response = dispatch_result.unwrap();
    assert!(
        node_ids.contains(&response.node_id),
        "应该调度到已注册的节点之一"
    );

    // 清理
    cleanup_test_keys(&redis_cfg).await;
}

/// 测试：节点并发槽已满时的任务调度
/// 场景：验证当节点 current_jobs >= max_jobs 时，应该选择其他节点或返回错误
#[tokio::test]
async fn test_dispatch_when_node_full() {
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

    let redis_url = redis_cfg.url.clone();
    let client = redis::Client::open(redis_url.as_str()).unwrap();
    let mut conn = client.get_connection().unwrap();
    use redis::Commands;

    let node_id = "test-node-full";
    let pool_name = "zh-en";
    let pool_uuid = uuid::Uuid::new_v4();
    let uuid_bytes = pool_uuid.as_bytes();
    let pool_id = u16::from_be_bytes([uuid_bytes[0], uuid_bytes[1]]);

    // 1. 注册节点
    let pool_info = serde_json::json!({
        "id": pool_id,
        "name": pool_name
    });
    let pool_names_json = serde_json::to_string(&vec![pool_info]).unwrap();

    let register_req = RegisterNodeRequest {
        node_id: node_id.to_string(),
        cap_json: r#"{"services":["ASR","NMT"]}"#.to_string(),
        pool_names_json: Some(pool_names_json),
    };
    service.register_node(register_req).await.unwrap();

    // 注意：current_jobs 已移除，不再设置并发槽
    // 节点任务管理由节点端 GPU 仲裁器负责

    // 3. 初始化 job 序列号
    conn.set::<_, _, ()>("scheduler:job:id_seq", "0").unwrap();

    // 4. 尝试调度任务（应该成功，因为不再检查节点并发槽）
    // 注意：节点任务管理由节点端 GPU 仲裁器负责，调度服务器不再检查并发槽
    let dispatch_req = DispatchRequest {
        session_id: "test-session-full".to_string(),
        src_lang: "zh".to_string(),
        tgt_lang: "en".to_string(),
        payload_json: r#"{"audio":"base64data"}"#.to_string(),
        lang_a: None,
        lang_b: None,
    };

    let dispatch_result = service.dispatch_task(dispatch_req).await;
    // 应该成功，因为不再检查节点并发槽
    assert!(
        dispatch_result.is_ok(),
        "任务调度应该成功（不再检查并发槽）: {:?}",
        dispatch_result
    );

    // 清理
    cleanup_test_keys(&redis_cfg).await;
}
