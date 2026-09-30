# Lingua1 — Context / Domain Guided Path-Space Control SSOT Authority Audit V1

PHASE = `LINGUA_CONTEXT_DOMAIN_GUIDED_PATH_SPACE_CONTROL_SSOT_AUDIT_V1`  
MODE = READ_ONLY · CODE_FROZEN · HISTORICAL_AUTHORITY_RECONSTRUCTION · NO_PRODUCT_CHANGE

## 0. Question answered

In frozen Lingua architecture, who owns “context/domain-guided search-space control”, at which stage, with what evidence — and does current production still implement that responsibility? Especially: does the 8/8 structural path prune delete legitimate hypotheses **before** Domain Vote can act?

**Short answer:** Path-space width is frozen as **resource-only structural caps** (PROBE 8/8), which **must not** use Domain Vote / SameDomain / KenLM. Path-level **Domain Vote + SameDomain** own domain-bucket pruning **after** segmentation. No authoritative frozen contract was found for domain/context **controlling or expanding SegmentationPath budget**. SoftBoundary “context guides where to search” applied to FineSpan/Recall **quota** and is **RETIRED**. Current 8/8 therefore **preempts** Domain Vote visibility of pruned paths as a **PROBE side-effect**, not as Domain Vote drift.

---

## 1. Answers to Q1–Q5

### Q1 — When do context / coarse domain / candidate tags / Domain Vote / SameDomain enter?

| Signal | First stage (current frozen chain) |
|--------|--------------------------------------|
| Context Prior | Diagnostics only (`applied=false`) — **never** a decision input |
| Coarse / profile domain hints | May inform Model2 retrieval / profile; **not** path prune |
| Candidate `domains[]` | Lexicon recall → WindowCandidate (pre-LexicalEdge) |
| Path domain hypothesis | **Domain Vote** (per retained SegmentationPath) |
| SameDomain buckets | **After** Vote, per `retainedDomains` |

### Q2 — “Shrink by domain/context, then expand if insufficient”?

| Layer | Found? | Authority |
|-------|--------|-----------|
| FineSpan/Recall option quota via SessionDomainPrior | Historically YES | SoftBoundary plan **2026-07-22** — **RETIRED** |
| Segmentation path width via domain/context | **NO** | `HISTORICAL_CONTEXT_GUIDED_EXPANSION_AUTHORITY = NOT_FOUND` |
| No-domain handling | YES | Runtime SSOT: no votes → **base-only / insufficientEvidence** (assembly fallback, **not** path widen) |

Do **not** invent a frozen path-space expansion SSOT from the user brief.

### Q3 — Fixed numeric limits: original purpose

| Budget | Purpose (authority) | Status |
|--------|---------------------|--------|
| `maxActivePathsPerPosition` / `maxCompleteSegmentationPaths` | **RESOURCE_SAFETY_CAP** for Bounded Complete Path Enumeration; prune order structural only | **PROBE / NOT FINAL** since 2026-07-26 |
| Global sentence candidates ≤16 | **ASSEMBLED_SENTENCE_BUDGET** / candidate governance | **FROZEN** |
| Model2 / exactTopK | **CANDIDATE_BUDGET** | Separate contracts |
| Structural comparator | Resource prune ordering when caps fire — **not** language beam | **FROZEN** |

Lattice Architecture:

```text
路径限宽 = 资源保护，≠ 语言决策
Must not prune using Domain Vote, SameDomain, Assembly, KenLM, LLM, or final fluency
```

No ACP found converting 8/8 PROBE → FINAL.

### Q4 — Does implementation do: structural cap → drop path → Domain Vote not yet run?

**YES.**

Classification: **B. 原设计允许，但 PROBE cap 后来变成事实上的 business selector** (also readable as PROBE side-effect of unfinished values).

- Lattice **explicitly** places Vote after paths and forbids domain prune of paths → structural-first is **intentional**.
- Unfinished PROBE 8/8 + sensitivity (7/17 evaluable lost pre-Vote; G2 0/4) → caps act as **PARTIAL** business ranker → **ACCIDENTAL_BY_PROBE_CAP**, not Domain Vote bug.

### Q5 — “No reasonable domain bucket → expand options” owner?

| Candidate | Verdict |
|-----------|---------|
| Domain Vote no-domain → base-only | **Owner of no-domain handling** — does **not** expand path/candidate search space |
| SoftBoundary other-domain quota | **RETIRED** |
| Path cap widen on low domain confidence | **NOT_FOUND** |
| Model2 / Recall expansion | Retrieval expansion; **not** path-budget expand |
| SameDomain | Filters membership; no path reopen |

```text
NO_VALID_DOMAIN_BUCKET_EXPANSION_OWNER = Runtime_SSOT retainedDomains base-only / insufficientEvidence
EXPANSION_TRIGGER = NO_DOMAIN (assembly-level, NOT path-space)
```

```text
UNREASONABLE_DOMAIN_BUCKET_PRUNING_OWNER = Domain Vote retainedDomains + SameDomain bucket filter
LAYER = DOMAIN_VOTE / AFTER_DOMAIN_VOTE (SAMEDOMAIN)
```

---

## 2. Architecture classification

**ORIGINAL_CONTEXT_DOMAIN_CONTROL_STATUS = C**

`ORIGINAL_CONTEXT_DOMAIN_CONTROL_EXISTS_BUT_CURRENT_PATH_CAP_PREEMPTS_IT`

- Domain control (**path-scoped Vote + SameDomain**) still exists and conforms.
- PROBE path caps delete hypotheses **before** Vote sees them.
- Separate finding: path-space **context-guided expansion** authority = **NOT_FOUND** (do not treat SoftBoundary as current path owner).

Also:

| Flag | Value |
|------|-------|
| IMPLEMENTATION_DEFECT_FOUND | **NO** (prune matches Lattice §8) |
| IMPLEMENTATION_DRIFT_FOUND | **NO** for Vote timing / forbid feedback; **MINOR** parentEdgeCount contract text drift (out of scope) |
| ARCHITECTURE_GAP_FOUND | **YES** — PROBE values unfinished; resource≠language principle vs PARTIAL business-ranker side-effect; no path-space domain-control contract if product wants one |
| ARCHITECTURE_CONFLICT_FOUND | **NO** (Lattice > SoftBoundary; SoftBoundary RETIRED) |

---

## 3. Dataflow highlight (segmentation prune moment)

At structural pruning, the system **already has**:

- Candidate `domains[]` on LexicalEdge candidates (**AVAILABLE_BUT_NOT_CONSUMED**)

It does **not** have:

- Path-level Domain Vote / retainedDomains
- Context Prior as a decision signal

SSOT **requires non-consumption** of Domain Vote for path prune (FORBIDDEN feedback). Tags available ≠ authorization to prune by domain.

---

## 4. Three layers (must not conflate)

| Layer | Controller | Domain/context role |
|-------|------------|---------------------|
| A Candidate Space | Recall / Model2 / compatibility / ≤16 sentence cap | tags on candidates; Context Prior off |
| B Path Space | Enum + structural PROBE caps | **No** domain/context in prune |
| C Domain Hypothesis Space | Per-path Vote + SameDomain | **Primary** unreasonable-bucket prune |

`DOMAIN_TO_SEGMENTATION_FEEDBACK = FORBIDDEN`

`CANDIDATE_CAP_AND_PATH_CAP_ARE_SAME_CONTRACT = NO`

---

## 5. Pre-DomainVote losses (from prior budget audit; not re-swept)

```text
PRE_DOMAINVOTE_TARGET_LOSS_COUNT = 7/17
PRE_DOMAINVOTE_LOSS_PRIMARY_CLASSIFICATION = PROBE_BUDGET_SIDE_EFFECT
```

Secondary labels allowed: `EXPECTED_RESOURCE_SAFETY_LOSS` (when caps fire under Lattice), `ARCHITECTURE_GAP` (PROBE not finalized / resource≠language tension).  
Not: Domain Vote implementation defect; not authorized BUSINESS_POLICY_VIOLATION of Vote formula.

---

## 6. Path budget finalization readiness

```text
PATH_BUDGET_FINALIZATION_READY = NO
```

Reason: until Architecture Decision chooses either (1) finalize numeric caps **strictly as resource ceilings** under existing Lattice, or (2) open a **new** ACP if product wants context/domain-guided **path-space** control — freezing 12/16/24 now would conflate measurement with unresolved ownership.

```text
PATH_CAP_CHANGE_REQUIRED = NOT_DECIDED
DOMAIN_VOTE_MOVE_REQUIRED = NOT_PROVEN
```

Moving Domain Vote before segmentation is **not** approved by any frozen SSOT (would conflict with Architecture §8 / main chain).

---

## 7. POSSIBLE_FUTURE_OPTIONS (non-authorizing)

Listed only as inventory — **not** development recommendations:

- Finalize PROBE caps as resource ceilings using sensitivity data
- ACP for context/domain-guided path-space control (would need explicit feedback contract)
- Observability: expose full latticeTrace prune lists

**Forbidden this round:** implementing any of the above; moving Vote; changing comparator/caps/Model2–3/QEV/Retry.

---

## 8. Replacement length invariant

```text
REPAIR_REPLACEMENT_LENGTH_INVARIANT_STATUS = DEFERRED / OUT_OF_SCOPE
```

---

## 9. Final verdict

```text
AUDIT_VALID = YES

PRODUCT_RUNTIME_CODE_CHANGED = NO
PRODUCTION_CONFIG_CHANGED = NO
ARCHITECTURE_CHANGED = NO

HISTORICAL_AUTHORITY_RECONSTRUCTED = YES

ORIGINAL_BUSINESS_INTENT_FOUND = YES

CONTEXT_GUIDED_SEARCH_SPACE_CONTROL_FOUND = NO
DOMAIN_GUIDED_SEARCH_SPACE_CONTROL_FOUND = YES

UNREASONABLE_DOMAIN_BUCKET_PRUNING_OWNER = Domain_Vote_retainedDomains + SameDomain_bucket_filter
NO_VALID_DOMAIN_BUCKET_EXPANSION_OWNER = Runtime_SSOT_base_only_insufficientEvidence

CONTEXT_FIRST_AVAILABLE_STAGE = diagnostics_only_Context_Prior
COARSE_DOMAIN_FIRST_AVAILABLE_STAGE = Model2_retrieval_profile_hints
CANDIDATE_DOMAIN_TAG_FIRST_AVAILABLE_STAGE = Base_Exact_Recall_WindowCandidate
PATH_DOMAIN_HYPOTHESIS_FIRST_AVAILABLE_STAGE = Domain_Vote_per_SegmentationPath

SEGMENTATION_PRUNING_HAS_CONTEXT = NO
SEGMENTATION_PRUNING_HAS_DOMAIN_EVIDENCE = AVAILABLE_BUT_NOT_CONSUMED
SEGMENTATION_PRUNING_USES_CONTEXT = NO
SEGMENTATION_PRUNING_USES_DOMAIN_EVIDENCE = NO

DOMAIN_TO_SEGMENTATION_FEEDBACK = FORBIDDEN

CURRENT_8_8_CAP_AUTHORITY = PROBE / NOT_FINAL

CURRENT_SEGMENTATION_IS_ACTING_AS_BUSINESS_RANKER = PARTIAL

BUSINESS_RANKER_STATUS = ACCIDENTAL_BY_PROBE_CAP

PRE_DOMAINVOTE_TARGET_LOSS_COUNT = 7/17

PRE_DOMAINVOTE_LOSS_PRIMARY_CLASSIFICATION = PROBE_BUDGET_SIDE_EFFECT

ORIGINAL_CONTEXT_DOMAIN_CONTROL_STATUS = C

IMPLEMENTATION_DEFECT_FOUND = NO
IMPLEMENTATION_DRIFT_FOUND = NO
ARCHITECTURE_GAP_FOUND = YES
ARCHITECTURE_CONFLICT_FOUND = NO

PATH_CAP_CHANGE_REQUIRED = NOT_DECIDED
PATH_BUDGET_FINALIZATION_READY = NO

DOMAIN_VOTE_MOVE_REQUIRED = NOT_PROVEN
SAMEDOMAIN_CHANGE_REQUIRED = NOT_PROVEN
SEGMENTATION_CHANGE_REQUIRED = NOT_PROVEN

MODEL2_CHANGE_REQUIRED = NO
MODEL3_CHANGE_REQUIRED = NO
QUERY_EVIDENCE_CHANGE_REQUIRED = NO
RETRY_REGION_CHANGE_REQUIRED = NO
KENLM_CHANGE_REQUIRED = NO

REPAIR_REPLACEMENT_LENGTH_INVARIANT_STATUS = DEFERRED / OUT_OF_SCOPE

ACP_REQUIRED = YES
ACP_SCOPE = CONTEXT_DOMAIN_GUIDED_PATH_SPACE_CONTROL_OR_PATH_BUDGET_FINALIZATION_DECISION

ONE_NEXT_OWNER = Architecture Decision (path-budget finalization vs new path-space domain/context contract)
ONE_NEXT_DELTA = Draft Architecture Decision only — choose resource-only PROBE finalization under Lattice §8 OR open ACP for path-space domain/context control; do not move Domain Vote or change 8/8 in code yet
```

---

## Artifacts

1. `LINGUA_CONTEXT_DOMAIN_GUIDED_PATH_SPACE_CONTROL_SSOT_AUDIT_V1.md` (this file)  
2. `context_domain_authority_timeline.csv`  
3. `context_domain_pipeline_dataflow.csv`  
4. `candidate_path_domain_ownership_matrix.csv`  
5. `historical_vs_current_contract_matrix.csv`  
6. `context_domain_audit_manifest.json`
