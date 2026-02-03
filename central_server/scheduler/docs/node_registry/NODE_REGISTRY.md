# 节点注册与节点管理

**状态**: 当前实现（Lua + Redis 直查）

## 一、注册流程

1. 节点建立 WebSocket 连接后发送 `type: "register"`，携带 `language_capabilities`（asr_languages、semantic_languages、tts_languages 必填）。
2. Scheduler 生成 node_id，提取语言能力，调用 `MinimalScheduler.register_node()` → `register_node_v2.lua`。
3. Lua 写入 Redis：`HMSET lingua:v1:node:{node_id}`（asr_langs, semantic_langs, tts_langs, last_heartbeat_ts）、`EXPIRE 3600`、`SADD lingua:v1:nodes:all`。
4. 本地注册 WebSocket 连接，返回 `node_register_ack`。

**代码**: `websocket/node_handler/message/register.rs`、`services/minimal_scheduler.rs`、`scripts/lua/register_node_v2.lua`。

## 二、注册消息格式

```json
{
  "type": "register",
  "version": "3.0",
  "language_capabilities": {
    "asr_languages": ["zh", "en", "de"],
    "semantic_languages": ["zh", "en"],
    "tts_languages": ["zh", "en", "ja"]
  }
}
```

- asr_languages、semantic_languages、tts_languages 均必填且非空；池分配使用 (asr × semantic)。

## 三、心跳与 Pool 分配

- 节点定期发送 `type: "heartbeat"`，Scheduler 调用 `PoolService.heartbeat(node_id)` → `heartbeat_with_pool_assign.lua`。
- Lua 根据 node 的 asr_langs/semantic_langs 生成有向语言对，为每对分配未满 Pool，更新 `lingua:v1:pool:{src}:{tgt}:{id}:nodes` 与 `lingua:v1:node:{node_id}:pools`。

## 四、节点管理与任务管理

- **节点信息**: 全部在 Redis（node Hash、nodes:all、pool 成员）；无本地缓存，NodeRegistry 直查 Redis。
- **任务创建**: `create_translation_jobs()` → `create_job_with_minimal_scheduler()` → Job 写入 Redis（`lingua:v1:job:{job_id}`），节点选择通过 `PoolService.select_node()`。
- **节点选择**: `select_node.lua` 支持可选 job_id（Timeout Finalize 绑定）；无 job_id 时按 pair_key 随机选 Pool 再随机选节点。

## 五、Session Affinity（Timeout / MaxDuration）

- **Timeout Finalize**: 同一 turn 内后续 job 需发往同一节点；Scheduler 在选节点时传入 job_id，select_node.lua 先查 `lingua:v1:job:{job_id}:node`，存在则返回绑定节点，否则选节点并写入绑定。
- **MaxDuration**: 长音频按最大时长切分时，同一会话的后续任务也可通过 job 绑定发往同一节点（逻辑与 timeout 一致）。

## 六、节点下线

- TTL 过期（如 3600s 无心跳）后 Redis 自动删除 node、pool 相关 key；无需 Scheduler 主动清理。
- 主动下线：可调用 `PoolService.node_offline(node_id)`（对应 `node_offline.lua`）从 Pool 移除。

## 七、代码模块对照

| 功能 | 模块/文件 |
|------|------------|
| 注册与心跳处理 | `websocket/node_handler/message/register.rs` |
| 注册 Lua | `scripts/lua/register_node_v2.lua` |
| 心跳与 Pool | `pool/pool_service.rs`、`scripts/lua/heartbeat_with_pool_assign.lua` |
| 节点选择 | `pool/pool_service.rs`、`scripts/lua/select_node.lua` |
| 节点查询 | `node_registry/core.rs`、`node_registry/node_redis_repository.rs` |

详见 [ARCHITECTURE.md](../architecture/ARCHITECTURE.md)、[POOL.md](../architecture/POOL.md)。
