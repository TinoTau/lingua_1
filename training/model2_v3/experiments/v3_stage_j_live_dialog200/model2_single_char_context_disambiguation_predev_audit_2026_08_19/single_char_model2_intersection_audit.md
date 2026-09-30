# Single-char × Model2 intersection audit

## Question

Does the current length=1 path bypass Model2, pass through it, get filtered, recalled, or ranked by it?

## Answer

**Partial pass-through as generic FineSpan P/D expansion. Not involved in single-char lexical choice.**

| Mechanism | Involved? | Evidence |
|-----------|-----------|----------|
| Collector unique-tone / surface-exact | NO | `recall-span-topk-v2.ts` `collectBaseOnlySingleCharCandidate` — no Model2 import |
| Ambiguity reject `MULTIPLE_TONE_EXACT_CANDIDATES` | NO | `single-char-collector-trace.ts` |
| Bind minPrior | NO | `bindLexiconHitsToWindow` `recall-topk-for-windows.ts` L141–164 |
| Model2 inference on length-1 FineSpan | YES | `expand-active-candidates.ts` L157 `for (const span of args.pathFineSpans)` — no length skip; `finespan-adapter.ts` only nulls empty syllables |
| Model2 as length-1 recall source | NO | Length-1 collector is base-only; P/D expansion is extra candidates from relation/domain FuzzyPool |
| Model2 ranking of same-tone homophones | NO | Collector never hands the ambiguous set to Model2; uniqueness fails closed first |
| Model2 filter of 1-char hits | NO | Hits die at bind, before or independently of Model2 merge |

## Timing problem

Model2 currently sits **after** `activeCandidates` (`span-assembly-v4-orchestrator.ts` ~L332). By then the length-1 collector has already collapsed the set to 0 or 1. Ambiguous groups never exist as a Model2 input.

That insertion is correct for Stage P/D **retrieval expansion**. It is **too late** for lexicon-owned candidate-set disambiguation.

## Correct future insertion (not implemented)

After Lexicon/Recall has a bounded eligible set for the acoustic pinyin+tone key, **before** unique-only collapse and **before** Assembly:

```
eligible set from Single-Char Repair Lexicon
  0 → existing fallback (Model2 MUST NOT invent)
  1 → materialize (Model2 MUST NOT run)
  >1 → Model2 select/abstain → 0 or 1 → existing bind/materialize
```

Must not call Model2 before the lexicon query.
