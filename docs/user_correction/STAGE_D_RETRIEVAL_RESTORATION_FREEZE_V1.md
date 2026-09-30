# STAGE_D_RETRIEVAL_RESTORATION_FREEZE_V1

**Freeze id:** `STAGE_D_RETRIEVAL_RESTORATION_FREEZE_V1`  
**Date:** 2026-08-17  
**Stage:** `MODEL2_V3_STAGE_D_STAGE_J_RETRAIN_AND_FREEZE`  
**Nature:** freeze already-restored Stage D retrieval architecture and contracts. Not a new architecture.

Subsequent edits to any frozen item require an **Architecture Change Proposal** or **Contract Change Proposal**. Implicit drift is forbidden.

---

## Status of frozen items

| Item | Status |
|------|--------|
| A. MODEL2 ARCHITECTURE — RetrievalPolicyV3, ONE Model2, ONE checkpoint target | **FROZEN / KEEP** |
| B. FEATURE CONTRACT — MODEL2_FEATURE_HASH_V1 | **FROZEN / KEEP** |
| C. USER PROFILE CONTRACT — StageDProfileContractV1 | **FROZEN / KEEP** |
| D. TARGET IDENTITY — StageDRetrievalTargetIdentityV1 | **FROZEN / KEEP** |
| E. RETRIEVAL CONTRACT — stage_d_domain_conditioned_retrieval_contract_v1 | **FROZEN / KEEP** |
| F. STAGE D EXECUTOR — domain-conditioned fuzzy recall + UNION base + single budget | **FROZEN / KEEP** |
| G. BASE RECALL — unchanged | **FROZEN / KEEP** |
| H. SOFT PRIOR — no hard filtering | **FROZEN / KEEP** |
| I. ACTION SPACE — existing `domain_soft:{slot}` + `domain_none` | **FROZEN / KEEP** |
| J. CANDIDATE PATH — existing candidate type, merge, downstream | **FROZEN / KEEP** |

---

## Architecture

```
FineSpan + UserProfile + retrieval state
  → ONE Trainable Model2 (RetrievalPolicyV3)
  → bounded retrieval primitives
  → LexiconRuntimeV2 → WindowCandidate → merge
  → DomainAwareAssembly → KenLM
```

Authoritative Stage D path (restored original intent):

```
FineSpan
+ Model2-selected domain_soft:{slot}
        ↓
domain-conditioned FuzzyPool
using existing phonetic gates
restricted by domain_ids
        ↓
domain candidate set
        ↓
UNION unchanged base recall
        ↓
StageDRetrievalTargetIdentityV1 dedup
        ↓
ONE per-FineSpan candidate budget
```

- ONE `RetrievalPolicyV3`
- ONE checkpoint target
- Stage P + Restored Stage D share the same trunk
- No P-model + D-model parallelism
- No runtime checkpoint swap in this freeze round

---

## Ownership

| Concern | Owner |
|---------|--------|
| Domain action selection | RetrievalPolicyV3 domain head (`domain_soft:{slot}` / `domain_none`) |
| Domain universe predicate | Lexicon `domain_ids` (term_domain_tags SSOT) |
| Phonetic gates | existing `build_fuzzy_pool` |
| Base recall | existing `base_retrieve_span` (unchanged) |
| Union + single budget | `execute_domain_action` / `max_cands=8` |
| Identity dedup | StageDRetrievalTargetIdentityV1 |
| UserProfile | personal_terms + strengths; domain evidence derived, not SSOT |
| Final business candidate cap | 8 (UNCHANGED) |
| Implementation safety cap | 256 on domain FuzzyPool only (not a business cap) |

Evidence does **not** open a retrieval universe. Model2 must select an action.

---

## Interfaces

Frozen call surfaces:

- `RetrievalPolicyV3.forward` → `action_logits`, budget logits, `domain_action_logits`
- `pack_batch_inputs(..., feature_hash="v1")`
- `execute_domain_action(index, span, action, evidence, base_ids, cfg, max_cands=8)`
- `FuzzyPoolRequestV1.allowed_domain_ids` (`None` = mixed/base; non-empty = tag-restricted; empty = empty universe)
- `base_retrieve_span`
- `target_hit` / `lexical_identity_key`

Not interfaces (retired / not selectable):

- shared phonetic pool → domain rerank → top8
- nested 32→8
- `max(0.35, selected)` evidence floor as executor default
- Node `queryDomainMultiRowsAtomic` as a Model2 D branch
- `build_domain_fuzzy_pool` / DomainFuzzyEngineV2

---

## Feature contracts

- `MODEL2_FEATURE_HASH_V1` (`feature_hash="v1"`)
- Inputs allowed for Stage D: FineSpan features, StageDProfileContractV1, `long_term_domain_evidence`, retrieval state
- Forbidden: target-domain oracle feature, test-only feature, executor-specific old pool32 feature

---

## Retrieval contract

Canonical text: `docs/user_correction/stage_d_domain_conditioned_retrieval_contract_v1.md`  
Contract id: `StageDDomainConditionedRetrievalContractV1`

`domain_none` → no domain expansion. Empty / missing `allowed_domain_ids` → no domain expansion. Soft prior only. No hard domain filter.

---

## Action IDs

Existing catalog only:

- `domain_none`
- `domain_soft:{slot}` for each frozen `DOMAIN_SLOT_IDS`

No new action, gate, router, or rule layer.

Empty profile unnecessary expansion is solved by **training supervision** (`D_NONE_NEGATIVE` → `domain_none`), not by an external `if empty: disable domain` gate.

---

## Budget ownership

- ONE per-FineSpan candidate budget after UNION
- Business cap: `max_cands=8` (UNCHANGED)
- Nested 32→8: REMOVED
- Model budget heads: not the Stage D executor owner
- Implementation safety cap 256: domain FuzzyPool only

---

## Dedup semantics

`StageDRetrievalTargetIdentityV1`:

- Lexical identity key = `(normalized surface, pinyin_key)`
- Provenance = `term_id` + `term_type` + `domain_ids`
- Hit = identity introduced, not provenance-id equality alone

---

## Failure semantics

| Failure | Meaning |
|---------|---------|
| `domain_none` | no domain expansion; base only |
| empty evidence / empty allowed_domain_ids | no domain universe opened |
| identity already in base | not a Stage D introduce |
| identity missing after UNION+budget | retrieval miss (not a new path) |
| executor regression (38 BASE_ABSENT) | REGRESSION_ANCHOR only — not a training target |

---

## Teacher semantics

- Authoritative teacher: **EXECUTE_VALIDATED** against the restored domain-conditioned FuzzyPool
- Flow: base-absent → evidence-valid domain action → execute restored executor → identity introduced
- Old Stage D teacher: **SUPERSEDED** — `NOT_ACTIVE` / `NOT_SELECTABLE` / `NOT_PRODUCTION_AUTHORITY`
- Old teacher must not enter training

---

## Dataset semantics

| Artifact | Role |
|----------|------|
| `STAGE_D_RESTORED_TRAINSET_V1` | D train/val population (term-exclusive). Test labels not for tuning. |
| `STAGE_J_RESTORED_TRAINSET_V1` | Joint train population. |
| `STAGE_J_PRODUCTION_BENCHMARK_V2` | Frozen independent blind set. Never train / hard-mine / edit from model results. |
| `STAGE_J_PRODUCTION_BENCHMARK_V3` | CLEAN holdout frozen **before** model evaluation of V3. |
| 38 BASE_ABSENT cases | `REGRESSION_ANCHOR` only. Not training / weighting / threshold / memorization. |
| 404 D eligible | training population, not a production exam |

Split: term-exclusive train / val / test. Source mix must be reported (REAL / DERIVED_REAL / SYNTHETIC). Aggregate metrics must not hide synthetic dominance.

---

## Retired authoritative semantics

Old path:

```
shared phonetic pool → domain rerank → top8
```

Status: **RETIRED**

- `NOT_ACTIVE`
- `NOT_SELECTABLE`
- `NOT_PRODUCTION_AUTHORITY`
- No fallback, compatibility option, config switch, shadow test path, or legacy runtime alternative

Historical code/artifacts may remain for audit.

---

## Change control

Any modification to frozen architecture, ownership, interfaces, feature/profile/identity/retrieval contracts, action IDs, budget ownership, dedup, failure, teacher, or dataset semantics requires:

1. Architecture Change Proposal, or
2. Contract Change Proposal

before implementation. Silent compatibility flags are forbidden.
