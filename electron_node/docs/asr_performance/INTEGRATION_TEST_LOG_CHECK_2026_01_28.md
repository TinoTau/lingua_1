# 集成测试结果与节点端日志检查说明

**日期**：2026-01-28  
**场景**：语音识别稳定性测试，多句朗读（含长句），客户端显示原文 [0]–[8] 均带「[音频丢失]」、译文 (NMT) 为空。

---

## 1. 你看到的现象说明

- **原文 (ASR)**：每条前面都有 `[音频丢失]`，但后面有 ASR 文本（如「我们开始进行一次语音识别稳定性测试」等），说明 **ASR 有正常出字**。
- **译文 (NMT)**：整段为空，说明 **没有拿到任何一句的 NMT 译文**。
- **客户端显示 [音频丢失]**：当 **TTS 无音频**（或未下发）时，前端用「[音频丢失]」占位。  
  TTS 只有在 NMT 返回非空译文时才会被调用；若 NMT 返回空，则不会做 TTS，客户端就会显示 [音频丢失]。

因此，当前问题的关键在 **NMT 为何没有返回译文**（或节点端为何没有把译文交给 TTS/客户端）。需要看节点端日志里每个 job 在各服务中的输入/输出。

---

## 2. 节点端日志位置

- 开发/本地运行节点端时，日志一般在：
  - **electron_node/electron-node/logs/electron-main.log**
- 若从其他目录启动，则日志在 **当前工作目录下的 logs/electron-main.log**。

请用你本次集成测试时运行节点端的那台机器、对应目录下的 `electron-main.log` 做分析。

---

## 3. 按 Job 看各服务处理过程（推荐脚本）

已提供脚本 **scripts/analyze_jobs_per_service_flow.ps1**，用于从 `electron-main.log` 里按 job 提取：

- **ASR**：输出文本（asrText / asrTextPreview）
- **聚合**：aggregatedText、shouldSendToSemanticRepair
- **语义修复**：是否执行、repairedText
- **NMT**：是否执行、translatedText 长度（空则会导致 [音频丢失]）
- **TTS**：是否有音频长度

**用法（在 electron_node 目录下）：**

```powershell
# 使用默认日志路径 electron-node/logs/electron-main.log
.\scripts\analyze_jobs_per_service_flow.ps1

# 指定日志路径（你本次测试的 electron-main.log）
.\scripts\analyze_jobs_per_service_flow.ps1 -LogPath "D:\你的路径\electron-node\logs\electron-main.log"

# 只分析某 session
.\scripts\analyze_jobs_per_service_flow.ps1 -LogPath "..." -SessionId "你的session_id"
```

脚本会为每个 job 打印一段摘要，便于你确认：

- 哪些 job **走了语义修复**（shouldSendToSemanticRepair=true 且语义修复有「已执行」）
- 哪些 job **调用了 NMT**、**translatedText 是否为空**
- 哪些 job **有 TTS 音频**（无则客户端会显示 [音频丢失]）

---

## 4. 结合你本次结果的排查重点

你这次是 **9 条原文都有字，但 9 条都 [音频丢失]、译文全空**，建议在日志里重点看：

1. **每个 job 的 shouldSendToSemanticRepair**  
   - 若为 `false`，则该 job 不会进语义修复，也不会进 NMT（设计如此），自然没有译文和 TTS，会 [音频丢失]。

2. **进入 NMT 的 job**  
   - 是否有 `runTranslationStep` / `Translation completed` 等；  
   - 若有调用但「translatedText 长度: 0」或「译文为空」，说明 **NMT 服务返回了空**，可能原因包括：  
     - 上游传给 NMT 的文本为空或异常；  
     - context_text 或其它参数导致 NMT 返回空；  
     - NMT 服务本身错误/超时。

3. **语义修复**  
   - 若多数 job 因门控（HOLD/丢弃）而 `shouldSendToSemanticRepair=false`，则只有少数 job 会进语义修复和 NMT，你可能会看到「部分 job 有译文、部分 [音频丢失]」；  
   - 若所有 job 都未进语义修复，则会出现「全部 [音频丢失]、译文全空」，和你当前现象一致。

请把 **analyze_jobs_per_service_flow.ps1** 的完整输出（或每个 job 的摘要部分）保存下来。若需要进一步判断「是在哪一环节把语音/译文吃掉了」，可再根据该输出逐 job 对照日志行（如 NMT 入参、返回、TTS 是否被调用等）做定位。

---

## 5. 其它可用脚本（辅助）

- **check_semantic_nmt_tts_logs.ps1**：整体检查本次日志里是否出现过语义修复、NMT、TTS 的调用与完成记录。  
  ```powershell
  .\scripts\check_semantic_nmt_tts_logs.ps1 -LogPath "你的electron-main.log路径"
  ```
- **analyze_all_jobs_complete_flow.ps1**：按 job 汇总更完整的流程（含音频、批次等），可与上面脚本互补。

---

**小结**：你当前现象（原文有字、译文全空、全部 [音频丢失]）与「NMT 未产生译文」或「多数 job 未进入语义修复/NMT」一致。请用 `analyze_jobs_per_service_flow.ps1` 对本次测试的 `electron-main.log` 跑一遍，根据每个 job 的「是否语义修复 / 是否 NMT / translatedText 是否为空」即可判断问题是在门控、语义修复、NMT 入参还是 NMT 服务返回。
