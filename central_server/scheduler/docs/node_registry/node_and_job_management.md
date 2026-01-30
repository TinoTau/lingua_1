# 调度服务器节点注册、节点管理和任务管理流程详细分析

**日期**: 2026-01-24  
**目的**: 为决策部门提供完整的流程分析、代码逻辑、问题对比和决策建议

---

## 一、执行摘要

### 1.1 核心架构

**当前实现**:
- **节点注册**: 基于 Redis Lua 脚本的原子操作，无本地状态
- **节点管理**: 基于 Redis TTL 的被动清理机制，心跳自动分配 Pool
- **任务管理**: 基于 Redis 的 SSOT（Single Source of Truth）存储，支持 failover 重派

**关键特性**:
- ✅ **无状态设计**: 调度服务器不维护本地缓存，所有状态存储在 Redis
- ✅ **原子操作**: 使用 Lua 脚本保证操作的原子性
- ✅ **被动清理**: 基于 TTL 自动清理离线节点，无需主动轮询
- ✅ **Pool 自动分配**: 心跳时自动将节点分配到合适的 Pool

### 1.2 当前问题

1. **Buffer 清除逻辑问题**: 已修复，与备份代码保持一致
2. **前半句丢失问题**: 可能与调度服务器提前 finalize 有关
3. **utteranceIndex 不连续**: 某些 job 的 ASR 结果为空或被过滤

---

## 二、节点注册流程

### 2.1 完整流程图

```
节点端                         调度服务器端                      Redis
 │                                │                              │
 ├─ WebSocket连接 ──────────────→ │                              │
 │                                │                              │
 ├─ node_register消息 ──────────→ │                              │
 │  (包含语言能力)                │                              │
 │                                │                              │
 │                                ├─ handle_node_register()     │
 │                                │  (websocket/node_handler/    │
 │                                │   message/register.rs)       │
 │                                │                              │
 │                                ├─ extract_langs()            │
 │                                │  (提取 ASR/Semantic/TTS)    │
 │                                │                              │
 │                                ├─ MinimalScheduler.          │
 │                                │   register_node()           │
 │                                │  (services/minimal_          │
 │                                │   scheduler.rs)             │
 │                                │                              │
 │                                ├─ register_node_v2.lua ─────→ │
 │                                │                              ├─ HMSET lingua:v1:node:{id}
 │                                │                              │  (asr_langs, semantic_langs,
 │                                │                              │   tts_langs, last_heartbeat_ts)
 │                                │                              │
 │                                │                              ├─ EXPIRE 3600
 │                                │                              │  (节点数据 TTL)
 │                                │                              │
 │                                │                              ├─ SADD lingua:v1:nodes:all
 │                                │                              │  (添加到全局节点集合)
 │                                │                              │
 │                                ├─ node_connections.          │
 │                                │   register()                │
 │                                │  (注册 WebSocket 连接)      │
 │                                │                              │
 │ ←──── node_register_ack ────── │                              │
 │  (注册成功确认)                │                              │
```

### 2.2 方法调用链

#### **2.2.1 节点端发送注册消息**

**文件**: `electron_node/electron-node/main/src/websocket/websocket-client.ts`

```typescript
// 1. 构建注册消息
const message: NodeRegisterMessage = {
    type: 'node_register',
    node_id: this.nodeId || null,
    version: '2.0.0',
    capability_schema_version: '2.0',
    language_capabilities: {
        asr_languages: ['zh', 'en', 'ja'],
        semantic_languages: ['zh', 'en'],
        tts_languages: ['zh', 'en', 'ja'],
    },
    // ... 其他字段
};

// 2. 发送消息
this.ws.send(JSON.stringify(message));
```

#### **2.2.2 调度服务器接收注册消息**

**文件**: `central_server/scheduler/src/websocket/node_handler/message/register.rs`

```rust
pub async fn handle_node_register(
    &self,
    msg: NodeRegisterMessage,
    node_id: String,
) -> Result<NodeRegisterAck> {
    // 1. 提取语言能力
    let (asr_langs, semantic_langs, tts_langs) = extract_langs(&msg.language_capabilities)?;
    
    // 2. 调用 MinimalScheduler 注册节点
    self.scheduler.register_node(RegisterNodeRequest {
        node_id: node_id.clone(),
        asr_langs_json: serde_json::to_string(&asr_langs)?,
        semantic_langs_json: serde_json::to_string(&semantic_langs)?,
        tts_langs_json: serde_json::to_string(&tts_langs)?,
    }).await?;
    
    // 3. 注册 WebSocket 连接
    self.node_connections.register(node_id.clone(), ws_sender).await?;
    
    // 4. 返回确认
    Ok(NodeRegisterAck { success: true })
}
```

#### **2.2.3 Lua 脚本注册节点**

**文件**: `central_server/scheduler/scripts/lua/register_node_v2.lua`

```lua
-- 1. 构建节点数据
local node_key = "lingua:v1:node:" .. node_id
local now_ts = redis.call("TIME")[1]

-- 2. 写入节点数据
redis.call("HMSET", node_key,
    "asr_langs", asr_langs_json,
    "semantic_langs", semantic_langs_json,
    "tts_langs", tts_langs_json,
    "last_heartbeat_ts", tostring(now_ts)
)

-- 3. 设置 TTL（1小时）
redis.call("EXPIRE", node_key, 3600)

-- 4. 添加到全局节点集合
redis.call("SADD", "lingua:v1:nodes:all", node_id)

return "OK"
```

---

## 三、节点管理流程

### 3.1 心跳机制

**心跳流程**:
```
节点端                         调度服务器端                      Redis
 │                                │                              │
 ├─ heartbeat消息 ──────────────→ │                              │
 │  (每30-60秒)                   │                              │
 │                                ├─ handle_heartbeat()         │
 │                                │  (websocket/node_handler/    │
 │                                │   message/heartbeat.rs)     │
 │                                │                              │
 │                                ├─ heartbeat_pool_assign.lua ─→ │
 │                                │                              ├─ 更新 last_heartbeat_ts
 │                                │                              ├─ 生成笛卡尔积 (asr×tts)
 │                                │                              ├─ 分配到 Pool
 │                                │                              └─ 记录映射关系
 │                                │                              │
 │ ←──── heartbeat_ack ────────── │                              │
```

### 3.2 Pool 自动分配

**分配逻辑**:
1. 心跳时自动生成 `asr_langs × tts_langs` 的笛卡尔积
2. 为每个语言对创建或更新 Pool
3. 将节点添加到对应的 Pool
4. 记录 `node_id -> pool_id` 的映射关系

---

## 四、任务管理流程

### 4.1 任务创建流程

**完整流程**:
```
客户端                         调度服务器端                      Redis
 │                                │                              │
 ├─ audio_chunk消息 ────────────→ │                              │
 │                                ├─ handle_audio_chunk()       │
 │                                │  (websocket/session_actor/   │
 │                                │   audio_handler.rs)          │
 │                                │                              │
 │                                ├─ 累积音频数据                │
 │                                │                              │
 │                                ├─ 触发 finalize              │
 │                                │  (IsFinal/Timeout/MaxDuration)│
 │                                │                              │
 │                                ├─ create_job()                │
 │                                │  (websocket/job_creator.rs)  │
 │                                │                              │
 │                                ├─ select_node()               │
 │                                │  (pool/pool_service.rs)      │
 │                                │                              │
 │                                ├─ select_node.lua ──────────→ │
 │                                │                              ├─ 查找候选 Pool
 │                                │                              ├─ Session Affinity 检查
 │                                │                              └─ 选择节点
 │                                │                              │
 │                                ├─ 创建 JobAssignMessage       │
 │                                │                              │
 │                                ├─ 发送到节点端                │
 │                                │                              │
 │                                ├─ 记录 job 状态 ────────────→ │
 │                                │                              ├─ HSET job:{id} status
 │                                │                              └─ EXPIRE 3600
```

### 4.2 任务状态管理

**状态流转**:
- `PENDING` → `ASSIGNED` → `PROCESSING` → `COMPLETED` / `FAILED`
- 所有状态存储在 Redis，支持多实例部署
- 支持 failover 重派（节点离线时重新分配）

---

## 五、与备份代码的对比

### 5.1 架构差异

| 特性 | 备份代码 | 当前代码 |
|------|---------|---------|
| **状态存储** | 本地 HashMap + Redis | 仅 Redis（SSOT） |
| **节点管理** | 主动轮询 | 被动清理（TTL） |
| **Pool 分配** | 手动分配 | 自动分配（心跳时） |
| **任务路由** | dispatch_task.lua | select_node.lua |

### 5.2 优势

**当前代码的优势**:
- ✅ **无状态设计**: 支持多实例部署，无需状态同步
- ✅ **自动 Pool 分配**: 减少手动配置，提高可维护性
- ✅ **原子操作**: Lua 脚本保证操作的原子性
- ✅ **被动清理**: 基于 TTL 自动清理，无需主动轮询

---

## 六、当前问题和解决方案

### 6.1 Buffer 清除逻辑问题

**问题**: 已修复，与备份代码保持一致

### 6.2 前半句丢失问题

**可能原因**: 调度服务器提前 finalize

**解决方案**: 优化 finalize 触发逻辑，增加最小音频时长检查

### 6.3 utteranceIndex 不连续

**可能原因**: 某些 job 的 ASR 结果为空或被过滤

**解决方案**: 优化 ASR 结果处理逻辑，确保 utteranceIndex 连续

---

**文档版本**: v1.0  
**最后更新**: 2026-01-24  
**状态**: 归档文档（历史记录）
