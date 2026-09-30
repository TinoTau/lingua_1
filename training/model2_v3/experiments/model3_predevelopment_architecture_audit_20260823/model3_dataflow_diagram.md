# Model3 Dataflow Diagram

```mermaid
flowchart LR
  FS[PathFineSpan + WindowCandidate]
  DV[DomainFilteredSpanSet]
  M2[Model2 provenance fields]
  AA[Anchor Adapter]
  IN[Model3SpanInput sequence]
  M3[Model3 KEEP/RETRY]
  RC[Retry Coordinator]
  RR[recallSpanTopKV2 subset]
  AS[buildSentenceCandidates]
  KM[KenLM ≤16]

  FS --> AA
  DV --> AA
  M2 --> AA
  AA --> IN
  IN --> M3
  M3 --> RC
  RC --> RR
  RR --> FS
  RC --> AS --> KM
```

**Types (proposed CREATE):**

- `Model3SpanInput`: spanId, surface, anchor, anchorSource, toneEvidence, pinyinEvidence, model2Evidence, domainBucket
- `Model3UtteranceDecision`: spanId → KEEP | RETRY (non-anchor only)
