# 02 — Runtime Snapshot

| Field | Value |
|-------|-------|
| Snapshot | **FW_V4_FREEZE_2026_08_03** |
| Status | CURRENT RECOVERY BASELINE |

---

## Call Order (production)

```text
pipeline/steps/fw-detector-step.ts
  → runFwDetectorOrchestrator          (fw-detector-orchestrator.ts)
    → runFwDetectorV4Path              (fw-detector-v4-path.ts)
      → runSpanAssemblyV4Orchestrator  (span-assembly-v4-orchestrator.ts)
        → runLatticeFineSpanGeneration (lattice-fine-span-runtime.ts)
        → Exact Recall Owner           (recallSpanTopKV2 / LexiconRuntimeV2)
        → Presence Vote Owner          (voteUtteranceDomainFromPool)
        → SameDomain Bucket Owner      (assemble-domain-aware-span-sets.ts)
        → Sentence Assembly Owner      (path-local assembly builders)
        → mergeCrossPathSentenceCandidates
        → kenlmSentenceCandidates.combinations (<=16)
      → runFwSentenceRerankFromPrefilled / rerankFwSentences
```

ASR production enables FW via `isFwDetectorEngineEnabled()` in ASR/pipeline steps; FW decision path is always V4 (`runFwDetectorV4Path`).

---

## Sole Owners (runtime)

| Concern | Owner |
|---------|-------|
| FineSpan / Lattice | `runLatticeFineSpanGeneration` |
| Exact Recall | `recallSpanTopKV2` + `LexiconRuntimeV2` |
| Presence Vote | `voteUtteranceDomainFromPool` |
| Bucket | Domain-aware assembly bucket partition |
| Assembly | Path-local sentence assembly |
| CrossPath | `mergeCrossPathSentenceCandidates` |
| KenLM | `rerankFwSentences` (score/rank/pick only) |

---

## Runtime Must NOT Own

| Concern | Status |
|---------|--------|
| Atomicity filter | ABSENT in Recall runtime |
| Permanent domain patch | ABSENT |
| Keep/Delete domain_atomic | ABSENT (Source + build Validator only) |
| Surface test rewrite | ABSENT |
| Lexicon content cleanup | ABSENT (Source + Full Rebuild) |

---

## Lexicon Load

`node_runtime/lexicon/v3` · bundleVersion **12** · checksum `ab78bf3599911711fc18ce59c62ab93c8f50c5410a1a6254e01125a244ce1f76` · atomicity enforce.
