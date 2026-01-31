# 节点端 turnId 合并技术方案（补充冻结版）

> 本文档用于**补充并冻结**当前节点端 turnId 合并方案中的关键约束与取舍，
> 作为开发部门实现与 code review 的**唯一技术依据**。
>
> 目标：
> - 解决 MaxDuration 切分导致的 Job 丢失 / 前半句丢失问题
> - 在不引入复杂控制流、不增加补丁链的前提下，稳定支持长音频输入
> - 为后续「完整合并 → 完整语义修复 → 完整翻译」预留清晰演进路径
>
> **与架构裁决的关系**：本方案允许节点端按 turnId + targetLang 合并，需决策部门**修订**《取消跨 Job 前向合并》裁决（允许调度附带 turn_id、节点端仅按 turn_id + targetLang 合并）后实施。

---

## 1. 已冻结的前提假设（不再讨论）

1. **Job 是调度服务器的最小调度单位**
2. 单个用户的长音频发言必然存在，且会被调度服务器按 MaxDuration 切分为多个连续 Job
3. turnId 表示：
   - 来自**同一个 web 端用户（speaker）**
   - **一次连续发言容器**
   - 只会被 `manual finalize` 或 `timeout finalize` 结束
4. 会议室中其他用户的发言 **不会影响** 当前 speaker 的 turnId
5. 不存在并行重试、也不存在同一任务跨节点处理的情况

---

## 2. 节点端合并的总体结论

在上述前提成立的情况下：

> **将调度服务器生成的 turnId 下放至节点端，用于合并 MaxDuration 切分产生的连续 Job，是可行且合理的。**

该方案用于解决：
- Job2 前半句丢失
- MaxDuration 导致的跨 Job 语义断裂

并且不会引入多人插话干扰或节点端并发写问题。

---

## 3. 合并 Key 的最终定义（坑 1 的冻结结论）

### 3.1 合并 Key 不能只有 turnId

原因：
- 同一 turn 会 fan-out 成多个 targetLang 的 Job
- 在节点资源受限或部署方式变化时，**不同语言 Job 可能共用同一节点进程**

### 3.2 最终冻结的合并 Key

```text
mergeKey = turnId + targetLang
```

含义：
- 同一 speaker、同一次发言、同一目标语言，才会共享合并状态
- 不同 targetLang 之间严格隔离

**实现**：targetLang 使用 job_assign 中的 `tgt_lang`（协议与节点已有），无需新增字段；无 turn_id 时合并 key 退化为 job_id，与现有一致。

---

## 4. turn 边界与 flush 规则（坑 2 的冻结结论）

### 4.1 turn 的唯一结束条件

节点端只认以下两种事件作为 turn 结束：

- `manual finalize`
- `timeout finalize`

> 不引入 TTL、不做时间窗口猜测、不做隐式结束。

---

### 4.2 节点端 flush 行为

- MaxDuration finalize：
  - **不触发最终输出**
  - 仅作为「追加输入」的一部分

- manual / timeout finalize：
  - 触发 turn 级 flush
  - 将该 turn 内累计的内容一次性进入后续流程

---

## 5. 当前阶段的处理范围说明（重要）

### 5.1 当前阶段做什么

- 节点端合并 **ASR 输入层面** 的多个 MaxDuration Job
- ASR 仍可按较小切片（如 5 秒）执行
- 解决 Job 丢失、前半句缺失等**稳定性问题**

### 5.2 当前阶段不做什么

以下优化 **明确延后**，不在本次实现范围内：

- 跨 Job 的完整语义修复
- 跨 Job 的完整翻译
- turn 级文本重排 / 质量优化

说明：
> 中间结果质量问题的优先级 **低于控制流正确性与不丢 Job**。

---

## 6. 失败语义（冻结决策）

### 6.1 失败策略

> **turn 内任一 segment Job 失败 → 整个 turn 失败**

行为：
- 立即清理该 `(turnId + targetLang)` 的合并 buffer
- 返回错误给调度服务器
- 由 Web 端提示用户重新发言

### 6.2 不支持的失败行为

- 不做 segment 级局部成功
- 不做跨节点恢复
- 不做 turn 内自动补偿或重组

理由：
- 避免引入隐式状态与补丁式控制流
- 保持失败语义简单、可推理

---

## 7. 节点端合并流程（单路径）

```text
Job(segment) 到达
    ↓
根据 (turnId + targetLang) 定位合并 buffer
    ↓
追加音频 / ASR 输入
    ↓
if MaxDuration finalize:
    不输出结果
    等待下一个 segment

if manual / timeout finalize:
    触发 turn flush
    → 输出结果 / 进入后续流程
    → 清理 buffer
```

说明：
- 整个流程只有**一条主路径**
- 不存在 shouldWaitForMerge 等前向补丁逻辑

---

## 8. 与未来优化的关系

本方案为后续优化预留清晰边界：

- 未来可在 turn flush 阶段：
  - 做完整语义修复
  - 做完整翻译
  - 做跨 segment 的文本重排

这些优化 **不会反向影响** 当前节点端合并与调度契约。

---

## 9. 最终冻结结论

1. 节点端允许使用 `turnId + targetLang` 作为合并 Key
2. MaxDuration Job 只做追加，不输出最终结果
3. manual / timeout finalize 是唯一 flush 点
4. turn 内任一失败 → 整个 turn 失败
5. 当前阶段优先保证：
   - 不丢 Job
   - 控制流简单
   - 行为可推理

> 本文档作为当前阶段节点端 turn 合并的**最终技术规范**。

---

## 10. 改动量评估（供排期与评审参考）

### 10.1 结论：**改动量中等**，调度/协议侧已有基础

| 位置 | 现状 | 本方案要求 | 改动量 |
|------|------|------------|--------|
| **调度端** | Job 已有 `turn_id`；JobAssign 已向节点下发 `turn_id`（见 `job_creator.rs`、`websocket/mod.rs`） | 保持下发 turn_id，无需新增字段 | **无或极小** |
| **协议** | JobAssignMessage 已有 `turn_id?`、`tgt_lang`（节点侧 messages.ts） | mergeKey = turnId + targetLang，targetLang 用现有 `tgt_lang` 即可 | **无** |
| **节点端 key** | `buildBufferKey(job)` 已为 `job.turn_id ?? job.job_id`，未含 targetLang | mergeKey = turnId + targetLang；无 turn_id 时退化为 job_id | **小**（一处逻辑，如 `job.turn_id ? \`${job.turn_id}|${job.tgt_lang}\` : job.job_id`） |
| **节点端结果与 flush** | 当前每 job 可发 job_result；MaxDuration 时发空结果 + pending | MaxDuration 不触发最终输出；仅 manual/timeout 触发 turn flush 并输出 | **中**（结果上报契约需明确并实现，见下节） |
| **节点端失败语义** | 当前多为单 job 失败上报 | turn 内任一 segment 失败 → 整 turn 失败、清理 buffer、回报调度 | **中**（需实现清理与统一错误上报） |
| **调度端对 turn 失败** | 当前按 job 维度的超时/取消 | 收到「整 turn 失败」时是否取消同 turn 其余 job、如何通知 Web | **需与调度约定**（见下节） |
| **测试与用例** | 部分用例假设 bufferKey=job_id、每 job 一条 result | 需改为 mergeKey=turnId+targetLang、MaxDuration 不输出、仅 flush 时输出 | **中**（用例与 mock 需同步） |

整体无需大改协议或调度结构；主要工作量在**节点端结果上报契约、失败语义与测试对齐**，以及**与调度约定 turn 失败时的行为**。

---

## 11. 需补充说明（实现前需与调度/协议对齐）

以下在实现或 code review 前建议与调度、协议、Web 对齐或在本文档中明确。

### 11.1 结果上报契约（必补）

- **同一 turn 内多个 segment job，job_result 如何上报？**
  - MaxDuration 的 job：是否向调度发送任何消息？（当前文档仅写「不触发最终输出」，未写是否发空 result 或仅 ack。）
  - manual/timeout finalize 时：是「**本 job 携带整 turn 聚合结果发一条 job_result**」，还是「每个 segment 各发一条、仅最后一条带完整内容」？
- **建议**：在 4.2 或 7 中明确约定，例如：「MaxDuration 的 job 不向调度发送 job_result；仅在 manual/timeout finalize 时，由该 finalize 对应的 job 向调度发送一条 job_result，内容为该 turn 内累计的聚合结果」，并约定该条 result 的 `job_id`、`utterance_index` 等字段的填写规则（如以本 job 为准，或以 turn 内首/末 job 为准）。

### 11.2 targetLang 来源（建议写明）

- 文档已定义 mergeKey = turnId + targetLang。
- **建议**：在 3.2 下增加一句：「targetLang 使用 job_assign 中的 `tgt_lang`（协议与节点已有），无需新增字段；无 turn_id 时合并 key 退化为 job_id，与现有一致。」

### 11.3 调度端对 turn 失败的处理（建议与调度约定）

- 节点行为已约定：turn 内任一 segment 失败 → 清理 (turnId + targetLang) buffer，返回错误给调度。
- **未约定**：调度收到该错误后，是否取消该 turn 下已下发、未完成的其余 job？是否向 Web 推送「turn 失败」或「请重新发言」？若调度仍按单 job 维度重试，可能与节点「整 turn 已清理」不一致。
- **建议**：与调度约定「turn 失败」的协议形态（如 error 中带 turn_id 或约定错误码），以及调度侧取消同 turn 其余 job、通知 Web 的规则，并在本文档或调度文档中记录。

### 11.4 与《取消跨 Job 前向合并》裁决的关系（建议写明）

- 本方案允许节点端按 **turnId + targetLang** 合并，与《取消跨 Job 前向合并_推荐方案说明》中「否决节点端按 turnId 回溯并合并上一 Job buffer」的裁决**冲突**，需决策部门**修订该裁决**后方可实施。
- **建议**：在文档开头「目标」后增加一句：「本方案经决策部门修订《取消跨 Job 前向合并》裁决（允许调度附带 turn_id、节点端仅按 turn_id + targetLang 合并）后实施。」

### 11.5 utterance_index / segment 顺序（若整 turn 一条 result）

- 若采用「仅 flush 时发一条 job_result」：调度/Web 如何区分同一 turn 内多 segment 的顺序？该条 result 的 `utterance_index` 填本 job 的、turn 内首 job 的、还是末 job 的？
- **建议**：在 11.1 中与结果上报契约一并约定 `utterance_index`、`segment_index`（若有）的填写规则，以便调度/Web 按 turn 聚合与展示。
