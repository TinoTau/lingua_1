# Single-Char Runtime Recall Callgraph

Audit-only. Source: `recall-span-topk-v2.ts` + `lexicon-runtime-v2.ts` (post Model2 single-char rollback).

```
recallSpanTopKV2(syllables.length === 1)
  └─ collectBaseOnlySingleCharCandidate(runtimeV2, { syllables, windowText, tones })
       ├─ resolveToneRecallReadiness(...)
       │    if not ready → empty hits + length1Collector diagnostic (no SQL)
       ├─ runtimeV2.lookupBaseByPinyinAndToneKey(pinyinKey, tonePinyinKey, termLength=1, limit=8)
       │    └─ LexiconRuntimeV2.stmtBaseToneComposite
       │         SELECT ... FROM base_lexicon
       │         WHERE pinyin_key=? AND tone_pinyin_key=? AND enabled=1 AND length(word)=1
       │         ORDER BY prior_score DESC
       │         LIMIT ?
       ├─ filterEligibleBaseSingleChar(raw)
       │    enabled && word.length===1 && !isAlias && priorScore>0
       ├─ resolveLength1BaseCandidate(eligible, windowText, truncated?)
       │    unique eligible → accept
       │    else unique surface-exact among eligible → accept
       │    else → null (fail-closed / MULTIPLE_TONE_EXACT_CANDIDATES)
       ├─ [if no hit] tryExactSurfaceBaseIdentity
       │    └─ lookupBaseByExactSurfacePinyinAndTone(..., limit=2)
       │         SELECT ... FROM base_lexicon
       │         WHERE pinyin_key=? AND tone_pinyin_key=? AND word=? AND enabled=1 AND length(word)=1
       └─ scoreLength1BaseHit → max 0|1 hit; domains forced []; repairTarget forced false
```

**Not on this path (confirmed absent after rollback):**

- Model2 `infer` / `disambiguate`
- `singleCharAmbiguousSet`
- AmbiguityHead / context encoder
- domain_lexicon / idiom_lexicon length-1 (counts = 0 enabled)

**Active DB:** `node_runtime/lexicon/v3/lexicon.sqlite` (bundleVersion 13).
