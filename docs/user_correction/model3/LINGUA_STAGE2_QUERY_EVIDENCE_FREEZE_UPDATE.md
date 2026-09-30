# LINGUA Stage2 Query Evidence Freeze Update

| Field | Value |
|---|---|
| Phase | `LINGUA_STAGE2_QUERY_EVIDENCE_FREEZE_AND_EXACT_ATTRIBUTION` / PHASE_A |
| Date | 2026-09-15 |
| Mode | FREEZE_PROVEN_FACTS only |
| Product runtime | **NO CHANGE** |

---

## EVIDENCE_ALIGNMENT_CORRECTION

The prior audit `LINGUA_STAGE2_QUERY_PROVENANCE_AUDIT.md` lifecycle conclusion remains **VALID**:

- Model2-conditioned transformed query exists call-locally
- Lost at `materializeProfileHits`
- Stage2 rebuilds from ASR `globalSyllables`
- Stage2 cannot see first-pass transformed query

**Correction:** quantitative Q1 / E5 reachability counts were joined at **CASE** level (Gate-E `queryLegallyMatchesTarget` / reason text) to a **different** Model2 window’s `chosenQueries` / `transformedPinyinChosen`.

Proven misjoin pattern (Gate-E classification):

| caseId | chosenQueries.pinyin_key | reason claims matched | targetPinyin |
|---|---|---|---|
| p2_u001_007 | `tan\|nei` | `nei\|ke` | `nei\|ke` |

Across CORRECT_PROFILE E5=35: only **12/35** have chosen-query pinyin exact/subspan-equal to target; **23/35** are case-level joins.

Therefore:

```text
ARCHITECTURE_FACTS_FROZEN = YES
Q1_COUNT_FROZEN = NO
E5_FIRST_PASS_TRANSFORM_TARGET_REACHABLE = PROVISIONAL (not exact-window)
Q1_MODEL2_QUERY_EVIDENCE_LOST = 33 = PROVISIONAL
ACP_READY = NO
STAGE2_QUERY_EVIDENCE_PRESERVATION_ACP = NOT_READY
```

---

## PROVEN_ARCHITECTURE_FACT (frozen)

### Query lifecycle

| Fact | Status |
|---|---|
| MODEL2_TRANSFORMED_QUERY_EXISTS | **PROVEN** (call-local: querySyllables, pinyinKey, origin window geometry; may include action/nChanged) |
| FIRST_TRANSFORMED_PINYIN_LOSS_BOUNDARY | `candidate-materialize.ts::materializeProfileHits` |
| FIRST_QUERY_KEY_LOSS_BOUNDARY | same |
| FIRST_CHANGED_POSITION_LOSS_BOUNDARY | relation-lexicon-adapter call-local; no persisted `changedPositions` |
| FIRST_WINDOW_GEOMETRY_LOSS_BOUNDARY | **NOT_LOST_ON_CANDIDATE**; Stage2 rebuilds new ASR windows |

### Stage2

| Fact | Status |
|---|---|
| CURRENT_STAGE2_QUERY_PINYIN_SOURCE | ASR `globalSyllables` slice |
| CURRENT_STAGE2_QUERY_GEOMETRY_SOURCE | SHARED_LEXICAL_WINDOW_OWNER clipped to RetryRegion |
| CURRENT_STAGE2_CAN_SEE_MODEL2_TRANSFORMED_QUERY | **NO** |
| CURRENT_STAGE2_CAN_SEE_FIRST_PASS_RECALL_QUERY | **NO** |

### SSOT

| Fact | Status |
|---|---|
| QUERY_EVIDENCE_LIFETIME_SSOT | **NOT_SPECIFIED** (CONTRACT GAP) |
| QUERY_EVIDENCE_RETRY_CONSUMER_SSOT | **NO** |
| CURRENT_STAGE2_ASR_QUERY_POLICY_AUTHORITY | **DERIVED_FROM_RESEGMENTATION_DESIGN** |
| MODEL2_ON_MODEL3_RETRY | **NO / ACTIVE SSOT** |
| CURRENT_BEHAVIOR | **NOT IMPLEMENTATION DRIFT** |

### Closed architecture (do not reopen)

MODEL2_INSERTION=PRE_LEXICAL_EDGE · MODEL2_ON_MODEL3_RETRY=NO · MODEL3 KEEP/RETRY + INPUT unchanged · FIRST_PASS Tone exact · Stage2 Tone-relax CLOSED · Domain-bounded Stage2 CLOSED · Domain Vote on Retry=NO · Anchor=PROFILE_PRONUNCIATION only · shared budget / SameDomain / Assembly / KenLM unchanged · Lexicon engine miss not current proven owner.

---

## PROVISIONAL → CONFIRMED (Phase C)

| Item | Prior | After exact-invocation audit |
|---|---|---|
| Q1_MODEL2_QUERY_EVIDENCE_LOST | 33 PROVISIONAL | **Q1_CONFIRMED = 33** (frozen) |
| E5 first-pass transform target-reachable | 35 PROVISIONAL | **E5-A = 35** (exact-window proven) |
| QUERY_EVIDENCE_NATURAL_OWNER | provisional RECALL | **RECALL** (HIGH) |
| DIRECT_QUERY_REUSE_GEOMETRY_SAFE | PARTIAL | **PARTIAL** (EXACT=5, SUBSPAN=27, RESEGMENT=1) |
| LOCAL_FIX / ACP | NOT_READY | **ACP_READY=YES**, **ACP_REQUIRED=YES** (draft next; not implemented) |

Q2/Q6 remain provisional prior classifications (`FULL_257_RECONCILIATION_NECESSARY=NO`).

Authority: `LINGUA_FIRST_PASS_QUERY_WINDOW_ATTRIBUTION_AUDIT.md`, `LINGUA_QUERY_ATTRIBUTION_SSOT_CHECK.json`.

---

## Phase A+C gate

```text
PHASE_A_FREEZE = PASS
ARCHITECTURE_FACTS_FROZEN = YES
Q1_COUNT_FROZEN = YES
ACP_READY = YES
ACP_REQUIRED = YES
ONE_NEXT_OWNER = STAGE2_QUERY_EVIDENCE_PRESERVATION_ACP
```
