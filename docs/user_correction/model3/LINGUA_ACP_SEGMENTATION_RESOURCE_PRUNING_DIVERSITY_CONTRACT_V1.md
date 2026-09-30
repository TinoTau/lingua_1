# Lingua1 — ACP Draft V1  
## Segmentation Resource Pruning Diversity Contract

```text
ACP_ID     = LINGUA-ACP-SEGMENTATION-RESOURCE-PRUNING-DIVERSITY-CONTRACT-V1
PHASE      = LINGUA_ACP_SEGMENTATION_RESOURCE_PRUNING_DIVERSITY_CONTRACT_V1
ACP_STATUS = DRAFT / USER_APPROVAL_REQUIRED
MODE       = ARCHITECTURE_DECISION_DRAFT_ONLY
             NO_PRODUCT_CHANGE · NO_CONFIG_CHANGE · NO_IMPLEMENTATION
```

---

## 0. Authority inputs (frozen; not reopened)

1. `LINGUA_SEGMENTATION_PATH_BUDGET_SENSITIVITY_AUDIT_V1`
2. `LINGUA_CONTEXT_DOMAIN_GUIDED_PATH_SPACE_CONTROL_SSOT_AUDIT_V1`
3. `LINGUA_SEGMENTATION_HYPOTHESIS_DIVERSITY_RESOURCE_PRESERVATION_CONTRACT_AUDIT_V1`

```text
ROOT_CAUSE                 = SEGMENTATION_RESOURCE_PRUNING_CONTRACT_GAP
IMPLEMENTATION_DEFECT_FOUND = NO
IMPLEMENTATION_DRIFT_FOUND  = NO
ARCHITECTURE_GAP_FOUND      = YES
```

Lattice Architecture V1.0.0 (2026-07-26) already freezes:

- Uncapped: **every legal complete boundaryKey MUST be retained**
- Capped: structural comparator only (`STRUCTURAL_TOPN_ONLY`)
- Path width = **resource protection ≠ language decision**
- `DOMAIN_TO_SEGMENTATION_FEEDBACK = FORBIDDEN`
- Caps `8/8` = **PROBE / NOT_FINAL**

Missing under cap:

```text
HISTORICAL_DIVERSITY_DEFINITION     = NOT_FOUND
REPRESENTATIVE_PATH_REQUIREMENT     = NOT_FOUND
CAP_TIME_AMBIGUITY_PRESERVATION     = NOT_DEFINED
```

---

## 1. Problem this ACP solves (exactly one)

When legal `SegmentationPath` count exceeds resource allowance and lossy pruning is mandatory:

> **What information must still be retained?**

So that:

```text
RESOURCE PRUNING  ≠  LANGUAGE / BUSINESS WINNER SELECTION
```

while remaining compatible with low-resource hard ceilings.

Runtime evidence (diagnostic only; **not** GT production rules):

```text
CURRENT_ACTIVE_PATH_CAP / COMPLETE_PATH_CAP = 8 / 8 (PROBE)
PRE_DOMAINVOTE_TARGET_LOSS                  = 7/17
ACTIVE_CAP_LOSS                             = 5/7
COMPLETE_CAP_LOSS                           = 2/7
ACTIVE_CAP_DIVERSITY_COLLAPSE               = YES
COMPLETE_CAP_DIVERSITY_COLLAPSE             = YES
G2_DIVERSITY_COLLAPSE                       = 4/4
```

Observed pattern: retained Top-8 often still has **8 distinct full `boundaryKey`s**, while **target local geometry classes** (e.g. multi-char edge vs fine partition) are absent — structural-score-similar fine partitions fill the ceiling.

---

## 2. Proposed business principle (for user freeze)

```text
SEGMENTATION_RESOURCE_PRUNING_PRINCIPLE:

When resources are sufficient:
    retain every legal complete segmentation hypothesis.

When resource limits are exceeded:
    loss is allowed.

However:
    pruning MUST preserve representative lexical /
    segmentation ambiguity before pure quantity truncation.

Resource pruning MUST NOT silently collapse
the hypothesis space into only the structurally preferred
family before downstream Domain Vote / Assembly can evaluate it.

Numeric caps remain resource safety ceilings,
not language-decision rules.
```

**This ACP asks whether the principle above should be frozen.**  
No algorithm, no 8/8 change, no comparator rewrite in this draft.

---

## 3. Diversity business object

```text
DIVERSITY_BUSINESS_OBJECT =
SEGMENTATION / LEXICAL BOUNDARY AMBIGUITY
```

**Reasons (architecture, not Pilot accuracy):**

1. Multi-path Lattice replaced LTR “unique FormalFineSpan / unique boundary before Domain Vote” specifically to keep **lexical / boundary alternatives** (P1).
2. Path-level independent Domain Vote (P3) is a **downstream consequence of retained paths**, not a segmentation pruning class.
3. `DOMAIN_TO_SEGMENTATION_FEEDBACK = FORBIDDEN` — domain diversity must not become the preservation unit.
4. Candidate multi-membership / semantic / Model3 / KenLM correctness are other owners.

```text
DIVERSITY_BUSINESS_OBJECT_DECISION_REQUIRED = NO
```

(Object is decidable from frozen SSOT; **class definition** still needs user choice among options below.)

---

## 4. Non-goals / hard forbids

```text
DOMAIN_TO_SEGMENTATION_FEEDBACK = FORBIDDEN
DOMAIN_VOTE_MOVE                = NO
CANDIDATE_BUDGET_CHANGE         = NO
MODEL2 / MODEL3 / QEV / Retry / SameDomain / KenLM change = NO
```

Forbidden mechanisms: domain quota, domain score in path comparator, KenLM/LLM/semantic early scoring, GT-driven classes, raising 8/8 in this ACP, changing structural comparator keys, replacement-length invariant work.

```text
CANDIDATE_CAP_AND_PATH_CAP_ARE_SAME_CONTRACT = NO
REPAIR_REPLACEMENT_LENGTH_INVARIANT_STATUS   = DEFERRED / OUT_OF_SCOPE
```

---

## 5. Two-tier resource protection (logical contract only)

```text
legal hypotheses
      ↓
preserve ambiguity representation
      ↓
structural ranking inside available representation
      ↓
hard resource ceiling
      ↓
Domain Vote → … → Assembly → KenLM
```

Not a loop/queue/data-structure design. Ownership stays:

| Stage | Duty |
|-------|------|
| Segmentation | bounded ambiguity preservation |
| Domain Vote | domain hypothesis |
| Model3 | non-anchor repair trigger |
| Assembly | sentence construction |
| KenLM | sentence scoring |

Segmentation must **not** decide final linguistic correctness.

---

## 6. Structural comparator role (proposed)

Current order **unchanged** by this ACP:

```text
fallbackEdgeCount ASC
fuzzyEdgeCount ASC
toneRelaxedEdgeCount ASC
exactEdgeCount DESC
lexicalEdgeCount DESC
boundaryKey ASC
```

Proposed future role:

```text
STRUCTURAL_COMPARATOR_ROLE =
WITHIN_REPRESENTATION_SELECTION
```

Meaning: comparator ranks **within** representation constraints and among survivors competing for hard-ceiling slots — **not** as silent global business winner selector that may erase entire ambiguity families.

```text
NUMERIC_PATH_CAP_ROLE = RESOURCE_SAFETY_CEILING
```

---

## 7. When representation itself exceeds hard cap

```text
REPRESENTATION_EXCEEDS_HARD_CAP_POLICY =

Representation preservation is itself allowed to be lossy
when the count of required representative classes exceeds
the hard resource safety ceiling.

Degradation MUST remain:
  (1) deterministic
  (2) domain-/GT-/language-score-free
  (3) applied only after representation classes are formed
  (4) using structural comparator (or a later-approved
      representation-class priority that is still non-linguistic)

No infinite path retention. No pretend unlimited resources.
```

Concrete class-priority algorithm = **out of scope**; deferred to post-approval implementation design audit.

---

## 8. Representative hypothesis class — options

### Option A — Exact `boundaryKey` class

- **Unit:** each complete ordered edge-range string is one class.
- **Fit:** matches uncapped “every legal boundaryKey” identity.
- **Weakness vs evidence:** 8/8 losses often already retain **8 distinct** `boundaryKey`s; exact-key classes do **not** stop structurally preferred *families* of fine partitions from crowding out coarser local alternatives.
- **Verdict:** insufficient alone for observed collapse.

### Option B — Local ambiguity choice class *(recommended)*

- **Unit:** at each local ambiguity locus, competing lexical-boundary alternatives form distinct classes  
  (concept: `[9:10]|[10:11]` vs `[9:11]` — not full-sentence key equality).
- **Fit:** directly encodes P1 “segmentation / lexical boundary ambiguity”; works for **active** partial paths (before complete keys exist) and **complete** paths.
- **No domain / GT / language score.**
- **Boundable:** representation may be lossy under hard ceiling (§7).
- **Risk:** locus definition must be lattice-native (edge adjacency / span alternatives), not Pilot-derived; over-fine loci can inflate class count.

### Option C — Covered LexicalEdge representation

- **Unit:** a multi-character (or otherwise “non-trivial”) `LexicalEdge` that participates in ≥1 legal path should, when possible, have ≥1 retained hypothesis containing it.
- **Fit:** matches G2 pattern where a specific longer edge disappears while fine partitions survive.
- **Risk:** “every LexicalEdge MUST survive” is **explicitly not approved** — would explode; only a **bounded representative** reading is admissible.
- **Active path:** natural (outgoing edge from position); **Complete:** path’s edge set coverage.

### Option D — Minimal hybrid (architecture-level, not code)

- Active: local outgoing-edge alternatives (B-lite).  
- Complete: bounded covered multi-char edge representation (C-lite), then structural within class.  
- Higher coupling / complexity; only if user rejects pure B or pure C.

See `representative_hypothesis_option_matrix.csv`.

---

## 9. Architecture options (≤3) for user decision

### Arch-Option 1 — Local Ambiguity Representation (based on Option B)

| Field | Content |
|-------|---------|
| principle | Cap-time prune preserves local lexical-boundary alternatives before quantity truncation |
| preservation unit | Local ambiguity choice class |
| active-path behavior | At each position prune, keep representatives of distinct local next-span / competing boundary choices before pure structural Top-N |
| complete-path behavior | Keep representatives of distinct local ambiguity resolutions across the path; then structural rank inside/among classes |
| structural comparator role | `WITHIN_REPRESENTATION_SELECTION` |
| hard-cap behavior | §7 lossy representation under ceiling |
| resource-risk | Medium if loci over-partitioned; boundable |
| complexity | Medium (locus definition + dual active/complete contracts) |
| SSOT compatibility | Highest with P1 multi-path purpose; Domain feedback still forbidden |

### Arch-Option 2 — Bounded Covered LexicalEdge Representation (based on Option C)

| Field | Content |
|-------|---------|
| principle | Cap-time prune preserves presence of recalled non-trivial LexicalEdges in at least one retained hypothesis when possible |
| preservation unit | Covered LexicalEdge (bounded; not “every edge must survive”) |
| active-path behavior | Prefer retaining partial paths that cover distinct outgoing edges under contention |
| complete-path behavior | Prefer retaining completes that cover distinct contended edges; then structural |
| structural comparator role | `WITHIN_REPRESENTATION_SELECTION` |
| hard-cap behavior | §7 |
| resource-risk | Medium–High if edge inventory large without strict bound |
| complexity | Medium-Low (edge-centric; clearer inventory) |
| SSOT compatibility | Strong proxy for P1; slightly less “ambiguity” abstract than B |

### Arch-Option 3 — Status Quo Structural Top-N Only (reject diversity contract)

| Field | Content |
|-------|---------|
| principle | Cap-time loss = authorized structural Top-N; diversity under cap is not required |
| preservation unit | None beyond structural order |
| active / complete | Current `STRUCTURAL_TOPN_ONLY` |
| structural comparator role | `GLOBAL_TOPN` |
| hard-cap behavior | Truncate by comparator only |
| resource-risk | Lowest compute; highest risk of accidental business selection |
| complexity | None |
| SSOT compatibility | Matches **written** prune rule; **contradicts** spirit of “path width ≠ language decision” under tight PROBE caps (prior audits) |

---

## 10. Active vs Complete contracts (draft text)

```text
ACTIVE_PATH_RESOURCE_PRESERVATION_CONTRACT =

When maxActivePathsPerPosition fires on partial paths,
pruning MUST first attempt to retain representatives of
distinct local lexical-boundary alternatives available at
the prune locus (competing LexicalEdge span choices),
so that ambiguity classes are not extinguished before any
complete path in that class can form.

Only after representation constraints are applied
(or when representation itself exceeds the hard ceiling)
may structural comparator truncate to the numeric safety cap.

Does NOT use domain, GT, KenLM, or language scores.
```

```text
COMPLETE_PATH_RESOURCE_PRESERVATION_CONTRACT =

When maxCompleteSegmentationPaths fires,
pruning MUST first attempt to retain representatives of
distinct segmentation / lexical-boundary ambiguity classes
among complete paths (per approved class definition),
so that Domain Vote / Assembly still see multiple
boundary geometries rather than only the structurally
preferred family.

Exact full-path boundaryKey equality alone is NOT sufficient
as the sole preservation unit if many distinct keys remain
inside one structural family while other families vanish.

Structural comparator ranks within / after representation.
Hard ceiling may still force lossy representation (§7).
```

Detail matrix: `active_complete_preservation_contract_matrix.csv`.

---

## 11. Recommendation (not frozen)

```text
ACP_RECOMMENDED_OPTION     = Arch-Option_1_Local_Ambiguity_Representation
RECOMMENDATION_CONFIDENCE  = MEDIUM
ARCHITECTURE_DECISION_REQUIRED = YES
IMPLEMENTATION_AUTHORIZED  = NO
```

**Why recommend Option 1:** best match to frozen multi-path P1; no domain feedback; covers Active (5/7) and Complete (2/7) loss stages; boundable under §7; minimal coupling to Domain Vote / Model2–3.

**Why MEDIUM / decision still required:**

| Trade-off | Option 1 (B) | Option 2 (C) | Option 3 |
|-----------|--------------|--------------|----------|
| Faithfulness to “ambiguity” | Highest | Proxy via edge coverage | None under cap |
| Clarity of inventory | Needs locus def | Edge list clearer | N/A |
| Risk of class explosion | Medium | Medium–High if unbounded | Low |
| Fixes observed “8 distinct keys, lost family” | Yes (by design) | Yes (edge coverage) | No |
| Accidental business selector risk | Lower if approved | Lower if approved | Remains |

User must **Approve / reject / amend** — especially choice of Arch-Option 1 vs 2 vs 3, and whether hybrid D is wanted.

---

## 12. Final ACP output block

```text
ACP_ID =
LINGUA-ACP-SEGMENTATION-RESOURCE-PRUNING-DIVERSITY-CONTRACT-V1

ACP_STATUS =
DRAFT / USER_APPROVAL_REQUIRED

ROOT_CAUSE =
SEGMENTATION_RESOURCE_PRUNING_CONTRACT_GAP

DIVERSITY_BUSINESS_OBJECT =
SEGMENTATION / LEXICAL BOUNDARY AMBIGUITY

REPRESENTATIVE_HYPOTHESIS_CLASS =
DECISION_REQUIRED
  recommended_abstract = LOCAL_AMBIGUITY_CHOICE_CLASS
  alternative_abstract = BOUNDED_COVERED_LEXICAL_EDGE
  rejected_as_sole_unit = EXACT_BOUNDARYKEY_ONLY

ACTIVE_PATH_RESOURCE_PRESERVATION_CONTRACT =
PRESERVE_LOCAL_LEXICAL_BOUNDARY_ALTERNATIVES_BEFORE_STRUCTURAL_TOPN
(subject to hard-ceiling lossy representation)

COMPLETE_PATH_RESOURCE_PRESERVATION_CONTRACT =
PRESERVE_SEGMENTATION_AMBIGUITY_CLASS_REPRESENTATIVES_BEFORE_STRUCTURAL_TOPN
(exact boundaryKey alone insufficient as sole unit;
 subject to hard-ceiling lossy representation)

STRUCTURAL_COMPARATOR_ROLE =
WITHIN_REPRESENTATION_SELECTION

NUMERIC_PATH_CAP_ROLE =
RESOURCE_SAFETY_CEILING

REPRESENTATION_EXCEEDS_HARD_CAP_POLICY =
REPRESENTATION_ITSELF_MAY_BE_LOSSY_UNDER_HARD_CEILING_DETERMINISTIC_NON_LINGUISTIC

DOMAIN_TO_SEGMENTATION_FEEDBACK = FORBIDDEN

DOMAIN_VOTE_MOVE = NO

CANDIDATE_BUDGET_CHANGE = NO

MODEL2_CHANGE = NO
MODEL3_CHANGE = NO
QUERY_EVIDENCE_CHANGE = NO
RETRY_REGION_CHANGE = NO
SAMEDOMAIN_CHANGE = NO
KENLM_CHANGE = NO

ACP_RECOMMENDED_OPTION =
Arch-Option_1_Local_Ambiguity_Representation

RECOMMENDATION_CONFIDENCE = MEDIUM

ARCHITECTURE_DECISION_REQUIRED = YES

IMPLEMENTATION_AUTHORIZED = NO

ONE_NEXT_OWNER =
USER_ARCHITECTURE_DECISION

ONE_NEXT_DELTA =
Approve / reject / amend ACP only
```

---

## Artifacts

1. `LINGUA_ACP_SEGMENTATION_RESOURCE_PRUNING_DIVERSITY_CONTRACT_V1.md` (this file)
2. `representative_hypothesis_option_matrix.csv`
3. `active_complete_preservation_contract_matrix.csv`
4. `acp_manifest.json`

**STOP.** No implementation, no config/cap/comparator change, no Pilot rerun.
