<!-- Documentation Hierarchy Metadata
Status: **RETIRED**
Superseded By: FW_V4_FREEZE_2026_08_03 / Multi-Path Lexical Lattice V1.0.0
Archive Path: docs/archive/RETIRED/FW_Repair_V4_LTR_Full_Replacement_Readiness_Audit_2026_07_29.md
-->

> **RETIRED** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: FW_V4_FREEZE_2026_08_03 / Multi-Path Lexical Lattice V1.0.0

﻿> **HISTORICAL / SUPERSEDED BY MULTI-PATH LEXICAL LATTICE / NOT RUNTIME AUTHORITY** (Step 6, 2026-07-30). SoftBoundary LTR Fine Span is deleted from runtime; see Runtime SSOT V1.2 + Lattice Architecture V1.0.0.
# FW Repair V4 — LTR Full Replacement Readiness Audit（Pre-Development）

| Field | Value |
|---|---|
| Date | 2026-07-29 |
| Nature | 开发前只读代码审计（禁止修改代码/配置/词库/测试数据） |
| Scope | 确认当前能否在“不修改生产逻辑代码”的前提下，把 `runLtrFineSpanGeneration` 100% 替换为 `SegmentationPath[]` 并彻底移除 LTR |

---

## Executive Summary

结论：**BLOCKED_FOR_FULL_LTR_REMOVAL**。

原因不是“LTR 质量不足”的讨论，而是当前代码库里：

1. 生产主链仍在运行时调用 `runLtrFineSpanGeneration`，并以其产物 `ltr.formalSpans` 作为后续 `Recall → Vote/Assembly → KenLM` 的直接输入。
2. 虽然仓库中存在 `SegmentationPath[] / PathFineSpanView`、以及 Phase2 harness/枚举/物化代码，但它们**尚未进入生产 orchestrator**（`phase2-path-harness.ts` 明确写了 MUST NOT wire）。
3. 关键类型 `FormalFineSpan` 仍由 `ltr-fine-span-generator.ts` 定义；Phase2 的 `materializeFormalFineSpans()` 与 `lattice-path-types.ts` 也直接依赖该 LTR 文件导出的 `FormalFineSpan` 类型。因此即便未来把 Phase2 接到生产里，**在当前结构下也无法做到 “LTR 零引用 + LTR 文件彻底删除”**。

---

## Production Ownership

以当前生产运行入口 `runSpanAssemblyV4Orchestrator` 为中心（文件：`electron_node/electron-node/main/src/fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.ts`），实际 ownership 如下：

| Runtime Step | Owner（当前实现） | 产物类型 |
|---|---|---|
| Fine Span（生产） | `runLtrFineSpanGeneration` | `FormalFineSpan[]`（来自 `ltr.formalSpans`） |
| Recall | `recallTopKForWindows`（在 orchestrator 内，作为 LTR 的 recallForWindows 注入回调） | `WindowCandidate[]`（最终落入 `FormalFineSpan.candidates`） |
| Presence Vote + SameDomain + Assembly 主逻辑 | `runDomainAwareAssembly`（接收 `ltr.formalSpans`） | `bucketSpanSets` / `spanSets` |
| KenLM | `runFwSentenceRerankFromPrefilled`（此处不展开，但输入来自 assembly 的句子候选） | `SentenceCandidate[]` |

硬证据（生产 orchestrator 中）：

- `span-assembly-v4-orchestrator.ts` 明确导入并调用 `runLtrFineSpanGeneration`，并将 `ltr.formalSpans` 传入：
  - `runDomainAwareAssembly(..., ltr.formalSpans, ...)`
  - `buildFwSpansFromFormalFineSpans(..., ltr.formalSpans, ...)`
  - `tone-commit-rebind.ts` 的 `rebindToneAfterFormalCommit(span: FormalFineSpan, ...)`

---

## LTR Dependency Tree

删除（或从 runtime 移除）`runLtrFineSpanGeneration` / `ltr-fine-span-generator.ts` 后，当前会立刻产生编译/运行依赖断裂。按“直接引用链”列出阻塞模块：

### 必然编译失败（直接 import/参数类型）

1. `span-assembly-v4-orchestrator.ts`
   - 直接 import：`runLtrFineSpanGeneration`
   - 运行时调用并依赖：`ltr.formalSpans`
2. `assemble-domain-aware-span-sets.ts`
   - `runDomainAwareAssembly(..., formalSpans: readonly FormalFineSpan[], ...)`
   - 内部会构造候选池：`buildFineSpanCandidatePool(activeCandidates, ..., formalSpans)`
3. `build-fw-spans-from-coarse-assembly-v4.ts`
   - `buildFwSpansFromFormalFineSpans(..., formalSpans: readonly FormalFineSpan[], ...)`
4. `tone-commit-rebind.ts`
   - `rebindToneAfterFormalCommit(span: FormalFineSpan, ...)`
5. `lattice-path-types.ts`
   - `PathFineSpanView.formalFineSpans: readonly FormalFineSpan[]`
   - 并且该文件 import 的 `FormalFineSpan` 来自 `ltr-fine-span-generator.ts`
6. `materialize-formal-fine-spans.ts`
   - `materializeFormalFineSpans(...): PathFineSpanView`
   - 显式使用 `FormalFineSpan` 类型并构造它

### 必然逻辑阻断（生产 orchestrator 未接入 SegmentationPath）

`phase2-path-harness.ts` 明确写了：

> “It MUST NOT be wired into production orchestrator; production continues to use LTR fine spans.”

因此即便 Phase2 harness/枚举/物化存在，当前生产并不会使用 `SegmentationPath[]` 来替代 LTR 生成的 `FormalFineSpan[]`。

---

## SegmentationPath Readiness

仓库中存在的能力（代码存在）：

- `lattice-path-types.ts`：定义 `SegmentationPath` / `PathFineSpanView`
- `enumerate-complete-segmentation-paths.ts`：枚举 `SegmentationPath[]`
- `materialize-formal-fine-spans.ts`：把 `SegmentationPath` 物化为 `PathFineSpanView`（并构造 `FormalFineSpan[]`）
- `phase2-path-harness.ts`：运行 Phase2（但明确 harness-only，不接入生产 orchestrator）

**缺口（当前不满足 “100% 替换 LTR” 的生产可行性）：**

1. 生产 orchestrator 当前并不产生 `SegmentationPath[]`，也不消费 `PathFineSpanView`。
2. `FormalFineSpan` 类型的归属仍在 `ltr-fine-span-generator.ts`，因此无法做到“删除 LTR 文件且系统仍编译通过”。

因此，SegmentationPath 目前仅能作为 harness/离线审计框架的一部分，而不是生产 Fine Span SSOT 的唯一入口。

---

## Recall Migration

当前 Recall 绑定点在：

- `span-assembly-v4-orchestrator.ts`：通过 `runLtrFineSpanGeneration({ recallForWindows: (windows) => recallTopKForWindows(...) })`

要实现“删除 LTR 后的 production recall 可用”，需要把 Recall 从“LTR 逐 cursor 注入回调”改为“SegmentationPath / LexicalEdge 生产阶段的一致入口”。

但在当前代码中：

- Phase2 相关 harness（`phase2-path-harness.ts`）并未接入生产 orchestrator。
- 当前生产 Recall pipeline 仍以 LTR 产生的 window 坐标为输入。

结论：在不改代码的前提下，不可能证明删除 LTR 后生产 Recall 仍可运行。

---

## Vote Migration

当前 `runDomainAwareAssembly` 的 Vote 输入依赖：

- `formalSpans: readonly FormalFineSpan[]`

而 `FormalFineSpan` 类型来自 LTR 文件，且 `runDomainAwareAssembly`/`buildFineSpanCandidatePool` 也以此为 API 合约。

因此要迁移到 SegmentationPath 作为唯一 Fine Span SSOT，需要进一步把 Vote 输入从“LTR 的 formalSpans 合约”改成“SegmentationPath 物化后的路径 fine span 合约”。此改动在本轮为禁止事项（仅审计）。

---

## Assembly Migration

Assembly 主合约 `runDomainAwareAssembly` 同样依赖 `FormalFineSpan[]`，并且：

- 需要 `assertFormalFineSpansNonOverlapping(formalSpans)`
- 需要 `buildFineSpanCandidatePool(..., formalSpans)`
- 以及下游 zip/对齐逻辑按 formal span 顺序组织（见 orchestrator 中 zip 注释）

因此删除 LTR 后，Assembly 仍无法工作，除非先完成 API 与类型的结构性迁移。

---

## KenLM Migration

KenLM 本身通常只消费句子候选文本列表，并不直接依赖 LTR；但句子候选来源仍依赖：

- Assembly 输出（而 Assembly 依赖 `FormalFineSpan[]`）

因此 KenLM 迁移并非阻塞点，但“最终可跑”仍受前述 Fine Span 与 Assembly 输入阻塞。

---

## Trace Migration

当前 Trace 里明显存在 LTR 归属：

- `span-assembly-v4-orchestrator.ts` 内使用 `ltr.trace.steps` / `ltr.formalSpans`：
  - `tone-commit-rebind.ts` 逐 formal span 进行 tone rebind
  - trace boundary window 列表由 `ltr.formalSpans` 生成

因此要实现 LTR 零引用，需要同步调整 Trace 生成与诊断字段归属；当前阶段（审计）不足以证明可以做到编译/测试全绿。

---

## Documentation Migration

仍存在 LTR 主题文档（示例）：

- `docs/tone-v2/FW_Repair_V4_LTR_FineSpan_Performance_Audit_2026_07_25.md`
- `docs/tone-v2/FW_Repair_V4_LTR_vs_MultiPath_Lattice_Necessity_Audit_2026_07_29.md`
- `docs/tone-v2/_audit_scratch/ltr-window-probe.mjs`
- 以及多份历史审计/计划文档

本轮审计不做内容修改；但在“完全替换 LTR 并删除 LTR”之后，需要把这些文档标记为历史/或由 SegmentationPath SSOT 合约引用替代。

---

## Delete List

> 说明：此 Delete List 是为“未来执行全量迁移后”服务的结构性清单；本轮不执行代码删除，仅给出完整行动范围与分类。

### Code（代码文件）

| Item | 分类 |
|---|---|
| `electron_node/electron-node/main/src/fw-detector/span-assembly-v4/ltr-fine-span-generator.ts` | DELETE（或拆分：把 `FormalFineSpan`/trace/option/commit 相关类型与函数 MOVE 到新共享模块后再删除 LTR 生成策略） |
| `electron_node/electron-node/main/src/fw-detector/span-assembly-v4/ltr-fine-span-generator.test.ts` | DELETE（迁移为 SegmentationPath/Phase2 fine span 的覆盖测试） |
| `electron_node/electron-node/main/src/fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.ts`（对 LTR 的调用路径部分） | RENAME/MOVE（从 LTR fine span 生成替换为 SegmentationPath 物化消费） |
| `electron_node/electron-node/main/src/fw-detector/span-assembly-v4/phase2-path-harness.ts` | MOVE（把 harness-only 的“路径枚举+物化”接入生产 orchestrator 依赖链；或提取其生产可用子函数） |
| `electron_node/electron-node/main/src/fw-detector/span-assembly-v4/enumerate-complete-segmentation-paths.ts` | KEEP |
| `electron_node/electron-node/main/src/fw-detector/span-assembly-v4/materialize-formal-fine-spans.ts` | KEEP（在 `FormalFineSpan` 类型迁出后更新 import） |
| `electron_node/electron-node/main/src/fw-detector/span-assembly-v4/lattice-path-types.ts` | KEEP（需把其对 `FormalFineSpan` 的 import 从 `ltr-fine-span-generator.ts` 迁到共享类型模块） |
| `electron_node/electron-node/main/src/fw-detector/span-assembly-v4/assemble-domain-aware-span-sets.ts` | RENAME（其输入签名与“非重叠断言/候选池构造”应从 LTR `formalSpans` 切换为 Path/SegmentationPath 物化结果） |
| `electron_node/electron-node/main/src/fw-detector/span-assembly-v4/tone-commit-rebind.ts` | RENAME（从 “Formal commit rebind（Ltr）” 泛化为 “fine-span commit rebind（Path）”）或 KEEP（取决于 `FormalFineSpan` 类型迁出方式） |
| `electron_node/electron-node/main/src/fw-detector/span-assembly-v4/build-fw-spans-from-coarse-assembly-v4.ts` | KEEP（仅需把诊断 signals 从 `ltr_fine_span` 迁出，否则会污染 Trace/Diagnostics） |

### Interface / DTO / Types（接口/DTO/类型）

| Item | 分类 |
|---|---|
| `FormalFineSpan`（当前定义在 `ltr-fine-span-generator.ts`） | MOVE（到新的共享类型模块；否则 Phase2 materialize 与 Vote/Assembly 会失效） |
| `LtrFineSpanOption` | DELETE |
| `LtrFineSpanStepTrace` | DELETE/RENAME（如需保留语义则改为 path-step 或 generic-step） |
| `LtrFineSpanTrace` | DELETE/RENAME |
| `LtrFineSpanGenerationResult` | DELETE |
| `SegmentationPath` | KEEP |
| `PathFineSpanView` | KEEP |

### Import（生产 import / 消费关系）

| Item | 分类 |
---|---|
| `span-assembly-v4-orchestrator.ts` 中 `import { runLtrFineSpanGeneration } ...` | DELETE |
| `phase2-path-harness.ts` “MUST NOT wire into production” 调用约束注释本身 | RENAME/DELETE（在生产接入后更新语义） |
| `lattice-path-types.ts` / `materialize-formal-fine-spans.ts` / `tone-commit-rebind.ts` / `assemble-domain-aware-span-sets.ts` 对 `FormalFineSpan` 的 import 来源 | RENAME/MOVE（从 LTR module 改为共享类型 module） |

### Trace（trace/诊断）

| Item | 分类 |
---|---|
| orchestrator 中 `architectureCompliance.generatorMode: 'ltr_soft_boundary'` | MOVE/RENAME |
| 由 `ltr.trace` 推导的 trace 字段组织 | DELETE/RENAME（替换为 Path fine span trace） |
| `build-fw-spans-from-coarse-assembly-v4.ts` 中 candidates 的 `signals: ['span_assembly_v4', 'ltr_fine_span']` | RENAME/DELETE（避免 Trace/Diagnostics 仍标记 LTR） |

### Regression / Acceptance / Snapshots

| Item | 分类 |
---|---|
| `electron_node/electron-node/main/src/fw-detector/span-assembly-v4/ltr-fine-span-generator.test.ts` | DELETE |
| `electron_node/electron-node/main/src/fw-detector/span-assembly-v4/materialize-formal-fine-spans.test.ts` | MOVE/RENAME（改用 SegmentationPath→PathFineSpanView 输入） |
| 当前依赖 LTR FineSpan 输入的单测/验收链路 | MOVE/RENAME（改用 Phase2/SegmentationPath 输入） |
| Tone/Mapping freeze 已产出的测试资产（不属于 LTR 产物） | KEEP |

### Documentation

| Item | 分类 |
---|---|
| 所有与 LTR FineSpan 生产实现/性能 probe 相关的文档（如 `FW_Repair_V4_LTR_FineSpan_Performance_Audit_2026_07_25.md`） | SUPERSEDED（历史保留）/ DOC_ONLY |
| `FW_Repair_V4_LTR_vs_MultiPath_Lattice_Necessity_Audit_2026_07_29.md` | SUPERSEDED（历史保留；仅作迁移对照） |
| `docs/tone-v2/_audit_scratch/ltr-window-probe.mjs` | SUPERSEDED（历史保留） |
| `docs/tone-v2/_audit_scratch/dialog200-gt-ltr-probe.mjs` | SUPERSEDED（历史保留） |
| `docs/tone-v2/_audit_scratch/ltr_vs_lattice_necessity_probe_2026_07_29.mjs` | SUPERSEDED（历史保留） |
| Lattice/SegmentationPath 的最终冻结合同引用 | KEEP（作为新的 SSOT） |

---

## Migration Checklist

> 目标：完成后满足 “runtime 中 LTR 零引用” 与 “`SegmentationPath[]` 成为唯一 Fine Span SSOT”。

1. Step1：把 `FormalFineSpan` 从 `ltr-fine-span-generator.ts` 中抽离到共享模块（MOVE），并让所有依赖（Vote/Assembly/Phase2 materialize）只 import 共享类型。
2. Step2：在 `span-assembly-v4-orchestrator.ts` 中移除 `runLtrFineSpanGeneration` 调用链，替换为生产可用的 Phase2/SegmentationPath FineSpan 物化（而非 harness-only）。
3. Step3：更新 `runDomainAwareAssembly` 与 `buildFineSpanCandidatePool` 的输入合约（使其消费 Path materialize 的 fine spans，且不再依赖 LTR “生成策略”）。
4. Step4：更新 `tone-commit-rebind`、`buildFwSpansFromFormalFineSpans`、以及 Trace 组织逻辑，确保诊断来源不再标记 `ltr_fine_span`。
5. Step5：回归测试迁移：删除/更新所有依赖 `ltr-fine-span-generator` 的测试；补齐 SegmentationPath 产物到 Vote/Assembly 的覆盖。
6. Step6：验收资产迁移：重新跑 dialog_200 主链评估（Trace/Snapshot/Golden/Baseline），确保没有 “LTR-only 指标/字段” 仍作为生产正确性依据。
7. Step7：删除 LTR 生产入口后验证“运行时零引用”：对 runtime 代码执行 `rg runLtrFineSpanGeneration` 结果为空。

---

## Target List

| ID | Target | Status（当前） |
|---|---|---|
| T1 | 生产 orchestrator 由 `SegmentationPath[]` 产出 fine spans | 未就绪（当前仍走 LTR） |
| T2 | 删除 `runLtrFineSpanGeneration` 仍可编译/运行 | 未就绪（有直接 import/type 依赖） |
| T3 | runtime 中 `FormalFineSpan` 不再来源于 LTR 文件 | 未就绪（类型仍 import 自 LTR module） |
| T4 | Trace/Diagnostics 不再以 LTR 作为生成策略 | 未就绪 |

---

## Check List

- [ ] `span-assembly-v4-orchestrator.ts` 中不再 import/call `runLtrFineSpanGeneration`
- [ ] `lattice-path-types.ts / materialize-formal-fine-spans.ts` 不再依赖 LTR module 导出的 `FormalFineSpan`
- [ ] Recall→Vote→Assembly→KenLM 的生产链路在 SegmentationPath 物化 fine spans 上闭环
- [ ] Regression/Acceptance 不再引用 LTR generator 的 trace/fixtures

---

## Final Verdict

### 当前 Production 是否仍依赖 LTR？
是。

### 哪些模块仍直接调用 LTR？
- `span-assembly-v4-orchestrator.ts` 调用 `runLtrFineSpanGeneration` 并以 `ltr.formalSpans` 驱动后续 `runDomainAwareAssembly` 与 `buildFwSpansFromFormalFineSpans`。

### 哪些 DTO 必须删除？
- LTR 生成策略相关 DTO/trace（`LtrFineSpanOption/StepTrace/Trace/GenerationResult`），以及 LTR 生成入口（`runLtrFineSpanGeneration`）。

### 哪些接口必须改为 SegmentationPath？
- Vote/Assembly 输入合约：`runDomainAwareAssembly` 与 `buildFineSpanCandidatePool` 的输入来源需要从 LTR 生成策略切换到 SegmentationPath 物化结果。

### 哪些文档必须同步修改？
- 所有 LTR FineSpan 生成/性能 probe 类文档需要标注为 HISTORICAL/SUPERSEDED（SSOT 改为 SegmentationPath）。

### 删除 LTR 后哪些地方会编译失败？
至少包括（有直接 import/类型依赖）：
- `span-assembly-v4-orchestrator.ts`
- `assemble-domain-aware-span-sets.ts`
- `build-fw-spans-from-coarse-assembly-v4.ts`
- `tone-commit-rebind.ts`
- `lattice-path-types.ts`
- `materialize-formal-fine-spans.ts`

### 是否存在任何 Legacy / Shadow / Adapter？
本轮审计未发现明确的 “shadow/dual pipeline production” 生产执行分支；但存在 Phase2 harness 代码未接入生产（harness-only constraint）。

### 是否可以做到 Runtime 中 LTR 零引用？
在当前代码结构下：不能（类型仍来自 LTR module + 生产 orchestrator 仍调用 LTR）。

### LTR 是否可以在本轮开发后彻底删除？
在本轮禁止开发/禁止修改代码前提下：不能证明可行，因此为 BLOCKED。

```text
BLOCKED_FOR_FULL_LTR_REMOVAL
```


