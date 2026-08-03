# Tone Query Contract — How Tone Participates in Recall

Freeze: `FW_V4_FREEZE_2026_08_03` · Batch 1.1C Mandatory Tone Recall

## Mode classification

**Mode C — Plain + Tone 联合 Query**

```sql
WHERE pinyin_key = ? AND tone_pinyin_key = ? AND enabled = 1 AND length(word) = ?
```

Not Mode A (tone-only key).  
Not Mode B (plain SQL then post-filter tone).  
Not Mode D (tone miss → plain fallback) on the Mandatory path.

## Tone provenance (code path)

```text
FW / ASR payload
  acousticSlices[].tonePosterior  +  wordTimeSpans
        │
        ▼
extractAcousticTonePatternForRecall(rawStart, rawEnd, sylStart, sylEnd, ...)
  → mapToneEvidenceForRecall
  → acousticTonePattern: number[]   // digits 1–5 per syllable
        │
        ▼
resolveToneRecallReadiness({ syllables, acousticTonePattern, toneCallerEnabled, ... })
  → buildTonePinyinKeyFromSyllablesAndPattern(syllables, pattern)
  → queryTonePinyinKey e.g. "xiao3|shi2"
        │
        ▼
SQLite bind: tone_pinyin_key = ?
```

Tone is **in the SQL WHERE clause as an equality bind**, not merely a post-SQL filter.

Secondary: `sortRecallHitsByToneCompatibility` may re-order **already returned** hits; it does not replace the composite SQL gate.

## Readiness Fail Closed

If any of:

- `toneCallerEnabled === false` → `caller_disabled`
- `!runtime.supportsToneFirstRecall()` → `runtime_unsupported`
- missing pattern → `no_pattern`
- pattern invalid (non 1–5 / length mismatch) → `invalid_pattern`

then **no SQLite lookup** is issued (`toneSqlCount = 0`, empty hits).

## Plain Fallback

| Check | Result |
|-------|--------|
| `tone-first-tier-collector.ts` header | “No Plain-only path; no underfill Plain fill” |
| `collectTierCandidates` | delegates only to `collectTierCandidatesToneFirst` |
| `lookupBaseByPinyinKey` on Mandatory path | **not invoked** |
| Runtime probe `plainLookupCallsDuringFailCases` | **0** |
| `plainFallbackHitCount` | always 0 / undefined after 1.1C |

**Mode D does not exist** on the frozen Mandatory Tone Recall path.

## Joint key semantics

| Bind | Source |
|------|--------|
| `pinyin_key` | Window plain syllables (`windowPinyinKey` / `syllablesKey`) |
| `tone_pinyin_key` | Plain syllables ⊕ acoustic tone digits |
| `length(word)` | syllable count (= termLength) |

Both keys must match the lexicon row simultaneously.
