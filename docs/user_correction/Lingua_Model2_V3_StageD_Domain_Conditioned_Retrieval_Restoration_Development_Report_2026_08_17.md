# Lingua Model2 V3 — Stage D Domain-Conditioned Retrieval Restoration
# Development Report
# Date: 2026-08-17

**Stage:** `MODEL2_V3_STAGE_D_RETRIEVAL_EXECUTOR_RESTORATION_AND_DATA_REBUILD`  
**Mode:** DEVELOPMENT + TESTING. **No training. No J1/J2 retrain. No runtime checkpoint swap.**  
**Baseline:** `Lingua_Model2_V3_StageD_Restore_vs_Retrain_Decision_Audit_2026_08_17.md`  
**Decision executed:** `RESTORE_THEN_REBUILD_DATA_AND_RETRAIN` — this round is restore + teacher/dataset rebuild only.  
**Artifacts:** `training/model2_v3/experiments/v3_stage_d_restored/`  
**Contract:** `docs/user_correction/stage_d_domain_conditioned_retrieval_contract_v1.md`

---

## What was restored

This is **RESTORE ORIGINAL DESIGN**, not a new architecture.

Authoritative Stage D path is now:

```
FineSpan syllables
+ Model2-selected domain_soft:{slot}
    → FuzzyPool phonetic gates over records where slot ∈ domain_ids
    → domain candidate set
    → UNION unchanged base recall
    → StageDRetrievalTargetIdentityV1 dedup
    → ONE per-FineSpan budget (max_cands=8)
```

`domain_none` is a no-op expansion. Empty UserProfile does **not** open a domain universe. The retired `max(0.35, selected)` floor is gone.

ONE fuzzy algorithm: `build_fuzzy_pool` with optional `allowed_domain_ids`. There is no `build_domain_fuzzy_pool`, no DomainFuzzyEngineV2, no Node SQL second branch, no leftover shared-pool rerank fallback.

---

## Code change (minimal)

| File | Change |
|------|--------|
| `training/model2/fuzzy/pool.py` | `FuzzyPoolRequestV1.allowed_domain_ids` universe predicate (any-tag match) |
| `training/model2_v3/policy/domain_actions.py` | replace `soft_domain_retrieve` body: domain-conditioned pool → UNION → one budget |
| `docs/user_correction/stage_d_domain_conditioned_retrieval_contract_v1.md` | train/runtime SSOT |

Unchanged: RetrievalPolicyV3, action IDs, MODEL2_FEATURE_HASH_V1, StageDProfileContractV1, StageDRetrievalTargetIdentityV1, FineSpan, KenLM, Tone, DomainAwareAssembly, Node `queryDomainMultiRowsAtomic` (exact lookup only).

---

## Budget

| Cap | Kind | Value |
|-----|------|------:|
| Base FuzzyPool | existing base recall | 16 |
| Domain FuzzyPool | `IMPLEMENTATION_SAFETY_CAP` | 256 |
| Union output | business owner `execute_domain_action.max_cands` | 8 |

Nested 32→8: **REMOVED**. Final business cap: **UNCHANGED**. Model budget heads: **not enabled**.

On the frozen 38 BASE_ABSENT cases: safety-cap hit = 0; max domain raw n = 60 < 256. The safety cap is **not** a recall bottleneck.

---

## Restoration gates

| Gate | Result |
|------|--------|
| 38 BASE_ABSENT raw domain hit | **38 / 38** |
| 38 final introduced | **38 / 38** |
| Raw→Final retention | **1.0** |
| Base regression (`domain_none` / empty weights / Model2-disabled) | **PASS** |
| Soft prior / hard filter (base_ids unchanged) | **PASS** / Hard Filter **NO** |
| Multi-tag any selected slot recalls | **50 / 50** term_ids (unique identities in index = 44; actual maximum under identity contract) |
| Single retrieval path | **YES** |
| Shadow / fallback / Node SQL dual path | **NO** |
| Architecture (new model/service/gate/pipeline) | **PASS** |

CURRENT funnel (frozen yield audit): `38 → 13 → 4`  
RESTORED funnel: `38 → 38 raw → union/dedup → 38 final`

Zero-coverage recheck (exact span): `tech_ai` / `meeting` / `medical` remain **100% BASE_VISIBLE** — no new D opportunity on exact spans, as expected for `meeting`. Relation-corrupted `sh_s` 9/9 and `eng_en` 1/1 recover; `h_f` had 0 BASE_ABSENT in the 400-term sample.

---

## What this round did not do

- No Stage D / Stage J / J2 training  
- No checkpoint swap  
- No V2 benchmark mutation  
- No budget-head enablement  
- No expansion of the final candidate cap  

Next round (after user confirmation): **controlled restored Stage D / Stage J retraining**.

Recommended initialization: **P1_PLUS_FRESH_DOMAIN_HEAD** (J1 argmax ∈ new teacher set = 0.225 on n=80 restored sample). Optional controlled A/B vs J1 fine-tune remains available if desired.
