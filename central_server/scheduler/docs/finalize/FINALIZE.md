# Finalize 处理机制

**状态**: 当前实现  
**代码**: `websocket/session_actor/actor/`

## 一、Finalize 类型与触发

| Reason | 类型 | 说明 |
|--------|------|------|
| `IsFinal` | Manual | 用户手动发送（is_final=true） |
| `Timeout` | Auto | 长时间无新 chunk（超过 pause_ms，计时器触发） |
| `MaxDuration` | Auto | 音频时长超过配置上限（如 10 秒），自动截断 |
| `MaxLength` | Exception | 缓冲区超过异常保护（如 500KB），保护性截断 |

**枚举**: `actor_types.rs` — `FinalizeType::Manual`、`Auto`、`Exception`；`from_reason("IsFinal"|"Timeout"|"MaxDuration"|"MaxLength")`。

## 二、调度服务器端触发逻辑

- **IsFinal**: 收到 chunk 时若 `is_final == true` 则立即 `try_finalize(..., "IsFinal")`。
- **Timeout**: 每次收到 chunk 重置计时器；若在 `pause_ms` 内无新 chunk，触发 `TimeoutFired` → `try_finalize(..., "Timeout")`。
- **MaxDuration**: 累计音频时长超过 `max_duration_ms` 时触发 `try_finalize(..., "MaxDuration")`。
- **MaxLength**: 缓冲区超过安全上限时触发，防止内存异常。

**代码**: `actor_event_handling.rs`（is_final 检查、超时处理）、`actor_timers.rs`（计时器）、`actor_finalize.rs`（try_finalize、create_translation_jobs）。

## 三、Finalize 后流程

1. 确定当前 utterance_index，调用 `do_finalize(utterance_index, reason)`。
2. 创建 Job：`create_translation_jobs()` → 幂等检查、写 Redis、`PoolService.select_node(..., job_id, turn_id)`（Timeout/MaxDuration 下同节点绑定）。
3. 将 Job 与音频发往所选节点；Session 侧推送结果给客户端。

## 四、节点端（概要）

- 节点根据 Job 中的 finalize 标识（isManualCut、isTimeoutTriggered、isMaxDurationTriggered）在 AudioAggregator 中决定何时将缓冲区送 ASR、何时清空/合并。
- MaxDuration：按最大时长切片送 ASR；Timeout/手动：立即处理当前缓冲区并送 ASR。

## 五、配置

- **pause_ms**: 静音超时（ms），触发 Timeout Finalize；默认见 `config.toml` 中 `web_task_segmentation.pause_ms`。
- **max_duration_ms**: 单段最大音频时长，触发 MaxDuration Finalize；见 `web_task_segmentation.max_duration_ms`。
- Edge stabilization（hangover/padding）见 config 中 `edge_stabilization`。

## 六、与 Session Affinity 的关系

- Timeout / MaxDuration 下，同一 turn 或同一长句的后续 job 通过 job_id/turn_id 绑定到同一节点，由 `select_node.lua` 与 `lingua:v1:job:{job_id}:node`、turn affinity 实现。详见 [NODE_REGISTRY.md](../node_registry/NODE_REGISTRY.md)、[JOB.md](../job/JOB.md)。
