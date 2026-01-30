# Integration Test 修复：逐文件最小 Patch 清单 + 回归 Checklist（v1）

> 适用范围：本修复聚焦 **AudioAggregator 的 MaxDuration 残段处理** 与 **空结果核销（shouldReturnEmpty）**，以解决集成测试中出现的：
>
> - MaxDuration finalize 残段与下一 job 合并后仍 < 5s 却被立即送 ASR，导致短音频识别差 + 结果归属错位
> - 某些 job 出现“有分配但无输出记录/空容器被核销”，造成 job 丢失
> - originalJobIds 头部对齐策略放大上述表象（本轮不改策略，仅增强可观测性）
>
> 设计原则：**不加保险层、不引入新控制流**；只将行为钉死为两条规则：  
> 1) “未达 ASR 最小累积时长 → 继续等待（带 TTL 强制 flush）”  
> 2) “空结果核销只能发生在‘确实无音频’场景”

---

## 0. 修复目标（可验收口径）

完成本 patch 后应满足：

1) **MaxDuration 残段合并后仍 < MIN_ACCUMULATED_DURATION_FOR_ASR_MS**：不得立即送 ASR；必须进入 pending（或继续 pending），直到补齐或 TTL 到期强制 flush。  
2) **TTL 强制 flush**：到期必须产出可解释的输出（reason 标记），并且不得造成 job 归属错位。  
3) **空结果核销**：仅允许在“输入音频确实为空（0ms）且无 segments”的情况下发生；ASR 失败/超时必须走可解释的 partial/missing 流程。  
4) **originalJobIds 策略不变**（仍以 batch 头部对齐），但必须通过日志/指标可解释：为何某些 job 没有独立输出。

---

## 1. 逐文件最小 Patch 清单

> 说明：文件路径根据你当前工程结构命名约定给出。若实际路径略有不同，用 `rg -n "<类名/函数名>" main/src` 即可快速定位。

---

### P0（必须）：MaxDuration 残段 + 合并后仍不足 5s → 继续等待（+ TTL 强制 flush）

#### 文件 1：`electron_node/electron-node/main/src/pipeline-orchestrator/audio-aggregator.ts`
**定位关键词**
- `pendingMaxDurationAudio`
- `MAX_DURATION`
- `MIN_ACCUMULATED_DURATION_FOR_ASR_MS`（或等价常量）
- `finalizeMaxDuration` / `flushMaxDuration` / `handleMaxDurationFinalize`
- `originalJobIds`

**最小改动 A：合并后时长判定前置**
在“MaxDuration finalize → 产生残段 pending → 与下一 job 合并”的代码路径里，新增一个统一判定：

- 计算 `mergedDurationMs`（pending + 当前新到音频）
- 若 `mergedDurationMs < MIN_ACCUMULATED_DURATION_FOR_ASR_MS`：
  - **不调用 ASR**
  - 将 `pendingMaxDurationAudio` 更新为合并后的 buffer
  - 记录 `pendingSinceMs`（若首次进入 pending）
  - 返回 Gate/Stage 层的动作：`HOLD_PENDING_MAXDUR`（或等价，不必新增枚举也可以直接 return）

> 关键点：这是“行为钉死”，不是兜底。不要再保留任何 “<5s 也送 ASR” 的旧分支。

**最小改动 B：TTL 强制 flush**
- 定义 `PENDING_MAXDUR_TTL_MS`（建议 10_000ms）
- 若 `nowMs - pendingSinceMs >= PENDING_MAXDUR_TTL_MS`：
  - 强制 flush 该 pending（即使 < MIN）
  - 调用 ASR 时必须带 `reason = FORCE_FLUSH_PENDING_MAXDUR_TTL`
  - 强制 flush 仅允许发生一次（flush 后清空 pending）

**最小改动 C：归属一致性（不改策略，仅防错位）**
- 在 flush/ASR request 中保留明确的 `ownerJobId`（仍为 originalJobIds[0] 或你现行策略）
- 增加日志字段：`ownerJobId`, `originalJobIds`, `mergedDurationMs`, `pendingDurationMs`, `reason`

---

### P1（必须）：收紧 shouldReturnEmpty / 空容器核销条件，避免 job 丢失

#### 文件 2：`electron_node/electron-node/main/src/pipeline-orchestrator/audio-aggregator.ts`
或（若你的项目分离了 finalize 逻辑）：
`electron_node/electron-node/main/src/pipeline-orchestrator/audio-aggregator-finalize.ts`

**定位关键词**
- `shouldReturnEmpty`
- `returnEmpty`
- `emptyResult`
- `noSegments`
- `segments.length === 0`
- `buffer.length === 0` / `durationMs === 0`
- `finalize`

**最小改动：空结果核销仅允许“确实无音频”**
将 `shouldReturnEmpty` 的判定改为同时满足（AND）：

1) `inputDurationMs == 0`（或 buffer 为空）  
2) `segments.length == 0`  
3) `pendingMaxDurationAudio 不存在`（防止把 pending 的问题吞掉）

否则：
- **不得返回 empty 并核销 job**
- 对于 “有音频但 ASR 失败/超时/返回空文本”：
  - 输出 `PARTIAL_FINALIZE` 或 `MISSING_ASR_RESULT`（不要求新增复杂结构，至少要保留可解释的 reason）

> 关键点：不要把“ASR 没回结果”与“无音频”混为一谈，否则会继续出现 job 丢失。

---

### P2（推荐）：增强可观测性（不改业务策略，不增加控制流）

#### 文件 3：`electron_node/electron-node/main/src/agent/postprocess/aggregation-stage.ts`
或发送侧组件：
`electron_node/electron-node/main/src/agent/aggregator-middleware.ts`

**定位关键词**
- `originalJobIds`
- `jobId`
- `send`
- `asrRequest`
- `dispatch`

**最小改动**
在发送到 ASR / 下游前统一打日志（结构化）：
- `ownerJobId`
- `originalJobIds`（数组长度）
- `audioDurationMs`
- `reason`（NORMAL / PENDING_MAXDUR_HOLD / FORCE_FLUSH_PENDING_MAXDUR_TTL / ASR_FAILURE_PARTIAL）
- `segmentsCount`
- `pendingMaxDurState`（none / holding / force_flush）

> 目的：你们不改 originalJobIds 头部对齐策略，但至少让“为什么某个 job 没输出”能从日志直接读出来。

---

## 2. 代码级完成标志（给 Code Review 用）

- [ ] 全局 grep：不存在 “合并后 < MIN 仍 send ASR” 的路径  
- [ ] `shouldReturnEmpty` 仅在 `durationMs==0 && segments==0 && noPending` 时成立  
- [ ] TTL 逻辑存在且只触发一次 flush  
- [ ] 新增 reason 字段/日志能覆盖：HOLD / FORCE_FLUSH / EMPTY / ASR_FAILURE_PARTIAL  
- [ ] 不新增任何“额外兜底分支”（保持控制流简洁）

---

## 3. 回归 Checklist（集成 + 单元）

> 建议按顺序执行。前三条是“必须回归”的最小闭环。

### R0（必跑）：MaxDuration 残段合并后仍不足 5s
- [ ] 场景：MaxDuration finalize 产生 pending 残段；与下一 job 合并后仍 < MIN（例如 2.6s/3.2s）  
- [ ] 期望：不送 ASR；进入 pending（reason=PENDING_MAXDUR_HOLD）  
- [ ] 期望：不会出现“短音频立即送 ASR → 文本归属错位 → 后续 job 无输出”

### R1（必跑）：MaxDuration 残段 + 补齐到 ≥5s 正常送 ASR
- [ ] 场景：pending + 下一个 job 合并后 ≥ MIN  
- [ ] 期望：送 ASR；输出归属符合 ownerJobId（按现行头部对齐策略）  
- [ ] 期望：文本不截断，后续 job 不出现缺失

### R2（必跑）：TTL 强制 flush（<5s 也必须出结果）
- [ ] 场景：pending 连续若干轮都未补齐，等待超过 TTL  
- [ ] 期望：触发一次 FORCE_FLUSH；送 ASR；输出 reason=FORCE_FLUSH_PENDING_MAXDUR_TTL  
- [ ] 期望：flush 后 pending 被清空，系统回到正常状态

### R3：ASR 失败 / 超时不应触发空核销
- [ ] 场景：输入音频 >0，但 ASR 返回失败/超时/空文本  
- [ ] 期望：不得走 `shouldReturnEmpty` 核销  
- [ ] 期望：输出 PARTIAL / MISSING 结果，且 job 不“消失”

### R4：真正无音频才允许 empty 核销
- [ ] 场景：inputDurationMs==0 且 segments==0  
- [ ] 期望：允许 empty result；且日志 reason=EMPTY_INPUT

### R5：originalJobIds 头部对齐可解释
- [ ] 场景：batch 含多 jobId  
- [ ] 期望：日志中明确输出 ownerJobId 与 originalJobIds  
- [ ] 期望：任何“某 job 无独立输出”的情况可从日志直接解释（归属策略所致，而非丢失）

---

## 4. 最小单元测试建议（不要求全量）

建议新增/更新以下 UT（任选一种框架）：

1) `mergePendingMaxDuration_thenStillBelowMin_shouldHold()`  
2) `mergePendingMaxDuration_thenReachMin_shouldSend()`  
3) `pendingMaxDuration_ttlForceFlush_shouldSendWithReason()`  
4) `asrFailure_withAudio_shouldNotReturnEmpty()`  
5) `trueEmptyInput_shouldReturnEmpty()`

---

## 5. 交付说明

- 本 patch 不涉及 UtteranceAggregator v3（该部分已完成且稳定）。
- 本 patch 不改变 originalJobIds 的业务策略，仅增强可观测性。
- 完成 R0/R1/R2 后即可确认“集成测试核心缺失/错位问题”已解决；其余回归用于锁定长期稳定性。

