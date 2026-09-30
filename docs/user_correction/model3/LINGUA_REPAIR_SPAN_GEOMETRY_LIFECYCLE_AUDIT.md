# LINGUA_REPAIR_SPAN_GEOMETRY_LIFECYCLE_AUDIT

| Field | Value |
| --- | --- |
| Phase | `LINGUA_REPAIR_SPAN_GEOMETRY_LIFECYCLE_AUDIT_V1` |
| Mode | READ_ONLY / TRACE_FIRST / LENGTH_INVARIANT_FIRST / CODE_FROZEN |
| Date | 2026-09-16 |
| AUDIT_VALID | YES |
| PRODUCT_RUNTIME_CODE_CHANGED | NO |
| GT_USED_BY_RUNTIME | NO |
| C9_CASES | 23 |
| FIRST_PASS_TARGET_REACHABLE_WINDOW | 23 |

## 1. Verdict

For the 23 prior C9 cases, the complete first-pass QueryEvidence geometry was **usually not a legitimate replaceable span** on the selected runtime path.

- **Dominant first divergence: `G8` (10/23)** — target-length QueryEvidence existed (often zero-hit), never became a candidate-bearing LexicalEdge, and selected PathFineSpans over the site are **shorter**.
- Combined **G1+G8 = 15/23**: evidence geometry never owns repair.
- **G2 = 4**: candidates existed at evidence geometry, but segmentation selected other (typically shorter) spans.
- **G4 = 4**: exact-geometry PathFineSpan appears on some paths as **KEEP**; RETRY/RetryRegion near the site comes from other path partitions — still does **not** authorize splicing a longer QueryEvidence into a shorter RETRY repair span.

**Previous C9 interpretation is PARTIALLY_REVISED:** C9 measured RetryRegion vs QueryEvidence coverage, but under the frozen length invariant and PathFineSpan ownership, most of those evidence intervals were **structurally inapplicable** to the actual repair spans. RetryRegion expansion is **not** required and remains **CLOSED**.

## 2. Authoritative replaceable span

```text
REPLACEABLE_SPAN_GEOMETRY_OWNER =
PathFineSpan
  (1:1 materialization of selected LexicalEdge on a SegmentationPath)

REPLACEABLE_SPAN_GEOMETRY_FIRST_CREATED_AT =
LexicalEdge construction from recalled windows with ≥1 WindowCandidate
  then frozen into PathFineSpan at path materialization

REPLACEABLE_SPAN_GEOMETRY_CAN_CHANGE_AFTER_CREATION =
NO for a selected edge → PathFineSpan (no merge/split at materialize)
ONLY_BY_path_selection among competing LexicalEdges before materialize
RetryRegion unions RETRY PathFineSpans later (recovery bound ≠ repair span owner)
```

```text
QUERY_EVIDENCE_GRANTS_REPAIR_AUTHORITY =
NO
```

`buildLexicalEdges` skips windows with zero candidates. `RecallQueryEvidence` is upserted even on zero-hit Model2 queries and does **not** create LexicalEdges.

## 3. Length invariant

```text
REPAIR_REPLACEMENT_LENGTH_INVARIANT = FROZEN
  (user architecture authority this round)
  replacement character length == replaceable original span character length

REPLACEMENT_LENGTH_AUTHORITY =
RAW_CHARACTER_GEOMETRY (business)
  with syllable geometry as primary lattice indexing;
  normal CJK lexical spans assume rawLen == syllableLen

CURRENT_LENGTH_INVARIANT_ENFORCED =
NO

LENGTH_CHANGING_REPLACEMENT_RUNTIME_REACHABLE =
YES
```

Production assembly (`applyReplacementsRightToLeft`) splices `replacement` into `raw[start,end)` **without** requiring equal character lengths. Eligibility checks range alignment of candidate geometry to FineSpan, not surface char equality. Therefore a 2-char candidate on a 1-char PathFineSpan is currently runtime-reachable and would violate the newly frozen invariant (e.g. `纪→纪念` → `三叠纪念`).

**Do not add the filter in this round** — record the gap only.

## 4. Lifecycle funnel (23)

```text
23 first-pass target-reachable windows
↓ 15 drop (G1/G8)
8 same-geometry LexicalEdge exists (incl. candidate-only / not selected)
↓ 4 drop (G2)
4 same-geometry edge selected → PathFineSpan with candidates
↓ 0 drop (G3=0)
4 same-geometry PathFineSpan exists
↓ 4 drop (G4)
0 same-geometry PathFineSpan receives RETRY
↓
0 same-geometry RetryRegion exists
```

```text
SAME_GEOMETRY_LEXICAL_EDGE_EXISTS = 8
SAME_GEOMETRY_EDGE_SELECTED = 4
SAME_GEOMETRY_PATHFINESPAN_EXISTS = 4
SAME_GEOMETRY_PATHFINESPAN_RETRY = 0
SAME_GEOMETRY_RETRYREGION_EXISTS = 0
```

## 5. First-divergence matrix

| Class | Count | % |
| --- | ---: | ---: |
| G1 | 5 | 21.7 |
| G2 | 4 | 17.4 |
| G3 | 0 | 0.0 |
| G4 | 4 | 17.4 |
| G5 | 0 | 0.0 |
| G6 | 0 | 0.0 |
| G7 | 0 | 0.0 |
| G8 | 10 | 43.5 |
| G9–G11 | 0 | 0.0 |
| **TOTAL** | **23** | **100** |

## 6. Structural applicability of QueryEvidence to Retry repair spans

```text
QUERY_EVIDENCE_STRUCTURALLY_APPLICABLE_TO_RETRY_SPAN =
NO
  YES=0 NO=19 MIXED=4 NOT_PROVEN=0
```

Under `REPAIR_REPLACEMENT_LENGTH_INVARIANT`, a multi-syllable QueryEvidence key cannot legally replace a shorter PathFineSpan even if RetryRegion were expanded to “cover” the evidence interval.

## 7. Closed scopes (anti-drift)

RetryRegion / Stage2 / Model2 / Model3 / QueryEvidence / FineSpan / segmentation / length filters: **unchanged this round**.

## 8. Next owner

Dominant `G8` → CASE E: previous C9 is largely a **search-evidence vs repair-span mismatch**, not a RetryRegion defect.

The newly frozen length invariant is **not** enforced in production, and length-changing replacement is reachable — that is the concrete implementation gap exposed by this audit (without implementing it here).

```text
ONE_NEXT_OWNER =
REPAIR_REPLACEMENT_LENGTH_INVARIANT_CONFORMANCE

ONE_NEXT_DELTA =
Pre-development conformance plan to enforce replacement char length == PathFineSpan/repair-span char length at materialization/assembly gates; do not expand RetryRegion; do not treat QueryEvidence geometry as repair authority
```

---

## FINAL VERDICT

```text
PHASE =
LINGUA_REPAIR_SPAN_GEOMETRY_LIFECYCLE_AUDIT_V1

AUDIT_VALID =
YES

PRODUCT_RUNTIME_CODE_CHANGED =
NO

GT_USED_BY_RUNTIME =
NO

C9_CASES =
23

FIRST_PASS_TARGET_REACHABLE_WINDOW =
23

REPLACEABLE_SPAN_GEOMETRY_OWNER =
PathFineSpan (from selected LexicalEdge)

REPLACEABLE_SPAN_GEOMETRY_FIRST_CREATED_AT =
LexicalEdge (candidate-bearing recalled window) → PathFineSpan materialization

REPLACEABLE_SPAN_GEOMETRY_CAN_CHANGE_AFTER_CREATION =
NO after selection/materialize; ONLY_BY_path_selection among LexicalEdges before materialize

REPLACEMENT_LENGTH_AUTHORITY =
RAW_CHARACTER_GEOMETRY (business) with syllable lattice indexing; CJK assumes rawLen==syllableLen

REPAIR_REPLACEMENT_LENGTH_INVARIANT =
FROZEN

CURRENT_LENGTH_INVARIANT_ENFORCED =
NO

LENGTH_CHANGING_REPLACEMENT_RUNTIME_REACHABLE =
YES

QUERY_EVIDENCE_GRANTS_REPAIR_AUTHORITY =
NO

SAME_GEOMETRY_LEXICAL_EDGE_EXISTS =
8

SAME_GEOMETRY_EDGE_SELECTED =
4

SAME_GEOMETRY_PATHFINESPAN_EXISTS =
4

SAME_GEOMETRY_PATHFINESPAN_RETRY =
0

SAME_GEOMETRY_RETRYREGION_EXISTS =
0

G1 =
5

G2 =
4

G3 =
0

G4 =
4

G5 =
0

G6 =
0

G7 =
0

G8 =
10

G9 =
0

G10 =
0

G11 =
0

FIRST_DIVERGENCE_TOTAL =
23

DOMINANT_FIRST_GEOMETRY_DIVERGENCE =
G8_QUERY_EVIDENCE_GEOMETRY_WAS_NEVER_REPAIRABLE_SPAN_GEOMETRY

DOMINANT_FIRST_GEOMETRY_DIVERGENCE_COUNT =
10

QUERY_EVIDENCE_STRUCTURALLY_APPLICABLE_TO_RETRY_SPAN =
NO

PREVIOUS_C9_INTERPRETATION =
PARTIALLY_REVISED

RETRY_REGION_CHANGE_REQUIRED =
NO

SEGMENTATION_CHANGE_REQUIRED =
NOT_PROVEN

PATHFINESPAN_CHANGE_REQUIRED =
NO

MODEL3_CHANGE_REQUIRED =
NOT_PROVEN

QUERY_EVIDENCE_CHANGE_REQUIRED =
NO

LENGTH_INVARIANT_IMPLEMENTATION_CHANGE_REQUIRED =
YES

ARCHITECTURE_CONFLICT_FOUND =
NO

ARCHITECTURE_GAP_FOUND =
YES

ACP_REQUIRED =
NO

ONE_NEXT_OWNER =
REPAIR_REPLACEMENT_LENGTH_INVARIANT_CONFORMANCE

ONE_NEXT_DELTA =
Pre-development conformance plan to enforce replacement char length == PathFineSpan/repair-span char length at materialization/assembly gates; do not expand RetryRegion; do not treat QueryEvidence geometry as repair authority
```
