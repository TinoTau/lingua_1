# 极简无锁调度服务集成指南

## 文档信息

- **版本**: v1.0
- **日期**: 2026-01-11
- **状态**: 已实现，待集成测试
- **参考文档**: `LOCKLESS_MINIMAL_SCHEDULER_SPEC_v1.md`

---

## 一、实现概述

已根据 `LOCKLESS_MINIMAL_SCHEDULER_SPEC_v1.md` 实现极简无锁调度服务：

### ✅ 已完成

1. **4 个核心 Lua 脚本** (`scripts/lua/`)
   - `register_node.lua` - 节点注册
   - `heartbeat.lua` - 节点心跳
   - `dispatch_task.lua` - 任务调度
   - `complete_task.lua` - 任务完成

2. **极简调度服务模块** (`src/services/minimal_scheduler.rs`)
   - `MinimalSchedulerService` - 核心服务结构
   - `register_node()` - 节点注册 API
   - `heartbeat()` - 节点心跳 API
   - `dispatch_task()` - 任务调度 API
   - `complete_task()` - 任务完成 API

3. **请求/响应结构**
   - `RegisterNodeRequest` / `RegisterNodeResponse`
   - `HeartbeatRequest`
   - `DispatchRequest` / `DispatchResponse`
   - `CompleteTaskRequest`

---

## 二、使用方法

### 2.1 初始化服务

```rust
use crate::services::MinimalSchedulerService;
use crate::phase2::RedisHandle;
use crate::core::config::Phase2RedisConfig;
use std::sync::Arc;

// 创建 RedisHandle
let redis_config = Phase2RedisConfig {
    url: "redis://localhost:6379".to_string(),
    mode: "single".to_string(),
    // ... 其他配置
};

let redis = Arc::new(RedisHandle::connect(&redis_config).await?);

// 创建极简调度服务
let scheduler = MinimalSchedulerService::new(redis).await?;
```

### 2.2 节点注册

```rust
use crate::services::minimal_scheduler::RegisterNodeRequest;

let req = RegisterNodeRequest {
    node_id: "node-1".to_string(),
    cap_json: r#"{"services":["ASR","NMT","TTS"],"languages":["zh","en"]}"#.to_string(),
    max_jobs: 4,
    pools_json: Some(r#"[1,2]"#.to_string()), // 可选
};

scheduler.register_node(req).await?;
```

### 2.3 节点心跳

```rust
use crate::services::minimal_scheduler::HeartbeatRequest;

let req = HeartbeatRequest {
    node_id: "node-1".to_string(),
    online: true,
    load_json: Some(r#"{"cpu":0.5,"gpu":0.3}"#.to_string()), // 可选
};

scheduler.heartbeat(req).await?;
```

### 2.4 任务调度

```rust
use crate::services::minimal_scheduler::{DispatchRequest, DispatchResponse};

let req = DispatchRequest {
    session_id: "session-1".to_string(),
    src_lang: "zh".to_string(),
    tgt_lang: "en".to_string(),
    payload_json: r#"{"audio_data":"..."}"#.to_string(),
};

let response: DispatchResponse = scheduler.dispatch_task(req).await?;
println!("分配节点: {}, Job ID: {}", response.node_id, response.job_id);
```

### 2.5 任务完成

```rust
use crate::services::minimal_scheduler::CompleteTaskRequest;

let req = CompleteTaskRequest {
    job_id: "session-1:123".to_string(),
    node_id: "node-1".to_string(),
    status: "finished".to_string(), // 或 "failed"
};

scheduler.complete_task(req).await?;
```

---

## 三、集成到现有代码

### 3.1 在 AppState 中添加服务

```rust
// src/core/app_state.rs
pub struct AppState {
    // ... 现有字段
    pub minimal_scheduler: Option<Arc<MinimalSchedulerService>>,
}
```

### 3.2 在启动时初始化

```rust
// src/app/startup.rs
use crate::services::MinimalSchedulerService;

async fn init_minimal_scheduler(state: &AppState) -> Result<()> {
    if let Some(phase2) = &state.phase2 {
        // 使用 Phase2Runtime 的 RedisHandle
        let redis = Arc::new(phase2.redis.clone());
        let scheduler = MinimalSchedulerService::new(redis).await?;
        state.minimal_scheduler = Some(Arc::new(scheduler));
    }
    Ok(())
}
```

### 3.3 在 HTTP 路由中使用

```rust
// src/app/routes/routes_api.rs
use crate::services::minimal_scheduler::{DispatchRequest, DispatchResponse};
use axum::{extract::State, Json};

async fn dispatch_task_minimal(
    State(state): State<AppState>,
    Json(req): Json<DispatchRequest>,
) -> Result<Json<DispatchResponse>, StatusCode> {
    let scheduler = state.minimal_scheduler
        .as_ref()
        .ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    
    scheduler.dispatch_task(req)
        .await
        .map(Json)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}
```

---

## 四、Redis Key 结构

### 4.1 节点信息

```
scheduler:node:info:{node_id}
  - online: "true" / "false"
  - cap_json: string
  - max_jobs: integer
  - last_heartbeat_ts: integer
```

### 4.2 节点运行状态

```
scheduler:node:runtime:{node_id}
  - current_jobs: integer
```

### 4.3 Pool 成员

```
scheduler:pool:{pool_id}:members
  - Set of node_id
```

### 4.4 语言索引

```
scheduler:lang:{src_lang}:{tgt_lang}
  - pools_json: string (JSON 数组)
```

### 4.5 任务

```
scheduler:job:{job_id}
  - node_id: string
  - session_id: string
  - src_lang: string
  - tgt_lang: string
  - payload_json: string
  - status: string
  - created_ts: integer
```

### 4.6 会话（可选）

```
scheduler:session:{session_id}
  - preferred_pool: string
  - last_lang_pair: string
```

---

## 五、Lua 脚本说明

### 5.1 register_node.lua

**功能**: 原子注册节点到 Redis

**参数**:
- `ARGV[1]`: node_id
- `ARGV[2]`: cap_json (节点能力 JSON)
- `ARGV[3]`: max_jobs (最大并发任务数)
- `ARGV[4]`: pools_json (可选，Pool ID 列表)

**操作**:
1. 写入节点信息到 `scheduler:node:info:{node_id}`
2. 初始化运行状态到 `scheduler:node:runtime:{node_id}`
3. 更新 Pool 成员（如果提供了 pools_json）

---

### 5.2 heartbeat.lua

**功能**: 原子更新节点心跳

**参数**:
- `ARGV[1]`: node_id
- `ARGV[2]`: online ("true" / "false")
- `ARGV[3]`: load_json (可选，负载信息 JSON)

**操作**:
1. 更新节点在线状态
2. 更新最后心跳时间戳
3. 更新负载信息（如果提供）

---

### 5.3 dispatch_task.lua

**功能**: 原子调度任务到节点

**参数**:
- `ARGV[1]`: session_id
- `ARGV[2]`: src_lang
- `ARGV[3]`: tgt_lang
- `ARGV[4]`: payload_json

**操作**:
1. 读取或决定 preferred_pool
2. 从 Pool 中选择可用节点
3. 占用节点并发槽（current_jobs + 1）
4. 创建 Job 记录

**返回**: `{node_id, job_id}` 或 `{err, reason}`

---

### 5.4 complete_task.lua

**功能**: 原子完成任务

**参数**:
- `ARGV[1]`: job_id
- `ARGV[2]`: node_id
- `ARGV[3]`: status ("finished" / "failed")

**操作**:
1. 校验 job 是否属于该节点
2. 更新 job 状态
3. 释放节点并发槽（current_jobs - 1）

---

## 六、错误处理

### 6.1 任务调度错误

```rust
match scheduler.dispatch_task(req).await {
    Ok(response) => {
        // 成功：返回 node_id 和 job_id
    }
    Err(e) => {
        // 错误可能包括：
        // - NO_POOL_FOR_LANG_PAIR: 没有支持该语言对的 Pool
        // - EMPTY_POOL: Pool 为空
        // - NO_AVAILABLE_NODE: 没有可用节点
    }
}
```

### 6.2 任务完成错误

```rust
match scheduler.complete_task(req).await {
    Ok(_) => {
        // 成功
    }
    Err(e) => {
        // 错误可能包括：
        // - NODE_MISMATCH: job 不属于该节点
    }
}
```

---

## 七、测试建议

### 7.1 单元测试

```rust
#[cfg(test)]
mod tests {
    use super::*;
    
    #[tokio::test]
    async fn test_register_node() {
        // 测试节点注册
    }
    
    #[tokio::test]
    async fn test_dispatch_task() {
        // 测试任务调度
    }
}
```

### 7.2 集成测试

1. **节点注册 → 心跳 → 任务调度 → 任务完成** 完整流程
2. **并发测试**: 多个任务同时调度
3. **错误场景**: Pool 为空、节点已满等

---

## 八、性能优化建议

### 8.1 Lua 脚本优化

- 使用 `EVALSHA` 代替 `EVAL`（脚本缓存）
- 减少 Redis 往返次数
- 优化 JSON 解析（如果 Redis 支持 cjson）

### 8.2 缓存优化（可选）

- 本地缓存 Pool 成员列表（只读）
- 本地缓存语言索引（只读）
- 通过 Redis Pub/Sub 失效缓存

---

## 九、下一步工作

1. ✅ **已完成**: 4 个核心 Lua 脚本
2. ✅ **已完成**: 极简调度服务模块
3. ⏳ **待完成**: 集成到现有 HTTP/WebSocket 路由
4. ⏳ **待完成**: 单元测试和集成测试
5. ⏳ **待完成**: 性能测试和优化

---

**文档版本**: v1.0  
**最后更新**: 2026-01-11  
**状态**: ✅ 核心功能已实现，待集成测试
