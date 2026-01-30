# 幽灵 NMT、同一 ui 双 Job、DUP_SEND — 架构级修复说明（2026-01）

**原则**：从架构设计上杜绝，不打补丁、不做兜底、不考虑兼容。

---

## 一、幽灵 NMT（job-1 出现「Translated.» 等异常 NMT 输出）

### 根因

- 分析脚本按「日志行中是否包含 jobId/job_id」将行归到对应 job；生产代码中**没有**对 NMT 返回固定写死 `"Translated."` 的逻辑，该字符串仅出现在单测 mock（`translation-stage.context.test.ts`）。
- 若单测与主进程共用同一日志文件（`electron-main.log`），单测执行时写入的带 `job_id: "job-1"` 和 `translatedText: "Translated."` 的日志会混入生产日志，被分析脚本误归到「job-1」的 NMT 输出，形成「幽灵 NMT」。

### 架构修复

- **logger.ts**：根据运行环境区分日志文件。
  - 判定测试环境：`process.env.NODE_ENV === 'test'` 或 `process.env.JEST_WORKER_ID !== undefined`。
  - 测试环境写入 **electron-main.test.log**，非测试环境写入 **electron-main.log**。
- 效果：单测/集成测试的日志**不再写入** `electron-main.log`，生产日志与测试日志物理隔离，从源头杜绝「幽灵 NMT」误判。

---

## 二、同一 utterance_index 出现两个 Job（如 ui=1 对应 job-1 与 job-f0797f8b）

### 根因

- 调度或上游对同一 `(session_id, utterance_index)` 下发了两个不同 `job_id` 的 `job_assign`，节点端对每个消息都执行一次 `handleJob`，导致同一 ui 被两个 job 处理，违反「一个 utterance 槽位只对应一个 job」的语义。

### 架构修复

- **node-agent-simple.ts**：引入 **sessionUtteranceToJobId**（`Map<string, string>`），键为 `session_id:utterance_index`，值为已接受的 `job_id`。
- 在 **handleJob 入口**（在真正执行 processJob 之前）：
  - 若当前 `(job.session_id, job.utterance_index)` 已在 map 中，则**拒绝**本 job：不执行 processJob，并调用 **sendErrorResult** 回传错误（`DUPLICATE_UTTERANCE_INDEX`），以便调度知道该 job 被拒绝。
  - 若未在 map 中，则接受本 job，并写入 `sessionUtteranceToJobId.set(key, job.job_id)`。
- **removeSession(sessionId)** 时：删除所有 key 以 `sessionId:` 开头的条目，使该 session 的 utterance 槽位在重连后可重新使用。
- 效果：**同一 (session_id, utterance_index) 在节点生命周期内只接受一个 job**；后到的同槽位 job 一律拒绝并回传错误，从架构上杜绝「同一 ui 双 Job」。

---

## 三、DUP_SEND（同一 job 的 job_result 被发送两次）

### 根因

- 调度重复下发同一 `job_id` 的 `job_assign`，或网络重试导致同一 job 被处理两次；原逻辑仅用 **recentJobIds**（最近 2 个 job_id）做相邻去重，无法拦截「先 A 再 B 再 A」这类非相邻重复，因此同一 job_id 可能被 handleJob 执行两次，从而 sendJobResult 被调用两次。

### 架构修复

- **node-agent-simple.ts**：用 **processedJobIds**（`Set<string>`）替代 **recentJobIds**。
- 在 **handleJob 入口**（在真正执行 processJob 之前）：
  - 若 `job.job_id` 已在 **processedJobIds** 中，则**拒绝**本 job：不执行 processJob，并调用 **sendErrorResult** 回传错误（`DUPLICATE_JOB_ID`）。
  - 若未在 set 中，则接受本 job，并 **processedJobIds.add(job.job_id)**（与 sessionUtterance 约束一起，在通过两项检查后统一登记）。
- processedJobIds 在进程生命周期内**不清理**（不按 session 清理），保证**每个 job_id 在节点上最多被处理一次**。
- 效果：**同一 job_id 只会触发一次 processJob 与一次发送循环**，从架构上杜绝 DUP_SEND。

---

## 四、契约与调度侧建议

| 契约 | 说明 |
|------|------|
| **job_id 唯一性** | 调度不应将同一 `job_id` 的 `job_assign` 发送两次；若需重试，应使用新 job_id。节点对重复 job_id 会拒绝并回传 `DUPLICATE_JOB_ID`。 |
| **(session_id, utterance_index) 唯一性** | 同一 session 下同一 utterance_index 只应下发一个 job；节点对同槽位第二个 job 会拒绝并回传 `DUPLICATE_UTTERANCE_INDEX`。 |
| **生产日志与测试日志隔离** | 生产使用 `electron-main.log`，测试使用 `electron-main.test.log`；分析脚本应只对生产日志做按 job 分析。 |

---

## 五、修改文件清单

| 文件 | 修改内容 |
|------|----------|
| **main/src/logger.ts** | 测试环境使用 `electron-main.test.log`，非测试使用 `electron-main.log`。 |
| **main/src/agent/node-agent-simple.ts** | ① processedJobIds 替代 recentJobIds，每个 job_id 只处理一次；② sessionUtteranceToJobId，同一 (session_id, utterance_index) 只接受一个 job；③ 拒绝时调用 sendErrorResult；④ removeSession 时清理该 session 的 sessionUtteranceToJobId。 |

---

## 六、回归与验收

1. **幽灵 NMT**：跑单测后检查 `electron-main.log` 中不应出现带 `job_id: "job-1"` 且 `translatedText: "Translated."` 的行；分析脚本只对 `electron-main.log` 跑，不应再出现「job-1 有 NMT 输出但无 ASR」的误判。
2. **同一 ui 双 Job**：若调度对同一 (session_id, utterance_index) 下发第二个 job，节点应拒绝并回传 `DUPLICATE_UTTERANCE_INDEX`，且只处理第一个 job。
3. **DUP_SEND**：若同一 job_id 被下发两次，节点应拒绝第二次并回传 `DUPLICATE_JOB_ID`，且 job_result 只发送一次。
