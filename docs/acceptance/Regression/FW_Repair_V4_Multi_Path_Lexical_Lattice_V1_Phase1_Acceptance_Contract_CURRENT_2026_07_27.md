<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Regression/FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Phase1_Acceptance_Contract_CURRENT_2026_07_27.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Multi-Path Lexical Lattice V1 · Phase 1 Acceptance Contract (CURRENT)

| Field | Value |
|-------|-------|
| Date | 2026-07-27 |
| Status | **CURRENT** · Phase 1 closed |
| Authority | Architecture V1.0.0 FROZEN · Implementation Contract V1.0.0 |
| Scope | Windows · Recall dedupe · LexicalEdge · harness only |
| Supersedes | Phase 1 Pre-Dev Acceptance Criteria §18 (as operating checklist) |

---

## 1. In scope PASS criteria

1. Full-utterance contiguous WindowQuery length **1..5**, syllable `[start,end)`  
2. No duplicate `(start,end)` windows  
3. Coarse does **not** hard-cut legal Lattice windows; hard-block only Latin / gap / punct / non-CJK / ASR (Lattice filter)  
4. `recallTopKForWindows` fully traverses every legal recallable input window (`logicalWindowRecallCount === input.length`)  
5. One `LexicalEdge` per boundary; many `WindowCandidate`s allowed  
6. Candidate type remains `WindowCandidate`; `domains[]` complete before Edge  
7. RecallQueryKey includes `surfaceText`  
8. Utterance Recall Cache may be enabled with Fact-only semantics  
9. Edge Evidence = OR of all input sources **before** identity first-wins  
10. Candidate identity = `termId` preferred, else `candidateId`; Evidence not in identity  
11. `hasFuzzy` from `recallCandidateKind` via existing classifier  
12. Diagnostics record facts only (`logicalWindowRecallCount`, `physicalSqlStatementCount`, cache hit/miss) — never gate Recall  
13. **Zero** SegmentationPath / Path Vote / Path Assembly / KenLM / Compatibility changes in Phase 1 delivery  
14. **Zero** Production Orchestrator Lattice cutover / feature-flag dual chain  

---

## 2. Explicit FAIL conditions (Phase 1)

- Any skip/truncate of legal recallable Windows for resource policy  
- Evidence computed only from post-dedupe Candidates  
- Orchestrator imports Phase 1 Lattice modules or Lattice feature flags  
- Restoring `maxSqlPerUtterance` / `ngramQueryCount` as live controls  

---

## 3. Out of scope (do not accept under Phase 1)

Architecture Acceptance Contract items requiring Path / Vote / Assembly / KenLM / cutover (Architecture §19 items 7–15, 19–20) → **Phase 2+**.

---

## 4. Evidence pack for Re-Acceptance

| Evidence | Location |
|----------|----------|
| Unit / isolation | `phase1-window-edge-harness.test.ts` · `b1-recall-full-traversal.test.ts` · `freeze-contract` · `residual-cleanup.test.ts` |
| Offline dialog_200 harness | `_audit_scratch/phase1-window-edge-dialog200-probe.mjs` + `lattice_v1_phase1/dialog_200_phase1_summary.json` |
| Code Verification | B1/B2 Final Code Verification Audit **PASS** |
| Residual | Residual Cleanup Development Report · this Re-Acceptance |
