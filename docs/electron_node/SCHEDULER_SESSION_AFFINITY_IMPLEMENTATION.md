# 调度服务器Session Affinity实现总结

**日期**: 2026-01-16  
**状态**: ✅ **实现完成**

---

## 一、实现内容

### 1. 超时finalize时记录sessionId->nodeId映射

**实现位置**：`central_server/scheduler/src/websocket/session_actor/actor/actor_finalize.rs`

**核心逻辑**：
- 在`do_finalize`方法中，当`is_timeout_triggered = true`时
- 获取第一个job的`assigned_node_id`
- 使用Lua脚本原子性地将`timeout_node_id`写入Redis的`scheduler:session:{session_id}` hash
- 设置30分钟TTL（与节点端一致）

**代码片段**：
```rust
if is_timeout_triggered {
    if let Some(first_job) = jobs.first() {
        if let Some(ref node_id) = first_job.assigned_node_id {
            // 记录sessionId->nodeId映射到Redis
            if let Some(ref rt) = self.state.phase2 {
                let session_key = format!("scheduler:session:{}", self.session_id);
                let ttl_seconds = 30 * 60; // 30分钟TTL
                
                // 使用Lua脚本原子性地设置timeout_node_id
                let script = r#"
redis.call('HSET', KEYS[1], 'timeout_node_id', ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 1
"#;
                // ... 执行脚本
            }
        }
    }
}
```

### 2. 修改dispatch_task.lua优先选择timeout_node_id

**实现位置**：`central_server/scheduler/scripts/lua/dispatch_task.lua`

**核心逻辑**：
- **优先查找timeout映射**：在收到某个session的任务时，优先查找`timeout_node_id`映射
- **找不到再随机分配**：如果`timeout_node_id`不存在或节点不可用，回退到随机分配逻辑
- 在步骤1中读取`timeout_node_id`
- 在步骤3.1中，优先检查`timeout_node_id`指定的节点是否在线且在候选pools中
- 如果`timeout_node_id`节点可用，直接选择该节点（Session Affinity匹配成功）
- 在步骤3.2中，如果没有选择到节点，遍历所有pool找到第一个可用节点（随机分配）

**执行流程**：
```
收到session任务
    ↓
读取timeout_node_id（步骤1）
    ↓
timeout_node_id存在？
    ├─ 是 → 检查节点是否在线且在候选pools中（步骤3.1）
    │       ├─ 是 → 选择该节点（Session Affinity）
    │       └─ 否 → 继续步骤3.2
    └─ 否 → 继续步骤3.2
    ↓
遍历所有pool，找到第一个可用节点（步骤3.2，随机分配）
```

**代码片段**：
```lua
-- 1. 读取会话绑定的 preferred_pool 和 timeout_node_id（如果存在）
-- Session Affinity：优先查找timeout映射，确保超时finalize的长语音任务路由到同一节点
local session_key = "scheduler:session:" .. session_id
local preferred_pool = redis.call("HGET", session_key, "preferred_pool")
local timeout_node_id = redis.call("HGET", session_key, "timeout_node_id")

-- 3.1 优先查找timeout_node_id映射（Session Affinity）
if timeout_node_id and timeout_node_id ~= "" then
    local info_key = "scheduler:node:info:" .. timeout_node_id
    local online = redis.call("HGET", info_key, "online")
    
    if online == "true" then
        -- 检查该节点是否在候选 pools 中
        for pool_idx = 1, #pools do
            local pool_id = tostring(pools[pool_idx])
            local pool_key = "scheduler:pool:" .. pool_id .. ":members"
            local is_member = redis.call("SISMEMBER", pool_key, timeout_node_id)
            
            if is_member == 1 then
                -- 节点在 pool 中，选择该节点（Session Affinity匹配成功）
                chosen_node_id = timeout_node_id
                chosen_pool_id = pool_id
                break
            end
        end
    end
end

-- 3.2 如果没有选择到节点（timeout_node_id不存在或不可用），随机分配
if not chosen_node_id then
    -- 遍历所有 pool，找到第一个可用节点（SMEMBERS返回顺序不确定，相当于随机选择）
    -- ...
end
```

### 3. 手动/pause finalize时清除timeout_node_id

**实现位置**：`central_server/scheduler/src/websocket/session_actor/actor/actor_finalize.rs`

**核心逻辑**：
- **关键优化**：清除操作在**jobs创建之前**执行，确保当前job不会使用旧的timeout_node_id映射
- 在`do_finalize`方法中，当`is_manual_cut = true`或`is_pause_triggered = true`时
- 使用Lua脚本原子性地清除`timeout_node_id`字段
- 允许后续job随机分配
- **兜底机制**：在jobs创建之后也保留清除逻辑，以防第一次清除失败

**执行时机**：
1. **主要清除**：在jobs创建之前立即清除（确保当前job不受影响）
2. **兜底清除**：在jobs创建之后再次清除（防止第一次清除失败）

**代码片段**：
```rust
// 在jobs创建之前清除（主要清除）
if is_manual_cut || is_pause_triggered {
    // 使用Lua脚本原子性地清除timeout_node_id
    // ... 执行脚本，日志级别为info
}

// 创建jobs
let jobs = create_translation_jobs(...).await?;

// 在jobs创建之后清除（兜底清除，防止第一次清除失败）
if is_manual_cut || is_pause_triggered {
    // 再次清除，日志级别为debug
}
```

---

## 二、关键设计决策

### 2.1 Redis存储结构

**Key**: `scheduler:session:{session_id}`  
**Hash字段**:
- `preferred_pool`: 首选的Pool ID（已存在）
- `timeout_node_id`: 超时finalize的节点ID（新增）
- `last_lang_pair`: 最后使用的语言对（已存在）

**TTL**: 5分钟（优化：符合业务逻辑，避免长期缓存）

### 2.2 节点选择优先级

1. **优先**：如果存在`timeout_node_id`且节点在线且在候选pools中，选择该节点
2. **回退**：否则，使用原有的节点选择逻辑（遍历pools，选择第一个在线节点）

### 2.3 映射清除策略

- **超时finalize**：记录映射，确保后续job路由到同一节点
- **手动/pause finalize**：
  - **及时清除**：在jobs创建之前立即清除映射，确保当前job不受影响
  - **兜底清除**：在jobs创建之后再次清除，防止第一次清除失败
  - **日志追踪**：使用info级别日志记录清除操作，便于追踪和调试

---

## 三、与节点端的配合

### 3.1 节点端实现

**节点端**（`electron_node`）：
- `SessionAffinityManager`：管理超时finalize的sessionId->nodeId映射
- `AudioAggregator`：在超时finalize时调用`SessionAffinityManager.recordTimeoutFinalize()`

### 3.2 调度服务器实现

**调度服务器**（`central_server`）：
- 在超时finalize时记录`timeout_node_id`到Redis
- 在`dispatch_task.lua`中优先选择`timeout_node_id`指定的节点
- 在手动/pause finalize时清除`timeout_node_id`

### 3.3 数据一致性

- **节点端**：记录映射用于日志和监控
- **调度服务器**：记录映射用于实际路由决策
- **TTL**：30分钟，确保过期映射自动清理

---

## 四、文件清单

### 修改文件
1. ✅ `central_server/scheduler/src/websocket/session_actor/actor/actor_finalize.rs` - 记录和清除timeout_node_id映射
2. ✅ `central_server/scheduler/scripts/lua/dispatch_task.lua` - 优先选择timeout_node_id指定的节点

---

## 五、测试建议

1. **测试超时finalize的session affinity**：
   - 发送超时finalize的job，验证`timeout_node_id`是否正确记录到Redis
   - 发送后续job，验证是否路由到`timeout_node_id`指定的节点

2. **测试手动/pause finalize清除映射**：
   - 发送手动/pause finalize的job，验证`timeout_node_id`是否被清除
   - 发送后续job，验证是否使用随机分配

3. **测试节点离线场景**：
   - 记录`timeout_node_id`后，节点离线
   - 发送后续job，验证是否回退到随机分配

4. **测试TTL过期**：
   - 记录`timeout_node_id`后，等待30分钟
   - 验证映射是否自动过期

---

**审核状态**: ✅ **实现完成，等待测试**  
**下一步**: 进行集成测试，验证超时finalize的session affinity是否正常工作
