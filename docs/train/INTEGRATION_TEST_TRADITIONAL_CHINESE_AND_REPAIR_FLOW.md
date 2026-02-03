# 集成测试：繁体字与同音纠错/语义修复流程说明

本文档说明：**为何返回的「原文 (ASR)」是繁体**、**同音纠错与语义修复在什么条件下执行**、**谁负责繁→简**，以及如何用节点端日志确认每个 job 在各服务中的处理过程。

---

## 1. 为何返回的原文是繁体？

### 1.1 数据流与责任分工

- **前端「原文 (ASR)」** 来自调度下发的 job 结果字段 **`text_asr`**。
- 节点端 **`text_asr`** 仅来自 **`ctx.repairedText`**（见 `result-builder.ts`），即：**只有语义修复/聚合产出的「修复后本段」才会作为原文发给前端**；没有「用 ASR 原始或同音纠错结果兜底」的逻辑。

因此：

- 若 **语义修复步骤未执行** 或 **未成功写回 `repairedText`**：  
  - 聚合步骤在 `shouldSendToSemanticRepair === false` 时会置 `ctx.repairedText = ''`，最终 `text_asr` 为空；  
  - 若前端在 `text_asr` 为空时用其它字段（如 ASR 原始或 segment）展示「原文」，则会看到 **未经过语义修复的文本**，即可能是 **ASR 原始输出（繁体）**。
- 若 **语义修复步骤被执行但失败/REJECT**：  
  - `runSemanticRepairStep` 在 catch 或 REJECT 分支会写 `ctx.repairedText = textToRepair`（即**同音纠错后的 `segmentForJobResult`**）；  
  - **同音纠错服务不做繁→简**（见下），若 ASR 输出为繁体，则 `textToRepair` 仍为繁体，最终 `text_asr` 也是繁体。
- 若 **语义修复服务未 warmed 或健康检查失败**：  
  - Task Router 会抛错「Semantic repair service not available (not warmed), failing job」，step 进入 catch，同样 `ctx.repairedText = textToRepair`，结果仍是繁体（若同音纠错未做繁→简）。

**结论**：出现「原文全是繁体」说明 **语义修复未成功产出简体**，可能原因包括：  
1）语义修复步骤未执行（`shouldSendToSemanticRepair === false`）；  
2）语义修复服务不可用/未 warmed，请求失败后用 `textToRepair` 兜底；  
3）语义修复服务未安装/未启用 OpenCC 繁→简，或 t2s 失败，返回了繁体。

---

## 2. 同音纠错与语义修复：谁做繁→简？

### 2.1 同音纠错（phonetic_correction_zh）

- **位置**：Pipeline 中在 **AGGREGATION** 之后、**SEMANTIC_REPAIR** 之前（`pipeline-mode-config.ts`）。
- **输入**：`ctx.segmentForJobResult`（聚合后的本段文本）。  
- **输出**：写回 `ctx.segmentForJobResult`；语义修复步骤读取的 `textToRepair` 即此值。
- **是否做繁→简**：**不做**。  
  - 服务端 `phonetic_correction_zh` 的混淆集（`confusion_set.py`）为 **仅简体** 同音字组；  
  - 对繁体字不会做替换或转换，繁体会原样保留。  
- **执行条件**（`pipeline-mode-config.ts` → `shouldExecuteStep`）：  
  - `ctx.shouldSendToSemanticRepair === true` **且** `src_lang === 'zh'`（或检测为中文）。

因此：若 ASR 输出繁体，同音纠错后 **仍然是繁体**；繁→简只会在语义修复阶段做。

### 2.2 语义修复（semantic-repair-en-zh，zh 分支）

- **位置**：同音纠错之后、DEDUP/TRANSLATION 之前。
- **输入**：`ctx.segmentForJobResult`（即同音纠错后的本段）。
- **输出**：写回 `ctx.repairedText`，并作为 **`text_asr`** 和 NMT 输入。
- **是否做繁→简**：**做**。  
  - `zh_repair_processor.py` 中：  
    - 调用 LLM 前先用 OpenCC("t2s") 将输入转为简体；  
    - LLM 输出后再做一次繁→简，保证输出统一为简体。  
  - 若未安装 OpenCC 或 t2s 失败，则可能返回繁体。
- **执行条件**：  
  - `ctx.shouldSendToSemanticRepair === true`（由 **AGGREGATION** 步骤根据合并/发送策略设置）。

**小结**：  
- **同音纠错**：只做同音字替换（仅简体混淆集），**不**做繁→简。  
- **语义修复**：负责繁→简 + 语义纠错；只有语义修复成功且 OpenCC 正常时，前端「原文」才会是简体。

---

## 3. 如何用日志确认每个 job 的处理过程？

### 3.1 推荐：按 Job 分析脚本

节点端提供了按 job 分析各阶段输入/输出的脚本（含 ASR、聚合、语义修复、NMT、TTS）：

```bash
# 在 electron_node 目录下
node scripts/analyze_jobs_per_service_flow.js [日志路径] [--out report.md]
```

- **默认日志路径**：`electron_node/electron-node/logs/electron-main.log`（若不存在，请把本次测试的 main 进程日志路径作为第一个参数传入）。
- 输出会按 `utterance_index` 排序，列出每个 job 的：  
  - [ASR] 输出  
  - [聚合] segmentForJobResult、shouldSendToSemanticRepair  
  - [语义修复] 是否执行、repairedText 预览  
  - [NMT] 输入/输出  
  - [TTS] 是否有音频  
  - 以及 Summary 表与异常行。

用该脚本可快速确认：  
- 哪些 job 的 `shouldSendToSemanticRepair` 为 true/false；  
- 哪些 job 显示「语义修复 未执行」或「repairedText 为空」；  
- 若某 job 的 repairedText 预览仍是繁体，说明语义修复未成功产出简体（未执行、失败兜底、或服务未做繁→简）。

### 3.2 关键日志关键词（手工 grep）

- **同音纠错**  
  - `Phonetic correction step done`：同一条会带 `job_id`、`text_in_preview`、`text_out_preview`、`changed`。  
  - 若某 job 没有这条，说明同音纠错步骤未执行（例如 `shouldSendToSemanticRepair === false` 或非中文）。

- **语义修复**  
  - `Semantic repair job input (sending to service)` / `Semantic repair job output (received from service)`：请求前后各一条，含 `text_in_preview` / `text_out_preview`、`decision`。  
  - `runSemanticRepairStep: Semantic repair completed`：含 `originalText`/`repairedText` 前 100 字、`decision`。  
  - `runSemanticRepairStep: semantic repair required but ...` / `Semantic repair failed, using original text`：未执行或失败，会用 `textToRepair` 写回 `repairedText`（可能是繁体）。

- **语义修复服务不可用**  
  - `Semantic repair service not available (not warmed), failing job`：健康检查未通过（例如 `/health` 缺少 `warmed: true`），请求未发出即失败，step 会 catch 并 `ctx.repairedText = textToRepair`。

- **聚合与是否送语义修复**  
  - `runAggregationStep: Aggregation completed`：同一行或附近会有 `segmentForJobResult`、`shouldSendToSemanticRepair` 的上下文。  
  - `Turn segment accumulated, waiting for finalize`：本段未送语义修复（`shouldSendToSemanticRepair = false`）。

按 job_id 或 utterance_index 把上述几类日志串起来，即可还原：  
ASR → 聚合 → 同音纠错（若有）→ 语义修复（若有）→ 写入 `repairedText` → 作为 `text_asr` 发往调度/前端。

---

## 4. 可选改进方向

1. **保证语义修复服务必可用且返回简体**  
   - 确认 `semantic-repair-en-zh` 的 `/health` 返回顶层 **`warmed: true`**（或 `model_warmed` / `status: 'ready'|'warmed'`），避免节点因「未 warmed」直接失败并用 `textToRepair` 兜底。  
   - 确认语义修复所在环境已安装 **OpenCC**，且 zh 分支的 `_to_simplified` 正常执行。

2. **同音纠错前增加繁→简（可选）**  
   - 若希望「即使用户未启用或未成功调用语义修复，原文也尽量是简体」，可在节点端在调用同音纠错前对 `segmentForJobResult` 做一次繁→简（或在同音纠错服务内对输入先做 t2s），这样即使语义修复未执行或失败，兜底的 `textToRepair` 至少是简体。  
   - 当前设计是「繁→简仅在语义修复内做」，若要保持单一职责，可仅做 1）。

3. **前端展示策略**  
   - 若 `text_asr` 为空，当前是否用 ASR 原始或其它字段展示「原文」取决于前端实现；若希望用户始终看到「经过语义修复（且简体）的原文」，应保证只展示 `text_asr`，并在节点端保证语义修复执行且成功写回 `repairedText`。

---

## 5. 与现有文档的关系

- **语义修复 Job 日志排查**：`electron_node/electron-node/docs/SEMANTIC_REPAIR_JOB_LOG_CHECK.md` 主要讲语义修复的 input/output 与合并逻辑。  
- **本文档**：侧重「为何是繁体」、同音纠错 vs 语义修复的责任、以及如何从日志确认整条链路（含同音纠错与语义修复是否执行、是否成功产出简体）。

建议排查顺序：  
1）运行 `analyze_jobs_per_service_flow.js` 看每个 job 的 Summary 与语义修复是否执行；  
2）对「原文为繁体」的 job，用上述关键词在日志中查同音纠错与语义修复的输入/输出及错误信息；  
3）确认语义修复服务 `/health` 与 OpenCC 状态。
