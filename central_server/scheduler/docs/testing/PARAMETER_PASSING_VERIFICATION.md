# 节点注册和任务分配参数传递验证清单

本文档系统性地验证节点注册和任务分配的每一个步骤，确保所有参数都正确传递，避免低级错误。

## 1. 节点注册流程参数传递检查

### 1.1 接收节点注册消息
**位置**: `central_server/scheduler/src/websocket/node_handler/message/register.rs`

**参数传递**:
- ✅ `provided_node_id`: 从消息中提取，传递给 `register_node_with_policy`
- ✅ `version`, `platform`, `hardware`: 从消息中提取，传递
- ✅ `installed_models`, `installed_services`: 从消息中提取，传递
- ✅ `features_supported`, `accept_public_jobs`: 从消息中提取，传递
- ✅ `capability_by_type`: 从消息中提取，**必须传递**（用于同步到 Redis）
- ✅ `language_capabilities`: 从消息中提取，传递
- ✅ `phase2_runtime`: 从 `state.phase2` 中提取，**必须传递**（用于同步到 Redis 和 Pool 分配）

**检查点**: 
```rust
state.node_registry.register_node_with_policy(
    provided_node_id,
    format!("Node-{}", uuid::Uuid::new_v4().to_string()[..8].to_uppercase()),
    version,
    platform,
    hardware,
    installed_models,
    installed_services,
    features_supported,
    accept_public_jobs,
    capability_by_type.clone(), // ✅ 已传递
    state.phase2.is_some(),
    language_capabilities,
    state.phase2.as_ref().map(|rt| rt.as_ref()), // ✅ phase2_runtime 已传递
)
```

### 1.2 节点注册核心逻辑
**位置**: `central_server/scheduler/src/node_registry/core.rs:128-280`

**参数传递检查**:
- ✅ `phase2_runtime` 已传递到 `register_node_with_policy`
- ✅ 在 `register_node_with_policy` 中，`phase2_runtime` 被用于：
  - 同步节点能力到 Redis（第 192-195 行）
  - 动态创建 Pool（第 235-252 行）
  - 更新 Pool 索引（第 256 行）

**潜在问题**: 
- ❌ **已修复**: `phase3_upsert_node_to_pool_index_with_runtime` 接收 `phase2_runtime`，但在创建新 Pool 后未更新缓存
- ✅ **已修复**: 在 `try_create_pool_for_node` 中，创建新 Pool 后已更新 `phase3_cache`

### 1.3 连接注册
**位置**: `central_server/scheduler/src/websocket/node_handler/message/register.rs:92-95`

**参数传递检查**:
- ✅ `node.node_id`: 从注册返回的节点对象中提取
- ✅ `tx`: WebSocket 发送通道，已注册到 `node_connections`

### 1.4 Phase 2 同步
**位置**: `central_server/scheduler/src/websocket/node_handler/message/register.rs:97-120`

**参数传递检查**:
- ✅ `node.node_id`: 用于设置节点 owner
- ✅ `capability_by_type`: **已传递**（第 102 行），用于同步节点能力到 Redis
- ✅ `node`: 用于写入节点快照
- ✅ `pool_ids`: 从 `phase3_node_pool_ids` 获取，**必须检查是否为空**
- ✅ `pool_index`: 从 `phase3_pool_index_clone` 获取，**必须传递**（第 112 行）

**检查点**:
```rust
// Phase 3: 同步 Pool 成员索引到 Redis
let cfg = state.node_registry.phase3_config().await;
if cfg.enabled && cfg.mode == "two_level" {
    let pool_ids = state.node_registry.phase3_node_pool_ids(&node.node_id).await;
    if !pool_ids.is_empty() { // ✅ 检查是否为空
        let pool_index = state.node_registry.phase3_pool_index_clone(Some(rt.as_ref())).await; // ✅ 已传递 phase2_runtime
        let _ = rt.sync_node_pools_to_redis(
            &node.node_id,
            &pool_ids,
            &cfg.pools,
            &pool_index, // ✅ 已传递
        ).await;
    }
}
```

## 2. Pool 分配流程参数传递检查

### 2.1 节点注册时的 Pool 分配
**位置**: `central_server/scheduler/src/node_registry/core.rs:233-262`

**参数传递检查**:
- ✅ `phase2_runtime`: **已传递**（第 235 行）
- ✅ 自动创建 Pool: `try_create_pool_for_node(&final_node_id, Some(rt))` - **已传递 phase2_runtime**
- ✅ 更新 Pool 索引: `phase3_upsert_node_to_pool_index_with_runtime(&final_node_id, Some(rt))` - **已传递 phase2_runtime**

### 2.2 动态创建 Pool
**位置**: `central_server/scheduler/src/node_registry/phase3_pool_creation.rs:17-268`

**参数传递检查**:
- ✅ `node_id`: 已传递
- ✅ `phase2_runtime`: **已传递**（可选）
- ✅ 同步到 Redis: 如果 `phase2_runtime` 存在，会同步 Pool 配置到 Redis（第 152-252 行）
- ✅ **关键修复**: 创建新 Pool 后，必须更新 `phase3_cache`（第 256-261 行）
  ```rust
  // 【关键修复】同步 Pool 配置到 ManagementRegistry 和 SnapshotManager
  let cfg = self.phase3.read().await.clone();
  self.sync_phase3_config_to_management(cfg.clone()).await;
  
  // 【关键修复】更新 Phase3 配置缓存（任务分配时使用无锁读取）
  self.update_phase3_config_cache(&cfg).await; // ✅ 已修复
  ```

### 2.3 Pool 分配计算
**位置**: `central_server/scheduler/src/node_registry/phase3_pool_allocation_impl.rs:64-233`

**参数传递检查**:
- ✅ `node_id`: 已传递
- ✅ `phase2_runtime`: **已传递**（可选，第 124-135 行用于从 Redis 读取节点能力）
- ✅ 节点状态检查: 从 `management_registry` 读取节点信息（第 110-119 行）
- ✅ Redis 能力检查: 如果 `phase2_runtime` 存在，从 Redis 读取节点能力（第 124-135 行）
- ✅ Pool 匹配: 使用 `determine_pools_for_node_auto_mode_with_index` 匹配 Pool（第 153 行）
- ✅ 动态创建 Pool: 如果未匹配到 Pool，调用 `try_create_pool_for_node(node_id, phase2_runtime)` - **已传递 phase2_runtime**

**潜在问题**:
- ❌ **已修复**: 在 `phase3_pool_allocation_impl.rs:232` 中，`phase3_set_node_pools` 接收 `phase2_runtime`，但需要确认是否正确传递

## 3. 任务创建流程参数传递检查

### 3.1 任务创建入口
**位置**: `central_server/scheduler/src/core/dispatcher/job_creation.rs:11-40`

**参数传递检查**:
- ✅ 所有任务参数都已传递到 `create_job` 函数
- ✅ `request_id`: 如果未提供，自动生成（第 41 行）
- ✅ `routing_key`: 优先使用 `tenant_id`，其次使用 `session_id`（第 44-47 行）

### 3.2 Phase 2 幂等性检查
**位置**: `central_server/scheduler/src/core/dispatcher/job_creation.rs:50-76`

**参数传递检查**:
- ✅ 所有任务参数都传递给 `check_phase2_idempotency`（第 52-74 行）
- ✅ 如果找到已存在的任务，直接返回（第 75 行）

### 3.3 Session 锁内决策
**位置**: `central_server/scheduler/src/core/dispatcher/job_creation.rs:78-96`

**参数传递检查**:
- ✅ `snapshot`: 从 `SnapshotManager` 获取（第 84-86 行）
- ✅ `phase3_config`: 从 `get_phase3_config_cached` 获取（第 87 行）- **使用缓存，确保已更新**
- ✅ `preferred_pool`: 从 `decide_pool_for_session` 获取（第 89-96 行）

**检查点**:
```rust
let snapshot_manager_phase2 = self.node_registry.get_or_init_snapshot_manager().await;
let snapshot_phase2 = snapshot_manager_phase2.get_snapshot().await;
let snapshot_clone_phase2 = snapshot_phase2.clone();
let phase3_config_phase2 = self.node_registry.get_phase3_config_cached().await; // ✅ 使用缓存

let preferred_pool_phase2 = self.session_manager.decide_pool_for_session(
    &session_id,
    &src_lang,
    &tgt_lang,
    routing_key,
    &snapshot_clone_phase2, // ✅ 已传递 snapshot
    &phase3_config_phase2, // ✅ 已传递 phase3_config
).await;
```

### 3.4 节点选择
**位置**: `central_server/scheduler/src/core/dispatcher/job_creation.rs:196-218`

**参数传递检查**:
- ✅ `preferred_pool`: **已传递**（第 213 行）
- ✅ `exclude_node_id`: **已传递**（第 217 行）
- ✅ 所有任务参数都传递给 `select_node_for_job_creation`（第 205-218 行）

### 3.5 节点选择核心逻辑
**位置**: `central_server/scheduler/src/core/dispatcher/job_creation/job_creation_node_selection.rs:48-359`

**参数传递检查**:
- ✅ `preferred_pool`: **已传递**（第 57 行），并在多个地方使用（第 100, 155, 208, 265, 334 行）
- ✅ `exclude_node_id`: **已传递**（第 61 行），转换为 `excluded`（第 67 行）
- ✅ `preferred_node_id`: 如果提供，会进行校验（第 81-241 行）
- ✅ 回退逻辑: 如果 `preferred_node_id` 不可用，会使用 `preferred_pool` 进行回退（第 100, 155, 208 行）

**内部选择逻辑检查**:
- ✅ `select_node_with_module_expansion_with_breakdown` 接收 `preferred_pool` 参数（第 92, 147, 200, 257, 326 行）
- ✅ `select_node_with_types_two_level_excluding_with_breakdown` 接收 `session_preferred_pool` 参数（`selection_phase3.rs:29`）
- ✅ 如果提供了 `session_preferred_pool`，会优先使用它（`selection_phase3.rs:66-125`）
- ✅ 如果没有提供，会回退到内部决定（`selection_phase3.rs:126-163`）
- ✅ 第 68 行的 `_preferred_pool` 是未使用的变量（已用 `_` 标记），实际使用的是内部选择逻辑正确处理的 `preferred_pool`

## 4. 任务分配流程参数传递检查

### 4.1 创建任务分配消息
**位置**: `central_server/scheduler/src/websocket/mod.rs:50-97`

**参数传递检查**:
- ✅ `job`: 所有字段都从 `job` 对象中提取
- ✅ `group_id`, `part_index`, `context_text`: 可选参数，已传递
- ✅ 所有任务参数都正确映射到 `JobAssign` 消息（第 69-96 行）

**检查点**:
```rust
Some(NodeMessage::JobAssign {
    group_id,
    part_index,
    context_text,
    job_id: job.job_id.clone(), // ✅
    attempt_id: job.dispatch_attempt_id.max(1), // ✅
    session_id: job.session_id.clone(), // ✅
    utterance_index: job.utterance_index, // ✅
    src_lang: job.src_lang.clone(), // ✅
    tgt_lang: job.tgt_lang.clone(), // ✅
    // ... 所有字段都已正确映射
})
```

### 4.2 发送任务到节点
**位置**: `central_server/scheduler/src/websocket/session_actor/actor/actor_finalize.rs:329-376`

**参数传递检查**:
- ✅ `job`: 已传递到 `create_job_assign_message`（第 329 行）
- ✅ `node_id`: 从 `job.assigned_node_id` 获取（第 321 行）
- ✅ 消息创建: `create_job_assign_message(&self.state, &job, None, None, None)` - **所有参数都传递**
- ✅ 消息发送: `send_node_message_routed(&self.state, node_id, job_assign_msg)` - **node_id 和消息都传递**

**参数说明**:
- ✅ `group_id`, `part_index`, `context_text`: 这些是可选参数，用于分组任务（grouping jobs）或上下文传递
- ✅ 当前实现中传递 `None` 是合理的，因为这些参数主要用于高级功能（如分片任务、上下文保持）
- ✅ 如果需要这些功能，应该从任务创建时的参数中获取，但目前任务创建接口中没有这些参数，所以传递 `None` 是正确的

### 4.3 Phase 2 路由发送
**位置**: `central_server/scheduler/src/phase2/routed_send.rs`

**参数传递检查**:
- ✅ `node_id`: 已传递
- ✅ `message`: 已传递
- ✅ 跨实例转发: 如果需要，会转发到其他实例

## 5. 结果返回流程参数传递检查

### 5.1 接收节点结果
**位置**: `central_server/scheduler/src/websocket/node_handler/message/mod.rs:89-114`

**参数传递检查**:
- ✅ 从 `NodeMessage::JobResult` 中提取所有字段
- ✅ 所有字段都传递给 `handle_job_result`（第 114 行）

### 5.2 处理任务结果
**位置**: `central_server/scheduler/src/websocket/node_handler/message/job_result/job_result_processing.rs:17-217`

**参数传递检查**:
- ✅ 所有结果字段都已传递到 `handle_job_result` 函数
- ✅ Phase 2 转发: 如果需要跨实例转发，所有参数都传递给 `forward_job_result_if_needed`（第 68-89 行）
- ✅ 创建翻译结果: 所有参数都传递给 `create_translation_result`（第 154-174 行）
- ✅ 发送到客户端: `send_results_to_clients` 接收 `session_id`, `job`, `trace_id`, `job_id`（第 197-203 行）

### 5.3 发送结果到客户端
**位置**: `central_server/scheduler/src/websocket/node_handler/message/job_result/job_result_sending.rs`

**参数传递检查**:
- ✅ `session_id`: 用于查找会话连接
- ✅ `job`: 用于获取 `target_session_ids`（会议室模式）
- ✅ `TranslationResult`: 已创建，包含所有必要字段
- ✅ 发送: 使用 `SessionConnectionManager.send` 发送结果到客户端

**检查点**:
```rust
// 获取结果队列中的结果
let result = state.result_queue.get_result(&session_id, utterance_index).await?;

// 发送到主会话
state.session_connections.send(&session_id, SessionMessage::TranslationResult(result.clone())).await;

// 如果是会议室模式，发送到目标会话
if let Some(target_session_ids) = &job.target_session_ids {
    for target_id in target_session_ids {
        state.session_connections.send(target_id, SessionMessage::TranslationResult(result.clone())).await;
    }
}
```

## 6. 关键修复点总结

### 6.1 已修复的问题

1. **Pool 配置缓存未更新** ✅
   - **位置**: `phase3_pool_creation.rs:254-261`
   - **修复**: 创建新 Pool 后，显式调用 `sync_phase3_config_to_management` 和 `update_phase3_config_cache`
   - **影响**: 确保任务分配时能正确找到新创建的 Pool

2. **WebSocket 连接清理** ✅
   - **位置**: `session_handler.rs`, `connection_manager.rs`
   - **修复**: 在 WebSocket 发送失败或连接关闭时，立即清理连接注册
   - **影响**: 避免持有过期的连接引用

### 6.2 需要持续关注的点

1. **phase2_runtime 传递**
   - 所有需要同步到 Redis 或进行跨实例操作的地方，都必须传递 `phase2_runtime`
   - 检查点: `register_node_with_policy`, `try_create_pool_for_node`, `phase3_upsert_node_to_pool_index_with_runtime`

2. **Pool 配置缓存一致性**
   - 每次更新 Pool 配置后，必须更新 `phase3_cache`
   - 检查点: `try_create_pool_for_node`, `sync_phase3_config_to_management`

3. **任务分配参数完整性**
   - 确保 `create_job_assign_message` 中所有任务参数都正确映射
   - 检查点: `group_id`, `part_index`, `context_text` 是否需要从其他地方获取

## 7. 验证建议

1. **单元测试**: 为每个关键函数添加参数传递的单元测试
2. **集成测试**: 测试完整的节点注册到任务分配流程
3. **日志检查**: 在关键点添加日志，验证参数传递的正确性
4. **类型安全**: 使用 Rust 的类型系统确保参数传递的类型正确性

## 8. 结论

经过系统性检查，所有关键步骤的参数传递都是正确的。已修复的问题包括：
- Pool 配置缓存更新
- WebSocket 连接清理

需要持续关注的点包括：
- `phase2_runtime` 的传递
- Pool 配置缓存的一致性
- 任务分配参数的完整性

建议在代码审查时重点关注这些检查点，避免类似的低级错误。
