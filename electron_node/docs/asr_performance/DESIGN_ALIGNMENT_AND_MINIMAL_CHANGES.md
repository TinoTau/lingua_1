# 设想与当前实现的对齐 + 最小改动可行性

**日期**：2026-01-28  
**目标**：用「谨慎调整」把当前实现对齐到你的设想，不新增多余路径、不堆保险逻辑、保持简洁；若存在无法避免的问题先说明。

---

## 一、你的设想（精炼）

1. **收到 job 就建一个 jobResult 容器**，全程唯一。
2. **AudioAggregator 之后**：音频被切片，切片存到 **jobResult 的数组**里。
3. **ASR 之后**：识别文本存到 **另一个 str 数组**里。
4. **送语义修复前**：把 str 数组**按顺序拼成长句**，**按字符数**决定：直接送语义修复，还是等后续 job 的识别文本再拼。
5. **语义修复出来**：得到一句长句 → NMT → TTS。
6. **每一步**都能拿到前面所有结果，**只用一个 jobResult 容器**。
7. 这样节点可根据 web 端选择执行哪些服务、返回什么结果。

---

## 二、当前实现与设想的对应关系

| 设想 | 当前实现 | 是否一致 |
|------|----------|----------|
| 收到 job 就建 jobResult 容器 | 收到 job 后 `initJobContext(job)` 得到 **ctx**，贯穿整条 pipeline | ✅ 一致（ctx 即「唯一容器」） |
| 容器内存「音频切片数组」 | 有 `audioSegments`，但只在 asr-step 局部使用；ctx 只存了合并后的 `ctx.audio` | ⚠️ 缺：ctx 里没有显式的「音频切片数组」 |
| 容器内存「str 数组」 | 有 `ctx.asrText`（已拼好的串）和 `ctx.asrSegments`（带 text 的 segment 数组） | ✅ 可视为一致（asrSegments 即按序的「str 数组」） |
| 送语义修复前：str 数组按序拼成长句 + 按字符数决定送/等 | 聚合步骤产出 `ctx.aggregatedText`，并设 `ctx.shouldSendToSemanticRepair`（是否送、是否等更多由聚合/会话状态决定） | ✅ 逻辑已有，只是分散在 Aggregator 等处 |
| 语义修复 → 一句长句 → NMT → TTS | `ctx.repairedText` → translation-step → `ctx.translatedText` → tts-step → `ctx.ttsAudio` | ✅ 一致 |
| 每一步都能拿前面所有结果、唯一容器 | 各步骤都只读/写 **ctx**，最后 `buildJobResult(job, ctx)` 得到对外 JobResult | ✅ 一致 |
| 唯一路径、唯一返回值、唯一发送 | 当前存在 **asr-step 内对 original job 的 send**，以及 **空容器在 asr-step 内 send** | ❌ 不符合 |

**结论**：  
- 「唯一 jobResult 容器、各步只改这一份、按 web 选择执行服务并返回」这套设想，在当前代码里**架构上已经具备**（ctx + 步骤串联 + 最后 buildJobResult）。  
- 和设想**不一致**的主要有两点：  
  1) 容器里没有显式保存「音频切片数组」；  
  2) **存在第二条发送路径**（asr-step 内发送 + 空容器发送），破坏了「唯一路径、唯一返回值、唯一发送」。

---

## 三、能否「只做谨慎调整」就对齐设想

可以，但需要接受**一处结构性的谨慎调整**（不是小补丁）：

- **唯一必须的架构级改动**：  
  去掉 asr-step 内的发送，改为把 **original job 的结果回填到当前 job 的 ctx（唯一容器）**，然后**只由 node-agent 在 pipeline 结束后发一次**。  
  这样才满足：  
  - 一个 job 对应一个 jobResult 容器（ctx）；  
  - 所有结果（包括「切片→ASR→拼接→语义修复→NMT→TTS」）都先写入这个容器；  
  - 发送只在唯一出口发生。

- **其余对齐设想的改动**都可以做得很小：  
  - 在 ctx 里增加「音频切片数组」的显式存储（可选，便于排查和与设想一致）；  
  - 不新增流程、不新增发送路径、不增加兼容或保险逻辑。

下面分「最小必要改动」和「可选的小增强」说清楚。

---

## 四、最小必要改动（只做这些即可对齐「唯一路径 + 唯一容器」）

### 4.1 必须做：asr-step 不再发送，改为回填到 ctx（唯一容器）

- **位置**：`pipeline/steps/asr-step.ts`，dispatcher 的 callback 里，original job 的 `runJobPipeline` 完成后。
- **当前**：  
  `runJobPipeline(originalJobMsg, originalCtx)` 得到 `result` 后，调用 `services.resultSender.sendJobResult(originalJobMsg, result, ...)`。
- **改为**：  
  - 删除这段 `sendJobResult` 调用（以及仅用于「空容器核销」的 asr-step 内发送，见下）。  
  - 把 `result` **回填到当前 job 的 ctx**（当前 runAsrStep 的 `job`/`ctx` 就是「唯一容器」）：  
    - 若当前设计是 **单 original job 对应当前 container**（即 `originalJobIds.length === 1` 且 `originalJobIds[0] === job.job_id`），则用 `result` 覆盖/填充 ctx 的 asrText、aggregatedText、repairedText、translatedText、ttsAudio 等（与 pipeline 各步写入的字段一致）。  
    - 若存在 **多 original job**，需先定策略：是合并多段文本到 ctx 的一个长句，还是只认「当前 container 对应其中一个 original job」再回填那一个 result（详见之前 ARCHITECTURE_RESTORATION_FEASIBILITY）。
- **空容器**：  
  若希望「空容器」也走唯一路径，则 asr-step 内**不要**再对空容器调用 `sendJobResult`，而是给 ctx 设「空结果」标记或空文本，由后续步骤 + 最后 node-agent 统一发一条（空）结果。

这样改后：  
- 所有结果都先进入「唯一 jobResult 容器」ctx；  
- 发送只发生在 node-agent 的「processJob 返回后发一次」；  
- 不增加新路径、不增加新发送点。

### 4.2 必须做：node-agent 只发一次、且只认容器里的结果

- **位置**：`agent/node-agent-simple.ts`。  
- **当前**：  
  已有「processJob 返回后根据 finalResult 发一次」的逻辑；另有对 `originalJobResultsAlreadySent` 的判断用于避免重复发。  
- **改为**：  
  - 删除对 `originalJobResultsAlreadySent` 的判断（因为 asr-step 不再发送，不会再出现「先发一次再发空」）。  
  - 保持「只根据 processJob 返回的 finalResult 发一次」这一条路径。

### 4.3 必须做：去掉「补丁」标记

- **位置**：  
  - `pipeline/steps/asr-step.ts`：不再设置 `(ctx as any).originalJobResultsAlreadySent = true`。  
  - `pipeline/result-builder.ts`：不再向 `extra` 写入 `originalJobResultsAlreadySent`。

这样，唯一容器、唯一路径、唯一发送在代码里就一致了，且没有「打补丁」的标记。

---

## 五、可选的小增强（更贴近你「设想」的表述，不改架构）

在「唯一容器 + 唯一发送」已通过上面改完的前提下，下面都是**可选**的、谨慎的小调整，方便和「设想」一一对应，也方便排查问题。

1. **jobResult 里显式有「音频切片数组」**  
   - 在 **JobContext** 增加字段，例如：`audioSegments?: string[]`（base64 切片）。  
   - 在 asr-step 里，在拿到 `audioProcessResult.audioSegments` 后，赋给 `ctx.audioSegments = audioProcessResult.audioSegments`（或等价来源）。  
   - 不在别处新增逻辑，只存一份，供后续步骤或日志使用。

2. **jobResult 里显式有「str 数组」**  
   - 当前已有 `ctx.asrSegments`（每段带 text），可视为「str 数组」；若你希望是纯粹的 `string[]`，可在 ctx 增加 `asrTextSegments?: string[]`，在 ASR 结果写入时按序填进去，语义修复前用「按序拼接」得到长句（或直接沿用现有 `aggregatedText` 的拼接逻辑）。  
   - 不新增分支，只让「str 数组 → 按序拼成长句」在数据结构上更明显。

3. **「按字符数决定送语义修复还是等」**  
   - 当前「送不送、等不等」由聚合/会话状态和 `shouldSendToSemanticRepair` 决定，逻辑已存在。  
   - 若希望和「字符数」的表述完全一致，可在**聚合步骤或聚合阶段**里，把「长度/字符数」作为判断条件之一写清楚（例如超过某长度就送，否则等），不增加新流程，只让现有逻辑更可读。

以上都不引入新发送路径、不增加兼容层、不堆保险逻辑。

---

## 六、无法避免的问题（需要你先拍板）

1. **多 original job（一个 container 对应多段切片/多 job）**  
   - 当前：多个 original job 各自跑完 pipeline，若都不再在 asr-step 发送，就必须把「多段结果」汇总进**当前 job 的唯一天 ctx**。  
   - 需要你定的策略：  
     - 是「按序合并多段 text 成一句」再走语义修复/NMT/TTS？  
     - 还是「一个 container 只对应一个 original job」，多出来的另做约定？  
   - 一旦策略定下来，回填逻辑就按该策略实现，不再加额外分支。

2. **pendingMaxDurationAudio（等后续 chunk 再拼）**  
   - 当前：dispatcher 可能晚一点才回调（例如 TTL 或后续 batch 到达），此时 container 的 pipeline 可能已经在跑甚至已经结束。  
   - 若坚持「唯一容器、唯一路径」：  
     - 要么 container 的 pipeline 在 ASR 步骤里**同步等待**「本 job 对应的所有 original 结果都回填完」再继续（可能要做等待/同步点）；  
     - 要么接受「先回填已到的，未到的用 TTL/后续 job 再触发一次 pipeline 或只更新容器」等约束。  
   - 需要你选一种方式，再在 asr-step + dispatcher 上做**最小必要**的同步/回填，而不是加多层保险逻辑。

3. **空容器（没有分配到任何切片的 job）**  
   - 若坚持「所有结果都从唯一出口发」：  
     - 空容器也应通过「写 ctx（空结果）」+ 正常走完 pipeline（或提前结束但统一从 node-agent 发），由 node-agent 发**一条**空结果。  
   - 即：asr-step 内不再对空容器单独 `sendJobResult`，只改 ctx，由唯一出口发。

---

## 七、总结

| 问题 | 结论 |
|------|------|
| 你的设想能否在现有代码里用「谨慎调整」实现？ | **能**。唯一必须的架构调整是：asr-step 不再发送，改为把 original job 结果**回填到当前 job 的 ctx**，并由 node-agent **只发一次**。 |
| 会不会新增多余路径/重复逻辑？ | **不会**。按要求只做「删 asr-step 发送 + 回填 ctx + 去掉补丁标记」，可选地增加 ctx 的「音频切片数组」「str 数组」等显式字段，不增加新流程。 |
| 有没有无法避免、需要你先定的东西？ | **有**：  
  1) 多 original job 时，结果如何合并进唯一天 ctx（策略一条）；  
  2) pendingMaxDurationAudio 下，是同步等还是接受「部分先回填」等约束；  
  3) 空容器统一从 node-agent 发一条（asr-step 不再发）。 |

建议顺序：  
1) 你先确认上面三条「无法避免」的选择；  
2) 再按第四节做最小必要改动；  
3) 需要的话再按第五节加可选的小增强，使实现和「设想」的表述完全一致。  
这样可以在不大改、不堆补丁的前提下，让当前实现符合你描述的「唯一 jobResult 容器、唯一路径、按 web 选择执行服务并返回」的设计。
