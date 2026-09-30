# Lingua1 — Pre-DomainVote Domain Evidence Gating Code Audit V1

```text
PHASE = LINGUA_PRE_DOMAINVOTE_DOMAIN_EVIDENCE_GATING_CODE_AUDIT_V1
MODE  = READ_ONLY_AUDIT · CODE_FROZEN · SSOT_TRACE · NO_PRODUCT_CHANGE
```

## 0. Practical question

> Can Lingua reduce path-space pressure by cheaply rejecting domain-unsupported hypotheses using **in-memory** domain evidence **before** 8/8 structural caps, without moving Domain Vote or adding a complex subsystem?

**Answer: NO — not as a justified fix for the known Pre-DomainVote losses.**

```text
Production: candidate domains[] exist on LexicalEdge before active/complete prune.
Authority: formal Domain Vote/SameDomain must not prune paths (H1);
           path prune SSOT is structural-only → domain eligibility not authorized without ACP.
Business predicate "reasonable / unreasonable domain": NOT_FOUND.
Diagnostic on 7 target-loss cases (termId domain: proxy): 0/7 competitors are
"no-domain"; all retained rivals already carry domain evidence → hasDomainEvidence
gate would not free slots or preserve targets.
```

```text
MINIMAL_BOUNDARY_PRESERVATION = PAUSED / NOT_AUTHORIZED
PATH_CAP_CHANGE               = NOT_AUTHORIZED_THIS_ROUND
IMPLEMENTATION_AUTHORIZED     = NO
```

---

## 1. DOMAIN_TO_SEGMENTATION_FEEDBACK — original meaning

**Authoritative text (not the recent audit label alone):**

Lattice Architecture V1.0.0 §8 (2026-07-26):

```text
Must not prune using Domain Vote, SameDomain, Assembly, KenLM, LLM, or final fluency.
When a cap fires, prune using only: fallback count, Recall evidence …, boundaryKey tie-break.
```

§9 Forbidden: `Vote mutating boundaries`.

```text
DOMAIN_TO_SEGMENTATION_FEEDBACK_ORIGINAL_MEANING = H1
```

| Interpretation | Verdict |
|----------------|---------|
| **H1** Formal Domain Vote / SameDomain (and listed language scorers) must not feed backward into segmentation | **MATCHES** frozen text |
| **H2** No domain-related evidence whatsoever may participate in pre-Vote path eligibility | **NOT** the named original rule |

**Adjacent (separate) prune authority:** cap-time prune keys are **structural-only**. That means `WindowCandidate.domains[]` is **AVAILABLE_BUT_NOT_CONSUMED** today — not because H2 is written, but because prune SSOT never lists domain tags. Authorizing any domain-metadata path eligibility would amend that prune contract → **ACP required**, not silent implementation.

---

## 2. Candidate domain evidence lifecycle

See `domain_evidence_lifecycle_matrix.csv`.

Summary chain:

```text
term_domain_tags (Lexicon)
  → Hotword.domains[]
  → WindowCandidate.domains[]  (Recall copy; Model2 materialize preserves candidate object)
  → LexicalEdge.candidates[]   (identity merge; domains kept on kept candidates)
  → SegmentationPath.edgeRefs  (shared edge refs; no deep-copy)
  → [structural active/complete prune — domains NOT consumed]
  → PathFineSpan (candidates cloned with domains)
  → voteUtteranceDomainFromPool (source filter + domains → FineSpanDomainSet)
  → retainedDomains → SameDomain → Assembly → KenLM (no domains on KenLM DTO)
```

```text
EARLIEST_DOMAIN_EVIDENCE_AVAILABLE_AT =
WindowCandidate after Lexicon/Recall (pre-LexicalEdge; pre-enumeration)

ACTIVE_PRUNE_RELATIVE_TO_DOMAIN_EVIDENCE   = AFTER
COMPLETE_PRUNE_RELATIVE_TO_DOMAIN_EVIDENCE = AFTER
FORMAL_DOMAIN_VOTE_RELATIVE_TO_PRUNING     = AFTER
```

---

## 3. Exact production fields

| Field | Location | Producer | Consumer | Notes |
|-------|----------|----------|----------|-------|
| `WindowCandidate.domains?: readonly string[]` | `v4-types.ts` | Recall from Hotword / term_domain_tags | Domain Vote via PathFineSpan pools | Full list; never `domains[0]` as SSOT |
| `candidate.source` (`GraphEdgeSource`) | same | Recall (`base_term` / `domain_term` / `passive_domain_weak` / …) | Vote eligibility (`isDomainVoteSource`) | Base does not vote |
| `UtteranceDomainVoteResult.retainedDomains` | `utterance-domain-vote.ts` | Vote | SameDomain / Assembly / Retry scope | Path-local |
| `insufficientEvidence` | Vote | Vote | Assembly base-only path | No votes → true |
| `recallDomainScope` | Orchestrator input | CFG / caller | Recall domainIds | Not path prune |
| Edge-level `domains[]` | **none** | — | — | Only via `edge.candidates[].domains` |

No separate production `domainTags[]` / `domainIds[]` on edges for Vote (scope ids are recall config).

**Cardinality:** one candidate may carry multiple domain strings; multi-domain contributes full tags in Vote (Runtime SSOT).

**Base vs domain (pre-vote distinguishable):** YES via `source` + `domains[]` (and Vote’s `isVoteDomainLabel` excluding `general` / `base_term`).

```text
BASE_DOMAIN_DISTINCTION_AVAILABLE_PRE_VOTE = YES
LEXICALEDGE_DOMAIN_EVIDENCE_AVAILABLE = YES
  access: LexicalEdge.candidates[] → WindowCandidate.domains[] + source
DOMAIN_EVIDENCE_AVAILABLE_BEFORE_ACTIVE_PRUNE = YES
DOMAIN_EVIDENCE_AVAILABLE_BEFORE_COMPLETE_PRUNE = YES
PARTIAL_PATH_CAN_DERIVE_DOMAIN_EVIDENCE = YES   # in-memory only; walk path.edges[].candidates
COMPLETE_PATH_CAN_DERIVE_DOMAIN_EVIDENCE = YES  # edgeRefs same
```

No new DB / model / service required for raw presence aggregation.

Fallback edges: Architecture forbids fallback domain inheritance.

---

## 4. Formal Domain Vote (comparison only)

| Item | Production |
|------|------------|
| Entry | `voteUtteranceDomainFromPool` |
| Unit | PathFineSpan → FineSpanDomainSet presence count |
| Eligible source | `domain_term` \| `passive_domain_weak` only |
| Base | does not vote |
| Multi-domain | full tag union into span set |
| Tie | retain all max |
| Soft retain | count ≥ max × **0.75** |
| Empty | `insufficientEvidence=true`, `retainedDomains=[]`, `utteranceDomain='general'` |
| Ownership | **per SegmentationPath** after retention |

```text
NO_DOMAIN_CURRENT_BEHAVIOR = insufficientEvidence + base-only assembly (Runtime SSOT §12)
BASE_ONLY_CURRENT_BEHAVIOR = same (base sources never contribute domainScores)
DOMAIN_TIE_CURRENT_BEHAVIOR = retain all tied max domains
```

---

## 5. Duplication / complexity

| Approach | Duplicates Vote? | Complexity |
|----------|------------------|------------|
| `hasDomainEvidence(path)` = any vote-eligible candidate with non-empty fine domains on path edges | **NO** | **MINIMAL** |
| Re-run presence counts / 0.75 retention / winner selection before prune | **YES** | HIGH — reject |
| “Reasonable vs unreasonable” without SSOT definition | N/A | **NOT_FEASIBLE** without inventing contract |

```text
PRE_VOTE_GATE_DUPLICATES_DOMAIN_VOTE = NO   # for presence-only eligibility
PRE_VOTE_GATE_COMPLEXITY             = MINIMAL  # presence-only
REASONABLE_DOMAIN_DEFINITION         = NOT_FOUND
```

Without `REASONABLE_DOMAIN_DEFINITION`, the user’s intended “remove unreasonable domain hypotheses” **cannot** be a frozen deterministic rule.

---

## 6. Context evidence (pre-segmentation)

| Signal | Status |
|--------|--------|
| Context Prior | **DIAGNOSTIC_ONLY** (`applied=false`; CONTEXT_PRIOR.md) |
| SoftBoundary / SessionDomainPrior quota | **RETIRED** |
| `recallDomainScope` / profile domain ids | **ACTIVE** for Recall scope — **not** path prune |
| Prior-turn `retainedDomains` | **DOWNSTREAM_ONLY** / not segmentation prune input |
| CPU LLM coarse domain as path controller | **NOT_AVAILABLE_PRE_SEGMENTATION** as frozen owner |

Do not restore SoftBoundary.

---

## 7. Known 7 losses — domain-gate usefulness

Cache note: `_path_budget_edge_cache.json` lacks `domains[]` / `source`; diagnostic used **`termId` `domain:<tag>:…` vs `base-…` proxy** (labeled DIAGNOSTIC_PROXY). Production would use `candidates[].domains` + `source`.

| Result | Value |
|--------|------:|
| Retained competitors with **no** domain proxy at killing prune | **0/7** |
| `hasDomainEvidence` would free slots vs target | **0/7** |
| Domain evidence would preserve target under filter→Top8 | **0/7** |

Typical pattern: target path **and** all 8 retained rivals already show the same utterance domain family (`tourism_route` / `tourism_pickup` / `medical`). Pressure is **structural geometry competition**, not “unsupported-domain paths filling the cap”.

```text
KNOWN_7_LOSS_WITH_UNSUPPORTED_DOMAIN_COMPETITION = 0/7
KNOWN_7_LOSS_DOMAIN_EVIDENCE_STRUCTURALLY_ACTIONABLE = 0/7
```

→ This direction **does not justify** architecture change for the observed Pre-DomainVote target-loss problem.

---

## 8. Complexity gate checklist

| Item | Required? |
|------|-----------|
| NEW_MODEL | NO |
| NEW_SERVICE | NO |
| NEW_DB_QUERY | NO |
| NEW_PIPELINE_STAGE | NO |
| NEW_JOBRESULT_FIELD | NO |
| NEW_DOMAIN_SCORE | NO (presence-only) |
| NEW_THRESHOLD | NO for presence-only; **YES if inventing “reasonable”** |
| NEW_CONFIG | NO for presence-only |
| DUPLICATED_DOMAIN_VOTE | NO for presence-only |
| DOMAIN_TO_SEGMENTATION_FEEDBACK (Vote result → prune) | Must stay **FORBIDDEN** |

Presence-only gate is still **unauthorized** under structural prune SSOT until ACP.

---

## 9. Classification of the proposal

Proposal:

> Before resource path pruning, use existing candidate domain metadata only to eliminate hypotheses with no reasonable domain support, without selecting a winning domain and without moving Domain Vote.

```text
CLASSIFICATION = ARCHITECTURE_GAP_REQUIRING_ACP
```

Reasons:

1. Not an existing frozen duty with missing implementation (**not A**).
2. Dataflow supports raw presence (**not D**).
3. Presence-only need not duplicate Vote (**not E** as stated).
4. Does not match written structural-only prune / would change path eligibility authority → **ACP if pursued**.
5. **Additionally:** `REASONABLE_DOMAIN` undefined + **0/7** diagnostic usefulness → **do not open ACP now**.

```text
DOMAIN_VOTE_MOVE_REQUIRED = NO
DOMAIN_VOTE_CHANGE_REQUIRED = NO
```

---

## 10. Final verdict

```text
AUDIT_VALID = YES

PRODUCT_RUNTIME_CODE_CHANGED = NO
PRODUCTION_CONFIG_CHANGED = NO

DOMAIN_TO_SEGMENTATION_FEEDBACK_ORIGINAL_MEANING = H1

LEXICALEDGE_DOMAIN_EVIDENCE_AVAILABLE = YES

DOMAIN_EVIDENCE_AVAILABLE_BEFORE_ACTIVE_PRUNE = YES
DOMAIN_EVIDENCE_AVAILABLE_BEFORE_COMPLETE_PRUNE = YES

PARTIAL_PATH_CAN_DERIVE_DOMAIN_EVIDENCE = YES
COMPLETE_PATH_CAN_DERIVE_DOMAIN_EVIDENCE = YES

BASE_DOMAIN_DISTINCTION_AVAILABLE_PRE_VOTE = YES

REASONABLE_DOMAIN_DEFINITION = NOT_FOUND

PRE_VOTE_GATE_DUPLICATES_DOMAIN_VOTE = NO
PRE_VOTE_GATE_COMPLEXITY = MINIMAL

KNOWN_7_LOSS_WITH_UNSUPPORTED_DOMAIN_COMPETITION = 0/7

KNOWN_7_LOSS_DOMAIN_EVIDENCE_STRUCTURALLY_ACTIONABLE = 0/7

NEW_MODEL_REQUIRED = NO
NEW_SERVICE_REQUIRED = NO
NEW_DB_QUERY_REQUIRED = NO
NEW_PIPELINE_STAGE_REQUIRED = NO
NEW_JOBRESULT_FIELD_REQUIRED = NO
NEW_DOMAIN_SCORE_REQUIRED = NO
NEW_THRESHOLD_REQUIRED = NO
NEW_CONFIG_REQUIRED = NO

CLASSIFICATION = ARCHITECTURE_GAP_REQUIRING_ACP

DOMAIN_VOTE_MOVE_REQUIRED = NO
DOMAIN_VOTE_CHANGE_REQUIRED = NO

MINIMAL_BOUNDARY_PRESERVATION = PAUSED / NOT_AUTHORIZED

PATH_CAP_CHANGE = NOT_AUTHORIZED_THIS_ROUND

IMPLEMENTATION_AUTHORIZED = NO

ONE_NEXT_OWNER = USER_STRATEGY_DECISION

ONE_NEXT_DELTA =
Abandon Pre-DomainVote domain-evidence gating for known path-pressure losses
(0/7 actionable; REASONABLE_DOMAIN NOT_FOUND); do not draft ACP this round
```

---

## Artifacts

1. `LINGUA_PRE_DOMAINVOTE_DOMAIN_EVIDENCE_GATING_CODE_AUDIT_V1.md` (this file)
2. `domain_evidence_lifecycle_matrix.csv`
3. `known_7_loss_domain_evidence_attribution.csv`
4. `pre_domainvote_domain_gate_audit_manifest.json`

**STOP.**
