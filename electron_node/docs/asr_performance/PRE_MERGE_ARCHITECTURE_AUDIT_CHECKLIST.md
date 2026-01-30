# 节点端架构审计 Checklist（合入前/回归后）

**目标**：允许复杂业务现象，但**禁止复杂控制流**（尤其禁止重复发送、隐式分支、补偿路径叠加）。  
**用法**：code review / 合入前审计时，按 A→F 逐条过；任一红线未通过则不得合入。

---

## A. 全局红线（任何模块都适用）

* [ ] **对外发送只有一个出口**：不得在 pipeline step、dispatcher callback、aggregator 内新增 `sendJobResult` / WebSocket send / HTTP reply 等 I/O。唯一发送点应在 `NodeAgent.handleJob` 的发送循环。
* [ ] **不得引入“补偿发送/重试发送/再次发送”路径**：不允许出现“发送失败再走另一条路发”“shouldSend=false 但额外发一个”这种隐式分支。
* [ ] **不得用 flag 控制流跳转**（例如 `originalJobResultsAlreadySent` 这类）：如确需状态，只能作为业务数据（结果字段）存在，不得改变发送路径数量。
* [ ] **任何“去重”只允许发生在一个层级**：要么在 ResultSender 内统一判定，要么在 NodeAgent 统一判定；不能两边都判定导致控制流变成“互相猜对方做了没做”。

---

## B. 模块 1：Job 容器管理（ctx → build → resultsToSend → send）

### B1. `buildResultsToSend(...)` 结构审计

* [ ] `NodeAgent.handleJob` 保持 **三段直线流**：`processJob → buildResultsToSend → for resultsToSend send`，中间不允许插入新的 if/else 分叉发送逻辑。
* [ ] `buildResultsToSend` 是**纯函数**：不读写全局状态，不访问网络，不写缓存，不调用 sender。只做列表构建。
* [ ] `resultsToSend` 的构建规则是**单一来源**：空容器核销只来自 `finalResult.extra.pendingEmptyJobs`，不得额外从别处拼装。
* [ ] `resultsToSend` 内不得出现**重复 job_id**（主 job_id 与 empty job_id 不得相同；empty 列表内部也不得重复）。如存在，必须在构建时去重或直接 fail-fast（prefer debug assert）。

### B2. 语义契约审计（避免隐式控制流）

* [ ] **明确并固定**：空容器核销是否受 `processResult.shouldSend` 约束（你当前定义为“受约束”就必须一直保持）。
* [ ] `NO_TEXT_ASSIGNED` 的结果不能被 sender 覆盖成 `ASR_EMPTY`（优先级必须写在 code comment 或测试里锁死）。
* [ ] `processResult.shouldSend=false` 时，系统行为必须“可一眼推断”：**到底是不发任何结果**，还是“仍要发核销类结果”。若两者并存，必须在 NodeAgent 层显式编码，而不是在 sender 内暗改。

---

## C. 模块 2：Utterance 聚合 + 语义修复（committedText 权威）

### C1. committedText 写点审计（禁止多写点竞争）

* [ ] committedText 的写点只有两类：
  * **聚合阶段**：写 `ctx.lastCommittedText` 作为**输入快照**
  * **语义修复阶段**：`updateLastCommittedTextAfterRepair` 作为**最终权威写回**
  * 禁止在其它 step 再写 committedText（哪怕“看起来方便”）。
* [ ] `updateLastCommittedTextAfterRepair(...)` 必须是 **单次调用**（每 job 最多一次），不得因重试/补偿触发二次更新。

### C2. 控制流审计（允许现象复杂，但链路必须直）

* [ ] `runAggregationStep` 每 job 只调用一次 `processUtterance` / `forwardMergeManager.processText`，不得在内部根据某些条件再次调用同一处理链。
* [ ] 语义修复 step 只能由 `shouldExecuteStep` 进入一次；不得引入“修复失败 → 再跑一次”的分支（如果要重试，应在任务系统里做，不在控制流里做）。

---

## D. 模块 3：AudioAggregator / AudioProcessor（热路径与重复计算）

### D1. 热路径观测审计（日志不准污染控制流）

* [ ] 在 `shouldReturnEmpty` 这类高频分支里：
  * 禁止调用 `getBufferStatus(...)` / 遍历 Map / 构造大对象仅用于日志
  * 允许 debug gating（`isDebugEnabled`）或采样，但**不能每次都算**。
* [ ] 日志必须是“可选观测”，不能影响分支数量（不得出现“为了记录某字段，新增一个 if 路径”）。

### D2. 计算冗余审计（避免隐式重计算）

* [ ] 禁止出现“只为了 `.length` 却调用 `aggregateAudioChunks()`”的模式；长度求和必须用 reduce。
* [ ] 同一函数内不得对同一 `audioChunks` 做两次全量聚合（除非明确说明并在注释中写出原因与复杂度）。

---

## E. ResultSender 侧（最容易长出复杂控制流的地方）

* [ ] ResultSender 只允许 **一次判定 → 一次发送 → 一次记录**：
  * 不允许“发送前后分别做两套去重/标记”
  * 不允许“失败 → 走备用发送路径”
* [ ] `dedupStage.markJobIdAsSent` 的语义必须清晰：是“本轮发送成功”还是“判定后视为已处理”。不能两种含义混用。
* [ ] reason 的优先级要固定：`NO_TEXT_ASSIGNED` 不能被 `ASR_EMPTY` 覆盖（这条建议写成单测锁死）。

---

## F. 必跑回归用例（最小集）

* [ ] **单 job 正常输入**：只回一次，非空文本，reason 正常
* [ ] **shouldSend=false**：确认是否仍需核销类结果（按你定义）
* [ ] **pendingEmptyJobs 存在**：核销结果正确，且不出现重复 job_id
* [ ] **ASR 空输入**：只回一次，reason=ASR_EMPTY
* [ ] **NO_TEXT_ASSIGNED**：只回一次，reason 不被覆盖
* [ ] **热路径压力**：大量短 chunk + 频繁 buffer return，不应因日志构造导致明显 CPU/延迟尖峰

---

**相关文档**  
- `DECISION_REVIEW_IMPLEMENTATION_2026_01_28.md` — 本次改动决策审议  
- `JOB_CONTAINER_MANAGEMENT_FLOW_DECISION_REVIEW.md` — Job 容器管理流程  
- `AUDIO_AGGREGATOR_FLOW_DECISION_REVIEW.md` — 音频聚合流程  
- `UTTERANCE_AGGREGATION_FLOW_DECISION_REVIEW.md` — 文本聚合流程  
