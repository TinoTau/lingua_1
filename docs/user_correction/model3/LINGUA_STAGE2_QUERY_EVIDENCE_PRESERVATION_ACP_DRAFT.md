# LINGUA-ACP-STAGE2-QUERY-EVIDENCE-PRESERVATION-V1 (DRAFT — SUPERSEDED)

> **SUPERSEDED** by `LINGUA_STAGE2_QUERY_EVIDENCE_PRESERVATION_ACP_V1_FROZEN.md`  
> (APPROVED / FROZEN with two user contract corrections).  
> Do not use this draft as SSOT.

| Field | Value |
|---|---|
| ACP ID | `LINGUA-ACP-STAGE2-QUERY-EVIDENCE-PRESERVATION-V1` |
| Date | 2026-09-15 |
| Status | **SUPERSEDED** |

---

## 0. Decision summary (one paragraph)

Approve a **Recall-owned**, pipeline-local `RecallQueryEvidence` lifetime that preserves the **semantic transformed `pinyinKey` + syllable/raw geometry** of each first-pass Model2-conditioned Recall invocation; on Model3 RETRY, Stage2 maps evidence to each Stage2 window by **deterministic syllable geometry (EXACT + SUBSPAN-slice only)** and **replaces** that window’s ASR pinyin query when a legal mapping exists. No Model2 rerun, no Model3 contract change, no JobResult fields, no second Recall pipeline, no Domain/Anchor/Budget/SameDomain/Assembly/KenLM change. **RESEGMENT / DISJOINT** geometries are **deferred** (1 confirmed Q1: `p2_u005_011`).

```text
ACP_OPTION_SELECTED = A
ACP_STATUS = DRAFT_FOR_USER_APPROVAL
IMPLEMENTATION_ALLOWED = NO
```

---

## 1. Contract gap (accepted; not reopened)

```text
Model2-conditioned first-pass Recall
  → transformed pinyin query (call-local)
  → recallSpanTopKV2
  → materializeProfileHits  ← FIRST_TRANSFORMED_PINYIN_LOSS_BOUNDARY
  → candidate keeps ASR windowPinyinKey

Model3 RETRY
  → Stage2 windows (SHARED_LEXICAL_WINDOW_OWNER ∩ RetryRegion)
  → globalSyllables.slice → ASR pinyin
  → Tone-relaxed domain-bounded Recall
```

```text
CONTRACT_GAP_CONFIRMED = YES
QUERY_EVIDENCE_LIFETIME_SSOT = NOT_SPECIFIED (today)
CURRENT_STAGE2_CAN_SEE_MODEL2_TRANSFORMED_QUERY = NO
Q1_CONFIRMED = 33
E5_A = 35/35
TRUE_LEXICON_ENGINE_MISS_COUNT = 0
```

---

## 2. BEFORE / AFTER

### BEFORE

```text
Model2 → transformed query → Recall → materialize → query evidence LOST
…
Model3 RETRY → Stage2 → ASR globalSyllables → Recall
```

### AFTER (proposed)

```text
Model2 → transformed query → Recall
       → emit RecallQueryEvidence{pinyinKey, geometry, source}
       → normal candidate materialize (unchanged)

…
Model3 RETRY (KEEP/RETRY semantics unchanged; Model3 does not read evidence)
  → Stage2 window
  → mapEvidenceToStage2Window (EXACT | SUBSPAN slice | none)
  → if mapped: use mapped pinyinKey
    else: ASR pinyin (current)
  → existing Stage2 Tone-relaxed + retainedDomains Recall
  → MERGE_SHARED_BUDGET unchanged
```

Forbidden flow:

```text
Model2 evidence → Model3 → Model3 chooses query   ✗
```

---

## 3. Ownership (confirmed)

| Role | Owner |
|---|---|
| Semantic query pinyin + geometry | **RECALL** |
| How query was produced | Model2 (internal; not exposed) |
| Whether Retry is requested | Model3 KEEP/RETRY only |
| Whether preserved query maps to current Stage2 window | Stage2 Recall consumer |

```text
QUERY_EVIDENCE_OWNER = RECALL
QUERY_EVIDENCE_PRODUCER = first-pass Model2-conditioned Recall invocation
                          (only queries that actually enter recallSpanTopKV2)
QUERY_EVIDENCE_CONSUMER = Stage2 Retry Recall query construction
QUERY_EVIDENCE_CARRIER = utterance/pipeline-local typed evidence store
                         (NOT JobResult; NOT UserProfile)
```

No new `Model2RetryEvidenceService` / `Model3QueryService` / second Recall pipeline.

---

## 4. Scope: UTTERANCE_WINDOW (not PATH)

Model2 insertion SSOT = **AUG12_PRE_LEXICAL_EDGE**: expansion runs once on shared lexical windows **before** LexicalEdge / path enumeration (`lattice-fine-span-runtime.ts`).

Therefore:

```text
QUERY_EVIDENCE_SCOPE = UTTERANCE_WINDOW
CROSS_PATH_REUSE_ALLOWED = YES (same utterance geometry + same pinyinKey)
```

Path isolation still applies to **domain context**:

- Evidence does **not** carry `domainIds`.
- Stage2 continues to pass **path-local** `retainedDomains` into `recallSpanTopKV2`.
- Evidence must not invent cross-path domain leakage.

Isolation / dedup key:

```text
(syllableStart, syllableEnd, pinyinKey, source)
```

---

## 5. Minimum semantic fields (audited)

| Field | Verdict | Rationale |
|---|---|---|
| `pinyinKey` | **REQUIRED** | Semantic Recall query |
| `syllableStart` / `syllableEnd` | **REQUIRED** | Geometry authority for EXACT/SUBSPAN |
| `rawStart` / `rawEnd` | **REQUIRED** | Consistency check with Stage2 locals; secondary |
| `source` | **REQUIRED** | Closed taxonomy only (below) |
| `querySyllables` | **DERIVABLE** | `pinyinKey.split('|')`; optional cache |
| `originSpanId` / `windowId` | **OPTIONAL** | Join/debug; not mapping semantics |
| `candidate term` / `termId` | **FORBIDDEN** | Evidence ≠ candidate survival |
| `relation` / `nChanged` / `changedPositions` | **FORBIDDEN** | Model2 internals |
| Model2 action id / logits | **FORBIDDEN** | Model2 internals |
| Tone pattern | **FORBIDDEN** for Stage2 reuse | Stage2 already Tone-relaxed |
| `domainIds` | **FORBIDDEN** on evidence | Path retainedDomains remain consumer-side |

```text
source ∈ { MODEL2_CONDITIONED_FIRST_PASS }
```

Stage2 must **not** branch on relation type.

---

## 6. Lifetime

| Phase | Rule |
|---|---|
| **Creation** | When a Model2-conditioned semantic query is **executed** by first-pass Recall (not merely Model2 logits) |
| **Persistence** | Same Node utterance pipeline until Stage2 Retry query construction completes for that utterance |
| **Carrier** | Pipeline-local typed store hung off existing lattice/runtime context passed into Model3 Retry / Stage2 |
| **Cross-service** | **NO** |
| **JobResult** | **NO** (`JOBRESULT_CHANGE_REQUIRED = NO`) |
| **UserProfile** | **NO** |
| **Destruction** | After Stage2 Retry for the utterance completes, or path/utterance pipeline terminates |
| **Candidate coupling** | **NONE** — evidence means “this pronunciation query was legally generated and executed”, not “a candidate still survives budget” |

```text
CANDIDATE_SURVIVAL_REQUIRED_FOR_EVIDENCE_REUSE = NO
QUERY_EVIDENCE_LIFETIME = UTTERANCE_PIPELINE_TRANSIENT
```

---

## 7. Geometry contract (see companion doc)

Authority: **syllable offsets** on the shared `globalSyllables` index. Raw offsets must agree when both present; on conflict, **syllable wins**.

| Mapping | V1 |
|---|---|
| EXACT | **YES** — identical `[sylStart,sylEnd)` |
| SUBSPAN | **YES** — evidence **CONTAINS** Stage2; slice `pinyinKey` by syllable index |
| SUPERSPAN (Stage2 contains evidence) | **NO** — not required by Q1 (0/33 CONTAINED) |
| PARTIAL_OVERLAP | **NO** |
| DISJOINT / RESEGMENT | **DEFERRED** |

Q1 geometry fact (exact attribution matrix):

| Class | Count | Notes |
|---|---|---|
| EXACT | 5 (best) / 12 cases have ≥1 EXACT among reachable | |
| SUBSPAN (= CONTAINS) | **27/27** best SUBSPAN are evidence⊇Stage2 | slice-safe |
| CONTAINED (Stage2⊇evidence) | **0** | superspan not needed |
| DISJOINT | 1 case (`p2_u005_011`) all 48 reachable vs Stage2 | RetryRegion coverage gap |

```text
RESEGMENT_CASE_POLICY = DEFERRED
KNOWN_UNRECOVERED_Q1 = 1 (p2_u005_011)
Q1_EXPECTED_TOTAL_COVERAGE = 32/33
```

Full rules + pseudocode: `LINGUA_STAGE2_QUERY_EVIDENCE_GEOMETRY_CONTRACT.md`.

---

## 8. Multiple evidence conflict (ACP decision)

```text
MULTIPLE_EVIDENCE_POSSIBLE = YES
MULTIPLE_EVIDENCE_CONFLICT_POLICY = ACP_DECISION (no prior SSOT)
```

Deterministic selection for one Stage2 window:

1. Prefer **EXACT** matches over SUBSPAN.
2. Among SUBSPAN: prefer **smallest** containing evidence (`sylEnd-sylStart` ascending).
3. Tie-break: `syllableStart` asc → `syllableEnd` asc → `pinyinKey` lexicographic.

**Forbidden:** emit all mapped evidences as parallel queries / combinatorial candidate expansion.

---

## 9. Stage2 query selection policy

```text
STAGE2_EVIDENCE_POLICY = REPLACE_IF_MAPPED_ELSE_ASR
PRESERVED_QUERY_REPLACES_ASR_QUERY = YES
PRESERVED_QUERY_ADDS_SECOND_QUERY = NO
```

Rationale:

- Dual query would add DB invocations and candidate pressure under frozen `MERGE_SHARED_BUDGET`.
- ASR query is the defective signal when mapped evidence exists.
- Single-query keeps Stage2 window count and Recall pipeline cardinality unchanged.

---

## 10. Closed boundaries (unchanged)

```text
MODEL2_INSERTION = PRE_LEXICAL_EDGE
MODEL2_ON_MODEL3_RETRY = NO
MODEL3 = KEEP/RETRY trigger only; no transformed pinyin; no Model2 internals
FIRST_PASS_TONE = PINYIN + TONE EXACT
STAGE2 = model3_retry_pinyin_domain_recovery (CLOSED)
DOMAIN_BOUNDED_STAGE2 = CLOSED; DOMAIN_VOTE_ON_RETRY = NO
ANCHOR = PROFILE_PRONUNCIATION only
RETRY budget / SameDomain / Assembly / KenLM / scoring / caps = UNCHANGED
```

Explicitly rejected: Model2 rerun; reconstruct Model2 transform on Retry; Model3 feature/training change; GT/target-aware queries; all-domain fallback; fuzzy pinyin search; second Recall pipeline; JobResult fields; reserved slots; Tone first-pass weakening.

---

## 11. WRONG_PROFILE / compound / regression controls

| Control | ACP stance |
|---|---|
| WRONG_PROFILE | May legally reuse wrong profile-conditioned queries — **architecturally correct**. No profile-confidence gate. Downstream Assembly/KenLM compete. No Anchor privilege for preserved query. |
| Compound residual (换乘/翻成, 牛肉串/刘若川, 礼宾员 class) | Remain **Q2/Q6** when first-pass transform is not target-reachable. ACP **does not** fabricate target queries. `COMPOUND_RESIDUAL_SCOPE_EXPANDED = NO` |
| Prior Stage2 Tone-relax regressions | Risk: REPLACE may increase competition when wrong evidence maps. Record only; **no** budget/ranking change in this ACP. |

```text
WRONG_PROFILE_SPECIAL_GATE_ADDED = NO
```

---

## 12. Performance (static)

| Question | Answer |
|---|---|
| Extra Model2 inference? | **NO** |
| Extra Stage2 windows? | **NO** |
| Second Recall pipeline? | **NO** |
| Extra DB query per window? | **NO** (REPLACE, not ADDITIONAL) |
| Candidate count? | Unchanged cardinality of invocations; hit set may change (intended) |
| Memory | O(#Model2-conditioned first-pass queries) per utterance; transient |

```text
EXTRA_DB_QUERY_REQUIRED = NO
EXTRA_STAGE2_WINDOW_REQUIRED = NO
SECOND_RECALL_PIPELINE_REQUIRED = NO
```

---

## 13. Decision matrix summary

| Option | Verdict |
|---|---|
| **A. Preserve + EXACT/SUBSPAN only** | **SELECTED** |
| B. + general RESEGMENT mapping | Rejected — 1 DISJOINT case is RetryRegion coverage, not slice mapping |
| C. Reconstruct Model2 transform on Retry | Rejected — Model2 coupling / second inference risk |
| D. Rerun Model2 on Retry | Rejected — violates `MODEL2_ON_MODEL3_RETRY=NO` |
| E. Keep ASR-only Stage2 | Rejected — leaves confirmed Q1 contract gap |

See `LINGUA_STAGE2_QUERY_EVIDENCE_DECISION_MATRIX.csv`.

---

## 14. Conceptual type (not implemented)

```ts
type RecallQueryEvidenceSource = 'MODEL2_CONDITIONED_FIRST_PASS';

interface RecallQueryEvidence {
  pinyinKey: string;       // syllable-aligned, '|' joined
  syllableStart: number;   // inclusive
  syllableEnd: number;     // exclusive
  rawStart: number;
  rawEnd: number;
  source: RecallQueryEvidenceSource;
}
```

```text
owner = RECALL
producer = first-pass Model2-conditioned Recall invocation
carrier = utterance pipeline-local store
consumer = Stage2 Retry query construction
lifetime = until Stage2 Retry completes / utterance ends
scope = UTTERANCE_WINDOW
dedup identity = (syllableStart, syllableEnd, pinyinKey, source)
geometry authority = syllable offsets (raw secondary)
```

---

## 15. Approval boundary

```text
ACP_STATUS = DRAFT_FOR_USER_APPROVAL
IMPLEMENTATION_ALLOWED = NO
```

User approval required before:

```text
ONE_NEXT_OWNER = PREDEVELOPMENT_CODE_AUDIT
ONE_NEXT_DELTA = Locate exact producer/carrier/consumer touchpoints for RecallQueryEvidence
                 emission + Stage2 REPLACE mapping; still no product semantic change until
                 a separate implementation ACP gate.
```

---

## 16. Final field block

```text
BASELINE_IDENTITY = LINGUA_RUNTIME_FREEZE_POST_STAGE2_TONE_RELAX_V1
                    + LINGUA_FIRST_PASS_QUERY_WINDOW_ATTRIBUTION_AUDIT (2026-09-15)

CONTRACT_GAP_CONFIRMED = YES
QUERY_EVIDENCE_OWNER = RECALL
QUERY_EVIDENCE_SCOPE = UTTERANCE_WINDOW
QUERY_EVIDENCE_PRODUCER = FIRST_PASS_MODEL2_CONDITIONED_RECALL_INVOCATION
QUERY_EVIDENCE_CARRIER = PIPELINE_LOCAL_TYPED_STORE
QUERY_EVIDENCE_CONSUMER = STAGE2_RETRY_RECALL_QUERY_CONSTRUCTION
QUERY_EVIDENCE_LIFETIME = UTTERANCE_PIPELINE_TRANSIENT

MINIMUM_REQUIRED_FIELDS = pinyinKey, syllableStart, syllableEnd, rawStart, rawEnd, source
FORBIDDEN_MODEL2_INTERNAL_FIELDS = relation, nChanged, changedPositions, actionId, logits,
                                   Tone, candidate/termId, domainIds

GEOMETRY_AUTHORITY = SYLLABLE_OFFSETS (raw secondary; syllable wins on conflict)
EXACT_MAPPING_SUPPORTED = YES
SUBSPAN_MAPPING_SUPPORTED = YES (evidence CONTAINS Stage2 only)
SUPERSPAN_MAPPING_SUPPORTED = NO
PARTIAL_OVERLAP_MAPPING_SUPPORTED = NO
RESEGMENT_MAPPING_SUPPORTED = NO
RESEGMENT_CASE_POLICY = DEFERRED (p2_u005_011; RetryRegion DISJOINT coverage)

MULTIPLE_EVIDENCE_POSSIBLE = YES
MULTIPLE_EVIDENCE_CONFLICT_POLICY = EXACT > smallest-CONTAINS > (sylStart,sylEnd,pinyinKey)

CROSS_PATH_REUSE_ALLOWED = YES (utterance-window evidence; domains remain path-local)
CANDIDATE_SURVIVAL_REQUIRED_FOR_EVIDENCE_REUSE = NO

STAGE2_EVIDENCE_POLICY = REPLACE_IF_MAPPED_ELSE_ASR
PRESERVED_QUERY_REPLACES_ASR_QUERY = YES
PRESERVED_QUERY_ADDS_SECOND_QUERY = NO

MODEL2_SECOND_INFERENCE_REQUIRED = NO
MODEL2_CHANGE_REQUIRED = NO (emission only at existing Recall boundary; no relation redesign)
MODEL3_CHANGE_REQUIRED = NO
MODEL3_CONTRACT_CHANGE_REQUIRED = NO
MODEL2_INTERNAL_LEAK_REQUIRED = NO
JOBRESULT_CHANGE_REQUIRED = NO

TONE_CHANGE_REQUIRED = NO
LEXICON_CHANGE_REQUIRED = NO
DOMAIN_CHANGE_REQUIRED = NO
ANCHOR_CHANGE_REQUIRED = NO
RETRY_BUDGET_CHANGE_REQUIRED = NO
SAMEDOMAIN_CHANGE_REQUIRED = NO
ASSEMBLY_CHANGE_REQUIRED = NO
KENLM_CHANGE_REQUIRED = NO

EXTRA_DB_QUERY_REQUIRED = NO
EXTRA_STAGE2_WINDOW_REQUIRED = NO
SECOND_RECALL_PIPELINE_REQUIRED = NO

Q1_CONFIRMED = 33
Q1_EXACT_COVERED = 5 (best-class) / ≥12 cases have EXACT candidate
Q1_SUBSPAN_COVERED = 27
Q1_RESEGMENT_COVERED = 0 (deferred)
Q1_EXPECTED_TOTAL_COVERAGE = 32/33

COMPOUND_RESIDUAL_SCOPE_EXPANDED = NO
WRONG_PROFILE_SPECIAL_GATE_ADDED = NO

ACP_OPTION_SELECTED = A
ACP_STATUS = DRAFT_FOR_USER_APPROVAL
IMPLEMENTATION_ALLOWED = NO

ONE_NEXT_OWNER = PREDEVELOPMENT_CODE_AUDIT
ONE_NEXT_DELTA = Map producer/carrier/consumer touchpoints for RecallQueryEvidence
                 emission + Stage2 EXACT/SUBSPAN REPLACE; no implementation yet.
```
