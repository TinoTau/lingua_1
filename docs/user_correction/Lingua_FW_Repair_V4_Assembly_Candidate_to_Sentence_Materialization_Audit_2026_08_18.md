# Lingua FW Repair V4 — Assembly Candidate-to-Sentence Materialization Gap Audit

**Date:** 2026-08-18  
**Stage:** ASSEMBLY_CANDIDATE_TO_SENTENCE_MATERIALIZATION_CONFORMANCE_AUDIT  
**Nature:** READ ONLY — no production code / model / dialog_200 changes  
**Input:** `Lingua_Model2_V3_StageJ_Live_Dialog200_Full_Path_Trace_Acceptance_Report_2026_08_18.md` + Stage-J 200/200 INVOKED traces

**Artifacts:** `training/model2_v3/experiments/v3_stage_j_live_dialog200/assembly_materialization_audit_2026_08_18/`

---

## Executive Summary

上一轮报告的主悬崖 **After Budget 142 → Assembly 26** 在严格可比定义下 **不能** 直接归因 Assembly。

根因排序：

1. **TRACE_ATTRIBUTION_CONTRACT_MISMATCH（主因）** — funnel 在 Budget 层用 candidate surface 子串匹配，在 Assembly 层却对**整句**做同样 `hasTarget`，导致 65% 原 `ASSEMBLY_DROP` 为误归因。
2. **UPSTREAM_SPAN_PATH_GAP（次因）** — union 可见 candidate 未通过 FineSpan eligibility（span 不对齐），在 Assembly 输入过滤阶段即丢失，非 DFS 丢句。
3. **TRUE_ASSEMBLY_DROP（少数）** — 24/200 案例（原 126 中 19%）路径在冻结合同下可恢复但 correction ngram 未出现在 assembly 输出。

**不得** 因 142→26 直接修改冻结 Assembly 算法。

---

## Assembly Materialization Audit: **HOLD**

## Original 142→26 Funnel Valid: **NO**

---

## RECOMPUTED FUNNEL

| Stage | Original (loose) | Strict (MATERIALIZABLE_TARGET_V1) |
|-------|------------------|-------------------------------------|
| Budget Target Visible | 142 | **46** |
| Lexical Recoverable | — | **97** |
| Path Recoverable | — | **59** |
| Sentence Recoverable | — | **58** |
| Actually Assembled | 26 | **63** |
| KenLM Input | 26 | **63** |
| Final | 25 | **25** |

**解读：**

- 142  inflated：大量 ngram（如「你好」「今天」）raw ASR 已含，union candidate 可见 ≠ correction 可见。
- 26 deflated：Assembly 层 `hasTarget` 对整句操作，部分修复（如 d001「蓝莓」）未计数。
- 真正 Lexical→Path 悬崖：**97→59**（eligibility / span 对齐），发生在 **Assembly 输入过滤**，非 Interval DFS。
- Sentence Recoverable→Actually Assembled：**58→63** — Assembly 对部分 case 超交付 partial correction（启发式保守估计）。

---

## 126 RECLASSIFICATION

| Class | N | % |
|-------|---:|---:|
| Trace Overattribution | 82 | 65.1% |
| True Assembly Drop | 24 | 19.0% |
| Upstream Span/Path Gap | 18 | 14.3% |
| Domain Bucket Exclusion | 1 | 0.8% |
| Overlap Conflict | 1 | 0.8% |
| Pruning Drop | 0 | 0% |
| Offset / Materialization Error | 0 | 0% |
| Other | 0 | 0% |
| **Total** | **126** | **100%** |

---

## Critical Question: Frozen Design A or B?

**Answer: B** — 仅 **retained-domain bucket 内 eligible base+sameDomain candidates**（per-span budget 后）进入 sentence assembly；非 union 全量直接组句。

证据：`FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05/01_Architecture.md`，SameDomain Restoration Report 2026-07-30，`runDomainAwareAssembly` 代码路径。

---

## FROZEN DESIGN

| Item | Result |
|------|--------|
| Frozen Assembly Design Reconstructed | **YES** |
| Implementation Matches Frozen Design | **PARTIAL** — 实现符合；trace funnel 不符合 |
| Base + Domain Mixing | **PASS** |
| SameDomain Semantics | **PASS** — grouping not global hard filter |
| Multi-domain | **PASS** — multi-bucket for ties/retention |
| Streaming FineSpan Compatibility | **PASS** — non-overlap PathFineSpan + eligibility |
| Overlap Policy | **PASS** — rawOverlap in DFS |
| Backtracking / Alternative Paths | **PASS** — subset DFS not greedy |
| Sentence Budget Ownership | **PASS** — cap post-materialization at CrossPath |
| KenLM Handoff | **PASS** — prefilled only; 1 rank error in 200 |

---

## HISTORICAL LOGIC

| Item | Value |
|------|-------|
| Old Beam Active | **NO** |
| Old Coarse Boundary Restriction | **NO** (eligibility replaces) |
| Old Candidate Stitching Active | **NO** |
| Legacy Assembly Path | **NO** |
| Shadow Assembly Path | **NO** |

---

## PRIMARY CAUSE

**Largest Actual Materialization Failure:** Trace funnel 将 union-level lexical visibility 等同于 Assembly 应产出 correction — 度量合同错误，非 116 case 真实 Assembly 失败。

**Primary Root Cause:** `flattenFunnel` / `firstDivergence` 在 Assembly 层对**整句**使用 `hasTarget`，与 Budget 层 candidate surface 粒度不一致（`dialog200-path-trace-analyze.mjs` L71-78 vs L225-226）。

**Secondary Root Cause:** FineSpan eligibility attrition — union 中 97 lexical recoverable 仅 59 path recoverable（`DROP_RANGE_MISMATCH` / incomplete coverage / span 未对齐）。

---

## Representative Findings

### d001 — Trace false negative

- Union 含「蓝莓」；assembly 句「…今天有**蓝莓**马分吗?」
- 原 funnel：`target_in_assembly=false`
- 原因：整句 `hasTarget` 无法检测 partial correction

### d002 / d047 — True Assembly Drop

- Union 含「大杯」eligible candidate（m2d bound FineSpan）
- Assembly 输出仍保留「大背」— correction 未 materialize
- 分类：**TRUE_ASSEMBLY_DROP**（19% 原 126 的核心真实 Assembly 问题）

### d003 / d011 — Upstream Span/Path Gap

- Union 有 lexical hit，candidate span 与 PathFineSpan 不对齐
- 从未进入 `selectedCandidates` → 非 DFS 问题

---

## Design Conformance Detail

### Assembly Input Attrition (Part A)

- Post-budget union ≠ Assembly input：候选在 `filterDomainCandidatesPerSpan` + `budgetPerSpanCandidates` 丢失
- 原 126 中仅 **24** 案例 candidate 到达 eligible+path recoverable 但仍未组装 correction

### Domain Vote / SameDomain (Part B)

- `insufficientEvidence` → base-only bucket — 符合冻结
- Cross-domain exclusion — ** intentional **，非 SAMEDOMAIN_OWNERSHIP_DRIFT
- 1 case DOMAIN_BUCKET_EXCLUSION — 边缘 case

### Span / Path (Part C)

- PathFineSpan production non-overlapping — 符合
- FINESPAN_ASSEMBLY_CONTRACT_DRIFT — **未检出**

### Traversal / Pruning (Part D)

- DFS + caps — 符合冻结
- 0 cases ASSEMBLY_SENTENCE_BUDGET_PRUNE in reclassified 126

### KenLM Boundary (Part G)

- Assembly 与 KenLM input parity on per-path basis；CrossPath dedup 可致 global 计数差异
- 仅 1 KENLM_RANK_ERROR — Assembly 缺失不应归 KenLM

---

## DECISION

| Question | Answer |
|----------|--------|
| Assembly Code Fix Required | **NO** (this round evidence insufficient for frozen contract violation at scale) |
| Frozen Assembly Design Change Required | **NO** |
| FineSpan Audit Required | **YES** — eligibility attrition 97→59 is primary product gap |
| Trace Contract Fix Required | **YES** — P0 before any Assembly code change |
| Architecture Change Proposal Required | **NO** |

### Recommended Next Phase

1. **FIX TRACE ATTRIBUTION** — 统一 MATERIALIZABLE_TARGET_V1 funnel；修正 `firstDivergence` Assembly 层为 correction-ngram-in-sentence 检查
2. **AUDIT FINESPAN / ELIGIBILITY** — 解释 lexical→path 38 case gap（span alignment, parent_fragment coverage）
3. **TARGETED TRUE_ASSEMBLY_DROP REVIEW** — 24 cases 人工/半自动复核（如 d002 大杯），确认是否 repairTarget / bucket / multi-path 问题后再决定是否 RESTORE ASSEMBLY IMPLEMENTATION

---

## Governance

- 未修改 production business code（`modified_file_inventory.csv`: 0）
- 未训练 Model2
- 未改 dialog_200 expectedText
- 审计脚本：`docs/user_correction/scripts/assembly_materialization_gap_audit.mjs`（只读分析）

---

## Final Verdict Block

```
Assembly Materialization Audit: HOLD
Original 142→26 Funnel Valid: NO
Frozen Assembly Design Reconstructed: YES
Implementation Matches Frozen Design: PARTIAL (code PASS, trace FAIL)
```

**本轮结束：NO FIX · NO TRAINING · NO ARCHITECTURE CHANGE**
