# KenLM Sentence Rerank — Batch-Only Runtime

**状态：** FROZEN · KenLM Runtime Batch-Only **V1.0.0** · Raw Log Delta **V1.0.0** · **2026-06-19**  
**唯一合法实现：** subprocess `scoreBatch` + raw log delta pick + Gate **3.0**

**代码：** `main/src/asr-repair/sentence-rerank/kenlm-scorer.ts` · `main/src/fw-detector/rerank-fw-sentences.ts` · `main/src/fw-detector/kenlm/run-fw-sentence-rerank-from-prefilled.ts`

---

## 1. 当前实现（SSOT）

| 项 | 值 |
|----|-----|
| Runtime 模式 | **Batch-only** subprocess |
| Pick 公式 | `rawDelta = candidate.score − baselineRawScore` |
| Gate | `minDeltaToReplace = **3.0**`（raw log 单位） |
| scoreMode | `raw_log_delta` |
| 典型 batch | 1 raw + 16 candidates = **17 行 → 1 spawn** |
| fail-open | subprocess 失败 → score 全 0，不阻断 pipeline |

**禁止作为 pick 依据：** normalized delta · serial runtime · legacy pick loop

---

## 2. 调用链

```text
runFwDetectorV4Path
  → runFwSentenceRerankFromPrefilled
      → createKenlmBatchScorer().scoreBatch(sentences)
      → rerankFwSentences(rawDelta pick, minDeltaToReplace=3.0)
  → applyFwSpanReplacements
```

---

## 3. Batch 行为

| 场景 | 行为 |
|------|------|
| 全空 token | 不 spawn；score 全 0 |
| subprocess 不可用 | fail-open |
| 非空句 > maxLines (17) | chunk 串行 spawn，合并结果 |
| batch 失败 | scoreAllZero + `kenlmSubprocessErrorReason` |

---

## 4. Framework Config

| 键 | 默认 |
|----|------|
| `enableKenLMGate` | `true` |
| `kenlmGateMode` | `weak_veto` |
| `minDeltaToReplace` | **`3.0`** |
| `maxSentenceCandidates` | `16` |
| `kenlmSubprocessTimeoutMs` | `5000` |
| `kenlmSubprocessMaxLines` | `17` |

完整表：[CONFIG.md](../CONFIG.md)

---

## 5. Diagnostics（观测字段）

### Pick / Score Contract

| 字段 | 含义 |
|------|------|
| `scoreMode` | `"raw_log_delta"` |
| `baselineRawScore` | raw 句 KenLM total log score |
| `pickedRawScore` | pick 成功时候选 raw score |
| `maxDelta` | max **raw** delta |
| `minDeltaToReplace` | Gate（3.0） |
| `pickedIsRaw` | 未过 Gate 或未优于 raw |
| `topCandidates[].kenlmDelta` | per-candidate **raw** delta |
| `allCombinationDeltas` | 全组合 raw delta 数组 |

### 性能

| 字段 | 含义 |
|------|------|
| `kenlmSubprocessMs` | batch 墙钟 |
| `kenlmSubprocessCount` | spawn 次数 |
| `kenlmVetoMs`（V4 顶层） | 映射自 subprocess ms |

### 仅对照观测（不参与 pick）

| 字段 | 含义 |
|------|------|
| `maxNormalizedDelta` | max(normalizedScore − baselineNorm) |
| `KenLMScore.normalizedScore` | scorer 输出，**禁止**用于 Gate |

---

## 6. 静态门禁

**GATE-1（batch-only）：** `kenlm-scorer.ts` 不得含 `scoreBatchSerial` · `fallbackToSerial` · `runKenlmQuery(` · `kenlmRuntimeMode`

**GATE-2（raw pick）：** `rerank-fw-sentences.ts` pick loop 不得用 `normalizedScore` 参与 delta / Gate

断言：`freeze-contract.test.ts`

---

## 7. 性能基线（Dialog200 Gate 3.0）

| 指标 | 目标 | 实测 |
|------|------|------|
| kenlmVetoMs P95 | < 2000 ms | **933 ms** |
| fw_detector_step_ms P95 | < 4000 ms | 2282 ms |

---

## 8. 禁止项

- 恢复 **serial runtime** 或 **fallbackToSerial**
- 用 **normalized delta** 做 sentence rerank pick Gate
- 将 KenLM 决策移入 Compatibility / Assembly
- 修改 `normalizeLmScore` 公式（冻结内）
- 在 `kenlm-scorer.ts` 绕过 `loadFwDetectorRuntimeConfig()`

---

## 9. 相关文档

- [SCORE_CONTRACT.md](./SCORE_CONTRACT.md) — Raw Log Delta pick · Gate 3.0
- [CONFIG.md](../CONFIG.md)
- [DIAGNOSTICS_CONTRACT.md](../DIAGNOSTICS_CONTRACT.md)
- [FRAMEWORK_FREEZE_DECLARATION.md](../FRAMEWORK_FREEZE_DECLARATION.md)
