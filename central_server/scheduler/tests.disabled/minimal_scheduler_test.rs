//! 极简无锁调度服务单元测试
//! 
//! 根据 LOCKLESS_MINIMAL_SCHEDULER_SPEC_v1.md 实现
//! 测试 MinimalSchedulerService 的4个核心方法：
//! 1. register_node - 节点注册
//! 2. heartbeat - 节点心跳
//! 3. dispatch_task - 任务调度
//! 4. complete_task - 任务完成

use lingua_scheduler::services::minimal_scheduler::{
    CompleteTaskRequest, DispatchRequest, HeartbeatRequest,
    MinimalSchedulerService, RegisterNodeRequest,
};
use lingua_scheduler::phase2::RedisHandle;
use lingua_scheduler::core::config::Phase2RedisConfig;
use std::sync::Arc;
use redis::Commands;

/// 测试 Redis 配置
fn test_redis_config() -> Phase2RedisConfig {
    let mut cfg = Phase2RedisConfig::default();
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
async fn can_connect_redis(cfg: &Phase2RedisConfig) -> bool {
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
async fn cleanup_test_keys(redis_cfg: &Phase2RedisConfig) {
    use redis::Commands;
    let key_prefix = "scheduler";
    let redis_url = match redis_cfg.mode.as_str() {
        "cluster" => redis_cfg.cluster_urls.first().cloned()
            .unwrap_or_else(|| redis_cfg.url.clone()),
        _ => redis_cfg.url.clone(),
    };
    if let Ok(client) = redis::Client::open(redis_url.as_str()) {
        if let Ok(mut conn) = client.get_connection() {
            let pattern = format!("{}:*", key_prefix);
            if let Ok(keys) = conn.keys::<_, Vec<String>>(pattern) {
                for key in keys {
                    let _: Result<(), _> = conn.del::<_, ()>(key);
                }
            }
        }
    }
}

/// 测试：创建 MinimalSchedulerService
#[tokio::test]
async fn test_create_minimal_scheduler_service() {
    let redis_cfg = test_redis_config();
    if !can_connect_redis(&redis_cfg).await {
        eprintln!("skip: redis not available");
        return;
    }

    // 直接创建 RedisHandle（测试模式下为公开方法）
    let redis = Arc::new(RedisHandle::connect(&redis_cfg).await.unwrap());
    
    let service = MinimalSchedulerService::new(redis).await;
    assert!(service.is_ok(), "应该成功创建 MinimalSchedulerService");
}

/// 测试：节点注册
#[tokio::test]
async fn test_register_node() {
    let redis_cfg = test_redis_config();
    if !can_connect_redis(&redis_cfg).await {
        eprintln!("skip: redis not available");
        return;
    }

    // 直接创建 RedisHandle（测试模式下为公开方法）
    let redis = Arc::new(RedisHandle::connect(&redis_cfg).await.unwrap());
    let service = MinimalSchedulerService::new(redis.clone()).await.unwrap();

    // 清理测试数据
    cleanup_test_keys(&redis_cfg).await;

    let req = RegisterNodeRequest {
        node_id: "test-node-1".to_string(),
        cap_json: r#"{"services":["ASR","NMT"],"languages":["zh","en"]}"#.to_string(),
        pool_names_json: None,
    };

    // 注册节点
    let result = service.register_node(req).await;
    assert!(result.is_ok(), "节点注册应该成功: {:?}", result);

    // 验证 Redis 中的数据
    let node_info_key = "scheduler:node:info:test-node-1";
    let node_runtime_key = "scheduler:node:runtime:test-node-1";
    
    let redis_url = std::env::var("LINGUA_TEST_REDIS_URL")
        .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
    let client = redis::Client::open(redis_url.as_str()).unwrap();
    let mut conn = client.get_connection().unwrap();
    use redis::Commands;

    // 检查节点信息
    let online: Option<String> = conn.hget(node_info_key, "online").unwrap();
    assert_eq!(online, Some("true".to_string()), "节点应该在线");

    // 注意：max_jobs 和 current_jobs 已移除，不再检查

    // 清理
    cleanup_test_keys(&redis_cfg).await;
}

/// 测试：节点心跳
#[tokio::test]
async fn test_heartbeat() {
    let redis_cfg = test_redis_config();
    if !can_connect_redis(&redis_cfg).await {
        eprintln!("skip: redis not available");
        return;
    }

    // 直接创建 RedisHandle（测试模式下为公开方法）
    let redis = Arc::new(RedisHandle::connect(&redis_cfg).await.unwrap());
    let service = MinimalSchedulerService::new(redis.clone()).await.unwrap();

    // 清理测试数据
    cleanup_test_keys(&redis_cfg).await;

    // 先注册节点
    let register_req = RegisterNodeRequest {
        node_id: "test-node-heartbeat".to_string(),
        cap_json: r#"{"services":["ASR"]}"#.to_string(),
        pool_names_json: None,
    };
    service.register_node(register_req).await.unwrap();

    // 发送心跳
    let heartbeat_req = HeartbeatRequest {
        node_id: "test-node-heartbeat".to_string(),
        online: true,
        load_json: Some(r#"{"cpu":0.5,"gpu":0.3,"mem":0.4}"#.to_string()),
    };

    let result = service.heartbeat(heartbeat_req).await;
    assert!(result.is_ok(), "心跳应该成功: {:?}", result);

    // 验证 Redis 中的数据
    let node_info_key = "scheduler:node:info:test-node-heartbeat";
    
    let redis_url = std::env::var("LINGUA_TEST_REDIS_URL")
        .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
    let client = redis::Client::open(redis_url.as_str()).unwrap();
    let mut conn = client.get_connection().unwrap();
    use redis::Commands;

    let online: Option<String> = conn.hget(node_info_key, "online").unwrap();
    assert_eq!(online, Some("true".to_string()), "节点应该在线");

    // 清理
    cleanup_test_keys(&redis_cfg).await;
}

/// 测试：任务调度（需要先注册节点和设置语言索引）
#[tokio::test]
async fn test_dispatch_task() {
    let redis_cfg = test_redis_config();
    if !can_connect_redis(&redis_cfg).await {
        eprintln!("skip: redis not available");
        return;
    }

    // 直接创建 RedisHandle（测试模式下为公开方法）
    let redis = Arc::new(RedisHandle::connect(&redis_cfg).await.unwrap());
    let service = MinimalSchedulerService::new(redis.clone()).await.unwrap();

    // 清理测试数据
    cleanup_test_keys(&redis_cfg).await;

    // 设置 Redis 数据（模拟完整的调度流程）
    let redis_url = std::env::var("LINGUA_TEST_REDIS_URL")
        .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
    let client = redis::Client::open(redis_url.as_str()).unwrap();
    let mut conn = client.get_connection().unwrap();
    use redis::Commands;

    // 1. 注册节点
    let node_id = "test-node-dispatch";
    let register_req = RegisterNodeRequest {
        node_id: node_id.to_string(),
        cap_json: r#"{"services":["ASR","NMT"]}"#.to_string(),
        pool_names_json: None,
    };
    service.register_node(register_req).await.unwrap();

    // 2. 设置语言索引
    let lang_key = "scheduler:lang:zh:en";
    conn.hset::<_, _, _, ()>(lang_key, "pools_json", r#"[1]"#).unwrap();
    conn.expire::<_, ()>(lang_key, 3600).unwrap();

    // 3. 确保 Pool 存在
    let pool_key = "scheduler:pool:1:members";
    conn.sadd::<_, _, ()>(pool_key, node_id).unwrap();
    conn.expire::<_, ()>(pool_key, 3600).unwrap();

    // 4. 初始化 job 序列号
    conn.set::<_, _, ()>("scheduler:job:id_seq", "0").unwrap();

    // 5. 调度任务
    let dispatch_req = DispatchRequest {
        session_id: "test-session-1".to_string(),
        src_lang: "zh".to_string(),
        tgt_lang: "en".to_string(),
        payload_json: r#"{"audio":"base64data"}"#.to_string(),
        lang_a: None,
        lang_b: None,
    };

    let result = service.dispatch_task(dispatch_req).await;
    assert!(result.is_ok(), "任务调度应该成功: {:?}", result);

    let response = result.unwrap();
    assert_eq!(response.node_id, node_id, "应该调度到正确的节点");
    assert!(!response.job_id.is_empty(), "job_id 不应该为空");

    // 验证 Redis 中的数据
    let job_key = format!("scheduler:job:{}", response.job_id);
    let job_node_id: Option<String> = conn.hget(&job_key, "node_id").unwrap();
    assert_eq!(job_node_id, Some(node_id.to_string()), "job 应该属于正确的节点");

    // 注意：current_jobs 已移除，不再检查

    // 清理
    cleanup_test_keys(&redis_cfg).await;
}

/// 测试：任务完成
#[tokio::test]
async fn test_complete_task() {
    let redis_cfg = test_redis_config();
    if !can_connect_redis(&redis_cfg).await {
        eprintln!("skip: redis not available");
        return;
    }

    // 直接创建 RedisHandle（测试模式下为公开方法）
    let redis = Arc::new(RedisHandle::connect(&redis_cfg).await.unwrap());
    let service = MinimalSchedulerService::new(redis.clone()).await.unwrap();

    // 清理测试数据
    cleanup_test_keys(&redis_cfg).await;

    // 设置 Redis 数据
    let redis_url = std::env::var("LINGUA_TEST_REDIS_URL")
        .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
    let client = redis::Client::open(redis_url.as_str()).unwrap();
    let mut conn = client.get_connection().unwrap();
    use redis::Commands;

    // 1. 注册节点
    let node_id = "test-node-complete";
    let register_req = RegisterNodeRequest {
        node_id: node_id.to_string(),
        cap_json: r#"{"services":["ASR"]}"#.to_string(),
        pool_names_json: None,
    };
    service.register_node(register_req).await.unwrap();

    // 2. 创建 job 记录（模拟已调度的任务）
    let job_id = "test-session:1";
    let job_key = format!("scheduler:job:{}", job_id);
    conn.hset::<_, _, _, ()>(&job_key, "node_id", node_id).unwrap();
    conn.hset::<_, _, _, ()>(&job_key, "status", "created").unwrap();
    conn.expire::<_, ()>(&job_key, 3600).unwrap();

    // 注意：current_jobs 已移除，不再占用并发槽

    // 4. 完成任务
    let complete_req = CompleteTaskRequest {
        job_id: job_id.to_string(),
        node_id: node_id.to_string(),
        status: "finished".to_string(),
    };

    let result = service.complete_task(complete_req).await;
    assert!(result.is_ok(), "任务完成应该成功: {:?}", result);

    // 验证 Redis 中的数据
    let job_status: Option<String> = conn.hget(&job_key, "status").unwrap();
    assert_eq!(job_status, Some("finished".to_string()), "job 状态应该是 finished");

    // 注意：current_jobs 已移除，不再检查

    // 清理
    cleanup_test_keys(&redis_cfg).await;
}

/// 测试：任务完成时节点 ID 不匹配（应该失败）
#[tokio::test]
async fn test_complete_task_node_mismatch() {
    let redis_cfg = test_redis_config();
    if !can_connect_redis(&redis_cfg).await {
        eprintln!("skip: redis not available");
        return;
    }

    // 直接创建 RedisHandle（测试模式下为公开方法）
    let redis = Arc::new(RedisHandle::connect(&redis_cfg).await.unwrap());
    let service = MinimalSchedulerService::new(redis.clone()).await.unwrap();

    // 清理测试数据
    cleanup_test_keys(&redis_cfg).await;

    // 设置 Redis 数据
    let redis_url = std::env::var("LINGUA_TEST_REDIS_URL")
        .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
    let client = redis::Client::open(redis_url.as_str()).unwrap();
    let mut conn = client.get_connection().unwrap();
    use redis::Commands;

    // 1. 创建 job 记录（属于 node-1）
    let job_id = "test-session:2";
    let job_key = format!("scheduler:job:{}", job_id);
    conn.hset::<_, _, _, ()>(&job_key, "node_id", "node-1").unwrap();
    conn.hset::<_, _, _, ()>(&job_key, "status", "created").unwrap();
    conn.expire::<_, ()>(&job_key, 3600).unwrap();

    // 2. 尝试用错误的节点 ID 完成任务（应该失败）
    let complete_req = CompleteTaskRequest {
        job_id: job_id.to_string(),
        node_id: "node-2".to_string(), // 错误的节点 ID
        status: "finished".to_string(),
    };

    let result = service.complete_task(complete_req).await;
    assert!(result.is_err(), "任务完成应该失败（节点 ID 不匹配）: {:?}", result);

    // 清理
    cleanup_test_keys(&redis_cfg).await;
}

/// 测试：完整流程（注册 → 心跳 → 调度 → 完成）
#[tokio::test]
async fn test_full_workflow() {
    let redis_cfg = test_redis_config();
    if !can_connect_redis(&redis_cfg).await {
        eprintln!("skip: redis not available");
        return;
    }

    // 直接创建 RedisHandle（测试模式下为公开方法）
    let redis = Arc::new(RedisHandle::connect(&redis_cfg).await.unwrap());
    let service = MinimalSchedulerService::new(redis.clone()).await.unwrap();

    // 清理测试数据
    cleanup_test_keys(&redis_cfg).await;

    // 设置 Redis 数据
    let redis_url = std::env::var("LINGUA_TEST_REDIS_URL")
        .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
    let client = redis::Client::open(redis_url.as_str()).unwrap();
    let mut conn = client.get_connection().unwrap();
    use redis::Commands;

    let node_id = "test-node-full";
    let session_id = "test-session-full";

    // 1. 注册节点
    let register_req = RegisterNodeRequest {
        node_id: node_id.to_string(),
        cap_json: r#"{"services":["ASR","NMT"]}"#.to_string(),
        pool_names_json: None,
    };
    service.register_node(register_req).await.unwrap();

    // 2. 发送心跳
    let heartbeat_req = HeartbeatRequest {
        node_id: node_id.to_string(),
        online: true,
        load_json: Some(r#"{"cpu":0.3,"gpu":0.2}"#.to_string()),
    };
    service.heartbeat(heartbeat_req).await.unwrap();

    // 3. 设置语言索引和 Pool
    let lang_key = "scheduler:lang:zh:en";
    conn.hset::<_, _, _, ()>(lang_key, "pools_json", r#"[1]"#).unwrap();
    conn.expire::<_, ()>(lang_key, 3600).unwrap();

    let pool_key = "scheduler:pool:1:members";
    conn.sadd::<_, _, ()>(pool_key, node_id).unwrap();
    conn.expire::<_, ()>(pool_key, 3600).unwrap();

    conn.set::<_, _, ()>("scheduler:job:id_seq", "0").unwrap();

    // 4. 调度任务
    let dispatch_req = DispatchRequest {
        session_id: session_id.to_string(),
        src_lang: "zh".to_string(),
        tgt_lang: "en".to_string(),
        payload_json: r#"{"audio":"data"}"#.to_string(),
        lang_a: None,
        lang_b: None,
    };
    let dispatch_result = service.dispatch_task(dispatch_req).await.unwrap();
    let job_id = dispatch_result.job_id;

    // 5. 完成任务
    let complete_req = CompleteTaskRequest {
        job_id: job_id.clone(),
        node_id: node_id.to_string(),
        status: "finished".to_string(),
    };
    service.complete_task(complete_req).await.unwrap();

    // 注意：current_jobs 已移除，不再检查

    let job_key = format!("scheduler:job:{}", job_id);
    let job_status: Option<String> = conn.hget(&job_key, "status").unwrap();
    assert_eq!(job_status, Some("finished".to_string()), "job 状态应该是 finished");

    // 清理
    cleanup_test_keys(&redis_cfg).await;
}
