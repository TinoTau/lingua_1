# Lingua Dialog200 Evaluator SSOT Compliance Repair V1 — Report

**Mode:** DEVELOPMENT · EVALUATOR_ONLY · CONTRACT_RESTORE · NO_PRODUCTION_CHANGE  
**Date:** 2026-09-23  
**Authority:** EVALUATION_SSOT_V1 (unchanged)

---

## 1. Executive Verdict

**B. EVALUATOR_REPAIR_VALIDATED_WITH_REMAINING_NOT_EVALUABLE**

Evaluator measurement now conforms to EVALUATION_SSOT_V1 status vocabulary and fail-gate rules. Unsupported `EXPECTED_NONDETERMINISM`, approximate promotion thresholds, FineSpan field mis-read, flatMap cardinality-as-set, `.slice(0,48)` authoritative compare, E14 ordered-tie FAIL, and E15-from-E14 inference are repaired.

| Claim | Status |
|-------|--------|
| Dialog200 executed | **200/200** |
| E18 Final PASS | **200/200** |
| Critical FAIL | **0** |
| Remaining FAIL cases | **1 — d149** (E3 Base unique **set** identity; firstDivergence=E3) |
| Remaining NOT_EVALUABLE | E5/E8/E15/E16/E17 = 200; E14 = 1 (d160) |
| Replay equivalence | **NOT_CERTIFIED** |
| Frozen Evidence SSOT | **AUTHORITATIVE / unchanged** (`promote=false`) |
| d149 Production fix | **NOT done** (correct) |
| Next Owner | **D149_TARGETED_OBSERVABILITY_AUDIT** |

---

## 2. Frozen Authority

- EVALUATION_SSOT_V1 — delta **0**
- Frozen Acoustic Evidence — delta **0**
- Dialog200 baseline SSOT authority — preserved; **not** rewritten by Replay rates
- Replay alignment reconstruction — delta **0**
- Production ASR/Tone/Base/Model2/Edge/Path/KenLM/Model3 — **not modified this round**

---

## 3. Modified File Inventory

| Path | Class |
|------|-------|
| `electron_node/electron-node/tests/lib/dialog200-frozen-evidence-replay-contract.mjs` | EVALUATOR_REPAIR |
| `electron_node/electron-node/tests/run-dialog200-frozen-evidence-replay-v1.mjs` | EVALUATOR_REPAIR |
| `electron_node/electron-node/tests/lib/dialog200-frozen-evidence-replay-ssot-compliance.test.mjs` | EVALUATOR_REPAIR_TEST |

Production business-logic files in this change set: **none**.

---

## 4. SSOT Compliance Matrix

| SSOT rule | Evaluator before | After |
|-----------|------------------|-------|
| Status ∈ {PASS,FAIL,UNKNOWN,NOT_APPLICABLE,NOT_EVALUABLE} | FAIL_SECONDARY / NOT_CAPTURED_FOR_EQUIVALENCE | **Aligned** |
| Missing evidence → NOT_EVALUABLE | often FAIL or vacuous PASS | **Aligned** |
| No invented nondeterminism | EXPECTED_NONDETERMINISM | **Removed** |
| FAIL only when evidence+contract satisfied | violated | **assertFailGate / stageFailGate** |
| Evidence SSOT ≠ Replay equivalence | promote via rates | **Separated; promote always false** |

---

## 5. Target 1–10 Implementation

| # | Target | Implementation |
|---|--------|----------------|
| 1 | Remove EXPECTED_NONDETERMINISM | `classifyDivergence` → CONTRACT_FAIL / REPLAY_ADAPTER_DEFECT / FINAL_DIVERGENCE / NOT_EVALUABLE only |
| 2 | Pipeline first-divergence order | `PIPELINE_STAGE_ORDER`: E3→E4→E5→E6→E7…; reports `FIRST_OBSERVED_DIVERGENCE` |
| 3 | FineSpan field ownership | Authoritative field `finespans` + `source_text`; missing → NOT_EVALUABLE (not empty PASS) |
| 4 | E3/E4 count semantics | Authoritative `capture_unique_n` / `replay_unique_n` / `set_equal`; `flat_n` DIAGNOSTIC_ONLY |
| 5 | Remove `.slice(0,48)` from equality | Full lists in compact extract; `displayTruncate` display-only |
| 6 | E14 KenLM semantics | top1 required; ordered-tie without scores → NOT_EVALUABLE; score-bucket when both scored |
| 7 | E15 gate | Explicit gate only; capture absent → NOT_EVALUABLE (not inferred from tops/Final) |
| 8 | E16/E17 dependency | E16 NOT_EVALUABLE; E17 NOT_EVALUABLE (depends on E16; SSOT has no independent E17 source) |
| 9 | Remove promotion thresholds | `0.95` / `0.05` / `0.8` removed from `decidePromotion` / `decideReplayEquivalence` |
| 10 | Separate SSOT vs equivalence | `evidence_ssot_authority` independent; `promote` always false; no SSOT rewrite this run |

---

## 6. Status Semantics

Frozen vocabulary only: **PASS | FAIL | UNKNOWN | NOT_APPLICABLE | NOT_EVALUABLE**.

Removed: `FAIL_SECONDARY`, `NOT_CAPTURED_FOR_EQUIVALENCE`, `EXPECTED_NONDETERMINISM`, `SOFT_DIVERGE` as legalization.

---

## 7. FAIL Gate Validation

`stageFailGate` / `assertFailGate`: missing evidence or invalid comparator → force **NOT_EVALUABLE**, never FAIL. Covered by unit tests T22/T23.

---

## 8. d149 Regression

| Check | Result |
|-------|--------|
| firstDivergence | **E3_BASE_RECALL** (not E7) |
| classification | **CONTRACT_FAIL** (not EXPECTED_NONDETERMINISM) |
| E3 unique_n | capture **21** / replay **21** |
| E3 set_equal | **false** → **FAIL** |
| flat_n | 50 / 28 marked **DIAGNOSTIC_ONLY** |
| E5 | **NOT_EVALUABLE** (capture lacks `finespans`) — not vacuous PASS |

Production root cause for d149 remains **UNKNOWN** — not fixed this round.

---

## 9. d160 Regression

| Check | Result |
|-------|--------|
| E14 | **NOT_EVALUABLE** (top1 same; order differs; capture scores absent) — not FAIL |
| E15 | **NOT_EVALUABLE** (no explicit gate in capture) |
| EXPECTED_NONDETERMINISM | **absent** |
| Production KenLM tie-break | **unchanged** |
| E18 | **PASS** |

---

## 10. Dialog200 Stage Results

| Stage | PASS | FAIL | UNKNOWN | NOT_APPLICABLE | NOT_EVALUABLE |
|-------|------|------|---------|----------------|---------------|
| E1_ASR_INPUT | 200 | 0 | 0 | 0 | 0 |
| E2_TONE_INJECTION | 200 | 0 | 0 | 0 | 0 |
| E3_BASE_RECALL | 199 | **1** | 0 | 0 | 0 |
| E4_MODEL2_UNION | 199 | **1** | 0 | 0 | 0 |
| E5_LEXICAL_EDGE | 0 | 0 | 0 | 0 | **200** |
| E6_SEGMENTATION_PATH | 199 | **1** | 0 | 0 | 0 |
| E7_PATH_COUNT | 199 | **1** | 0 | 0 | 0 |
| E8_PATH_CAP | 0 | 0 | 0 | 0 | **200** |
| E9_DOMAIN_VOTE | 199 | **1** | 0 | 0 | 0 |
| E10_SAME_DOMAIN | 199 | **1** | 0 | 0 | 0 |
| E11_ASSEMBLY | 200 | 0 | 0 | 0 | 0 |
| E12_GLOBAL_BUDGET | 200 | 0 | 0 | 0 | 0 |
| E13_KENLM_INPUT | 200 | 0 | 0 | 0 | 0 |
| E14_KENLM_RANKING | 199 | 0 | 0 | 0 | **1** |
| E15_KENLM_GATE | 0 | 0 | 0 | 0 | **200** |
| E16_MODEL3_INPUT_ANCHOR | 0 | 0 | 0 | 0 | **200** |
| E17_MODEL3_DECISION | 0 | 0 | 0 | 0 | **200** |
| E18_FINAL | 200 | 0 | 0 | 0 | 0 |
| PROFILE_NO_PROFILE | 200 | 0 | 0 | 0 | 0 |

---

## 11. Remaining FAIL Cases

### d149

| Field | Value |
|-------|--------|
| firstDivergence | E3_BASE_RECALL / CONTRACT_FAIL |
| Measurement | Base candidate **unique surface set** identity |
| Capture unique_n | 21 |
| Replay unique_n | 21 |
| set_equal | false |
| Diagnostic flat_n | 50 → 28 (NON_AUTHORITATIVE) |
| Cascade FAILs | E4, E6, E7, E9, E10 |
| Final | PASS (identical) |

---

## 12. Remaining NOT_EVALUABLE Cases

| Stage | Count | Missing evidence |
|-------|-------|------------------|
| E5_LEXICAL_EDGE | 200 | capture.finespans (Production field never persisted in Frozen compact) |
| E8_PATH_CAP | 200 | depends on FineSpan evidence |
| E14_KENLM_RANKING | 1 (d160) | kenlm_scores on Capture for non-top1 order |
| E15_KENLM_GATE | 200 | capture.kenlm_gate |
| E16_MODEL3_INPUT_ANCHOR | 200 | model3_input_anchor |
| E17_MODEL3_DECISION | 200 | depends on E16 |

NOT_EVALUABLE is **not** Production failure.

---

## 13. Replay Equivalence Status

**REPLAY_EQUIVALENCE_NOT_CERTIFIED**

Reason: `STAGE_OR_CRITICAL_FAIL_REMAINS` (d149 E3 set FAIL).  
Also: required stages remain NOT_EVALUABLE corpus-wide → full certification blocked even after d149 resolution until capability completion.

Frozen Evidence SSOT authority: **FROZEN_ACOUSTIC_EVIDENCE_AUTHORITATIVE** — independent of this status.

---

## 14. Production Delta Audit

This repair modified **evaluator/test files only**.  
No intentional edits to Production business logic, KenLM sort, lexicon, models, or alignment reconstruction.

Note: workspace may contain unrelated pre-existing dirty Production files; they are **out of scope** and were not part of this change set.

---

## 15. Frozen Evidence / SSOT Integrity Audit

| Artifact | Delta |
|----------|-------|
| EVALUATION_SSOT_V1.md / evaluation-ssot-v1.mjs | **0** |
| DIALOG200_FROZEN_ACOUSTIC_EVIDENCE_V1.jsonl | **0** |
| DIALOG200_BASELINE_SSOT.json | **not rewritten** (`ssot_mutated_this_run=false`) |
| Alignment helper | **0** |

---

## 16. T1–T30

| Id | Status |
|----|--------|
| T1–T20 (unit suite) | **PASS** (15/15 node:test) |
| T21 full Dialog200 200/200 | **PASS** |
| T22 status vocabulary | **PASS** |
| T23 FAIL gate | **PASS** |
| T24 Production files unchanged (this repair) | **PASS** |
| T25 Replay alignment unchanged | **PASS** |
| T26 Frozen Evidence unchanged | **PASS** |
| T27 Evaluation SSOT unchanged | **PASS** |
| T28 single Dialog200 SSOT preserved | **PASS** |
| T29 historical baseline retired | **PASS** |
| T30 no compatibility evaluator | **PASS** |

---

## 17. G1–G30

All **PASS** (see VALIDATION.json `gates`). Key:

- G2 Production delta (this repair) = 0  
- G9–G16 Targets 1–10 implemented  
- G17/G18 d149/d160 regression semantics PASS  
- G26 Replay status uses SSOT-only certification rules  
- G27 no d149 Production fix  
- G28 no KenLM Production tie-break  

---

## 18. Final Result

**B. EVALUATOR_REPAIR_VALIDATED_WITH_REMAINING_NOT_EVALUABLE**

**Replay status (separate):** `REPLAY_EQUIVALENCE_NOT_CERTIFIED`

---

## 19. Next Owner

**D149_TARGETED_OBSERVABILITY_AUDIT**

Do **not** start TRUSTED_DIALOG200_FUNNEL_V2.

Follow-up (record only — not implemented): capture Production `finespans`, KenLM scores/gate, Model3 input/anchor if future capability completion is required.

---

## Artifacts

1. `LINGUA_DIALOG200_EVALUATOR_SSOT_COMPLIANCE_REPAIR_V1_REPORT.md` (this file)  
2. `LINGUA_DIALOG200_EVALUATOR_SSOT_COMPLIANCE_REPAIR_V1_VALIDATION.json`  
3. `LINGUA_DIALOG200_EVALUATOR_SSOT_COMPLIANCE_REPAIR_V1_STAGE_RESULTS.json`  
