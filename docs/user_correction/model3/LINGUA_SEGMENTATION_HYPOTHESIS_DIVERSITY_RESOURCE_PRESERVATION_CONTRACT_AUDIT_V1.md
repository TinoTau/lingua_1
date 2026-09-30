# Lingua1 — Segmentation Hypothesis Diversity / Resource Preservation Contract Audit V1

PHASE = `LINGUA_SEGMENTATION_HYPOTHESIS_DIVERSITY_RESOURCE_PRESERVATION_CONTRACT_AUDIT_V1`  
MODE = READ_ONLY · CODE_FROZEN · HISTORICAL_AUTHORITY_RECONSTRUCTION · NO_CAP_TUNING

## 0. Question answered

When structural resource caps must delete SegmentationPaths, does frozen Lingua architecture require preserving **representative hypothesis diversity** so distinct lexical geometries can still reach Domain Vote?

**Answer:** Multi-path exists to preserve **boundary/lexical ambiguity** and feed **independent per-path Domain Vote/SameDomain** (P1+P3+P4). Uncapped: **every legal complete boundaryKey MUST be retained**. Under cap: authority is **STRUCTURAL_TOPN_ONLY** — **no** historical definition of diversity / representative geometry class. Runtime 8/8 shows target-geometry classes can be absent while structurally redundant fine partitions fill the cap.  
**DIVERSITY_CONTRACT_STATUS = ARCHITECTURE_GAP** (Case C).

---

## 1. Historical authority (SSOT first)

### WHY_MULTIPLE_SEGMENTATION_PATHS_EXIST

From Lattice Architecture V1.0.0 (2026-07-26):

| Purpose | Evidence |
|---------|----------|
| **P1** preserve lexical segmentation ambiguity | Replaces LTR unique FormalFineSpan / “must pick unique boundary before Domain Vote”; Acceptance: “Multiple legal boundaryKeys retained” |
| **P3** preserve domain ambiguity (path-local) | `for each SegmentationPath: independent Domain Vote` |
| **P4** preserve downstream assembly possibilities | Per-Path SameDomain; no cross-path stitch; identical text keeps multi-source Trace |
| Not P5-only | Explicit: 路径限宽 = 资源保护，≠ 语言决策 |

### Cap-time preservation

| Condition | Contract |
|-----------|----------|
| Caps **not** triggered | `every legal complete boundaryKey MUST be retained` — **HARD_BUSINESS_REQUIREMENT** |
| Caps **triggered** | Structural comparator only — **STRUCTURAL_TOPN_ONLY** |

```text
HISTORICAL_DIVERSITY_DEFINITION = NOT_FOUND
REPRESENTATIVE_PATH_REQUIREMENT = NOT_FOUND
STRUCTURAL_DUPLICATE_DOMINATION_ALLOWED = NOT_SPECIFIED
ACTIVE_PATH_PRESERVATION_CONTRACT = STRUCTURAL_TOPN_ONLY
COMPLETE_PATH_PRESERVATION_CONTRACT = STRUCTURAL_TOPN_ONLY
PRE_DOMAINVOTE_STRUCTURAL_TOPN_AUTHORITY = ALLOWED_ONLY_AS_RESOURCE_SAFETY
```

### boundaryKey identity (SSOT + code)

```text
BOUNDARY_KEY_IDENTITY = ordered LexicalEdge syllable ranges `start-end|…` (segmentation partition geometry)
```

| Question | Answer |
|----------|--------|
| SAME_BOUNDARYKEY_CAN_HAVE_MULTIPLE_CANDIDATE_HYPOTHESES | **YES** — one Path / one boundaryKey; Edge holds many Candidates |
| SAME_BOUNDARYKEY_CAN_HAVE_MULTIPLE_DOMAIN_HYPOTHESES | **NO as multiple Paths** — “same boundaryKey does not expand to multiple Paths for multi-Candidate”; domains resolved later via Vote on that Path’s candidates |
| DIFFERENT_BOUNDARYKEY_CAN_LEAD_TO_SAME_DOMAIN | **YES** — independent Votes may retain same domain |

`DOMAIN_TO_SEGMENTATION_FEEDBACK = FORBIDDEN` (unchanged).

### INDEPENDENT_DOMAIN_BUCKET_REQUIRES_MULTIPLE_SEGMENTATION_PATHS

**PARTIAL** — buckets are per retained Path; multiple Paths enable multiple independent Votes; SSOT does **not** require a minimum path count or geometry-class quota to “feed” Domain Vote under caps.

---

## 2. Runtime diagnostic (8/8 only; no sweep)

Evaluable target-edge cohort = **17** (cached). Losses before Domain Vote = **7/17**.

### Aggregate (cap-fired cases)

- Mean `GEOMETRY_RETENTION_RATIO` ≈ **0.50** (diagnostic geometry signatures)
- Domain-tag signatures: **NOT_EVALUABLE** on cache (domains not stored on reconstructed edges)
- `DIAGNOSTIC_GEOMETRY_SIGNATURE_ONLY = YES`

### 7 target losses — diversity attribution

| Class | Count | Meaning (diagnostic) |
|-------|------:|----------------------|
| **D4** | 5 | Active cap collapses ambiguity before target complete path forms |
| **D2** | 2 | Complete cap: target geometry class absent; structural-score redundancy fills Top-N |

### G2 detail

| case | LOSS_STAGE | rank | retained unique geom | target class after | collapse | class |
|------|------------|------|----------------------|--------------------|----------|-------|
| 过拟合 | ACTIVE_CAP | n/a | 8 | NO | YES | D4 |
| 提示符 | ACTIVE_CAP | n/a | 8 | NO | YES | D4 |
| 城门 | COMPLETE_CAP | 11 | 8 | NO | YES | D2 |
| 水道 | COMPLETE_CAP | 14 | 8 | NO | YES | D2 |

Note: retained paths often still have **8 distinct full geometry signatures**; collapse here means **target geometry class missing** while **structural-count-similar** fine partitions occupy the resource slots (especially `exactEdgeCount DESC`) — not identical-geometry clones.

```text
ACTIVE_CAP_DIVERSITY_COLLAPSE = YES
COMPLETE_CAP_DIVERSITY_COLLAPSE = YES
G2_DIVERSITY_COLLAPSE_COUNT = 4/4
ALL_TARGET_LOSS_DIVERSITY_COLLAPSE_COUNT = 7/7
```

Diagnostic only — **not** a defect vs written STRUCTURAL_TOPN rule.

---

## 3. Classification (decision rules)

Business intent frozen:

- multi-path / independent path-domain buckets
- resource pruning ≠ language decision
- all legal boundaryKeys when uncapped

Cap-time:

- only structural Top-N specified
- no diversity / representative-class contract

→ **Case C**

```text
DIVERSITY_CONTRACT_STATUS = ARCHITECTURE_GAP
IMPLEMENTATION_DEFECT_FOUND = NO
IMPLEMENTATION_DRIFT_FOUND = NO
ARCHITECTURE_GAP_FOUND = YES
ARCHITECTURE_CONFLICT_FOUND = NO
ACP_REQUIRED = YES
ACP_SCOPE = SEGMENTATION_RESOURCE_PRUNING_DIVERSITY_CONTRACT
```

```text
RESOURCE_PRUNING_IS_ACTING_AS_BUSINESS_SELECTOR = PARTIAL
PATH_BUDGET_FINALIZATION_READY = NO
```

Finalizing 8/12/16 **without** resolving whether cap-time must preserve geometry/ambiguity classes would freeze the gap.

---

## 4. Final verdict

```text
AUDIT_VALID = YES

PRODUCT_RUNTIME_CODE_CHANGED = NO
PRODUCTION_CONFIG_CHANGED = NO
ARCHITECTURE_CHANGED = NO

HISTORICAL_AUTHORITY_RECONSTRUCTED = YES

WHY_MULTIPLE_SEGMENTATION_PATHS_EXIST = P1_lexical_boundary_ambiguity + P3_path_local_domain_hypotheses + P4_downstream_assembly_possibilities (Lattice Architecture 2026-07-26; replaces unique-boundary-before-Vote)

INDEPENDENT_DOMAIN_BUCKET_REQUIRES_MULTIPLE_SEGMENTATION_PATHS = PARTIAL

PRE_DOMAINVOTE_STRUCTURAL_TOPN_AUTHORITY = ALLOWED_ONLY_AS_RESOURCE_SAFETY

ACTIVE_PATH_PRESERVATION_CONTRACT = STRUCTURAL_TOPN_ONLY
COMPLETE_PATH_PRESERVATION_CONTRACT = STRUCTURAL_TOPN_ONLY

HISTORICAL_DIVERSITY_DEFINITION = NOT_FOUND

REPRESENTATIVE_PATH_REQUIREMENT = NOT_FOUND

STRUCTURAL_DUPLICATE_DOMINATION_ALLOWED = NOT_SPECIFIED

BOUNDARY_KEY_IDENTITY = ordered_edge_syllable_ranges_segmentation_partition

DOMAIN_TO_SEGMENTATION_FEEDBACK = FORBIDDEN

CURRENT_ACTIVE_PATH_CAP = 8
CURRENT_COMPLETE_PATH_CAP = 8
CURRENT_CAP_AUTHORITY = PROBE / NOT_FINAL

PRE_DOMAINVOTE_TARGET_LOSS_COUNT = 7/17

ACTIVE_CAP_DIVERSITY_COLLAPSE = YES
COMPLETE_CAP_DIVERSITY_COLLAPSE = YES

G2_DIVERSITY_COLLAPSE_COUNT = 4/4
ALL_TARGET_LOSS_DIVERSITY_COLLAPSE_COUNT = 7/7

RESOURCE_PRUNING_IS_ACTING_AS_BUSINESS_SELECTOR = PARTIAL

DIVERSITY_CONTRACT_STATUS = ARCHITECTURE_GAP

IMPLEMENTATION_DEFECT_FOUND = NO
IMPLEMENTATION_DRIFT_FOUND = NO

ARCHITECTURE_GAP_FOUND = YES
ARCHITECTURE_CONFLICT_FOUND = NO

PATH_BUDGET_FINALIZATION_READY = NO

PATH_CAP_CHANGE_REQUIRED = NOT_DECIDED

DOMAIN_VOTE_MOVE_REQUIRED = NO

MODEL2_CHANGE_REQUIRED = NO
MODEL3_CHANGE_REQUIRED = NO
QUERY_EVIDENCE_CHANGE_REQUIRED = NO
RETRY_REGION_CHANGE_REQUIRED = NO
DOMAIN_VOTE_CHANGE_REQUIRED = NO
SAMEDOMAIN_CHANGE_REQUIRED = NO
KENLM_CHANGE_REQUIRED = NO

REPAIR_REPLACEMENT_LENGTH_INVARIANT_STATUS = DEFERRED / OUT_OF_SCOPE

ACP_REQUIRED = YES

ACP_SCOPE = SEGMENTATION_RESOURCE_PRUNING_DIVERSITY_CONTRACT

ONE_NEXT_OWNER = SEGMENTATION_RESOURCE_PRUNING_DIVERSITY_CONTRACT_ACP

ONE_NEXT_DELTA = Draft ACP only — define whether/how resource caps must preserve representative segmentation hypothesis classes; do not implement algorithm or change 8/8
```

---

## Artifacts

1. `LINGUA_SEGMENTATION_HYPOTHESIS_DIVERSITY_RESOURCE_PRESERVATION_CONTRACT_AUDIT_V1.md` (this file)  
2. `segmentation_diversity_authority_timeline.csv`  
3. `historical_diversity_contract_matrix.csv`  
4. `segmentation_8x8_diversity_measurement.csv`  
5. `segmentation_target_loss_diversity_attribution.csv`  
6. `segmentation_diversity_audit_manifest.json`
