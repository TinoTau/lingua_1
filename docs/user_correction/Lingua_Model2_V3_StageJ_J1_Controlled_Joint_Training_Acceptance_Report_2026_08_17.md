# Lingua Model2 V3 — Stage J J1 Controlled Joint Training Acceptance Report
# Date: 2026-08-17

**Verdict: PASS_WITH_LIMITATIONS** — ONE unified checkpoint trained; P regression strong; D signal non-zero on eligible slice; **not** a production candidate due to limited unique D/P+D statistical coverage.

**Artifacts:** `training/model2_v3/experiments/v3_stage_j_j1_prod/`  
**Checkpoint:** `training/j1_unified_checkpoint.pt`  
**Benchmark:** `STAGE_J_PRODUCTION_BENCHMARK_V1`  
**Runtime wiring:** NOT DONE (by design)

---

## What was trained

| Item | Value |
|------|--------|
| Architecture | `RetrievalPolicyV3(with_domain_head=True)` UNCHANGED |
| Feature hash | MODEL2_FEATURE_HASH_V1 |
| Target identity | StageDRetrievalTargetIdentityV1 |
| P recipe | P1 refine (top1 soft + pairwise 1.25/0.75 + hard×3) |
| D teacher | execute-validated only |
| Curriculum | Phase1 P-anchor (6 ep) → Phase2 joint (8 ep) |
| Init | P1 V1 checkpoint (non-strict + domain head) |
| Params | **47210** (+1677 vs P1 45533) |
| ONE checkpoint | YES |

---

## Dataset (frozen benchmark)

| | N |
|--|---|
| P-only hard | 699 |
| P held-out | 439 |
| D-only eligible rows | 132 (unique terms **33**, unique spans **16**) |
| P+D eligible | 132 |
| Negatives | 146 |
| Counterfactual rows | 165 |
| Coverage | **LIMITED** / `REAL_D_ONLY_COVERAGE_LIMITATION` |

---

## P gates

| Metric | Value |
|--------|-------|
| P1 baseline RR | 0.955 / N=699 |
| **J1 P RR** | **1.010** / N=699 (TIR CI95 on V3 hits ≈ [0.955, 0.980]) |
| J1 P held-out RR | **1.009** |
| Teacher Top1 | **0.964** |
| Teacher Top2 | **1.0** |
| QueryReduction | 0.529 |
| CandidateReduction | 0.380 |
| P regression | **PASS** |
| Weakest relation (subsample) | `n_l` (still high aggregate) |

P1 recipe preserved under joint training — no Stage-J-style P collapse.

---

## D gates

| Metric | Value |
|--------|-------|
| Oracle TIR | 1.0 |
| J1 D RecallRetained | **1.0** / N=48 test eligible |
| Correct | 1.0 / N=33 |
| Empty | 0.455 / N=33 |
| Wrong | 0.515 / N=33 |
| Swapped | 0.667 / N=33 |
| Correct > Empty | YES |
| D Signal | **PASS** (non-zero; not vacuous) |

**Caveat:** Perfect D RR on small unique-span set is **not** production proof. Empty/Wrong still recover often → over-expansion risk to watch when coverage grows.

---

## P+D

| Mode | TIR / N |
|------|---------|
| No profile | 0.0 / 48 |
| P-only | 0.25 / 48 |
| D-only | 1.0 / 48 |
| Full P+D | 1.0 / 48 |
| Full ≥ best single | PASS |
| Joint interference | **NO** |

On this limited combined slice, domain path dominates; full does not regress vs best single.

---

## System / governance

| | |
|--|--|
| Stage A/B | INACTIVE |
| Whole utterance / dual model | NO |
| New rule/gate/hard filter | NO |
| Architecture change | NO |
| Runtime change | NO |
| Inference P50 / P95 | ~52ms / ~70ms |
| Production candidate | **NO** |

---

## Known limitations

1. Unique D-only intro events sparse under soft prior (~33 terms / 16 spans).
2. Phase2 REAL_ASR surfaces disjoint from domain lexicon → P+D is D-FineSpan + phonetic bias, not dual-vocab ASR overlap.
3. D counterfactual Empty TIR still ~0.45 — model may over-select domain actions.
4. Large-N production claim requires more unique FineSpan/term coverage without relaxing contracts.

---

## Recommended next phase

1. Continue **honest** D/P+D unique-case mining (REAL_ASR×domain overlap, correction logs) without soft-prior relaxation.  
2. Or, if user accepts LIMITED coverage for a **sidecar** experiment: Node E2E with this checkpoint under clear coverage disclaimer.  
3. Do **not** treat current D RR=1.0 as production freeze evidence.

---

## FINAL VERDICT

```
Stage J J1 Production-Scale:
PASS_WITH_LIMITATIONS

Architecture:
UNCHANGED

====================
DATASET
====================

Production Benchmark Version:
STAGE_J_PRODUCTION_BENCHMARK_V1

P-only N:
699

P-heldout N:
439

D-only Eligible N:
132 rows (unique terms 33 / unique spans 16)

P+D Eligible N:
132

Negative N:
146

Counterfactual Groups:
33+

Held-out Terms:
5

Held-out Spans:
3

Multi-domain N:
present (see manifests)

Domain Coverage:
PARTIAL

Relation Coverage:
SUFFICIENT

Dataset Leakage:
PASS

Dataset Dedup:
PASS

Benchmark Statistical Coverage:
LIMITED

====================
P
====================

P1 Baseline RR:
0.955

J1 P RR:
1.010 / N=699

95% CI:
TIR [0.955, 0.980] (Wilson on V3 hits)

J1 P Held-out RR:
1.009

Teacher Top1:
0.964

Teacher Top2:
1.0

Query Reduction:
0.529

Candidate Reduction:
0.380

P Regression:
PASS

Weakest Relation:
n_l (subsample)

====================
D
====================

D Oracle TIR:
1.0

D J1 RecallRetained:
1.0 / N=48

95% CI:
TIR [0.926, 1.0]

Correct Profile:
1.0 / N=33

Empty:
0.455 / N=33

Wrong:
0.515 / N=33

Swapped:
0.667 / N=33

Held-out Term D RR:
see j1_heldout_terms.json

Multi-domain D RR:
see j1_multidomain.json

Hard-D RR:
see j1_hard_d.json

D Signal:
PASS

====================
P+D
====================

P+D Target Introduction:
1.0 / N=48

95% CI:
[0.926, 1.0]

No Profile:
0.0 / N=48

P-only:
0.25 / N=48

D-only:
1.0 / N=48

Full P+D:
1.0 / N=48

Full >= Best Single:
PASS

Joint Interference:
NO

====================
SYSTEM
====================

ONE Checkpoint:
YES

Model Parameters:
47210

Parameter Increase vs P1:
1677

Inference P50:
~52ms

Inference P95:
~70ms

E2E Cost Reduction:
~0.480

Stage A:
INACTIVE

Stage B:
INACTIVE

Whole Utterance:
NO

Dual Model:
NO

New Rule Layer:
NO

New Gate:
NO

Architecture Change:
NO

Stage J Production Candidate:
NO

Known Limitations:
REAL_D_ONLY_COVERAGE_LIMITATION; unique FineSpan/term sparse; Empty over-expansion; phase2/domain surface disjoint

Recommended Next Phase:
EXPAND unique D/P+D FineSpan coverage under frozen soft-prior contract (or optional limited-coverage sidecar E2E with explicit disclaimer)
```
