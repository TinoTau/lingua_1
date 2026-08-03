# Recall Query Builder — Call Graph

Freeze: `FW_V4_FREEZE_2026_08_03` · READ ONLY

```text
Window (LexicalWindowQuery)
  windowText / rawStart:rawEnd / windowPinyinKey / syllableStart:syllableEnd
        │
        ▼
recallTopKForWindows
  (span-assembly-v4/recall-topk-for-windows.ts)
        │
        ├─ resolveTimestampToneState(acousticSlices, toneTimestampOnlyEnabled)
        │     → toneCallerEnabled
        │
        ├─ extractAcousticTonePatternForRecall(...)
        │     → span-assembly-shared/tone-recall.ts
        │     → mapToneEvidenceForRecall (tone-time-align)
        │     → acousticTonePattern: number[] | undefined
        │
        ▼
recallSpanTopKV2
  (lexicon-v2/recall-span-topk-v2.ts)
        │
        ├─ length==1 → collectBaseOnlySingleCharCandidate
        │                 └─ resolveToneRecallReadiness
        │                 └─ lookupBaseByPinyinAndToneKey
        │
        └─ length 2–5 → collectTierCandidates
                          ≡ collectTierCandidatesToneFirst
                            (tone-first-tier-collector.ts)
                                │
                                ▼
                      resolveToneRecallReadiness
                        (tone-recall-readiness.ts)
                                │
                                ├─ caller_disabled / runtime_unsupported
                                │     / no_pattern / invalid_pattern
                                │     → NO SQLite (Fail Closed)
                                │
                                └─ ready → tonePinyinKey
                                      = buildTonePinyinKeyFromSyllablesAndPattern
                                        (plain syllables + acoustic digits)
                                      │
                                      ▼
                      lookupToneTiers
                        ├─ lookupBaseByPinyinAndToneKey(plain, tone, len, limit)
                        ├─ lookupDomainsByPinyinAndToneKeyMulti(...)
                        └─ lookupIdiomByPinyinAndToneKey(...)  // len==4 only
                                      │
                                      ▼
                      LexiconRuntimeV2 SQLite statements
                        stmtBaseToneComposite / stmtDomainToneComposite /
                        stmtIdiomToneComposite
                                      │
                                      ▼
                      Candidate score + optional toneCompatibility sort
                        (sort among SQL hits — not a Plain→Tone filter path)
```

## Key files

| Stage | File | Symbol |
|-------|------|--------|
| Window → Recall | `recall-topk-for-windows.ts` | `recallTopKForWindows` |
| Tone extract | `span-assembly-shared/tone-recall.ts` | `extractAcousticTonePatternForRecall` |
| Query entry | `recall-span-topk-v2.ts` | `recallSpanTopKV2` |
| Query builder | `tone-first-tier-collector.ts` | `collectTierCandidatesToneFirst` |
| Tone key build | `tone-recall-readiness.ts` + `phonetic/tone-pinyin.ts` | `resolveToneRecallReadiness` / `buildTonePinyinKeyFromSyllablesAndPattern` |
| SQL | `lexicon-runtime-v2.ts` | `lookupBaseByPinyinAndToneKey` |

## Not on Mandatory path

- `lookupBaseByPinyinKey` (Plain-only) — **not called** by `collectTierCandidatesToneFirst`
- Plain fill / underfill fallback — removed Batch 1.1C (`plainFallbackHitCount` always 0)
