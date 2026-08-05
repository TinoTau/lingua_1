# Candidate Generation Flow（Assembly-centric）

```text
SegmentationPath[] (Lattice — out of Assembly internal detail)
        │
        ▼
per Path: runDomainAwareAssembly
  · FineSpan pool
  · Domain Presence Vote → retainedDomains
  · selectPerSpanCandidates / budgetPerSpanCandidates
      (per-span limit 8|6|4 + surface dedupe + always keep canonical)
  · assembleDomainAwareSpanSets → SpanReplacementPick[][]  per bucket
        │
        ▼
per retained domain bucket:
  buildSentenceCandidates(raw, bucketSpanSets, maxSentenceCandidates=16)
      ┌─ enumerateIntervalPaths (DFS repair subsets)
      ├─ gap canonical fill
      ├─ score + Formula A metadata
      ├─ sort by candidateScore
      ├─ exact-text Map dedup
      └─ slice ≤16
        │
        ▼
mergeCrossPathSentenceCandidates(pathAssemblyResults, 16)
  · collect path → bucket → candidate order
  · exact-text first-wins
  · slice ≤16  → KenLM prefilledCombinations
```

## Notes

- `allocateDomainBucketSentenceBudget(bucketCount, 16)` is invoked as a **guard**  
  (`floor(16/buckets) < 1` → throw). Return value **not** applied to `buildSentenceCandidates` cap.
- Each bucket currently receives the **full global cap (16)** before CrossPath merge.
