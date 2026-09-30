# LINGUA-ACP-STAGE2-QUERY-EVIDENCE-PRESERVATION-V1 — APPROVED / FROZEN

| Field | Value |
|---|---|
| ACP ID | `LINGUA-ACP-STAGE2-QUERY-EVIDENCE-PRESERVATION-V1` |
| Date frozen | 2026-09-15 |
| Status | **APPROVED / FROZEN** |
| Implementation status | **NOT_STARTED** |
| Option | **A** (EXACT + SUBSPAN only) |
| Baseline freeze | `LINGUA_RUNTIME_FREEZE_POST_STAGE2_TONE_RELAX_V1` |
| Attribution | `LINGUA_FIRST_PASS_QUERY_WINDOW_ATTRIBUTION_AUDIT.md` |
| Draft superseded | `LINGUA_STAGE2_QUERY_EVIDENCE_PRESERVATION_ACP_DRAFT.md` |

```text
ACP_STATUS = APPROVED / FROZEN
IMPLEMENTATION_STATUS = NOT_STARTED
ACP_DECISION = APPROVED_WITH_TWO_CONTRACT_CORRECTIONS
```

---

## User-approved contract corrections (authoritative)

### Correction #1 — Geometry fail-closed

```text
GEOMETRY_AUTHORITY = SYLLABLE_OFFSETS
RAW_OFFSETS = SECONDARY_CONSISTENCY_GUARD
ON_RAW_VS_SYLLABLE_CONFLICT = REJECT_EVIDENCE_MAPPING_AND_FALLBACK_TO_ASR
```

If syllable relation appears legal but raw geometry is inconsistent: **mapping = NONE → ASR**. Never prefer syllable and continue.

### Correction #2 — Path ownership wording

```text
QUERY_EVIDENCE_SCOPE = UTTERANCE_WINDOW
QUERY_EVIDENCE_PATH_OWNERSHIP = NONE
EVIDENCE_VISIBILITY = ALL_PATHS_OF_SAME_UTTERANCE
DOMAIN_CONTEXT = PATH_LOCAL_RETAINED_DOMAINS
CROSS_UTTERANCE_REUSE = NO
```

**Supersedes** draft `CROSS_PATH_REUSE_ALLOWED = YES`.

Evidence is utterance lexical-window evidence produced **before** LexicalEdge/path enumeration — not “Path A reused by Path B”.

---

## Frozen decision (unchanged except above)

```text
ACP_OPTION_SELECTED = A
QUERY_EVIDENCE_OWNER = RECALL
MAPPING_V1 = EXACT + SUBSPAN
SUPERSPAN = NO
PARTIAL_OVERLAP = NO
DISJOINT = NO
RESEGMENT_MAPPING = DEFERRED
KNOWN_UNRECOVERED_Q1 = 1 (p2_u005_011)
EXPECTED_Q1_COVERAGE = 32/33

STAGE2_QUERY_POLICY = REPLACE_IF_MAPPED_ELSE_ASR
PRESERVED_QUERY_ADDS_SECOND_QUERY = NO

MODEL2_SECOND_INFERENCE = NO
MODEL3_CHANGE = NO
JOBRESULT_CHANGE = NO
SECOND_RECALL_PIPELINE = NO

CANDIDATE_SURVIVAL_REQUIRED_FOR_EVIDENCE_REUSE = NO
```

### Semantic type (conceptual)

```ts
type RecallQueryEvidenceSource = 'MODEL2_CONDITIONED_FIRST_PASS';

interface RecallQueryEvidence {
  pinyinKey: string;
  syllableStart: number; // half-open [start, end)
  syllableEnd: number;
  rawStart: number;
  rawEnd: number;
  source: RecallQueryEvidenceSource;
}
```

Identity: `(syllableStart, syllableEnd, pinyinKey, source)` — raw is consistency guard only.

Forbidden on evidence: relation, nChanged, changedPositions, logits, action id, Tone, candidate/termId, domainIds, GT.

### Conflict policy

```text
EXACT > smallest CONTAINS SUBSPAN > sylStart asc > sylEnd asc > pinyinKey lex
→ at most ONE query per Stage2 window
```

### Closed architecture (do not reopen)

Model2 pre-LexicalEdge · MODEL2_ON_MODEL3_RETRY=NO · Model3 KEEP/RETRY only · Stage2 Tone-relax CLOSED · Domain-bounded Stage2 CLOSED · Domain Vote on Retry=NO · Anchor PROFILE_PRONUNCIATION only · MERGE_SHARED_BUDGET · SameDomain/Assembly/KenLM unchanged.

---

## Companion geometry contract

Authoritative geometry detail (with corrections):  
`LINGUA_STAGE2_QUERY_EVIDENCE_GEOMETRY_CONTRACT.md`

---

## Next gate

```text
ONE_NEXT_OWNER = (after predev PASS) STAGE2_QUERY_EVIDENCE_PRESERVATION_V1_IMPLEMENTATION
Implementation requires separate predev PASS + user gate.
This freeze document alone does NOT authorize code changes.
```
