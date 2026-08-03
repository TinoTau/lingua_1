<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_KenLM_Validation_Readiness_Audit_2026_08_02.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# FW Repair V4 — KenLM Validation Readiness Audit
## 2026-08-02

| Field | Value |
|-------|-------|
| Nature | READINESS ONLY（禁止模型/阈值/TopK/决策门槛变更） |
| Verdict | **KENLM_VALIDATION_READY** |

---

## 1. Executive Conclusion

KenLM 仍是评分/排序 Owner，不是 Candidate 生成 Owner。CrossPath → `kenlmSentenceCandidates` 可逐条导出；`rerankFwSentences` 提供 raw baseline、`kenlmScore`、`deltaVsRaw`、TopK rank。真实噪声对已入库。可进入能力验证；本轮未做任何 KenLM 优化。

---

## 2. KenLM Current Owner

| Concern | Owner |
|---------|-------|
| Candidate generation | Lattice · Assembly · CrossPath |
| Score / rank / pick | `rerankFwSentences` + KenLM scorer |
| scoreMode | `raw_log_delta`（FROZEN） |
| Gate | `minDeltaToReplace`（本轮不改） |

代码：`main/src/fw-detector/rerank-fw-sentences.ts` · `kenlm/run-fw-sentence-rerank-from-prefilled.ts`。

---

## 3. Input Candidate Contract

```text
mergeCrossPathSentenceCandidates
→ kenlmSentenceCandidates.combinations (<=16)
→ fw-detector-v4-path prefilledCombinations
→ KenLM
```

dialog_200 导出：`dialog200_post_atomicity_candidate_export.csv`（200 行输入）。

---

## 4. Candidate Provenance

`SentenceCombination`：`text` · `replacements[]`（含 optional `candidateId` · span · source）· `candidateScore`。

残差：KenLM TopCandidates 使用合成 `candidate:i` / `raw`；`sourcePath` / `bucketDomain` 不进入 KenLM 评分输入（与 `KENLM_RUNTIME.md` 一致）。能力验证以 **text + raw + score** 为主；细粒度 edge provenance 为后续诊断增强，不阻断本轮 READY。

---

## 5. Raw Candidate Identity

`rerankFwSentences` 始终将 `rawText` 作为 batch[0]；TopCandidates 含 `candidateId:'raw'` · `isRaw:true` · `deltaVsRaw:0`。Raw 可识别。

---

## 6. Score / Rank Contract

可追踪字段：`text` · `kenlmScore` · `deltaVsRaw` · `rank` · Top3 · `baselineRawScore`。

---

## 7. raw_log_delta Contract

```text
rawDelta = candidate.score − baselineRawScore
pick iff rawDelta >= minDeltaToReplace
```

FROZEN；本轮未改。

---

## 8. Real Noise Case Inventory

见 `kenlm_validation_case_inventory.csv`，覆盖：

| Pair | Evidence |
|------|----------|
| 我们正在 vs 我闷蒸在 | Domain Vote Atomicity Trace（KenLM Top3 含二者） |
| 中心 vs 忠心 | inventory reserved |
| 小食 vs 消失 | Domain Semantic Reconciliation Final |
| 已经同步 vs 已精通步 | 同上 |
| 触发 vs 出发 | 同上 |
| 阈值 vs 阈之一 | 同上 |

均来自真实 Assembly/Final Trace，非手工只构造正确答案。

---

## 9. Correct Candidate Availability

噪声句中正确文本常与噪声并列进入 KenLM TopK（例：神经网络句 Top3 同时含「我闷蒸在…」与「我们正在…」）。  
分类框架：

| Code | Meaning |
|------|---------|
| A | 正确候选不存在 → Recall/Assembly |
| B | 存在但未 Top1 → KenLM 能力 |
| C | Top1 但未采用 → Decision/threshold |

---

## 10. Top1 / Top3 Trace Availability

`SentenceRerankPick.topCandidates`（≤3）+ `allCombinationDeltas` 可用。

---

## 11. Missing Diagnostics

- 合成 `candidate:i` 与上游 Window `candidateId` 未强制 1:1  
- Export 中 `sourcePath`/`bucketDomain` 常空（DTO 未携带至 KenLM 层）  
不构成评分可追踪性阻断。

---

## 12. Performance Measurement Readiness

可测：Raw rank · Correct rank · Top1/Top3 · raw_log_delta · top1 margin · candidate count · score ties · Pre-KenLM latency（dialog_200 p50/p95/max 已测）。

---

## 13. Validation Target List

下一阶段：对 inventory 全量跑真实 KenLM subprocess；产出 A/B/C 归因表；**仍禁止**改模型/阶数/阈值/TopK，直至能力基线报告完成。

---

## 14. Blockers

无。不允许因模型效果差判 Blocked。

---

## 15. Final Verdict

```text
KENLM_VALIDATION_READY
```

总体结论：**ATOMICITY_CLOSED_KENLM_READY**。
