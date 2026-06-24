# Raw Log Delta Score Contract V1.0.0

**状态：** FROZEN · 2026-06-19  
**配套：** KenLM Runtime Batch-Only V1.0.0  
**代码：** `main/src/fw-detector/rerank-fw-sentences.ts` · `kenlm/run-fw-sentence-rerank-from-prefilled.ts` · `main/src/asr-repair/sentence-rerank/kenlm-scorer.ts`

---

## 1. 合约摘要

| 项 | SSOT |
|----|------|
| scoreMode | `raw_log_delta`（常量 `FW_RERANK_SCORE_MODE`） |
| Pick 公式 | `rawDelta = candidate.score − baselineRawScore` |
| Gate | `bestRawDelta >= minDeltaToReplace` |
| minDeltaToReplace | **`3.0`**（raw log 单位，非 normalized） |
| pick 失败 | `pickedIsRaw = true`，保留 raw 句 |

**已废止：** `minDeltaToReplace = 0.03` + normalized delta Gate · serial KenLM pick

---

## 2. 实现（与代码一致）

### 2.1 rerankFwSentences

```text
batch = scorer.scoreBatch([raw, ...candidates])
baselineRawScore = batch.scores[0].score
for each candidate i:
  rawDelta[i] = scores[i+1].score - baselineRawScore
bestIndex = argmax(rawDelta)
pick iff rawDelta[bestIndex] >= minDeltaToReplace
```

- `maxDelta` = max(rawDelta)
- `maxNormalizedDelta` = max(normDelta) — **仅 diagnostics，不参与 pick**
- `topCandidates[].kenlmDelta` = **raw** delta

### 2.2 SentenceRerankPick（扩展字段）

| 字段 | 语义 |
|------|------|
| `pickedIsRaw` | 未 pick |
| `maxDelta` | max raw delta |
| `scoreMode` | `raw_log_delta` |
| `baselineRawScore` | raw 句 score |
| `pickedRawScore` | pick 成功时候选 score |
| `maxNormalizedDelta` | 观测对照 |
| `allCombinationDeltas` | 各组合 raw delta |

组装：`run-fw-sentence-rerank-from-prefilled.ts` → `FwSentenceRerankDiagnostics`

### 2.3 configSnapshot

orchestrator 必须写入：`scoreMode: 'raw_log_delta'` · `minDeltaToReplace: 3.0`

### 2.4 replacements[].kenlm.delta

语义 = **Raw Log Delta**（非 normalized）

---

## 3. 静态门禁 GATE-2

`freeze-contract.test.ts` 断言 `rerank-fw-sentences.ts`：

- 含 `FW_RERANK_SCORE_MODE`
- pick loop **不得**用 `normalizedScore` 参与 delta / Gate 比较

单测：`rerank-fw-sentences.test.ts`

---

## 4. Framework Config

| 键 | 值 |
|----|-----|
| `enableKenLMGate` | `true`（关闭则不 pick） |
| `minDeltaToReplace` | `3.0` |
| `maxSentenceCandidates` | `16` |

SSOT：`tests/freeze-config-ssot.json` · `node-config-defaults.ts`

---

## 5. Dialog200 验收基线（Gate 3.0）

生产 runtime `minDeltaToReplace: 3.0` 下全量 200 case：

| 指标 | 值 |
|------|-----|
| Improved | 30 |
| Degraded | 5 |
| Net CER | +25 |
| pickedIsRaw=false | 42 / 200 |
| span apply | 6 / 200 |
| kenlmVetoMs P95 | 933 ms |

**说明：** Shadow 句级 proxy Improved≈30；span apply 低于 shadow 属预期。Ranking V1.2 后烧饼由 **Tone Guard** 阻断。

---

## 6. Apply Gate（衔接）

| 项 | 值 |
|----|-----|
| 决策链 | `rerankFwSentences` → `pickedIsRaw` → `mapSentenceToApproved` → `applyFwSpanReplacements` |
| Delta Gate | `bestRawDelta < 3.0` → `pickedIsRaw=true` · `approved=[]` |
| Assembly 豁免 | **无** — 句级统一裁决 |
| d003 | Δ≈3.68 → apply |
| d048 | Δ≈1.88 → 不 apply（合法） |

`enableKenLMGate=false` → scorer=null → 恒 `pickedIsRaw`。

---

## 7. 禁止项

- 用 normalized delta 做 pick Gate
- 恢复 Gate 0.03 作为 SSOT 默认值
- 在 pick 层混用 raw / normalized 语义
- 修改 Gate 阈值而不 bump 合约版本

---

## 8. 相关文档

- [KENLM_RUNTIME.md](./KENLM_RUNTIME.md)
- [diagnostics/FROZEN.md](../diagnostics/FROZEN.md)
- [CONFIG.md](../CONFIG.md)
- [freeze/FROZEN.md](../freeze/FROZEN.md)
