# Lingua Model2 V3 — Stage J J1 Blind Production Benchmark Acceptance Report
# Date: 2026-08-17

**Verdict: PARTIAL / NOT_PRODUCTION_PROVEN** — Frozen J1 was evaluated **without retraining** on `STAGE_J_PRODUCTION_BENCHMARK_V2`. P is stable vs P1. D profile value is positive on a **VERY_LOW_SUPPORT** unique slice. Coverage is still too small for a production claim. Failures were recorded, not patched.

**Checkpoint:** `training/model2_v3/experiments/v3_stage_j_j1_prod/training/j1_unified_checkpoint.pt`  
**Params:** 47210  
**J1 modified / retrained:** NO  
**Architecture:** UNCHANGED  
**Runtime swap:** NOT DONE

**Eval artifacts:** `training/model2_v3/experiments/v3_stage_j_benchmark_v2/`

---

## Protocol

1. Freeze V2 (see expansion report). V1 untouched.
2. Load frozen J1. `strict=True`. FEATURE_HASH_V1.
3. No loss/threshold/rule/architecture change after seeing scores.
4. Primary D metrics = `CLEAN` only (never seen in J1 train FineSpan keys). Contaminated rows reported separately.
5. Primary P metrics = frozen hard set N=699 (same contract as P1 / J1 V1).

Harness note: V2 `p_only.jsonl` initially dropped `n_applicable` / `applicability` / `base_pool`. Those fields were restored from Phase2 `rows.jsonl` by `row_id` (same FineSpans/labels). A first P RR≈0.43 was a packing bug, not a model change. Authoritative P numbers below use the repaired feature pack.

---

## P (frozen hard, vs P1)

| Metric | Value |
|--------|-------|
| P1 baseline RR | 0.955 / N=699 |
| **J1 Blind P RR** | **1.010** / N=699 |
| TIR_B1 | 0.960 |
| TIR_V3 | 0.970 |
| 95% Wilson CI (TIR_V3) | **[0.955, 0.980]** |
| Held-out RR | **1.009** / N=439 / TIR 0.973 CI **[0.953, 0.984]** |
| Teacher Top1 / Top2 | 0.964 / 1.0 |
| QueryReduction | 0.529 |
| CandidateReduction | 0.380 |
| Weakest relation (n=120 each) | **in_ing** RR=0.983 |
| P regression | **NO** |

Relation subsample RR: n_l 1.009, z_zh 0.991, ch_c 1.017, sh_s 1.026, eng_en 1.009, in_ing 0.983, h_f 1.044. All N=120 / support OK. No hidden P collapse on the large sample.

---

## D (CLEAN blind)

| Metric | Value |
|--------|-------|
| Oracle N | 20 / TIR 1.0 |
| J1 D RecallRetained | **1.0** / N=20 |
| Unique spans / terms in CLEAN | 14 / 15 |
| 95% CI (TIR) | **[0.839, 1.0]** |
| Support | **VERY_LOW_SUPPORT** |
| All-incl-contaminated | RR=1.0 / N=45 / LOW_SUPPORT |
| Held-out term | 1.0 / N=6 / VERY_LOW_SUPPORT |
| Held-out span | 1.0 / N=24 / VERY_LOW_SUPPORT |

Perfect D RR on 20 CLEAN cases is **not** production proof.

### Profile value (CLEAN groups N=20)

| Persona | TIR | 95% CI |
|---------|-----|--------|
| Correct | 1.00 / N=20 | [0.839, 1.0] |
| Empty | 0.40 / N=20 | [0.219, 0.613] |
| Wrong | 0.65 / N=20 | [0.433, 0.819] |
| Swapped | 0.50 / N=20 | [0.299, 0.701] |
| Correct−Empty | **+0.60** | |
| Correct−Wrong | **+0.35** | |
| Correct−Swapped | **+0.50** | |
| PROFILE_VALUE | **STRONG** (delta), sample **VERY_LOW_SUPPORT** |

Empty TIR=0.40 and Wrong TIR=0.65 remain the same secondary issues as V1: over-expansion / weak wrong-profile rejection.

---

## P+D

| Mode | TIR / N |
|------|---------|
| No profile | 0.00 / N=20 / VERY_LOW_SUPPORT |
| P-only | 0.00 / N=20 |
| D-only | 1.00 / N=20 |
| Full P+D | 1.00 / N=20 / CI [0.839, 1.0] |
| Full ≥ best single | YES |
| Joint interference | **NO** |

These P+D rows are D FineSpans plus an inferred phonetic bias. P-only cannot recover the domain identity; D-only already can. That is **domain-dominates + attached P**, not dual-signal synergy.

| Synergy | Value |
|---------|-------|
| Eligible (P-fail ∧ D-fail) | **0** |
| Success | 0 |
| Rate | n/a (N=0) |
| 95% CI | undefined |

`SYNERGY_PD_COUNT = 0` is a **data** result, not a model-fail-then-rewrite-benchmark result.

---

## Generalization / other slices

| Slice | Result |
|-------|--------|
| Held-out term (D) | 1.0 / N=6 VERY_LOW_SUPPORT |
| Held-out span (D) | 1.0 / N=24 VERY_LOW_SUPPORT |
| Held-out P | 1.009 / N=439 OK |
| Held-out profile combo | constructed (9 PD rows); not separately powered |
| Multi-domain | TIR 1.0 / N=20 VERY_LOW_SUPPORT |
| Generic (≥3 tags) | correct-profile TIR 1.0 / N=14; empty-profile expansion **0.50** |
| HARD_D | TIR 1.0 / N=45 LOW_SUPPORT |
| HARD_PD | N=9, not separately scored beyond PD primary |
| Negatives (empty profile) | unnecessary expansion **0.489** / N=45 |

`GENERIC_OVERBIAS` is the highest-count failure class after P rank misses (29 empty-profile expansions on generic/empty negatives).

---

## Efficiency

| Metric | Value |
|--------|-------|
| P QueryReduction vs B1 | 0.529 |
| P CandidateReduction vs B1 | 0.380 |
| Inference P50 (P select+exec, CPU) | 66 ms |
| Inference P95 | 87 ms |
| D P50 | 74 ms |
| E2E / retrieval cost | bounded qb=1 / domain budget=2 / max_cands=8 (unchanged) |

Latency is probe-host CPU, not Node E2E.

---

## Failure taxonomy (exported, not fixed)

| Class | Count |
|-------|-------|
| P_TOP1_RANK_MISS | 19 |
| GENERIC_OVERBIAS / UNNECESSARY_EXPANSION | 29 |
| PD_SYNERGY_MISS | 0 (no eligible) |
| PD_INTERFERENCE | 0 |
| D_ACTION_SELECTION_MISS | 0 on CLEAN |

Traces: `stage_j_v2_failure_cases.jsonl` (21 P misses + D/generic notes as applicable).

This round **did not** retune loss, thresholds, or rules.

---

## Production decision

Two freeze-bar reasons are distinct:

1. **NOT_PRODUCTION_PROVEN** — D unique spans=20 (goal ≥100), P+D/held-out/counterfactual LIMITED, REAL D share tiny, three domains have zero eligible cases. **This is the binding reason.**
2. **HOLD_FOR_MODEL_IMPROVEMENT** — not binding on this eval. P is stable. D delta is positive. Joint interference is NO. Remaining model issues (Wrong/Empty over-expansion, generic overbias) are **known secondary** and still underpowered.

J1 is **not** a production candidate. Runtime skeleton is **not** swapped.

---

## Required verdict block

Stage J Benchmark V2:
PARTIAL

Benchmark Frozen:
YES

J1 Checkpoint Modified:
NO

J1 Retrained:
NO

====================
COVERAGE
====================

Raw Cases:
P=1123 (hard 699 + extra 424); D eligible=45; PD=61; CF=180; negatives=225

Effective Unique Cases:
D unique keys=45; D unique spans=20; near-dup effective N=45

Real:
1 D eligible (2.2%)

Derived Real:
20 D eligible (44.4%)

Synthetic:
24 D eligible (53.3%)

P Unique Spans:
630

P Unique Terms:
465

D Unique Spans:
20

D Unique Terms:
33

P+D Unique Spans:
20

P+D Unique Terms:
33

Synergy P+D N:
0

Hard-D N:
45

Hard-P+D N:
9

Held-out Terms:
4 D terms / 6 rows; P held-out N=439

Held-out Spans:
24 D rows with multi-span terms

Counterfactual Groups:
45

P Coverage:
STRONG

D Coverage:
LIMITED

P+D Coverage:
LIMITED

Held-out Coverage:
LIMITED

====================
P
====================

P1 Baseline RR:
0.955

J1 Blind P RR:
1.010

N:
699

95% CI:
TIR_V3 [0.955, 0.980]

Held-out RR:
1.009 / N=439 / TIR CI [0.953, 0.984]

Weakest Relation:
in_ing (RR=0.983 / N=120)

P Regression:
NO

====================
D
====================

D Oracle N:
20

J1 D RecallRetained:
1.0

N:
20 (CLEAN; VERY_LOW_SUPPORT)

95% CI:
[0.839, 1.0]

Correct:
1.00 / N=20

Empty:
0.40 / N=20

Wrong:
0.65 / N=20

Swapped:
0.50 / N=20

Correct-Empty:
+0.60

Correct-Wrong:
+0.35

Correct-Swapped:
+0.50

Profile Value:
STRONG (delta) / VERY_LOW_SUPPORT (N)

====================
P+D
====================

No Profile:
0.00 / N=20

P-only:
0.00 / N=20

D-only:
1.00 / N=20

Full P+D:
1.00 / N=20

P+D N:
20 primary CLEAN-aligned

Synergy Eligible:
0

Synergy Success:
0

Synergy Rate:
n/a (N=0)

Joint Interference:
NO

====================
GENERALIZATION
====================

Held-out Term:
1.0 / N=6 VERY_LOW_SUPPORT

Held-out Span:
1.0 / N=24 VERY_LOW_SUPPORT

Held-out Profile Combination:
constructed N=9; underpowered

Multi-domain:
1.0 / N=20 VERY_LOW_SUPPORT

Generic Terms:
correct TIR 1.0 / N=14; empty expansion 0.50 GENERIC_OVERBIAS

====================
EFFICIENCY
====================

Query Reduction:
0.529

Candidate Reduction:
0.380

Inference P50:
66 ms (CPU probe)

Inference P95:
87 ms

E2E Cost:
unchanged budgets (qb=1, domain k=2, cands=8); Node E2E not run

====================
DECISION
====================

Architecture:
UNCHANGED

Architecture Change Required:
NO

Benchmark Statistical Coverage:
LIMITED

J1 Generalization:
PARTIAL

J1 Production Candidate:
NO

Reason:
NOT_PRODUCTION_PROVEN because unique D/P+D coverage is still far below the minimum unique-span bar, REAL D is almost absent, and three DOMAIN_SLOT_IDS have zero eligible cases. P is stable vs P1; D Correct−Empty is positive but N=20 cannot support a production claim. Synergy is unmeasurable (eligible 0) because current P+D cases are D-recoverable FineSpans.

Highest Priority Failure Class:
GENERIC_OVERBIAS

Known Secondary Issues:
WRONG_SWAPPED_DOMAIN_CANDIDATE_BUDGET_SELECTIVITY
DOWNSTREAM_SAMEDOMAIN_INTERACTION
EMPTY_PROFILE_UNNECESSARY_EXPANSION
REAL_D_ONLY_COVERAGE_LIMITATION
NO_TRUE_SYNERGY_PD_CASES

Recommended Next Phase:
LEXICON_SOFT_PRIOR_YIELD_AUDIT (why only ~20 unique D FineSpans exist under frozen contract) then keep V2 frozen; any future J2 train on a **separate** train set and blind-eval on this V2. Do **not** relax D eligibility. Do **not** swap J1 into runtime until coverage is honest and powered.
