# FW Repair V4 — Architecture Overview

**版本：** 2026-07-20  
**状态：** Overview only（非 Runtime 冻结合同）  
**Runtime Domain Presence Vote:** **ACCEPTED AND FROZEN** — [`Runtime_SSOT_Contract_Freeze.md`](../tone-v2/Runtime_SSOT_Contract_Freeze.md)  
**代码根：** `electron_node/electron-node/main/src/fw-detector/`

```text
This file is a short architecture overview.
It is not a parallel Runtime freeze contract.
```

**Sole Runtime Authority:** [`Runtime_SSOT_Contract_Freeze.md`](../tone-v2/Runtime_SSOT_Contract_Freeze.md)  
**Index:** [`RUNTIME_DOMAIN_DOCUMENT_INDEX.md`](../tone-v2/RUNTIME_DOMAIN_DOCUMENT_INDEX.md)

---

## 1. Scope

描述 FW Repair V4 高层流水线与模块归属。详细公式、Vote、Assembly、KenLM pick 以 Owner 文档为准，本文件不复制。

---

## 2. High-Level Pipeline

```text
ASR
→ FW segmentation
→ Recall
→ Fine-Span Presence Vote
→ Multi-Bucket Assembly
→ Cross-Bucket Dedup
→ KenLM
→ Output
```

系统外围：

```text
Audio → ASR → rawAsrText freeze → FW_SPAN_DETECTOR → AGGREGATION → text_asr
```

**入口：** `fw-detector-step.ts` → `runFwDetectorOrchestrator` → `runFwDetectorV4Path` · `pipelinePath: 'v4'`

---

## 3. Module Ownership

| 模块 | 职责 | Owner 文档 |
|------|------|------------|
| Domain source / Registry / Recall scope | `term_domain_tags` · Registry · `recallDomainScope` | [DOMAIN_SOURCE_UNIFICATION.md](./DOMAIN_SOURCE_UNIFICATION.md) |
| Recall | TopK · domains[] 传播 · domainBoost=0 | [recall/DOMAIN_RECALL.md](./recall/DOMAIN_RECALL.md) |
| Ranking | candidate-score · ED tie-break | [assembly/RANKING_V1_2.md](./assembly/RANKING_V1_2.md) |
| Domain Vote / retainedDomains | Fine-Span Presence Vote | [Runtime_SSOT_Contract_Freeze.md](../tone-v2/Runtime_SSOT_Contract_Freeze.md) |
| Assembly | Multi-Bucket · merge · ≤16 | [assembly/FROZEN_V1_2.md](./assembly/FROZEN_V1_2.md) + Runtime SSOT |
| KenLM | batch-only · raw_log_delta | [kenlm/KENLM_RUNTIME.md](./kenlm/KENLM_RUNTIME.md) |
| Context Prior | diagnostics-only · `applied:false` | [CONTEXT_PRIOR.md](./CONTEXT_PRIOR.md) |
| Diagnostics | summary/trace | [diagnostics/FROZEN.md](./diagnostics/FROZEN.md) |
| Framework freeze registry | 冻结入口表 | [freeze/FROZEN.md](./freeze/FROZEN.md) |

### 代码锚点

| 阶段 | 文件 |
|------|------|
| V4 入口 | `fw-detector-v4-path.ts` |
| Recall | `recall-topk-for-windows.ts` · `lexicon-v2/recall-span-topkv3.ts` |
| Vote | `span-assembly-shared/utterance-domain-vote.ts` |
| Assembly | `assemble-domain-aware-span-sets.ts` · `build-sentence-candidates.ts` |
| Orchestrator | `span-assembly-v4-orchestrator.ts` |
| KenLM | `kenlm/run-fw-sentence-rerank-from-prefilled.ts` · `rerank-fw-sentences.ts` |
| Writeback | `apply-span-replacements.ts` |

### 主链调用图

```text
runFwDetectorOrchestrator
  → ensureLexiconRuntimeV2Loaded
  → runFwDetectorV4Path
      → runWithRecallV2Diagnostics
          → runSpanAssemblyV4Orchestrator
              → recallTopKForWindows
              → resolveCompatibilityRelations → runDomainAwareAssembly
              → mergeCrossBucketSentenceCandidates
          → runFwSentenceRerankFromPrefilled → rerankFwSentences
          → applyFwSpanReplacements
```

---

## 4. Runtime Domain Authority

```text
SOLE RUNTIME AUTHORITY =
docs/tone-v2/Runtime_SSOT_Contract_Freeze.md
```

本文件不得重新定义 Presence Vote、retainedDomains、候选上限或 KenLM pick。

---

## 5. Removed Legacy Paths

| 路径 | 状态 |
|------|------|
| Shadow Beam / `shadowBeamSpanSets` | REMOVED |
| `domain-rerank.ts` / Domain Rerank | REMOVED |
| Context Prior multiplier | REMOVED（`applied:false`） |
| 双 Vote / Graph Domain Vote | REMOVED |
| Beam→KenLM 降级链 | REMOVED |

---

## 6. Document Links

| 模块 | 文档 |
|------|------|
| Runtime Domain Index | [../tone-v2/RUNTIME_DOMAIN_DOCUMENT_INDEX.md](../tone-v2/RUNTIME_DOMAIN_DOCUMENT_INDEX.md) |
| Runtime SSOT | [../tone-v2/Runtime_SSOT_Contract_Freeze.md](../tone-v2/Runtime_SSOT_Contract_Freeze.md) |
| 冻结 / 回归 | [freeze/FROZEN.md](./freeze/FROZEN.md) |
| Assembly | [assembly/FROZEN_V1_2.md](./assembly/FROZEN_V1_2.md) |
| Recall | [recall/DOMAIN_RECALL.md](./recall/DOMAIN_RECALL.md) |
| KenLM | [kenlm/KENLM_RUNTIME.md](./kenlm/KENLM_RUNTIME.md) |
| Domain source | [DOMAIN_SOURCE_UNIFICATION.md](./DOMAIN_SOURCE_UNIFICATION.md) |
| Context Prior | [CONTEXT_PRIOR.md](./CONTEXT_PRIOR.md) |
| Diagnostics | [diagnostics/FROZEN.md](./diagnostics/FROZEN.md) |
| 配置 | [CONFIG.md](./CONFIG.md) |
| Runtime 演进 | [../tone-v2/Lingua_Runtime_Evolution_Rule.md](../tone-v2/Lingua_Runtime_Evolution_Rule.md) |

---

*Overview only · 2026-07-20*
