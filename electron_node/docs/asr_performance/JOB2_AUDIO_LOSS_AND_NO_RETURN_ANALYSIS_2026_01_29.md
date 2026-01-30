# Job2 音频丢失与后续 Job 无返回 — 日志分析结论（2026-01-29）

**现象**：集成测试中 [0][1] 有原文+译文，[2] 原文为「[音频丢失]」且无译文，之后 [3]+ 完全没有返回。  
**分析依据**：已有报告 `JOB_SERVICE_FLOW_REPORT_S1133D54D_2026_01_29.md`（session s-1133D54D）；原始 `electron-main.log` 当前未在仓库中（可能在 `dist/main/main/logs/` 或本地其他路径）。

---

## 1. Job2 为何显示「[音频丢失]」、无译文？

### 1.1 结论（根因）

**NMT 服务（nmt-m2m100）对该次请求返回了空译文**（HTTP 200，`translatedText=""`）。  
节点端流水线对 Job2 已正常执行：ASR 有文本、聚合与语义修复均通过、并调用了 NMT，但 NMT 返回空 → 无 TTS 音频 → 客户端用「[音频丢失]」占位、译文为空。

### 1.2 报告中的对应证据（session s-1133D54D）

| 阶段       | Job2 在报告中的情况 |
|------------|----------------------|
| ASR        | 有输出：「要不要的时候提前结束本次识别」（14 字） |
| 聚合       | aggregatedText=81 字，shouldSendToSemanticRepair=**true** |
| 语义修复   | 执行，decision=**PASS**，repairedText=81 字 |
| NMT        | 已调用 nmt-m2m100，**translatedText=""**，translatedTextLength=**0** |
| TTS        | 译文为空 → ttsAudioLength=**0** → 客户端 [音频丢失] |

因此：**Job2 音频丢失的直接原因是 NMT 返回空**，不是 ASR/聚合/语义修复未执行或未传文本。

### 1.3 若你本地 [0][1] 有译文、[2] 起无译文

- 可能本次测试与报告并非同一次运行（不同 session / 不同 log）。
- 共同点仍成立：**一旦 NMT 返回空，该 job 就会无 TTS、客户端显示 [音频丢失]**。  
建议：在**本次测试对应的 electron-main.log** 上对 Job0/1/2 各搜一次 `NMT OUTPUT` / `translatedText`，确认 Job2 的 NMT 是否为空。

---

## 2. 后续 Job（[3]+）为何「都没有返回结果」？

有两种可能，需用「本次测试的 log」区分。

### 2.1 情况 A：节点端已发送，但客户端/调度端未展示

报告中 **9 个 job（含 Job3～8）在节点端均完成**：  
`Job processing completed successfully`，且均有 NMT 调用记录，只是 **NMT 对所有 job 均返回空**（translatedText=""）。

- **含义**：节点端把 Job3～8 的「空结果」（textTranslated=""，ttsAudioLength=0）都发给了调度端/客户端。
- **「无返回」的可能原因**：  
  - 客户端或调度端对「空译文 / 无 TTS」的结果不展示、或只展示前几条；  
  - 连接/会话在 Job2 之后断开，后续结果未送达或未渲染。

**如何确认**：在同一份 log 里搜 `Job processing completed successfully` 或 `sendJobResult`，看是否有 Job3、Job4… 的完成记录。若有，则属情况 A。

### 2.2 情况 B：节点端 Job3+ 未完成或未发送

若在 log 里 **Job2 之后没有 Job3 的 `runTranslationStep` / `runTtsStep` / `Job processing completed successfully`**，则说明流水线在 Job2 之后的某个 job 上卡住或未继续。

可能原因包括：

- Job3 的 NMT/语义修复/外部服务长时间未返回，导致超时或未走到发送；
- 发送阶段报错（如 `Cannot send result: WebSocket not ready`），后续 result 未发出；
- 调度端/会话状态导致后续 job 未下发到节点。

**如何确认**：在 log 里按 **job_id** 搜 Job3、Job4，看是否出现：  
`runTranslationStep` / `NMT OUTPUT` / `runTtsStep` / `Job processing completed successfully`。  
若某 job 只有 ASR/聚合/语义修复，没有翻译完成或发送，则卡在该 job 的后续阶段。

---

## 3. 建议的排查顺序（用「本次测试」的 electron-main.log）

1. **确认日志文件位置**  
   若已按最新逻辑修复日志路径，日志应在：  
   `electron_node/electron-node/logs/electron-main.log`  
   启动时控制台会打印 `[Logger] Log file path: ...`，以该路径为准。

2. **Job2 音频丢失**  
   - 搜 Job2 的 `job_id`，确认是否有 `NMT OUTPUT` 且 `translatedText=""`。  
   - 若是，根因在 **NMT 服务**（模型/语言对/配置等），需单独排查 nmt-m2m100。

3. **后续 Job 无返回**  
   - 搜 `Job processing completed successfully` 或 `sendJobResult`，看是否有 Job3、Job4… 的条目。  
     - **有** → 属 2.1（节点已发，客户端/调度端未展示或未连接）；  
     - **无** → 属 2.2（节点未完成或未发送），再针对第一个「断点」job 查 NMT/发送/错误日志。

4. **用脚本做整体对照**  
   在 electron_node 下执行：  
   `.\scripts\analyze_jobs_per_service_flow.ps1 -LogPath "你的electron-main.log路径"`  
   可一次性看到各 job 的 ASR/聚合/语义修复/NMT/TTS 与完成情况，便于区分 Job2 与后续无返回是 NMT 空还是未发送。

---

## 4. 小结

| 问题                 | 根因/结论 |
|----------------------|-----------|
| Job2 显示 [音频丢失]、无译文 | **NMT 返回空**（translatedText=""）→ 无 TTS → 客户端 [音频丢失]。节点端 ASR/聚合/语义修复正常，问题在 NMT 服务。 |
| 后续 Job 都没有返回  | 需用本次 log 区分：**节点已发但客户端未展示**（情况 A），或 **节点未完成/未发送**（情况 B）。报告 s-1133D54D 中 9 个 job 均在节点端完成且发送，但 NMT 全为空。 |

**下一步**：  
- 修复/确认 NMT 服务（nmt-m2m100）能对当前语言对返回非空译文；  
- 用本次测试的 `electron-main.log` 按上面步骤确认 Job3+ 是「已发未展示」还是「未完成/未发送」，再决定查节点端流水线还是客户端/调度端展示与连接。
