# 集成测试日志分析报告（2026-01-28）

## 一、测试概况

- **阅读文本**：用户提供的长段语音识别稳定性测试文本（约 4 段）
- **返回结果**：原文 (ASR) 共 14 条 [0]–[13]，译文 (NMT) 对应 14 条
- **日志文件**：`electron_node/electron-node/logs/electron-main.log`（sessionId: s-C3A0AE9C）

## 二、各 Job 在各服务中的处理过程

### 2.1 流程概览

从日志可确认，每个 job 的 **实际执行顺序** 为：

1. **ASR**（或跳过，因 providedCtx 已带 asrText）
2. **AGGREGATION** → 设置 `ctx.aggregatedText`、`ctx.shouldSendToSemanticRepair`
3. **DEDUP** → `runDedupStep`
4. **TRANSLATION** → `runTranslationStep`（使用 `ctx.repairedText || ctx.aggregatedText || ctx.asrText`）
5. **TTS** → `runTtsStep`

**语义修复步骤（SEMANTIC_REPAIR）未出现在上述链路中**：  
日志中没有任何 `runSemanticRepairStep`、`SemanticRepairStage` 或 `repairedText` 相关记录。

### 2.2 各 Job 输入/输出摘要

| utteranceIndex | 聚合输出 (aggregatedTextPreview) | shouldSendToSemanticRepair | 翻译输入 (textToTranslate) | NMT 输出 |
|----------------|----------------------------------|----------------------------|----------------------------|---------|
| 0 | 我们开始进行一次语音识别稳定性测试 | true | 我们开始进行一次语音识别稳定性测试 | We are starting to perform a voice-identification stability test. |
| 1 | 语音两句比较短的话用来确认…在没有评 | false（等待合并） | 语音两句比较短的话… | Two short words are used to confirm… |
| 2 | 必要的时候提前结束本次识别 | true | 必要的时候提前结束本次识别 | If necessary, terminate this identification in advance. |
| 6 | 这一句我会尽量连续地说的尝一些… | false | 这一句我会尽量连续地说的尝一些… | This phrase I will try to say… |
| 7 | 或10秒钟之后系统会不会因为超时… | false | 或10秒钟之后系统会不会… | Or, after 10 seconds, the system will not… |
| 8 | 前半句和后半句在几点端被猜成… | true | 前半句和后半句在几点端被猜成… | The first and last half sentences… |
| 10 | 这次的长距能够被完整的识别出来… | true | 这次的长距能够被完整的识别出来… | This long distance can be fully identified… |
| 11 | 我们当前的切分策略和超市规则是基本可用的 | true | 我们当前的切分策略和超市规则是基本可用的 | Our current cutting strategies and supermarket rules… |
| 12 | 我们还需要继续分析日治找出到底是哪一个关节把我的云吃掉了 | true | 我们还需要继续分析日治找出到底是哪一个关节把我的云吃掉了 | We need to continue analyzing the day… |
| 13 | （对了 / 被 shouldDiscard 等逻辑处理） | false | 对了 | right is. |

说明：

- **翻译输入** 与 **聚合输出** 完全一致，说明翻译步骤使用的是 `ctx.aggregatedText`（或 asrText），没有使用 `ctx.repairedText`。
- 翻译步骤代码为：`const textToTranslate = ctx.repairedText || ctx.aggregatedText || ctx.asrText || ''`。  
  若语义修复曾执行并写入 `ctx.repairedText`，这里应优先用 `repairedText`；日志表明始终未使用到修复结果，即 **语义修复未参与链路**。

## 三、语义修复是否生效

### 3.1 结论：**未生效**

依据：

1. **无语义修复执行日志**  
   全日志中无：`runSemanticRepairStep`、`SemanticRepairStage`、语义修复服务 INPUT/OUTPUT、`repairedText` 等。

2. **Pipeline 实际步骤顺序**  
   对每个 job 可见顺序为：  
   `runAggregationStep: Aggregation completed` → `runDedupStep` → `runTranslationStep: Two-way mode` → `TranslationStage: Sending text to NMT` → …  
   中间没有 SEMANTIC_REPAIR 步骤执行记录。

3. **翻译输入 = 聚合输出**  
   `textToTranslate` 与 `aggregatedTextPreview` 一致，且存在明显 ASR 同音字/错字（如「超市」「日治」「关节」「云」等），未被修正，进一步说明语义修复未运行。

### 3.2 原因分析（为何 SEMANTIC_REPAIR 被跳过）

- Pipeline 步骤序列（mode.steps）为：  
  `['ASR', 'AGGREGATION', 'SEMANTIC_REPAIR', 'DEDUP', 'TRANSLATION', 'TTS']`  
  即 SEMANTIC_REPAIR 应在 AGGREGATION 之后、DEDUP 之前执行。

- 是否执行 SEMANTIC_REPAIR 由 `shouldExecuteStep(step, mode, job, ctx)` 决定，其中对 SEMANTIC_REPAIR 的逻辑为：  
  `return ctx?.shouldSendToSemanticRepair === true;`

- 日志中多处出现 `"shouldSendToSemanticRepair":true`（如 utteranceIndex 0、2、8、10、11、12），说明 **聚合阶段** 已正确设置“应送语义修复”的意图。

- 尽管如此，SEMANTIC_REPAIR 仍被跳过，说明在 **执行到 SEMANTIC_REPAIR 时**，`shouldExecuteStep` 得到的是 `false`，即此时 `ctx?.shouldSendToSemanticRepair !== true`（多为 `undefined`）。

可能原因包括（需结合代码与单步调试进一步确认）：

1. **ctx 引用或赋值时机**  
   AGGREGATION 中设置的是 `ctx.shouldSendToSemanticRepair`，若在某种调用路径下传入 `shouldExecuteStep` 的 `ctx` 与执行 AGGREGATION 的 `ctx` 不是同一引用，或在该步之后被覆盖，则会出现“聚合里为 true、判断时为 undefined”的情况。

2. **可选字段未写入**  
   `aggregationResult.shouldSendToSemanticRepair` 在部分分支可能为 `undefined`（例如某些 early return 或未走 forwardMergeResult 的路径），导致 `ctx.shouldSendToSemanticRepair` 从未被设为 `true`。  
   当前日志显示聚合日志里为 true，至少说明“正常路径”的返回值是对的；若存在多条 pipeline 调用路径，需逐条确认是否都正确写回了 `ctx`。

3. **类型/接口与运行时行为**  
   此前已对 `shouldExecuteStep` 的 `ctx` 参数改为 `JobContext` 类型，类型层面应能正确访问 `shouldSendToSemanticRepair`；若问题仍存在，更可能是 **运行时** 的 ctx 内容或传递链路与预期不符，需在 SEMANTIC_REPAIR 判断处打点确认 `ctx` 与 `ctx.shouldSendToSemanticRepair` 的实际值。

## 四、与用户返回结果的对应关系

- 用户看到的「原文 (ASR)」与日志中的 `aggregatedTextPreview` / NMT 输入一致，且仍保留 ASR 错误（如「超市」「日治」「关节」「云」「长距」等），与“未经过语义修复”的结论一致。
- 用户看到的「译文 (NMT)」与日志中的 NMT OUTPUT 一致，说明翻译阶段工作正常，只是输入为“未修复的 ASR/聚合文本”。

## 五、建议的下一步

1. **确认 SEMANTIC_REPAIR 被跳过的具体原因**  
   - 在 `job-pipeline.ts` 的 `for (const step of mode.steps)` 中，当 `step === 'SEMANTIC_REPAIR'` 时，打印或打点：  
     `ctx === ?`、`ctx.shouldSendToSemanticRepair === ?`、`shouldExecuteStep(step, mode, job, ctx) === ?`。  
   - 确认与执行 AGGREGATION 的 `ctx` 是否为同一对象，以及 AGGREGATION 返回后该对象上 `shouldSendToSemanticRepair` 是否已为 `true`。

2. **确认所有聚合返回路径**  
   - 检查 `aggregation-stage.ts` 中所有 `return` 路径，是否都显式设置了 `shouldSendToSemanticRepair`（或至少在主路径上保证与 forwardMergeResult 一致），避免在部分分支漏设导致为 `undefined`。

3. **修复通过后再做一次集成测试**  
   - 期望现象：  
     - 出现 `runSemanticRepairStep` 或 SemanticRepairStage 的日志；  
     - `textToTranslate` 与语义修复后的文本一致（或至少与 aggregatedText 有差异）；  
     - 原文中的同音字/错字在修复后有所纠正。

---

**报告结论**：本次集成测试中，各 job 在 ASR → 聚合 → 去重 → 翻译 → TTS 链路上处理正常，输入输出与日志一致；**语义修复未生效**，SEMANTIC_REPAIR 步骤被跳过，翻译直接使用了聚合/ASR 文本，未使用 `repairedText`。建议按上述步骤定位 `ctx.shouldSendToSemanticRepair` 在判断时为 undefined 的原因并修复。
