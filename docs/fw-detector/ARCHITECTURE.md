# FW Repair V4 — Architecture Overview

**版本：** 2026-07-26 · Multi-Path Lexical Lattice Architecture **V1.0.0**  
**状态：** Overview — cites frozen Architecture SSOT  
**Fine Span / Path SSOT:** **FROZEN FOR IMPLEMENTATION** — [`FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md`](../tone-v2/FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md)  
**Domain Vote formula:** [`Runtime_SSOT_Contract_Freeze.md`](../tone-v2/Runtime_SSOT_Contract_Freeze.md) (caller = **per Path**)  
**代码根：** `electron_node/electron-node/main/src/fw-detector/`

```text
This file is a short architecture overview.
It is not a parallel freeze contract.
```

**Lattice Architecture Authority:** [`FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md`](../tone-v2/FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md)  
**Index:** [`RUNTIME_DOMAIN_DOCUMENT_INDEX.md`](../tone-v2/RUNTIME_DOMAIN_DOCUMENT_INDEX.md) · [`Document_Supersession_Index`](../tone-v2/FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Document_Supersession_Index_2026_07_26.md)

---

## 1. Scope

描述 FW Repair V4 高层流水线与模块归属。Fine Span / Path / Window 以 Lattice Architecture V1.0.0 为准；Presence Vote **公式**以 Runtime SSOT 为准（**按 Path 调用**）。

**注意：** 代码在 Phase 2 切换前仍可能执行 LTR；**LTR 不是有效架构 SSOT**，仅为待删除过渡实现。

---

## 2. High-Level Pipeline（冻结目标主链）

```text
FW 整句结果
→ UtteranceSyllableCoordinate
→ 连续 1～5 音节 WindowQuery
→ SQLite Lexicon Recall
→ LexicalEdge[]
→ SegmentationPath[]
→ Path-specific Domain Vote
→ Path-specific SameDomain Assembly
→ Global Candidate Allocation <=16
→ KenLM Cross-Path Scoring
→ Top-K / Final Result
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
| Fine Span / Window / Edge / Path | `SegmentationPath[]` SSOT · 1..5 窗 · Bounded Path Enum | [Lattice Architecture V1.0.0](../tone-v2/FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md) |
| Domain source / Registry / Recall scope | `term_domain_tags` · Registry · `recallDomainScope` | [DOMAIN_SOURCE_UNIFICATION.md](./DOMAIN_SOURCE_UNIFICATION.md) |
| Recall | TopK · domains[] 传播 · domainBoost=0 | [recall/DOMAIN_RECALL.md](./recall/DOMAIN_RECALL.md) |
| Ranking | candidate-score · ED tie-break | [assembly/RANKING_V1_2.md](./assembly/RANKING_V1_2.md) |
| Domain Vote formula | Fine-Span Presence Vote 计票 | [Runtime_SSOT_Contract_Freeze.md](../tone-v2/Runtime_SSOT_Contract_Freeze.md) |
| Domain Vote caller | **Per SegmentationPath** | Lattice Architecture V1.0.0 |
| Assembly | Path-local Multi-Bucket · global ≤16 | [assembly/FROZEN_V1_2.md](./assembly/FROZEN_V1_2.md) + Lattice Architecture |
| KenLM | batch-only · raw_log_delta · cross-Path | [kenlm/KENLM_RUNTIME.md](./kenlm/KENLM_RUNTIME.md) |
| Context Prior | diagnostics-only · `applied:false` | [CONTEXT_PRIOR.md](./CONTEXT_PRIOR.md) |
| Diagnostics | Path-aware summary/trace | [diagnostics/FROZEN.md](./diagnostics/FROZEN.md) |
| Framework freeze registry | 冻结入口表 | [freeze/FROZEN.md](./freeze/FROZEN.md) |

### 代码锚点（目标 / 过渡）

| 阶段 | 文件 |
|------|------|
| V4 入口 | `fw-detector-v4-path.ts` |
| Coordinate | `pinyin-ime-v2-pinyin-stream.ts` (`buildUtteranceSyllableCoordinate`) |
| Window / Edge / Path | **Phase 1–2 Lattice modules**（替换 `ltr-fine-span-generator.ts` 生产决策权） |
| Recall | `recall-topk-for-windows.ts` · `lexicon-v2/recall-span-topkv3.ts` |
| Vote | `span-assembly-shared/utterance-domain-vote.ts`（公式）· Path caller（Phase 3） |
| Assembly | `assemble-domain-aware-span-sets.ts` · `build-sentence-candidates.ts` |
| Orchestrator | `span-assembly-v4-orchestrator.ts` |
| KenLM | `kenlm/run-fw-sentence-rerank-from-prefilled.ts` · `rerank-fw-sentences.ts` |
| Writeback | `apply-span-replacements.ts` |

### 目标主链调用图

```text
runFwDetectorOrchestrator
  → runFwDetectorV4Path
    → runSpanAssemblyV4Orchestrator
      → buildUtteranceSyllableCoordinate
      → partitionCoarseSpans                 // soft / gap / Trace only
      → buildLexicalWindowQueries            // 1..5 full utterance
      → recallLexicalWindows
      → buildLexicalEdges
      → enumerateCompleteSegmentationPaths   // SegmentationPath[] SSOT
      → for each path: Vote + SameDomain Assembly
      → allocateGlobalSentenceCandidates     // ≤16
    → runFwSentenceRerankFromPrefilled → KenLM scoreBatch
    → applyFwSpanReplacements
```

**已废止作为架构主链：** `runLtrFineSpanGeneration` / `commitBestFormalFineSpan` / cursor 贪心推进。

---

## 4. Runtime Domain Authority

```text
Fine Span / Path SSOT =
docs/tone-v2/FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md

Domain Vote formula / Multi-Bucket rules =
docs/tone-v2/Runtime_SSOT_Contract_Freeze.md
(with Path-scoped caller)
```

本文件不得重新定义 Presence Vote 公式、Path 枚举或候选上限。

---

## 5. Explicit Non-Goals (architecture)

```text
语义 Beam / KenLM Beam / domain Beam 作为分界主链
LTR 唯一 FormalFineSpan SSOT
全路径统一 Vote
跨 Path 组句
第二套词库 / 第二套领域来源
feature flag 双链 / shadow
```
