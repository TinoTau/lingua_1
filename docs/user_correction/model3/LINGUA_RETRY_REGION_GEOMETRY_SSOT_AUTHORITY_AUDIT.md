# LINGUA_RETRY_REGION_GEOMETRY_SSOT_AUTHORITY_AUDIT

| Field | Value |
| --- | --- |
| Phase | `LINGUA_RETRY_REGION_GEOMETRY_SSOT_AUTHORITY_AUDIT_V1` |
| Mode | READ_ONLY / HISTORICAL_SSOT / CURRENT_CODE / CODE_FROZEN |
| Date | 2026-09-16 |
| AUDIT_VALID | YES |
| PRODUCT_RUNTIME_CODE_CHANGED | NO |
| GT_USED_BY_RUNTIME | NO |
| C9_CASES | 23 |
| C9_PARTIAL_COVERAGE | 20 |
| C9_NO_COVERAGE | 3 |

## 1. Verdict in one paragraph

Current `deriveRetryRegions` is a **faithful implementation** of the frozen RetryRegion derivation SSOT (**Interpretation A**: contiguous non-Anchor `RETRY` PathFineSpan union; KEEP/Anchor break merge; **no expansion** beyond RETRY spans). The 23 C9 cases show first-pass target-reachable evidence intervals that are only partially covered or disjoint from those regions; under frozen authority, **covering those evidence intervals is not required**. Therefore C9 is an **expected limitation** of the intentional RETRY-only recovery scope, not an implementation defect. Broadening recovery would be an **architecture change (ACP)**, not a conformance repair.

## 2. Primary research question — interpretation

| ID | Meaning | Authority match |
| --- | --- | --- |
| **A** RETRY_PATH_FINE_SPAN_UNION | Region = contiguous RETRY PathFineSpan union | **SELECTED** — matches 2026-08-28+ frozen contract + Stage2/Fallback locks |
| B BOUNDED_LOCAL_RECOVERY_REGION | Region may expand beyond RETRY to “sufficient” lexical recovery | **Rejected** — Stage2/Mapping audits forbid widen into KEEP |
| C Decision fixed; recovery context may extend outside region | Recovery queries may leave RetryRegion | **Rejected** — Fallback Boundary Lock: region is hard bound |
| D NOT_SPECIFIED | No region formula | Applies only **before** 2026-08-28 |

## 3. Earliest authoritative definitions

```text
EARLIEST_AUTHORITATIVE_MODEL3_RETRY_DEFINITION =
MODEL3_ARCHITECTURE_CONTRACT_V1.md (Effective 2026-08-23)
  RETRY = request one bounded local Lexicon Recall retry / re-recall
  Decision unit = PathFineSpan KEEP|RETRY
  No RetryRegion geometry yet

EARLIEST_AUTHORITATIVE_RETRY_REGION_DEFINITION =
model3_retry_contract_v1.md update + ASR Postprocess Retry-Region Correction Report (2026-08-28)
  RETRY means one bounded local re-segmentation + re-recall within derived retry region(s)
  Adjacent RETRY merge allowed
  Model3 emits no region fields (router owns derivation)
```

## 4. Decision unit vs recovery unit

```text
DECISION_UNIT_AND_RECOVERY_UNIT_AUTHORITY =
DISTINCT

MODEL3_DECISION_UNIT =
PathFineSpan KEEP|RETRY

RETRY_RECOVERY_UNIT =
Derived RetryRegion (+ Stage2 lexical windows clipped inside region)

MODEL3_MODEL_OWNS_REGION_BOUNDARY =
NO

RETRY_ROUTER_OWNS_REGION_BOUNDARY =
YES
```

Model3 may correctly emit RETRY on suspicious spans while the recovery region remains the RETRY-span union. **C9 does not imply Model3 decision failure.**

## 5. Current `deriveRetryRegions` policy

```text
CURRENT_RETRY_REGION_POLICY =
Collect non-Anchor PathFineSpans with decision=RETRY in path order; merge only when raw/syllable-adjacent; KEEP or Anchor flushes the pending group; region bounds = first..last span union; no lexical/evidence/ASR-radius expansion.
```

Observed chain:

```text
Model3 RETRY units
→ deriveRetryRegions (RETRY-only contiguous union)
→ optional lattice resegment on region slice
→ Stage2 windows 1..min(5,R) entirely inside region
→ Recall (tone-relaxed Stage2 mode)
```

Inputs visible to deriver: PathFineSpan geometry, KEEP/RETRY decisions, Anchor set.  
**Not** consulted: RecallQueryEvidence, FineSpan lexical windows outside RETRY, Model2 queries, GT.

## 6. Boundedness / resegmentation / Anchor / lexical relation

| Topic | Authority |
| --- | --- |
| BOUNDED_LOCAL_AUTHORITY | One retry cycle; region = RETRY-union; Stage2 L≤5 inside region; no ASR/DomainVote/Model3 recursion |
| RESEGMENTATION_CAN_CROSS_ORIGINAL_PATHFINESPAN_BOUNDARY | **YES** inside RetryRegion; **NO** outside region |
| REGION_EXPANSION_BEYOND_RETRY_SPANS_AUTHORITY | **FORBIDDEN** |
| RETRY_REGION_LEXICAL_WINDOW_RELATION | **WINDOWS_CLIPPED_TO_REGION** |
| ANCHOR_ACTION_IMMUTABILITY | Anchor candidates not actionable RETRY; mutation FORBIDDEN |
| ANCHOR_GEOMETRY_CROSSING | **FORBIDDEN** for merge/expansion |
| ANCHOR_CONTEXT_VISIBILITY | Anchor may bound/break regions; not an expansion license |

## 7. QueryEvidence is newer — mandatory distinction

RecallQueryEvidence (2026-09-15 ACP) did **not** exist when RetryRegion SSOT was frozen (2026-08-28).  
Old SSOT never said “RetryRegion must cover RecallQueryEvidence.”  
QueryEvidence ACP explicitly marks region formation / DISJOINT coverage as **out of scope**.  
C9 therefore exposes a **product tension** between frozen RETRY-only recovery scope and newer evidence reuse — **not** a hidden violation of 08-28 region derivation.

## 8. Application to 23 C9 cases

| coverageClass | Count | Meaning under SSOT |
| --- | ---: | --- |
| PARTIAL | 20 | Some RETRY-union overlaps evidence but KEEP/end boundary truncates full evidence interval |
| NONE | 3 | No region covers evidence interval |
| FULL | 0 | — |

**Classification: R1 = 23 / 23** (all cases)

```text
R1_IMPLEMENTATION_CONFORMS_AND_COVERAGE_NOT_REQUIRED = 23
R2_IMPLEMENTATION_VIOLATES_EXISTING_RECOVERY_GEOMETRY_SSOT = 0
R3_EXISTING_SSOT_DOES_NOT_DEFINE_REQUIRED_COVERAGE = 0
R4_EXISTING_SSOT_CONFLICTS_INTERNALLY = 0
R5_CASE_NOT_DECIDABLE_FROM_AVAILABLE_EVIDENCE = 0
```

Authority-required coverage of first-pass evidence intervals: **NOT_REQUIRED_BY_SSOT**.  
Implementation conforms to RETRY-union derivation in all 23.

Canonical partial: `p2_u001_014` evidence `[6,8)` vs best region `[2,7)` — overlap without full cover; SSOT forbids expanding into trailing KEEP to include syllable 7–8 unless that span is also RETRY.

## 9. Architecture-level RESULT C

```text
ARCHITECTURE_STATUS = SSOT_CLEAR
CURRENT_IMPLEMENTATION = CONFORMANT
C9_EXPECTED_LIMITATION = YES
IMPLEMENTATION_DEFECT_FOUND = NO
ARCHITECTURE_GAP_FOUND = NO
ARCHITECTURE_CONFLICT_FOUND = NO
ACP_REQUIRED = YES
```

ACP is required **only if** the product wants broader recovery than frozen RETRY-span union.  
This round does **not** draft ACP options.

Stale docs (`model3_freeze_governance.json` older `productionRetry:false` wording) are superseded by 2026-09-08 ACTIVE+FROZEN seal — not treated as live conflict against RETRY-union formula.

## 10. Closed scopes

| Item | Status |
| --- | --- |
| Model3 input change | NO |
| Model3 KEEP/RETRY label semantics | NO |
| Stage2 Tone / EXACT-SUBSPAN mapper | NO |
| QueryEvidence V1 reopen | NO |
| C4/C5 redesign | OUT OF SCOPE |
| Fix C9 this round | NO |

## 11. Anti-drift

FineSpan / Model2 / Model3 / RetryRegion / deriveRetryRegions / Stage2 / QueryEvidence / Tone / Lexicon / Domain / budget / Assembly / KenLM / Pilot / GT-runtime / C9 fixes: **all NO**.

## 12. Artifacts

1. `LINGUA_RETRY_REGION_GEOMETRY_SSOT_AUTHORITY_AUDIT.md` (this file)
2. `LINGUA_RETRY_REGION_AUTHORITY_TIMELINE.csv`
3. `LINGUA_RETRY_REGION_AUTHORITY_MATRIX.csv`
4. `LINGUA_RETRY_REGION_C9_CASE_MATRIX.csv`
5. `LINGUA_RETRY_REGION_SSOT_CLASSIFICATION.json`
6. `modified_file_inventory.csv`

---

## FINAL VERDICT

```text
PHASE =
LINGUA_RETRY_REGION_GEOMETRY_SSOT_AUTHORITY_AUDIT_V1

AUDIT_VALID =
YES

PRODUCT_RUNTIME_CODE_CHANGED =
NO

GT_USED_BY_RUNTIME =
NO

C9_CASES =
23

C9_PARTIAL_COVERAGE =
20

C9_NO_COVERAGE =
3

EARLIEST_AUTHORITATIVE_MODEL3_RETRY_DEFINITION =
MODEL3_ARCHITECTURE_CONTRACT_V1.md (Effective 2026-08-23)

EARLIEST_AUTHORITATIVE_RETRY_REGION_DEFINITION =
model3_retry_contract_v1.md + ASR Postprocess Retry-Region Correction Report (2026-08-28)

MODEL3_DECISION_UNIT =
PathFineSpan KEEP|RETRY

RETRY_RECOVERY_UNIT =
Derived RetryRegion (Stage2 windows clipped inside)

DECISION_UNIT_AND_RECOVERY_UNIT_AUTHORITY =
DISTINCT

MODEL3_MODEL_OWNS_REGION_BOUNDARY =
NO

RETRY_ROUTER_OWNS_REGION_BOUNDARY =
YES

CURRENT_RETRY_REGION_POLICY =
Non-Anchor RETRY PathFineSpans merged only when raw/syllable-adjacent; KEEP/Anchor break groups; bounds = union of those spans; no evidence/lexical/radius expansion.

REGION_EXPANSION_BEYOND_RETRY_SPANS_AUTHORITY =
FORBIDDEN

RESEGMENTATION_CAN_CROSS_ORIGINAL_PATHFINESPAN_BOUNDARY =
YES

RETRY_REGION_LEXICAL_WINDOW_RELATION =
WINDOWS_CLIPPED_TO_REGION

ANCHOR_ACTION_IMMUTABILITY =
Anchor not actionable RETRY; mutation FORBIDDEN during retry

ANCHOR_GEOMETRY_CROSSING =
FORBIDDEN

BOUNDED_LOCAL_AUTHORITY =
One retry cycle; region=RETRY-union; Stage2 L∈[1,min(5,R)] inside region; no ASR/DomainVote/Model3 recursion

R1_IMPLEMENTATION_CONFORMS_AND_COVERAGE_NOT_REQUIRED =
23

R2_IMPLEMENTATION_VIOLATES_EXISTING_RECOVERY_GEOMETRY_SSOT =
0

R3_EXISTING_SSOT_DOES_NOT_DEFINE_REQUIRED_COVERAGE =
0

R4_EXISTING_SSOT_CONFLICTS_INTERNALLY =
0

R5_CASE_NOT_DECIDABLE_FROM_AVAILABLE_EVIDENCE =
0

CASE_CLASSIFICATION_TOTAL =
23

ARCHITECTURE_STATUS =
SSOT_CLEAR

CURRENT_IMPLEMENTATION =
CONFORMANT

ARCHITECTURE_CONFLICT_FOUND =
NO

ARCHITECTURE_GAP_FOUND =
NO

IMPLEMENTATION_DEFECT_FOUND =
NO

C9_EXPECTED_LIMITATION =
YES

DOES_C9_REQUIRE_MODEL3_DECISION_CHANGE =
NO

DOES_C9_REQUIRE_RETRY_ROUTER_GEOMETRY_CHANGE =
NO

MODEL3_INPUT_CHANGE_REQUIRED =
NO

QUERY_EVIDENCE_V1_REOPEN_REQUIRED =
NO

STAGE2_CHANGE_REQUIRED =
NO

ACP_REQUIRED =
YES

ACP_REASON =
Frozen SSOT requires RETRY PathFineSpan union and forbids KEEP expansion; covering first-pass evidence beyond that union needs an architecture change, not a conformance fix.

ONE_NEXT_OWNER =
RETRY_RECOVERY_SCOPE_ARCHITECTURE_CHANGE

ONE_NEXT_DELTA =
Draft ACP only if broader recovery than RETRY PathFineSpan union is desired; do not treat C9 as deriveRetryRegions defect.
```
