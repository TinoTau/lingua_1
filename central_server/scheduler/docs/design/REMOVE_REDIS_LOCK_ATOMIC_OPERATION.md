# 移除 Redis 锁，改用原子化操作

## 问题

用户担心代码中的 Redis 锁会造成死锁，要求使用 Redis 原子化操作来避免锁。

## 解决方案

### 之前：使用 Redis 锁（SETNX + TTL）

```rust
// 1. 获取锁
let lock_result = acquire_cross_instance_request_lock(...).await;
let lock_owner = match lock_result {
    LockAcquireResult::Success(owner) => owner,
    LockAcquireResult::Timeout => return None,
};

// 2. 锁内操作
- 复查 binding
- Redis reserve 节点槽位
- 写入 request_binding

// 3. 释放锁
release_request_lock(...).await;
```

**问题**：
- ❌ 需要显式获取和释放锁
- ❌ 如果实例崩溃，锁可能不会及时释放（虽然有 TTL，但仍有风险）
- ❌ 锁获取失败需要重试，增加复杂度

---

### 现在：使用 Redis 原子操作（SETNX）

```rust
// 原子操作：尝试创建 request_binding（SETNX）
let binding_created = rt.try_set_request_binding_atomic(
    request_id,
    &job_id,
    assigned_node_id.as_deref(),
    lease_seconds,
    false,
).await;

if !binding_created {
    // binding 已存在，读取并返回已存在的 Job
    if let Some(b) = rt.get_request_binding(request_id).await {
        // 返回已存在的 Job
    }
} else {
    // binding 创建成功，我们是第一个，继续创建 Job
    // ...
}
```

**优点**：
- ✅ **完全避免死锁**：使用原子操作，不需要显式锁
- ✅ **自动过期**：SETNX + EX 自动设置 TTL，即使实例崩溃也会自动过期
- ✅ **简单高效**：一次原子操作，无需获取/释放锁
- ✅ **幂等性保证**：SETNX 保证同一 request_id 只创建一个 binding

---

## 实现细节

### 1. 新增原子操作方法

**文件**: `phase2/runtime_routing_request_binding.rs`

```rust
/// 跨实例模式：原子性地尝试创建 request_id 绑定（使用 SETNX，避免死锁）
/// 返回 true 表示成功创建（我们是第一个），false 表示已存在（其他实例已创建）
pub async fn try_set_request_binding_atomic(
    &self,
    request_id: &str,
    job_id: &str,
    node_id: Option<&str>,
    lease_seconds: u64,
    dispatched_to_node: bool,
) -> bool {
    // 使用 SETNX + EX 原子操作
    // SET key val NX EX ttl
    // 如果 key 不存在则创建，如果已存在则返回 false
    self.redis.set_nx_ex_string(&key, &json, ttl_seconds).await.unwrap_or(false)
}
```

### 2. 新增 Redis 原子操作方法

**文件**: `phase2/redis_handle.rs`

```rust
/// 原子操作：SET key val NX EX ttl（字符串值）
/// 如果 key 不存在则创建，如果已存在则返回 false（避免死锁）
pub async fn set_nx_ex_string(&self, key: &str, val: &str, ttl_seconds: u64) -> redis::RedisResult<bool> {
    let mut cmd = redis::cmd("SET");
    cmd.arg(key)
        .arg(val)
        .arg("NX")  // 只在不存在时设置
        .arg("EX")  // 设置过期时间（秒）
        .arg(ttl_seconds.max(1));
    let r: Option<String> = self.query(cmd).await?;
    Ok(r.is_some())  // Some("OK") => true, None => false
}
```

### 3. 更新任务创建流程

**文件**: `job_creation_cross_instance.rs`

**之前**：
```rust
// 获取锁
let lock_result = acquire_cross_instance_request_lock(...).await;
// 锁内操作
// 释放锁
release_request_lock(...).await;
```

**现在**：
```rust
// 原子操作：尝试创建 binding
let binding_created = rt.try_set_request_binding_atomic(...).await;

if !binding_created {
    // 已存在，读取并返回
    if let Some(b) = rt.get_request_binding(request_id).await {
        return Some(job);
    }
} else {
    // 创建成功，继续创建 Job
    // ...
}
```

---

## 优势对比

| 特性 | Redis 锁 | 原子操作（SETNX） |
|------|----------|-------------------|
| **死锁风险** | 有风险（需要显式释放） | ✅ 无风险（自动过期） |
| **复杂度** | 需要获取/释放锁 | ✅ 一次原子操作 |
| **性能** | 需要重试机制 | ✅ 直接返回结果 |
| **幂等性** | ✅ 保证 | ✅ 保证 |
| **崩溃恢复** | 依赖 TTL | ✅ 自动过期 |

---

## 流程对比

### 之前（使用锁）

```
实例A: 获取锁 → 检查 binding → 创建 Job → 写入 binding → 释放锁
实例B: 等待锁 → 获取锁 → 检查 binding → 返回已存在的 Job → 释放锁
```

**问题**：
- 实例B 需要等待锁
- 如果实例A 崩溃，锁需要等待 TTL 过期

### 现在（原子操作）

```
实例A: 原子创建 binding（成功） → 创建 Job → 完成
实例B: 原子创建 binding（失败，已存在） → 读取 binding → 返回已存在的 Job
```

**优点**：
- 实例B 不需要等待，直接知道结果
- 如果实例A 崩溃，binding 会自动过期
- 更简单、更高效

---

## 代码变更

### 删除的代码
- `acquire_cross_instance_request_lock()` 调用
- `release_request_lock()` 调用
- 锁获取失败的重试逻辑

### 新增的代码
- `try_set_request_binding_atomic()` - 原子化创建 binding
- `set_nx_ex_string()` - Redis 原子操作（SETNX + EX）

### 保留的代码
- `set_request_binding()` - 用于更新已存在的 binding（如 mark_dispatched）

---

## 测试更新

需要更新测试：
- 移除锁相关的测试
- 添加原子操作测试
- 测试并发场景（多个实例同时创建同一个 request_id）

---

## 总结

通过使用 Redis SETNX 原子操作，我们：
- ✅ **完全避免了死锁风险**
- ✅ **简化了代码逻辑**
- ✅ **提高了性能**（无需等待锁）
- ✅ **保持了幂等性**（同一 request_id 只创建一个 Job）

**这是更优雅、更安全的解决方案！**

---

**文档版本**: v1.0  
**最后更新**: 2024-12-19
