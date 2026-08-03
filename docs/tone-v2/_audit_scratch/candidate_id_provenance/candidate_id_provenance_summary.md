# candidateId Provenance — dialog_200 Summary

cases: 200

## Totals
```json
{
  "totalCandidates": 1143,
  "candidateIdsAtPool": 1143,
  "candidateIdsAfterBucket": 940,
  "candidateIdsAfterBudget": 6616,
  "candidateIdsAtDomainAwarePick": 6616,
  "candidateIdsAtSpanReplacement": 0,
  "candidateIdsAtSentenceReplacement": 0,
  "candidateIdsAtCrossPath": 0,
  "candidateIdsAtKenlmInput": 0,
  "candidateIdsAtJobResult": 0,
  "lostAtMapper": 6616,
  "lostAfterMapper": 0,
  "nullAtSentence": 11694,
  "nullAtJobResult": 200,
  "matchKeyCollisions": 251,
  "sameRangeSurfaceDifferentId": 251,
  "sameIdDifferentRange": 0,
  "sameIdDifferentSurface": 0,
  "repairReplacementsWithId": 0,
  "repairReplacementsWithoutId": 1071,
  "canonicalReplacementsWithId": 0,
  "gapReplacementsWithoutId": 10623
}
```

## Anomaly counts
```json
{
  "C1": 0,
  "C2": 0,
  "C3": 0,
  "C4": 0,
  "C5": 6616,
  "C6": 1071,
  "C7": 0,
  "C8": 7102,
  "C9": 0,
  "C10": 0,
  "C11": 0,
  "C12": 0,
  "C13": 251,
  "C14": 0,
  "C15": 0,
  "C16": 0,
  "C17": 10623,
  "C18": 0
}
```

casesWithLostAtMapper: 200
casesWithMatchKeyCollision: 123
casesWithSameRangeSurfaceDifferentId: 123

## Notes
```json
{
  "generation": "recall-topk-for-windows: `${windowId}:${candidateSeq}` — runtime object id, not DB termId",
  "uniquenessScope": "per-window recall bind sequence within a path window; not global UUID",
  "firstLossPoint": "domainAwarePickToSpanReplacementPick (window-candidate-to-pick.ts) — type optional candidateId? exists but mapper omits field",
  "kenlmIndexMapping": "rerankFwSentences scores by text array index; picked = candidates[bestIndex]; independent of WindowCandidate.candidateId",
  "jobResult": "extra.fw_detector spreads FwDetectorResult; FwDetectorReplacementDiag has no candidateId; topCandidates.candidateId is candidate:i / raw (synthetic)",
  "recommendation": "INTERNAL_ONLY (Option A) — passthrough DomainAwarePick→SpanReplacementPick→SentenceReplacement; do not rely on JobResult for provenance"
}
```
