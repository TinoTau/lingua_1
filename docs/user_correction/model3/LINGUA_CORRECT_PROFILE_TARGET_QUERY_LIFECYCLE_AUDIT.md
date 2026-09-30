# LINGUA_CORRECT_PROFILE_TARGET_QUERY_LIFECYCLE_AUDIT

| Field | Value |
| --- | --- |
| Phase | `LINGUA_CORRECT_PROFILE_TARGET_QUERY_LIFECYCLE_ATTRIBUTION_AUDIT_V1` |
| Mode | READ_ONLY / CODE_FROZEN / SSOT_LOCKED / TRACE_FIRST |
| Date | 2026-09-16 |
| Cohort | CORRECT_PROFILE residual QEV7 A1∪A2 only |
| EXPECTED_CASES | 43 |
| ACTUAL_CASES | 43 |
| AUDIT_VALID | YES |
| PRODUCT_RUNTIME_CODE_CHANGED | NO |
| GT_USED_BY_RUNTIME | NO |
| GT_USED_BY_AUDIT | YES |

## 1. Research question (answered)

For the 43 CORRECT_PROFILE residual QEV7 cases:

> Did a target-length, target-reachable Model2-conditioned query ever exist in first-pass, and if so, where did it first become unavailable to Stage2?

**Answer:**

- In **23/43** cases, an exact target-canonical (or frozen-relation-reachable) first-pass query **did exist**, was executed, and was reconstructibly stored as `RecallQueryEvidence`.
- In **all 23** of those cases, the **first loss boundary is RetryRegion geometry**: no RetryRegion fully covers the target-query syllable interval (`C9`).
- In the remaining **20/43**, a target-reachable transformed query **never existed** in first-pass: **C5=17** (compound / independent non-profile ASR residual after relation) and **C4=3** (global relation over-application broke an already-correct syllable).

Prior QEV7 A1/A2 labels remain valid Stage2 measurement labels; this audit attributes the **upstream first lifecycle loss**.

## 2. Method (frozen)

1. Lock cohort from `LINGUA_QEV7_CASE_ATTRIBUTION.csv` (`CORRECT_PROFILE` ∧ `A1|A2`) → 43.
2. Offline diagnostic replay (`MODEL2_DIALOG200_TRACE=1`) with frozen Pilot tone evidence + CORRECT user profile.
3. Forward trace: Model2 windows → actions → relation transform → executed queries → reconstructed utterance-local evidence store (identity aligned with ACP V1 upsert rules) → RetryRegion → Stage2 invocations → frozen EXACT/SUBSPAN mapper.
4. Exactly one first-owner `C1..C16` per case. No product edits. No ACP implementation.

GT/reference used only to define `targetTerm` / `targetCanonicalPinyin` and to score reachability; never injected into runtime.

## 3. Lifecycle funnel (43)

```text
43 CORRECT_PROFILE residual QEV7
↓ 0 drop at FineSpan target-length window (C1=0)
43 target-length first-pass window exists
↓ 0 drop at Model2 eligibility (C2=0)
43 window Model2 eligible
↓ 0 drop at “no action” alone (C3=0 as sole owner)
43 target-capable Model2 action path entered
↓ 20 drop: C4=3 + C5=17  (no target-reachable transformed query)
23 target-reachable transformed query exists
↓ 0 (C6=0)
23 first-pass Recall executed
↓ 0 (C7=0)
23 RecallQueryEvidence emitted (reconstructed)
↓ 0 (C8=0)
23 evidence survives utterance-local store
↓ 23 drop: C9
0  RetryRegion fully covers target query
↓ (no further cohort remains)
0  target-length Stage2 window / mapper / Stage2 Recall path for this residual set
```

Key architecture numbers:

| Metric | Value |
| --- | ---: |
| TARGET_REACHABLE_QUERY_EVER_EXISTED_FIRST_PASS | **23/43** |
| TARGET_REACHABLE_EVIDENCE_STORE_EXISTS | **23/43** |
| TARGET_REACHABLE_EVIDENCE_BUT_RETRY_REGION_FAIL | **23** |
| TARGET_REACHABLE_EVIDENCE_AND_REGION_OK_BUT_STAGE2_WINDOW_FAIL | **0** |
| TARGET_REACHABLE_EVIDENCE_AND_STAGE2_WINDOW_OK_BUT_MAPPER_FAIL | **0** |

## 4. Owner matrix

| Owner | Count | % |
| --- | ---: | ---: |
| C1_TARGET_LENGTH_WINDOW_NEVER_ENUMERATED | 0 | 0.0 |
| C2_TARGET_WINDOW_NOT_MODEL2_ELIGIBLE | 0 | 0.0 |
| C3_MODEL2_ACTION_NOT_TARGET_REACHABLE | 0 | 0.0 |
| C4_RELATION_TRANSFORM_NOT_TARGET_REACHABLE | 3 | 7.0 |
| C5_COMPOUND_NON_PROFILE_ASR_ERROR | 17 | 39.5 |
| C6_TARGET_QUERY_NOT_EXECUTED_FIRST_PASS | 0 | 0.0 |
| C7_EXECUTED_QUERY_EVIDENCE_NOT_EMITTED | 0 | 0.0 |
| C8_EVIDENCE_STORE_LIFETIME_LOSS | 0 | 0.0 |
| C9_RETRY_REGION_CANNOT_COVER_TARGET_QUERY | **23** | **53.5** |
| C10_STAGE2_TARGET_WINDOW_NOT_ENUMERATED | 0 | 0.0 |
| C11_QUERY_EVIDENCE_GEOMETRY_CONTRACT_LIMIT | 0 | 0.0 |
| C12_EVIDENCE_SELECTION_POLICY | 0 | 0.0 |
| C13_STAGE2_QUERY_EXECUTION_CONTRADICTION | 0 | 0.0 |
| C14_TARGET_QUERY_REACHED_STAGE2_RECALL | 0 | 0.0 |
| C15_OTHER_PROVEN | 0 | 0.0 |
| C16_UNRESOLVED | 0 | 0.0 |
| **TOTAL** | **43** | **100** |

## 5. Architecture boundary matrix (from first owners)

| Boundary | Count |
| --- | ---: |
| FINESPAN_WINDOW_OWNER | 0 |
| MODEL2_ELIGIBILITY_OWNER | 0 |
| MODEL2_ACTION_OWNER | 0 |
| RELATION_TRANSFORM_OWNER | 3 |
| COMPOUND_ASR_OWNER | 17 |
| FIRST_PASS_RECALL_EXECUTION_OWNER | 0 |
| QUERY_EVIDENCE_PRODUCER_OWNER | 0 |
| QUERY_EVIDENCE_LIFETIME_OWNER | 0 |
| RETRY_REGION_GEOMETRY_OWNER | **23** |
| STAGE2_WINDOW_ENUMERATION_OWNER | 0 |
| QUERY_EVIDENCE_MAPPING_CONTRACT_OWNER | 0 |
| EVIDENCE_SELECTION_OWNER | 0 |
| STAGE2_EXECUTION_OWNER | 0 |
| UNRESOLVED | 0 |

## 6. Dominant finding — C9 RetryRegion geometry

Among the 23 cases where target evidence already exists:

- **20/23** show `R_PARTIAL_TARGET_COVERAGE` (RetryRegion overlaps but does not fully cover the evidence/target interval).
- **3/23** show `R_NO_TARGET_COVERAGE`.

C9 caseIds: p2_u001_003, p2_u001_014, p2_u002_002, p2_u002_008, p2_u002_014, p2_u002_016, p2_u002_024, p2_u002_032, p2_u002_033, p2_u002_034, p2_u002_035, p2_u003_014, p2_u003_015, p2_u003_033, p2_u004_003, p2_u004_018, p2_u004_024, p2_u004_033, p2_u004_034, p2_u005_002, p2_u005_004, p2_u005_014, p2_u005_015

Canonical example `p2_u001_014` (`纪念` / `ji|nian`):

- First-pass exact query exists: window `6:8`, observed `ji|lian` → `single:n_l` → `ji|nian`, Recall executed, evidence store holds `(6,8,ji|nian,MODEL2_CONDITIONED_FIRST_PASS)`.
- RetryRegions near the site (e.g. syllable `[2,7)`) **stop at 7**, so they do not cover `[6,8)`.
- Stage2 therefore enumerates partial slices such as `[6,7)` → mapped `ji` (SUBSPAN), never the full target key.
- Model2 is **not** the owner: correct target evidence already existed.

This matches decision **CASE E**: next owner is RetryRegion geometry (separate Model3 RETRY decision from region span derivation).

## 7. Secondary cohort — no target query in first-pass (20)

### C4 (3) — global relation over-application

Cases: p2_u001_004, p2_u003_003, p2_u004_002.

Pattern: undoing relation changes on syllables that already matched the target restores the exact target key. Example `p2_u001_004`: observed `lei|chu|li` → global `n_l` → `nei|chu|ni`; restoring the already-correct final `li` yields `nei|chu|li`.

Frozen: `MODEL2_RELATION_GLOBAL_APPLICATION = INTENTIONAL`. Do not change global application in this round.

### C5 (17) — compound / independent non-profile ASR residual

Cases: p2_u001_020, p2_u001_021, p2_u001_039, p2_u002_005, p2_u002_012, p2_u003_010, p2_u003_016, p2_u003_017, p2_u003_022, p2_u003_023, p2_u003_024, p2_u003_034, p2_u004_009, p2_u004_015, p2_u004_019, p2_u005_019, p2_u005_038.

After the selected profile relation transform, ≥1 syllable still mismatches the target for reasons outside that relation (or multi-syllable residual).

These must **not** drive RetryRegion ACP scope; they are a separate residual class.

## 8. Explicit non-findings

| Claim | Result |
| --- | --- |
| FineSpan never enumerates target-length window (C1) | **0** |
| Model2 eligibility blocks target window (C2) | **0** |
| QueryEvidence V1 emission/store contradiction (C7/C8/C13) | **0** → `QUERY_EVIDENCE_V1_REOPEN_REQUIRED=NO` |
| Stage2 window / mapper contract as first loss (C10/C11) | **0** among cases that still had evidence+region coverage |
| Target query already reached Stage2 Recall (C14) | **0** (consistent with prior QEV7 `TRUE_RECALL_INTERNAL_LOSS=0` / no exact Stage2 target key) |
| WINDOW_LENGTH 1..5 vs verbal 2..6 blocks a CORRECT_PROFILE residual via length-6 target | **Not observed** in this 43 |

## 9. ACP decision

```text
ACP_REQUIRED = POSSIBLE

Reason:
  Dominant actionable cohort C9=23 proves
  correct target-reachable evidence already exists
  + RetryRegion geometry cannot legally expose/cover it for Stage2.
  Changing RetryRegion semantics affects Model3 recovery scope → SSOT comparison / ACP gate before code change.
```

Do **not** open SUPERSPAN / resegmentation / mapper expansion from this audit: C10/C11 were not reached as first owners.

## 10. One next owner

```text
ONE_NEXT_OWNER =
RETRY_REGION GEOMETRY

ONE_NEXT_DELTA =
Frozen-SSOT audit of RetryRegion derivation vs utterance-local target-query evidence intervals
(coverage of complete target syllable geometry under RETRY); no FineSpan/Model2/mapper change in that round.
```

WRONG_PROFILE (66) excluded from this decision.

## 11. Anti-drift

FineSpan / Model2 / global relation / QueryEvidence V1 / Model3 / RetryRegion / Stage2 window enum / mapper / Tone / Lexicon / Domain Vote / budget / Assembly / KenLM / Pilot dataset / GT-in-runtime / case fixes: **all NO**.

## 12. Artifacts

1. `LINGUA_CORRECT_PROFILE_TARGET_QUERY_LIFECYCLE_AUDIT.md` (this file)
2. `LINGUA_CORRECT_PROFILE_TARGET_QUERY_CASES.csv`
3. `LINGUA_CORRECT_PROFILE_TARGET_QUERY_FUNNEL.json`
4. `LINGUA_CORRECT_PROFILE_TARGET_QUERY_OWNER_MATRIX.csv`
5. `LINGUA_CORRECT_PROFILE_TARGET_QUERY_ARCHITECTURE_MATRIX.csv`
6. `modified_file_inventory.csv`

Harness (offline only): `electron_node/electron-node/tests/audit-correct-profile-target-query-lifecycle.mjs`

---

## FINAL VERDICT

```text
PHASE =
LINGUA_CORRECT_PROFILE_TARGET_QUERY_LIFECYCLE_ATTRIBUTION_AUDIT_V1

AUDIT_VALID =
YES

EXPECTED_CASES =
43

ACTUAL_CASES =
43

OWNER_MATRIX_TOTAL =
43

PRODUCT_RUNTIME_CODE_CHANGED =
NO

GT_USED_BY_RUNTIME =
NO

GT_USED_BY_AUDIT =
YES

QUERY_EVIDENCE_V1_RUNTIME_STATUS =
PASS

QUERY_EVIDENCE_V1_REOPEN_REQUIRED =
NO

C1_TARGET_LENGTH_WINDOW_NEVER_ENUMERATED =
0

C2_TARGET_WINDOW_NOT_MODEL2_ELIGIBLE =
0

C3_MODEL2_ACTION_NOT_TARGET_REACHABLE =
0

C4_RELATION_TRANSFORM_NOT_TARGET_REACHABLE =
3

C5_COMPOUND_NON_PROFILE_ASR_ERROR =
17

C6_TARGET_QUERY_NOT_EXECUTED_FIRST_PASS =
0

C7_EXECUTED_QUERY_EVIDENCE_NOT_EMITTED =
0

C8_EVIDENCE_STORE_LIFETIME_LOSS =
0

C9_RETRY_REGION_CANNOT_COVER_TARGET_QUERY =
23

C10_STAGE2_TARGET_WINDOW_NOT_ENUMERATED =
0

C11_QUERY_EVIDENCE_GEOMETRY_CONTRACT_LIMIT =
0

C12_EVIDENCE_SELECTION_POLICY =
0

C13_STAGE2_QUERY_EXECUTION_CONTRADICTION =
0

C14_TARGET_QUERY_REACHED_STAGE2_RECALL =
0

C15_OTHER_PROVEN =
0

C16_UNRESOLVED =
0

TARGET_REACHABLE_QUERY_EVER_EXISTED_FIRST_PASS =
23/43

TARGET_REACHABLE_EVIDENCE_STORE_EXISTS =
23/43

TARGET_REACHABLE_EVIDENCE_BUT_RETRY_REGION_FAIL =
23

TARGET_REACHABLE_EVIDENCE_AND_REGION_OK_BUT_STAGE2_WINDOW_FAIL =
0

TARGET_REACHABLE_EVIDENCE_AND_STAGE2_WINDOW_OK_BUT_MAPPER_FAIL =
0

FINESPAN_WINDOW_OWNER_COUNT =
0

MODEL2_OWNER_COUNT =
0

RELATION_TRANSFORM_OWNER_COUNT =
3

COMPOUND_ASR_OWNER_COUNT =
17

QUERY_EVIDENCE_PRODUCER_OR_LIFETIME_OWNER_COUNT =
0

RETRY_REGION_GEOMETRY_OWNER_COUNT =
23

STAGE2_WINDOW_ENUMERATION_OWNER_COUNT =
0

QUERY_EVIDENCE_GEOMETRY_CONTRACT_OWNER_COUNT =
0

STAGE2_EXECUTION_OWNER_COUNT =
0

DOMINANT_PROVEN_FIRST_OWNER =
C9_RETRY_REGION_CANNOT_COVER_TARGET_QUERY

DOMINANT_PROVEN_FIRST_OWNER_COUNT =
23

DOMINANT_ARCHITECTURAL_BOUNDARY =
RETRY_REGION_GEOMETRY

MODEL2_CHANGE_REQUIRED =
NO

FINESPAN_CHANGE_REQUIRED =
NO

RETRY_REGION_CHANGE_REQUIRED =
NOT_PROVEN

STAGE2_GEOMETRY_CHANGE_REQUIRED =
NO

QUERY_EVIDENCE_CONTRACT_CHANGE_REQUIRED =
NO

ARCHITECTURE_CONFLICT_FOUND =
YES

ACP_REQUIRED =
POSSIBLE

ONE_NEXT_OWNER =
RETRY_REGION GEOMETRY

ONE_NEXT_DELTA =
Frozen-SSOT audit of RetryRegion derivation vs utterance-local target-query evidence intervals (full syllable coverage under RETRY); no FineSpan/Model2/mapper change in that round.
```
