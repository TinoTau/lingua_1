<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Development/FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Phase1_Window_Edge_Development_Report_2026_07_26.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Multi-Path Lexical Lattice V1 · Phase 1 Window + Edge Development Report

| Field | Value |
|-------|-------|
| Date | 2026-07-26 |
| Scope | Phase 1 only: `buildLexicalWindowQueries` → Lattice hard-block → `recallTopKForWindows` → `buildLexicalEdges` |
| Architecture SSOT | `FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md` |
| Contract | Implementation Contract V1.0.0 |
| Pre-dev audit | Phase 1 Window Edge Pre-Development Audit 2026-07-26 |
| Production cutover | **NONE** |
| Phase 2 | **NOT STARTED** |

---

## 1. Executive Summary

| 项 | 结论 |
|----|------|
| Phase 1 是否完成 | **YES** — WindowQuery / Recall 复用 / LexicalEdge / 独立 Harness / 测试 / dialog_200 offline probe 均已落地 |
| 是否修改生产主链 | **NO** — `span-assembly-v4-orchestrator` 未导入、未调用任何 Phase 1 Lattice 模块；无 feature flag；无 shadow 双链 |
| 是否进入 Phase 2 | **NO** — 未实现 SegmentationPath / fallback Edge / Path Vote / Path Assembly |

**Final Decision：**

```text
PHASE 1 COMPLETE — READY FOR PHASE 1 ACCEPTANCE AUDIT
```

---

## 2. Files Changed

| 文件 | 符号 | 修改原因 | 职责 |
|------|------|----------|------|
| `span-assembly-v4/window-construction-core.ts` | `buildWindowDescriptorForRange`, `theoreticalLexicalWindowCount`, Lattice length 常量 | **NEW** — 抽取纯窗口构造核 | 音节/raw/text/pinyin/coarse metadata/`windowId`；无 commit/cursor/vote |
| `span-assembly-v4/build-lexical-window-queries.ts` | `buildLexicalWindowQueries`, `LexicalWindowQuery` | **NEW** | 全句连续 1..5 Window；`windowId=start:end`；允许空 coarse refs |
| `span-assembly-v4/lattice-hard-block-filter.ts` | `latticeHardBlockFilter` | **NEW** | Lattice 独立硬阻断（Latin/gap/punct/non-CJK/ASR）；**不**因 coarse cross 硬杀 |
| `span-assembly-v4/build-lexical-edges.ts` | `buildLexicalEdges`, `LexicalEdge` | **NEW** | 同边界唯一 lexical Edge；保持 Recall 顺序；无 fallback |
| `span-assembly-v4/phase1-window-edge-harness.ts` | `runPhase1WindowEdgeHarness` | **NEW** | 独立 Harness 主链 + diagnostics/trace |
| `span-assembly-v4/phase1-window-edge-harness.test.ts` | 合同/确定性/隔离测试 | **NEW** | Window 完整性、coarse 软边界、Latin gap、Edge、Recall key、orchestrator 隔离 |
| `span-assembly-v4/phase1-window-edge-harness.live.test.ts` | 活词库集成测试 | **NEW** | 单字 Edge / 确定性 / domains+termId（ABI mismatch 时 skip） |
| `span-assembly-v4/ltr-fine-span-generator.ts` | `buildWindowAt` → core | 复用构造核 | **LTR 语义不变**：`allowEmptyCoarseRefs=false`，`hardBlockOnBoundaryCross=true` |
| `span-assembly-v4/generate-global-windows.ts` | 改用 core | 去重构造逻辑 | 仍为 min=2 历史路径；生产 orchestrator 不调用 |
| `span-assembly-v4/v4-types.ts` | `WindowCandidate.termId?` | 薄透传 | Edge merge / 身份；不新建 Candidate DTO |
| `span-assembly-v4/recall-topk-for-windows.ts` | `bindLexiconHitsToWindow` | `termId = hit.hotword.id` | 仅绑定层一行透传；Recall 业务未改 |
| `docs/tone-v2/_audit_scratch/phase1-window-edge-dialog200-probe.mjs` | probe | **NEW** | dialog_200 GT offline Phase 1 测量 |
| `docs/tone-v2/_audit_scratch/lattice_v1_phase1/*` | summary / results | **NEW** | probe 产物 |

**未改：** orchestrator 主链、Vote、Assembly、KenLM、CompatibilityGraph、SQLite schema/index/临时表/Batch SQL、`blockedFilter` LTR 行为、Recall Exact/Tone/Fuzzy/TopK/minPrior/domain scope。

---

## 3. Final Phase 1 Call Graph

```text
runPhase1WindowEdgeHarness(rawText, runtime, …)
  → buildUtteranceSyllableCoordinate
  → partitionCoarseSpans   (或测试注入 coarseSpans)
  → buildLexicalWindowQueries          // full 1..5；windowId=start:end
       → buildWindowDescriptorForRange // allowEmptyCoarseRefs；无 coarse hard-block
  → latticeHardBlockFilter             // 非 LTR blockedFilter；跨 coarse ≠ hard block
  → createUtteranceRecallContext
  → recallTopKForWindows               // 既有实现；surfaceText=windowText
  → group candidates by windowId (window 顺序)
  → buildLexicalEdges                  // 仅非空 candidates；edgeId=start:end
  → Phase1WindowEdgeHarnessResult + diagnostics/trace
  → releaseUtteranceRecallContext
```

生产主链（不变）：

```text
runSpanAssemblyV4Orchestrator
  → runLtrFineSpanGeneration → blockedFilter → recallTopKForWindows → …
```

---

## 4. Window Construction

| 项 | 说明 |
|----|------|
| 复用 | `collectDistinctCoarseSpanIds`、`syllableRangeToRawCharRange`、`GlobalWindowDescriptor`、`UtteranceSyllableCoordinate` |
| 抽取 | `buildWindowDescriptorForRange`（纯核） |
| 未复制 | 未整段复制 `buildWindowAt` / `generateGlobalWindows`；LTR 改为调用核并保留旧开关语义 |
| Lattice 专属 | min=1（`LATTICE_WINDOW_MIN_SYLLABLES`），不改 `V4_LIMITS.windowMinSyllables=2` |

---

## 5. Window Contract

| 规则 | 实现 |
|------|------|
| 长度 1..5 | Lattice 双层循环 `start`×`end`；`theoreticalLexicalWindowCount` 校验（N=6→20） |
| `[start,end)` | half-open 音节坐标 |
| `windowId` | `` `${syllableStart}:${syllableEnd}` ``；禁止 UUID/随机/下标 |
| coarse refs | 允许 `spanIds=[]`；不因此删除 Window |
| blocked | Lattice：`latticeHardBlockFilter`（Latin/gap/punct/non-CJK/ASR）；跨 coarse 仅 metadata |
| LTR blocked | `blockedFilter` 仍硬阻断 `boundaryCrossCount > max`（生产不变） |

**规范映射说明（非冲突改架构）：** Architecture `LexicalWindowQuery` 字段名与运行时 `GlobalWindowDescriptor` 不完全同名（如 `pinyinKey`↔`windowPinyinKey`，`coarseBoundaryRefs`↔`spanIds`）。按 Audit：**以 GWD 为载体 + 类型别名**，派生字段不重复存储。Architecture 语义优先；未引入第二套 Window DTO。

---

## 6. Recall Reuse

| 文件 | 变更 |
|------|------|
| `recall-topk-for-windows.ts` | **仅** `termId` 透传；编排/SQL/TopK/score/domain **未改** |
| `utterance-recall-cache.ts` | **未改**；Harness 创建独立 `UtteranceRecallContext` |
| `recall-span-topkv3` / LexiconRuntimeV2 | **未改** |
| `surfaceText` | **保留** — `surfaceText: window.windowText` 仍进入 Canonical Key |

---

## 7. LexicalEdge Contract

| 规则 | 实现 |
|------|------|
| `edgeId` | `` `${start}:${end}` `` |
| 唯一边界 | `seenBoundary`；同 `(start,end)` 一 Edge |
| Candidate 顺序 | 保持 Recall 输出顺序；dedupe 保留首次 |
| Candidate identity | merge 键优先 `termId`，否则 `candidateId`；禁止仅按 `replacement` 合并 |
| `domains[]` | 完整保留（绑定层既有 freeze 拷贝） |
| fallback | **未实现**；无候选 → 无 Edge（trace: `windowNoCandidate`） |

---

## 8. Test Results

| Suite | Cases | Result |
|-------|-------|--------|
| `phase1-window-edge-harness.test.ts` | 18 | **PASS** |
| `phase1-window-edge-harness.live.test.ts` | 3 | **PASS** |
| `phase0-coordinate-ssot.test.ts` | (回归) | **PASS** |
| `phase1-utterance-cache.test.ts` | (surfaceText/key) | **PASS** |
| `generate-global-windows.test.ts` | (回归) | **PASS** |
| `ltr-fine-span-generator.test.ts` | (LTR 行为) | **PASS** |
| `freeze-contract.test.ts` | (冻结合同) | **PASS** |

覆盖要点：N=1/2/5/6 窗口数、长度边界、windowId 唯一/确定性、空 coarse、跨 coarse 不硬杀、Latin/CJK（SOHO / USB / T2）、Edge 多候选与 domains、无候选无 fallback、Recall key surface/domain/tone、orchestrator 零接线静态合同。

---

## 9. dialog_200 Harness Result

产物：`docs/tone-v2/_audit_scratch/lattice_v1_phase1/dialog_200_phase1_summary.json`

| 指标 | 值 |
|------|-----|
| completed / failed | **200 / 0** |
| windowCount sum / avg / min / max | 20470 / 102.35 / 65 / 180 |
| blockedCount sum / avg | 5025 / 25.125 |
| uniqueRecallKeys sum / avg | 15086 / 75.43 |
| cacheHit / cacheMiss | 284 / 15086 |
| physicalSql sum / avg | 34105 / 170.525 |
| edgeCount sum / avg | 1600 / 8 |
| latency P50 / P95 / P99 | 88.3 / 163.0 / 187.4 ms |
| total wall | ~19.1 s |
| heap delta | ~19.0 MB |

**明确声明：** Harness-only measurement · No production cutover · No WAV/ASR/Tone full E2E.

### SQL budget (`maxSqlPerUtterance=150`)

未静默忽略：diagnostics + trace `sqlBudgetExhausted`。本轮**未**调高预算。

受影响 case（5）：

| caseId | skipped | recallable |
|--------|---------|------------|
| d019 | 15 | 165 |
| d064 | 15 | 165 |
| d109 | 15 | 165 |
| d154 | 15 | 165 |
| d199 | 15 | 165 |

---

## 10. Production Isolation Proof

1. **静态合同测试**：`phase1-window-edge-harness.test.ts` 读取 `span-assembly-v4-orchestrator.ts`，断言不存在：
   - `buildLexicalWindowQueries` / `buildLexicalEdges` / `runPhase1WindowEdgeHarness` / `latticeHardBlockFilter`
   - feature flag / shadow lattice 关键字
2. **Grep 复核**：orchestrator 源文件无上述符号。
3. **无运行时开关**：未新增 enableLattice / dual-path flag。
4. **调用面**：Phase 1 模块仅 tests + `phase1-window-edge-dialog200-probe.mjs`。

---

## 11. Regression Result

| 项 | 结果 |
|----|------|
| Phase 0 coordinate SSOT | PASS |
| Latin/CJK gap（Lattice + LTR） | PASS（USB 前缀 Latin 不进音节窗属 Coordinate SSOT；中缀 SOHO/T2 硬阻断） |
| Recall key + `surfaceText` | PASS |
| `domains[]` 完整保留 | PASS（单测 + live） |
| LTR existing tests | PASS（`ltr-fine-span-generator` / freeze-contract） |
| `blockedFilter` boundary_cross 生产语义 | PASS（仍硬阻断） |

---

## 12. Remaining Items（仅后续 Phase）

```text
SegmentationPath
fallback Edge injection
Path Enumeration
Path Vote
Path Assembly
Global Candidate Allocation
KenLM metadata wiring
Production orchestrator cutover（独立验收后）
SQL budget 策略（是否批准调高 / Batch SQL — 非本轮）
```

本轮 Target List / Check List 必需项均未推迟。

---

## 13. Final Decision

```text
PHASE 1 COMPLETE — READY FOR PHASE 1 ACCEPTANCE AUDIT
```

不得视为 `READY FOR PHASE 2`。Phase 2 须在独立验收通过后开启。
