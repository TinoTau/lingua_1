# 测试超时问题修复

## 问题描述

在运行单元测试时，多个测试会卡住，特别是需要 Redis 连接的测试。原因是：

1. `Phase2Runtime::new` 中的 `RedisHandle::connect` 没有超时机制
2. `ensure_group` 调用 Redis 时也没有超时保护
3. 测试在 Redis 不可用时会无限等待

## 修复方案

### 1. 添加快速 Redis 连接检查

在 `phase3_pool_redis_test.rs` 中添加了 `can_connect_redis_quick()` 函数：

```rust
/// 快速检查 Redis 是否可用（带超时）
async fn can_connect_redis_quick() -> bool {
    let redis_url = std::env::var("LINGUA_TEST_REDIS_URL")
        .unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
    
    match tokio::time::timeout(Duration::from_secs(1), async {
        if let Ok(client) = redis::Client::open(redis_url.as_str()) {
            if let Ok(mut conn) = client.get_multiplexed_tokio_connection().await {
                let pong: redis::RedisResult<String> = redis::cmd("PING").query_async(&mut conn).await;
                pong.is_ok()
            } else {
                false
            }
        } else {
            false
        }
    }).await {
        Ok(result) => result,
        Err(_) => false, // 超时
    }
}
```

### 2. 在创建 Phase2Runtime 前先检查 Redis

修改了 `create_test_phase2_runtime` 函数：

```rust
async fn create_test_phase2_runtime(instance_id: &str) -> Option<Arc<Phase2Runtime>> {
    // 先快速检查 Redis 是否可用
    if !can_connect_redis_quick().await {
        return None;
    }
    
    // ... 其余代码 ...
    
    // 将 Phase2Runtime::new 的超时从 5 秒减少到 2 秒
    match tokio::time::timeout(Duration::from_secs(2), Phase2Runtime::new(cfg, 15)).await {
        // ...
    }
}
```

### 3. 测试行为

- 如果 Redis 不可用，测试会在 1 秒内快速跳过（返回 None）
- 如果 Redis 可用但 `Phase2Runtime::new` 失败，会在 2 秒内超时
- 所有需要 Redis 的测试都会在开始时检查 Redis 可用性

## 受影响的测试文件

- `phase3_pool_redis_test.rs` - 已修复
- `phase3_pool_heartbeat_test.rs` - 需要类似修复
- `auto_language_pool_test.rs` - 部分测试需要 Redis
- `phase3_pool_registration_test.rs` - 部分测试需要 Redis

## 下一步

1. 对其他需要 Redis 的测试文件应用相同的修复
2. 考虑在 `RedisHandle::connect` 中添加超时机制（需要修改核心代码）
3. 考虑在 `ensure_group` 中添加超时保护

## 测试建议

运行测试时，如果 Redis 不可用，测试会快速跳过而不是卡住：

```bash
# 单个测试
cargo test --lib node_registry::phase3_pool_redis_test::tests::test_pool_config_fallback_to_local -- --exact

# 所有测试
cargo test --lib node_registry::phase3_pool_redis_test
```

如果 Redis 不可用，测试会输出 "跳过测试：Redis 不可用" 并快速返回。
