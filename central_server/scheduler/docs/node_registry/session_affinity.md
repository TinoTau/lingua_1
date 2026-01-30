# Session Affinity 和节点路由

**日期**: 2026-01-24  
**目的**: 详细说明 Session Affinity 机制，确保相关 job 路由到同一个节点

---

## 一、问题背景

### 1.1 问题描述

**核心问题**:
- 调度服务器将任务随机分发给不同的节点
- 不同节点的 `AudioAggregator` buffer 是独立的，无法共享 `pendingTimeoutAudio`
- 导致跨节点的音频无法合并

**影响**:
- ❌ Timeout finalize 的音频无法与后续 job 合并
- ❌ MaxDuration finalize 的音频无法与后续 job 合并
- ❌ 用户体验差（音频不完整）

### 1.2 解决方案

**Session Affinity 机制**:
- ✅ 记录 `timeout_node_id` 或 `max_duration_node_id` 到 Redis
- ✅ 节点选择时优先路由到绑定的节点
- ✅ 确保相关 job 路由到同一个节点

---

## 二、Session Affinity 机制

### 2.1 Redis Key 结构

```
scheduler:session:{session_id}              # Session 数据 Hash
  - timeout_node_id: "node-abc123"          # Timeout finalize 绑定的节点
  - max_duration_node_id: "node-abc123"     # MaxDuration finalize 绑定的节点
```

### 2.2 记录机制

#### 2.2.1 MaxDuration Finalize

**代码位置**: `websocket/session_actor/actor/actor_finalize.rs:269-323`

```rust
// Session Affinity：MaxDuration finalize 时记录 sessionId->nodeId 映射
if is_max_duration_triggered {
    // 获取第一个job的node_id（如果有）
    if let Some(first_job) = jobs.first() {
        if let Some(ref node_id) = first_job.assigned_node_id {
            // 记录sessionId->nodeId映射到Redis
            if let Some(ref rt) = self.state.phase2 {
                let session_key = format!("scheduler:session:{}", self.session_id);
                let ttl_seconds = 5 * 60; // 5分钟TTL
                
                // ✅ 使用独立的 Redis key，不与 timeout 混用
                let script = r#"
redis.call('HSET', KEYS[1], 'max_duration_node_id', ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 1
"#;
                // ... 执行 Lua 脚本
            }
        }
    }
}
```

**特点**:
- ✅ 使用独立的 Redis key（`max_duration_node_id`）
- ✅ 设置 5 分钟 TTL
- ✅ 确保后续 MaxDuration job 路由到同一个节点

#### 2.2.2 Timeout Finalize

**当前状态**:
- ❌ **Timeout finalize 不记录 `timeout_node_id` 到 Redis**
- ❌ 因为 Timeout finalize 不创建 job，无法获取 `assigned_node_id`

**待解决问题**:
- ⏳ 需要在 Timeout finalize 时也记录 `timeout_node_id` 到 Redis
- ⏳ 或者，节点端在超时 finalize 时通知调度服务器

#### 2.2.3 手动/Timeout Finalize - 清除映射

**代码位置**: `websocket/session_actor/actor/actor_finalize.rs:156-195`

```rust
// Session Affinity：手动/timeout finalize时立即清除timeout_node_id映射
if is_manual_cut || is_timeout_triggered {
    // 使用Lua脚本原子性地清除timeout_node_id
    let script = r#"
redis.call('HDEL', KEYS[1], 'timeout_node_id')
return 1
"#;
    // ... 执行 Lua 脚本
}
```

**目的**:
- ✅ 手动/timeout finalize 表示句子结束
- ✅ 清除映射后，后续 job 可以使用随机分配

---

## 三、节点选择逻辑

### 3.1 select_node.lua 实现

**文件**: `scripts/lua/select_node.lua`

```lua
-- 1. 解析参数
local pair_key = ARGV[1]  -- "zh:en"
local job_id = ARGV[2]
local session_id = ARGV[3]

-- 2. Session Affinity：优先查找 timeout_node_id 映射
local chosen_node_id = nil
if session_id and session_id ~= "" then
    local session_key = "scheduler:session:" .. session_id
    local timeout_node_id = redis.call("HGET", session_key, "timeout_node_id")
    
    if timeout_node_id and timeout_node_id ~= "" then
        local node_key = "lingua:v1:node:" .. timeout_node_id
        local online = redis.call("EXISTS", node_key)
        
        if online == 1 then
            -- timeout_node_id 指定的节点在线，检查该节点是否在候选 pools 中
            for pool_id = 0, MAX_POOL_ID do
                local pool_key = "lingua:v1:pool:" .. pair_key .. ":" .. pool_id .. ":nodes"
                local is_member = redis.call("SISMEMBER", pool_key, timeout_node_id)
                
                if is_member == 1 then
                    -- 节点在 pool 中，选择该节点（Session Affinity 匹配成功）
                    chosen_node_id = timeout_node_id
                    break
                end
            end
        end
    end
    
    -- 3. 如果 timeout_node_id 不存在，检查 max_duration_node_id
    if not chosen_node_id then
        local max_duration_node_id = redis.call("HGET", session_key, "max_duration_node_id")
        
        if max_duration_node_id and max_duration_node_id ~= "" then
            -- 类似逻辑检查 max_duration_node_id
            -- ...
        end
    end
end

-- 4. 如果通过 Session Affinity 选择了节点，直接返回
if chosen_node_id then
    return chosen_node_id
end

-- 5. 否则，从 Pool 中随机选择节点
-- ...
```

### 3.2 方法调用链

**文件**: `pool/pool_service.rs`

```rust
pub async fn select_node(
    &self,
    src_lang: &str,
    tgt_lang: &str,
    job_id: Option<&str>,
    session_id: Option<&str>,  // ✅ 新增参数
) -> Result<String> {
    // 调用 Lua 脚本选择节点
    let result: Option<String> = self.eval_script(
        &self.scripts.select_node,
        &[&pair_key, job_id.unwrap_or(""), session_id.unwrap_or("")],
    ).await?;
    // ...
}
```

**调用处**: `websocket/job_creator.rs`

```rust
let node_id_str = pool_service.select_node(
    pool_src, 
    pool_tgt, 
    job_id_for_binding, 
    Some(session_id)  // ✅ 传递 session_id
).await?;
```

---

## 四、工作流程

### 4.1 MaxDuration Finalize 场景

**流程**:
1. `utterance_index=5` MaxDuration finalize
   - 调度服务器创建 job，路由到**节点 A**
   - 调度服务器记录 `max_duration_node_id = "node-A"` 到 Redis

2. 客户端发送新的音频，调度服务器创建 `utterance_index=6` 的 job
   - 调度服务器调用 `select_node(..., Some(session_id))`
   - `select_node.lua` 读取 `max_duration_node_id`：**存在**（`"node-A"`）
   - 优先路由到**节点 A**（✅ Session Affinity 匹配成功）

3. 节点 A 接收 `utterance_index=6` 的 job
   - 节点 A 的 `AudioAggregator` 检查 `pendingMaxDurationAudio`：**存在**
   - 可以合并音频（✅ 成功）

**结论**:
- ✅ **MaxDuration finalize 场景下，没有问题**
- ✅ 因为调度服务器会记录 `max_duration_node_id` 到 Redis，确保后续 job 路由到同一个节点

### 4.2 Timeout Finalize 场景

**流程**:
1. `utterance_index=3` 超时 finalize
   - 节点 A 处理，将音频缓冲到 `pendingTimeoutAudio`
   - 节点端记录 `timeout_node_id` 到**本地** `SessionAffinityManager`
   - 调度服务器**不创建 job**，**不记录 `timeout_node_id` 到 Redis`（❌ 问题）

2. 客户端发送新的音频，调度服务器创建 `utterance_index=4` 的 job
   - 调度服务器调用 `select_node(..., Some(session_id))`
   - `select_node.lua` 读取 `timeout_node_id`：**不存在**（❌ 问题）
   - 使用**随机分配**，可能路由到**节点 B**

3. 节点 B 接收 `utterance_index=4` 的 job
   - 节点 B 的 `AudioAggregator` 检查 `pendingTimeoutAudio`：**不存在**
   - 无法合并音频

**结论**:
- ❌ **Timeout finalize 场景下，仍然会有问题**
- ❌ 因为调度服务器无法知道节点端的 `timeout_node_id`，可能路由到不同节点

---

## 五、待解决问题

### 5.1 Timeout Finalize 不记录 `timeout_node_id` 到 Redis

**问题**:
- ❌ **Timeout finalize** 不会创建 job，调度服务器无法记录 `timeout_node_id` 到 Redis
- ❌ 节点端记录的 `timeout_node_id` 只在**本地**，调度服务器无法访问

**解决方案**（待实现）:
1. ✅ 在 Timeout finalize 时，也记录 `timeout_node_id` 到 Redis
2. ✅ 或者，节点端在超时 finalize 时通知调度服务器
3. ✅ 或者，使用 session 的当前节点信息来记录 `timeout_node_id`

---

## 六、总结

### 6.1 已完成的修改

✅ **修改 `select_node` 方法**：添加 `session_id` 参数  
✅ **修改 `select_node.lua`**：添加 `timeout_node_id` 和 `max_duration_node_id` 支持  
✅ **更新调用处**：传递 `session_id` 参数  
✅ **MaxDuration finalize**：记录 `max_duration_node_id` 到 Redis

### 6.2 效果

✅ **MaxDuration finalize**：可以正常工作（会记录 `max_duration_node_id` 到 Redis）  
❌ **Timeout finalize**：仍然有问题（不会记录 `timeout_node_id` 到 Redis）

### 6.3 下一步

**需要修复 Timeout finalize**:
- ⏳ 在 Timeout finalize 时，也记录 `timeout_node_id` 到 Redis
- ⏳ 或者，节点端在超时 finalize 时通知调度服务器
- ⏳ 确保所有需要 AudioAggregator 连续性的场景，都使用 session affinity

---

## 七、相关文档

- [节点注册协议](./node_registration.md)
- [节点管理和任务管理流程](./node_and_job_management.md)
- [Finalize 处理机制](../finalize/README.md)
- [MaxDuration Finalize](../finalize/maxduration_finalize.md)
- [Timeout Finalize](../finalize/timeout_finalize.md)

---

**文档版本**: v1.0  
**最后更新**: 2026-01-24
