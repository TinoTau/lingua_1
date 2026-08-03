<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Development/FW_Repair_V4_Step3_Production_Orchestrator_Lattice_Cutover_Development_Report_2026_07_30.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Step 3 Production Orchestrator Lattice Cutover Development Report

| Field | Value |
|-------|-------|
| Date | 2026-07-30 |
| Step | 3 / 7 |
| Scope | 生产 orchestrator Fine Span 入口 LTR → Lattice；Path-local Vote/Bucket/Assembly |
| Verdict | **STEP3_PASS** |
| Not | 删除 LTR 文件 · 正式 Cross-Path Merge · 改 Vote/KenLM/Tone Mapping |

---

## 1. Executive Summary

生产主链已切换为 `runLatticeFineSpanGeneration`。每条 `PathFineSpanView` 独立 Tone rebind → Vote → SameDomain Bucket → Assembly。dialog_200：**200/200** orchestrator 成功；**LTR runtime call count = 0**。KenLM 池暂用 `STEP3_TEMPORARY_PRE_STEP4_COLLECTION`（按 path 顺序收集），Step 4 替换为正式 Cross-Path Merge → Dedup → Global ≤16。

```text
STEP3_PASS
```

---

## 2. Before Production Architecture

```text
runSpanAssemblyV4Orchestrator
  → runLtrFineSpanGeneration
  → ltr.formalSpans (单组)
  → 全局 Vote / Assembly
  → KenLM
  generatorMode: ltr_soft_boundary
  signals: ltr_fine_span
```

---

## 3. After Production Architecture

```text
runSpanAssemblyV4Orchestrator
  → runLatticeFineSpanGeneration
  → pathFineSpanViews[]
  → for each PathFineSpanView:
       clone spans → rebindToneForFineSpan
       path-local compatibility
       runDomainAwareAssembly(pathFineSpans)   // Vote + Bucket + Assembly
       buildFwSpansFromPathFineSpans (per path)
       buildSentenceCandidates (per bucket)
  → PathAssemblyResult[]
  → STEP3_TEMPORARY_PRE_STEP4_COLLECTION → KenLM pool
  generatorMode: multi_path_lattice
  fineSpanOwner: segmentation_path
  signals: path_fine_span
```

---

## 4. Orchestrator Cutover

- 移除：`import` / `call` `runLtrFineSpanGeneration`
- 接入：`runLatticeFineSpanGeneration`（真实 runtime / domainIds / coarseSpans / tone / cache 设置）
- Lattice Entry 扩展：`tone`、`parentFragmentHitCount`、`utteranceRecallStats`、`enableUtteranceRecallCache`、`toneEvidenceProduction`、`trace`

---

## 5. Lattice Failure Handling

`ok: false` → `throw new Error('[SPAN_ASSEMBLY_V4][LATTICE_${code}] …')`

| Rule | Status |
|------|--------|
| 无 fallback-to-LTR | Done |
| 无第二 Fine Span 链 | Done |
| 无伪造成功 / 伪造 PathFineSpan[] | Done |

---

## 6. Path-local Tone Rebind

每条 Path：`clonePathFineSpansForTone` 后 `rebindToneForFineSpan`，避免跨 Path 共享变异 candidate。

---

## 7. Path-local Vote

每条 Path 单独 `runDomainAwareAssembly(activeCandidates_of_path, …, pathFineSpans)`。  
Vote 隔离单测：restaurant Path 与 medical Path 互不投对方票。

---

## 8. Path-local SameDomain Bucket

沿用现有 `runDomainAwareAssembly` 内 bucket 逻辑；作用域限于该 Path 的 Fine Span / candidates。

---

## 9. Path-local Assembly

每条 Path：`buildSentenceCandidates` per bucket → 写入 `PathAssemblyResult`。

---

## 10. Fallback Span Behavior

- `candidates = []` → 不产生领域票
- 参与 Path 覆盖；组句无缺字 / 重复 / 乱序（单测覆盖 lexical+fallback+lexical）
- dialog_200：200/200 含 fallback；`pathsWithZeroAssemblyCandidates = 0`

---

## 11. PathAssemblyResult Contract

```ts
type PathAssemblyResult = {
  pathId: string;
  boundaryKey: string;
  pathFineSpans: readonly PathFineSpan[];
  assemblyResult: DomainAwareAssemblyResult; // 现有
  fwSpans: FwSpanDiagnostics[];
  perBucketGenerated: SentenceCombination[][];
  sentenceCandidateCount: number;
};
```

无 V2 / Compat / Legacy Assembly DTO。

---

## 12. Temporary Pre-Step4 Collection

```text
STEP3_TEMPORARY_PRE_STEP4_COLLECTION
```

- 按 path 顺序收集各 bucket 的 sentence candidates
- 再调用现有 `mergeCrossBucketSentenceCandidates(…, kenlmCap)`
- 不改候选分数；不加 per-path 16；不引入 LTR 候选
- `architectureCompliance.temporaryPreStep4Collection: true`

---

## 13. Trace Migration

生产输出：`latticeTrace`（`LatticeFineSpanTrace`）+ `pathAssemblyTraces[]`。  
停止写入：LTR step/cursor/option/`ltr.trace`。

---

## 14. Diagnostics Migration

| Before | After |
|--------|-------|
| `generatorMode: ltr_soft_boundary` | `multi_path_lattice` |
| `votePoolSource: formal_fine_span` | `path_fine_span` |
| `signals: ltr_fine_span` | `path_fine_span` |
| — | `fineSpanOwner: segmentation_path` |

---

## 15. Removed Production LTR References

生产运行代码（`span-assembly-v4-orchestrator.ts` / `fw-detector-v4-path.ts`）：

- 无 `runLtrFineSpanGeneration`
- 无 `ltr.formalSpans` / `ltr.trace`
- 无 `ltr_soft_boundary` / 生产 `ltr_fine_span` signal

`ltr-fine-span-generator.ts` 文件保留（后续 Step 删除）；仅 LTR 自身与专属测试仍可引用。

---

## 16. Static Dependency Scan

```text
rg runLtrFineSpanGeneration main/src
→ 仅 ltr-fine-span-generator.ts + LTR/历史测试

rg ltr_soft_boundary|ltr\.formalSpans 生产 orchestrator
→ 0
```

---

## 17. Tests Executed

| Suite | Result |
|-------|--------|
| `npm run build:main` | PASS |
| `span-assembly-v4-orchestrator.step3.test.ts` | PASS |
| `lattice-fine-span-runtime` / `phase2-path-harness` / `recall-scope-wiring` / LTR / P5 | PASS（31 tests in batch） |

覆盖：Vote 隔离、fallback 组句、Tone clone、orchestrator 零 LTR import、mock LTR 零调用。

---

## 18. dialog_200 Production Results

Probe：`docs/tone-v2/_audit_scratch/step3-orchestrator-lattice-cutover-dialog200-probe.mjs`  
Summary：`…/step3_orchestrator_lattice_cutover/dialog_200_summary.json`

| Metric | Value |
|--------|-------|
| casesTotal | 200 |
| orchestratorSuccess | **200** |
| orchestratorFailure | **0** |
| fallbackCases | 200 |
| pathCount | 1→170, 2→21, 4→9 |
| pathsWithZeroAssemblyCandidates | 0 |
| duplicateCandidateCount | 0 |
| latency p50/p95/max (ms) | 70 / 115 / 178 |
| sqlQueryCount | 13414 |
| ltrRuntimeCallCount | **0** |

---

## 19. LTR Runtime Call Verification

Probe 在加载 orchestrator 前 patch `runLtrFineSpanGeneration` 计数：

```text
ltrRuntimeCallCount = 0
```

静态扫描生产 orchestrator：**0** LTR import/call。

---

## 20. Remaining Work for Step 4

```text
Cross-Path Merge
→ Dedup
→ Global <=16
```

替换 `STEP3_TEMPORARY_PRE_STEP4_COLLECTION`；随后 Step 可删除 LTR 文件本体。

---

## 21. Target List Completion

| ID | Status |
|----|--------|
| T1–T9 Lattice cutover / Path-local / Trace | Done |
| T10 dialog_200 生产主链 | Done |
| T11 LTR call count = 0 | Done |

---

## 22. Check List Completion

- [x] Orchestrator import Lattice；不再 import/call LTR
- [x] 无 fallback-to-LTR / flag / shadow / adapter
- [x] 结构化 Lattice failure
- [x] Path-local Tone / Vote / Bucket / Assembly
- [x] Vote 不跨 Path 混合
- [x] fallback 不计票；组句完整
- [x] Trace / diagnostics 迁至 Lattice
- [x] 编译与单测通过
- [x] dialog_200 生产主链 + LTR call = 0

---

## 23. Final Verdict

```text
STEP3_PASS
```
