# Pool 架构（有向语言对 + Lua）

**状态**: 当前实现

## 核心概念

- **有向语言对**: `zh:en` 与 `en:zh` 为两个不同 Pool；src = ASR 语言，tgt = Semantic 语言（池分配与任务查找一致）。
- **笛卡尔积**: 节点加入所有 **(ASR × Semantic)** 的 Pool；心跳时由 `heartbeat_with_pool_assign.lua` 自动分配。
- **分片**: 每语言对 0–999 个 Pool，每 Pool 最多 100 节点；超 100 自动建新 Pool。

## Redis Key

| Key | 类型 | 说明 |
|-----|------|------|
| `lingua:v1:node:{node_id}` | Hash | asr_langs, semantic_langs, tts_langs, last_heartbeat_ts；TTL 3600 |
| `lingua:v1:pool:{src}:{tgt}:{pool_id}:nodes` | Set | 节点 ID 列表；TTL 3600 |
| `lingua:v1:node:{node_id}:pools` | Hash | "{src}:{tgt}" → pool_id |
| `lingua:v1:job:{job_id}:node` | String | Timeout finalize 绑定；TTL 3600 |
| `lingua:v1:nodes:all` | Set | 所有节点 |

## 注册与心跳

1. **注册**: `register_node_v2.lua` — 写入 node Hash、EXPIRE、SADD nodes:all。
2. **心跳**: `heartbeat_with_pool_assign.lua` — 读 asr_langs/semantic_langs，生成有向语言对，为每对找未满 Pool 并 SADD + 写 node:pools。

## 节点选择

`select_node.lua` 输入：pair_key（如 `zh:en`）、job_id（可选）。逻辑：若 job_id 存在则先查 `lingua:v1:job:{job_id}:node` 绑定；否则遍历非空 Pool，随机选 Pool 再 SRANDMEMBER 选节点；若有 job_id 则 SET 绑定。

**Timeout finalize**: 同一 job 后续任务带相同 job_id，返回已绑定节点。

## 配置与代码

- Pool 参数在 Lua 中：`MAX_POOL_SIZE=100`，`MAX_POOL_ID=999`；TTL 3600。
- 代码：`pool/pool_service.rs`、`pool/types.rs`、`scripts/lua/heartbeat_with_pool_assign.lua`、`select_node.lua`、`register_node_v2.lua`。

## 故障与监控

- 节点离线：TTL 过期后 Redis 自动删除 node 与 pool 相关 key，无需手动清理。
- 监控：`KEYS lingua:v1:pool:*:nodes`、`SCARD` 各 Pool、`HGETALL node:pools`。

详见 [ARCHITECTURE.md](ARCHITECTURE.md)。
