<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Development/FW_Repair_V4_Step1_PathFineSpan_Contract_Extraction_Development_Report_2026_07_29.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Step 1 Path Fine Span Contract Extraction Development Report

| Field | Value |
|-------|-------|
| Date | 2026-07-29 |
| Step | 1 / 7 |
| Scope | Path Fine Span 类型 Ownership 从 LTR module 彻底拆出 |
| Verdict | **STEP1_PASS** |
| Not | 接入生产 Lattice · 删除 LTR · 改 Vote / Assembly / KenLM / Tone |

---

## 1. Executive Summary

本轮将 Fine Span Runtime DTO 从 `ltr-fine-span-generator.ts` 拆出，建立 Path ownership 模块 `path-fine-span-types.ts`（`PathFineSpan` / `PathFineSpanView`）。Lattice / Path materialization / Vote–Assembly 类型消费方不再 import LTR。LTR 仍为生产入口，但临时直接构造统一的 `PathFineSpan[]`——**不是**第二套 DTO，也**不是** adapter。

```text
STEP1_PASS
```

---

## 2. Before Architecture

```text
ltr-fine-span-generator.ts
  owns FormalFineSpan (+ assertFormalFineSpansNonOverlapping)

lattice-path-types.ts          → import FormalFineSpan from LTR  ✗ 依赖倒置
materialize-formal-fine-spans  → import FormalFineSpan from LTR  ✗
assemble-domain-aware-span-sets→ import FormalFineSpan from LTR  ✗
tone-commit-rebind             → import FormalFineSpan from LTR  ✗
build-fw-spans-...             → import FormalFineSpan from LTR  ✗
```

结果：即使未来切换 Lattice 生产主链，也无法删除 LTR 文件。

---

## 3. FormalFineSpan Field Audit

源类型（迁移前，位于 LTR module）：

| Field | Producer | Consumers | Path-inherent? | LTR-commit-only? | Derivable? | Runtime DTO? | Classification |
|-------|----------|-----------|----------------|------------------|------------|--------------|----------------|
| `spanId` | LTR commit / Path materialize | Pool / diagnostics / traces | Yes (identity) | No | No | Yes | **KEEP_AS_PATH_CONTRACT** |
| `rawStart` / `rawEnd` | Edge candidates or syllable→raw map | Tone rebind / FW diag / Assembly text slice | Yes (char range) | No | Partially from syllables+coordinate | Yes（确有消费） | **KEEP_AS_PATH_CONTRACT** |
| `syllableStart` / `syllableEnd` | Path edge / LTR winner | Overlap assert / cursor advance (LTR) / Tone | Yes | No | No | Yes | **KEEP_AS_PATH_CONTRACT** |
| `coarseSpanIds` | Window / edge candidates | Boundary window trace / diagnostics | Path-local fact | No | From candidates | Yes | **KEEP_AS_PATH_CONTRACT** |
| `boundaryCrossCount` | From coarseSpanIds cardinality | Assembly / compliance / limits | Path-local | No | From coarseSpanIds | Yes（下游直接读） | **KEEP_AS_PATH_CONTRACT** |
| `windowSource` | Edge kind / lexical completeness | Pool / Vote / Assembly | Path materialization provenance | LTR also maps none→fallback | Partially | Yes | **KEEP_AS_PATH_CONTRACT** |
| `candidates[]` | Recall on edge/window | Vote / Assembly / Tone rebind | Path edge fact | No | No | Yes | **KEEP_AS_PATH_CONTRACT** |
| `selectionReason` | LTR ranking **or** `lattice_path_edge` | Diagnostics / compliance | Provenance tag | LTR values are commit outcomes | No | Yes（保留；LTR 取值过渡期仍可出现） | **KEEP_AS_PATH_CONTRACT** |
| `toneCommitTrace` | `rebindToneAfterFormalCommit` | Orchestrator compliance flag | No — post-span diagnostics | Name was LTR-era | No | Diagnostics only | **MOVE_TO_PATH_TRACE** → rename `toneRebindTrace` / `PathFineSpanToneRebindTrace` |

### LTR 专属语义检查（未迁入 Path 核心合同）

| Symbol | Location after Step 1 |
|--------|------------------------|
| `cursor` | `LtrFineSpanStepTrace` only |
| option ranking / `rankingBeforePrior` / `rankingAfterPrior` | LTR step trace |
| `priorChangedWinner` | LTR step trace |
| `LtrFineSpanOption` / optionRank / tiebreak process | LTR module |
| `commitBestFormalFineSpan` (function name) | LTR-local API（仍输出 PathFineSpan） |
| `generatorMode` / `formalOverlapCount` | Orchestrator architectureCompliance / LTR trace |
| `selectedOption` as option object | Not on PathFineSpan |

**Deleted from Path Runtime DTO ownership of LTR file:** type `FormalFineSpan` itself, `assertFormalFineSpansNonOverlapping` export from LTR.

**Not present on FormalFineSpan historically** (confirmed absent — no migration risk): `optionRank`, `shorterExactTiebreak` as fields, `fallbackCommit` boolean, `stepIndex`, `generatorMode`, LTR trace reference pointer.

---

## 4. New Type Ownership

```text
path-fine-span-types.ts   ← SegmentationPath 物化结果 Ownership
  PathFineSpan
  PathFineSpanView { pathId, boundaryKey, pathFineSpans }
  PathFineSpanToneRebindTrace
  assertPathFineSpansNonOverlapping
```

命名选择：

```text
FormalFineSpan → PathFineSpan
```

原因：去掉 LTR 时代 “Formal Commit” 语义；新名称明确属于 Path / Lattice 物化结果，而非 LTR cursor commit 产物。

**单一 Runtime DTO：** 仅 `PathFineSpan`。LTR `LtrFineSpanGenerationResult.formalSpans` 字段名保留（生产 shape），类型为 `PathFineSpan[]`。

---

## 5. Type and File Rename Map

| Before | After |
|--------|-------|
| `FormalFineSpan` | `PathFineSpan` |
| `toneCommitTrace` | `toneRebindTrace` (`PathFineSpanToneRebindTrace`) |
| `assertFormalFineSpansNonOverlapping` | `assertPathFineSpansNonOverlapping` |
| `materialize-formal-fine-spans.ts` | `materialize-path-fine-spans.ts` |
| `materializeFormalFineSpans` | `materializePathFineSpans` |
| view.`formalFineSpans` | view.`pathFineSpans` |
| `tone-commit-rebind.ts` | `tone-fine-span-rebind.ts` |
| `rebindToneAfterFormalCommit` | `rebindToneForFineSpan` |
| `coarseSpansAsFormalFineSpansForTests` | `coarseSpansAsPathFineSpansForTests` |
| `buildFwSpansFromFormalFineSpans` | `buildFwSpansFromPathFineSpans`（已存在则对齐命名） |

删除（无兼容 re-export）：

- `materialize-formal-fine-spans.ts` / `.test.ts`
- `tone-commit-rebind.ts`

---

## 6. Modified Files

### 新增

- `span-assembly-v4/path-fine-span-types.ts`
- `span-assembly-v4/materialize-path-fine-spans.ts`
- `span-assembly-v4/materialize-path-fine-spans.test.ts`
- `span-assembly-v4/tone-fine-span-rebind.ts`

### 更新（类型 Ownership / 签名）

- `lattice-path-types.ts` — re-export Path types；**零** LTR import
- `ltr-fine-span-generator.ts` — 构造 `PathFineSpan`；移出公共 Fine Span 类型
- `assemble-domain-aware-span-sets.ts`
- `build-fw-spans-from-coarse-assembly-v4.ts`
- `span-assembly-v4-orchestrator.ts` — 仍调用 `runLtrFineSpanGeneration`；tone/build 切到 Path API
- `phase2-path-harness.ts` — `materializePathFineSpans`
- 相关单测（LTR / Path / Vote–Assembly / P5 / Phase2）

### 未改（按本轮禁止）

- Vote 公式 / SameDomain / Assembly 预算 / KenLM / Tone Mapping
- 生产 orchestrator 调用路径（仍 LTR Fine Span generation）
- Phase2 harness 未接入生产

---

## 7. Runtime Behavior Confirmation

```text
runSpanAssemblyV4Orchestrator
  → runLtrFineSpanGeneration        (unchanged entry)
  → rebindToneForFineSpan           (same algorithm; PathFineSpan + toneRebindTrace)
  → runDomainAwareAssembly(PathFineSpan[])
  → buildFwSpansFromPathFineSpans   (signals 仍含 ltr_fine_span，避免诊断字符串漂移)
```

Phase2 harness 仍隔离；orchestrator 仍不 import materialize/enumerate。

---

## 8. LTR Dependency Scan

```bash
rg "ltr-fine-span-generator" electron_node/.../span-assembly-v4
```

**允许出现：**

| File | Reason |
|------|--------|
| `span-assembly-v4-orchestrator.ts` | 当前生产入口 |
| `ltr-fine-span-generator.ts` | 自身 |
| `ltr-fine-span-generator.test.ts` | LTR 单测 |
| `phase0-coordinate-ssot.test.ts` / `phase1-window-edge-harness.test.ts` | LTR 专属/对比测试 |

**不允许且已清零：**

| File |
|------|
| `lattice-path-types.ts` |
| `path-fine-span-types.ts` |
| `materialize-path-fine-spans.ts` |
| `phase2-path-harness.ts` |
| `assemble-domain-aware-span-sets.ts` |
| `tone-fine-span-rebind.ts` |
| `build-fw-spans-from-coarse-assembly-v4.ts` |
| Path enumeration / inject fallback / boundary key 等 Lattice 模块 |

---

## 9. Tests Executed

1. `npm run build:main`（TypeScript 生产编译）
2. Jest：
   - `materialize-path-fine-spans`
   - `ltr-fine-span-generator`
   - `phase2-path-harness`
   - `p5-blocking-repair`
   - `assemble-domain-aware-span-sets`
   - `fine-span-domain-presence-vote`
   - `domain-presence-vote-acceptance`
   - `p5-prior-vote-isolation`
   - `phase0-coordinate-ssot`

---

## 10. Test Results

| Suite group | Result |
|-------------|--------|
| `build:main` | PASS |
| 上述 Jest（9 suites / 66 tests） | **66 passed** |

覆盖：PathFineSpan materialization、candidate/range 保留、非重叠断言、Tone rebind 类型兼容、LTR 生产单测回归。

---

## 11. Deleted Fields

从 **LTR 公共类型出口** 删除：

- `FormalFineSpan` 类型定义
- `assertFormalFineSpansNonOverlapping`（改由 Path 模块拥有）

从 Path Runtime 字段语义上移除/改名：

- `toneCommitTrace` → `toneRebindTrace`（同结构 diagnostics；去掉 Commit 命名）

未向 PathFineSpan 迁入任何 cursor / option / ranking 过程字段。

---

## 12. Retained Fields

`PathFineSpan` Runtime：

```text
spanId
rawStart, rawEnd
syllableStart, syllableEnd
coarseSpanIds
boundaryCrossCount
windowSource
candidates
selectionReason
toneRebindTrace?   (diagnostics only)
```

`PathFineSpanView`：

```text
pathId
boundaryKey
pathFineSpans
```

未为“可能以后使用”新增字段；未存 path 枚举过程 / prune 原因。

---

## 13. Remaining LTR Dependencies

| Dependency | Status | Next step |
|------------|--------|-----------|
| Orchestrator → `runLtrFineSpanGeneration` | 故意保留 | Step 2+ Lattice production entry |
| LTR result 属性名 `formalSpans` | 保留（类型已是 PathFineSpan[]） | 可在切换生产入口时再改名 |
| LTR API 名 `commitBestFormalFineSpan` | LTR-local | 删除 LTR 文件时一并消失 |
| Diagnostics signal `ltr_fine_span` | 保留（行为不变） | Lattice 切主链后再改 |
| Orchestrator 局部变量 `toneCommitTraces` | 命名遗留；算法已 Path | 可选清理，非阻塞 |

---

## 14. Target List Completion

| ID | Target | Status |
|----|--------|--------|
| T1 | FormalFineSpan 字段级分类 | Done |
| T2 | 建立 `path-fine-span-types.ts` | Done |
| T3 | Lattice/Path 类型迁出 LTR | Done |
| T4 | materialize → Path ownership | Done |
| T5 | tone / assembly / diagnostics 类型级清理 | Done |
| T6 | 生产运行行为不变 | Done |
| T7 | Lattice module 对 LTR 零类型依赖 | Done |

---

## 15. Check List Completion

- [x] 已逐字段审计 FormalFineSpan
- [x] 已区分 Runtime DTO 与 Trace
- [x] 已建立 Path Fine Span 独立类型文件
- [x] Lattice types 不再 import LTR module
- [x] Path materialization 不再 import LTR module
- [x] Tone rebind 类型已改为 Path ownership
- [x] 未建立第二套 Fine Span DTO
- [x] 未新增 adapter
- [x] 未改变 production orchestrator 调用路径
- [x] TypeScript 编译通过
- [x] LTR 单测通过
- [x] Path materialization 单测通过
- [x] 静态依赖扫描通过

---

## 16. Final Verdict

```text
STEP1_PASS
```

满足：

- Lattice / Path module 对 `ltr-fine-span-generator.ts` 类型依赖为零
- 生产行为未改变（仍走 LTR generation → PathFineSpan 消费链）
- 不存在新的兼容 / 平行 Fine Span DTO
- 相关编译与单测全部通过

**Step 2 可直接建立正式 Lattice production entry**，无需再处理 Fine Span 类型归属。
