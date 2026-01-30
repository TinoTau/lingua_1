# 日志路径确认与本次检查说明

**日期**：2026-01-28  
**结论**：日志路径逻辑未改；仓库内未找到原始 `electron-main.log`，仅能基于已有报告做检查说明。

---

## 1. 日志路径逻辑（未改）

`main/src/logger.ts` 中逻辑为：

- **baseDir** = `process.cwd()`（进程当前工作目录）
- **logDir** = `path.join(baseDir, 'logs')`
- **logFile** = `path.join(logDir, 'electron-main.log')`

即：**日志文件 = 当前工作目录/logs/electron-main.log**。

- 若在 **electron_node/electron-node** 下执行 `npm start`，则 cwd 一般为 `electron-node`，日志为：  
  **electron_node/electron-node/logs/electron-main.log**
- 若在其它目录启动，则日志在该目录的 `logs/electron-main.log`。

未发现对上述逻辑的修改，与你「没有改过日志路径的逻辑」一致。

---

## 2. 仓库内日志文件情况

- 在仓库内**未找到** `electron-main.log` 文件（可能未提交、被 .gitignore 或仅在本地生成）。
- **electron_node/electron-node/logs/** 目录存在，其中仅有：
  - **logs/docs/asr_performance/JOB_BY_JOB_REPORT_S62AC97B0.md**
  - **logs/docs/asr_performance/JOB_SERVICE_IO_REPORT.md**  
  即：之前基于 `electron-main.log` 生成的**分析报告**，不是原始日志本身。

因此本次无法直接读取原始 `electron-main.log`，只能基于上述已有报告做「日志检查」的结论归纳。

---

## 3. 基于已有报告的检查结论（Session s-62AC97B0）

报告注明来源为：`electron_node/electron-node/logs/electron-main.log`（JSON 行），Session s-62AC97B0。从 **JOB_BY_JOB_REPORT_S62AC97B0.md** 可得到：

### 3.1 各 Job 在各环节的情况

| utterance_index | ASR | 聚合 | 语义修复 | NMT/TTS | 有内容结果 | 空结果 (ASR_EMPTY 等) |
|-----------------|-----|------|----------|---------|------------|------------------------|
| 0 | 有输出（16 字） | NEW_STREAM，shouldSendToSemanticRepair=true | 已执行，REPAIR 16→13 字 | 有（textTranslatedLength=38，ttsAudioLength=133864） | 1 次 | 1 次 ASR_EMPTY |
| 1 | 有，合并 46 字 | aggregated 59 字 | 已执行，59→62 字 | 有（201 字译文，TTS 有） | 1 次 | 1 次 ASR_EMPTY |
| 2 | 有，8 字 | aggregated 70 字 | 已执行，70→70 字 | 有（236 字译文，TTS 有） | 1 次 | 1 次 ASR_EMPTY |
| 3 | 延迟完成 | 后续批次完成 | 已执行 | 有（380 字译文，TTS 有） | 1 次 | 2 次（NO_TEXT_ASSIGNED + ASR_EMPTY） |
| 4 | 有，多段合并 | MERGE，152 字 | 已执行 | 有（479 字译文，TTS 有） | 1 次 | 1 次 ASR_EMPTY |
| 5 | 有，25 字 + MERGE | aggregated 177 字 | 已执行，177→164 字 | 有（570 字译文，TTS 有） | 1 次 | 1 次 ASR_EMPTY |

结论（针对该次日志）：

- **每个 job 都经过了语义修复**，且都有 NMT 译文和 TTS 音频（有内容结果均发送成功）。
- **问题**：每个 job 在发送完**有内容结果**后，又多发了一条**空结果**（ASR_EMPTY）；job 3 还多了一条 NO_TEXT_ASSIGNED 空结果。  
  即：同一 job 存在「先有内容、后空」的重复发送。

### 3.2 报告里给出的可能根因（可直接对照代码）

- **发送点 1**：`asr-step.ts` 里对 **original job** 发送有内容结果（Original job result sent to scheduler）。
- **发送点 2**：`node-agent-simple.ts` 在 `processJob(job)` 返回后，对**当前（container）job** 再发一次 `finalResult`。  
  当存在 originalJobIds 时，container job 的 `ctx.asrText` 可能未被填充，`finalResult.text_asr` 为空，被标为 ASR_EMPTY 再次发送。
- **修复方向**（报告建议）：  
  1）ResultSender：对同一 job_id 若已发送过非空结果，则不再发送该 job_id 的 ASR_EMPTY；  
  2）或在 pipeline/ASR 步：当 container 仅有 originalJobIds 且 original 结果已发送时，避免 node-agent-simple 再发一次空结果。

---

## 4. 与你本次集成测试现象的对应关系

你当前现象是：**原文 [0]–[8] 都带 [音频丢失]，译文 (NMT) 为空**。  
而上述报告里的 Session s-62AC97B0 是：**有 NMT 译文、有 TTS**，只是多了空结果重复发送。

因此可以判断：

- **若你这次测试的 session 与 s-62AC97B0 不同**（例如新的 session、新的 electron-main.log），则需要在**你本次测试生成的 electron-main.log** 上再跑一遍分析（例如 `analyze_jobs_per_service_flow.ps1`），才能对应「[音频丢失]、译文为空」的原因。
- **若你这次测试用的就是生成上述报告的那次日志**，则从报告看：语义修复、NMT、TTS 都执行了且有内容；你看到的「[音频丢失]」和「译文为空」更可能来自**调度端/客户端**对「重复空结果」的处理（例如只展示了空结果、过滤了有内容结果），而不是节点端没做 NMT/TTS。

建议：

1. **确认本次测试的日志文件位置**  
   在运行节点端时的 cwd 下查看 `logs/electron-main.log` 是否存在（路径逻辑见第 1 节）。
2. **若存在新日志**  
   用 `scripts/analyze_jobs_per_service_flow.ps1` 指定该 `electron-main.log` 再跑一次，把输出贴出，可进一步判断每个 job 是否走了语义修复、NMT、TTS 以及在哪一环节导致 [音频丢失]/译文为空。
3. **若希望保留日志供后续分析**  
   可将 `electron-main.log` 复制到仓库内（例如 `electron_node/electron-node/logs/`）并提交，或至少保留一份副本；当前仓库内没有该文件，无法再对原始日志做新分析。

---

## 5. 小结

- **日志路径**：未改，仍为 `process.cwd()/logs/electron-main.log`。
- **仓库内**：未找到 `electron-main.log`，仅能基于已有报告做检查。
- **已有报告（s-62AC97B0）**：各 job 均经语义修复、NMT、TTS，且有内容结果发送成功；问题是同一 job 多发了一条空结果（ASR_EMPTY）。
- **你本次现象**：需用本次测试对应的 `electron-main.log` 再跑一次分析脚本，才能精确对应「[音频丢失]、译文为空」是节点端未出译文，还是调度/前端只展示了空结果。
