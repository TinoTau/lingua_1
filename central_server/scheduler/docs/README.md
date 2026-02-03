# Scheduler 文档索引

**更新日期**: 2026-02

Scheduler 文档按模块整理，仅保留与当前代码一致的内容；单文档不超过 500 行。

---

## 文档结构

### 架构

| 文档 | 说明 |
|------|------|
| [architecture/ARCHITECTURE.md](architecture/ARCHITECTURE.md) | 总体架构、核心模块、流程与配置 |
| [architecture/POOL.md](architecture/POOL.md) | Pool 有向语言对、Redis Key、注册/心跳/选节点 |

### 节点注册与管理

| 文档 | 说明 |
|------|------|
| [node_registry/NODE_REGISTRY.md](node_registry/NODE_REGISTRY.md) | 注册协议、心跳、Pool 分配、Session Affinity、节点下线 |

### 任务与音频

| 文档 | 说明 |
|------|------|
| [job/JOB.md](job/JOB.md) | 任务创建、节点选择与绑定、状态、与节点端流程概要 |
| [audio/AUDIO.md](audio/AUDIO.md) | 调度端与节点端音频处理、Buffer 与 Finalize 关系 |
| [finalize/FINALIZE.md](finalize/FINALIZE.md) | Finalize 类型与触发、服务端逻辑、配置、与 Session Affinity |
| [aggregator/AGGREGATOR.md](aggregator/AGGREGATOR.md) | 节点端 Aggregator 概念及与 Scheduler 的关系 |

---

## 推荐阅读顺序

1. [ARCHITECTURE.md](architecture/ARCHITECTURE.md) — 整体架构与模块
2. [POOL.md](architecture/POOL.md) — Pool 与 Redis Key
3. [NODE_REGISTRY.md](node_registry/NODE_REGISTRY.md) — 注册与心跳
4. [JOB.md](job/JOB.md) — 任务与选节点
5. [FINALIZE.md](finalize/FINALIZE.md) — Finalize 与分段

---

## 代码模块对照

| 文档 | 对应代码 |
|------|----------|
| 架构 | `src/services/minimal_scheduler.rs`、`src/pool/`、`src/node_registry/`、`src/redis_runtime.rs` |
| Pool | `src/pool/`、`scripts/lua/register_node_v2.lua`、`heartbeat_with_pool_assign.lua`、`select_node.lua` |
| 节点注册 | `src/websocket/node_handler/message/register.rs`、`src/pool/pool_service.rs` |
| 任务 | `src/websocket/job_creator.rs`、`src/core/dispatcher/`、`src/websocket/session_actor/actor/` |
| Finalize | `src/websocket/session_actor/actor/actor_finalize.rs`、`actor_event_handling.rs`、`actor_timers.rs` |
| 音频 | `src/managers/audio_buffer.rs`、`src/websocket/session_message_handler/` |

---

## 配置

- 主配置：`scheduler/config.toml`（server、scheduler.redis_runtime / phase2、Redis、Pool 相关、web_task_segmentation、job_timeout 等）。
- Redis Key 前缀与 TTL 见 [POOL.md](architecture/POOL.md)。
