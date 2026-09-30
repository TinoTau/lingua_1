# Single-char candidate materializer audit

There is **no** separate single-char candidate type.

| Owner | Function | Length-1 |
|-------|----------|----------|
| Base | `bindLexiconHitsToWindow` | Yes — only path that can introduce 1-char `WindowCandidate` |
| Stage P | `materializeProfileHits` | Would reuse `recallSpanTopKV2`; AFTER NO_PROFILE: `NO_P_ACTION` |
| Stage D | `materializeDomainHits` | Domain min length 2; length gate drops mismatched syllable counts |
| Dedicated char type | none | Not deleted; never existed as a second SSOT |

`bindLexiconHitsToWindow` has **no** `length >= 2` skip. 2-char true-recall units with in-lexicon targets materialize: **8 / 34** production+union hits. Generic materializer works.

1-char expected surfaces never reach this function as hits, because `collectBaseOnlySingleCharCandidate` returns null (AFTER run: **0** lexical 1-char PathFineSpans / 4157 length-1 FineSpans, all `fallback`).

Shadow/dead path: LTR `generateGlobalWindows` (min 2) and `local-span-recall` MIN_SYLLABLES=2 — not Lattice production.
