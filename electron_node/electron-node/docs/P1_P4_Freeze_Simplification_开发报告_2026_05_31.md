# P1~P4 冻结后精简 — 开发报告

版本：V1.0  
日期：2026-05-31  
依据：`P1_P4_Freeze_Simplification_Plan_2026_05_31.md`、`FREEZE_SIMPLIFICATION_AUDIT_2026_05_27.md`

---

## 1. 开发目标

在**不修改** Metadata Gate、V2 Recall、P4 Sentence Rerank、Apply 业务算法的前提下，完成冻结主链的配置精简与 SSOT 收敛（P0），并落地批测/回滚配置基础设施（P1）。

冻结主链（不变）：

```text
ASR → FW Metadata Span Gate → Lexicon V2 Recall → P4 Sentence Rerank
→ applyFwSpanReplacements → segmentForJobResult → Aggregation → NMT
```

---

## 2. 本轮完成项

### 2.1 P0 — 必做

| 项 | 变更摘要 |
|----|----------|
| 删除死配置 | 移除 `compressionRatioThreshold`、`fwMetadataSpanGate.noSpeechProbThreshold`、根级 `enableRepairTargetFilter` |
| maxSpans SSOT | 唯一来源：`fwMetadataSpanGate.maxSpans`；`node-config-defaults` 移除根级 `maxSpans`；runtime `maxSpans` 镜像 gate |
| spanDetectBudget | fallback 改为 `max(12, gate.maxSpans * 4)` |
| segment 写锁 | `asr-step` / `fw-detector-step` 中 `segmentForJobResult` 仅用 `rawAsrText`（去掉 `?? asrText`） |
| freeze-contract | 扩展 P4 默认、死字段、双 V2 开关、maxSpans 来源等断言 |
| 文档 | `FW_MAINLINE_FREEZE.md`、`PIPELINE.md` 明确 `enableKenLMGate` 对 P4 为必需 |

### 2.2 P1 — 建议（部分完成）

| 项 | 变更摘要 |
|----|----------|
| `tests/freeze-config-ssot.json` | 批测 / patch 配置 SSOT |
| `tests/freeze-rollback-config.json` | 回滚参考（runtime 不加载） |
| `tests/lib/freeze-config-ssot.mjs` + `.cjs` | SSOT 加载与批测 report config 构建 |
| `tests/patch-p4-config.mjs` | 从 SSOT 镜像冻结默认到 `%APPDATA%` 配置 |
| `run-lexicon-v2-p4-batch.js`、`run-p4-freeze-batch.js` | 使用 `buildFreezeBatchReportConfig` |
| `run-lexicon-v2-phase3-p32-batch.js` | 标记 `@deprecated` |
| `phonetic-correction-step` | `RECOVER_WRITE_LOCKED` → `SEGMENT_WRITE_LOCKED` |
| `pipeline-step-registry.ts` | 注释满足 `fw-detector-gate.mjs` 门禁 |
| `scripts/fw-detector-gate.mjs` | 标题更新为 P1~P4 精简隔离检查 |

### 2.3 刻意延后

- P1-2：legacy 文件迁入 `legacy/fw-detector/`
- P2：JobContext 分区、5015–5017 物理迁移、Pipeline 模板解耦

---

## 3. 静态验证

| 门禁 | 结果 |
|------|------|
| `freeze-contract.test.ts` | PASS |
| `detector-layering.test.ts` | PASS |
| `asr-aggregation-contract.test.ts` | PASS |
| **合计** | **29/29 PASS** |
| `scripts/fw-detector-gate.mjs` | PASS |
| `npm run build:main` | OK |

---

## 4. 配置 SSOT 快照（批测镜像）

来源：`tests/freeze-config-ssot.json`

| 键 | 值 |
|----|-----|
| `spanGateMode` | `fw_metadata_gate` |
| `useLexiconRuntimeV2Recall` | `true` |
| `useSentenceLevelRerank` | `true` |
| `enableKenLMGate` | `true` |
| `fwMetadataSpanGate.maxSpans` | **4**（SSOT） |
| `maxSentenceCandidates` | 16 |
| `minDeltaToReplace` | 0.03 |
| `kenlmSpanGate.enabled` | `false` |

---

## 5. 运行时批测

dialog_200 批测见 [测试报告](./P1_P4_Freeze_Simplification_测试报告_dialog200_2026_05_31.md)。

---

## 6. 结论

- P0 配置精简与 maxSpans SSOT **已落地**，冻结合约与 gate 脚本 **全部通过**。
- P1 批测 SSOT / patch / 回滚参考 **已落地**；legacy 归档与 P2 结构迁移 **未动**。
- 批测 108/108 契约 PASS，唯一 FW apply（d043）与 P4 全量基线一致，**未观察到主链行为回归**。
- 批测 pipeline P95 高于历史全量基线，主因 ASR 冷启动与墙钟采样（见测试报告），**非 FW 算法变更**。

---

## 7. 产物路径

| 产物 | 路径 |
|------|------|
| 批测原始 | `tests/lexicon-v2-p4-batch-result.json` |
| 质量/性能 | `tests/lexicon-v2-p4-quality-perf.json` |
| 批测日志 | `tests/lexicon-v2-p4-batch-run.log` |
| SSOT | `tests/freeze-config-ssot.json` |
