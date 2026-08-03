<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Regression/FW_Repair_V4_Step5_Lattice_Trace_Diagnostics_Acceptance_Consolidation_Report_2026_07_30.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Step 5 Lattice Trace, Diagnostics and Acceptance Contract Consolidation Report

| Field | Value |
|------|-------|
| Status | **STEP5_PASS** |
| Date | **2026-07-30** |
| Stage | Step 5 / 7 |
| Authority | Runtime SSOT Contract V1.2 · Multi-Path Lexical Lattice Architecture V1.0.0 · Tone Evidence / Mapping Contract V1.0 |
| Scope | Runtime DTO / Trace / Diagnostics / Architecture Compliance / Acceptance / Static Freeze Gates |
| Forbidden this round | Lattice/Recall/Path/Vote/Bucket/Assembly/Merge/KenLM/Tone algorithm changes; LTR file body deletion |

---

## 1. Executive Summary

本轮在**不改变生产算法行为**的前提下，完成 Lattice 主链 Trace / Diagnostics / Architecture Compliance / Acceptance 收敛：

- 生产命名去除 Formal Commit / LTR / Step3 临时语义；
- `LatticeFineSpanTrace` / `PathAssemblyTrace` / `CrossPathMergeTrace` / Architecture Compliance 与 Runtime SSOT V1.2 对齐；
- `accept:runtime-ssot` + `freeze-contract` 静态门覆盖 Lattice Ownership / Cross-Path Owner / KenLM prefilled / Legacy ban；
- dialog_200 Trace 硬门全部通过；LTR runtime call = 0；
- 形成 Step 6 精确 LTR 删除清单。

**最终结论：`STEP5_PASS`**

---

## 2. Runtime DTO Field Audit

| DTO / Surface | Field | Classification | Producer | Consumer | Business decision? | Notes |
|---|---|---|---|---|---|---|
| `PathFineSpan` | span ranges / candidates / selectionReason | KEEP_RUNTIME | materialize / Lattice | Vote / Assembly / Tone rebind | Yes (range/candidates) | Unified Path DTO |
| `PathFineSpan.toneRebindTrace` | tone rebind diagnostics | KEEP_TRACE_ONLY | `rebindToneForFineSpan` | Trace / diagnostics | No | Renamed fields |
| `PathFineSpanToneRebindTrace.pathRaw*` | path raw range | RENAME_LATTICE | tone rebind | diagnostics | No | was `formalRaw*` |
| `PathFineSpanToneRebindTrace.recomputedAfterRebind` | rebind done | RENAME_LATTICE | tone rebind | compliance | No | was `recomputedAfterCommit` |
| `PathFineSpanView.pathFineSpans` | materialized spans | KEEP_RUNTIME | Lattice | orchestrator | Yes | |
| `LatticeFineSpanTrace.*` | window/edge/path/cap facts | KEEP_TRACE_ONLY | lattice runtime | orchestrator / accept | No | Contract frozen |
| `PathAssemblyResult` | path-local assembly payload | KEEP_RUNTIME | orchestrator | Cross-Path merge | Yes (candidates) | |
| `PathAssemblyTrace.*` | path-local vote/bucket facts | KEEP_TRACE_ONLY | orchestrator | diagnostics | No | Trace must not feed KenLM |
| `CrossPathMergeTrace.*` | merge/dedup/cap facts | KEEP_TRACE_ONLY | mergeCrossPath… | metrics / accept | No | + contract metadata |
| `kenlmSentenceCandidates.combinations` | KenLM pool | KEEP_RUNTIME | Cross-Path merge | fw-detector-v4-path | Yes | unique Owner |
| `architectureCompliance.*` | architecture facts | KEEP_TRACE_ONLY / ACCEPTANCE | orchestrator | accept gates | No | SSOT-aligned |
| LTR `formalSpans` / `commitBestFormalFineSpan` | LTR-local | DELETE_LATER_WITH_LTR | LTR module | LTR tests only | N/A (not production) | Whitelisted |
| `mergeCrossBucketSentenceCandidates` | legacy helper | TEST_ONLY / DELETE_LATER_WITH_LTR | tests | tests | No in production | Not KenLM Owner |
| Phase harness `productionCutover` / `harnessOnly` | harness labels | KEEP (harness) | phase1/2 harness | harness only | No | Not production Trace |
| dual-field aliases | — | DELETE_LEGACY | — | — | — | Forbidden; none retained |

禁止新增：V2 / Compat / Legacy / Transitional DTO（本轮未新增）。

---

## 3. Removed Legacy Runtime Fields

生产接口 / Trace / Compliance 中移除或停止发出：

| Removed / retired | Replacement |
|---|---|
| `formalSpans` (assemble / buildFwSpans params) | `pathFineSpans` |
| `[FORMAL_POOL]` | `[PATH_FINE_SPAN_POOL]` |
| `formalRawStart` / `formalRawEnd` | `pathRawStart` / `pathRawEnd` |
| `recomputedAfterCommit` | `recomputedAfterRebind` |
| `toneRecomputedAfterCommit` | `toneRecomputedAfterRebind` |
| `crossPathMergeOwner: 'orchestrator'` | `'mergeCrossPathSentenceCandidates'` |
| `coverageComplete` | `coverageStatus` |
| Lattice Trace `capEvents` | `pathCapEvents` |
| Lattice Trace `physicalSqlStatementCount` (trace) | `sqlQueryCount` |
| `formalFineSpanCount` (diagnostics type) | `pathFineSpanCount` |
| Step3 temporary collection fields | already removed in Step 4; static ban retained |

---

## 4. Renamed Path Fields

| Before | After |
|---|---|
| `formalSpans` (production API param) | `pathFineSpans` |
| `formalRawStart/End` | `pathRawStart/End` |
| `optionRawStart/End` | `preRebindCandidateRawStart/End` |
| `recomputedAfterCommit` | `recomputedAfterRebind` |
| `fineSpanCount` (PathAssemblyTrace) | `pathFineSpanCount` |
| `domainAwarePickFromFormal` | `domainAwarePickFromPathFineSpan` |

无 dual-field alias（禁止 `formalSpans: pathFineSpans`）。

---

## 5. LatticeFineSpanTrace Contract

正式字段：

```text
windowCount, blockedWindowCount, recallableWindowCount
lexicalEdgeCount, fallbackEdgeCount, edgeCountAfterFallback
fallbackInjectionCount, fallbackInjectionRanges
completePathCount, retainedCompletePathCount, prunedPathCount
materializedPathCount
coverageStatus: 'complete' | 'incomplete'
logicalWindowRecallCount
sqlQueryCount
pathCapEvents
```

不含：LTR cursor / option rank / winner commit / phase1|2 labels / harnessOnly / productionCutover / audit case id / full rejected edge dump。

---

## 6. PathAssemblyTrace Contract

每条 Path：

```text
pathId, boundaryKey
pathFineSpanCount, fallbackSpanCount
toneEvidenceAvailableCount, toneEvidenceUnavailableCount
domainScores, retainedDomains
bucketCount, bucketCandidateCounts
assemblyCandidateCount
toneRebindOk
```

原则：Trace 可记录 domain facts；KenLM Input DTO 不携带 domain metadata；Trace 不参与 Vote / Bucket / Assembly / Merge / KenLM score。

---

## 7. CrossPathMergeTrace Contract

```text
crossPathInputCandidateCount
crossPathDuplicateCount
crossPathUniqueCandidateCount
crossPathOutputCandidateCount
crossPathTruncatedCount
globalCandidateCap
kenlmInputSource = cross_path_merge
dedupKey = exact_text
duplicateRetention = first_wins
collectionOrder = path_bucket_candidate
```

未改：first-wins、exact-text、dedup-before-cap、global ≤16、无分数合并。

---

## 8. Architecture Compliance Contract

生产 `metrics.architectureCompliance`：

```text
generatorMode: multi_path_lattice
fineSpanOwner: segmentation_path
voteScope: per_path
assemblyScope: per_path
crossPathMergeOwner: mergeCrossPathSentenceCandidates
candidateCapScope: global
candidateCap: 16 (runtime config)
dedupBeforeCap: true
dedupRetention: first_wins
kenlmInputOwner: cross_path_merge
prefilledCombinationsRequired: true
toneEvidenceOwner: acoustic_tone_slices
ltrRuntimeEnabled: false
toneRecomputedAfterRebind: boolean
(+ retained frozen negatives: beamEnabled=false, contextPriorDecisionApplied=false, …)
```

已删除过渡语义：`temporaryPreStep4Collection` / `productionCutover` / `phase2HarnessOnly` / `fallbackToLtr` / `shadowComparison` / `ltr_soft_boundary` 等（生产路径）。

---

## 9. KenLM Boundary Verification

| Rule | Status |
|---|---|
| `prefilledCombinations: SentenceCombination[]` required | PASS |
| `undefined` forbidden / no primary-bucket rebuild | PASS (`run-fw-sentence-rerank-from-prefilled.ts`) |
| `[]` = explicit empty → fail-open raw | PASS |
| KenLM input = sentence text only | PASS |
| Owner = `mergeCrossPathSentenceCandidates` | PASS |
| No production `mergeCrossBucketSentenceCandidates(` call | PASS |

算法未改：`raw_log_delta` / `minDeltaToReplace` / model / rank。

---

## 10. Tone Evidence Boundary Verification

| Rule | Status |
|---|---|
| Evidence SSOT = `ctx.acousticToneSlices` | PASS (`toneEvidenceOwner`) |
| Strict half-open overlap retained | PASS (no mapping code change) |
| No Tone fill / neighbor borrowing | PASS (diagnostics-only cleanup) |
| Banned counters not restored | PASS |
| Allowed miss reasons retained | PASS |

本轮未修改 Tone 算法。

---

## 11. Acceptance Gate Changes

| Gate | Change |
|---|---|
| `npm run accept:runtime-ssot` | V1.2：Lattice import、禁 LTR、Cross-Path smoke、compliance 字段、生产静态 ban + 文件级 LTR 白名单 |
| `npm run accept:domain-multibucket-kenlm` | 恢复 runner + fixture；要求 `prefilledCombinations`；Electron ABI wrapper；合同硬门 |
| `freeze-contract.test.ts` | 新增 `GATE-STEP5-LATTICE-TRACE` |

未新建：`accept:runtime-ssot-v2` / `accept:lattice-final` / `accept:new-runtime`。

---

## 12. Static Scan Rules

生产扫描文件（0 命中）：

```text
runLtrFineSpanGeneration
ltr_soft_boundary
ltr_fine_span
ltr.formalSpans
ltr.trace
temporaryPreStep4Collection
STEP3_TEMPORARY
fallbackToLtr
shadowLtr
FormalFineSpan
toneCommitTrace
```

**文件级白名单（Step 6 可删，有限集合）：**

1. `ltr-fine-span-generator.ts`
2. `ltr-fine-span-generator.test.ts`
3. `phase0-coordinate-ssot.test.ts`

禁止：ignore all tests / ignore all legacy folders / ignore string occurrence。

---

## 13. Runtime SSOT Alignment

唯一正式文件：`docs/tone-v2/Runtime_SSOT_Contract_Freeze.md`（V1.2）

已对齐：§4 Unique Main Chain · §17 Cross-Path Merge · §18 Global ≤16 · §19 KenLM · §20 prefilledCombinations · §21 KenLM input boundary · §30 Freeze Statement（V1.2）。

冲突表述清理：FormalFineSpan 作为 Fine Span SSOT；LTR unique commit；utterance-wide mixed Path Vote；higher-score duplicate retention 作为生产 Owner；KenLM rebuild primary bucket。

未创建：`Runtime_SSOT_*Final/Latest/(7).md`。

---

## 14. Modified Files

生产 / 合同（主要）：

- `path-fine-span-types.ts`
- `tone-fine-span-rebind.ts`
- `assemble-domain-aware-span-sets.ts`
- `build-fw-spans-from-coarse-assembly-v4.ts`
- `lattice-fine-span-runtime.ts`
- `phase2-path-harness.ts`（映射新 Trace 字段）
- `merge-cross-path-sentence-candidates.ts`
- `span-assembly-v4-orchestrator.ts`
- `v4-types.ts` / `v4-diagnostics-types.ts`
- `build-sentence-candidates.ts`（legacy helper 标注）
- `freeze-contract.test.ts` + 相关单测
- `scripts/runtime-ssot-acceptance.cjs`
- `scripts/run-domain-multibucket-kenlm-acceptance-wrapper.cjs`
- `tests/experiments/run-domain-multibucket-kenlm-acceptance.cjs`（恢复 + Step5 边界）
- `tests/experiments/fine_span_domain_bucket_acceptance.jsonl`（恢复）
- `package.json`（accept wrapper）
- `docs/tone-v2/Runtime_SSOT_Contract_Freeze.md`
- probe：`docs/tone-v2/_audit_scratch/step5-lattice-trace-dialog200-probe.mjs`

---

## 15. Tests Executed

```text
npm run build:main
jest freeze-contract / lattice-fine-span-runtime / merge-cross-path /
     orchestrator.step3 / assemble / p5-blocking / phase2-path-harness /
     materialize-path-fine-spans / fine-span-domain-presence-vote /
     domain-presence-vote-acceptance / phase2-path-cap-stress
```

全部通过。

---

## 16. Acceptance Command Results

| Command | Result |
|---|---|
| `npm run accept:runtime-ssot` | **ACCEPTANCE_PASS** |
| `npm run accept:domain-multibucket-kenlm` | **ACCEPTANCE_PASS**（integration ACTIVE；质量非冻结） |

---

## 17. dialog_200 Trace Results

Probe：`docs/tone-v2/_audit_scratch/step5-lattice-trace-dialog200-probe.mjs`  
Summary：`docs/tone-v2/_audit_scratch/step5_lattice_trace/dialog_200_summary.json`

| Metric | Value |
|---|---|
| casesTotal | 200 |
| orchestratorSuccess | 200 |
| latticeTracePresent | 200 |
| pathAssemblyTracePresent | 200 |
| crossPathTracePresent | 200 |
| architectureCompliancePresent | 200 |
| casesWithLegacyTraceField | **0** |
| casesWithUndefinedPrefilledCombinations | **0** |
| casesWithKenlmInputOver16 | **0** |
| casesWithDuplicateKenlmText | **0** |
| ltrRuntimeCallCount | **0** |
| hardGatePass | **true** |

---

## 18. Unique Candidate Quality Observation

**这是质量观察，不是 Step 5 阻塞项。**

| Observation | Value |
|---|---|
| uniqueCandidateCountDistribution | `{ "1": 200 }` |
| pathsPerCaseDistribution | 1→170, 2→21, 4→9 |
| pathCandidateCountsDistribution | 多数 Path 本地生成 1–4 条 |
| distinctTextsBeforeCrossPathDedup | **全部 case = 1** |

解释：即便存在多 Path / 多候选计数，**去重前全库唯一文本数仍为 1**——各 Path/Bucket 产出同文本，而非“每条 Path 永远只有一个候选槽”的单一原因。  
本轮**禁止**为增加多样性修改 Recall / Path / Vote / Bucket / Assembly / Dedup / Cap。

---

## 19. Remaining LTR Files and References

仍保留（本轮未删）：

| Path | Role |
|---|---|
| `ltr-fine-span-generator.ts` | LTR 本体 |
| `ltr-fine-span-generator.test.ts` | LTR 专属测试 |
| `phase0-coordinate-ssot.test.ts` | 仍调用 LTR |
| `phase1-window-edge-harness.test.ts` | 使用 `generateLocalOptionsAtCursor` |

生产 orchestrator / lattice runtime / merge / KenLM：**零** `runLtrFineSpanGeneration` 运行依赖。

---

## 20. Step 6 Exact Delete List

| Action | Target | Note |
|---|---|---|
| **DELETE** | `span-assembly-v4/ltr-fine-span-generator.ts` | LTR 本体 |
| **DELETE** | `span-assembly-v4/ltr-fine-span-generator.test.ts` | LTR 测试 |
| **DELETE** or rewrite | `phase0-coordinate-ssot.test.ts` LTR 调用段 | 改为 Lattice-only 断言或删除 LTR 用例 |
| **REWRITE** | `phase1-window-edge-harness.test.ts` | 去掉 `generateLocalOptionsAtCursor` import |
| **DELETE_LATER** | `mergeCrossBucketSentenceCandidates`（若无 Path-local 正式职责） | 现为 TEST_ONLY；生产已不用 |
| **HISTORICAL** | SoftBoundary / LTR 历史报告 | 标 SUPERSEDED / HISTORICAL，不改历史结论 |
| **KEEP** | `runLatticeFineSpanGeneration` / PathFineSpan / Cross-Path merge | 生产主链 |
| **KEEP** | Acceptance 白名单扫描逻辑 | 删除后应变为全仓 0 命中（可去掉白名单） |

证明生产不依赖 LTR：orchestrator 静态/运行时门 + dialog_200 `ltrRuntimeCallCount=0` + accept 静态 ban。

---

## 21. Target List Completion

| ID | Status |
|---|---|
| T1 Runtime DTO audit | DONE |
| T2 Formal/Commit rename cleanup | DONE |
| T3 LatticeFineSpanTrace freeze | DONE |
| T4 PathAssemblyTrace freeze | DONE |
| T5 CrossPathMergeTrace freeze | DONE |
| T6 Architecture Compliance | DONE |
| T7 KenLM prefilled boundary | DONE |
| T8 Tone Evidence boundary | DONE |
| T9 Acceptance gates | DONE |
| T10 Runtime SSOT doc | DONE |
| T11 dialog_200 Trace | DONE |
| T12 Step 6 delete list | DONE |

---

## 22. Check List Completion

- [x] Runtime DTO 字段已逐项分类
- [x] 不再存在 FormalFineSpan 生产类型
- [x] 不再存在 formalCommit 生产命名
- [x] 不再存在 toneCommitTrace
- [x] LatticeFineSpanTrace 已收敛
- [x] PathAssemblyTrace 已收敛
- [x] CrossPathMergeTrace 已收敛
- [x] Trace 不参与业务决策
- [x] Architecture Compliance 与 SSOT 一致
- [x] generatorMode = multi_path_lattice
- [x] voteScope = per_path
- [x] assemblyScope = per_path
- [x] candidateCapScope = global
- [x] candidateCap = 16
- [x] dedupBeforeCap = true
- [x] KenLM Input Owner 唯一
- [x] prefilledCombinations 必填
- [x] undefined prefilled 被禁止
- [x] 不存在 primary bucket rebuild
- [x] Tone SSOT 仍为 acousticToneSlices
- [x] half-open overlap 未改变
- [x] 无 Tone fill / neighbor borrowing
- [x] accept:runtime-ssot 通过
- [x] accept:domain-multibucket-kenlm 通过
- [x] freeze-contract tests 通过
- [x] dialog_200 Legacy Trace 字段 = 0
- [x] dialog_200 KenLM input 全部 ≤16
- [x] dialog_200 KenLM input 全部无重复
- [x] LTR runtime call count = 0
- [x] 已形成 Step 6 删除清单
- [x] 未改变生产算法结果（仅命名/Trace/门禁）

---

## 23. Final Verdict

```text
STEP5_PASS
```

生产 Runtime DTO、Trace、Diagnostics、Compliance 均以 Lattice / SegmentationPath 为唯一 Ownership；Runtime SSOT V1.2 与代码一致；Acceptance 可阻止 LTR、混合 Path Vote、旧 Cross-Bucket KenLM Owner、undefined prefilled、>16、重复 KenLM Input 与 Tone SSOT 回退；dialog_200 Legacy Trace = 0；LTR runtime call = 0；Step 6 删除清单可执行；无算法行为变化。
