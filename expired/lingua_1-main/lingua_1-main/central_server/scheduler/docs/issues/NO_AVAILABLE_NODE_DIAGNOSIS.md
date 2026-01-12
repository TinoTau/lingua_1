# NO_AVAILABLE_NODE 错误诊断

## 问题描述

节点注册成功后，任务调度失败，错误：`NO_AVAILABLE_NODE`

**节点 ID**: `node-DA0E8AF9`  
**错误时间**: 05:39:48  
**节点注册时间**: 05:37:04

## 代码逻辑检查

### 1. register_node.lua

```lua
-- 设置节点信息
redis.call("HSET", node_info_key,
    "online", "true",           -- ✓ 字符串 "true"
    "max_jobs", tostring(max_jobs),  -- ✓ 字符串 "4"
    ...
)

-- 设置运行状态
redis.call("HSET", node_runtime_key,
    "current_jobs", "0"         -- ✓ 字符串 "0"
)
```

**结论**: 代码逻辑正确

### 2. dispatch_task.lua

```lua
-- 检查节点是否在线
local online = redis.call("HGET", info_key, "online")
if online == "true" then        -- ✓ 字符串比较
    local current_jobs = tonumber(redis.call("HGET", rt_key, "current_jobs") or "0")
    local max_jobs = tonumber(redis.call("HGET", info_key, "max_jobs") or "0")
    
    if current_jobs < max_jobs then  -- ✓ 数字比较
        chosen_node_id = node_id
        break
    end
end
```

**结论**: 代码逻辑正确

### 3. handle_node_register (Rust)

```rust
// 从 semantic_languages 生成 pool_names_json
let pool_names_json = if let Some(ref lang_caps) = _language_capabilities {
    if let Some(ref semantic_langs) = lang_caps.semantic_languages {
        if !semantic_langs.is_empty() {
            // 生成 pool_names_json
            ...
        }
    }
};

// 调用 MinimalSchedulerService::register_node
scheduler.register_node(req).await?;

// 注册 WebSocket 连接
state.node_connections.register(final_node_id.clone(), tx.clone()).await;
```

**结论**: 代码逻辑正确

## 错误分析

`NO_AVAILABLE_NODE` 错误说明：
1. ✓ 语言索引存在（否则会报 `NO_POOL_FOR_LANG_PAIR`）
2. ✓ Pool 存在且有节点（否则会报 `EMPTY_POOL`）
3. ✗ 节点不满足条件（`online != "true"` 或 `current_jobs >= max_jobs`）

## 需要检查的 Redis 数据

由于系统未安装 `redis-cli`，请手动检查以下 Redis 数据：

### 1. 检查节点信息

```bash
redis-cli HGET scheduler:node:info:node-DA0E8AF9 online
redis-cli HGET scheduler:node:info:node-DA0E8AF9 max_jobs
redis-cli HGETALL scheduler:node:info:node-DA0E8AF9
```

**预期值**:
- `online` = `"true"`
- `max_jobs` = `"4"`

### 2. 检查节点运行状态

```bash
redis-cli HGET scheduler:node:runtime:node-DA0E8AF9 current_jobs
redis-cli HGETALL scheduler:node:runtime:node-DA0E8AF9
```

**预期值**:
- `current_jobs` = `"0"`

### 3. 检查 Pool 成员集合

```bash
# 查找所有 Pool 成员集合
redis-cli KEYS scheduler:pool:*:members

# 检查每个 Pool 中的节点
redis-cli SMEMBERS scheduler:pool:{pool_id}:members
```

**预期**: `node-DA0E8AF9` 应该在某个 Pool 的成员集合中

### 4. 检查语言索引

```bash
redis-cli HGET scheduler:lang:zh:en pools_json
redis-cli HGETALL scheduler:lang:zh:en
```

**预期**: `pools_json` 应该包含一个 pool_id 数组（JSON 格式）

## 可能的问题

### 问题 1: 节点的 online 字段不是 "true"

**检查**:
```bash
redis-cli HGET scheduler:node:info:node-DA0E8AF9 online
```

**可能的原因**:
- 节点注册时字段没有被正确设置（但代码看起来是正确的）
- 节点注册后字段被其他逻辑修改了（需要检查心跳逻辑）

### 问题 2: 节点的 max_jobs 是 0

**检查**:
```bash
redis-cli HGET scheduler:node:info:node-DA0E8AF9 max_jobs
```

**可能的原因**:
- 节点注册时 `max_jobs` 参数是 0（但代码硬编码为 4）
- 字段没有被正确设置

### 问题 3: 节点的 current_jobs >= max_jobs

**检查**:
```bash
redis-cli HGET scheduler:node:runtime:node-DA0E8AF9 current_jobs
redis-cli HGET scheduler:node:info:node-DA0E8AF9 max_jobs
```

**可能的原因**:
- `current_jobs` 不是 0（但注册时应该设置为 0）
- `max_jobs` 是 0（但注册时应该设置为 4）

## 建议

1. **先检查 Redis 数据**，确认节点的实际状态
2. **如果 Redis 数据不正确**，检查节点注册逻辑是否有问题
3. **如果 Redis 数据正确**，检查 `dispatch_task.lua` 的逻辑是否有问题

## 下一步

1. 安装 `redis-cli` 或使用 Redis GUI 工具检查数据
2. 或者，在代码中添加调试日志，记录节点注册和调度时的实际值
