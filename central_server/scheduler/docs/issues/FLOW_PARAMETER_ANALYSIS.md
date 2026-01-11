# 节点管理和任务管理流程参数分析

## 分析目标

检查节点管理和任务管理流程中的方法和参数，识别不合理或不一致的地方。

## 1. 节点管理流程

### 1.1 节点注册 (`register_node`)

#### RegisterNodeRequest 参数

```rust
pub struct RegisterNodeRequest {
    pub node_id: String,
    pub cap_json: String,        // 节点能力 JSON
    pub max_jobs: u32,
    pub pools_json: Option<String>, // 可选，Pool ID 列表 JSON
    pub pool_names_json: Option<String>, // 可选，Pool ID 到 Pool Name 的映射 JSON
}
```

#### 调用位置

**位置**: `src/websocket/node_handler/message/register.rs::handle_node_register`

**参数来源**:
- `node_id`: 生成或使用提供的节点 ID
- `cap_json`: 从 `capability_by_type` 序列化
- `max_jobs`: **硬编码为 4** (`max_jobs: 4, // TODO: 从硬件信息或配置计算`)
- `pools_json`: **设置为 None**
- `pool_names_json`: 从 `_language_capabilities.semantic_languages` 生成

#### 问题 1: `max_jobs` 参数不合理

**问题描述**:
- `max_jobs` 被存储到 Redis (`scheduler:node:info:{node_id}.max_jobs`)
- 但 `dispatch_task.lua` 中**不再检查** `max_jobs`（已移除）
- 节点任务管理由节点端 GPU 仲裁器负责

**证据**:
```lua
-- register_node.lua
redis.call("HSET", node_info_key,
    "max_jobs", tostring(max_jobs),  -- 存储但未被使用
    ...
)

-- dispatch_task.lua
-- 不再检查 max_jobs，只检查 online == 'true'
```

**建议**:
- ✅ **移除 `max_jobs` 参数**（因为未被使用）
- ✅ **移除 `register_node.lua` 中的 `max_jobs` 存储**

#### 问题 2: `pools_json` 参数不一致

**问题描述**:
- `pools_json` 在调用时**始终设置为 None**
- `pool_names_json` 包含 pool 信息（ID 和名称）
- `register_node.lua` 中，`pools_json` 用于添加节点到 pool 成员集合
- 但 `pool_names_json` 的逻辑**也**会添加节点到 pool 成员集合

**当前代码**:
```rust
// handle_node_register
let pools_json = None;  // 始终为 None
let pool_names_json = Some(...);  // 从 semantic_languages 生成
```

**证据**:
```lua
-- register_node.lua
-- 如果提供了 pools_json，添加节点到 pool 成员
if pools_json and pools_json ~= "" and pools_json ~= "[]" then
    -- 添加节点到 pool 成员集合
end

-- 如果提供了 pool_names_json，也添加节点到 pool 成员集合
if pool_names_json and pool_names_json ~= "" and pool_names_json ~= "[]" then
    -- 添加节点到 pool 成员集合
end
```

**建议**:
- ✅ **移除 `pools_json` 参数**（因为始终为 None，且 `pool_names_json` 已覆盖其功能）
- ✅ **保留 `pool_names_json`**（用于 pool 成员管理和语言索引创建）

#### 问题 3: `current_jobs` 初始化

**问题描述**:
- `register_node.lua` 中初始化 `current_jobs = 0`
- 但 `dispatch_task.lua` 和 `complete_task.lua` 中**不再使用** `current_jobs`
- 节点任务管理由节点端 GPU 仲裁器负责

**证据**:
```lua
-- register_node.lua
redis.call("HSET", node_runtime_key,
    "current_jobs", "0"  -- 初始化但未被使用
)

-- dispatch_task.lua
-- 不再更新 current_jobs

-- complete_task.lua
-- 不再更新 current_jobs
```

**建议**:
- ✅ **移除 `current_jobs` 初始化**（因为未被使用）

### 1.2 节点心跳 (`heartbeat`)

#### HeartbeatRequest 参数

```rust
pub struct HeartbeatRequest {
    pub node_id: String,
    pub online: bool,
    pub load_json: Option<String>, // 可选，负载信息 JSON
}
```

#### 调用位置

**位置**: `src/websocket/node_handler/message/register.rs::handle_node_heartbeat`

**参数来源**:
- `node_id`: 从消息中获取
- `online`: 始终为 `true`
- `load_json`: **已设置为 None**（已移除）

#### 问题 4: `load_json` 参数已移除

**状态**: ✅ **已修复**

**说明**:
- `load_json` 已从 `handle_node_heartbeat` 中移除
- `HeartbeatRequest.load_json` 设置为 `None`
- `heartbeat.lua` 支持 `load_json` 为可选

## 2. 任务管理流程

### 2.1 任务调度 (`dispatch_task`)

#### DispatchRequest 参数

```rust
pub struct DispatchRequest {
    pub session_id: String,
    pub src_lang: String,
    pub tgt_lang: String,
    pub payload_json: String,
}
```

#### 调用位置

**位置**: `src/websocket/job_creator.rs::create_job_with_minimal_scheduler`

**参数来源**:
- `session_id`: 从 `CreateJobRequest` 中获取
- `src_lang`: 从 `CreateJobRequest` 中获取
- `tgt_lang`: 从 `CreateJobRequest` 中获取
- `payload_json`: 从 `CreateJobRequest` 中序列化

#### 问题 5: 参数一致性良好

**状态**: ✅ **无问题**

**说明**:
- 参数清晰，用途明确
- 与 `dispatch_task.lua` 的 ARGV 参数一致

### 2.2 任务完成 (`complete_task`)

#### CompleteTaskRequest 参数

```rust
pub struct CompleteTaskRequest {
    pub job_id: String,
    pub node_id: String,
    pub status: String, // "finished" / "failed"
}
```

#### 调用位置

**位置**: `src/websocket/node_handler/message/job_result/job_result_job_management.rs::process_job_operations`

**参数来源**:
- `job_id`: 从函数参数中获取
- `node_id`: 从函数参数中获取
- `status`: 根据 `success` 参数设置（"finished" 或 "failed"）

#### 问题 6: `status` 参数类型

**问题描述**:
- `status` 使用 `String` 类型
- 但实际只允许两个值："finished" 或 "failed"
- 容易出现拼写错误

**建议**:
- ⚠️ **可选优化**: 使用枚举类型（但需要修改较多代码，当前实现可接受）

**状态**: ⚠️ **可选优化**（不是必须）

## 3. 总结

### 需要修复的问题

#### 高优先级（必须修复）

1. **移除 `max_jobs` 参数**
   - 位置: `RegisterNodeRequest.max_jobs`
   - 位置: `register_node.lua` 中的 `max_jobs` 存储
   - 位置: `handle_node_register` 中的 `max_jobs: 4` 硬编码
   - 原因: 未被使用，节点任务管理由节点端负责

2. **移除 `pools_json` 参数**
   - 位置: `RegisterNodeRequest.pools_json`
   - 位置: `register_node.lua` 中的 `pools_json` 处理逻辑
   - 位置: `handle_node_register` 中的 `pools_json = None`
   - 原因: 始终为 None，且 `pool_names_json` 已覆盖其功能

3. **移除 `current_jobs` 初始化**
   - 位置: `register_node.lua` 中的 `current_jobs = 0` 初始化
   - 位置: `register_node.lua` 中的 `node_runtime_key` 初始化
   - 原因: 未被使用，节点任务管理由节点端负责

#### 中优先级（可选优化）

4. **`status` 参数类型优化**
   - 位置: `CompleteTaskRequest.status`
   - 建议: 使用枚举类型（但需要修改较多代码）
   - 状态: 当前实现可接受，不是必须

### 已修复的问题

1. ✅ **移除 `load_json` 构建**（已完成）
   - 位置: `handle_node_heartbeat`
   - 状态: 已移除

### 修复后的参数结构

#### RegisterNodeRequest（修复后）

```rust
pub struct RegisterNodeRequest {
    pub node_id: String,
    pub cap_json: String,        // 节点能力 JSON
    pub pool_names_json: Option<String>, // 可选，Pool ID 到 Pool Name 的映射 JSON
}
```

#### register_node.lua（修复后）

```lua
-- ARGV: node_id, cap_json, pool_names_json(可选)

-- 1. 写入节点信息（移除 max_jobs）
redis.call("HSET", node_info_key,
    "online", "true",
    "cap_json", cap_json,
    "last_heartbeat_ts", tostring(now_ts)
)

-- 2. 移除 node_runtime_key 初始化（不再需要 current_jobs）

-- 3. 只处理 pool_names_json（移除 pools_json 处理）
```

## 4. 修复建议

### 修复步骤

1. **修改 `RegisterNodeRequest` 结构**
   - 移除 `max_jobs: u32`
   - 移除 `pools_json: Option<String>`

2. **修改 `register_node.lua`**
   - 移除 `max_jobs` 参数和存储
   - 移除 `current_jobs` 初始化
   - 移除 `pools_json` 处理逻辑

3. **修改 `handle_node_register`**
   - 移除 `max_jobs: 4` 硬编码
   - 移除 `pools_json = None`
   - 更新 `RegisterNodeRequest` 调用

4. **更新 `MinimalSchedulerService::register_node`**
   - 移除 `max_jobs` 参数传递
   - 移除 `pools_json` 参数传递
   - 更新 Lua 脚本调用
