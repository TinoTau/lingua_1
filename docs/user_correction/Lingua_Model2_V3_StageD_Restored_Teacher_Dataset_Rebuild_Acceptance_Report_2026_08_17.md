# Lingua Model2 V3 — Stage D Restored Teacher / Dataset Rebuild
# Acceptance Report
# Date: 2026-08-17

**Stage:** `MODEL2_V3_STAGE_D_RETRIEVAL_EXECUTOR_RESTORATION_AND_DATA_REBUILD`  
**Training executed:** **NO**  
**V2 benchmark:** frozen / unmodified  
**Datasets:**
- `STAGE_D_RESTORED_TRAINSET_V1` → `training/model2_v3/dataset/policy_stage_d_restored_v1/rows.jsonl`
- `STAGE_J_RESTORED_TRAINSET_V1` → `training/model2_v3/dataset/policy_stage_j_restored_v1/rows.jsonl`
- `STAGE_J_PRODUCTION_BENCHMARK_V3_CANDIDATE` → `training/model2_v3/experiments/v3_stage_j_benchmark_v3_candidate/`

Teacher and eligibility are execute-validated against the **restored** domain-conditioned FuzzyPool executor. The old D teacher is **SUPERSEDED** (historical artifacts kept; not a new training input).

---

## Teacher

| Item | Value |
|------|------:|
| Old teacher | SUPERSEDED |
| New teacher | EXECUTE_VALIDATED |
| Flow | base-absent → evidence-valid domain action → execute restored executor → identity introduced |
| Teacher AnyRecover (new eligible) | **1.0** (404 / 404) |
| Old vs new on superseded J1-prod slice N=66 | identical sets **0**; Jaccard **0.213**; new still recovers **66 / 66** |
| DomainNone negatives | CF non-CORRECT **1616**; trainset `D_NONE_NEGATIVE` **1328** |
| Target-domain leak into input | **NO** (evidence from UserProfile × Lexicon tags) |

The old slice labels were execute-validated against shared-pool rerank (e.g. coffee terms labeled `tourism_hotel`). Restored labels are domain-conditioned. That is why stability collapsed and why **retrain is required** before any production claim.

---

## Eligible D (not a conversion of the old 45)

Rebuilt from full domain-term population + REAL_ASR + dialog_200 + derived-real relation corruption + controlled synthetic.

| Item | Value |
|------|------:|
| Old D eligible (V2 unique) | 45 |
| New D eligible | **404** |
| Unique D spans | **404** |
| Unique D terms | **281** |
| Honest coverage vs 100/300/500/1000 | 300 **met**; 500 **not met** (not padded) |
| REAL | 7 (1.7%) |
| DERIVED_REAL | 57 (14.1%) |
| SYNTHETIC | 340 (84.2%) |
| Domain coverage | all 12 slots; food_order 101, coffee 80, tourism_transport 75, medical 51, meeting 15, tech_ai 22 |
| Relation coverage | ACTIVE_SET present; many `multi` / `unknown` from 2-edit synthetic |
| Counterfactual groups | **404** (CORRECT / EMPTY / WRONG / SWAPPED / GENERIC) |
| Generic rows | 404 |
| Multi-domain eligible cases | 148 |
| P+D cases | **64** |
| True synergy (P-fail ∧ D-fail ∧ Full-succeed) | **0** (structural: D-eligible requires D introduce; not fabricated) |
| Leakage (term train∩test; V2 test→train) | **PASS** |
| Split | train 286 / val 46 / test 72 (term-exclusive) |

REAL remains scarce: REAL_ASR domain FineSpans that are base-absent **and** restored-recoverable are few. That is reported, not disguised with synthetic “REAL” tags.

---

## Trainsets / benchmark candidate

| Artifact | N | Note |
|----------|--:|------|
| STAGE_D_RESTORED_TRAINSET_V1 | 1732 | CORRECT + domain_none negatives; test not used as train |
| STAGE_J_RESTORED_TRAINSET_V1 | 7715 | P_ONLY 6000 + D_ONLY 332 + D_NONE_NEGATIVE 1328 + P_PLUS_D 55 |
| STAGE_J_PRODUCTION_BENCHMARK_V3_CANDIDATE | D 72 spans / 49 terms | V2 frozen; lineage overlap with old test = **7**; prefer new CLEAN holdout |

V2 test was **not** written into the restored training split.

---

## Retrain readiness (this round still does not train)

All restoration + data gates: **PASS**.

**Retrain Ready: YES**  
**Stage D retrain required: YES**  
**Stage J retrain required: YES**  
**Training executed: NO**

Recommended initialization: **P1_PLUS_FRESH_DOMAIN_HEAD**  
Why: J1 domain-head argmax matches the new teacher on only **0.225** (n=80 restored sample). Old-slice restored-action hit **0.83** was measured against the superseded eligible set. Domain-head contamination from the old executor is likely. P trunk remains reusable. A controlled A/B vs J1 fine-tune can still be run next round if desired.

---

## Next phase

`CONTROLLED_RESTORED_STAGE_D_AND_STAGE_J_RETRAIN` — same RetrievalPolicyV3, new teacher/dataset, no architecture change, no runtime swap until the retrained checkpoint is accepted.
