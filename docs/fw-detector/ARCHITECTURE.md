# FW Repair V4 — Architecture（Framework Frozen）

**版本：** FW Repair V4 Framework · **2026-06-19**  
**状态：** 整体冻结（Framework Freeze Audit 裁决 **A**）  
**代码根：** `electron_node/electron-node/main/src/fw-detector/`  
**冻结合约测试：** `freeze-contract.test.ts` · `freeze-config-ssot.test.ts`（50/50 PASS）

---

## 1. System Overview

Job 级 Pipeline：

```text
Audio → ASR (faster_whisper_vad) → rawAsrText freeze
  → FW_SPAN_DETECTOR → AGGREGATION → … → text_asr ← segmentForJobResult
```

FW Repair V4 句级主链（**唯一合法实现**）：

```text
ASR Top1 (rawAsrText)
    ↓
IME V2 (trusted TopK + coarse boundary)
    ↓
Raw Boundary (extractRawCoarseBoundaries)
    ↓
Fine Span Recall (recallTopKForWindows → recallSpanTopKV3)
    ↓
Tone-First Recall (tone-first tier SQL + tone score penalty)
    ↓
Domain Vote (utterance domain + domain-aware span sets)
    ↓
Sentence Assembly V4 (compatibility → domain assembly → buildSentenceCandidates)
    ↓
KenLM Batch Runtime (subprocess scoreBatch only)
    ↓
Raw Log Delta Pick (rawDelta ≥ minDeltaToReplace = 3.0)
    ↓
Apply (applyFwSpanReplacements + repairTarget gate)
    ↓
segmentForJobResult
```

**Shadow（仅 diagnostics，禁止进入 KenLM/Apply）：** Emit → ParentSpan → Graph → Beam → `shadowBeamSpanSets`

**入口：** `fw-detector-step.ts` → `runFwDetectorOrchestrator` → `runFwDetectorV4Path`（`pipelinePath: 'v4'`）

---

## 2. Module Ownership

| 模块 | 职责 | 代码锚点 | 冻结版本 |
|------|------|----------|----------|
| **Detector** | ASR 文本冻结；IME V2 粗边界；coarse span 生成 | `pinyin-ime-v2/` · `extract-raw-coarse-boundaries.ts` · `coarse-boundary-import.ts` | V4 implicit |
| **Tone** | 声学 tone payload 时间对齐；tone score 惩罚（非 hard gate） | `tone-recall.ts` · `tone-time-align.ts` · `toneTimestampOnlyEnabled` | **V1.0.1** |
| **Recall** | Lexicon V2/V3 SQL TopK；parent fragment；tone-first tier | `recall-topk-for-windows.ts` · `recall-span-topkv3.ts` | **V1.0.1** |
| **Domain Vote** | utterance domain 推断；domain-aware pool/filter/select | `assemble-domain-aware-span-sets.ts` · orchestrator domain 计数 | V1.1 Authority Reduction |
| **Assembly** | Compatibility 图；SameDomain per-span assembly；句候选笛卡尔积 | `span-assembly-v4/` · `candidate-compatibility-graph.ts` | **V1.2** |
| **KenLM** | Batch subprocess 打分；fail-open；进程 mutex | `kenlm-scorer.ts` · `lm-scorer.ts` | **Batch-Only V1.0.0** |
| **Score Contract** | `rawDelta = candidate.score − baselineRawScore`；Gate **3.0** | `rerank-fw-sentences.ts` | **Raw Log Delta V1.0.0** |
| **Apply** | 右向左 span 替换；`candidateRequireRepairTarget`；overlap 规则 | `apply-span-replacements.ts` | frozen |
| **Diagnostics** | summary / trace；recall flush；combination trace | `v4-diagnostics-*` · `types.ts` | **V1.0.2** |

---

## 3. Freeze Boundary

### 永久冻结（变更需新 Framework 合约版本）

| 区域 | 禁止 |
|------|------|
| Tone-First Recall | 改 tier 策略、hard drop、SQL 阶段语义 |
| Recall TopK | 恢复 V1 recall；改 effectiveLimit 契约 |
| Domain Vote / Assembly V4 | 改 compatibility 裁决权；beam → KenLM |
| KenLM Runtime | serial runtime · fallbackToSerial · 改 batch 契约 |
| Raw Log Delta Pick | normalized delta Gate；改 `FW_RERANK_SCORE_MODE` |
| Apply | 新 Gate / Filter；改 repairTarget 语义 |
| Diagnostics 核心字段 | 删除或改义 `pickedIsRaw` · `maxDelta` · `scoreMode` 等 |

### 允许持续迭代（Lexicon Operations）

| 区域 | 方式 |
|------|------|
| base / domain / idiom lexicon | Patch · import · sqlite rebuild |
| repairTarget · prior · aliases | sqlite 列 / seed |
| confusion seed | jsonl 资产 |
| domain mapping · enabledDomains | profile / session / config 运营 |
| minPrior | 运营 tuning（不改主链算法） |

详见 [LEXICON_OPERATIONS.md](./LEXICON_OPERATIONS.md) · [FRAMEWORK_FREEZE_DECLARATION.md](./FRAMEWORK_FREEZE_DECLARATION.md)

---

## 4. 主链调用图

```text
runFwDetectorOrchestrator
  → ensureLexiconRuntimeV2Loaded
  → runFwDetectorV4Path
      → runWithRecallV2Diagnostics
          → runSpanAssemblyV4Orchestrator
              → extractRawCoarseBoundaries / generateGlobalWindows
              → recallTopKForWindows (Tone-First)
              → resolveCompatibilityRelations → runDomainAwareAssembly
          → runFwSentenceRerankFromPrefilled
              → createKenlmBatchScorer().scoreBatch
              → rerankFwSentences (raw log delta pick)
          → applyFwSpanReplacements
      → flushRecallJobDiagnostics
```

---

## 5. 目录结构

| 路径 | 职责 |
|------|------|
| `fw-detector-orchestrator.ts` | 配置 snapshot · **仅** V4 |
| `fw-detector-v4-path.ts` | V4 入口 · apply 写回 |
| `span-assembly-v4/` | Window · Recall · Compatibility · Domain Assembly |
| `span-assembly-shared/` | Graph · Beam（Shadow）· Tone diagnostics |
| `kenlm/` · `rerank-fw-sentences.ts` | KenLM + pick |
| `apply-span-replacements.ts` | Apply |
| `pinyin-ime-v2/` | IME + Raw Boundary |
| `legacy/fw-detector/` | **归档**，非默认链 |

**已删除（不得恢复）：** `span-assembly-v3/` · legacy ASR repair 主链 import · serial KenLM

---

## 6. segmentForJobResult 写点白名单

| 文件 | 场景 |
|------|------|
| `asr-step.ts` | init from rawAsrText |
| `fw-detector-step.ts` | skip / disabled |
| `fw-detector-orchestrator.ts` | empty / lexicon unavailable |
| `fw-detector-v4-path.ts` | no_spans / apply |
| `aggregation-step.ts` | turn 合并 |

---

## 7. 验收基线（Dialog200 Gate 3.0）

| 指标 | 值 |
|------|-----|
| Improved | 30 |
| Degraded | 5 |
| Net CER | +25 |
| kenlmVetoMs P95 | 933 ms |
| pickedIsRaw=false | 42 / 200 |

质量瓶颈归属 **Lexicon Operations** — 见 [LEXICON_OPERATIONS.md](./LEXICON_OPERATIONS.md)

---

## 8. 构建与门禁

```powershell
cd electron_node/electron-node
npm run build:main
npx jest --testPathPattern="freeze-contract|freeze-config-ssot"
npm run test:fw-detector
```

---

## 9. 文档索引

| 文档 | 说明 |
|------|------|
| [CONFIG.md](./CONFIG.md) | Framework / Lexicon 配置分界 |
| [kenlm/KENLM_RUNTIME.md](./kenlm/KENLM_RUNTIME.md) | KenLM Batch-Only |
| [INTERFACE_FREEZE.md](./INTERFACE_FREEZE.md) | 接口冻结契约 |
| [DIAGNOSTICS_CONTRACT.md](./DIAGNOSTICS_CONTRACT.md) | Diagnostics 字段 SSOT |
| [LEXICON_OPERATIONS.md](./LEXICON_OPERATIONS.md) | 词库-only 迭代 |
| [FRAMEWORK_FREEZE_DECLARATION.md](./FRAMEWORK_FREEZE_DECLARATION.md) | 冻结声明 |
| Assembly / Recall / Trace 子合约 | `assembly/` · `recall/` · `diagnostics/` |
| Score Contract | [kenlm/SCORE_CONTRACT.md](./kenlm/SCORE_CONTRACT.md) |
| Framework Freeze | [FRAMEWORK_FREEZE_DECLARATION.md](./FRAMEWORK_FREEZE_DECLARATION.md) |
