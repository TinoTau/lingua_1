# 节点端 bufferKey 改造
## 最小 Patch 清单与 Tasklist（提交给开发部门）

> 本文档用于指导开发部门 **一次性解决 bufferKey / 重复逻辑 / 未来会议室冲突问题**。
> 原则：不考虑兼容、不新增流程路径、不引入兜底或补丁逻辑。

---

## 1. 改造背景与问题定位

当前代码状态（来自审议报告）：

- 主流程已使用 `buildBufferKey(job)` 生成 bufferKey
- 但 `clearBuffer(sessionId)` / `getBufferStatus(sessionId)` 仍将 sessionId 作为 key（临时兼容）
- 该兼容逻辑仅被测试调用，生产路径未使用

风险：
- sessionId 与 Job 语义不一致
- 未来引入会议室 / 多用户 / 多 Job 拼接后将出现清理错误或状态不可解释

---

## 2. 架构级决策（本次唯一决策点）

> **Job 是最小调度单位，因此节点端聚合 buffer 的唯一 key 必须是 jobId。**

最终契约：

- bufferKey := jobId（或 jobId 的不可逆映射）
- 节点端不再理解 sessionId / roomId / userId

---

## 3. 最小 Patch 清单（逐文件）

### P0（必须执行）

#### 3.1 buildBufferKey

**文件**：
- `main/src/pipeline-orchestrator/audio-aggregator-buffer-key.ts`

**修改**：
- `buildBufferKey(job)` 直接返回 `job.job_id`（协议字段为 snake_case `job_id`）
- 删除第二参数 `ctx`，不再拼接 sessionId / roomId / streamId
- **废弃并删除**：`parseBufferKey`、`BufferKeyContext`（无兼容，让错误调用暴露）

---

#### 3.2 AudioAggregator API 对齐

**文件**：
- `main/src/pipeline-orchestrator/audio-aggregator.ts`

**修改**：
- 删除旧 API：
  - `clearBuffer(sessionId)`
  - `getBufferStatus(sessionId)`
- 新增并统一使用：
  - `clearBufferByKey(bufferKey: string)`
  - `getBufferStatusByKey(bufferKey: string)`

**删除内容**：
- 所有 `const bufferKey = sessionId; // 临时兼容` 行

---

#### 3.3 测试文件同步修改

**涉及文件（示例）**：
- `audio-aggregator.test.ts`
- `audio-aggregator.legacy.test.ts`
- `audio-aggregator-optimization.test.ts`

**修改**：
- 将测试中使用的 `sessionId` 改为当前测试 Job 的 `jobId`
- 或统一使用 `buildBufferKey(job)` 生成 key

---

### P1（必须执行）

#### 3.4 文档与注释同步

- 在《重复逻辑及上下游流程》审议文档中：标注 sessionId 作为 bufferKey 的逻辑为 **已移除**，明确节点端 bufferKey = jobId，并引用本改造
- `audio-aggregator-buffer-key.ts` 文件头注释：明确 bufferKey = job.job_id（与会议室模式需求一致）
- 其他涉及 bufferKey/sessionId 的注释与文档与代码功能一致

---

## 4. Tasklist（开发执行步骤）

1. **Job 字段**：使用 `job.job_id`（JobAssignMessage 协议字段为 snake_case `job_id`）

2. 修改 `audio-aggregator-buffer-key.ts`：
   - `buildBufferKey(job)` 仅保留一个参数，返回 `job.job_id`
   - 删除 `parseBufferKey`、`BufferKeyContext` 的导出与实现（直接废弃，不考虑兼容）

3. 修改 `audio-aggregator.ts`：
   - 删除 `clearBuffer(sessionId)`、`getBufferStatus(sessionId)`
   - 新增 `clearBufferByKey(bufferKey: string)`、`getBufferStatusByKey(bufferKey: string)`
   - 删除所有 `const bufferKey = sessionId; // 临时兼容` 行

4. 修改所有测试：`clearBuffer`/`getBufferStatus` 改为使用测试 Job 的 `job_id` 或 `buildBufferKey(job)` 调用 `clearBufferByKey`/`getBufferStatusByKey`

5. 全仓 grep 校验（直接改造，让错误暴露）：
   - `clearBuffer(`、`getBufferStatus(`、`sessionId; // 临时兼容`、`parseBufferKey`、`BufferKeyContext` 无残留 ✅

6. 更新文档与注释（必须）：见 3.4 ✅

7. 运行单测与最小回归：AudioAggregator 相关测试全部通过 ✅
   - 测试用例中依赖「同一 session 共享 buffer」的已改为同一 job_id（同一 job 的两段 chunk），与 bufferKey=job_id 语义一致；optimization 中「bufferKey 稳定性」改为断言同一 job 稳定、不同 job 不同。
   - 执行命令：`jest main/src/pipeline-orchestrator/audio-aggregator*.test.ts`，18 例通过。
   - 代码简洁性：未新增兼容路径或兜底逻辑；bufferKey 仅来源于 job.job_id。

---

## 5. 明确不做的事项（防止控制流膨胀）

- 不做 session/room 级 buffer 扫描清理
- 不按 userId 连续拼接 buffer
- 不在节点端引入 turnId 语义（Session Affinity 仍使用 session_id，为「同一句话发给同一节点」的初版机制，本次不改）
- 不添加语言/会议室兜底逻辑

---

## 6. 交付结论

该 Patch 为 **一次性架构契约对齐**，
能在不增加复杂度的前提下：

- 消除重复与歧义逻辑
- 为会议室与多人抢话场景打下稳定基础
- 保证节点端代码长期可维护、可推理

执行完本 Tasklist 后，可进入会议室模式后续开发。

---

## 7. 可行性确认与待确认项（参考）

已根据《会议室模式_需求与架构设计》与当前代码对改造方案做可行性核对，结论为 **可行**；并列出需进一步确认或补充项（Job 字段名、Session Affinity 范围、parseBufferKey 处理、grep 与文档补充）。详见：  
**《节点端_buffer_key_改造_可行性确认与待确认项.md》**

## 8. Session Affinity / turnId 设计（决策审议）

调度端 Session Affinity 与会议室 turnId 对齐的设计方案（基于调度器实际代码、单一 Redis 字段、不增加控制流）见：  
**《docs/decision/Session_Affinity与turnId_设计方案_决策审议_2026_01.md》**

