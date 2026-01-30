# 语义修复未生效：根因与修复（2026-01-28）

## 现象

集成测试中原文存在 ASR 错误（如「超市」「日治」「关节」「云」「監獄」「背積點」等），译文直接基于错误原文翻译，语义修复未参与链路。

## 根因

**NodeAgent 从未调用 `inferenceService.setServicesHandler(this.servicesHandler)`。**

- `app-init-simple.ts` 创建 InferenceService 时传入 `servicesHandler: null`，故 `servicesBundle.semanticRepairInitializer` 从未被创建。
- NodeAgent 内部有 `this.servicesHandler = new ServicesHandlerSimple(...)`，用于心跳/注册等，但从未注入到 InferenceService。
- 因此：
  1. Pipeline 中 SEMANTIC_REPAIR 步骤**会执行**（`ctx.shouldSendToSemanticRepair` 已由 aggregation-step 正确设置）。
  2. `runSemanticRepairStep` 一进入就命中 `if (!services.servicesHandler || !services.semanticRepairInitializer)`，直接 `ctx.repairedText = textToRepair` 并 return，**从未调用语义修复服务**。

## 修复

- **node-agent-simple.ts**：在 `init()` 中，在 `setResultSender` 之后增加一行：  
  `this.inferenceService.setServicesHandler(this.servicesHandler);`  
  这样 InferenceService 会创建 SemanticRepairInitializer 并写入 servicesBundle，后续 SEMANTIC_REPAIR 步骤会真正调用语义修复。
- **semantic-repair-step.ts**：在“无 initializer 时跳过”的分支增加一条 `logger.debug`，便于在日志中区分“步骤执行但未调服务”的情况。

## 如何在节点端日志中核对每个 job 在各服务的处理

建议在节点日志（如 `main/logs/electron-main.log`）中按 job_id / utterance_index 搜索以下关键字，确认输入/输出与是否走语义修复：

| 步骤 | 日志关键字 | 含义 |
|------|------------|------|
| 聚合 | `runAggregationStep: Aggregation completed` | 聚合完成，可看 `aggregatedTextLength`、`action` |
| 聚合 | `AggregationStage: Processing completed with forward merge` | 含 `shouldSendToSemanticRepair`、`aggregatedTextPreview` |
| 语义修复 | `runSemanticRepairStep: Semantic repair completed` | 语义修复已执行，含 `originalText`/`repairedText` 前 100 字、`decision`、`textChanged` |
| 语义修复 | `runSemanticRepairStep: skipped (no semantic repair initializer)` | 未注入 initializer，直接使用聚合文本（修复前会出现） |
| 翻译 | `runTranslationStep` / TranslationStage 相关日志 | 翻译输入为 `ctx.repairedText \|\| ctx.aggregatedText \|\| ctx.asrText`，若语义修复生效，这里应是修复后文本 |

修复后重新跑集成测试，应能看到 `runSemanticRepairStep: Semantic repair completed` 以及 `InferenceService: ServicesHandler updated`（NodeAgent 初始化时一次）。
