# 节点端 bufferKey 改造 — 可行性确认与待确认/补充项

**文档版本**：2026-01  
**依据**：  
- 需求与架构：`docs/webapp/会议室模式_需求与架构设计.md`（bufferKey = jobId，节点端不理解 sessionId/roomId/userId）  
- 改造方案：`electron_node/docs/节点端_buffer_key_最小patch与tasklist.md`  
- 实际代码：`electron_node/electron-node/main/src` 及相关 shared 协议

---

## 一、结论摘要

| 维度 | 结论 |
|------|------|
| **改造方案可行性** | **可行**。P0 清单（buildBufferKey→jobId、clearBufferByKey/getBufferStatusByKey、测试同步）与当前代码一致，无阻塞冲突。 |
| **与会议室需求对齐** | **一致**。需求文档第 8 节「bufferKey = jobId（或其不可逆映射）」与最小 patch 的「bufferKey := jobId」一致；明确不做「session/room 级 buffer 扫描」与 tasklist 第 5 节「明确不做」一致。 |
| **需进一步确认或补充** | 见第二节：Session Affinity 是否纳入本次、parseBufferKey/BufferKeyContext 处理方式、Job 字段名与类型、测试用例 key 策略。 |

---

## 二、可行性逐项确认

### 2.1 协议与字段（Job ID）

- **实际代码**：`shared/protocols/messages.ts` 中 `JobAssignMessage` 使用 **`job_id: string`**（snake_case）。
- **改造方案**：要求「buildBufferKey(job) 直接返回 jobId」；Tasklist 第 1 步要求「确认 JobAssignMessage 中是 jobId 还是 job_id」。
- **结论**：实现时使用 **`job.job_id`** 即可；若希望对外命名统一为「jobId」，可在文档/注释中注明「jobId 即协议字段 job_id」。

**建议补充**：在 tasklist 或实现说明中明确写「bufferKey = job.job_id」（避免误用 jobId 属性名导致编译错误）。

---

### 2.2 buildBufferKey 改造

- **当前实现**：`audio-aggregator-buffer-key.ts` 中 `buildBufferKey(job, ctx?)` 以 `session_id` 为基础，拼接 `room_code`、`input_stream_id`/`speaker_id`、`target_lang` 等。
- **改造后**：仅返回 `job.job_id`，不再拼接任何 session/room/stream 信息。
- **影响**：
  - **调用方**：`audio-aggregator.ts` 仅在 `processAudioChunk` 与 `getBuffer(job)` 中调用 `buildBufferKey(job)`，无传 `ctx` 的必要性；改为 `return job.job_id` 后，两处调用无需改参数，仅行为从「复合 key」变为「jobId」。
  - **第二参数 `ctx`**：可删除或保留为可选未使用参数（保留则需在注释中注明「已废弃，仅为兼容保留」）。建议 **删除**，与「不考虑兼容」原则一致。
- **结论**：可行；建议实现时删除 `ctx` 参数并更新函数注释/文档。

---

### 2.3 AudioAggregator API（clearBuffer / getBufferStatus）

- **当前**：`clearBuffer(sessionId: string)`、`getBufferStatus(sessionId: string)`，内部 `const bufferKey = sessionId;  // 临时兼容`。
- **改造后**：删除上述两 API；新增 `clearBufferByKey(bufferKey: string)`、`getBufferStatusByKey(bufferKey: string)`，入参即 Map 的 key（改造后为 jobId）。
- **调用方**：grep 结果仅 **测试文件** 调用：`audio-aggregator.test.ts`、`audio-aggregator.legacy.test.ts`、`audio-aggregator-optimization.test.ts`；生产路径无调用。
- **结论**：可行；测试改为使用「当前测试 Job 的 job_id」或 `buildBufferKey(job)` 得到 key 即可。

---

### 2.4 测试同步修改

- **改造方案**：将测试中使用的 `sessionId` 改为当前测试 Job 的 `jobId`，或统一使用 `buildBufferKey(job)`。
- **实际**：测试中多为 `clearBuffer('test-session-xxx')`、`getBufferStatus('test-session-1')`；测试 Job 构造处有 `job_id`（如 `job_id: 'job-1'` 等）。改为 `clearBufferByKey(job1.job_id)` 或 `clearBufferByKey(buildBufferKey(job1))` 即可，且改造后 `buildBufferKey(job1) === job1.job_id`。
- **结论**：可行；需在测试中显式构造带 `job_id` 的 job，并在 afterEach/清理处使用该 job 的 `job_id` 调用 `clearBufferByKey`。

---

### 2.5 内部逻辑与类型

- **buffers Map**：当前 `Map<string, AudioBuffer>`，key 为 buildBufferKey 返回值；改造后 key 即 jobId，类型不变。
- **AudioBuffer**：仍含 `bufferKey: string`、`sessionId: string` 等字段；`bufferKey` 存当前 key（改造后即 jobId），`sessionId` 仍可来自 `job.session_id` 用于日志或 Session Affinity，无需删除。
- **createEmptyBuffer**：入参已包含 `bufferKey`、`sessionId`；调用方（audio-aggregator）传入的 `bufferKey` 改为 jobId 后即可，无需改 createEmptyBuffer 签名。
- **cleanupExpiredBuffersFromMap**：按 `buffers.entries()` 迭代，key 即 bufferKey（改造后为 jobId），逻辑无依赖 sessionId 拼接形式，无需改。
- **结论**：内部逻辑与类型与改造兼容，无冲突。

---

## 三、需进一步确认或补充的事项

### 3.1 Session Affinity 用途确认（已确认，本次不改）

- **实际代码**：  
  - 节点端：`SessionAffinityManager` 在 **Timeout finalize** 与 **MaxDuration finalize** 时记录 `sessionId→nodeId`（`recordTimeoutFinalize(job.session_id)`、`recordMaxDurationFinalize(job.session_id)`）。  
  - 调度端：`central_server/scheduler` 在 `actor_finalize.rs` 中 MaxDuration finalize 时记录 sessionId→nodeId 到 Redis；`pool_selection.rs` 根据 `enable_session_affinity` 做 hash-based 或随机选择。
- **用途**：将 **同一 session 的后续 job**（尤其是 MaxDuration 切分后的多段长语音）路由到 **同一节点**，避免同一段话被分配到不同节点导致上下文丢失。即「同一句话/本次发言发给同一节点」的保证，是 **turnId 机制的初版**。
- **结论**：Session Affinity 为长语音完整性所必需，**本次 bufferKey 改造不修改** Session Affinity（仍使用 `job.session_id` 记录与查询）；bufferKey 与 Session Affinity 解耦：buffer 的 key 用 jobId，亲和仍用 session_id。若后续需要与会议室 turnId 对齐，可单独做 turnId 机制设计与审议。

---

### 3.2 parseBufferKey / BufferKeyContext（已决：直接废弃）

- **决策**：直接废弃，不考虑兼容，让错误调用暴露。  
- **实施**：删除 `parseBufferKey` 与 `BufferKeyContext` 的导出及实现；若无其他引用即可移除，若有引用将导致编译错误，由调用方一并删除或改为直接使用 bufferKey（即 jobId）。

---

### 3.3 全仓 grep 校验项（已决：直接改造）

- **决策**：直接改造，不考虑兼容，让错误调用 API 的问题暴露（编译或单测失败）。  
- **实施**：改造后全仓 grep `clearBuffer(`、`getBufferStatus(`、`sessionId; // 临时兼容`、`parseBufferKey`、`BufferKeyContext`，确保无残留；若有则修复或删除。

---

### 3.4 文档与注释（必须执行）

- **要求**：更新文档和注释，确保文档与代码功能一致。  
- **实施**：  
  - `audio-aggregator-buffer-key.ts` 文件头注释明确「bufferKey = job.job_id（与会议室模式需求一致）」；  
  - 《重复逻辑及上下游流程_决策审议_2026_01.md》中标注 sessionId 作为 bufferKey 的逻辑为 **已移除**，明确节点端 bufferKey 的最终定义（jobId），并引用本改造；  
  - 其他涉及 bufferKey/sessionId 的注释与文档同步更新。  

---

## 四、与需求文档的对照

| 需求文档（会议室模式） | 最小 patch / tasklist | 结论 |
|------------------------|------------------------|------|
| bufferKey = jobId（或其不可逆映射） | buildBufferKey(job) 直接返回 jobId | 一致 |
| 节点端不保存房间成员表、不做 Room/User→Node 长期绑定 | 明确不做 session/room 级 buffer 扫描、不按 userId 连续拼接 | 一致 |
| Job 为最小调度单位 | bufferKey := jobId，节点端不再理解 sessionId/roomId/userId（就 **buffer 的 key** 而言） | 一致；Session Affinity 是否仍用 session_id 见 3.1 |
| 明确不做 session/room 级 buffer 扫描与聚合 | 明确不做 session/room 级 buffer 扫描清理 | 一致 |

---

## 五、实施顺序建议（与 tasklist 对齐）

1. **确认**：Job 字段使用 `job.job_id`；在方案或实现说明中写明。  
2. **P0**：修改 `buildBufferKey(job)` 为 `return job.job_id`，并删除第二参数 `ctx`（及更新类型/注释）。  
3. **P0**：AudioAggregator 删除 `clearBuffer(sessionId)`、`getBufferStatus(sessionId)`，新增 `clearBufferByKey(bufferKey)`、`getBufferStatusByKey(bufferKey)`，删除所有「const bufferKey = sessionId; // 临时兼容」。  
4. **P0**：三个测试文件中，所有 `clearBuffer('...')` / `getBufferStatus('...')` 改为使用对应测试 Job 的 `job_id` 或 `buildBufferKey(job)` 调用新 API。  
5. **校验**：全仓 grep `clearBuffer(`、`getBufferStatus(`、`sessionId; // 临时兼容`，确认无残留；运行 AudioAggregator 相关单测及最小回归。  
6. **P1**：文档与注释更新；parseBufferKey/BufferKeyContext 按 3.2 择一处理；Session Affinity 范围按 3.1 在决策中明确。

---

## 六、总结

- **改造方案在现有代码下可行**，且与会议室模式需求文档一致；P0 可按《节点端_buffer_key_最小patch与tasklist.md》执行。  
- **建议在实施前或同期**：  
  1. 明确 **Session Affinity** 是否仍使用 session_id、是否纳入本次改造（建议本次不改）。  
  2. 在 tasklist 或实现说明中 **明确 job_id 字段名** 与 `parseBufferKey`/BufferKeyContext 的处理方式。  
  3. 实施后做一次 **全仓 grep 与单测/回归**，并按 P1 更新文档与注释。

完成上述确认与补充后，即可按 tasklist 推进并交付。

---

## 七、改造实施与测试记录（2026-01）

- **改造完成项**：buildBufferKey→job_id、parseBufferKey/BufferKeyContext 已删除、clearBufferByKey/getBufferStatusByKey 已上线、测试已改为 job_id/同一 job 两段 chunk 语义，文档与注释已更新。
- **单元测试**：`jest main/src/pipeline-orchestrator/audio-aggregator*.test.ts` 共 18 例全部通过（3 个测试文件）。
- **代码简洁性**：未新增兼容路径或兜底逻辑；bufferKey 仅来源于 `job.job_id`，clear/get 仅按 bufferKey 操作，无额外分支。
- **功能测试**：节点端重新编译并启动后，可由人工或 E2E 做会话/长语音流程验证；自动化功能测试脚本见 `run-aggregation-tests.ps1`、`test:aggregator`（按项目现有脚本执行）。

---

## 八、本次改造是否还有必须项；可选简化

- **必须项**：无。节点端 bufferKey 改造与调度端 Turn 亲和改造均已完成，未新增多余分支或兼容链，逻辑与文档一致。
- **可选简化（非必须）**：  
  **节点端 `SessionAffinityManager`** 与 **调度端 Turn 亲和（Redis `scheduler:turn:{turn_id}`）** 职责重叠。派发决策完全在调度端（select_node 读 Redis）；节点端仅在本机记录 `sessionId→nodeId`，其 `getNodeIdForTimeoutFinalize` / `getNodeIdForMaxDurationFinalize` / `shouldUseSessionAffinity` **在生产代码中未被任何逻辑调用**，即不参与路由或业务决策。若希望进一步收口、避免“两处维护同一语义”，可考虑**移除节点端 SessionAffinityManager**（删除类及其在 audio-aggregator、finalize-handler、maxduration-handler、timeout-handler、node-agent-simple 中的调用与测试 mock），由调度端单一负责亲和。此为架构简化选项，非本次必须改造；若不删，现有行为与正确性不受影响。
