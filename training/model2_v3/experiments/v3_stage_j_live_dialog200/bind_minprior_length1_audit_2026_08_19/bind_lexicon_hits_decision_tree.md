# bindLexiconHitsToWindow decision tree

Function: `recall-topk-for-windows.ts` `bindLexiconHitsToWindow`

```
for each hit in input.hits:          # length-1: at most 1 collector hit (cap=1)
  minPriorPassed = hit.hotword.priorScore >= input.minPrior   # default 0.5
  toneFields = recallHitToneFields(...)                       # penalty/rank only at this stage
  TRACE: pushRecallHitPreFilter (minPriorPassed, filterStage)
  if !minPriorPassed:
      continue                      # DROP — no WindowCandidate, no FineSpan lexical edge
  rank += 1
  convert hit → WindowCandidate (termId, replacement, score, domains, tone fields, ...)
return candidates
```

## Ordering vs collector

Length-1 path in `recallTopKForWindows`:

1. `collectBaseOnlySingleCharCandidate` (SQL / tone / uniqueness / surface exact / cap=1)
2. `bindLexiconHitsToWindow` (generic minPrior)

minPrior is therefore **after** collector accept, **before** FineSpan edge creation.  
It is **not** length-gated. The same numeric floor applies to 1-char exact hits and 2–5 enumerator hits.

## Semantic of dropping an already-accepted collector hit

Collector has already declared a unique-or-surface-exact base term. Bind then rejects it as “too low operational prior”. For the 2510 set this is a **scale mismatch**, not an additional uniqueness decision.
