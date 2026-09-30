# Lingua Model2 V3 — Stage J Production Benchmark V2 Expansion Report
# Date: 2026-08-17

**Verdict: PARTIAL** — `STAGE_J_PRODUCTION_BENCHMARK_V2` is frozen and reproducible. Unique P coverage expanded. Unique D/P+D coverage remains **LIMITED** under the frozen soft-prior contract; this is the honest maximum, not a relaxed gate.

**Artifacts:** `training/model2_v3/experiments/v3_stage_j_benchmark_v2/`  
**V1:** retained unmodified (`v3_stage_j_j1_prod`)  
**Training dataset:** not written. Candidate pool is `split=test` only.  
**J1 checkpoint:** not loaded, not trained.

---

## What this round did

Built a **separate** production benchmark V2 for blind evaluation of the frozen J1 checkpoint.

Did **not**: train, fine-tune, change architecture, change Feature Hash / Profile / Target Identity contracts, change soft-prior product semantics, or wire runtime.

---

## Freeze record

| Field | Value |
|-------|--------|
| Benchmark | `STAGE_J_PRODUCTION_BENCHMARK_V2` |
| Frozen | YES |
| Created | 2026-08-17T07:05:00Z |
| Feature hash | MODEL2_FEATURE_HASH_V1 |
| Profile contract | StageDProfileContractV1 |
| Target identity | StageDRetrievalTargetIdentityV1 |
| Action space | RetrievalPolicyV3_P_plus_D_soft |
| Lexicon index | `candidate_index_stage_d2.jsonl` |
| Lexicon sha256 | `8493dd4737e9ae87173973bce3c6e32b58cf0a0c8c0a8700bf341986ebb71960` |
| D-only eligibility | FROZEN (base-absent ∧ lexicon ∧ evidence ∧ execute-validated soft action ∧ identity match) |

Once frozen, test definition is not edited because of model scores.

---

## Sources (priority order)

| Source | Role | Yield |
|--------|------|-------|
| REAL_ASR span traces | 40 lines, 7 domain targets | 1 unique D case |
| Phase2 REAL_ASR domain-target rows | 6510 rows; most FineSpans are wrong window length | 0 additional unique after length filter |
| dialog_200 lexicon surface hits | 180 surface hits | +1 unique |
| Lexicon domain + ACTIVE_SET / controlled corruption | 655 domain terms scanned | bulk of unique D |
| V1 eligible carry-forward | contamination tagged | 33 terms preserved |
| Real correction history | **ABSENT** | 0 |

### Source class (D eligible N=45)

| Class | N | Share |
|-------|---|-------|
| REAL | 1 | 2.2% |
| DERIVED_REAL | 20 | 44.4% |
| SYNTHETIC | 24 | 53.3% |
| Real-or-derived | 21 | 46.7% |

Production claims **cannot** rest on this mix. Synthetic is reported, not hidden.

---

## Unique coverage (the actual goal)

| Slice | Unique spans | Unique terms | vs V1 |
|-------|--------------|--------------|-------|
| P-only (hard+extra held-out) | **630** | **465** | 235 / 183 → STRONG |
| D-only eligible | **20** | **33** | 16 / 33 → +4 spans, same terms |
| P+D | **20** | **33** | same D FineSpans + phonetic profile |
| D rows (profile variants counted separately) | 45 | 33 | V1 had 132 rows / 16 spans |

Coverage goals (≥100 / 300 / 500 / 1000 unique D spans) are **not met**. They are coverage goals, not a license to invent term→domain maps or relax eligibility.

**Actual maximum under frozen contract:** 20 unique D FineSpans / 33 unique D terms after exhaustive scan of:

- 655 lexicon domain terms
- relation-targeted + controlled corruption
- REAL_ASR + dialog_200

Bottleneck (unchanged): after FuzzyPool surface-dedup, most domain identities stay **base-visible**, or soft prior cannot promote the target into top-k. Relation-only edits usually remain base-visible; only a sparse subset is execute-validated recoverable.

---

## Dedup / near-dup / leakage

| Audit | Result |
|-------|--------|
| Exact unique-key dups removed | 211 |
| Unique D keys | 45 |
| Near-dup clusters (same term, syllable ED≤1) | effective unique N = 45 (raw 45) |
| Terms with ≥2 distinct spans | 12 |
| V1 train overlap keys | 22 tagged `SEEN_IN_J1_TRAIN` |
| CLEAN D | 20 |
| TERM_SEEN_IN_P_TRAIN | 3 |
| Held-out D terms not in P train | YES (4 terms / 6 rows) |
| Written to training dataset | NO |

SEEN/CONTAMINATED cases remain in the pool for diagnostic slices; **primary D blind metrics use CLEAN only**.

---

## Strata inventory

| Stratum | N | Support |
|---------|---|---------|
| P_ONLY hard frozen | 699 | OK |
| P unique extra held-out | 424 | OK |
| D_ONLY eligible | 45 (20 unique spans) | VERY_LOW / LOW |
| P_PLUS_D | 61 (45 primary + combo + conflict) | VERY_LOW |
| SYNERGY_PD | classified at eval (eligible 0) | VERY_LOW |
| HARD_P | 699 | OK |
| HARD_D | 45 (multitag) | LOW |
| HARD_PD | 9 | VERY_LOW |
| NEGATIVE | 225 | OK |
| COUNTERFACTUAL groups | 45 × {Correct, Empty, Wrong, Swapped} | LIMITED |
| HELDOUT_TERM (D) | 6 / 4 terms | VERY_LOW |
| HELDOUT_SPAN | 24 | VERY_LOW |
| MULTIDOMAIN | 45 | LOW |
| GENERIC_TERM (≥3 tags) | 14 | VERY_LOW |
| Cardinality variants | 180 (1/5/20/50/100 × confirms) | diagnostic |

P+D slices present: D-helps+P-present, held-out profile combinations, P/D conflict. True `P_ONLY_FAIL ∧ D_ONLY_FAIL ∧ FULL_SUCCEED` cannot be **mined** from current D FineSpans because D-only already recovers them.

---

## Relation / domain coverage (D)

D relation unique counts: `ch_c=5, z_zh=4, in_ing=3, n_l=2`; `sh_s / eng_en / h_f = 0` in D-eligible. All relations are LOW_SUPPORT on D.

P relation coverage on hard set remains the Phase2 REAL_ASR hard slice (N=699), including previously weak `n_l / ch_c / in_ing`.

Domain eligible counts (multi-tag terms counted in every tag):

| Domain | N | Flag |
|--------|---|------|
| food_order | 26 | |
| milk_tea | 20 | |
| tourism_pickup / tourism_transport | 15 | |
| coffee | 14 | |
| bakery | 10 | |
| transport | 6 | |
| tourism_hotel | 4 | LOW_SUPPORT |
| tourism_route | 2 | LOW_SUPPORT |
| tech_ai / meeting / medical | **0** | LOW_SUPPORT_DOMAIN |

Aggregate D numbers **must not** be read as coverage of tech_ai / meeting / medical.

---

## Coverage verdict

| Axis | Grade |
|------|-------|
| P | STRONG |
| D | LIMITED |
| P+D | LIMITED |
| Held-out | LIMITED |
| Counterfactual | LIMITED |

**Production freeze bar:** `NOT_PRODUCTION_PROVEN` (coverage), independent of J1 scores.

---

## Scripts

- `training/model2_v3/scripts/run_v3_stage_j_benchmark_v2_expand.py`
- `training/model2_v3/scripts/run_v3_stage_j_benchmark_v2_blind_eval.py`

V1 expand script and V1 dataset were not modified.
