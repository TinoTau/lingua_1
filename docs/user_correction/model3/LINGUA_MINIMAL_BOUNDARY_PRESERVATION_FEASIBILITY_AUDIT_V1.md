# Lingua1 — Minimal Boundary Preservation ACP Simplification & Feasibility Audit V1

```text
PHASE = LINGUA_MINIMAL_BOUNDARY_PRESERVATION_ACP_SIMPLIFICATION_FEASIBILITY_AUDIT_V1
MODE  = READ_ONLY_AUDIT · ACP_SIMPLIFICATION · CODE_FROZEN · NO_IMPLEMENTATION
```

## 0. Question answered

> Can Lingua close the segmentation resource-pruning architecture gap with **only** existing `LexicalEdge` / path geometry, at existing prune sites, via a **small deterministic** boundary-preservation constraint — **without** an AmbiguityClass / Diversity subsystem?

**Short answer:**

```text
MINIMAL_IMPLEMENTATION_FEASIBLE = YES
COMPLEXITY_GATE                 = PASS
ACP_SIMPLIFICATION_RECOMMENDED  = YES
SIMPLIFIED_ACP_NAME             = MINIMAL_LATTICE_BOUNDARY_PRESERVATION
```

Data + control flow already expose path edge geometry. No new business type, config family, service, or pipeline stage is required.

**However:** offline diagnostic replay on the frozen 7 Pre-DomainVote losses shows a *truly tiny* last-edge-only constraint does **not** end-to-end restore most targets under 8/8. A still-local “contested LexicalEdge presence” helper (no new runtime type) structurally restores **2/7**. Hard ceiling still dominates when many contested edges compete for 8 slots.

```text
KNOWN_7_LOSS_STRUCTURALLY_ADDRESSABLE = 2/7
```

This is **not** a production algorithm approval — only structural addressability under diagnostic helpers.

---

## 1. Frozen inputs (not reopened)

```text
ROOT_CAUSE = SEGMENTATION_RESOURCE_PRUNING_CONTRACT_GAP
CURRENT_*_CAP = 8 / 8 · PROBE / NOT_FINAL
PRE_DOMAINVOTE_TARGET_LOSS = 7/17
ACTIVE_CAP_LOSS = 5/7 · COMPLETE_CAP_LOSS = 2/7
IMPLEMENTATION_DEFECT / DRIFT = NO
ARCHITECTURE_GAP_FOUND = YES
```

Prior ACP V1 direction (preserve segmentation ambiguity under cap) is accepted; **complexity** must shrink.

---

## 2. Simplified business principle (recommended ACP contraction)

```text
MINIMAL_BOUNDARY_PRESERVATION_PRINCIPLE:

When resource pruning is not required:
    keep current behavior.

When resource pruning is required:
    avoid eliminating an otherwise legal lattice-native
    lexical boundary alternative solely because global
    structural Top-N is saturated by other boundary choices,
    when that alternative can be preserved within the
    existing hard resource ceiling.

After this minimal preservation constraint:
    use the existing structural comparator.

The numeric path cap remains the final
resource safety ceiling.
```

```text
REPRESENTATIVE_HYPOTHESIS_CLASS = NOT_A_NEW_RUNTIME_BUSINESS_TYPE
PRESERVATION_SIGNAL               = EXISTING_LEXICALEDGE_BOUNDARY_GEOMETRY
STRUCTURAL_COMPARATOR_ROLE        = EXISTING_COMPARATOR_AFTER_MINIMAL_PRESERVATION
NUMERIC_PATH_CAP_ROLE             = RESOURCE_SAFETY_CEILING
HARD_RESOURCE_CEILING_AUTHORITY   = FINAL
```

**Explicitly abandoned for V1:** LocalAmbiguityClass system, AmbiguityDetector/Builder, DiversityManager/Score/Quota/Priority/Merge, taxonomy config, new scoring, domain feedback, new pipeline stage.

---

## 3. Q1 — Edge geometry already on paths?

### Code facts

| Object | Geometry fields | Where |
|--------|-----------------|-------|
| `LexicalEdge` | `syllableStart`, `syllableEnd`, `edgeId` (`start:end`) | `build-lexical-edges.ts` |
| Active partial | `PartialPath.edges: LexicalEdge[]` + prefix `boundaryKey` | `enumerate-complete-segmentation-paths.ts` |
| Complete path | `SegmentationPath.edgeRefs: readonly LexicalEdge[]` + `boundaryKey` | `lattice-path-types.ts` |
| Prune sites | `per_position_cap` @ `active[pos]`; `complete_path_cap` @ `active[N]` | same enumerate file |

```text
ACTIVE_PATH_EDGE_GEOMETRY_AVAILABLE   = YES
COMPLETE_PATH_EDGE_GEOMETRY_AVAILABLE = YES
```

Exact: `PartialPath.edges[]` / `SegmentationPath.edgeRefs[]` with `LexicalEdge.syllableStart|syllableEnd`.

---

## 4. Q2 — Detect different boundary alternatives without new modules?

Yes. Distinct lattice edges are unique per `(syllableStart,syllableEnd)` (enumerator rejects duplicate boundaries).  
`[9:10]` vs `[9:11]` are different `LexicalEdge` objects / different segments in `boundaryKey`.

No domain / fluency / GT judgment required.

```text
LATTICE_NATIVE_BOUNDARY_ALTERNATIVE_DETECTABLE = YES
EXPLICIT_AMBIGUITY_CLASS_TYPE_REQUIRED         = NO
```

Temporary local grouping keys (e.g. last-edge `start:end`, or “path contains edge E”) may exist **inside** the prune function only — not JobResult, not cross-service, not config.

---

## 5. Q3 / Q4 — Active & Complete feasibility

| Cap | Control-flow hook | Geometry enough? | Feasibility |
|-----|-------------------|------------------|-------------|
| `maxActivePathsPerPosition` | lines ~225–254 `enumerate-complete-segmentation-paths.ts` | YES — full `edges` before `slice` | **PARTIAL** |
| `maxCompleteSegmentationPaths` | lines ~297–324 | YES — full complete `edges` | **PARTIAL** |

**PARTIAL meaning:**

1. **Feasible to implement** a minimal deterministic constraint using only existing geometry + existing comparator + existing caps.
2. **Not guaranteed** that last-edge-only preservation keeps a mid-path alternative alive through *later* active prunes (chain attrition). Diagnostic: last-edge-only → **0/7** complete target retention under 8/8.
3. Mid-path **contested-edge presence** (outgoing fan-out > 1 at edge start; still no new type) can keep alternatives across positions; under 8/8 diagnostic → **2/7**. When contested edges ≫ 8, hard ceiling forces loss (allowed by principle).

```text
ACTIVE_MINIMAL_BOUNDARY_PRESERVATION_FEASIBLE   = PARTIAL
COMPLETE_MINIMAL_BOUNDARY_PRESERVATION_FEASIBLE = PARTIAL
```

Minimum change locus: **only** the two prune blocks in `enumerateCompleteSegmentationPaths` (+ tests; optional same-file private helper).

---

## 6. Q6 / Q7 — Change inventory & config

```text
MINIMUM_PRODUCTION_FILE_CHANGE_COUNT = 1
  (enumerate-complete-segmentation-paths.ts; tests separate)
MINIMUM_NEW_RUNTIME_TYPE_COUNT       = 0
MINIMUM_NEW_CONFIG_COUNT             = 0
MINIMUM_NEW_PIPELINE_STAGE_COUNT     = 0
NEW_DIVERSITY_CONFIG_REQUIRED        = NO
NEW_SERVICE / JOBRESULT_CHANGE       = 0
```

Reuse only:

```text
maxActivePathsPerPosition
maxCompleteSegmentationPaths
compareSegmentationPathRankingBestFirst
```

No `minDiversity` / quotas / weights.

---

## 7. Q17 — Known 7 losses (diagnostic only; no Pilot200)

Source: `_path_budget_edge_cache.json` + offline enum mirror of production comparator/caps.

| caseId | target geom | stage | edge exists | contested @ start | uncapped complete w/ geom | lastEdge@8/8 hit | contestedCover@8/8 hit | structurally addressable? |
|--------|-------------|-------|-------------|-------------------|---------------------------|------------------|------------------------|---------------------------|
| p2_u001_003 过拟合 | 11:14 | ACTIVE | YES | YES | YES | 0 | **1** | YES |
| p2_u004_033 城门 | 9:11 | COMPLETE | YES | YES | YES | 0 | 0 | NO under 8/8 hard ceiling race |
| p2_u005_004 水道 | 9:11 | COMPLETE | YES | YES | YES | 0 | 0 | NO under 8/8 (lastEdge active + unlimited complete can hit; not both caps 8) |
| p2_u005_015 提示符 | 6:9 | ACTIVE | YES | YES | YES | 0 | 0 | NO under 8/8 (later-position attrition / ceiling) |
| p2_u003_017 护士长 | 10:13 | ACTIVE | YES | YES | * | 0 | **1** | YES |
| p2_u004_010 行程图 | 5:8 | ACTIVE | YES | YES | YES | 0 | 0 | NO under 8/8 |
| p2_u004_036 黄包车 | 3:6 | ACTIVE | YES | YES | YES | 0 | 0 | NO under 8/8 |

\*护士长: graph has edge; complete retention sensitive to active prune policy.

```text
KNOWN_7_LOSS_STRUCTURALLY_ADDRESSABLE = 2/7
```

Interpretation for ACP:

- Minimal lattice-native preservation **can** prevent *some* total wipeouts of a legal boundary alternative.
- It does **not** promise recovery of all Pilot target geometries under PROBE 8/8.
- Remaining losses are consistent with `HARD_RESOURCE_CEILING_AUTHORITY = FINAL` when alternatives exceed slots — not a reason to reintroduce a Diversity subsystem.

---

## 8. Complexity Gate

| Requirement | Status |
|-------------|--------|
| NO new model / service / pipeline stage | PASS |
| NO JobResult change | PASS |
| NO domain feedback / semantic scoring | PASS |
| NO configurable taxonomy / diversity score family | PASS |
| NO second pruning pipeline / compatibility path | PASS |
| Allow small local deterministic helper + existing geometry/comparator/caps/tests | PASS |

```text
COMPLEXITY_GATE = PASS
```

---

## 9. ACP simplification decision

Contract from V1 **Local Ambiguity Representation system** →:

```text
MINIMAL_LATTICE_BOUNDARY_PRESERVATION
```

Still **DRAFT / USER_APPROVAL_REQUIRED**. User must still choose (amend only — not new subsystems):

1. Preservation signal scope for V1: **last-edge-at-prune-pos only** (simplest; weak end-to-end) vs **path-contains contested LexicalEdge** (still typeless; stronger; still lossy under ceiling).
2. Accept that known-loss addressability under 8/8 may stay **partial**; path-budget finalization remains separate and still **not** authorized here.

```text
IMPLEMENTATION_AUTHORIZED = NO
PATH_CAP_CHANGE_REQUIRED  = NO
STRUCTURAL_COMPARATOR_CHANGE_REQUIRED = NO
DOMAIN_VOTE_MOVE_REQUIRED = NO
```

---

## 10. Final verdict

```text
AUDIT_VALID = YES

PRODUCT_RUNTIME_CODE_CHANGED = NO
PRODUCTION_CONFIG_CHANGED = NO

ACP_SIMPLIFICATION_RECOMMENDED = YES

SIMPLIFIED_ACP_NAME =
MINIMAL_LATTICE_BOUNDARY_PRESERVATION

ACTIVE_PATH_EDGE_GEOMETRY_AVAILABLE = YES
COMPLETE_PATH_EDGE_GEOMETRY_AVAILABLE = YES

LATTICE_NATIVE_BOUNDARY_ALTERNATIVE_DETECTABLE = YES

EXPLICIT_AMBIGUITY_CLASS_TYPE_REQUIRED = NO

ACTIVE_MINIMAL_BOUNDARY_PRESERVATION_FEASIBLE =
PARTIAL

COMPLETE_MINIMAL_BOUNDARY_PRESERVATION_FEASIBLE =
PARTIAL

MINIMAL_IMPLEMENTATION_FEASIBLE =
YES

KNOWN_7_LOSS_STRUCTURALLY_ADDRESSABLE =
2/7

MINIMUM_PRODUCTION_FILE_CHANGE_COUNT = 1
MINIMUM_NEW_RUNTIME_TYPE_COUNT = 0
MINIMUM_NEW_CONFIG_COUNT = 0
MINIMUM_NEW_PIPELINE_STAGE_COUNT = 0

NEW_DIVERSITY_CONFIG_REQUIRED = NO

DOMAIN_TO_SEGMENTATION_FEEDBACK = FORBIDDEN
DOMAIN_VOTE_MOVE_REQUIRED = NO

STRUCTURAL_COMPARATOR_CHANGE_REQUIRED = NO
PATH_CAP_CHANGE_REQUIRED = NO

MODEL2_CHANGE_REQUIRED = NO
MODEL3_CHANGE_REQUIRED = NO
QUERY_EVIDENCE_CHANGE_REQUIRED = NO
RETRY_REGION_CHANGE_REQUIRED = NO
DOMAIN_VOTE_CHANGE_REQUIRED = NO
SAMEDOMAIN_CHANGE_REQUIRED = NO
KENLM_CHANGE_REQUIRED = NO
JOBRESULT_CHANGE_REQUIRED = NO

REPAIR_REPLACEMENT_LENGTH_INVARIANT_STATUS =
DEFERRED / OUT_OF_SCOPE

COMPLEXITY_GATE =
PASS

ACP_STATUS =
DRAFT / USER_APPROVAL_REQUIRED

IMPLEMENTATION_AUTHORIZED = NO

ONE_NEXT_OWNER =
USER_ARCHITECTURE_DECISION

ONE_NEXT_DELTA =
Approve / amend simplified ACP MINIMAL_LATTICE_BOUNDARY_PRESERVATION
(preservation signal: last-edge vs contested-edge presence)
— do not implement yet
```

---

## Artifacts

1. `LINGUA_MINIMAL_BOUNDARY_PRESERVATION_FEASIBILITY_AUDIT_V1.md` (this file)
2. `minimal_change_inventory.csv`
3. `known_7_loss_minimal_boundary_attribution.csv`
4. `minimal_boundary_audit_manifest.json`

**STOP.**
