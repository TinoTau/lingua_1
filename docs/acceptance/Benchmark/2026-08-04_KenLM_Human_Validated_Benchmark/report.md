# FW Repair V4 — KenLM Phase 02 Human Validated Competition Benchmark

| Field | Value |
|-------|-------|
| Date | 2026-08-04 |
| Baseline | **FW_V4_FREEZE_2026_08_03** |
| Benchmark | **KENLM_BENCHMARK_V1** |
| Nature | **READ ONLY** · Benchmark construction |
| Model / Corpus / ARPA / Recall / Tone / Assembly | **Unchanged** |
| Verdict | **KENLM_BENCHMARK_READY** |

---

## 1. Executive Conclusion

本轮不优化 KenLM，只把 Phase 01 真实 Runtime 竞争池固化为永久 **Human Validated Competition Benchmark**。

- Meaningful Competition：**75**
- VERIFIED：**71**
- REVIEW_REQUIRED：**4**
- UNDECIDABLE：**0**

Decision 计数（**不**报 Accuracy）：

| Decision | Count |
|----------|------:|
| RAW_CORRECT | 57 |
| NON_RAW_CORRECT (CANDIDATE_1/2) | 18 |
| MULTIPLE_OK | 0 |
| ALL_WRONG | 0 |
| UNDECIDABLE | 0 |

---

## 2. Method

1. 仅使用 Phase 01 `candidate_ranking.csv`（来自 dialog_200 `stage=kenlmInput` 真实 CrossPath 输入）。
2. Meaningful Competition = `distinctText≥2` ∧ Raw 在场 ∧ ≥1 CrossPath 交替句 ∧ 语义非重复。
3. 为每条竞争分配永久 `benchmarkId`（`KLM000001`…），**永不重编号**。
4. 人工字段：`humanDecision` + `decisionReason` + `status`（无 Expected / GroundTruth）。
5. `benchmarkVersion=KENLM_BENCHMARK_V1`；以后只追加。

禁止项均遵守：无重训、无改 Corpus/ARPA/Trie/Query/Beam、无改 Recall/Tone/Candidate、无 Runtime 特判/名单。

---

## 3. Answers

### Q1 — 共有多少 Meaningful Competition？

**75**

### Q2 — 多少 Verified？

**71**

### Q3 — 多少 Review Required？

**4**

### Q4 — 多少 Undecidable？

**0**（status=UNDECIDABLE）

### Q5 — Benchmark 是否足够开始 KenLM Optimization？

**YES — Human Validated Benchmark established; use for all KenLM eval**

---

## 4. Final Verdict

```text
KENLM_BENCHMARK_READY
```

Human Validated Benchmark 已建立。

以后所有 KenLM 统一使用该 Benchmark。
