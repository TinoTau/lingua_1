# 所有 ASR 结果必须经语义修复

## 设计

所有**需要发送**的 ASR 识别结果都必须经过语义修复服务处理后再作为「原文」(text_asr) 返回。不允许在语义修复不可用时透传 ASR 原文。

## 代码逻辑

1. **何时“需要发送”**
   - 由聚合阶段（AggregationStage / TextForwardMergeManager）决定：`shouldSendToSemanticRepair === true` 时，本段会进入语义修复步骤；为 `false` 时（如 HOLD、DROP）不发送本段，也不执行语义修复步骤。

2. **语义修复步骤（runSemanticRepairStep）**
   - 仅当 `segmentForJobResult` 非空且本 job 需发送时才会执行该步骤（pipeline 根据 `ctx.shouldSendToSemanticRepair === true` 决定是否执行）。
   - 执行时**必须**调用语义修复服务（SemanticRepairStage.process）。若服务不可用，**不得**透传原文：
     - 不可用情形：无 `semanticRepairInitializer`、无 `servicesHandler`、初始化失败、`getSemanticRepairStage()` 返回 null。
     - 行为：`ctx.repairedText = ''`，`ctx.shouldSend = false`，记录错误日志；该 job 结果不发送（result 中 `should_send: false`，且 `text_asr` 为空）。

3. **结果构建（buildJobResult）**
   - `text_asr` 仅来自 `ctx.repairedText`。当语义修复不可用且未透传时，`repairedText` 为空，故 `text_asr` 为空；`should_send` 为 false 时由调用方决定是否上报该结果。

## 为何集成测试中原文全是繁体

若集成测试中看到的原文全是繁体，说明当时**语义修复未真正执行**（服务未启动、未注册或 initializer 未就绪），旧逻辑会透传 ASR 原文，故展示为 ASR 直出（多为繁体）。  
逻辑调整后：语义修复不可用时不再透传，该 job 的 `repairedText` 为空且 `shouldSend` 为 false，不会产生“带原文但未经过语义修复”的结果。  
因此，若需在测试中看到经过语义修复的原文（如多为简体），需保证语义修复服务可用且 Node 端已完成 SemanticRepairInitializer 的初始化。

## 相关文件

- `electron-node/main/src/pipeline/steps/semantic-repair-step.ts`：语义修复步骤，不可用时设 `repairedText = ''`、`shouldSend = false`。
- `electron-node/main/src/pipeline/pipeline-mode-config.ts`：仅当 `ctx.shouldSendToSemanticRepair === true` 时执行 SEMANTIC_REPAIR 步骤。
- `electron-node/main/src/pipeline/result-builder.ts`：`text_asr` 仅用 `ctx.repairedText`；`should_send` 来自 `ctx.shouldSend`。
