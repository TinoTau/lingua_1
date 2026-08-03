<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Development/FW_Repair_V4_Lexical_Connectivity_Repair_V1_Batch1_1A_Truncation_Aware_Uniqueness_Development_Report_2026_07_28.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Lexical Connectivity Repair V1 · Batch 1.1A Truncation-aware Uniqueness Development Report

| Field | Value |
|-------|-------|
| Date | 2026-07-28 |
| Batch | 1.1A |
| Scope | Stage 2–3 only |
| Next | Batch 1.1A Stage 4 — Generalization Audit |
| Not | Batch 1.1B · Batch 2 · Batch 1 overall PASS |

---

## 1. Executive Summary

在 Recall length=1 歧义决议中引入 **truncation fact**：当 Runtime 返回行数打满 `LENGTH1_AMBIGUITY_SQL_LIMIT` 时，eligibility 后的 residual singleton **不得**判为语义唯一。真实 1.0C 假唯一基线（Candidate=1 / 捌）修复后变为 Candidate=0；真唯一与非截断过滤唯一仍命中。

---

## 2. Final Verdict

```text
BATCH 1.1A TRUNCATION-AWARE UNIQUENESS:
PASS

FALSE UNIQUE REJECTED
TRUE UNIQUE PRESERVED
READY FOR STAGE 4 GENERALIZATION AUDIT
```

---

## 3. Five-Stage Status

| Stage | Status |
|-------|--------|
| Stage 1 Design Audit (Batch 1.1) | PASS（输入） |
| Stage 2 Development | **PASS** |
| Stage 3 Functional Test | **PASS** |
| Stage 4 Generalization Audit | PENDING |
| Stage 5 Cleanup & Gate | PENDING |

---

## 4–6. Stage 1 Input / Root Cause / Ownership

与 Design Audit 一致：

- Root Cause：LIMIT 在 filter 前截断 → residual singleton 误判唯一  
- Owner：**Recall only**（Runtime 机械 LIMIT；不判断 unique）

---

## 7. Contract Before

```text
eligible.length === 1 → accept (ignore truncation)
```

1.0C evidence：DB=9, Runtime=8, eligible=1, Candidate=1, `observedFalseUnique=true`.

---

## 8. Contract After (CR 1.0.4)

```text
returnedCount >= requestedLimit → fetchMayBeTruncated
eligible===1 && truncated → reject
eligible===1 && !truncated → accept
eligible>=2 → existing surface-exact-in-set
eligible===0 → empty
```

不授权：rank9 surface probe、tone unsupported、HB ellipsis、2–5 变更。

---

## 9. Implementation Choice

```ts
length1FetchMayBeTruncated(raw.length, sqlLimit)
resolveLength1BaseCandidate(eligible, windowText, fetchMayBeTruncated)
```

- 未增大 LIMIT  
- 未全量拉取  
- 未 Top1-by-prior  
- 未新增 Runtime uniqueness API  
- plain + tone 路径共用同一决议函数  

---

## 10. Why Runtime Does Not Own Uniqueness

Runtime 只执行 `ORDER BY prior DESC LIMIT ?` 并返回 rows。`returnedCount` 与 `requestedLimit` 是机械事实；语义唯一仅由 Recall 解释。

---

## 11. Files Changed

| File | Change |
|------|--------|
| `lexicon-v2/recall-span-topk-v2.ts` | truncation-aware resolve |
| `length1-real-sqlite.test.helpers.ts` | `buildSameKeyLength1Rows` |
| `recall-span-topk-v2-length1-truncation.sqlite.integration.test.ts` | **NEW** |
| `recall-span-topk-v2-length1.sqlite.integration.test.ts` | LIMIT 断言更新（不覆盖 1.0C before JSON） |
| `length1-recall-edge-path.sqlite.integration.test.ts` | false-unique → no edge |
| Implementation Contract | CR **1.0.4** |

---

## 12. Tests Added / Updated

见测试报告 suite 列表。变形：fu / shi / lim / ke / xu / mu / ze / hao / bi / 标准 我·点。

---

## 13–14. Before / After Baseline

| | Before (1.0C kept) | After (1.1A) |
|--|-------------------|--------------|
| Path | `lattice_v1_batch1_0c/length1_limit8_real_sqlite_baseline.json` | `lattice_v1_batch1_1a/length1_limit8_real_sqlite_baseline_after.json` |
| finalCandidateCount | 1 | **0** |
| observedFalseUnique | true | false |
| falseUniqueRejected | — | **true** |
| rank9 | false | false（Known Defect） |

---

## 15–17. Evidence

| Case | Result |
|------|--------|
| Plain false unique (fu) | Candidate=0 |
| Tone false unique (shi4) | Candidate=0 |
| Plain/Tone true unique | Candidate=1 |
| Non-truncated filtered unique (mu) | Candidate=1 |
| Truncated zero eligible | empty |
| Truncated multi eligible | empty（非 Top1） |
| Surface in fetched set (哪) | preserved |

---

## 18. Surface Behavior Frozen

Fetched-set 内 surface exact 仍可用。Rank9 **仍不可达** — Known Defect → Batch 1.1B。

---

## 19–21. Edge / Vote / Diagnostics

- 真唯一「点」→ Edge → Path PASS  
- lim 假唯一 → candidates=0 → edges=0 → vote=0  
- Diagnostics：false unique 不增加 Candidate/Edge 命中  

---

## 22–23. Regression / dist

- 2–5 / HB / freeze / Runtime：**100 PASS**  
- `build:main` SUCCESS；inventory **CLEAN**

---

## 24. Known Defects

1. Surface rank9 unreachable（1.1B）  
2. Tone unsupported silent plain（1.1C）  
3. HB ellipsis `…`（1.1D）  

---

## 25–29. Excluded / KEEP / MODIFY / DELETE / NEW

| | Items |
|--|-------|
| Excluded | surface probe、tone policy、HB、cap、Edge/Path/Vote 算法、Patch、词库 |
| KEEP | LIMIT=8 常量、1.0C Runtime gate、surface-in-set、cap=1 |
| MODIFY | `resolveLength1BaseCandidate` + collect 传 truncation fact |
| DELETE | de facto「满 LIMIT residual = unique」 |
| NEW | truncation helper；1.1A 测试与 after baselines；CR 1.0.4 |

---

## 30–31. Target / Check

全部完成；未增大 LIMIT；未 Runtime unique；未进 Batch 2；未修 1.1B/C/D。

---

## 32. Next Stage Recommendation

```text
→ Batch 1.1A Stage 4 — Generalization Audit
禁止宣称 Batch 1 整体 PASS / 进入 Batch 2
禁止在 Stage 4 前开始 1.1B（除非流程另行批准串行，仍须本 Repair Gate）
```
