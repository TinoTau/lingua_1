# Single-char current runtime callgraph

**CR:** Lattice 1.0.2 independent length=1 base-only branch. Mandatory Tone Recall 1.1C.

```
PathFineSpan with syllable length == 1
        ↓
recallSpanTopKV2  [recall-span-topk-v2.ts L641]
        ↓
collectBaseOnlySingleCharCandidate
        ↓
toneRecallReadiness
   not ready → 0 hits (no SQL) → bind gets [] → fallback FineSpan
   ready → lookupBaseByPinyinAndToneKey(pinyin, toneKey, len=1, LIMIT=8)
        ↓
filterEligibleBaseSingleChar
   enabled, word.length==1, not alias, priorScore>0
        ↓
resolveLength1BaseCandidate
   0 → tryExactSurfaceBaseIdentity (tone exact surface)
   1 and not truncated → unique tone exact
   >1 → surface==windowText only; else MULTIPLE_TONE_EXACT_CANDIDATES → 0 hits
        ↓
scoreLength1BaseHit (minCandidateScore; domains forced empty)
        ↓
hits: 0 or 1   (cap=1; no fuzzy; no domain; no Top1)
        ↓
bindLexiconHitsToWindow
   priorScore >= minPrior(0.5)
   LIVE 2026-08-18: 2331 collector accepts → 2331 bind drops (IME weight 0.08–0.30)
        ↓
PathFineSpan.candidates (typically 0 lexical 1-char)
        ↓
compatibility / activeCandidates
        ↓
expandActiveCandidatesWithModel2  ★ still runs on this FineSpan (P/D expansion)
        ↓
DomainAwareAssembly → KenLM
```

Live 2026-08-18 (authoritative, not re-run this round):

- 4477 one-char windows
- collector accept 2331
- bind lexical 1-char FineSpan = 0
- true-recall single-char targets 213; collector expected surface = 2
