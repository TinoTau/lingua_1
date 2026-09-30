# Lingua Model2 V3 — Stage D Restore vs Retrain Decision Audit
# Date: 2026-08-17

**Stage:** `MODEL2_V3_STAGE_D_RESTORE_VS_RETRAIN_DECISION_AUDIT`  
**Mode:** AUDIT ONLY. No retrieval change, no training, no runtime swap.  
**Baseline:** `Lingua_Model2_V3_StageJ_Lexicon_Soft_Prior_Yield_Architecture_Drift_Audit_2026_08_17.md`  
**Artifacts:** `training/model2_v3/experiments/v3_stage_d_restore_vs_retrain_audit/`  
**Production code modified:** 0

Simulations are **AUDIT_SIMULATION_ONLY**. They reuse existing FuzzyPool gates and the Node SQL *contract*; they do not ship a new retrieval engine.

---

## Decision (non-fuzzy)

**NEXT STEP = `RESTORE_THEN_REBUILD_DATA_AND_RETRAIN`**

Not `RESTORE_ONLY`: execute-validated teacher and D opportunity set **materially change**.  
Not `RETRAIN_ONLY`: current executor is the yield bottleneck (4/38 vs 38/38).  
Not `ARCHITECTURE_CHANGE_PROPOSAL_REQUIRED`: original product design (domain-conditioned Lexicon **fuzzy** expansion, soft prior, ONE Model2, union, one budget) can be restored by **replacing the executor body**. Frozen Model2 architecture (RetrievalPolicyV3, Feature Hash V1, action ids) does **not** change.

This is **not** automatic J2. After user confirmation: restore executor → rebuild teacher/eligible D → controlled Stage D/J retrain of the **same** model.

---

## 1. What “restore” would change (not implemented)

Minimal target:

```
domain_soft:{slot}
  → FuzzyPool gates on records with slot ∈ domain_ids
  → UNION unchanged base recall
  → one downstream cap (soft score; no hard-filter of base)
```

| | Current | Restored intended |
|--|---------|-------------------|
| Query universe | mixed phonetic index | domain-tagged subset + base |
| Primitive | `build_fuzzy_pool` k=32 **same syllables as base** | same **gates**, filtered by tag |
| Rank / budget | rerank → top-8 | union → **one** cap |
| Action id | `domain_soft:coffee` | **same id** |

**Same action intent, different executor.** Action space compatibility: **FULL**. IDs are domain slots (`domain_actions.py` L28–31; `domain_action_head` Linear to `N_DOMAIN_ACTIONS=13`). They do **not** encode pool32/top8.

Node `queryDomainMultiRowsAtomic` is **not** the restore primitive for Model2 FineSpan: exact `pinyin_key` + `length(word)`, `termLength<2` empty, LIMIT 3. Simulated hit on 38 BASE_ABSENT corrupted spans: **0**.

---

## 2. Teacher semantics

D1+ teacher is **EXECUTE_VALIDATED** against **`execute_domain_action` → current `soft_domain_retrieve`**, and only profile-evidence domains (`recovery_d1.py` L259–268).

That is **not** abstract “which domain is useful.” It is “which slot recovers under pool32/top8.”

On V2 D-only (N=47):

| | |
|--|--:|
| Same teacher action set | 7 |
| Changed | 40 |
| **TEACHER_LABEL_STABILITY_RATE** | **0.1489** |
| Mean Jaccard | 0.561 |

Restored labels are typically a **stricter subset** (true tags only). Current labels include extra slots that recover only because the shared pool is not domain-conditioned (e.g. 带走 current includes `tourism_hotel`; restored keeps bakery/coffee/food_order/milk_tea).

**Teacher rebuild required. Dataset/eligibility rebuild required.** Criterion A and F fire → retrain after restore.

---

## 3. Checkpoint / features / coupling

| Item | Result |
|------|--------|
| J1 outputs | `action_logits`, `query_budget_logits`, `cand_budget_logits`, `domain_action_logits` (`model.py` L218–233) |
| Executor in weights | NO — domain head is slot logits over shared trunk |
| Features encode pool32 rank / top8 | **NONE** |
| Executor-dependent features | **SOME**: `state.base_pool` count only (`encode_state` L152–169). Span hash, domain evidence, applicability are independent. |
| Input feature contract change | **NO** |
| Model budget heads used by D eval | NO (hardcoded). Executor nested 32/8 **does** change; heads need not be redefined. |
| POLICY_EXECUTOR_COUPLING | **MEDIUM** (ids/features LOW; teacher HIGH) |

J1 probe on V2 eligible (selected under **current** executor — not a production freeze):

| | Rate |
|--|--:|
| Action hit vs current oracle | 0.979 |
| Action hit vs restored oracle | **0.830** |
| Target intro current executor | 0.979 |
| Target intro restored executor same J1 actions | **0.830** |

Hit stays high enough that the **policy still picks useful slots**, but eligibility/teacher distribution after restore is not the V2 45-row slice. **Checkpoint reusable: PARTIAL** (probe only). Production reuse without rebuild/retrain: **NO**.

Same J1 actions: mean new lexical identities 2.45 (current) vs **20.21** (restored union@16). Executor, not action id, was starving expansion.

Counterfactual probe (45 groups): EMPTY intro **20/45** both executors — empty-profile overbias is **selection**, still present after restore. Retrain must keep empty → `domain_none` supervision. Wrong/Swapped intro drops (32→23, 27→20): restored executor is **less** leaky to wrong slots. That is expected and good.

---

## 4. Oracle funnel (same 38 BASE_ABSENT)

| Stage | Current | Node SQL exact | Domain-filtered fuzzy UNION |
|-------|--------:|---------------:|----------------------------:|
| BASE_ABSENT | 38 | 38 | 38 |
| Raw recoverable | 38 (shared phonetic) | **0** | **38** |
| After nested pool32/top8 | **4** | — | — |
| After union + budget16 | — | 0 | **38** |
| After union + budget8 | — | 0 | **38** |

Yield improvement: **4 → 38** (+34, +89.5 pp on this slice). Drift was suppressing function. Base recall is **not** weakened.

True D opportunity among these 38: current final 10.5%; restored final **100%** of BASE_ABSENT (oracle domain). Exact FineSpan population remains 0 BASE_ABSENT — restoration does not manufacture D from already-visible identities.

---

## 5. Primary decision table

| Question | Result |
|---|---|
| Action ids unchanged? | **YES** |
| Teacher labels stable? | **NO** (7/47, rate 0.149) |
| Input features stable? | **YES** (SOME `base_pool` count) |
| Budget semantics stable? | Model heads YES; executor nested 32/8 **NO** |
| J1 actions still useful? | **YES** (restored hit 0.83 on old eligible slice) |
| Restored executor improves yield? | **YES** 4→38; Node SQL 0 |
| New dataset distribution changes? | **YES** |
| Retraining required? | **YES** (after restore + teacher rebuild) |

Criteria: A yes, B no (ids), C no, D no (heads), E no (hit does not collapse), F yes.

---

## 6. Complexity / governance

**RESTORATION_COMPLEXITY: LOW**

new services/heads/config/tables/gates/budgets/fallbacks/candidate types = **0**.

Allowed later: one executor-body replace + teacher/eval adapter.

Old `soft_domain_retrieve` **must not** remain an active fallback (shadow / double recall). Node exact SQL **must not** be dual-wired as Model2 D.

Architecture Change Proposal for frozen Model2 **NO**. Previous yield-audit “proposal required” meant “do not silently rewrite product semantics this round.” This round’s evidence says: restore the **original** expansion executor; do not invent a new model.

---

## 7. Conformance of restored candidate design

FineSpan / UserProfile / ONE Model2 / trainable policy / soft prior / Lexicon SSOT / unchanged base / no hard filter / no whole utterance / no second model / single merge / single downstream budget: **YES** if domain-filtered fuzzy UNION is used.

Domain-conditioned expansion: **YES** only under that executor. Current rerank: NO. Node exact-only: NO.

---

Stage D Restore vs Retrain Audit:
PASS


Original Design Drift:
CONFIRMED


Current Executor:
shared phonetic FuzzyPool k=32 → domain rerank → top-8
(training/model2_v3/policy/domain_actions.py soft_domain_retrieve)


Intended Executor:
domain-conditioned FuzzyPool (existing pool.py gates + domain_ids) UNION base → one cap
AUDIT_SIMULATION_ONLY this round


Restoration Complexity:
LOW


====================
CONTRACT
====================

Action Space Compatibility:
FULL


Action IDs Change Required:
NO


Teacher Label Stability:
0.1489 (7/47 identical sets; Jaccard 0.561)


Teacher Labels Materially Change:
YES


Executor-Dependent Input Features:
SOME


Input Feature Contract Changes:
NO


Budget Semantics Change:
YES at executor nested 32/8; NO at model budget heads (unused for D)


Policy / Executor Coupling:
MEDIUM


====================
RESTORATION EFFECT
====================

Current Base-Absent N:
38


Current Raw Recoverable:
38 (shared phonetic scored-set)


Current Final Introduced:
4


Restored Raw Recoverable:
38 (domain-filtered fuzzy) / 0 (Node exact SQL)


Restored Final Introduced:
38 (union budget 16 or 8) / 0 (Node SQL)


Current D Opportunity Rate:
4/38 = 0.1053 final among BASE_ABSENT


Restored D Opportunity Rate:
38/38 = 1.0 final among BASE_ABSENT (oracle domain)


Yield Improvement:
+34 introductions (+0.8947)


====================
CHECKPOINT
====================

Current J1 Action Hit Under Restored Contract:
0.830 (V2 D eligible probe N=47)


Current J1 Target Intro Under Restored Executor:
0.830 (same slice; current executor intro 0.979 because slice was selected on it)


Current J1 Checkpoint Reusable:
PARTIAL


====================
TRAINING
====================

Retraining Required:
YES


Why:
Execute-validated teacher and eligible D distribution are defined by the current executor. Restored domain-conditioned UNION changes which slots recover and which FineSpans are D-eligible. Model still learns “which domain slot to fire,” but labels/opportunity are not the old pool32/top8 game.


Dataset Rebuild Required:
YES


Teacher Rebuild Required:
YES


Stage D Retrain Required:
YES (same RetrievalPolicyV3 domain head; no new model)


Stage J Retrain Required:
YES (J1 is the joint checkpoint; P head stays same architecture. Not automatic J2.)


====================
RUNTIME
====================

Node Existing Domain Query Reusable:
NO as Model2 D expansion SSOT (exact pinyin; 0/38). Keep only as exact lookup, not dual-wired.


Python Current Executor Should Remain Authoritative:
NO


Shadow Path Risk:
YES if old rerank is kept as fallback or Node SQL is also wired


Old soft_domain_retrieve Should Be:
RETIRE (replace body; do not KEEP fallback; DELETE old rerank semantics)


Single Authoritative Retrieval Path Possible:
YES


====================
GOVERNANCE
====================

New Model Required:
NO


New Service Required:
NO


New Gate Required:
NO


New Rule Layer Required:
NO


New Candidate Type Required:
NO


Architecture Change Proposal Required:
NO


====================
DECISION
====================

Recommended Next Step:

RESTORE_THEN_REBUILD_DATA_AND_RETRAIN


Reason:
J1 learns domain **slot** ids (compatible) but was trained on execute-validated recoveries of the **wrong executor**. Restoring domain-conditioned FuzzyPool UNION recovers 38/38 BASE_ABSENT vs 4/38 today. Teacher stability 15%. Rebuild teacher/eligible D under the restored executor, then retrain the same RetrievalPolicyV3. Do not retrain first. Do not restore-only and ship J1. Do not train J2 automatically. Wait for user confirmation before any retrieval edit.
