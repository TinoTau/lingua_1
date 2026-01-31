# Session Affinity 与 turnId 设计方案 — 决策部门审议

**文档版本**：2026-01  
**适用范围**：调度服务器（central_server/scheduler）Session Affinity 与会议室 turnId 对齐  
**原则**：代码简洁、不增加控制流复杂度、以架构设计替代补丁

---

## 一、现状与问题

### 1.1 调度器实际代码行为

- **Redis 键**：`scheduler:session:{session_id}`（Hash）
- **写入**（`actor_finalize.rs`）：
  - MaxDuration finalize 时：`HSET scheduler:session:{session_id} max_duration_node_id {node_id}`（并 EXPIRE 5 分钟）
  - 手动/Timeout finalize 时：`HDEL scheduler:session:{session_id} timeout_node_id`（只删 timeout_node_id）
- **读取**（`scripts/lua/select_node.lua`）：
  - 仅读取 `HGET scheduler:session:{session_id} timeout_node_id`，若存在且节点在线且在候选池则选该节点

**结论**：当前 **MaxDuration 亲和未生效**。调度器写入的是 `max_duration_node_id`，而 select_node 只读 `timeout_node_id`，且代码中 **没有任何路径写入 timeout_node_id**，因此「同一 session 后续 job 路由到同一节点」仅依赖 job 级绑定（`lingua:v1:job:{job_id}:node`），不依赖 session 级。

### 1.2 Session Affinity 的目标（与节点端一致）

- 将 **同一 session 在 MaxDuration（及可选 Timeout）finalize 后的后续 job** 派发到 **同一节点**，保证长语音多段 chunk 在同一节点聚合，避免上下文丢失。
- 即「同一句话/本次发言发给同一节点」的保证，是 **turnId 机制的初版**。

### 1.3 节点端与调度端职责

- **节点端**：已按 bufferKey=job_id 改造；**SessionAffinityManager 已移除**，亲和路由完全由调度端决策，节点端不参与派发决策。
- **调度端**：负责派发时用 Redis 中的 turn/session→node 映射做亲和；当前实现存在上述「写一个 key、读另一个 key」的不一致。

---

## 二、设计原则

1. **单一数据源**：session 亲和只用一个 Redis 字段，读写一致，避免再出现「写 A 读 B」。
2. **不增加控制流**：不新增分支、不增加「先试 A 再试 B」的兜底链；选节点逻辑保持「有亲和用亲和，无则随机」。
3. **命名与语义清晰**：字段名直接表达「用于亲和路由的节点」，便于与会议室 turnId 概念对齐（同一 turn = 同一段连续发言，可对应多 job）。
4. **可选与会议室 turnId 对齐**：若后续协议引入 turn_id，可在此字段语义上扩展（例如 key 从 session_id 改为 turn_id），本次不强制改协议。

---

## 三、方案：统一 Session Affinity 字段并修正读写

### 3.1 统一 Redis 字段（推荐）

- **唯一字段名**：`affinity_node_id`（或保留 `timeout_node_id` 一名，由决策定名）。
- **含义**：该 session 上一段「需要亲和」的发言所使用节点；下一 job 若需亲和则优先选该节点。

**写入**（仅调度端，保持现有调用点）：

- MaxDuration finalize 时：`HSET scheduler:session:{session_id} affinity_node_id {node_id}`，并 `EXPIRE`（如 5 分钟）。
- 不在调度端为 Timeout finalize 写 session 级亲和（当前也没有）；若未来需要 Timeout 也亲和，可同一处写 `affinity_node_id`。

**清除**：

- 手动/Timeout finalize 时：`HDEL scheduler:session:{session_id} affinity_node_id`（与现清除 `timeout_node_id` 的逻辑一致，仅字段名改为 `affinity_node_id`）。

**读取**（select_node.lua）：

- 将当前对 `timeout_node_id` 的 `HGET` 改为对 `affinity_node_id` 的 `HGET`，其余逻辑不变（存在且在线且在候选池则选该节点）。

这样：

- 只改字段名与读写对齐，**不增加分支**；
- MaxDuration 亲和立即生效，长语音多 job 会稳定落到同一节点。

### 3.2 与「turnId」的关系

- **当前协议**：无 turn_id，仅有 session_id、utterance_index、job_id。
- **语义对齐**：可把「同一 session 内、需要连续路由到同一节点的一段发言」视为一个 **turn**；当前用 session_id 作为这段发言的聚合键，等价于「单 session 单 turn」的初版。
- **后续扩展**：若会议室引入显式 turn_id，可在此方案基础上把 Redis key 或 Hash 子键从 session_id 改为 turn_id（或 session_id+turn_id），**不改变「单一字段、先读后选」的结构**，控制流仍保持简单。

---

## 四、具体改动清单（调度端）

| 位置 | 当前 | 改动 |
|------|------|------|
| `actor_finalize.rs`（MaxDuration 写） | `HSET ... max_duration_node_id` | 改为 `HSET ... affinity_node_id`（或决策后的统一字段名） |
| `actor_finalize.rs`（手动/Timeout 清除） | `HDEL ... timeout_node_id` | 改为 `HDEL ... affinity_node_id` |
| `scripts/lua/select_node.lua` | `HGET session_key "timeout_node_id"` | 改为 `HGET session_key "affinity_node_id"` |
| `minimal_scheduler.rs`（若有 fallback 日志） | 日志中 `timeout_node_id` | 改为 `affinity_node_id`，仅文案一致 |

**不做的改动**：

- 不增加「先读 timeout_node_id 再读 max_duration_node_id」等兜底逻辑；
- 不新增配置开关或额外分支；
- 节点端已移除 SessionAffinityManager，亲和完全由调度端 Redis 与 select_node 实现。

---

## 五、测试与验收

- **单元/集成**：在现有调度器测试中，构造 MaxDuration finalize 后再次派发同一 session 的 job，断言第二次派发到的 node_id 与第一次一致（且 Redis 中 `affinity_node_id` 已写入）。
- **回归**：手动/Timeout finalize 后派发，应不再命中亲和节点（`affinity_node_id` 已清除）。

---

## 六、决策要点

1. **是否采纳「单一 Redis 字段」**：统一为 `affinity_node_id`（或保留 `timeout_node_id` 一名并让 MaxDuration 也写该字段），并让 select_node 只读该字段。
2. **字段最终命名**：`affinity_node_id` 与 `timeout_node_id` 二选一（或其它一致命名），调度端写、读、删、日志均使用同一名称。
3. **是否在本文档中正式引入「turn」术语**：在注释/文档中将「同一 session 需连续路由的一段发言」称为 turn，与会议室 turnId 对齐，代码层面可不改协议。

完成上述决策后，可按第四节清单实施，并做一次调度端单测/回归与节点端联调验证。
