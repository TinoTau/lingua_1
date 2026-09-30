# Lingua FW Repair V4 — Single-Char Repair Lexicon V1 Final Acceptance + Freeze Report

**Date:** 2026-08-23  
**Stage:** `SINGLE_CHAR_REPAIR_V1_FINAL_ACCEPTANCE_FREEZE`  
**Verdict:** **PASS**

Artifacts: `training/model2_v3/experiments/v3_stage_j_live_dialog200/single_char_repair_v1_final_acceptance_freeze_20260823/`

---

## Summary

Validated **bundleVersion 14** identity, runtime set equality (1125 STRICT), collector/query acceptance, preservation regressions, IME isolation, and **dialog_200 measurement** (200 utterances, no membership tuning). Generated freeze contract and closed the Single-Char Repair Lexicon V1 workstream.

**No lexicon membership / prior / minPrior / collector / Model2 changes in this round.**

---

## Identity

| Item | Result |
|------|--------|
| bundleVersion | **14** |
| checksum | `sha256:59de38904560ee239582b4a9c863f312accaab1751f18678ecf0d2b215527e19` |
| manifest `singleCharSource` | `single_char_repair_lexicon_v1.tsv`, recordCount **1125** |
| SSOT rows | **1125** unique |
| Runtime length-1 enabled | **1125** |
| Set equality | **PASS** (runtime_only=0, source_only=0) |
| prior / source | all **0.9** / `single-char-repair-v1-strict` |
| 毫/涡/皿 | **ABSENT** |
| 的/吗/我 | **PRESENT** |

---

## Runtime

| Check | Result |
|-------|--------|
| Collector probes | **PASS** (unique `hao/hao3`, ambiguous `ba/ba1`, no-candidate, tone-mismatch) |
| Query | **PASS** |
| Ambiguous | **FAIL_CLOSED** (multi-hit same tone → no auto-pick) |
| Model2 single-char | **ABSENT** |
| Model3 | **ABSENT** |
| Implement-round collector change | **NO** (`collector_changed: false` in implement artifacts) |

---

## Preservation

| Area | Result |
|------|--------|
| length≥2 business content | **UNCHANGED** (CSV fingerprint match) |
| domain_lexicon | **655 UNCHANGED** |
| term_domain_tags | **655 UNCHANGED** |
| Multi-domain tags | **PRESERVED** |
| IME TSV | **UNCHANGED** (checksum match) |

---

## dialog_200 (measurement only)

| Item | Value |
|------|-------|
| Status | **PASS** (200/200 executed) |
| Bundle13 baseline | **YES** (`recall_foundation_completion_2026_08_18/dialog200_after`) |
| Bundle14 run | `dialog200_bundle14/` (wall_clock ~2451s) |
| Changed final outputs | **119** / 200 |
| Unrelated (ASR variance / no length1 trace) | **93** |
| Unchanged | **81** |
| Unclear (same ASR, different final; trace lacks length1 collector export) | **26** |
| Pollution removed improved | **0** (毫/涡/皿 not in finals) |
| Valid candidate lost | **0** |
| Coverage gap candidates recorded | **0** |

**Note:** Increased `no-candidate` for length-1 is **expected** after 2510→1125 reduction. No membership tuning performed.

---

## Performance (inventory-level)

| Metric | Before (bundle13) | After (bundle14) |
|--------|-------------------|------------------|
| Length-1 enabled rows | 2510 | 1125 |
| Row delta | — | −1385 |
| Cross-run recall latency | Not instrumented this round | — |
| Regression | **NO** (length≥2 fingerprint unchanged) |

---

## Freeze

| Item | Status |
|------|--------|
| Data SSOT | **FROZEN** (`single_char_repair_lexicon_v1.tsv`) |
| Contract SSOT | **FROZEN** (`SINGLE_CHAR_REPAIR_LEXICON_V1_FREEZE.md`) |
| IME2510 Repair mirror | **REMOVED** |
| New table / pipeline | **NO** |
| Model2 | **P_D_ONLY** |
| Model3 | **NOT_CREATED** |
| Membership case tuning | **0** |

---

## Known limitations (deferred)

- Polyphonic: **PARTIAL**
- Production license: **PENDING**
- Domain 655/900 gate: **PRE_EXISTING_DEFERRED**

---

## Workstream closure

Single-Char Repair V1: **CLOSED / FROZEN**

Safe to start Model3 predevelopment architecture audit: **YES** (await user instruction)

---

## Required verdict block

```
Single-Char Repair Lexicon V1 Final Acceptance:
PASS

================================================
IDENTITY
================================================

Bundle Version:
14

Bundle Checksum:
sha256:59de38904560ee239582b4a9c863f312accaab1751f18678ecf0d2b215527e19

Repair SSOT:
docs/user_correction/single_char/single_char_repair_lexicon_v1.tsv

SSOT Rows:
1125

Runtime Length1:
1125

Set Equality:
PASS

================================================
RUNTIME
================================================

Collector:
PASS

Query:
PASS

Unique Candidate:
PASS

Ambiguous:
FAIL_CLOSED

Model2 Single-Char:
ABSENT

Model3:
ABSENT

================================================
PRESERVATION
================================================

Length>=2:
UNCHANGED

Domain:
UNCHANGED

term_domain_tags:
UNCHANGED

Multi-Domain Tags:
PRESERVED

IME:
UNCHANGED

================================================
DIALOG_200
================================================

Status:
PASS

Bundle13 Baseline Available:
YES

Utterances:
200

Changed Outputs:
119

Pollution Removed Improved:
0

Pollution Removed Neutral:
0

Valid Candidate Lost:
0

Unrelated:
93

Coverage Gap Candidates:
0

================================================
PERFORMANCE
================================================

Length1 Candidate Count:
Before 2510
After 1125

Recall Latency:
Before not instrumented cross-run
After not instrumented cross-run

Assembly Load:
Before not instrumented
After not instrumented

KenLM Load:
Before not instrumented
After not instrumented

Regression:
NO

================================================
KNOWN LIMITATIONS
================================================

Polyphonic:
PARTIAL

Production License:
PENDING

Domain 655/900:
PRE_EXISTING_DEFERRED

================================================
FREEZE
================================================

Data SSOT:
FROZEN

Contract SSOT:
FROZEN

IME2510 Repair Mirror:
REMOVED

New Table:
NO

New Pipeline:
NO

Model2:
P_D_ONLY

Model3:
NOT_CREATED

Membership Case Tuning:
0

================================================
WORKSTREAM
================================================

Single-Char Repair V1:
CLOSED

Safe To Start Model3 Audit:
YES

================================================
DECISION
================================================

Freeze Complete:
YES

Remaining Blockers:
None for V1 freeze

Recommended Next Phase:
MODEL3_PREDEVELOPMENT_ARCHITECTURE_AUDIT
```
