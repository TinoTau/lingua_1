# FW Repair V4 — KenLM Corpus Rebuild V1

| Field | Value |
|-------|-------|
| Date | 2026-08-04 |
| Baseline | FW_V4_FREEZE_2026_08_03 |
| Benchmark | KENLM_BENCHMARK_V1（未改标注） |
| Sources | **Wikipedia only**（OSCAR 放弃） |
| Verdict | **KENLM_CORPUS_V1_READY** |

## Answers

### Q1 Wikipedia 最终保留多少句？
**17474810**

### Q2 OSCAR 最终保留多少句？
**0**（本轮放弃 OSCAR）

### Q3 最终 Vocabulary？
**71613**

### Q4 Trie Binary 大小？
**601466261** bytes

### Q5 Benchmark 提升 / 下降？
提升 **4** · 下降 **0**（Correct 67→71）

### Q6 是否建议替换生产模型？
**YES**

## Training

| Metric | Value |
|--------|------:|
| Sentences | 17474810 |
| Tokens | 679285642 |
| Vocab | 71613 |
| N-Gram Σ | 91156508 |
| ARPA | 2116813606 |
| Trie | 601466261 |
| Order | 3 |
| Discount | MKN + discount_fallback |

Production **not** replaced.

## Final Verdict

```text
KENLM_CORPUS_V1_READY
```
