# Post-ASR Enhancement（5015 / 5016 / 5017）

可选 HTTP 增强步骤，注册在 **AGGREGATION 之后**、DEDUP 之前。

**默认 OFF：** `node-config-defaults.ts` 中 `semanticRepair`、`phoneticCorrection`、`punctuationRestore` 均为 `enabled: false`。

---

## 步骤

| Step | 端口 | 文件 | Pipeline 类型 |
|------|------|------|---------------|
| SEMANTIC_REPAIR | 5015 | `semantic-repair-step.ts` | 5015 |
| PHONETIC_CORRECTION | 5016 | `phonetic-correction-step.ts` | 5016 |
| PUNCTUATION_RESTORE | 5017 | `punctuation-restore-step.ts` | 5017 |

门控：`enhancement-gate.ts`（服务 registered + running）、`shouldRun*` flags（`post-asr-routing.ts`）。

---

## Write Lock

当 FW `applyFwSpanReplacements` 成功（`ctx.asrRepairApplied === true`），`isSegmentWriteLocked` 阻止本目录步骤覆盖 `segmentForJobResult`。

---

## 相关

[`../pipeline/README.md`](../pipeline/README.md) · [`../fw-detector/README.md`](../fw-detector/README.md)
