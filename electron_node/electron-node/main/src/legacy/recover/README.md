# Legacy Recover Modules

**Status:** Deprecated / Recover-only / **Not part of FW frozen main chain**

规范 SSOT：`electron-node/docs/FW_MAINLINE_FREEZE.md`（Legacy Recover Boundary 见 PIPELINE.md §3.5）

## Purpose

本目录归档已从默认 ASR→FW 主链隔离的 Recover 旧链路（CTC n-best、句级 expansion、KenLM rerank apply、LEXICON_RECALL / SENTENCE_REPAIR pipeline 步骤）。

用途仅限：

- 历史对照与回归基线
- Recover 专用 / legacy 测试
- 非默认 Recover pipeline 模式（`fw_detector_v1` 之外）
- 后续物理删除前的归档

**新功能不得添加到本目录。新修复不得基于本目录。**

## Directory Contents

| 路径 | 职责 |
|------|------|
| `legacy-recover-contract.ts` | Recover extra / lifecycle 契约（`buildLegacyRecoverContractExtra`） |
| `legacy-recover-contract-types.ts` | Recover lifecycle 类型 |
| `legacy-recover-result-extra.ts` | 非 FW 模式 result.extra 打包 |
| `legacy-v5-metrics.ts` | V5 批测指标 |
| `steps/legacy-lexicon-recall-step.ts` | Window hotword recall（`runLegacyLexiconRecallStep`） |
| `steps/legacy-sentence-repair-step.ts` | 句级 expansion + rerank + apply（`runLegacySentenceRepairStep`） |
| `asr-repair/sentence-expansion/` | 窗扩展候选 |
| `asr-repair/sentence-rerank/legacy-apply-sentence-repair.ts` | 句级 apply（`applyLegacySentenceRepair`） |

**KenLM shared scorer 不在本目录：** FW Detector `weak_veto` 共用模块位于 `main/src/asr-repair/`（`kenlm-batch-types.ts`、`sentence-rerank/kenlm-scorer.ts`、`kenlm-span-gate.ts`）。**KenLM shared scorer is not legacy Recover.**

## Do Not Import From

以下 FW 冻结主链模块 **不得** import `legacy/recover`：

- `fw-detector/*`
- `pipeline/steps/fw-detector-step.ts`
- `pipeline/steps/aggregation-step.ts`
- `pipeline/steps/dedup-step.ts`
- `pipeline/steps/translation-step.ts`
- `pipeline/result-builder.ts`（非 FW 路径经 `pipeline/recover-result-bridge.ts` 桥接，不得直接 import）
- `pipeline/post-asr-routing.ts`

若发现主链依赖 `legacy/recover`，视为 **冻结门禁失败**（`scripts/fw-detector-gate.mjs` + `freeze-contract.test.ts`）。

## Allowed Usage

- `legacy/recover/**` 内部互引
- legacy recover 测试（`*.test.ts`，describe 须含 `legacy recover only`）
- `pipeline/pipeline-step-registry.ts` 注册 legacy steps（须带 Legacy Recover 注释；FW mode 由 `applyFwDetectorPipelineMode` 移除）
- `pipeline/job-pipeline.ts`、`pipeline/context/job-context.ts` 类型 / skip 标记（非 FW 执行路径）
- `pipeline/recover-result-bridge.ts` 桥接非 FW result extra
- archived comparison scripts / 非默认 Recover 模式

## Deletion Conditions

满足以下全部条件后可删除本目录：

- [ ] 无 production config 引用 Recover 模式（`lexiconRecall.enabled` 等）
- [ ] `legacy-recover-contract` 等测试已归档或迁移
- [ ] `FW_MAINLINE_FREEZE.md` 与 `PIPELINE.md` 已更新
- [ ] 全仓无 `legacy/recover` import（registry / bridge / job-context 除外或一并移除）
- [ ] `fw-detector-gate.mjs` 与 `freeze-contract.test.ts` 仍 PASS

## Tests

```powershell
cd electron_node/electron-node
npm run test:recover
```

或：

```powershell
npx jest --testPathPattern="legacy/recover|legacy-recover-contract"
```
