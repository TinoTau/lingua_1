# 03 — Interface Snapshot

| Field | Value |
|-------|-------|
| Snapshot | **FW_V4_FREEZE_2026_08_03** |

## Production Entry

```text
fw-detector-step → runFwDetectorOrchestrator → runFwDetectorV4Path
→ runSpanAssemblyV4Orchestrator → kenlmSentenceCandidates
→ rerankFwSentences
```

## Frozen Interfaces

| Interface | Contract |
|-----------|----------|
| Lattice | `runLatticeFineSpanGeneration` sole FineSpan producer |
| Recall | `recallSpanTopKV2` — no ngrams / parent_fragment |
| Vote | `voteUtteranceDomainFromPool` Presence Vote |
| CrossPath | `mergeCrossPathSentenceCandidates` dedup-before-cap ≤16 |
| KenLM input | required prefilled combinations; `[]` fail-open raw |
| Lexicon rebuild | `npm run lexicon:full-rebuild` |

## Retired (must not restore as production)

LTR FineSpan API · parent_fragment recall · `term_pinyin_ngrams` · shadow/parallel dual recall
