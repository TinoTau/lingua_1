# running_jobs 绑定逻辑分析

## 问题

节点端为什么需要把任务数量（running_jobs）提交给调度服务器？这绑定了多少逻辑？

## 代码检查结果

### 1. 节点端发送 running_jobs

**位置**: NodeHeartbeat 消息中的 `ResourceUsage` 结构

**结构定义**:
```rust
pub struct ResourceUsage {
    pub cpu_percent: f64,
    pub gpu_percent: f64,
    pub mem_percent: f64,
    pub running_jobs: u32,  // 节点当前运行的任务数量
}
```

**消息流程**:
1. 节点端计算当前运行的任务数量
2. 通过 `NodeHeartbeat` 消息发送给调度服务器
3. 包含在 `resource_usage` 字段中

### 2. 调度服务器接收

**位置**: `src/websocket/node_handler/message/register.rs::handle_node_heartbeat`

**当前代码**:
```rust
pub(super) async fn handle_node_heartbeat(
    state: &AppState,
    node_id: &str,
    resource_usage: ResourceUsage,  // 包含 running_jobs
    ...
) {
    if let Some(scheduler) = state.minimal_scheduler.as_ref() {
        // 构建负载信息 JSON（包含 running_jobs）
        let load_json = serde_json::json!({
            "cpu": resource_usage.cpu_percent,
            "gpu": resource_usage.gpu_percent,
            "mem": resource_usage.mem_percent,
            "running_jobs": resource_usage.running_jobs,  // 包含在此
        }).to_string();

        let req = HeartbeatRequest {
            node_id: node_id.to_string(),
            online: true,
            load_json: Some(load_json),
        };

        scheduler.heartbeat(req).await?;
    }
}
```

### 3. Redis 存储

**位置**: `scripts/lua/heartbeat.lua`

**当前代码**:
```lua
-- 如果提供了负载信息，也更新
if load and load ~= "" then
    redis.call("HSET", node_info_key, "load_json", load)
end
```

**存储位置**: `scheduler:node:info:{node_id}.load_json`

### 4. 使用情况检查

**搜索范围**: 
- `dispatch_task.lua`: ❌ 不使用 `load_json` 或 `running_jobs`
- `complete_task.lua`: ❌ 不使用 `load_json` 或 `running_jobs`
- `register_node.lua`: ❌ 不使用 `load_json` 或 `running_jobs`
- `heartbeat.lua`: ✅ 只存储，不使用

**之前的用途（已移除）**:
- ❌ 之前用于检查 `current_jobs < max_jobs`（在 `dispatch_task.lua` 中）
- ❌ 之前用于管理并发槽（`HINCRBY current_jobs`）

**当前状态**:
- ✅ `load_json` 存储在 Redis，但**未被使用**
- ✅ 没有其他逻辑依赖 `running_jobs`

## 绑定逻辑分析

### 已移除的绑定（修复后）

1. **节点选择逻辑**（已移除）
   - 之前: `dispatch_task.lua` 检查 `current_jobs < max_jobs`
   - 现在: 只检查 `online == 'true'`
   - 状态: ✅ 已解耦

2. **并发槽管理**（已移除）
   - 之前: `dispatch_task.lua` 执行 `HINCRBY current_jobs 1`
   - 之前: `complete_task.lua` 执行 `HINCRBY current_jobs -1`
   - 现在: 不再管理 `current_jobs`
   - 状态: ✅ 已解耦

### 当前仍存在的绑定（但未使用）

1. **心跳消息结构**
   - 节点端: `ResourceUsage.running_jobs` 字段
   - 调度服务器: 接收并存储到 `load_json`
   - 使用情况: ❌ **未被使用**
   - 影响: 最小（只是存储，不影响逻辑）

## 结论

### 1. running_jobs 当前未被使用

- ✅ `load_json` 存储在 Redis，但没有代码读取或使用它
- ✅ 节点选择不再依赖 `running_jobs`
- ✅ 没有其他逻辑使用 `running_jobs`

### 2. 可以移除或保留

**选项 A: 移除 running_jobs（推荐）**
- 优点: 简化消息结构，减少不必要的数据传输
- 缺点: 如果将来需要用于监控或调试，需要重新添加
- 影响: 最小（当前未使用）

**选项 B: 保留但注释说明**
- 优点: 保留用于将来的资源监控
- 缺点: 保留无用的数据
- 影响: 最小（只是存储）

**选项 C: 改为基于资源开销（如果将来需要）**
- 如果将来需要基于资源选择节点，应该使用 `cpu_percent`、`gpu_percent`、`mem_percent`
- 而不是 `running_jobs`（任务数量）

### 3. 建议

**短期**: 
- ✅ 已修复：移除 `current_jobs` 和 `max_jobs` 的检查
- ✅ 当前状态：`running_jobs` 已不被使用

**长期**:
- 如果不需要监控节点任务数量，可以考虑从 `ResourceUsage` 中移除 `running_jobs`
- 或者，在文档中明确说明 `running_jobs` 仅用于监控，不用于调度决策

## 绑定逻辑总结

| 组件 | 之前绑定 | 当前状态 | 影响 |
|------|---------|---------|------|
| 节点选择 | ✅ 使用 `current_jobs < max_jobs` | ❌ 已移除，只检查 `online` | 已解耦 |
| 并发槽管理 | ✅ 调度服务器管理 `current_jobs` | ❌ 已移除，由节点端管理 | 已解耦 |
| 心跳消息 | ✅ 包含 `running_jobs` | ✅ 包含但未使用 | 最小影响 |
| Redis 存储 | ✅ 存储在 `load_json` | ✅ 存储但未读取 | 最小影响 |

**总体结论**: 
- ✅ **主要绑定已解耦**（节点选择和并发槽管理）
- ✅ `running_jobs` 目前只是"传递"，没有被使用
- ✅ **可以安全移除或保留**（取决于是否需要监控）
