# SQLite → Recall Candidate Contract

Freeze: `FW_V4_FREEZE_2026_08_03` · Batch 1.1C Mandatory Tone Recall

## SQLite Result (input to Enumerator)

```sql
WHERE pinyin_key = ?
  AND tone_pinyin_key = ?
  AND enabled = 1
  AND length(word) = ?
ORDER BY prior_score DESC
LIMIT ?
```

Rows already exclude disabled terms and wrong length. Tone mismatch never appears in the Result Set.

## Enumerator filters (after SQLite)

| Stage | Can DROP? | Reasons |
|-------|-----------|---------|
| `mergeSpanCandidatesCombined` | YES | Dedupe; truncate to `perSpanLimit` (domain>alias>base) |
| `scoreHotword` | YES | disabled, length≠syllables, prior≤0, score&lt;minCandidateScore, dominated duplicate id |
| `sortRecallHitsByToneCompatibility` | **NO** | Re-rank / multiply score only |
| `hits.slice(0, perSpanLimit)` | YES | `DROP_TOPK` |
| `bindLexiconHitsToWindow` | YES | `priorScore < minPrior` |

## Tone after SQL

Tone participates in **SQL WHERE** (already audited).  
Inside Enumerator: tone is used for **ranking / penalty only**, not for deleting hits.

## Domain

```text
Base SQL  +  Domain SQL  →  merge (domain preferred)  →  score  →  TopK slice
```

Not: `TopK → Domain filter`.

## What is NOT a hidden filter

- No Plain Fallback fill
- No post-SQL tone hard reject of returned rows
- No case-id special logic
