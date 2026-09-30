# Model3 Audit — Current Actual Runtime Diagram

**Source:** code trace `span-assembly-v4-orchestrator.ts` + `job-pipeline.ts` (2026-08-23)

```mermaid
flowchart TD
  A[ASR runAsrStep] --> B[FW runFwDetectorStep]
  B --> C[normalizeForFwRepairInput]
  C --> D[partitionCoarseSpans]
  D --> E[runLatticeFineSpanGeneration]
  E --> E1[recallTopKForWindows / recallSpanTopKV2]
  E1 --> E2[materializePathFineSpans]

  subgraph per_path [Per PathFineSpanView loop]
    E2 --> F[rebindToneForFineSpan]
    F --> G[resolveCompatibilityRelations]
    G --> H[expandActiveCandidatesWithModel2]
    H --> I[runDomainAwareAssembly]
    I --> I1[Domain Vote]
    I1 --> I2[SameDomain filter per bucket]
    I2 --> I3[budgetPerSpanCandidates]
    I3 --> I4[assembleDomainAwareSpanSets]
    I4 --> J[buildSentenceCandidates per bucket]
  end

  J --> K[mergeCrossPathSentenceCandidates cap 16]
  K --> L[runFwSentenceRerankFromPrefilled KenLM]
  L --> M[applyFwSpanReplacements]
  M --> N[JobResult.text_asr]

  style H fill:#e8f4ff
  style I fill:#fff4e6
  style L fill:#f0f0f0
```

**ORDER_DRIFT (comment only):** `span-assembly-v4-orchestrator.ts` header says `Tone → Vote → Bucket → Assembly` but **runtime** is `Tone → Compatibility → **Model2** → Vote → Bucket → Assembly`. Stage-J docs match runtime.
