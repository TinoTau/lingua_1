# aggregatedText 字段移除说明（2026-01-29）

## 1. 结论

**JobContext 已移除 `aggregatedText`**。下游无人读该字段，仅聚合步骤曾写入并用于本步日志与「不送语义修复时写 repairedText」；已改为不写 ctx，不送语义修复时显式 `ctx.repairedText = ''`，日志用 `aggregationResult.aggregatedText.length`（AggregationStage 返回值仍含 aggregatedText，仅不写入 ctx）。

## 2. AggregationStage 返回值

**aggregation-stage.ts** 仍返回 `aggregatedText`（SEND 时为合并长句，HOLD/丢弃时为 `''`），供 aggregation-step 打日志（如 `segmentLength: aggregationResult.aggregatedText.length`）。不写入 ctx。

## 3. 已做修改

- **job-context.ts**：删除 `aggregatedText` 字段。
- **aggregation-step.ts**：不再写 `ctx.aggregatedText`；不送语义修复时 `ctx.repairedText = ''`；日志使用 `aggregationResult.aggregatedText.length`。
- 所有引用 `ctx.aggregatedText` 的测试已改为使用 `segmentForJobResult` 或删除对应断言。
