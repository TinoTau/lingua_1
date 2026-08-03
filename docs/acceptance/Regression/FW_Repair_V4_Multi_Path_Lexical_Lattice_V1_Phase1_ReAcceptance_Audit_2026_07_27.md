<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Regression/FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Phase1_ReAcceptance_Audit_2026_07_27.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Multi-Path Lexical Lattice V1 · Phase 1 Re-Acceptance Audit

| Field | Value |
|-------|-------|
| Date | 2026-07-27 |
| Nature | **Formal Re-Acceptance**（只读判定 + 既有证据；非开发） |
| Authority | Architecture V1.0.0 · Implementation Contract V1.0.0 · Phase 1 Acceptance Contract CURRENT |
| Prior Acceptance | 2026-07-27 **FAIL**（B1/B2） |
| Prior Code Verification | B1/B2 **PASS** |
| Residual | Cleanup **COMPLETE** |

---

## 1. Executive Verdict

```text
PHASE 1 RE-ACCEPTANCE: PASS
```

原 B1/B2 blockers 已在代码与现行文档中消除；Residual 活跃路径已清；生产隔离仍成立。

---

## 2. Criteria Matrix（Acceptance Contract CURRENT）

| # | Criterion | Evidence | Result |
|---|-----------|----------|--------|
| 1 | Windows 1..5 full utterance | `buildLexicalWindowQueries` + harness tests | **PASS** |
| 2 | No duplicate `(start,end)` | harness tests | **PASS** |
| 3 | Coarse non-hard-cut (Lattice) | `latticeHardBlockFilter` + tests | **PASS** |
| 4 | Full recall traversal | B1 tests 0/1/150/151/165；harness incompleteness throw；dialog_200 `partialRecallCases=0` | **PASS** |
| 5 | One Edge / boundary；multi Candidate | `buildLexicalEdges` + tests | **PASS** |
| 6 | WindowCandidate + domains[] | bind + Edge tests | **PASS** |
| 7 | surfaceText in Recall key | harness tests | **PASS** |
| 8 | Utterance cache usable | harness + production LTR reuse | **PASS** |
| 9 | Evidence OR before first-wins | B2 unit + Code Verification | **PASS** |
| 10 | Identity termId / candidateId | `candidateMergeKey` | **PASS** |
| 11 | hasFuzzy ← recallCandidateKind | Edge + tests | **PASS** |
| 12 | Diagnostics facts only | no gate in Recall Core | **PASS** |
| 13 | No Path/Vote/KenLM Phase 1 changes | scope / isolation | **PASS** |
| 14 | No orchestrator cutover / dual chain | isolation test | **PASS** |

---

## 3. Residual Verification

| Path | Obsolete symbols as live controls | Result |
|------|-----------------------------------|--------|
| `main/src` business | none | **PASS** |
| Active experiments | only fail-fast reject of `ngramQueryCount` | **PASS** |
| Active `_audit_scratch` probes | none | **PASS** |
| CURRENT `docs/fw-detector` | no `maxSql=150` table; obsolete listed as 废弃 only | **PASS** |
| package.json / CI | no obsolete probe scripts | **PASS** |

Historical hits confined to `_audit_scratch/historical/**` and formal audit reports.

---

## 4. Runtime / Regression

```text
jest residual-cleanup|b1-recall-full-traversal|phase1-window-edge-harness.test|freeze-contract
→ 5 suites / 120 tests PASS
```

dialog_200 Phase1 summary (post B1/B2): `completed=200`, `failed=0`, `partialRecallCases=0`, five long cases retain edges `32:34` / `34:36`.

---

## 5. Production Isolation

Orchestrator does not import Lattice Phase 1 modules; no Lattice feature flags — **PASS**.

---

## 6. Documentation

| Doc | Status |
|-----|--------|
| Architecture + Closure Addendum | CURRENT |
| Implementation Contract + B1/B2 notes | CURRENT |
| Phase 1 Acceptance Contract CURRENT | NEW |
| Phase 1 Developer Guide CURRENT | NEW |
| DOMAIN_RECALL / diagnostics | CURRENT (B1/B2) |

---

## 7. Final Decision

```text
PHASE 1 RE-ACCEPTANCE: PASS
READY FOR PHASE 1 FINAL CLOSURE
```
