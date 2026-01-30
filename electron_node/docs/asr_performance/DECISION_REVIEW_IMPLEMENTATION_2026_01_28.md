# 本次改动决策审议文档（2026-01-28）

**范围**：按决策部门反馈对「单容器 / 单发送点」架构所做的最小改动（模块一至三）。  
**目的**：供决策部门审议「改了什么、为何这样改」，确认无新增分支、无新增 API、无兼容逻辑。

---

## 1. 改动背景

- **架构前提**：节点端已实现「收到 job → 建唯一 jobResult 容器 → AudioAggregator 切片 → ASR → 文本按序拼接 → 语义修复 → NMT → TTS」单容器、单路径；仅 node-agent 根据 `resultsToSend` 循环 `sendJobResult`。
- **决策部门反馈**：在保持上述架构前提下做**最小改动**——语义显式化、权威写点注释、热路径减负；不新增控制流分支、不新增对外 API、不引入兼容逻辑。

---

## 2. 按模块改动清单

### 2.1 模块一：Job 容器管理（resultsToSend 语义显式化）

| 项目 | 内容 |
|------|------|
| **文件** | `electron_node/electron-node/main/src/agent/node-agent-simple.ts` |
| **改动要点** | 1）新增模块级纯函数 `buildResultsToSend(job, processResult)`，返回 `ResultToSendItem[]`；2）在函数上方增加设计公理注释；3）`handleJob` 收束为：`processResult = await processJob(...)` → `resultsToSend = buildResultsToSend(job, processResult)` → `for ... sendJobResult`；4）导出类型 `ResultToSendItem`。 |
| **设计公理（注释原文）** | 空容器核销是否受 shouldSend 约束——当前受约束（仅当 shouldSend 为 true 时才追加空容器项）。reason 契约：空容器核销使用 NO_TEXT_ASSIGNED，sender 侧不得覆盖为 ASR_EMPTY。 |

**未做**：未新增分支、未新增对外 API；逻辑与改造前行为一致，仅提炼为纯函数并显式注释。

---

### 2.2 模块二：Utterance / committedText 权威写点注释

| 项目 | 内容 |
|------|------|
| **文件 1** | `electron_node/electron-node/main/src/pipeline/steps/aggregation-step.ts` |
| **改动要点** | 在写 `ctx.lastCommittedText` 处增加注释：此处为**输入快照**（只读），非最终写回点；最终权威写回在语义修复后 `updateLastCommittedTextAfterRepair`。 |
| **文件 2** | `electron_node/electron-node/main/src/pipeline/steps/semantic-repair-step.ts` |
| **改动要点** | 在调用 `updateLastCommittedTextAfterRepair` 前增加注释：**committedText 的最终权威写点**仅在此；禁止其它 step 再写 committedText，除非设计变更。 |

**未做**：未改变任何读写逻辑；仅通过注释固定「聚合=输入快照、语义修复后=最终写回」的契约，便于后续维护与审议。

---

### 2.3 模块三：AudioAggregator 热路径（getBufferStatus 移出热路径）

| 项目 | 内容 |
|------|------|
| **文件** | `electron_node/electron-node/main/src/pipeline-orchestrator/pipeline-orchestrator-audio-processor.ts` |
| **改动要点** | 当 `chunkResult.shouldReturnEmpty` 时：原 `logger.info(..., bufferStatus: getBufferStatus(...))` 改为 `logger.debug(...)`，且该分支内**不再传入 bufferStatus、不再调用 getBufferStatus**。 |
| **设计意图** | 缓冲返回分支为热路径；将日志降级为 debug 并移出 getBufferStatus 调用，减少热路径开销，且不改变业务行为。 |

**未做**：未删除 `getBufferStatus` 方法（仍可供调试或非热路径使用）；未改变 `shouldReturnEmpty` 的语义与返回值。

---

## 3. 设计公理与契约汇总

| 主题 | 契约内容 |
|------|----------|
| **空容器核销与 shouldSend** | 仅当 processResult.shouldSend 为 true 时才向 resultsToSend 追加空容器项；空容器项 reason 固定为 NO_TEXT_ASSIGNED。 |
| **NO_TEXT_ASSIGNED** | 空容器核销的 result.extra.reason 为 NO_TEXT_ASSIGNED；sender 侧不得将其改为 ASR_EMPTY。 |
| **committedText 权威写点** | 聚合阶段只写 ctx.lastCommittedText 作为输入快照；最终写回 committedText 仅允许在语义修复阶段通过 updateLastCommittedTextAfterRepair；禁止其它 step 再写。 |
| **getBufferStatus 与热路径** | 缓冲返回分支（shouldReturnEmpty）内不调用 getBufferStatus；该分支日志为 logger.debug，不传 bufferStatus。 |

---

## 4. 明确未做事项

- **未新增控制流分支**：仅收束 handleJob 为 process → build list → send loop，未增加 if/else 或新路径。
- **未新增对外 API**：`buildResultsToSend` 为模块内纯函数，仅导出类型 `ResultToSendItem` 供类型使用。
- **未做兼容逻辑**：无对旧协议、旧字段的兼容处理；行为与改造前一致，仅语义显式化与热路径减负。

---

## 5. 建议回归点

供决策部门或测试确认下列场景行为符合预期：

| 场景 | 预期 |
|------|------|
| **shouldSend=false 且存在空容器** | 仅发送主 result（一条）；不发送空容器核销项。 |
| **shouldSend=true 且存在 pendingEmptyJobs** | resultsToSend 含主 result + 各空容器项；空容器项 reason 为 NO_TEXT_ASSIGNED，sender 不改为 ASR_EMPTY。 |
| **语义修复执行 / 跳过** | 执行时仅在 semantic-repair-step 内调用 updateLastCommittedTextAfterRepair；聚合阶段只写 ctx.lastCommittedText 作输入快照。 |
| **缓冲返回（shouldReturnEmpty）** | 热路径不调用 getBufferStatus；该分支仅打 logger.debug，功能与改造前一致。 |

---

## 6. 相关流程审议文档

本次改动依托的流程与设计见以下三份文档，供交叉查阅：

- `AUDIO_AGGREGATOR_FLOW_DECISION_REVIEW.md` — 音频聚合（job→ASR）流程
- `UTTERANCE_AGGREGATION_FLOW_DECISION_REVIEW.md` — 文本聚合（ASR→语义修复）流程
- `JOB_CONTAINER_MANAGEMENT_FLOW_DECISION_REVIEW.md` — Job 容器管理（建容器→构建→发送）流程

---

**文档版本**：2026-01-28  
**状态**：待决策部门审议
