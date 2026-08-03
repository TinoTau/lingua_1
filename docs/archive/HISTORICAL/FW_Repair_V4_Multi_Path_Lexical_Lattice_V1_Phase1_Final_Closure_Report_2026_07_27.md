<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Phase1_Final_Closure_Report_2026_07_27.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# FW Repair V4 — Multi-Path Lexical Lattice V1 · Phase 1 Final Closure Report

| Field | Value |
|-------|-------|
| Date | 2026-07-27 |
| Nature | **Phase 1 Final Closure** |
| Re-Acceptance | **PASS** |
| Residual Verification | **PASS** |

---

## 1. Executive Summary

Phase 1（全句 WindowQuery 1..5 · Recall 去重 · LexicalEdge · harness）已完成实现、B1/B2 SSOT 修复、残留清理、文档刷新与正式再验收。

```text
PHASE 1 CLOSED
READY FOR PHASE 2 PRE-DEVELOPMENT AUDIT
```

生产仍走 LTR；**未** cutover — 符合 Architecture Phase 1 边界。

---

## 2. Phase 1 Scope

| In | Out |
|----|-----|
| `buildLexicalWindowQueries` | SegmentationPath enum |
| `latticeHardBlockFilter` | Path Vote / Assembly |
| `recallTopKForWindows`（全量遍历） | KenLM wiring |
| `buildLexicalEdges` + Evidence OR | Production orchestrator cutover |
| `runPhase1WindowEdgeHarness` | Dual chain / feature flags |

---

## 3. Final Architecture

Unique target main chain unchanged（Architecture §1）. Phase 1 delivers through **LexicalEdge[]** only.

Closure Addendum（Architecture §22）：Evidence OR；Recall full traversal；Phase 1 **CLOSED**.

---

## 4. Final Runtime Ownership

| Object | Owner | Phase 1 status |
|--------|-------|----------------|
| Window | `buildLexicalWindowQueries` | Delivered (harness) |
| Recall | `recallTopKForWindows` | Shared；B1 gate removed |
| Edge / Evidence | `buildLexicalEdges` | Delivered |
| Candidate | `WindowCandidate` | Unchanged type；termId / recallCandidateKind pass-through |
| Production Fine Span | LTR transitional | **Not** cut over |

---

## 5. Final Interface

| DTO | Notes |
|-----|-------|
| LexicalWindowQuery | = `GlobalWindowDescriptor` carrier；`windowId=start:end` |
| LexicalEdge | `edgeKind:'lexical'` in Phase 1；fallback later |
| WindowCandidate | identity + domains[] + optional `recallCandidateKind` |

---

## 6. Final Data Contract

```text
Evidence OR (all inputs) → identity first-wins (termId | candidateId)
logicalWindowRecallCount = traversed windows
physicalSqlStatementCount = SQLite statement delta
```

Implementation Contract §4.2 updated accordingly.

---

## 7. Final Diagnostics

Facts only；must not gate Recall. Obsolete: attempt gate / `ngramQueryCount` as live metric.

---

## 8. Final Acceptance

| Gate | Result |
|------|--------|
| First Acceptance | FAIL (B1/B2) |
| B1/B2 Code Verification | PASS |
| Residual Cleanup | COMPLETE |
| Re-Acceptance | **PASS** |

Acceptance Contract CURRENT: `FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Phase1_Acceptance_Contract_CURRENT_2026_07_27.md`

---

## 9. Runtime Verification

- No active attempt gate in Recall Core  
- Harness asserts `logicalWindowRecallCount === recallableWindowCount`  
- Production isolation tests PASS  

---

## 10. Regression

```text
5 suites / 120 tests PASS
(residual-cleanup · b1-recall-full-traversal · phase1-window-edge-harness · freeze-contract)
```

dialog_200 harness summary: 200/0；`partialRecallCases=0`.

---

## 11. Documentation Status

| Document | Status |
|----------|--------|
| Architecture V1.0.0 + §22 Closure Addendum | CURRENT |
| Implementation Contract V1.0.0 + B1/B2 | CURRENT |
| Phase 1 Acceptance Contract CURRENT | CURRENT |
| Phase 1 Developer Guide CURRENT | CURRENT |
| DOMAIN_RECALL.md / diagnostics/FROZEN.md | CURRENT |
| Historical audits / FAIL report | HISTORICAL（preserved） |

---

## 12. Deleted Residuals

| Item | Action |
|------|--------|
| Obsolete probe **executable bodies** | Removed；stubs throw only |
| Active-path historical `*quality-perf.json` with `ngramQueryCount` | Moved out of active `tests/` |
| Live experiment reads of `ngramQueryCount` | Removed |
| CURRENT `maxSqlPerUtterance=150` table row | Removed from DOMAIN_RECALL |

---

## 13. Archived Historical Records

```text
docs/tone-v2/_audit_scratch/historical/pre_b1_b2_repair/
  ├── *.mjs stubs (throw)
  ├── acceptance_completeness_matrix.*
  ├── budget_skipped_readonly_recall_probe.json
  └── experiment_snapshots/   # old quality-perf / d001 audit
```

Post-repair evidence retained:

```text
docs/tone-v2/_audit_scratch/lattice_v1_phase1/dialog_200_phase1_summary.json
docs/tone-v2/_audit_scratch/phase1-window-edge-dialog200-probe.mjs
```

---

## 14. Remaining Risks

| Risk | Level | Note |
|------|-------|------|
| Lattice full 1..5 latency/SQL | Ops | Must not restore attempt gates |
| Production still LTR | Expected | Phase 2 ownership transfer |
| Historical docs still mention old gates | Info | Not CURRENT SSOT |

---

## 15. Phase 2 Entry Conditions

Phase 2 Pre-Development Audit may start only when:

1. This Closure is accepted  
2. Scope remains Architecture Phase 2：Path enum；remove LTR production ownership  
3. No feature-flag dual chain  
4. No reopening B1/B2 as “Phase 2 prep”  

---

## 16. Final Decision

```text
PHASE 1 CLOSED
READY FOR PHASE 2 PRE-DEVELOPMENT AUDIT
```
