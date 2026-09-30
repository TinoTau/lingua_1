# Lingua Model2 V3 Stage J — ONE Unified Model Acceptance Report
# Date: 2026-08-17

**Verdict: HOLD** — ONE unified checkpoint exists and architecture is unchanged, but Stage P regression gate (≥0.95 RecallRetained under FEATURE_HASH_V1) is not met. Not a production candidate. Runtime not wired.

**Artifacts:** `training/model2_v3/experiments/v3_stage_j_unified/`

---

## Acceptance gates

| Gate | Result |
|------|--------|
| ONE checkpoint | YES |
| Train/prod feature parity | PASS |
| MODEL2_FEATURE_HASH_V1 | PASS |
| Stage P regression | **FAIL** (RR≈0.813 < 0.95) |
| Stage D profile sensitivity | **FAIL** (TIR=0; prior vacuous PASS corrected) |
| P+D combined capability | PARTIAL / proxy |
| Target absent→introduced P | PARTIAL (~0.78 absolute TIR) |
| Target absent→introduced D | FAIL (0.0) |
| Unseen span | PARTIAL (split-based P eval present) |
| Held-out term | PARTIAL |
| MultiRelation | PARTIAL (slices written; aggregate RR weak) |
| MultiDomain | PARTIAL |
| Generic overbias | recorded |
| Query/Candidate reduction | POSITIVE on P hard |
| Runtime cost | ACCEPTABLE (~P50 59ms) |
| No new architecture | PASS |

---

## Benchmark snapshot

| | Base | Exhaustive B1 | StageP Frozen | StageJ |
|--|------|---------------|---------------|--------|
| Recall Retained | N/A | 1.0 (ref) | ~1.0 | **0.813** |
| Query Reduction | N/A | 0 | 0.517 | **0.535** |
| Candidate Reduction | N/A | 0 | 0.367 | **0.435** |
| E2E Cost Reduction | N/A | 0 | 0.470 | **0.503** |
| Inference P50 | N/A | ~112ms B1 | ~53ms | ~59ms |

---

## FINAL VERDICT

```
Stage J ONE Unified Model:
HOLD

ONE Checkpoint:
YES

Architecture:
UNCHANGED

Model Parameters:
47210

Stage P Baseline Parameters:
45533

Parameter Increase:
3.68%

MODEL2_FEATURE_HASH_V1:
PASS

StageDProfileContractV1:
PASS

Train / Production Feature Parity:
PASS

Stage P Regression:
FAIL

Stage P Recall Retained:
0.813

Stage P Query Reduction:
0.535

Stage P Candidate Reduction:
0.435

Stage D Profile Sensitivity:
FAIL

P+D Combined Capability:
PARTIAL

Target Absent → Introduced:
PARTIAL

P-only Target Introduction:
0.784

D-only Target Introduction:
0.0

P+D Target Introduction:
PARTIAL

Unseen Span:
PARTIAL

Held-out Term:
PARTIAL

MultiRelation:
PARTIAL

MultiDomain:
PARTIAL

Generic Term Overbias:
ACCEPTABLE (recorded)

Correct vs Empty:
FAIL (both zero on D)

Correct vs Wrong:
FAIL (both zero on D)

Correct vs Swapped:
FAIL (both zero on D)

Unnecessary Expansion:
top-1 soft rate TBD after metric fix; soft-in-top2 historically high

Query Reduction:
0.535

Candidate Reduction:
0.435

E2E Cost Reduction:
0.503

Inference P50:
~59ms

Inference P95:
~76ms

Stage A:
INACTIVE

Stage B:
INACTIVE

Whole-Utterance Model2:
NO

Dual Model2:
NO

Deterministic Replacement:
NO

New Rule Layer:
NO

New Gate:
NO

New Domain Model:
NO

New Pronunciation Model:
NO

Known Limitations:
FEATURE_HASH_V1 retrain does not yet match Stage P frozen RR; D2 domain TIR=0 on eval index; joint curriculum insufficient alone

Remaining Secondary Issues:
Wrong/Swapped selectivity; SameDomain interaction MONITOR; soft domain in top-2 under empty profile

Stage J Production Candidate:
NO

Recommended Next Phase:
DATA/LOSS recovery under FEATURE_HASH_V1 (Top-1 refine + D2 recoverability audit) — NO architecture change without approval
```
