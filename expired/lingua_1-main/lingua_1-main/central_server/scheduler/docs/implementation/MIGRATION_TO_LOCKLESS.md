# 迁移到极简无锁调度服务

## 文档信息

- **版本**: v1.0
- **日期**: 2026-01-11
- **状态**: ✅ 核心方法已标记为废弃，待完整迁移
- **参考规范**: `LOCKLESS_MINIMAL_SCHEDULER_SPEC_v1.md`

---

## 一、已废弃的旧方法

### 1.1 节点管理（Node Management）

#### ✅ 已标记为废弃

| 旧方法 | 位置 | 状态 | 替代方法 |
|--------|------|------|----------|
| `handle_node_register` | `src/websocket/node_handler/message/register.rs` | ✅ 已废弃 | `MinimalSchedulerService::register_node` |
| `handle_node_heartbeat` | `src/websocket/node_handler/message/register.rs` | ✅ 已废弃 | `MinimalSchedulerService::heartbeat` |
| `register_node_with_policy` | `src/node_registry/core.rs` | ✅ 已废弃 | `MinimalSchedulerService::register_node` |
| `update_node_heartbeat` | `src/node_registry/core.rs` | ✅ 已废弃 | `MinimalSchedulerService::heartbeat` |

**废弃原因**:
- ❌ 使用 `RwLock<ManagementState>` 和 `Mutex`，存在锁竞争
- ❌ 维护本地全局状态（节点表、能力索引等）
- ❌ 代码复杂，难以排查问题
- ❌ 不符合 LOCKLESS_MINIMAL_SCHEDULER_SPEC_v1.md 规范

---

### 1.2 任务管理（Task Management）

#### ✅ 已标记为废弃

| 旧方法 | 位置 | 状态 | 替代方法 |
|--------|------|------|----------|
| `create_job` | `src/core/dispatcher/job_creation.rs` | ✅ 已废弃 | `MinimalSchedulerService::dispatch_task` |
| `create_job_with_phase2_lock` | `src/core/dispatcher/job_creation.rs` | ✅ 已废弃 | `MinimalSchedulerService::dispatch_task` |
| `create_job_phase1` | `src/core/dispatcher/job_creation.rs` | ✅ 已废弃 | `MinimalSchedulerService::dispatch_task` |

**废弃原因**:
- ❌ 使用 `Mutex<JobTable>` 和 `Mutex<SessionState>`
- ❌ 维护本地任务表和会话状态
- ❌ 涉及复杂的节点选择和锁竞争
- ❌ 不符合 LOCKLESS_MINIMAL_SCHEDULER_SPEC_v1.md 规范

---

## 二、新极简无锁调度服务

### 2.1 核心服务

**位置**: `src/services/minimal_scheduler.rs`

**核心方法**:
1. `register_node()` - 节点注册（Lua 脚本原子操作）
2. `heartbeat()` - 节点心跳（Lua 脚本原子操作）
3. `dispatch_task()` - 任务调度（Lua 脚本原子操作）
4. `complete_task()` - 任务完成（Lua 脚本原子操作）

**特点**:
- ✅ 完全无锁（无 Rust 层面的 Mutex/RwLock）
- ✅ 所有状态在 Redis（Redis 为唯一真相源）
- ✅ 所有并发控制通过 Redis Lua 脚本（原子操作）
- ✅ 代码简洁，逻辑清晰

---

## 三、迁移指南

### 3.1 节点注册迁移

#### 旧实现（已废弃）

```rust
// ❌ 旧实现：使用 register_node_with_policy（涉及锁和本地状态）
match state
    .node_registry
    .register_node_with_policy(
        provided_node_id,
        format!("Node-{}", uuid::Uuid::new_v4().to_string()[..8].to_uppercase()),
        version,
        platform,
        hardware,
        installed_models,
        installed_services,
        features_supported,
        accept_public_jobs,
        capability_by_type.clone(),
        state.phase2.is_some(),
        language_capabilities,
        state.phase2.as_ref().map(|rt| rt.as_ref()),
    )
    .await
{
    Ok(node) => {
        // 注册成功
    }
    Err(err) => {
        // 注册失败
    }
}
```

#### 新实现（极简无锁）

```rust
// ✅ 新实现：使用 MinimalSchedulerService::register_node（完全无锁）
use crate::services::minimal_scheduler::{MinimalSchedulerService, RegisterNodeRequest};

let scheduler = state.minimal_scheduler.as_ref()
    .ok_or_else(|| anyhow::anyhow!("MinimalSchedulerService not initialized"))?;

// 将节点能力序列化为 JSON
let cap_json = serde_json::to_string(&capability_by_type)?;

// 可选：计算 pools_json（从语言能力计算）
let pools_json = None; // 或从 language_capabilities 计算

let req = RegisterNodeRequest {
    node_id: provided_node_id.unwrap_or_else(|| {
        format!("node-{}", uuid::Uuid::new_v4().to_string()[..8].to_uppercase())
    }),
    cap_json,
    max_jobs: 4, // 或从配置计算
    pools_json,
};

scheduler.register_node(req).await?;
```

---

### 3.2 节点心跳迁移

#### 旧实现（已废弃）

```rust
// ❌ 旧实现：使用 update_node_heartbeat（涉及锁和本地状态）
state
    .node_registry
    .update_node_heartbeat(
        node_id,
        resource_usage.cpu_percent,
        resource_usage.gpu_percent,
        resource_usage.mem_percent,
        installed_models,
        installed_services,
        resource_usage.running_jobs,
        Some(capability_by_type.clone()),
        processing_metrics.clone(),
        language_capabilities,
    )
    .await;
```

#### 新实现（极简无锁）

```rust
// ✅ 新实现：使用 MinimalSchedulerService::heartbeat（完全无锁）
use crate::services::minimal_scheduler::{MinimalSchedulerService, HeartbeatRequest};

if let Some(scheduler) = state.minimal_scheduler.as_ref() {
    // 将负载信息序列化为 JSON
    let load_json = serde_json::json!({
        "cpu": resource_usage.cpu_percent,
        "gpu": resource_usage.gpu_percent,
        "mem": resource_usage.mem_percent,
        "running_jobs": resource_usage.running_jobs,
    }).to_string();

    let req = HeartbeatRequest {
        node_id: node_id.to_string(),
        online: true,
        load_json: Some(load_json),
    };

    let _ = scheduler.heartbeat(req).await;
}
```

---

### 3.3 任务调度迁移

#### 旧实现（已废弃）

```rust
// ❌ 旧实现：使用 create_job（涉及锁和本地状态）
let job = self.create_job(
    session_id,
    utterance_index,
    src_lang,
    tgt_lang,
    dialect,
    features,
    pipeline,
    audio_data,
    audio_format,
    sample_rate,
    preferred_node_id,
    mode,
    lang_a,
    lang_b,
    auto_langs,
    enable_streaming_asr,
    partial_update_interval_ms,
    trace_id,
    tenant_id,
    request_id,
    target_session_ids,
    first_chunk_client_timestamp_ms,
    padding_ms,
    is_manual_cut,
    is_pause_triggered,
    is_timeout_triggered,
).await;
```

#### 新实现（极简无锁）

```rust
// ✅ 新实现：使用 MinimalSchedulerService::dispatch_task（完全无锁）
use crate::services::minimal_scheduler::{MinimalSchedulerService, DispatchRequest, DispatchResponse};

let scheduler = state.minimal_scheduler.as_ref()
    .ok_or_else(|| anyhow::anyhow!("MinimalSchedulerService not initialized"))?;

// 将任务负载序列化为 JSON
let payload_json = serde_json::json!({
    "audio_data": base64::encode(&audio_data),
    "audio_format": audio_format,
    "sample_rate": sample_rate,
    "src_lang": src_lang,
    "tgt_lang": tgt_lang,
    // ... 其他字段
}).to_string();

let req = DispatchRequest {
    session_id: session_id.clone(),
    src_lang,
    tgt_lang,
    payload_json,
};

let response: DispatchResponse = scheduler.dispatch_task(req).await?;
// response.node_id, response.job_id
```

---

### 3.4 任务完成迁移

#### 旧实现（已废弃）

```rust
// ❌ 旧实现：可能需要手动释放节点并发槽、更新任务状态等
// （涉及多个锁操作和本地状态更新）
```

#### 新实现（极简无锁）

```rust
// ✅ 新实现：使用 MinimalSchedulerService::complete_task（完全无锁）
use crate::services::minimal_scheduler::{MinimalSchedulerService, CompleteTaskRequest};

let scheduler = state.minimal_scheduler.as_ref()
    .ok_or_else(|| anyhow::anyhow!("MinimalSchedulerService not initialized"))?;

let req = CompleteTaskRequest {
    job_id: job_id.to_string(),
    node_id: node_id.to_string(),
    status: "finished".to_string(), // 或 "failed"
};

scheduler.complete_task(req).await?;
```

---

## 四、迁移检查清单

### 4.1 节点管理

- [ ] 将 `handle_node_register` 迁移到 `MinimalSchedulerService::register_node`
- [ ] 将 `handle_node_heartbeat` 迁移到 `MinimalSchedulerService::heartbeat`
- [ ] 移除对 `register_node_with_policy` 的调用
- [ ] 移除对 `update_node_heartbeat` 的调用
- [ ] 移除本地节点状态管理代码

### 4.2 任务管理

- [ ] 将 `create_job` 迁移到 `MinimalSchedulerService::dispatch_task`
- [ ] 移除对 `create_job_with_phase2_lock` 的调用
- [ ] 移除对 `create_job_phase1` 的调用
- [ ] 移除本地任务表和会话状态管理代码

### 4.3 测试

- [ ] 单元测试：测试每个新方法的正确性
- [ ] 集成测试：测试完整流程（注册 → 心跳 → 调度 → 完成）
- [ ] 性能测试：验证无锁实现的性能优势

---

## 五、注意事项

### 5.1 数据迁移

- ⚠️ **现有 Redis 数据**：新实现使用不同的 Redis key 结构，可能需要数据迁移
- ⚠️ **会话状态**：如果使用会话状态，需要迁移到 Redis
- ⚠️ **任务历史**：旧任务历史可能需要保留（如果不再使用，可以清理）

### 5.2 兼容性

- ✅ **无兼容性要求**：项目未上线，无需考虑向后兼容
- ✅ **可以完全替换**：可以完全移除旧代码，使用新实现

### 5.3 性能

- ✅ **预期性能提升**：无锁实现应该比有锁实现性能更好
- ✅ **Redis 瓶颈**：实际性能取决于 Redis 性能
- ✅ **监控**：需要监控 Redis QPS 和 Lua 脚本执行时间

---

## 六、参考文档

- **规范文档**: `docs/architecture/LOCKLESS_MINIMAL_SCHEDULER_SPEC_v1.md`
- **集成指南**: `docs/implementation/MINIMAL_SCHEDULER_INTEGRATION.md`
- **实施状态**: `docs/implementation/MINIMAL_SCHEDULER_IMPLEMENTATION_STATUS.md`

---

**文档版本**: v1.0  
**最后更新**: 2026-01-11  
**状态**: ✅ 核心方法已标记为废弃，待完整迁移
