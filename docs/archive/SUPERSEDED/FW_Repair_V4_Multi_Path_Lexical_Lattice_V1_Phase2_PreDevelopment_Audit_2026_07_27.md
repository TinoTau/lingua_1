<!-- Documentation Hierarchy Metadata
Status: **SUPERSEDED**
Superseded By: CURRENT Sole Authorities + FW_V4_FREEZE_2026_08_03
Archive Path: docs/archive/SUPERSEDED/FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Phase2_PreDevelopment_Audit_2026_07_27.md
-->

> **SUPERSEDED** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT Sole Authorities + FW_V4_FREEZE_2026_08_03

# FW Repair V4 — Multi-Path Lexical Lattice V1 · Phase 2 Pre-Development Audit

| Field | Value |
|-------|-------|
| Date | 2026-07-27 |
| Nature | **Phase 2 Pre-Development Audit**（只读，无代码修改） |
| Authority | Architecture V1.0.0 FROZEN · Implementation Contract V1.0.0 · Phase 1 Final Closure Report · Phase 1 Acceptance Contract CURRENT · Phase 1 Developer Guide CURRENT |
| Final verdict | **READY FOR PHASE 2 DEVELOPMENT** |

---

## 1. Executive Summary

Phase 1 已在 harness 层交付 `LexicalEdge[]` SSOT；生产仍由 LTR（`runLtrFineSpanGeneration` → `FormalFineSpan[]`）独占 Fine Span 分界所有权。Phase 2 目标链路在代码中**完全不存在**，须 **NEW** 实现，但 Architecture / Implementation Contract 已给出冻结 DTO、算法语义、裁剪规则与职责边界，**不存在 SSOT 冲突**。

| 维度 | 结论 |
|------|------|
| Phase 2 目标 | `LexicalEdge[]` → `enumerateCompleteSegmentationPaths()` → `SegmentationPath[]` → `PathFineSpanView` |
| 现有 Path 枚举器 | **无**（`enumerateCompleteSegmentationPaths` 未实现） |
| 现有 Path DTO | **无**（`SegmentationPath` / `boundaryKey` / `pathId` / `PathFineSpanView` 均未定义） |
| LTR 生产所有权 | **仍活跃**（`span-assembly-v4-orchestrator.ts` L187） |
| Phase 1 模块 | **冻结**，可直接复用为 Phase 2 输入 |
| 架构冲突 | **无** — 缺口为未实现，非设计矛盾 |
| 最大风险 | 隐藏双链路（LTR + Lattice 并行）；误复用 `enumerateIntervalPaths` 或 LTR cursor 逻辑 |

```text
READY FOR PHASE 2 DEVELOPMENT
```

---

## 2. Phase2 Scope

### 2.1 冻结 Architecture 规定的 Phase 2 唯一目标

```text
LexicalEdge[]
  ↓ enumerateCompleteSegmentationPaths()   [+ Contract §6 fallback injection]
SegmentationPath[]                          ← Fine Span segmentation SSOT
  ↓ materializeFormalFineSpans(path)
PathFineSpanView                            ← 临时适配视图，非 utterance SSOT
```

Phase 2 **到此结束**（Vote / Assembly / KenLM / Global ≤16 为 Phase 3+）。

### 2.2 Architecture §20 / Contract §13 允许的 Phase 2 代码

| 允许 | 禁止 |
|------|------|
| Path 枚举模块 | Feature-flag 双链路 |
| Fallback Edge 注入（Contract §6） | Domain / KenLM / LLM 参与 Path 裁剪 |
| `SegmentationPath` / `PathFineSpanView` DTO | Phase 1 Window / Recall / Evidence 语义变更 |
| `materializeFormalFineSpans` 适配器 | Cross-Path CompatibilityGraph |
| Path-aware Trace / Diagnostics 字段 | 无条件每音节 fallback |
| **移除 LTR 生产所有权**（orchestrator 替换 `runLtrFineSpanGeneration`） | 在本阶段完成 Path Vote / Assembly / KenLM 接线 |

### 2.3 与用户 Prompt 边界对齐

用户 Prompt 将 Phase 2 止于 `PathFineSpanView`；Architecture §20 额外要求 **remove LTR production ownership**。二者一致：orchestrator 须以 Path 枚举 + 视图物化**替换** LTR 调用点，但 **不必** 在本阶段完成 per-Path Vote/Assembly/KenLM（Phase 3）。

### 2.4 Phase 2 不在范围

- Path-local Domain Vote / SameDomain Assembly
- CompatibilityGraph KEEP/DELETE 审计与删改
- Global ≤16 分配器 metadata 绑定
- 死代码删除（LTR 文件物理删除 → Phase 6）
- Production KenLM 最终选路

---

## 3. Current Code Ownership

| 对象 | 当前 Owner | 文件 | Phase 2 状态 |
|------|-----------|------|-------------|
| Syllable Coordinate | `buildUtteranceSyllableCoordinate` | `pinyin-ime-v2-pinyin-stream` | **FORBIDDEN** 修改 |
| WindowQuery 1..5 | `buildLexicalWindowQueries` | `build-lexical-window-queries.ts` | **FORBIDDEN**（Phase 1 冻结） |
| Hard-block | `latticeHardBlockFilter` | `lattice-hard-block-filter.ts` | **FORBIDDEN** |
| Recall | `recallTopKForWindows` | `recall-topk-for-windows.ts` | **FORBIDDEN** 语义变更；orchestrator 可继续注入 recall 回调 |
| LexicalEdge + Evidence | `buildLexicalEdges` | `build-lexical-edges.ts` | **LIMITED** — 扩展 `edgeKind: 'fallback'`；不生成 Path |
| **Fine Span SSOT（生产）** | `runLtrFineSpanGeneration` | `ltr-fine-span-generator.ts` | **REPLACE** — Phase 2 移除 orchestrator 所有权 |
| FormalFineSpan 类型 | `ltr-fine-span-generator.ts` | 同上 | **KEEP 类型**；职责降为 PathFineSpanView 内 ephemeral slot |
| SegmentationPath | — | **不存在** | **NEW** |
| Path Enumerator | — | **不存在** | **NEW** |
| PathFineSpanView | — | **不存在** | **NEW** |
| CompatibilityGraph | `buildCandidateCompatibilityGraph` | `candidate-compatibility-graph.ts` | **FORBIDDEN** Phase 2 改动（Phase 3 审计） |
| Interval Assembly | `enumerateIntervalPaths` | `build-sentence-candidates.ts` | **FORBIDDEN** 误作 Path 枚举复用 |
| Legacy windows | `generateGlobalWindows` | `generate-global-windows.ts` | **DEAD**（orchestrator 未引用；Phase 6 删除） |
| Phase 1 Harness | `runPhase1WindowEdgeHarness` | `phase1-window-edge-harness.ts` | **KEEP**；可扩展为 Phase 2 harness |

### 3.1 生产主链（当前）

```text
span-assembly-v4-orchestrator.ts
  → runLtrFineSpanGeneration (cursor 2..5 + commitBestFormalFineSpan)
  → FormalFineSpan[]  [生产 SSOT]
  → buildCandidateCompatibilityGraph / resolveCompatibilityRelations
  → runDomainAwareAssembly (utterance-level vote)
  → buildFwSpansFromFormalFineSpans
  → buildSentenceCandidates (enumerateIntervalPaths — repair slot 组合)
  → KenLM
```

### 3.2 目标主链（Phase 2 交付段）

```text
buildLexicalWindowQueries → recall → buildLexicalEdges
  → [injectFallbackEdgesIfNeeded]
  → enumerateCompleteSegmentationPaths
  → SegmentationPath[]
  → materializeFormalFineSpans (per path)
  → PathFineSpanView[]
```

Phase 3 再接 Vote / Assembly / KenLM。

---

## 4. Existing Enumerator Analysis

### 4.1 逐项检索结果

| 符号 / 概念 | 存在？ | 位置 | 判定 |
|------------|--------|------|------|
| `enumerateCompleteSegmentationPaths` | **否** | — | **NEW** |
| `SegmentationPath` | **否** | — | **NEW** |
| `boundaryKey` / `pathId` | **否** | — | **NEW** |
| `PathFineSpanView` | **否** | — | **NEW** |
| DFS / BFS 覆盖枚举 | **否**（针对 Edge 图） | — | **NEW** |
| `enumerateIntervalPaths` | **是** | `build-sentence-candidates.ts:202` | **KEEP，禁止复用为 Path 枚举** |
| LTR cursor loop | **是** | `ltr-fine-span-generator.ts:520` | **Phase 2 orchestrator 删除调用；文件 Phase 6 DELETE** |
| `generateLocalOptionsAtCursor` | **是** | `ltr-fine-span-generator.ts` | **DELETE**（Delete Matrix Phase 2） |
| `commitBestFormalFineSpan` | **是** | `ltr-fine-span-generator.ts:313` | **DELETE** 生产路径 |
| Compatibility Graph | **是** | `candidate-compatibility-graph.ts` | **KEEP**（Phase 3 再审计 KEEP/DELETE） |
| Fallback Edge 注入 | **否** | — | **NEW**（Contract §6） |
| Path Cap / Prune | **否** | — | **NEW**（Contract §8；probe caps 在 `V4_LIMITS` 尚未添加） |

### 4.2 `enumerateIntervalPaths` 与 Path 枚举的本质差异

```text
enumerateIntervalPaths:
  输入 = SpanReplacementPick[][] (per coarse/formal slot 的 repair picks)
  输出 = 非重叠 repair 组合路径 → KenLM 句子候选
  算法 = slot DFS + allNonOverlapSubsets
  用途 = Interval Assembly（Phase 3+ KenLM 前）

Bounded Complete Segmentation Path Enumeration:
  输入 = LexicalEdge[]（按 syllable 邻接图）
  输出 = 覆盖 [0,N) 的完整分界 SegmentationPath[]
  算法 = 位置 DAG DFS/BFS + per-position cap + complete-path cap
  用途 = Fine Span SSOT
```

**误用 `enumerateIntervalPaths` 将违反 Architecture §3（SegmentationPath[] 为唯一 Fine Span SSOT）。**

### 4.3 LTR 是否含可复用枚举逻辑？

`runLtrFineSpanGeneration` 为 **贪心单路径**：每 cursor 位置 `commitBestFormalFineSpan` 选一个 span，**不保留多路径**，无 backtracking，无 `boundaryKey`。  
**判定：REWRITE（全新 Path Enumerator），不得 RESTORE LTR 为多路径变体。**

---

## 5. Existing LTR Dependency Analysis

### 5.1 LTR 仍拥有 Fine Span / Boundary 所有权的代码点

| 模块 | 符号 | 职责 | Phase 2 动作 |
|------|------|------|-------------|
| `span-assembly-v4-orchestrator.ts` | `runLtrFineSpanGeneration` L187 | **生产 Fine Span SSOT** | **REPLACE** 调用点 |
| 同上 | `ltr.formalSpans` → compatibility / vote / assembly L305–349 | 下游以 LTR 输出为 SSOT | Phase 2 仅替换 Fine Span 来源；Vote/Assembly 接线 Phase 3 |
| `ltr-fine-span-generator.ts` | `generateLocalOptionsAtCursor` | cursor 局部 Window | **DELETE**（生产路径） |
| 同上 | `commitBestFormalFineSpan` | 单点 boundary 决策 + prior | **DELETE**（生产路径） |
| 同上 | `runLtrFineSpanGeneration` | 全句 LTR 循环 | **DELETE** orchestrator 引用 |
| 同上 | `FormalFineSpan` type | 含 `selectionReason`, `coarseSpanIds`, cursor 语义 | **KEEP 类型**；adapter 填充，去掉 LTR selection 语义 |
| `assemble-domain-aware-span-sets.ts` | `buildFineSpanCandidatePool(formalSpans)` | 以 FormalFineSpan[] 为 pool 单元 | Phase 3 **LIMITED** — 改为 per-PathFineSpanView |
| `build-fw-spans-from-coarse-assembly-v4.ts` | `buildFwSpansFromFormalFineSpans` | FW span 构建 | Phase 3 LIMITED |
| `tone-commit-rebind.ts` | `rebindToneAfterFormalCommit(span: FormalFineSpan)` | Tone 重绑定 | Phase 2/3 LIMITED — 改从 PathFineSpanView slot 驱动 |
| Tests | `ltr-fine-span-generator.test.ts`, `phase0-coordinate-ssot.test.ts` | LTR 行为断言 | Phase 2 新增 Path 测试；LTR 测试 Phase 6 删除或归档 |

### 5.2 LTR 与 Lattice Window 的重复职责

| 能力 | LTR | Lattice Phase 1 |
|------|-----|-----------------|
| Window 生成 | `generateLocalOptionsAtCursor`（cursor 2..5） | `buildLexicalWindowQueries`（全句 1..5） |
| Recall 注入 | orchestrator 内 `recallForWindows` 回调 | harness / 同一 `recallTopKForWindows` |
| Boundary 决策 | `commitBestFormalFineSpan` | **Phase 2 Enumerator** |
| Edge 构建 | 无（直接用 WindowCandidate） | `buildLexicalEdges` |

Phase 2 须 **切断** orchestrator 对 LTR Window/B boundary 路径的依赖，统一走 Lattice Window → Edge → Path。

### 5.3 本轮不得删除

按 Prompt：**本轮只读，不得删除 LTR 代码。** 开发阶段 orchestrator 替换调用点后，LTR 文件可暂留至 Phase 6 物理删除。

---

## 6. BoundaryKey Audit

### 6.1 当前是否存在？

**否。** 代码库 `main/src/fw-detector` 无 `boundaryKey` / `pathId` 定义或使用。

### 6.2 相近字段

| 字段 | 位置 | 与 boundaryKey 关系 |
|------|------|---------------------|
| `edgeId` | `build-lexical-edges.ts` — `` `${start}:${end}` `` | **单 Edge 标识**，非 Path |
| `windowId` | `GlobalWindowDescriptor` | 同 edgeId 格式，Recall 窗口键 |
| `spanId` | `FormalFineSpan` | LTR commit 产物，非 Path SSOT |

### 6.3 建议生成规则（Implementation Contract §4.3–4.4）

```text
boundaryKey = edge boundary 序列，按 syllableStart 升序，'|' 连接
示例: "0-2|2-4|4-6"   # 每个 token = "${syllableStart}-${syllableEnd}"

pathId = deterministicHash(boundaryKey)   # 推荐 sha256 hex / base32 截断
```

**Invariant：**

- 稳定、唯一、可复现
- 不依赖 Edge 数组迭代顺序（生成前先按 `syllableStart` 排序 `edgeRefs`）
- 禁止随机 UUID、禁止非确定性 hash 盐
- 同一 `boundaryKey` 不因多 Candidate 扩展为多 Path（Contract §4.3）

### 6.4 实现建议

- **NEW** `buildBoundaryKey(edgeRefs: readonly LexicalEdge[]): string`
- **NEW** `derivePathId(boundaryKey: string): string` — 可复用 Node `crypto.createHash('sha256')` 模式（项目内已有先例，如 `patch-hash.ts`）

---

## 7. Path DTO Audit

### 7.1 需新增 DTO（Contract §4.3–4.7）

#### SegmentationPath

| 属性 | 说明 |
|------|------|
| **Responsibility** | Fine Span segmentation SSOT（post cutover） |
| **Input** | 枚举器从 `LexicalEdge[]` 构图后产出 |
| **Output** | `pathId`, `boundaryKey`, `edgeRefs`, counts, `structuralEvidence` |
| **Owner** | Path Enumerator 模块 |
| **Consumer** | `materializeFormalFineSpans`；Phase 3 Vote/Assembly |
| **Invariant** | 覆盖 `[0,N)`； contiguous；无洞无重叠；每 edge length ≤5；共享 Edge 引用不 deep-copy candidates |

#### PrunedSegmentationPathTrace（Contract §8.4）

| 属性 | 说明 |
|------|------|
| **Responsibility** | cap 触发时的裁剪审计 |
| **Owner** | Path Enumerator |
| **Consumer** | Diagnostics / test archives |
| **Invariant** | 裁剪依据仅结构 + Recall evidence；禁止 Domain/KenLM |

#### PathDomainVoteResult / PathSentenceCandidate / GlobalSentenceCandidate

Contract 已定义；**Phase 2 不实现**，Phase 3+ 引入。可在 `v4-types.ts` 或 `lattice-path-types.ts` 中 **先行声明类型**（可选，非必须）。

### 7.2 LexicalEdge 扩展（LIMITED）

当前 Phase 1：

```ts
edgeKind: 'lexical'   // only
```

Contract §4.2 要求：

```ts
edgeKind: 'lexical' | 'fallback'
```

Fallback Edge：`candidates` 为空或 raw-preservation stub；无 `domains[]`；不参与 vote。

**判定：LIMITED 修改 `build-lexical-edges.ts` + NEW `inject-fallback-edges.ts`（或同模块）。**

---

## 8. PathFineSpanView Audit

### 8.1 当前 FormalFineSpan 职责

```69:91:electron_node/electron-node/main/src/fw-detector/span-assembly-v4/ltr-fine-span-generator.ts
export type FormalFineSpan = {
  spanId: string;
  rawStart: number;
  rawEnd: number;
  syllableStart: number;
  syllableEnd: number;
  coarseSpanIds: string[];
  boundaryCrossCount: 0 | 1;
  windowSource: FormalWindowSource;
  candidates: WindowCandidate[];
  selectionReason: FineSpanSelectionReason;
  // toneCommitTrace — diagnostics
};
```

**当前承担：**

- LTR **commit 决策**载体（`selectionReason`, cursor 排名 trace）
- Domain Vote / Assembly 的 **pool 单元**
- Tone rebind 锚点
- FW span 构建输入

### 8.2 Architecture 要求的分工

| 保留在 FormalFineSpan slot | 迁移 / 删除 |
|---------------------------|------------|
| syllable/raw 坐标 | `selectionReason`（LTR 专有） |
| `candidates[]` 共享引用 | 作为 utterance SSOT 持久化 |
| coarse 诊断字段（Trace） | cursor / prior 排名 |
| | 独立 boundary 决策 |

### 8.3 PathFineSpanView 转换

Contract §4.6：

```ts
interface PathFineSpanView {
  pathId: string;
  boundaryKey: string;
  formalFineSpans: FormalFineSpan[];
}
```

**需要 NEW Adapter：`materializeFormalFineSpans(path: SegmentationPath): PathFineSpanView`**

| 项 | 判定 |
|----|------|
| 是否已有结构可完成？ | **部分** — `FormalFineSpan` 形状可复用为 view slot |
| 是否需要 Mapper？ | **是** — 从 `path.edgeRefs[]` 映射为 ordered `FormalFineSpan[]` |
| deep-copy candidates？ | **禁止** — 共享 `edge.candidates` 引用 |
| spanId 生成 | 确定性，如 `` `${boundaryKey}#${idx}` `` 或 `edge.edgeId` |
| selectionReason | 设为 lattice 常量（如 `'lattice_path_edge'`）或 optional 移除（LIMITED 类型扩展） |

**不得**让 PathFineSpanView 成为 utterance-level SSOT；不得跨 Path merge。

---

## 9. Required New Components

| # | 组件 | 文件建议 | 职责 |
|---|------|---------|------|
| 1 | `lattice-path-types.ts` | `span-assembly-v4/` | `SegmentationPath`, `PathFineSpanView`, `PrunedSegmentationPathTrace`, path caps |
| 2 | `inject-fallback-edges.ts` | 同上 | Contract §6 四步注入 |
| 3 | `enumerate-complete-segmentation-paths.ts` | 同上 | 有限完整路径枚举 + prune |
| 4 | `build-boundary-key.ts` | 同上 | `boundaryKey` / `pathId` 确定性生成 |
| 5 | `materialize-formal-fine-spans.ts` | 同上 | `SegmentationPath` → `PathFineSpanView` |
| 6 | `phase2-path-harness.ts` | 同上 | 离线/测试：Phase1 harness 延伸 → Path → View |
| 7 | Path caps in `v4-limits.ts` | LIMITED | `maxActivePathsPerPosition`, `maxCompleteSegmentationPaths` |
| 8 | Path trace mappers | `v4-diagnostics-*` | LIMITED — 新字段，不改决策 |
| 9 | Orchestrator 替换 LTR 调用 | `span-assembly-v4-orchestrator.ts` | LIMITED — Phase 2 cutover 核心 |

---

## 10. Reusable Components

| 组件 | 文件 | 复用方式 |
|------|------|---------|
| Window 全句 1..5 | `build-lexical-window-queries.ts` | orchestrator 替换 LTR window 生成 |
| Hard-block | `lattice-hard-block-filter.ts` | 与 Phase 1 harness 相同 |
| Recall 全遍历 | `recallTopKForWindows.ts` | 注入 callback；B1 冻结 |
| Edge + Evidence OR | `build-lexical-edges.ts` | 扩展 fallback kind |
| Window construction core | `window-construction-core.ts` | 不变 |
| Phase 1 harness | `phase1-window-edge-harness.ts` | 模式复用；扩展 Phase 2 |
| `FormalFineSpan` 类型 | `ltr-fine-span-generator.ts` | adapter view slot（import type only） |
| `WindowCandidate` | `v4-types.ts` | 不变 |
| `V4_TRACE_LIMITS` | `v4-limits.ts` | 扩展 path trace caps |
| Syllable coordinate | Phase 0 SSOT | 不变 |
| Utterance recall cache | `utterance-recall-cache.ts` | orchestrator 可继续启用 |

---

## 11. Forbidden Modifications

| 级别 | 模块 |
|------|------|
| **FORBIDDEN** | `recall-topk-for-windows.ts` 遍历/门控语义 |
| **FORBIDDEN** | `build-lexical-window-queries.ts` / `window-construction-core.ts` Window SSOT |
| **FORBIDDEN** | Evidence OR 顺序（B2 冻结） |
| **FORBIDDEN** | `candidate-compatibility-graph.ts` Phase 2 改动 |
| **FORBIDDEN** | `runDomainAwareAssembly` / KenLM / `buildSentenceCandidates` Phase 2 接线 |
| **FORBIDDEN** | Feature-flag dual chain / shadow LTR + Lattice |
| **FORBIDDEN** | `commitBestFormalFineSpan` fallback after lattice failure |
| **FORBIDDEN** | Domain / KenLM / LLM 参与 Path prune |
| **FORBIDDEN** | SQLite schema / 新索引（Phase 5） |
| **FORBIDDEN** | 无条件每音节 fallback |

| 级别 | 模块 |
|------|------|
| **LIMITED** | `build-lexical-edges.ts`（fallback kind） |
| **LIMITED** | `span-assembly-v4-orchestrator.ts`（LTR → Path 替换） |
| **LIMITED** | `v4-types.ts` / `v4-diagnostics-*`（新字段） |
| **LIMITED** | `v4-limits.ts`（probe path caps） |

| 级别 | 模块 |
|------|------|
| **ALLOW** | 全部 NEW Path 模块 |
| **ALLOW** | Phase 2 harness / tests / offline probes |

---

## 12. Risks

### 12.1 隐藏双链路？

| 风险 | 现状 | 缓解 |
|------|------|------|
| LTR + Lattice 并行 | 生产仅 LTR；Lattice 仅 harness | Phase 2 **一次性替换** orchestrator 调用；禁止 feature flag |
| 双 Window 生成 | LTR cursor windows + Lattice full utterance | cutover 后仅 `buildLexicalWindowQueries` |
| 双 Fine Span | `FormalFineSpan[]` SSOT vs future `SegmentationPath[]` | adapter 明确 ephemeral；SegmentationPath 为 SSOT |
| 双 Enumeration | `enumerateIntervalPaths` vs Path enum | 命名与模块隔离；代码 review 禁止混用 |

### 12.2 重复职责清单

- **Fine Span**：LTR commit vs Path enum — Phase 2 移除前者生产所有权
- **Boundary**：LTR cursor vs `boundaryKey` — 仅后者为 SSOT
- **Window**：`generateLocalOptionsAtCursor` vs `buildLexicalWindowQueries` — 后者胜出
- **Trace**：LTR step trace vs Path prune trace — 并存至 Phase 6；Diagnostics 仅观察

### 12.3 Phase 2 最大风险

**Orchestrator cutover 范围失控**：若在 Phase 2 同时改 Vote/Assembly/KenLM，将违反 Phase 边界并极易引入双链路。  
**建议**：Phase 2 交付 = Path enum + View + orchestrator 替换 LTR Fine Span 来源 + 最小下游 stub（或暂时仅 diagnostics 输出 Path，Phase 3 再接 Vote）。

### 12.4 最易偏离 Architecture 之处

1. 用 **Domain Prior / selectionReason** 在 enum 阶段选“最佳”单路径 → 违反 §8.1 retention without caps  
2. **无条件 fallback** 导致 mono-syllable 路径爆炸 → 违反 §6.2  
3. **deep-copy** `candidates[]` per Path → 违反 §4.5  
4. 保留 **commitBestFormalFineSpan** 作为 lattice 失败回退 → 违反 Contract §11  
5. 将 **CompatibilityGraph** 提前用于 Path 间冲突 → 违反 §11 FORBIDDEN cross-Path  

---

## 13. KEEP

- Phase 1 全部交付模块（Window / Recall / Edge / harness）
- `WindowCandidate` / `GlobalWindowDescriptor` 类型体系
- `recallTopKForWindows` + utterance cache
- `enumerateIntervalPaths`（KenLM repair 用途，非 Path）
- `candidate-compatibility-graph.ts`（暂不改）
- `FormalFineSpan` **类型**（作 adapter slot）
- Phase 0 coordinate SSOT
- LTR 源文件（Phase 2 仅断 orchestrator 引用；Phase 6 删除）

---

## 14. DELETE

（Phase 2 开发阶段执行；**本轮审计不删代码**）

| 目标 | 阶段 |
|------|------|
| orchestrator 对 `runLtrFineSpanGeneration` 的调用 | Phase 2 |
| `generateLocalOptionsAtCursor` 生产路径 | Phase 2 |
| `commitBestFormalFineSpan` 生产路径 | Phase 2 |
| LTR cursor advancement 逻辑 | Phase 2 |
| `generateGlobalWindows` 及测试 | Phase 6（当前已 dead） |
| LTR 文件整体 | Phase 6 |
| LTR-only freeze tests | Phase 6 |

---

## 15. REWRITE

| 目标 | 说明 |
|------|------|
| Fine Span 生产入口 | 从 LTR greedy → `enumerateCompleteSegmentationPaths` |
| Orchestrator Fine Span 段 | 新 Pipeline 块替换 L187–261 区域（LIMITED） |
| Path prune 逻辑 | 全新，按 Contract §8.3 排序 |

---

## 16. NEW

- `SegmentationPath` / `PathFineSpanView` / `PrunedSegmentationPathTrace` DTO
- `boundaryKey` / `pathId` 工具
- `injectFallbackEdges`（Contract §6）
- `enumerateCompleteSegmentationPaths`（DFS/BFS on position graph）
- Path resource caps + deterministic prune
- `materializeFormalFineSpans`
- Phase 2 harness + unit tests + dialog_200 offline probe
- Path-aware diagnostics fields（fact-only）

---

## 17. Target List

Phase 2 开发建议文件清单（按优先级）：

1. `lattice-path-types.ts`
2. `build-boundary-key.ts`
3. `inject-fallback-edges.ts`
4. `enumerate-complete-segmentation-paths.ts`
5. `materialize-formal-fine-spans.ts`
6. `phase2-path-harness.ts`
7. `enumerate-complete-segmentation-paths.test.ts`
8. `inject-fallback-edges.test.ts`
9. `materialize-formal-fine-spans.test.ts`
10. `phase2-path-harness.test.ts`
11. `v4-limits.ts` — path probe caps
12. `v4-diagnostics-types.ts` / `v4-diagnostics-trace.ts` — path fields
13. `build-lexical-edges.ts` — `edgeKind: 'fallback'`
14. `span-assembly-v4-orchestrator.ts` — LTR → Lattice Path cutover
15. `docs/tone-v2/_audit_scratch/phase2-path-dialog200-probe.mjs`（offline 验收）

**不建议 Phase 2 触碰：** `runDomainAwareAssembly.ts`, `build-sentence-candidates.ts`, `candidate-compatibility-graph.ts`, KenLM 适配层。

---

## 18. Check List

Phase 2 开发前：

- [ ] 重读 Architecture §8 Path Enumeration · §14.3–14.4 · §20
- [ ] 重读 Implementation Contract §4.3–4.6 · §6 · §8 · §11 · §13
- [ ] 确认 Phase 1 harness dialog_200 baseline 仍可跑
- [ ] 确认不引入 feature flag / dual chain

Phase 2 开发中：

- [ ] `logicalWindowRecallCount === recallableWindowCount` 回归不退化
- [ ] Evidence OR 语义不变
- [ ] Fallback 仅 gap-minimal；禁止全音节注入
- [ ] 无 cap 时保留全部 legal `boundaryKey`
- [ ] Cap 触发时 prune 顺序符合 §8.3
- [ ] `pathId` / `boundaryKey` 跨 run 稳定
- [ ] Path 不 deep-copy candidates
- [ ] Orchestrator 无 `runLtrFineSpanGeneration` 调用
- [ ] 无 Domain/KenLM 参与 enum/prune

Phase 2 验收：

- [ ] Unit：枚举器 / fallback / boundaryKey / materializer
- [ ] Harness：Phase1 + Path + View 端到端
- [ ] dialog_200：completePathCount / boundaryKeys / prune trace 归档
- [ ] 无 Architecture §19 违规项（Path 相关子集）
- [ ] Phase 1 测试仍 PASS

---

## 19. Final Recommendation

### 19.1 Phase 2 目标确认

冻结 Architecture 规定的主链：

```text
LexicalEdge[] → enumerateCompleteSegmentationPaths() → SegmentationPath[] → PathFineSpanView
```

**代码当前不存在该链路任何一环**；均为 **NEW**。现有 `FormalFineSpan` / LTR / `enumerateIntervalPaths` **不可复用为 Path Enumerator**，但 Phase 1 `LexicalEdge[]` 已是正确输入 SSOT。

### 19.2 模块职责审计摘要

| 模块 | Phase 2 |
|------|---------|
| Window | 仅 Generation — **KEEP 冻结** |
| Recall | 结束于 Candidate → Edge 输入 — **KEEP 冻结** |
| Edge | Phase 2 唯一枚举输入 — **LIMITED**（fallback kind） |
| Enumerator | **NEW** |
| FormalFineSpan | 降为 PathFineSpanView 内 ephemeral — **LIMITED** |
| LTR | 列出全部 ownership；开发时 **REMOVE orchestrator 引用** |

### 19.3 Path Enumeration 可行性

| 项 | 结论 |
|----|------|
| **输入** | `LexicalEdge[]` + `syllableCount` + probe caps |
| **输出** | `SegmentationPath[]` + prune trace |
| **算法** | 构建 pos → outgoing edges 邻接表；从 pos=0 DFS/backtrack；每 position 应用 `maxActivePathsPerPosition`；完整路径应用 `maxCompleteSegmentationPaths` + §8.3 prune |
| **需 Graph？** | 隐式 DAG（ syllable index 节点，Edge 为边）；不需显式 CompatibilityGraph |
| **需 DP？** | 否（需枚举多完整路径，非单最优） |
| **已有实现？** | **无** |
| **复杂度** | 最坏指数；caps 限制为 PROBE 8/8；fallback gap-minimal 控制分支 |
| **资源风险** | 长句 + 稠密 Edge 图；须 cap + prune + harness perf probe |

**LexicalEdge[] → SegmentationPath[]：** 按 `syllableStart` 索引 Edge；从 0 开始选 `syllableStart === currentPos` 的 edge，递归至 `syllableEnd === N`；每条完整 walk 生成一个 `boundaryKey`。

### 19.4 接口新增清单

已在 §7、§9 逐项给出 Responsibility / Input / Output / Owner / Consumer / Invariant。**不重新设计 Architecture** — 严格实现 Contract §4。

### 19.5 冲突检查

**未发现 PHASE 2 ARCHITECTURE CONFLICT。**  
缺口均为未实现组件；Phase 1 与 Phase 2 边界在 SSOT 文档中一致。

### 19.6 最终结论

```text
READY FOR PHASE 2 DEVELOPMENT
```

**前置条件：**

1. 开发范围严格限于 Path enum + fallback + DTO + materializer + orchestrator LTR 移除  
2. Vote / Assembly / KenLM / Compatibility KEEP-DELETE 留 Phase 3  
3. 禁止 feature-flag 双链路  
4. 优先复用 Phase 1 冻结代码作为 Edge 输入，**禁止**默认全盘重写 Window/Recall 栈

---

*Audit basis: Architecture V1.0.0 FROZEN · Implementation Contract V1.0.0 · Phase 1 Final Closure Report · Phase 1 Acceptance Contract CURRENT · Phase 1 Developer Guide CURRENT. No code modified in this audit round.*
