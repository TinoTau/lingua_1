<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Development/FW_Repair_V4_Step2_Lattice_Production_Entry_Extraction_Development_Report_2026_07_30.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Step 2 Lattice Production Entry Extraction Development Report

| Field | Value |
|-------|-------|
| Date | 2026-07-30 |
| Step | 2 / 7 |
| Scope | 从 Phase2 harness 提取纯生产级 Lattice Fine Span Entry |
| Verdict | **STEP2_PASS** |
| Not | 替换 orchestrator · 删除 LTR · Vote/Assembly/KenLM/Tone |

---

## 1. Executive Summary

建立独立生产入口 `lattice-fine-span-runtime.ts` / `runLatticeFineSpanGeneration`：真实 Recall → LexicalEdge → 正式 fallback coverage → Complete SegmentationPath[] → PathFineSpanView[]。Phase2 harness 改为调用该 Entry。dialog_200：**200/200** 均生成 ≥1 条无 gap 完整 Path。生产 orchestrator 仍走 LTR，未接入。

```text
STEP2_PASS
```

---

## 2. Before Architecture

```text
phase2-path-harness.ts
  → injectFallbackEdges
  → enumerateCompleteSegmentationPaths
  → materializePathFineSpans
  (+ Phase1 harness for Window/Recall/Edge)

phase2 declared: MUST NOT wire into production
→ 无独立 Production Lattice Entry
→ Lattice 能力困在 Harness / Audit 语义中
```

---

## 3. Harness Classification

| Logic in phase2-path-harness (pre-Step2) | Classification |
|------------------------------------------|----------------|
| Coordinate via caller / Phase1 | PRODUCTION_CORE（迁入 runtime） |
| Window / hard-block / Recall / LexicalEdge（经 Phase1） | PRODUCTION_CORE（迁入 runtime） |
| injectFallbackEdges | PRODUCTION_CORE |
| enumerateCompleteSegmentationPaths | PRODUCTION_CORE |
| materializePathFineSpans | PRODUCTION_CORE |
| pathId / boundaryKey / coverage | PRODUCTION_CORE |
| singleChar* counters | AUDIT_ONLY → KEEP_IN_HARNESS |
| harnessOnly / productionCutover flags | HARNESS_CONTROL → KEEP_IN_HARNESS |
| sentenceId | TRACE_ONLY / harness |
| fallbackInjectionEdgeIds sorted dump | AUDIT_ONLY |
| Phase1 full diagnostics dump | AUDIT_ONLY（full harness 现改为 productionTrace 精简） |
| measureHeap | TEST_ONLY（Phase1 保留；full harness 不再依赖） |

---

## 4. New Production Entry

```text
lattice-fine-span-runtime.ts
  runLatticeFineSpanGeneration(...)
  runLatticeFineSpanGenerationFromLexicalEdges(...)
```

---

## 5. Input Contract

`LatticeFineSpanGenerationInput`：

```text
rawText
runtime (LexiconRuntimeV2)
profile
domainIds (non-empty Domain Recall SSOT)
minPrior
imeConfig / dict
coarseSpans? (else partitionCoarseSpans)
wordTimeSpans? / acousticSlices?
fuzzyRecallEnabled? / toneTimestampOnlyEnabled?
limits? (V4_LIMITS path caps)
```

禁止输入：LTR result / FormalSpan / cursor / harness fixture / audit case object。

---

## 6. Output Contract

Success：

```text
ok: true
segmentationPaths: SegmentationPath[]
pathFineSpanViews: PathFineSpanView[]   // 1:1 with paths
lexicalEdges / edgesAfterFallback
windows
trace: LatticeFineSpanTrace (minimal)
```

Failure（结构化）：

```text
ok: false
code: EMPTY_INPUT | EMPTY_DOMAIN_SCOPE | NO_COMPLETE_PATH | COVERAGE_INVARIANT | MATERIALIZATION_FAILED
message
```

无 LTR 结构、无兼容 DTO。

---

## 7. Recall Integration

```text
buildLexicalWindowQueries
→ latticeHardBlockFilter
→ recallTopKForWindows (+ utterance recall cache)
→ buildLexicalEdges
```

复用现有真实 Recall；不经 LTR；无第二套 SQLite / adapter / 测试词库。

---

## 8. Window and Edge Generation

- Window：syllable/raw SSOT via `buildUtteranceSyllableCoordinate` + `buildLexicalWindowQueries`
- Coarse boundary：软分区 + hard-block 过滤（非 LTR cursor commit）
- LexicalEdge：保留多边进入 Path 枚举；exact/parent/base 证据在 `recallEvidence` / candidates
- 无唯一 winner / shorter-exact commit

---

## 9. Fallback Edge Contract

正式 Architecture 组件（非 fallback-to-LTR）：

- 仅覆盖无法仅用 lexical 连通的区间（min-cost injection）
- 空 candidates；不计领域票（候选事实为空）
- edgeKind=`fallback`；edgeId=`fallback:s:e`
- 保证可达句尾或结构化失败

dialog_200：200/200 需要 fallback（与先前审计一致）。

---

## 10. Path Enumeration

调用现有 `enumerateCompleteSegmentationPaths`：

| Cap | Source |
|-----|--------|
| maxActivePathsPerPosition | V4_LIMITS (=8 probe) |
| maxCompleteSegmentationPaths | V4_LIMITS (=8 probe) |

- per_position_cap → complete_path_cap
- deterministic tie-break（现有 enumerator）
- 无 Beam / 第二枚举器

dialog_200 path 分布：1→170，2→21，4→9；max=4（远低于 cap 8）。

---

## 11. Path Materialization

```text
1 SegmentationPath → 1 PathFineSpanView via materializePathFineSpans
```

断言：无 gap/overlap；`assertPathFineSpansNonOverlapping`；candidate 数组引用保留。

未做 Vote / Assembly / Dedup / ≤16。

---

## 12. Runtime Trace

`LatticeFineSpanTrace` 仅含：window/edge/fallback/path counts、prune、coverage、SQL 计数、capEvents。

不含：fixture、expected、dialog case id、phase2 label、full rejected option list。

---

## 13. Modified Files

| File | Change |
|------|--------|
| `lattice-fine-span-runtime.ts` | **新增** Production Entry |
| `lattice-fine-span-runtime.test.ts` | **新增** 单测 |
| `phase2-path-harness.ts` | 改为 import Production Entry + audit 包装 |
| `phase2-path-harness.test.ts` | 依赖方向断言更新 |
| `_audit_scratch/step2-lattice-production-entry-dialog200-probe.mjs` | **新增** 离线验证 |
| `_audit_scratch/step2_lattice_production_entry/*` | 验证输出 |

未改：`span-assembly-v4-orchestrator.ts`、LTR、Vote、Assembly、KenLM、Tone、词库、dialog_200。

---

## 14. Dependency Direction

```text
phase2-path-harness
  → lattice-fine-span-runtime
    → recallTopKForWindows / injectFallbackEdges / enumerate… / materialize…

lattice-fine-span-runtime ↛ harness / LTR
orchestrator ↛ lattice-fine-span-runtime  (仍 → LTR)
```

---

## 15. Static Dependency Scan

Production Entry：无 `from './ltr-fine-span-generator'` / `phase2-path-harness` / `phase1-window-edge-harness`。

Orchestrator：仍仅 `runLtrFineSpanGeneration`；无 Lattice Entry / Phase2 harness。

---

## 16. Tests Executed

| Suite | Result |
|-------|--------|
| `npm run build:main` | PASS |
| `lattice-fine-span-runtime.test.ts` | PASS |
| `phase2-path-harness.test.ts` | PASS |
| `ltr-fine-span-generator.test.ts` | PASS |
| inject-fallback / enumerate / materialize / connectivity-path-vote-bind | PASS |

---

## 17. dialog_200 Offline Results

Probe：`docs/tone-v2/_audit_scratch/step2-lattice-production-entry-dialog200-probe.mjs`  
Summary：`docs/tone-v2/_audit_scratch/step2_lattice_production_entry/dialog_200_summary.json`

| Metric | Value |
|--------|-------|
| casesTotal | 200 |
| casesWithAtLeastOneCompletePath | **200** |
| casesWithZeroCompletePath | **0** |
| casesRequiringFallback | 200 |
| maxPathCount | 4 |
| materializationFailures | 0 |
| coverageFailures | 0 |
| failCases | [] |
| elapsedMs | ~15554 |

验收重点满足：全部 case 稳定生成 ≥1 条无 gap、无 overlap complete path（允许 fallback）。

---

## 18. Remaining Production Integration Work

Step 3+：

```text
将 orchestrator 的 Fine Span 入口从 runLtrFineSpanGeneration
切换为 runLatticeFineSpanGeneration
→ Path-local Vote / Assembly / Cross-Path Merge / ≤16 / KenLM
```

本轮明确未做：feature flag、shadow、双链路、LTR fallback。

---

## 19. Target List Completion

| ID | Status |
|----|--------|
| T1 Harness 分类拆分 | Done |
| T2 Production Entry | Done |
| T3 真实 Recall | Done |
| T4 Window / LexicalEdge | Done |
| T5 Fallback coverage | Done |
| T6 Path enumeration | Done |
| T7 PathFineSpanView | Done |
| T8 Harness → Production | Done |
| T9 单测 + dialog_200 | Done |
| T10 Orchestrator 仍 LTR | Done |

---

## 20. Check List Completion

- [x] harness 逻辑分类
- [x] production runtime 文件
- [x] Entry 不 import harness / LTR
- [x] Harness import Production Entry
- [x] 真实 Recall / LexicalEdge / formal fallback
- [x] 无 fallback-to-LTR
- [x] Complete Path 无 gap / overlap；deterministic；硬上限
- [x] PathFineSpanView[]
- [x] Runtime trace 最小化
- [x] 未改 orchestrator / 无 flag / 无 shadow
- [x] 编译、单测、harness、LTR、dialog_200 通过

---

## 21. Final Verdict

```text
STEP2_PASS
```

满足：独立无 LTR/Harness 依赖的 Lattice Production Entry；Phase2 反向依赖；Recall→Edge→fallback→Path→PathFineSpanView 闭环；dialog_200 全量 ≥1 complete path；生产主链未改。
