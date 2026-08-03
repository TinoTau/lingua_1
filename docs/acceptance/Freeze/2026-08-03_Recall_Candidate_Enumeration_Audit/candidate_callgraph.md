# Candidate Enumerator — Call Graph

Freeze: `FW_V4_FREEZE_2026_08_03` · READ ONLY

```text
recallTopKForWindows
  → recallSpanTopKV2(runtime, { syllables, acousticTonePattern, perSpanLimit, domainIds, ... })
        │
        ├─ length==1: collectBaseOnlySingleCharCandidate
        │     └─ lookupBaseByPinyinAndToneKey → resolveLength1BaseCandidate → (optional exact surface)
        │
        └─ length 2–5:
              collectTierCandidates
                ≡ collectTierCandidatesToneFirst
                      │
                      ├─ resolveToneRecallReadiness  (no SQL if not ready)
                      │
                      ├─ lookupBaseByPinyinAndToneKey(plain, tone, len, sqlLimit)
                      ├─ lookupDomainsByPinyinAndToneKeyMulti(domainIds, plain, tone, len, sqlLimit)
                      ├─ lookupIdiomByPinyinAndToneKey(...)   // len==4 only
                      │     ↑ SQLite Result Set (ORDER BY prior_score DESC LIMIT sqlLimit)
                      │
                      └─ mergeTierCandidates
                            ≡ mergeSpanCandidatesCombined(rows, perSpanLimit, hasActiveDomain)
                                  // domain > alias > base, dedupe word|pinyin, slice(0, limit)
                      │
                      ▼
              for each merged hotword: scoreHotword(...)
                    // DROP: disabled / length / prior<=0 / score<minCandidateScore / worse duplicate
                    // KEEP → bestById
                      │
                      ▼
              sortRecallHitsByToneCompatibility(scored, acousticTonePattern)
                    // Tone RANK / score*=penalty — NEVER removes
                      │
                      ▼
              hits.slice(0, perSpanLimit ?? topK)   ← final TopK
                      │
                      ▼
bindLexiconHitsToWindow(hits, minPrior, ...)
                    // DROP: priorScore < minPrior
                    // KEEP → WindowCandidate (Recall Candidate)
```

## TopK locations (Enumerator scope)

| Stage | Where | Cap |
|-------|-------|-----|
| SQL LIMIT | `lookup*` | `max(perSpanLimit, 8)` |
| Merge cap | `mergeSpanCandidatesCombined` | `perSpanLimit` (= `V4_LIMITS.exactTopK` = 2 for len≥2) |
| Final slice | `recallSpanTopKV2` return | `perSpanLimit` / `topK` |

## Domain order

Domain is **not** a post-TopK filter. Domain rows are fetched in parallel, then **preferred** in merge order when active domains exist.
