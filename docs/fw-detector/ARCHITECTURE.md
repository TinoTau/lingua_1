# FW Repair V4 — Architecture

**版本：** 2026-06-25 · Ranking Repair V1.2  
**状态：** Framework Frozen · Maintenance Mode  
**代码根：** `electron_node/electron-node/main/src/fw-detector/`  
**冻结入口：** [freeze/FROZEN.md](./freeze/FROZEN.md)

---

## 1. System Overview

```text
Audio → ASR → rawAsrText freeze → FW_SPAN_DETECTOR → AGGREGATION → text_asr
```

FW Repair V4 句级主链（**唯一合法实现**）：

```text
FW Top1 (ASR rawAsrText)
    ↓
Fine Span (IME V2 · Raw Boundary · Coarse Spans)
    ↓
Pinyin Recall (recallSpanTopKV3 · domainBoost=0)
    ↓
Tone First (tone tier SQL · tone score penalty)
    ↓
Candidate Ranking (candidate-score · ED tie-break only)
    ↓
Domain Vote → Domain Filter → Tone Guard → Select
    ↓
Assembly (domainAwareSpanSets → buildSentenceCandidates)
    ↓
KenLM (batch scoreBatch · raw_log_delta)
    ↓
Apply Gate (bestRawDelta >= 3.0)
    ↓
Writeback (applyFwSpanReplacements → segmentForJobResult)
```

**Shadow（仅 diagnostics）：** Emit → Graph → Beam → `shadowBeamSpanSets` — **禁止** KenLM/Apply

**入口：** `fw-detector-step.ts` → `runFwDetectorOrchestrator` → `runFwDetectorV4Path` · `pipelinePath: 'v4'`

---

## 2. 代码锚点

| 阶段 | 文件 |
|------|------|
| V4 入口 | `fw-detector-v4-path.ts` |
| Fine Span | `pinyin-ime-v2/` · `generate-global-windows.ts` |
| Recall | `recall-topk-for-windows.ts` · `lexicon-v2/recall-span-topkv3.ts` |
| Tone | `tone-recall-sort.ts` · `lexicon/tone-recall-sort.ts` |
| Ranking | `lexicon/candidate-score.ts` |
| Vote | `span-assembly-shared/utterance-domain-vote.ts` |
| Filter / Tone Guard / Select | `filter-domain-candidates-per-span.ts` · `apply-tone-assembly-guard.ts` · `assemble-domain-aware-span-sets.ts` |
| Orchestrator | `span-assembly-v4-orchestrator.ts` |
| 句组合 | `build-sentence-candidates.ts` |
| Compatibility | `candidate-compatibility-graph.ts` |
| Context Prior | `domain-rerank.ts`（adjunct，见 [CONTEXT_PRIOR.md](./CONTEXT_PRIOR.md)） |
| KenLM | `kenlm/run-fw-sentence-rerank-from-prefilled.ts` · `rerank-fw-sentences.ts` |
| Writeback | `apply-span-replacements.ts` |

---

## 3. Module Ownership

| 模块 | 职责 | 冻结版本 |
|------|------|----------|
| Tone | timestamp-only · score penalty | V1.0.1 |
| Recall | TopK · domainBoost=0 | V1.0.1 + V1.2 |
| Ranking | ED tie-break | **V1.2** |
| Domain Vote / Filter / Guard / Select | 域推断 · 分桶 · block · 优先级 | **V1.2** |
| Assembly | spanSets · 句组合 | V1.2 |
| KenLM | batch-only · raw_log_delta | V1.0.0 |
| Apply / Writeback | Gate 3.0 · span 替换 | V1.0.0 |
| Diagnostics | summary/trace | V1.0.2 |

详表：[freeze/FROZEN.md](./freeze/FROZEN.md) §4

---

## 4. 主链调用图

```text
runFwDetectorOrchestrator
  → ensureLexiconRuntimeV2Loaded
  → runFwDetectorV4Path
      → runWithRecallV2Diagnostics
          → runSpanAssemblyV4Orchestrator
              → recallTopKForWindows
              → resolveCompatibilityRelations → runDomainAwareAssembly
          → runFwSentenceRerankFromPrefilled → rerankFwSentences
          → applyFwSpanReplacements
      → flushRecallJobDiagnostics
```

---

## 5. Freeze Boundary

### 永久冻结

改 Tone tier · 恢复 domainBoost · Beam→KenLM · normalized Gate · 改 Apply repairTarget 语义 · 删 diagnostics 核心字段

### 允许迭代（Lexicon）

Patch · repairTarget · enabledDomains · minPrior — [lexicon-v3/LEXICON_OPERATIONS.md](../lexicon-v3/LEXICON_OPERATIONS.md)

---

## 6. 目录结构

| 路径 | 职责 |
|------|------|
| `fw-detector-orchestrator.ts` | 仅 V4 |
| `span-assembly-v4/` | Recall · Assembly · Diagnostics |
| `span-assembly-shared/` | Graph · Beam（Shadow） |
| `kenlm/` | Batch scorer + rerank |
| `pinyin-ime-v2/` | IME + boundary |
| `legacy/fw-detector/` | 归档 |

**已删除：** `span-assembly-v3/` · serial KenLM · V3 生产路径

---

## 7. segmentForJobResult 写点

`asr-step.ts` · `fw-detector-step.ts` · `fw-detector-orchestrator.ts` · `fw-detector-v4-path.ts` · `aggregation-step.ts`

---

## 8. 构建与验证

```powershell
cd electron_node/electron-node
npm run build:main
npx jest --testPathPattern="freeze-contract|freeze-config-ssot"
npm run test:fw-detector
```

---

## 9. 子模块文档

| 模块 | 文档 |
|------|------|
| 冻结 / 回归 | [freeze/FROZEN.md](./freeze/FROZEN.md) |
| Assembly | [assembly/FROZEN_V1_2.md](./assembly/FROZEN_V1_2.md) · [assembly/RANKING_V1_2.md](./assembly/RANKING_V1_2.md) |
| Interval | [assembly/INTERVAL_ASSEMBLY.md](./assembly/INTERVAL_ASSEMBLY.md) |
| Recall | [recall/](./recall/) |
| KenLM | [kenlm/](./kenlm/) |
| Diagnostics | [diagnostics/FROZEN.md](./diagnostics/FROZEN.md) |
| Domain | [DOMAIN_SOURCE_UNIFICATION.md](./DOMAIN_SOURCE_UNIFICATION.md) · [CONTEXT_PRIOR.md](./CONTEXT_PRIOR.md) |
| Compatibility | [compatibility/FROZEN.md](./compatibility/FROZEN.md) |
| 接口 | [INTERFACE_FREEZE.md](./INTERFACE_FREEZE.md) |
| 配置 | [CONFIG.md](./CONFIG.md) |
| Lexicon | [lexicon-v3/README.md](../lexicon-v3/README.md) |

---

*变更主链任一步骤须 bump Framework 版本并更新 `freeze-contract.test.ts`。*
