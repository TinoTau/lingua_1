# Job 状态机状态映射关系

## 日期
2026-01-XX

## 一、设计文档要求

根据 `SCHEDULER_V4_1_F2F_POOL_AND_RESERVATION_DESIGN.md` 第7节：

### 状态定义
- `NEW`：创建任务
- `SELECTING`：候选选择中
- `RESERVED`：已对某节点预留成功（reserved+1）
- `DISPATCHED`：已向节点发送任务请求
- `ACKED`：节点确认接收（reserved->running）
- `DONE`：完成（running-1）
- `FAILED`：失败（running/reserved 回收完成）
- `RETRYING`：准备重试（attempt_id +1）

### 状态转换
正常路径：`NEW -> SELECTING -> RESERVED -> DISPATCHED -> ACKED -> DONE`

异常路径：
- `RESERVED -> FAILED`（发送失败/超时，释放 reserved）
- `DISPATCHED -> RETRYING`（ACK 超时，释放 reserved，再选新节点）
- `ACKED -> RETRYING`（节点 fail 回传，running-1，再选新节点，有限次数）

---

## 二、当前实现

### Phase 2 Job FSM 状态（Redis）
位置：`src/phase2/runtime_job_fsm.rs`

状态：
- `CREATED`：任务已创建
- `DISPATCHED`：已向节点发送任务请求
- `ACCEPTED`：节点确认接收（ACK）
- `RUNNING`：节点正在处理
- `FINISHED`：任务完成（成功或失败）
- `RELEASED`：资源已释放

### JobStatus 枚举（内存）
位置：`src/core/dispatcher/job.rs`

状态：
- `Pending`：待处理
- `Assigned`：已分配节点
- `Processing`：处理中
- `Completed`：已完成
- `Failed`：失败

---

## 三、状态映射关系

### Phase 2 Job FSM（Redis）映射

| 设计文档 | Phase 2 FSM | 说明 |
|---------|------------|------|
| `NEW` | `CREATED` | ✅ 对应 |
| `SELECTING` | （不存在） | ⚠️ 合并到 `CREATED` 阶段 |
| `RESERVED` | （不存在） | ⚠️ 合并到 `CREATED` 阶段 |
| `DISPATCHED` | `DISPATCHED` | ✅ 对应 |
| `ACKED` | `ACCEPTED` | ✅ 对应 |
| `RUNNING` | `RUNNING` | ✅ 对应（设计文档未明确，但逻辑存在） |
| `DONE` | `FINISHED` | ✅ 对应 |
| `FAILED` | `FINISHED` (success=false) | ⚠️ 通过 `finished_ok` 字段区分 |
| `RETRYING` | `CREATED` (attempt_id+1) | ⚠️ 通过重置到 `CREATED` 并递增 `attempt_id` 实现 |

### JobStatus（内存）映射

| 设计文档 | JobStatus | 说明 |
|---------|-----------|------|
| `NEW` | `Pending` | ✅ 对应 |
| `SELECTING` | `Pending` | ⚠️ 合并到 `Pending` |
| `RESERVED` | `Assigned` | ⚠️ 对应（已分配但未派发） |
| `DISPATCHED` | `Assigned` | ⚠️ 对应（已派发） |
| `ACKED` | `Processing` | ✅ 对应 |
| `RUNNING` | `Processing` | ✅ 对应 |
| `DONE` | `Completed` | ✅ 对应 |
| `FAILED` | `Failed` | ✅ 对应 |
| `RETRYING` | `Pending` 或 `Assigned` | ⚠️ 通过重置状态实现 |

---

## 四、状态转换验证

### 正常路径

**设计文档**: `NEW -> SELECTING -> RESERVED -> DISPATCHED -> ACKED -> DONE`

**当前实现**:
1. `CREATED` (Phase 2 FSM) / `Pending` (JobStatus) - 对应 `NEW`
2. `DISPATCHED` (Phase 2 FSM) / `Assigned` (JobStatus) - 对应 `DISPATCHED`
3. `ACCEPTED` (Phase 2 FSM) / `Processing` (JobStatus) - 对应 `ACKED`
4. `FINISHED` (Phase 2 FSM) / `Completed` (JobStatus) - 对应 `DONE`

**结论**: ✅ **基本一致**，`SELECTING` 和 `RESERVED` 阶段在实现中合并到 `CREATED`，这是合理的优化。

---

### 异常路径 1: RESERVED -> FAILED

**设计文档**: 发送失败/超时，释放 reserved

**当前实现**:
- 代码位置：`src/websocket/session_message_handler/utterance.rs`、`src/timeout/job_timeout.rs`
- 处理逻辑：
  1. 发送失败时：立即 `release_node_slot`，标记 `Failed`
  2. 超时时：`release_node_slot`，然后重试或标记 `Failed`

**结论**: ✅ **已实现**

---

### 异常路径 2: DISPATCHED -> RETRYING

**设计文档**: ACK 超时，释放 reserved，再选新节点

**当前实现**:
- 代码位置：`src/timeout/job_timeout.rs`
- 处理逻辑：
  1. 检测超时
  2. 发送 cancel 消息（best-effort）
  3. `release_node_slot`
  4. 选择新节点
  5. `reserve_node_slot`（新节点）
  6. 重新派发（`attempt_id + 1`）
  7. 重置 FSM 到 `CREATED`（通过 `job_fsm_reset_created`）

**结论**: ✅ **已实现**，通过重置到 `CREATED` 并递增 `attempt_id` 实现 `RETRYING`

---

### 异常路径 3: ACKED -> RETRYING

**设计文档**: 节点 fail 回传，running-1，再选新节点

**当前实现**:
- 代码位置：`src/websocket/node_handler/message/job_result/job_result_job_management.rs`
- 处理逻辑：
  1. 节点返回失败结果
  2. `dec_node_running`
  3. `job_fsm_to_finished` (success=false)
  4. 标记 `Failed` 或触发重试（如果 `failover_attempts < max`）

**结论**: ✅ **已实现**

---

## 五、结论

### ✅ 状态机实现基本符合设计文档

**映射关系**:
- ✅ 核心状态都有对应：`CREATED` ↔ `NEW`, `DISPATCHED` ↔ `DISPATCHED`, `ACCEPTED` ↔ `ACKED`, `FINISHED` ↔ `DONE`
- ⚠️ `SELECTING` 和 `RESERVED` 合并到 `CREATED`：这是合理的优化，不影响功能
- ⚠️ `RETRYING` 通过重置到 `CREATED` 并递增 `attempt_id` 实现：功能等价

**状态转换**:
- ✅ 正常路径：已实现
- ✅ 异常路径：已实现

**建议**: ✅ **无需修改**，当前实现符合设计文档的语义要求。

---

## 六、状态转换图

### 设计文档状态转换
```
NEW -> SELECTING -> RESERVED -> DISPATCHED -> ACKED -> DONE
  |        |           |            |           |
  |        |           |            |           +-> RETRYING
  |        |           |            +-> RETRYING
  |        |           +-> FAILED
  |        +-> FAILED
  +-> FAILED
```

### 当前实现状态转换
```
CREATED -> DISPATCHED -> ACCEPTED -> RUNNING -> FINISHED -> RELEASED
   |           |            |          |           |
   |           |            |          |           +-> CREATED (retry, attempt_id+1)
   |           |            |          +-> FINISHED (failed)
   |           |            +-> FINISHED (failed)
   |           +-> CREATED (retry, attempt_id+1)
   +-> FINISHED (failed)
```

**结论**: ✅ **功能等价**，实现方式不同但语义一致。
