# 任务处理流程

**状态**: 当前实现

## 一、调度服务器端

### 1.1 任务创建

- 客户端经 WebSocket 发送音频/会话消息；SessionActor 在 Finalize 时调用 `create_translation_jobs()`。
- 流程：检查房间与幂等 → `create_job_with_minimal_scheduler()` → JobDispatcher 保存 Job 到 Redis（`lingua:v1:job:{job_id}`）→ `PoolService.select_node(src_lang, tgt_lang, job_id, turn_id)` 选节点 → 经 WebSocket 将任务发往节点。

**代码**: `websocket/session_actor/actor/actor_finalize.rs`、`websocket/job_creator.rs`、`core/dispatcher/job_management.rs`、`pool/pool_service.rs`。

### 1.2 任务状态

- Job 状态：Pending → Assigned → Processing → Completed / Failed（含 CompletedNoText 等）；状态存 Redis，多实例共享。

### 1.3 节点选择与绑定

- `select_node(src, tgt, job_id, turn_id_for_affinity)`：若有 job_id/turn_id，先查 job 或 turn 绑定，存在则返回已绑定节点；否则按有向语言对选 Pool 再随机选节点，并写绑定（Timeout Finalize 同节点）。

## 二、节点端（概要）

- 节点接收 JobAssignMessage，经 JobProcessor → runJobPipeline → ASR 步骤 → AudioAggregator（按 finalize 类型切分/缓冲）→ ASR 服务 → UtteranceAggregator / 聚合步骤 → 结果回传 Scheduler。
- **Finalize 类型**: MaxDuration（按最大时长切片）、手动（用户截断）、Timeout（静音超时）；每种在 AudioAggregator 与 ASR 调用顺序上略有不同，详见 Finalize 文档。

## 三、与 Pool、Finalize 的关系

- 任务按 (src_lang, tgt_lang) 选节点，与 Pool 有向语言对一致；Timeout/MaxDuration 下同一 turn 或同一长句的后续 job 通过 job/turn 绑定发往同一节点。
- Finalize 触发与类型见 [FINALIZE.md](../finalize/FINALIZE.md)。

详见 [ARCHITECTURE.md](../architecture/ARCHITECTURE.md)、[NODE_REGISTRY.md](../node_registry/NODE_REGISTRY.md)。
