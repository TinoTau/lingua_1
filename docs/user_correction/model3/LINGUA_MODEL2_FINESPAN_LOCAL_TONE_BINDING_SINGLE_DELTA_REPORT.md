# LINGUA_MODEL2_FINESPAN_LOCAL_TONE_BINDING_SINGLE_DELTA — Report

**Phase:** `LINGUA_MODEL2_FINESPAN_LOCAL_TONE_BINDING_SINGLE_DELTA`  
**Mode:** SINGLE DELTA / BUG FIX / NO RETRAIN / NO LEXICON / NO SPAN REDESIGN  

---

## 1. Change

### Removed (architecture drift)

```text
span-assembly-v4-orchestrator.ts
  first non-empty FineSpan.toneRebindTrace.acousticTonePattern
  → shared path-level arg into expandActiveCandidatesWithModel2
```

### Restored

```text
for each FineSpan:
  span.toneRebindTrace.acousticTonePattern
  → that FineSpan's executeProfileLexiconQueries / Tone-first P recall
```

| File | Delta |
|------|--------|
| `span-assembly-v4-orchestrator.ts` | Stop path-level `tonePat` / `acousticTonePattern` pass-through |
| `expand-active-candidates.ts` | Per-span local tone; TRACE fields `tone_pattern_source`, `fineSpan_local_tone_pattern` |
| `finespan-local-tone-binding.freeze.test.ts` | Freeze: no first-pattern reuse |
| `LINGUA_DIALOG2000_V2_PILOT200_SSOT.md` | `MODEL2_FUTURE_TONE_COMPATIBILITY_RULE` frozen |

Test harness only: if a **single** FineSpan has no `toneRebindTrace`, optional `args.acousticTonePattern` may apply (`TEST_HARNESS_FALLBACK`). Production orchestrator never passes it.

---

## 2. Decisive case — `p2_u001_004`

| Field | Before (path-shared) | After (FineSpan-local) |
|-------|----------------------|-------------------------|
| FineSpan | 理 | 理 |
| tone | shared ≠ [3] (0 hit) | **local [3]** |
| action | `single:n_l` | `single:n_l` |
| transform | `li` → `ni` | `li` → `ni` |
| tone key | (wrong) | **`ni3`** |
| hit | [] | **你** |
| p_added | 0 | **1** |
| `TONE_PATTERN_SOURCE` | (n/a) | **FINESPAN_LOCAL** |

```text
GENERATED_PINYIN_KEY = ni
GENERATED_TONE_KEY = ni3 (pattern [3])
RAW_LEXICON_HIT = 你
MATERIALIZED / P_ADDED = 1
```

---

## 3. Positive control — `p2_u001_016`

| Field | After |
|-------|--------|
| FineSpan | 李 |
| local tone | **[3]** `FINESPAN_LOCAL` |
| `n_l` | `li` → `ni` → **你** (`ni3`) |
| status | `P_RETRIEVAL_RUN_HIT` |

Prior mechanical hit was **尼** (`ni2`) under shared path tone — incorrect for this span’s [3].  
After fix: correct **你**. Mechanism still valid; no regression from removing shared tone.

---

## 4. 7-case CORRECT_PROFILE remeasure

Frozen RAW + segments + slices; ASR/Tone inference not invoked.

| caseId | TONE_PATTERN_SOURCE | p_status | p_added | Notes |
|--------|---------------------|----------|---------|-------|
| p2_u001_016 | FINESPAN_LOCAL | **HIT** | 1 | 李→你 |
| p2_u001_002 | LOCAL / NONE | EMPTY | 0 | 来=`no_pattern` (legit); 精→jin still 0 |
| p2_u002_016 | FINESPAN_LOCAL | EMPTY | 0 | 丝→shi local [4] |
| p2_u003_001 | FINESPAN_LOCAL | **HIT** | 1 | 真→争 (`zheng1`) — newly mechanical HIT |
| p2_u004_001 | FINESPAN_LOCAL | EMPTY | 0 | 层→cheng local [2] |
| p2_u003_016 | FINESPAN_LOCAL | EMPTY | 0 | 翻→han local [1]; han1 absent |
| p2_u001_004 | FINESPAN_LOCAL | **HIT** | 1 | **decisive PASS** |

```text
PREVIOUS_TONE_KEY_OWNER_COUNT (path-shared) = 6
POST_FIX_PATH_LEVEL_TONE_KEY_OWNER_COUNT = 0
```

```text
P_OWNER_DISTRIBUTION (CORRECT, 7 P-action cases):
  P_RETRIEVAL_RUN_HIT: 3
  P_RETRIEVAL_RUN_EMPTY: 4
```

Mono hits (你/争) prove mechanical P path — **not** useful multi-char repair of 礼宾部/营运证/….

---

## 5. Acceptance

```text
PATH_LEVEL_FIRST_TONE_REUSE_REMOVED = true
FINESPAN_LOCAL_TONE_BINDING = PASS
PRODUCTION_TONE_GATE_UNCHANGED = true
RELATION_DIRECTION_UNCHANGED = true
PINYIN_TRANSFORM_UNCHANGED = true
MODEL2_UNCHANGED = true
MODEL2_WEIGHTS_UNCHANGED = true
PROFILE_LEARNING_UNCHANGED = true
tone_bias_UNCHANGED = true
LEXICON_UNCHANGED = true
FINESPAN_GEOMETRY_UNCHANGED = true
SPAN_EXPANSION_LOGIC_UNCHANGED = true
D_PATH_UNCHANGED = true
MODEL3_UNCHANGED = true
KENLM_UNCHANGED = true
MODEL2_FUTURE_TONE_COMPATIBILITY_RULE_FROZEN = true
DOWNSTREAM_MODEL2_FEATURE_COUPLING = NONE
```

---

## 6. Final verdicts

```text
FINESPAN_LOCAL_TONE_BINDING_STATUS = PASS
TONE_KEY_ARCHITECTURE_DRIFT = RESOLVED
P_RETRIEVAL_TONE_KEY_VALIDITY = PASS
P_STAGE_J_MECHANICAL_PATH = CONFIRMED
USEFUL_MULTI_SYLLABLE_RECALL = NOT_YET_CONFIRMED
```

```text
ONE_NEXT_OWNER = SPAN_OWNER
ONE_RECOMMENDED_NEXT_DELTA =
  Separate delta: FineSpan / query geometry vs evaluation multi-char targets
  (礼宾部/奶精/… still never queried as multi-syl keys).
  Do not reopen path-level Tone reuse; no lexicon expand; no tone_bias.
```

STOP.
