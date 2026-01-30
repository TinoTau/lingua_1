# Job 结果重复发送：现状与架构改动决策审议

**文档类型**：决策部门审议  
**日期**：2026-01-28  
**状态**：待审议  

---

## 一、现状与问题

### 1.1 现象

- 同一 `job_id` 会向调度端发送**两次**结果：第一次为**有内容**（ASR/聚合/语义修复/翻译/TTS 完整链路），第二次为**空结果**（`reason=ASR_EMPTY`）。
- 调度端可能出现「Duplicate job_result filtered」「result_type=empty」等告警或重复处理。

### 1.2 根因（简要）

| 环节 | 说明 |
|------|------|
| **发送点 1** | `asr-step.ts` 内：当 **original job** 的 `runJobPipeline` 完成后，调用 `services.resultSender.sendJobResult(originalJobMsg, result, ...)`，发送有内容结果（日志：「runAsrStep: Original job result sent to scheduler」）。 |
| **发送点 2** | `node-agent-simple.ts` 内：`processJob(job)` 返回后，调用 `this.resultSender.sendJobResult(job, processResult.finalResult, ...)`，发送的是 **container job** 的 `finalResult`。 |
| **为何第二次为空** | 当存在 `originalJobIds`（音频被分片并分配给 original job）时，ASR 结果在 asr-step 内已归并到 original job 并已发送；**container job 的 `ctx.asrText` 未被填充**，故 container 的 `finalResult.text_asr` 为空，被当作 ASR_EMPTY 再次发送。 |

即：**同一逻辑 job 存在两个发送路径**，且未约定「谁发、谁不发」，导致先发有内容、再发空。

### 1.3 历史背景：467aee4 引入的改动

- **Commit**：467aee4「fix bugs as a stable version」（2026-01-19）。
- **要解决的问题**：当 original job 有 `pendingMaxDurationAudio` 时，`finalizeOriginalJob` 返回 `false` 不触发回调，container 的 `ctx.asrText` 为空，误发空结果（Job1 文本丢失，见 `JOB1_JOB2_LOSS_ROOT_CAUSE.md`）。
- **当时采用的方案**：在 asr-step 内，当 original job 的 pipeline 完成时**立即**通过 `resultSender.sendJobResult(originalJobMsg, result, ...)` 发送结果，不再依赖 container 的 pipeline 填充 `ctx`。
- **未做的配套**：未取消或约束「processJob 返回后由 node-agent-simple 再发一次 container 的 finalResult」，也未约定「有 originalJobIds 时仅 asr-step 发送」。

因此，467aee4 解决了「original job 结果被误判为空」的问题，但**引入了「双发送点」**，从而产生重复发送。

---

## 二、当前已实施的修复（补丁式）

### 2.1 设计思路

- 不消除双发送点，而是**用标记约定**：当存在 `originalJobIds` 时，约定「结果由 asr-step 内 original job 路径发送，container 不再发送」。
- 在 container 的 `ctx` / `finalResult.extra` 上设置 `originalJobResultsAlreadySent = true`，node-agent-simple 若见到该标记则**不再调用** `sendJobResult`。

### 2.2 具体改动（3 处）

| 模块 | 文件 | 改动 |
|------|------|------|
| Pipeline ASR 步 | `pipeline/steps/asr-step.ts` | 进入 `if (originalJobIds.length > 0)` 时设置 `(ctx as any).originalJobResultsAlreadySent = true`。 |
| 结果构建 | `pipeline/result-builder.ts` | `buildJobResult` 中将该标记写入 `finalResult.extra.originalJobResultsAlreadySent`。 |
| 节点 Agent | `agent/node-agent-simple.ts` | 在「使用结果发送器发送结果」前，若 `processResult.finalResult.extra?.originalJobResultsAlreadySent === true` 则 `return`，不发送。 |

### 2.3 利弊

| 利 | 弊 |
|----|-----|
| 改动小、不动 ResultSender、不新增流程；逻辑集中、易定位。 | 本质是**补丁**：双发送职责仍在，仅用条件避免重复。 |
| 无兼容负担，不增加「保险层」。 | 若未来再增发送路径，需记得遵守同一约定，否则易再次重复。 |
| 行为明确：有 originalJobIds 时仅 asr-step 发，node-agent 不发。 | 依赖 `extra` 布尔标记在 pipeline 与 agent 间传递，类型未在接口中显式声明。 |

### 2.4 影响模块

| 模块 | 影响 |
|------|------|
| `pipeline/steps/asr-step.ts` | 增加 1 处对 ctx 的写标记。 |
| `pipeline/result-builder.ts` | `extra` 增加 1 个字段。 |
| `agent/node-agent-simple.ts` | 增加 1 处「若已发送则 return」判断。 |
| ResultSender、InferenceService、JobPipeline 其他步骤 | **无改动**。 |
| 调度端 / 协议 | **无改动**。 |

---

## 三、架构替代方案：单发送点

### 3.1 设计目标

- **唯一发送点**：仅 **node-agent-simple** 在 processJob 返回后调用 `sendJobResult`；**asr-step 不再调用** `resultSender.sendJobResult`。
- 所有结果（含 original job 的 pipeline 产出）均通过 **container 的 finalResult** 体现，由 node-agent 统一发一次。

### 3.2 需要的设计变更（概念）

1. **结果归属与回填**  
   - asr-step 内：original job 的 `runJobPipeline` 只负责**产出** result，**不发送**。  
   - 将该 result 以某种方式**回填到 container**（例如：当 container 与 single original job 同一 job_id 时，用该 result 作为 container 的 finalResult；或多 original 时合并/择一写入 container 的 ctx 或最终结果）。

2. **数据流**  
   - 保证在「processJob 返回」时，container 的 `finalResult` 已包含各 original job 的最终结果（或已明确「由谁代表发送」的约定），避免 container 的 `finalResult.text_asr` 为空。

3. **pendingMaxDurationAudio 的兼容**  
   - 467aee4 之前的问题（finalizeOriginalJob 返回 false 导致 ctx 为空）若仍存在，需在**单发送点**前提下单独解决（例如：在 dispatcher/回调侧保证在合适时机把文本写回 container 的 ctx，或通过其它方式让 container 的 finalResult 非空），而不是通过「asr-step 提前发送」规避。

### 3.3 利弊

| 利 | 弊 |
|----|-----|
| 架构清晰：**谁发结果**单一职责，无「两处都可能发」的约定。 | 改动面大：asr-step、结果回填路径、可能涉及 dispatcher/回调与 container ctx 的衔接。 |
| 无需在 pipeline 与 agent 间传递「是否已发送」的标记。 | 需重新梳理「original job 结果如何写入 container」的数据流，并处理多 original、空容器等边界。 |
| 后续新增发送逻辑时，只需在一个点扩展。 | 需确认并可能修改 pendingMaxDurationAudio 相关逻辑，避免 reintroduce Job1 丢失问题。 |

### 3.4 影响模块（预估）

| 模块 | 影响 |
|------|------|
| `pipeline/steps/asr-step.ts` | 移除对 `resultSender.sendJobResult` 的调用；增加将 original job 的 result 回填/合并到 container 的逻辑。 |
| `pipeline/result-builder.ts` | 可能需支持「来自 original job 的结果」写入 finalResult。 |
| `pipeline/context/job-context.ts` | 若用 ctx 承载回填结果，可能新增或复用字段。 |
| `pipeline-orchestrator/original-job-result-dispatcher.ts` | 可能与 asr-step 约定「回调仅产出 result，不发送」，或参与回填。 |
| `agent/node-agent-simple.ts` | 保持「唯一发送点」；当前「originalJobResultsAlreadySent」相关逻辑可删除。 |
| `inference/inference-service.ts` | 若不再在 asr-step 使用 resultSender，可评估是否仍需要 `setResultSender`（可能仍用于其它场景，需按实现确认）。 |

---

## 四、对比与审议要点

| 维度 | 当前补丁（已实施） | 单发送点重构 |
|------|---------------------|--------------|
| 改动量 | 小（3 处，约 10 行内） | 大（多模块、数据流与边界） |
| 架构清晰度 | 双发送点 + 约定标记 | 单一发送点，职责清晰 |
| 维护成本 | 依赖约定与文档，新路径需遵守 | 发送逻辑集中，易约束 |
| 风险 | 低（仅增加条件判断） | 中高（数据回填、pending 逻辑） |
| 是否「打补丁」 | 是 | 否 |

**建议审议点：**

1. **是否接受当前补丁作为长期方案？**  
   - 若接受：建议在类型/接口中显式声明 `extra.originalJobResultsAlreadySent`，并在设计文档中写明「有 originalJobIds 时仅 asr-step 发送」的约定。  
   - 若不接受：是否立项「单发送点」重构，并明确结果回填与 pendingMaxDurationAudio 的处理方式。

2. **若选单发送点，优先级与范围？**  
   - 例如：先做「asr-step 不再发送 + container 回填 single original result」，再考虑多 original 与空容器等。

3. **对「补丁」的容忍度？**  
   - 项目未上线、无历史用户的前提下，是优先「快速止血 + 小改动」还是「一次到位做架构统一」。

---

## 五、附录：相关文档与代码位置

| 内容 | 位置 |
|------|------|
| 按 job 维度的日志报告（含重复发送与 467aee4 说明） | `electron_node/electron-node/logs/docs/asr_performance/JOB_BY_JOB_REPORT_S62AC97B0.md` |
| Job1 文本丢失根因（467aee4 要解决的问题） | `electron_node/docs/asr_performance/JOB1_JOB2_LOSS_ROOT_CAUSE.md` |
| 当前补丁：asr-step 写标记 | `pipeline/steps/asr-step.ts` 约 99–101 行 |
| 当前补丁：result-builder 写 extra | `pipeline/result-builder.ts` 约 29–31 行 |
| 当前补丁：node-agent-simple 判断后 return | `agent/node-agent-simple.ts` 约 354–357 行 |

---

*以上为现状与架构改动的整理，供决策部门审议。*
