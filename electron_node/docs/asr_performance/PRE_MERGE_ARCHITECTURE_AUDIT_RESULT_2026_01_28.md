# 节点端架构审计结果（2026-01-28）

**依据**：`PRE_MERGE_ARCHITECTURE_AUDIT_CHECKLIST.md`  
**结论**：A/B/C/D 项均通过；E 项有一处需决策部门确认语义；B1 有一项建议（重复 job_id 防护）；F 为回归用例清单，需人工/CI 执行。

---

## A. 全局红线 — ✅ 通过

| 条款 | 结果 | 依据 |
|------|------|------|
| **对外发送只有一个出口** | ✅ | `sendJobResult` 仅在 `NodeAgent.handleJob` 的 `for (resultsToSend) { this.resultSender.sendJobResult(...) }` 中调用；pipeline step、aggregator 内无 `sendJobResult` / WebSocket send / HTTP reply。异常路径仅 `sendErrorResult(job, error, startTime)`，为约定之唯一错误出口。 |
| **不得引入补偿/重试/再次发送路径** | ✅ | 无“发送失败再走另一条路发”“shouldSend=false 但额外发一个”逻辑。 |
| **不得用 flag 控制流跳转** | ✅ | 未发现 `originalJobResultsAlreadySent` 类 flag；`recentJobIds` 仅用于重复 job 整单跳过（不进入 process/send），不增加发送路径数量。 |
| **去重只允许在一个层级** | ✅ | 去重判定在 pipeline（DedupStage 设 `shouldSend`）；NodeAgent 仅用 `recentJobIds` 跳过重复 job_id 整单处理；ResultSender 根据 `shouldSend` 与 `getLastSentText` 决定是否发送，不重复做“是否重复 job”的判定层级。 |

---

## B. 模块 1：Job 容器管理 — ✅ 通过（B1 有一项建议）

### B1. `buildResultsToSend` 结构审计

| 条款 | 结果 | 依据 |
|------|------|------|
| **handleJob 三段直线流** | ✅ | `processJob` → `buildResultsToSend` → `for resultsToSend send`，中间无插入 if/else 分叉发送；仅前有 ws/重复 job 提前 return，后有 catch 中 `sendErrorResult`。 |
| **buildResultsToSend 为纯函数** | ✅ | 仅读入 `job`、`processResult`，返回列表；无全局状态、网络、缓存、sender 调用。 |
| **resultsToSend 单一来源** | ✅ | 空容器核销仅来自 `processResult.finalResult.extra.pendingEmptyJobs`，无其它拼装来源。 |
| **resultsToSend 内不得重复 job_id** | ⚠️ 建议 | 当前未在 `buildResultsToSend` 内对“主 job_id 与 empty 项 job_id 相同”或“empty 列表内部重复”做去重/assert。pipeline 侧 asr-step 写入的 `pendingEmptyJobs` 通常为其它空 job，不含当前 job；若未来出现当前 job 被写入 pendingEmptyJobs，会产生重复。**建议**：在 `buildResultsToSend` 内过滤掉 `job_id === job.job_id` 的 empty 项，或加 debug assert。 |

### B2. 语义契约审计

| 条款 | 结果 | 依据 |
|------|------|------|
| **空容器核销受 shouldSend 约束** | ✅ | 代码与注释一致：`if (processResult.shouldSend && pendingEmptyJobs?.length)` 才追加空容器项。 |
| **NO_TEXT_ASSIGNED 不被 sender 覆盖为 ASR_EMPTY** | ✅ | `node-agent-result-sender.ts` 中 `if (isEmpty) { if (!isNoTextAssigned) { (finalResult.extra as any).reason = 'ASR_EMPTY'; } }`，且 `extra.reason = 'NO_TEXT_ASSIGNED'` 在 isNoTextAssigned 时保留。 |
| **shouldSend=false 时行为可推断** | ✅ | 不发任何结果（含核销）；NodeAgent 层仅当 `shouldSend && pendingEmptyJobs?.length` 才把空容器加入列表，sender 内不再暗改。 |

---

## C. 模块 2：Utterance 聚合 + 语义修复 — ✅ 通过

### C1. committedText 写点审计

| 条款 | 结果 | 依据 |
|------|------|------|
| **写点仅两类** | ✅ | 聚合阶段：`aggregation-step.ts` 写 `ctx.lastCommittedText`（输入快照）；语义修复阶段：`semantic-repair-step.ts` 内 `updateLastCommittedTextAfterRepair`（最终权威写回）。其它 step 未写 committedText。 |
| **updateLastCommittedTextAfterRepair 单次调用** | ✅ | 仅在 `runSemanticRepairStep` 内、`repairResult.decision === 'REPAIR' \|\| 'PASS'` 时调用一次，无重试/补偿导致二次更新。 |

### C2. 控制流审计

| 条款 | 结果 | 依据 |
|------|------|------|
| **runAggregationStep 每 job 只调用一次 process** | ✅ | `aggregation-stage.process(...)` 在 `runAggregationStep` 内仅调用一次（约第 86 行）。 |
| **语义修复 step 只进入一次、无“修复失败再跑一次”** | ✅ | 无“修复失败 → 再跑一次”分支；初始化/阶段不可用时直接 return，不重试。 |

---

## D. 模块 3：AudioAggregator / AudioProcessor — ✅ 通过

### D1. 热路径观测审计

| 条款 | 结果 | 依据 |
|------|------|------|
| **shouldReturnEmpty 分支不调用 getBufferStatus/大对象** | ✅ | `pipeline-orchestrator-audio-processor.ts` 中 `if (chunkResult.shouldReturnEmpty)` 分支仅 `logger.debug(...)`，未调用 `getBufferStatus`，未为日志构造大对象。 |
| **日志为可选观测、不增加分支** | ✅ | 未发现“为记录某字段新增 if 路径”。 |

### D2. 计算冗余审计

| 条款 | 结果 | 依据 |
|------|------|------|
| **不为 .length 单独调用 aggregateAudioChunks** | ✅ | `audio-aggregator.ts` 等处用 `reduce`/已有长度信息计算长度，未发现“只为 .length 调用 aggregateAudioChunks()”。 |
| **同一函数内未对同一 audioChunks 两次全量聚合** | ✅ | 未发现同一函数内对同一 `audioChunks` 做两次全量聚合且无注释说明的模式。 |

---

## E. ResultSender 侧 — ✅ 通过（一处语义需确认）

| 条款 | 结果 | 依据 |
|------|------|------|
| **一次判定 → 一次发送 → 一次记录** | ✅ | 无“发送前后两套去重/标记”冲突逻辑；无“失败 → 备用发送路径”。 |
| **markJobIdAsSent 语义清晰** | ⚠️ 需确认 | 当前两处调用：① 文本重复不发送时仍调用 `markJobIdAsSent`（视为已处理，防调度重试重复）；② 实际发送成功后调用。即“判定后视为已处理”与“本轮发送成功”两种场景均会 mark。若决策部门要求**仅在实际发送成功时记录**，需收束为仅② 调用，并评估调度重试行为。 |
| **NO_TEXT_ASSIGNED 不被 ASR_EMPTY 覆盖** | ✅ | 见 B2；建议在单测中显式断言“NO_TEXT_ASSIGNED 的 result 经 sender 后 reason 仍为 NO_TEXT_ASSIGNED”。 |

---

## F. 必跑回归用例（最小集）

以下需人工或 CI 执行，本审计未自动跑测：

| 用例 | 说明 |
|------|------|
| 单 job 正常输入 | 只回一次，非空文本，reason 正常 |
| shouldSend=false | 确认不发送任何结果（含核销） |
| pendingEmptyJobs 存在 | 核销结果正确，且不出现重复 job_id |
| ASR 空输入 | 只回一次，reason=ASR_EMPTY |
| NO_TEXT_ASSIGNED | 只回一次，reason 不被覆盖 |
| 热路径压力 | 大量短 chunk + 频繁 buffer return，不应因日志构造导致明显 CPU/延迟尖峰 |

---

## 建议后续动作

1. **B1 重复 job_id**：在 `buildResultsToSend` 内过滤 `empty.job_id === job.job_id` 的项，或加 debug assert（主 job 不应出现在 pendingEmptyJobs）。
2. **E markJobIdAsSent**：与决策部门确认“仅发送成功时记录”还是“判定后即记录”；若为前者，收束为仅在实际 `ws.send` 成功后调用。
3. **E reason 单测**：为“NO_TEXT_ASSIGNED 经 ResultSender 后不被改为 ASR_EMPTY”增加单测锁死。

---

**审计日期**：2026-01-28  
**审计依据**：PRE_MERGE_ARCHITECTURE_AUDIT_CHECKLIST.md
