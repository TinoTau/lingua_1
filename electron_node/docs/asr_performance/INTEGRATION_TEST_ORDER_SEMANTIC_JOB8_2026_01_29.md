# 本次集成测试问题分析：顺序错乱、Job2 丢失、Job8 合并、原文质量差（2026-01-29）

## 节点端顺序（架构约定）

- **处理顺序**：`handleJob` 串行 await，同一时间只处理一个 job；SequentialExecutor 保证 ASR/NMT 按 utterance_index 执行。
- **发送顺序**：发送顺序 = handleJob 完成顺序 = **job_assign 接收顺序**。节点不另做重排。
- **若出现 [0],[2],[1] 等乱序**：说明调度下发的 job_assign 顺序即如此，应在调度侧保证按 utterance_index 下发；节点端不增加结果缓冲/重排层。

---

## 一、现象摘要

| 现象 | 用户描述 |
|------|----------|
| **Job1/2 顺序** | 返回顺序为 [0], [2], [1], [4]...，Job1 和 Job2 顺序颠倒 |
| **Job2 音频丢失** | [2] 显示「[音频丢失] 必要的时候提前结束本次试别」 |
| **Job8 合并译文** | Job8 的译文再次出现「合并的译文文本」（多句拼在一起） |
| **原文质量差** | 如 [0]「但是进行一次运营识别稳定性测试」等，怀疑语义修复未生效 |

---

## 二、根因与结论（基于代码与既有日志）

### 2.1 Job1/2 返回顺序错乱

- **架构**：节点端 handleJob 串行，发送顺序 = job_assign 接收顺序；SequentialExecutor 只保证 ASR/NMT 执行顺序。
- **原因**：若出现 [0], [2], [1]...，即调度下发的 job_assign 顺序如此（或调度/客户端展示顺序有误）。
- **结论**：不在节点端增加结果缓冲/重排；由调度侧保证按 utterance_index 下发，问题在调度侧排查。

### 2.2 Job2 [音频丢失]

- **可能原因**：
  1. 该 job 的某段被标为 **missing**（ASR 超时/失败），合并时排除该段文本，但结果仍带该 job → 客户端用「无 TTS 音频」显示 [音频丢失]。
  2. 该 job 的 NMT 返回空 → 无 TTS → [音频丢失]。
- **建议**：用 `analyze_jobs_per_service_flow.ps1` 针对本次会话的 Job2 查：  
  - 是否有 `missing`、`isPartial`、`translatedTextLength=0`、`ttsAudioLength=0`，以区分是 ASR 缺失还是 NMT/TTS 空。

### 2.3 Job8 合并译文

- **原因**：与之前分析一致——**NMT 服务端**在收到 `context_text` 后，将 context 误当作正文参与解码或拼接进输出。
- **结论**：节点端已对 `context_text` 做 200 字截断且仅作「上一句原文」传入；合并译文来自 **NMT 服务端行为**，需在 NMT 侧保证「context 仅用于消歧、不输出到译文」。
- **建议**：在 NMT 服务（如 nmt-m2m100）中检查：解码/后处理是否把 `context_text` 拼进 `translatedText`，或是否有「多句合并输出」的逻辑被错误触发。

### 2.4 原文质量差、语义修复「未生效」

- **根因（代码层面）**：
  1. **翻译与展示未用 repairedText**：  
     翻译步骤与 ResultBuilder 此前只用 `segmentForJobResult`，未用语义修复产出的 `repairedText`，导致 NMT 和展示的「原文」都未体现语义修复。
  2. **>40 字路径缺少 segmentForCurrentJob**：  
     「>40 字 SEND」分支未设置 `segmentForCurrentJob`，导致长句的 `segmentForJobResult` 为空；且设计上**不丢弃后续内容**，后续 ASR 在下次 `processText` 中合并/发送。

- **本次已做修改**：
  1. **translation-step / result-builder**：**仅用 repairedText**（不兼容回退）；未送语义修复时由 aggregation-step 写入 `repairedText`。
  2. **TextForwardMergeManager**：在「>40 字 SEND」分支补上 `segmentForCurrentJob: mergedText`；注释明确「不丢弃后续内容，后续在下次 processText 中合并/发送」。

---

## 三、建议验证步骤

1. **顺序**：再跑一轮集成测试，在客户端或调度侧确认是否按 `utterance_index` 展示；若仍乱序，在节点端加「按 utterance_index 缓冲再发送」或客户端按 index 重排。
2. **Job2**：对本次会话日志跑 `analyze_jobs_per_service_flow.ps1`，看 Job2 的 ASR/NMT/TTS 各阶段输入输出及 missing/partial 标记。
3. **Job8**：在 NMT 服务日志中确认该请求的 `context_text` 与 `text`，并检查返回的 `translatedText` 是否包含 context 或多句合并。
4. **语义修复与长句**：确认语义修复服务已启动且无跳过日志；再读一段长句（>40 字），看原文与译文是否已为修复后内容，且无「半句丢失」。

---

## 四、文档与设计约定更新

- **JOB_CONTEXT_FIELDS_AND_FLOW_2026_01_29.md**：  
  - 翻译步骤：读「`repairedText`（优先）或 `segmentForJobResult`」作为 NMT 输入。  
  - ResultBuilder：`text_asr` 使用「`repairedText`（优先）或 `segmentForJobResult`」。  
- **TextForwardMergeManager**：所有 SEND 分支（含 >40 字）均需设置 `segmentForCurrentJob`，保证聚合步骤始终有本段。
