# collectBaseOnlySingleCharCandidate — exact decision tree

**Date:** 2026-08-18  
**Source of truth:** `electron_node/electron-node/main/src/lexicon-v2/recall-span-topk-v2.ts`  
**Classification:** `SINGLE_CHAR_COLLECTOR_TRACE_V1` (`single-char-collector-trace.ts`)  
**This round:** observation only. No frozen-semantics change.

Entry: `recallSpanTopKV2` when `syllables.length === 1`. Domain ids forced empty by the window loop. Fuzzy forced false. `topK` capped at 1.

```
window created (Lattice 1-syllable window)
  │
  ├─ HARD BLOCKED (latticeHardBlockFilter)
  │     → no collector call
  │     → terminal SQL_NOT_EXECUTED (blocked=true)
  │
  └─ recallTopKForWindows
        └─ collectBaseOnlySingleCharCandidate
```

## Accept paths (real code)

1. **ACCEPT_UNIQUE_TONE_EXACT**  
   tone ready AND eligible tone-exact rows == 1 AND fetch not truncated (returned < LIMIT 8) AND score ≥ `minCandidateScore` (default 0).  
   Surface need not equal `windowText`.

2. **ACCEPT_SURFACE_EXACT**  
   uniqueness failed (eligible > 1, or truncated singleton) then unique `word === windowText.trim()` on the visible page (`pickUniqueSurfaceExact`) **or** independent `lookupBaseByExactSurfacePinyinAndTone` identity (tone-exact only, no plain). Then score ≥ min.

There is no homophone Top1 accept. There is no expectedText accept.

## Tree

```
IF syllables.length !== 1
  → NOT_APPLICABLE_WINDOW_LENGTH     [caller; collector not used]
IF pinyinKey empty
  → NO_QUERY_KEY                     [IMPLEMENTATION_DETAIL / SAFETY]

resolveToneRecallReadiness (CR 1.0.8 / 1.1C)
  order: caller_disabled → runtime_unsupported → no_pattern → invalid_pattern → ready
  IF state !== ready
    SQL is NOT executed
    IF state == no_pattern → NO_TONE_PATTERN          [FROZEN_REQUIRED 1.1C]
    ELSE               → TONE_READINESS_NOT_READY     [FROZEN_REQUIRED 1.1C]
    return null

tonePinyinKey := readiness.tonePinyinKey
SQL1: lookupBaseByPinyinAndToneKey(pinyinKey, tonePinyinKey, termLength=1, LIMIT=8)
  [FROZEN_REQUIRED: base-only exact tone]
eligible := filter: enabled AND word.length==1 AND not alias AND priorScore>0
truncated := returnedCount >= 8                         [FROZEN_REQUIRED CR 1.0.4]

resolveLength1BaseCandidate(eligible, windowText, truncated)
  IF eligible.length == 0 → chosen = null
  IF eligible.length == 1 AND truncated → chosen = null   [FROZEN_REQUIRED uniqueness]
  IF eligible.length == 1 AND not truncated → chosen = that row
  IF eligible.length > 1 → pickUniqueSurfaceExact(word === windowText)

IF chosen is null
  SQL2: lookupBaseByExactSurfacePinyinAndTone(pinyin, tone, surface=windowText, LIMIT=1)
        [FROZEN_REQUIRED 1.1B/1.1C; only when ambiguity yielded no Candidate]
  IF eligible identity rows !== 1 OR word !== surface → chosen = null

IF chosen
  scoreLength1BaseHit (domains=[], repairTarget=false, kind=exact_base)
  IF candidateScore < minCandidateScore → hit = null     [SAFETY_CAP; default 0]
  ELSE return Candidate (cap=1)

IF hit present
  unique_tone_exact → ACCEPT_UNIQUE_TONE_EXACT
  page_surface_exact | identity_surface_exact → ACCEPT_SURFACE_EXACT

ELSE (explicit reject, mutually exclusive terminal)
  MIN_SCORE_REJECT
  SQL_NOT_EXECUTED
  SQL_NO_HIT
  INVALID_ROW                    (raw SQL rows, 0 eligible)
  LIMIT_TRUNCATION_REJECT        (full page, residual singleton)
  NORMALIZATION_SURFACE_MISMATCH (raw≠canonical AND canonical surface in SQL hits)
  MULTIPLE_TONE_EXACT_CANDIDATES
  SURFACE_EXACT_MISS
  NO_TONE_EXACT_CANDIDATE
  OTHER_REJECT
```

## Condition → freeze class

| Condition | Class |
|-----------|--------|
| length===1 branch, skip 2–5 tier/fuzzy | FROZEN_REQUIRED |
| base-only / no domain | FROZEN_REQUIRED |
| exact-only / no fuzzy | FROZEN_REQUIRED |
| cap=1 | FROZEN_REQUIRED |
| Mandatory Tone Recall fail-closed | FROZEN_REQUIRED |
| unique-only; no Top1 | FROZEN_REQUIRED |
| LIMIT=8 truncation ≠ unique | FROZEN_REQUIRED |
| surface exact = `word === windowText` (ASR), not expectedText | FROZEN_REQUIRED |
| identity lookup only after uniqueness fail; tone-exact only | FROZEN_REQUIRED |
| `repairTarget=false`, empty domains on hit | FROZEN_REQUIRED |
| eligible filter (enabled / len1 / not alias / prior>0) | IMPLEMENTATION_DETAIL |
| `minCandidateScore` (default 0) | SAFETY_CAP |
| OpenCC canonical field on trace | TRACE_ONLY (lookup still uses raw `windowText`) |
| `NORMALIZATION_SURFACE_MISMATCH` overlay | TRACE_ONLY (does not change accept) |
| SQL LIMIT comment vs identity LIMIT=1 | HISTORICAL comment drift; live identity uses LIMIT=1 |

No `UNJUSTIFIED_FILTER` found that changes accept/reject versus the frozen CR. Hidden observation overlay: script-mismatch class, which does not alter the returned Candidate.
