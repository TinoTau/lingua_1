# Model3 Target Minimal Architecture Diagram

```mermaid
flowchart TD
  subgraph existing [Existing — unchanged ownership]
    R[Lexicon Recall]
    M2[Model2 P/D]
    DV[Domain Vote]
    SD[SameDomain Buckets]
  end

  subgraph new [New — Model3 minimal]
    AA[Anchor Adapter]
    G[Deterministic Trigger Gate]
    M3[Model3 Inference once/utterance]
    RC[Retry Coordinator once]
  end

  subgraph existing2 [Existing — reused]
    A2[Sentence Assembly]
    K[KenLM rank once]
  end

  R --> M2 --> DV --> SD --> AA
  AA --> G
  G -->|fired| M3
  G -->|skip| A2
  M3 -->|KEEP/RETRY mask| RC
  RC -->|subset re-recall recallSpanTopKV2| R
  RC --> A2 --> K

  style M3 fill:#dff0d8
  style RC fill:#dff0d8
  style AA fill:#dff0d8
```

**Insertion:** after `runDomainAwareAssembly` (anchor formation), **before** `buildSentenceCandidates` / KenLM.

**Feedback:** one-shot re-recall → re-assembly → **single** KenLM (not before first assembly).
