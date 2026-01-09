# 测试故障排查指南

## 问题：测试卡住/超时

如果测试命令（如 `cargo test`）卡住或超时，可能的原因和解决方案：

### 1. 检查是否是编译问题

```bash
# 只编译，不运行测试
cargo build --lib

# 如果编译也卡住，可能是依赖下载问题
cargo clean
cargo build --lib
```

### 2. 检查是否有死锁

测试代码中可能存在死锁，特别是：
- 多个锁的获取顺序不一致
- 在持有锁的情况下等待另一个锁
- 异步操作中的阻塞

### 3. 运行单个测试

```bash
# 运行最简单的测试
cargo test --lib pool_language_index_test::tests::test_pool_language_index_new

# 运行同步测试（不涉及异步）
cargo test --lib pool_language_index_test::tests::test_pool_language_index_new -- --exact
```

### 4. 检查测试超时设置

某些测试可能因为等待时间过长而看起来卡住。已优化的测试：
- `session_runtime_test.rs` 中的 sleep 时间从 100ms 减少到 10ms
- 缓存 TTL 测试使用更短的超时时间

### 5. 使用超时运行测试

```bash
# 使用 timeout 命令（Linux/Mac）
timeout 30 cargo test --lib

# Windows PowerShell
# 设置测试超时（需要在测试代码中实现）
```

### 6. 检查依赖问题

某些测试可能需要外部依赖（如 Redis），如果连接不上可能导致超时：

```bash
# 检查 Redis 是否可用
redis-cli ping

# 如果 Redis 不可用，某些测试会被跳过
```

### 7. 简化测试

如果测试持续卡住，可以：
1. 注释掉可能有问题的测试
2. 逐步取消注释，找出问题测试
3. 检查该测试中的异步操作

### 8. 使用 cargo test 的选项

```bash
# 只运行特定测试模块
cargo test --lib pool_language_index_test

# 显示测试输出
cargo test --lib -- --nocapture

# 单线程运行（避免并发问题）
cargo test --lib -- --test-threads=1
```

## 已修复的问题

1. ✅ `session_runtime_test.rs` 中的 sleep 时间优化
2. ✅ 缓存 TTL 测试使用更短的超时时间
3. ✅ 所有测试都使用 `#[tokio::test]` 确保正确的异步运行时

## 建议

如果测试仍然卡住：
1. 检查系统资源（CPU、内存）
2. 检查是否有其他进程占用资源
3. 尝试重启终端/IDE
4. 检查 Rust 工具链版本：`rustc --version`
5. 更新依赖：`cargo update`
