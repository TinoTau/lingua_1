# FW Repair V4 — KenLM Corpus V1 Production Readiness A/B

| Field | Value |
|-------|-------|
| Date | 2026-08-05 |
| Baseline | FW_V4_FREEZE_2026_08_03 |
| Benchmark | KENLM_BENCHMARK_V1 |
| Score mode | raw_log_delta |
| minDeltaToReplace | 3 |
| Verdict | **PRODUCTION_REPLACEMENT_NOT_JUSTIFIED** |

---

## Benchmark reconciliation

Corpus V1 宣称 Correct 67→71 / Improved=4。核对结果：

- 4 个 Improved 全部是 **REVIEW_REQUIRED**（KLM000015/033/049/067）
- **同一语义模式**重复 4 次：`后选声城` → `候选声城`（`candidateTextsHash` 相同）
- 人工复核结论：**UNDECIDABLE**（保持 REVIEW_REQUIRED，不升 VERIFIED）

| Metric | Value |
|--------|------:|
| Verified Top1 Accuracy (old→new) | 67/71 → 67/71 |
| Review-Required Top1 Agreement | 0/4 → 1/4 |
| All-Case Provisional (not Verified) | 67 → 68 |
| Unique improvement patterns | 1 |
| Repeated occurrences | 4 |

**VERIFIED net gain = 0**（regressed=0）

---

## Production Pick A/B (dialog_200)

使用真实 `rerankFwSentences` + `raw_log_delta` + `minDeltaToReplace=3`。

| Metric | Value |
|--------|------:|
| Cases | 200/200 |
| Final selection changed | 5 |
| Raw keep → replace | 0 |
| Replace → raw keep | 5 |
| Same Top1 but gate flip | 0 |

---

## Score scale / gate

| Metric | Value |
|--------|------:|
| Median maxDelta scale ratio (new/old) | 0 |
| Gate incompatible? | true |

---

## Performance (median)

| Metric | OLD | NEW |
|--------|----:|----:|
| Cold load ms (median of 3) | 1271.5629999637604 | 7471.360300064087 |
| Dialog_200 wall ms | 45643.8819000721 | 273396.62980008125 |
| scoreBatch p95 ms | 631.0999999999999 | 2439.1499999999983 |
| Cold RSS Δ median MB | 0.02 | 0.13 |
| Trie file MB | 33.4 | 573.6 |

---

## Answers

### Q1 — VERIFIED 是否有真实净提升？
**NO** — net=0

### Q2 — 4 个提升是独立能力还是重复模式？
**同一 REVIEW_REQUIRED 模式重复 4 次**（1 unique pattern）

### Q3 — 是否改变生产最终 Pick？
**YES** — changed=5

### Q4 — minDeltaToReplace 是否兼容？
**NO** — scaleRatio=0

### Q5 — 601MB Trie 实际 RSS / 冷启动 / p95？
冷启动 median **7471.360300064087 ms**；RSSΔ median **0.13 MB**；scoreBatch p95 **2439.1499999999983 ms**；dialog_200 wall median **273396.62980008125 ms**

### Q6 — 节点共存是否稳定？
**YES (budget/harness)** — 本轮未拉起完整 ASR+Tone 栈；按 RAM 预算与无 OOM/crash 判定

### Q7 — 现在是否可以替换生产模型？
**NO**

---

## Final Verdict

```text
PRODUCTION_REPLACEMENT_NOT_JUSTIFIED

新模型没有在 VERIFIED Benchmark 上证明真实提升，
或所谓提升仅来自未决、重复模式。

考虑到模型体积显著增长，
当前收益不足以支持生产替换。

继续使用旧模型。
```
