# KenLM Sentence Rerank — Batch-Only Runtime

**状态：** FROZEN · KenLM Runtime Batch-Only **V1.0.0** · Raw Log Delta **V1.0.0** · Domain wiring update **2026-07-20**  
**Runtime Domain Presence Vote:** **ACCEPTED AND FROZEN** — [`Runtime_SSOT_Contract_Freeze.md`](../../tone-v2/Runtime_SSOT_Contract_Freeze.md)  
**唯一合法实现：** subprocess `scoreBatch` + raw log delta pick + Gate **3.0**

**代码：** `main/src/asr-repair/sentence-rerank/kenlm-scorer.ts` · `main/src/fw-detector/rerank-fw-sentences.ts` · `main/src/fw-detector/kenlm/run-fw-sentence-rerank-from-prefilled.ts`

**Runtime Domain Authority:** [`Runtime_SSOT_Contract_Freeze.md`](../../tone-v2/Runtime_SSOT_Contract_Freeze.md)

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

本轮 **不修改** `minDeltaToReplace` 公式与阈值。

---

## 2. 正式调用链（跨桶池）

```text
span-assembly-v4-orchestrator
→ mergeCrossBucketSentenceCandidates
→ kenlmSentenceCandidates
→ fw-detector-v4-path
→ prefilledCombinations (required)
→ runFwSentenceRerankFromPrefilled
→ rerankFwSentences
```

`fw-detector-v4-path` 将 `assemblyResult.kenlmSentenceCandidates.combinations ?? []` 作为 **required** `prefilledCombinations` 传入 KenLM 路径。

```text
[] = 明确无候选 → fail-open raw
undefined 不允许（无 legacy primary spanSets rebuild）
```

---

## 3. Domain / 候选池边界

1. KenLM **不决定**领域。  
2. KenLM **不接收** `domainScores`。  
3. KenLM **不接收** `retainedDomains`。  
4. KenLM **不接收** `bucketDomain`。  
5. KenLM 输入只包含 **raw** 与 **candidate text**。  
6. Candidate pool 已在 Runtime Domain 层完成跨桶 text dedup。  
7. 最终候选数量 **<=16**。  
8. `scoreMode = raw_log_delta`。  
9. `minDeltaToReplace` 不在本轮修改。  
10. WSL cold-start timeout 是**运行风险**（预热后可运行）。  
11. **Integration PASS ≠ Quality PASS**。

质量与集成拆分见 Runtime SSOT §26–§28。

---

## 4. Batch 行为

| 场景 | 行为 |
|------|------|
| 全空 token | 不 spawn；score 全 0 |
| subprocess 不可用 | fail-open |
| 非空句 > maxLines (17) | chunk 串行 spawn，合并结果 |
| batch 失败 | scoreAllZero + `kenlmSubprocessErrorReason` |

---

## 5. Framework Config

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

## 6. Diagnostics（观测字段）

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

## 7. 静态门禁

**GATE-1（batch-only）：** `kenlm-scorer.ts` 不得含 `scoreBatchSerial` · `fallbackToSerial` · `runKenlmQuery(` · `kenlmRuntimeMode`

**GATE-2（raw pick）：** `rerank-fw-sentences.ts` pick loop 不得用 `normalizedScore` 参与 delta / Gate

断言：`freeze-contract.test.ts`

---

## 8. 性能基线（Dialog200 Gate 3.0）

| 指标 | 目标 | 实测 |
|------|------|------|
| kenlmVetoMs P95 | < 2000 ms | **933 ms** |
| fw_detector_step_ms P95 | < 4000 ms | 2282 ms |

---

## 9. 禁止项

- 恢复 **serial runtime** 或 **fallbackToSerial**
- 用 **normalized delta** 做 sentence rerank pick Gate
- 将 KenLM 决策移入 Compatibility / Assembly
- 修改 `normalizeLmScore` 公式（冻结内）
- 在 `kenlm-scorer.ts` 绕过 `loadFwDetectorRuntimeConfig()`
- 向 KenLM 传入 domainScores / retainedDomains / bucketDomain / domains[]
- 将 Integration PASS 写成 Quality PASS

---

## 10. 相关文档

- [Runtime_SSOT_Contract_Freeze.md](../../tone-v2/Runtime_SSOT_Contract_Freeze.md) — Integration / Quality 拆分
- [SCORE_CONTRACT.md](./SCORE_CONTRACT.md) — Raw Log Delta pick · Gate 3.0
- [CONFIG.md](../CONFIG.md)
- [freeze/FROZEN.md](../freeze/FROZEN.md)
