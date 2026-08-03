<!-- Documentation Hierarchy Metadata
Status: **SUPERSEDED**
Superseded By: CURRENT Sole Authorities + FW_V4_FREEZE_2026_08_03
Archive Path: docs/archive/SUPERSEDED/FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Phase1_Window_Edge_PreDevelopment_Audit_2026_07_26.md
-->

> **SUPERSEDED** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT Sole Authorities + FW_V4_FREEZE_2026_08_03

# FW Repair V4 — Multi-Path Lexical Lattice V1 · Phase 1 Pre-Development Audit

**WindowQuery + LexicalEdge Only**

| Field | Value |
|-------|-------|
| Date | 2026-07-26 |
| Audit type | **Read-only · Pre-Development** |
| Architecture SSOT | [`FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md`](./FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md) |
| Peer contract | Implementation Contract V1.0.0 |
| Scope | Phase 1 **only**: WindowQuery · Recall reuse · LexicalEdge |
| Out of scope | SegmentationPath · Path Vote · Path Assembly · KenLM · CompatibilityGraph DELETE · Production Orchestrator cutover |
| Code changes this round | **NONE**（本文件为审计，不开发） |

---

## 1. Executive Summary

| 结论项 | 裁决 |
|--------|------|
| Phase 1 可否在**不改 Production Orchestrator**下开发 | **YES** — 独立 harness + fixture 测试 |
| `generateLocalOptionsAtCursor` 能否直接改名替换 | **NO** — 可复用其 **window 构造内核**，但生成策略必须换成全句 1～5；LTR commit/cursor **不得**进入 Phase 1 |
| `GlobalWindowDescriptor` 能否复用为 WindowQuery 载体 | **YES（推荐）** — 扩展/别名映射到 Architecture `LexicalWindowQuery`，禁止平行复制整套 DTO |
| `recallTopKForWindows` 业务内核 | **KEEP 不变** — 输入仍为窗口描述符列表；调用方改为全句窗 |
| `WindowCandidate` 能否作 `LexicalEdge.candidates` | **YES** — 不重新定义 Candidate；merge 键用现有 `hotword.id`（绑定层已有，DTO 缺显式 `termId` 字段需薄补丁） |
| `surfaceText` 是否保留在 RecallQueryKey | **MUST KEEP** — 代码证据：`candidate-score` 用 `windowText`；cache key 注释与 `surfaceText: window.windowText` |
| Utterance Recall Cache | **可继续复用** — Key Dedup 天然成立；全句 1～5 后命中率预期上升 |
| CompatibilityGraph | Phase 1 harness **不依赖**；生产 LTR 链仍依赖（本轮不改） |
| SQLite | 仍逐 Query；Batch SQL **仅标注未来插入点**，本轮不设计实现 |

**Verdict：READY FOR PHASE 1 HARNESS DEVELOPMENT**（在 Architecture V1.0.0 边界内）。

---

## 2. Current Runtime

当前**生产**（过渡代码，非有效架构 SSOT）：

```text
runSpanAssemblyV4Orchestrator
  → buildUtteranceSyllableCoordinate
  → partitionCoarseSpans
  → runLtrFineSpanGeneration
       → while cursor < N:
            generateLocalOptionsAtCursor (len = V4_LIMITS.windowMin..Max = 2..5)
            blockedFilter
            recallTopKForWindows
            commitBestFormalFineSpan  // 唯一 Formal
            cursor = formalSpan.syllableEnd
  → resolveCompatibilityRelations(allCandidates)
  → runDomainAwareAssembly
  → merge ≤16 → KenLM
```

冻结目标（Architecture，Phase 1 只做到 Edge）：

```text
Coordinate → buildLexicalWindowQueries(1..5 full) → Recall → LexicalEdge[]
```

---

## 3. Current Call Graph（与 Phase 1 相关）

```text
ltr-fine-span-generator.ts
  buildWindowAt(cursor, len, …)           // 构造 GlobalWindowDescriptor
  generateLocalOptionsAtCursor            // 仅 cursor 锚定，len∈[2,5]
  runLtrFineSpanGeneration                // commit + cursor — Phase 1 禁止接入生产切换

generate-global-windows.ts
  generateGlobalWindows                   // 全句 start×len，但仍 min=2；生产 orchestrator 不调用

blocked-window-filter.ts
  blockedFilter                           // Latin/punct/gap — soft block，Phase 1 KEEP

recall-topk-for-windows.ts
  recallTopKForWindows(windows[])
  bindLexiconHitsToWindow
  → lexicon-v2 recallSpanTopKV3 / utterance-recall-cache

utterance-recall-cache.ts
  CanonicalRecallQuery + serializeCanonicalRecallQueryKey

span-assembly-v4-orchestrator.ts
  注入 recallForWindows → LTR（生产）
  resolveCompatibilityRelations           // Formal 之后 — Phase 1 harness 不调用
```

---

## 4. Current Data Flow

```text
rawText + syllables + coarseSpans + charSyllableRanges
  → GlobalWindowDescriptor[]
       windowId = `${start}:${end}`
       windowPinyinKey, windowText, rawStart/rawEnd
       spanIds, boundaryCrossCount, blocked, windowSource
  → (optional) blockedFilter 去掉 blocked
  → recallTopKForWindows
       CanonicalRecallQuery(pinyinKey, toneNorm, domainScope, TopK, lexiconVersion, surfaceText=windowText)
       → SQLite / cache Fact
       → bind → WindowCandidate[]（每窗多候选；含 domains[]）
  → [生产] 按 Formal 分组 + Compatibility
  → [Phase 1 目标] 按 (syllableStart,syllableEnd) 合并 → LexicalEdge[]
```

---

## 5. Current Ownership（Phase 1 相关）

| 决策 | 当前 Owner（代码） | Architecture Owner（冻结） | Phase 1 |
|------|-------------------|---------------------------|---------|
| 音节坐标 | `buildUtteranceSyllableCoordinate` | Syllable Coordinate | KEEP |
| 窗口集合 | LTR `generateLocalOptionsAtCursor` | Window Generator | **REPLACE 生成策略** |
| Candidate 合法性 | `recallTopKForWindows` + SQLite | Recall | KEEP 内核 |
| Edge 边界 | **不存在**（Formal 代替） | Edge Builder | **NEW harness** |
| Path / Vote / Assembly / KenLM | Orchestrator | 后续 Phase | **禁止** |

---

## 6. WindowQuery Design

### 6.1 能否用 `buildLexicalWindowQueries` 替换 LTR options？

**可以替换「窗口生成职责」，不能把 LTR 函数原样改名。**

| 现逻辑 | 处置 |
|--------|------|
| `buildWindowAt`：`syllableRangeToRawCharRange`、`windowPinyinKey`、`windowId`、`windowText` | **KEEP / MOVE** 到 Window Generator |
| `collectDistinctCoarseSpanIds` / `anchorCoarseSpanId` / `boundaryCrossCount` | **KEEP** 为 soft Trace（`coarseBoundaryRefs` / `crossesCoarseBoundary`） |
| `generateLocalOptionsAtCursor`：仅 cursor、`len∈[2,5]` | **DELETE 生产决策语义**；harness 不调用 |
| `V4_LIMITS.windowMinSyllables = 2` | **MODIFY（仅 Lattice harness 合同）** → 正式窗 **1..5**；不得静默改生产 LTR 常量除非同步改测试且仅 harness 使用独立常量 |
| `if (!spanIds.length) return null`（`buildWindowAt` L144–146） | **DELETE/MODIFY** — 属 coarse **硬跳过窗**，违反 Architecture §6「禁止硬切断 Window」 |
| `blocked: boundaryCrossCount > max` 直接不进 Recall（LTR `filter !blocked`） | **MODIFY** — 跨 coarse 边界窗仍应 Recall；`crossesCoarseBoundary` 仅 Trace；真正阻断留给 `blockedFilter`（Latin/gap/punct） |
| `commitBestFormalFineSpan` / `cursor = syllableEnd` | **DELETE**（Phase 2 生产切换时）；Phase 1 **禁止**进 harness 主链 |
| `generateGlobalWindows` | **REUSE AS UTILITY 雏形**（已是全句双重循环），但须：min→1；去掉「无 spanIds 则 continue」硬切断；生产仍不调用 |

### 6.2 推荐生成算法（对齐 Architecture，不重开设计）

```ts
// Pseudocode — harness only
for (start = 0; start < N; start++) {
  for (end = start + 1; end <= min(start + 5, N); end++) {
    emit WindowQuery [start, end)
  }
}
```

### 6.3 `GlobalWindowDescriptor` vs 新 DTO

**裁决：复用 `GlobalWindowDescriptor` 作为运行时载体，映射 Architecture `LexicalWindowQuery`，禁止再建平行完整类型树。**

| Architecture 字段 | 现字段 / 映射 | 动作 |
|-------------------|---------------|------|
| `windowId` | `windowId` | KEEP |
| `syllableStart` / `syllableEnd` | 同名 | KEEP |
| `syllableLength` | `end - start` | 计算属性即可，可不落库 |
| `pinyinKey` | `windowPinyinKey` | 别名 KEEP |
| `toneKey?` | 现无独立字段；Tone 在 Recall 内用 `acousticTonePattern` → `toneNorm` | 不强制进窗 DTO |
| `coarseBoundaryRefs?` | `spanIds` | 别名 KEEP |
| `crossesCoarseBoundary` | `boundaryCrossCount > 0` | 派生 |
| `sourceSyllableRefs` | `start..end-1` | 派生 |
| （运行时必要）`rawStart/rawEnd` / `windowText` | 已有 | **KEEP** — Recall `surfaceText` 与 Tone 时间对齐依赖 |

**不能删除 `windowText`/`raw*`：** 否则破坏现有 Recall 绑定与 Tone 切片（见 §8）。

若需类型名义对齐，允许：

```ts
type LexicalWindowQuery = GlobalWindowDescriptor & { /* 仅文档别名或窄扩展 */ }
```

禁止复制一份字段几乎相同的第二结构。

---

## 7. LexicalEdge Design

### 7.1 唯一边界

Architecture：同一 `(syllableStart, syllableEnd)` **唯一** Edge；多 Candidate 挂同一 Edge。

现码：`WindowCandidate` 已带 `syllableStart/syllableEnd`；Recall 按窗产出多候选。**缺少** Edge 聚合层。

Phase 1 harness：

```text
Map<`${start}:${end}`, LexicalEdge>
  candidates: WindowCandidate[]  // 引用/浅合并，不深拷贝数组内容策略按 Contract
  edgeKind: lexical | fallback   // Phase 1：仅有正式召回 → lexical；无候选则不建 lexical Edge
  merge key for candidates: prefer termId (= hotword.id)
```

### 7.2 禁止

- Candidate 展开成多个 Edge  
- 因 Tone/Parent/票数删除整个 Edge（Phase 1 甚至无 Vote）  
- 在 Phase 1 注入「每位置无条件 fallback Edge」（fallback 属 Path 阶段合同）

### 7.3 `WindowCandidate` 字段充足性

| 需求 | 现码 | 结论 |
|------|------|------|
| `domains[]` | `bindLexiconHitsToWindow` 从 `hit.hotword.domains` 冻结拷贝 | **满足** |
| 文本 | `replacement` | **满足** |
| score | `candidateScore` / `score` | **满足** |
| tone | `toneCompatible` / `tonePenalty` / `toneLookupStage` | **满足** |
| termId | **未写入** `WindowCandidate`；存在于 `hit.hotword.id` / `LexiconFactHit.hotwordId` | **薄补丁**：绑定层增加可选 `termId?: string`（或文档约定用 hotwordId）——**不**新建 Candidate 类型 |
| parent | `parentTermId` 等 | **满足** |

**裁决：直接作为 `LexicalEdge.candidates`；禁止重新定义 Candidate。**

---

## 8. Recall Reuse Analysis

### 8.1 保持完全不变（禁止改业务逻辑）

| 组件 | 说明 |
|------|------|
| `recallSpanTopKV3` / LexiconRuntimeV2 SQL | Exact / Tone / Parent / Domain scope |
| TopK 合同 | `V4_LIMITS.exactTopK` / `parentFragmentTopK` |
| `bindLexiconHitsToWindow` 打分与 domains 装配 | minPrior / tone fields / graphSource |
| `candidate-score`（含 `windowText`） | 见下 |
| Utterance cache Fact 存储与 rebind | |

### 8.2 允许改动的仅「编排面」

| 项 | 现况 | Phase 1 |
|----|------|---------|
| 输入窗口集合 | LTR 每步 2..5 局部 | harness 传入全句 1..5（经 blockedFilter） |
| 调用次数 | 每 cursor 一批 | 一句一次（或按批）调用 `recallTopKForWindows` |
| 输出消费 | 交给 `commitBestFormalFineSpan` | 交给 Edge Builder |
| Orchestrator | 注入 `recallForWindows` | **不改** |

### 8.3 `surfaceText` — 必须保留（代码证据）

1. `utterance-recall-cache.ts` L19–23：

```text
Surface text enters key because V2/V3 candidateScore uses windowText
(WINDOW scoring input that must not be shared across different surfaces).
```

2. `recall-topk-for-windows.ts` L325–332：

```ts
surfaceText: window.windowText,
```

3. `lexicon/candidate-score.ts` L20、L99+：`windowText` 参与 `exactLengthBonus` / `editDistancePenalty`。

**结论：Phase 1 继续保持现有 `CanonicalRecallQuery` / `RecallQueryKey`（含 `surfaceText`）。禁止删除。**

---

## 9. SQLite Analysis

| 项 | 现状 |
|----|------|
| 模式 | 逐窗 / 逐 Canonical Key → `recallSpanTopKV3`（prepared + 内存 cache） |
| Phase 1 | **保持逐 Query**；依赖 Utterance Cache 去重 |
| 禁止 | 本轮 Batch SQL、新索引、临时表 |

**未来 Batch Recall 插入点（仅标注，不设计）：**

```text
全句 WindowQuery[]
  → Map<RecallQueryKey, windowId[]>     // 已有 serializeCanonicalRecallQueryKey
  → [FUTURE] multi-key batch SQL        // 仅当 prepared 仍是瓶颈
  → 现有 utteranceCacheSet / bindLexiconHitsToWindow
```

---

## 10. Utterance Cache Analysis

| 问题 | 结论 |
|------|------|
| WindowQuery 是否天然支持 Key Dedup？ | **是** — 同一 `pinyinKey+toneNorm+domainScope+TopK+lexiconVersion+surfaceText` 只查一次 |
| 能否复用 Phase0/1 Utterance Cache？ | **能** — harness 创建 `UtteranceRecallContext` 传入 `recallTopKForWindows` |
| 全句 1..5 效果 | 窗口数上升，但重复 key（同音同表面）预期增多，命中率相对 LTR 局部窗可能改善 |
| 与 Production | Production 已默认启用 cache；Phase 1 harness 独立启用，**不改 orchestrator** |

---

## 11. CompatibilityGraph Dependency

| 问题 | 结论 |
|------|------|
| Phase 1 harness 是否依赖？ | **否** — 停在 LexicalEdge[] |
| 生产是否仍依赖？ | **是** — `orchestrator` 在 Formal 之后对 `allCandidates` 调用 `resolveCompatibilityRelations` |
| 依赖字段 | `WindowCandidate.syllableStart/End`、覆盖/冲突关系、`isCovered` |
| 哪些职责对 Lattice 将失效 | 跨 Formal 重叠裁决（改由 Path 保证）— **PENDING PHASE 3**；本轮禁止改 Compat 代码 |

---

## 12. DELETE（Phase 1 语义 / harness 边界）

```text
Phase 1 harness 主链禁止使用：
  commitBestFormalFineSpan
  runLtrFineSpanGeneration（作为生成 SSOT）
  cursor = syllableEnd 决策

Window 生成中删除/停用：
  「无 coarse spanIds → 不生成窗」（hard cut）
  将 boundaryCrossCount>1 等同于「不进 Recall」的生产决策（改为 soft flag）

不在 Phase 1 删除生产文件（避免改 orchestrator）；仅 harness 不调用。
```

---

## 13. KEEP

```text
buildUtteranceSyllableCoordinate / CharSyllableRange
syllableRangeToRawCharRange
GlobalWindowDescriptor（作 WindowQuery 载体）
WindowCandidate（作 Edge.candidates）
blockedFilter（Latin/CJK gap / punct / asr gap）
recallTopKForWindows + bindLexiconHitsToWindow
utterance-recall-cache + CanonicalRecallQuery（含 surfaceText）
recallSpanTopKV3 / domains[] 装配 / TopK / Tone / Parent
V4_LIMITS exactTopK / parentFragmentTopK / maxSqlPerUtterance
Production orchestrator（整文件不改）
CompatibilityGraph（不改）
Vote / Assembly / KenLM（不改）
```

---

## 14. MODIFY（仅 Phase 1 harness / 新模块，不切生产）

```text
NEW: buildLexicalWindowQueries(full utterance, len 1..5)
  - 复用 buildWindowAt 内核（搬迁或抽取）
  - soft coarse refs；不因跨界跳过 Recall
MAY: harness-local WINDOW_MIN=1（勿在未隔离情况下直接改生产 V4_LIMITS 影响 LTR）
NEW: buildLexicalEdges(candidates[]) → LexicalEdge[] by (start,end)
MAY: WindowCandidate.termId? = hotword.id（绑定层一行级补丁，测试覆盖）
NEW: phase1 harness + unit tests（fixture）
```

---

## 15. Target List

```text
[ ] 抽取/实现 buildLexicalWindowQueries（1..5 全句）
[ ] 映射 GlobalWindowDescriptor ↔ LexicalWindowQuery 字段表
[ ] harness：Coordinate → Windows → blockedFilter → recallTopKForWindows(+cache)
[ ] 实现 LexicalEdge 聚合（唯一边界、多 Candidate）
[ ] 可选：bind 层写入 termId
[ ] 单测：窗完整 / max=5 / 无重复坐标 / coarse 不硬切断 / Edge 去重与 domains
[ ] 确认未修改 span-assembly-v4-orchestrator 生产路径
[ ] 确认未调用 Path/Vote/Assembly/KenLM
```

---

## 16. Check List

```text
[x] 审计依据 = Architecture V1.0.0（未重开架构）
[x] 未建议恢复 LTR SSOT
[x] 未建议 Beam / 第二主链
[x] 未建议改 Vote / Assembly / KenLM
[x] 未进入 Phase 2 Path
[x] surfaceText 保留有代码证据
[x] Recall 内核保持不变
[x] Candidate 不重定义
[x] Production Orchestrator 可保持不动
[ ] （开发时）Phase 1 代码落地后跑 harness 验收
```

---

## 17. Regression Risk

| 风险 | 等级 | 说明 |
|------|------|------|
| 误改 `V4_LIMITS.windowMinSyllables` 影响生产 LTR | **高** | harness 应用独立常量或 feature-local 覆盖，勿直接改共享常量直到 Phase 2 |
| 全句 1..5 触发 `maxSqlPerUtterance=150` 提前截断 | **中** | 依赖 cache 去重；计量 SQL；超限记 Trace，不本轮改预算除非证据 |
| 去掉 spanIds 硬切断后窗数上升 | **中** | 预期行为；用 blockedFilter 管 Latin gap |
| 误改 `candidate-score` / 去掉 surfaceText | **高** | 禁止 |
| 误把 harness 接入 orchestrator | **高** | Phase 1 边界红线 |

---

## 18. Acceptance Criteria（Phase 1）

1. 全句生成连续音节窗，长度 **1..5**，坐标 `[start,end)`  
2. 无重复 `(start,end)` 窗  
3. coarse **不**因硬切断丢弃合法窗；`blockedFilter` 仍阻断 Latin/gap  
4. `recallTopKForWindows` 内核未改；`domains[]` 完整  
5. 同 `(start,end)` 仅一个 `LexicalEdge`；多 Candidate 同 Edge  
6. Candidate 类型仍为 `WindowCandidate`  
7. RecallQueryKey **含 surfaceText**  
8. Utterance Cache 可启用且语义与现绑定一致  
9. **零** SegmentationPath / Vote / Assembly / KenLM / Compat 修改  
10. **零** Production Orchestrator 接线  

---

## 19. Phase 1 Development Boundary

```text
允许：
  新文件（window generator / edge builder / harness / tests）
  从 LTR/global-windows 抽取纯函数到新模块
  可选：bindLexiconHitsToWindow 增加 termId 透传

禁止：
  修改 span-assembly-v4-orchestrator 主链
  删除或停用生产 runLtrFineSpanGeneration
  实现 SegmentationPath / Path Vote / Assembly
  修改 CompatibilityGraph
  修改 Domain Vote 公式或 KenLM
  feature flag / shadow 双执行
  Batch SQL / 新索引 / 临时表
```

---

## 附录 A — 重点问题对照表

| # | 问题 | 裁决 |
|---|------|------|
| 一 | LTR → buildLexicalWindowQueries | 复用构造内核；替换生成策略；删 commit/cursor |
| 二 | GlobalWindowDescriptor | **复用**；字段映射见 §6.3 |
| 三 | Recall | 内核不变；改输入窗集合与消费方 |
| 四 | LexicalEdge 唯一 | harness 新建聚合；禁 Candidate→多 Edge |
| 五 | Candidate | 直接用 WindowCandidate；termId 薄补丁 |
| 六 | RecallQueryKey / surfaceText | **保留**（三处代码证据） |
| 七 | Utterance Cache | 继续复用 |
| 八 | SQLite | 逐 Query；Batch 仅未来插入点 |
| 九 | Coarse | soft refs + blockedFilter；删 spanIds 硬切断 |
| 十 | Compat | Phase 1 不依赖；生产仍用；不改 |
| 十一 | Production | **可不改 Orchestrator** |

---

## 附录 B — 代码锚点

| 符号 | 路径 |
|------|------|
| `generateLocalOptionsAtCursor` | `span-assembly-v4/ltr-fine-span-generator.ts` |
| `buildWindowAt` | 同上 |
| `generateGlobalWindows` | `span-assembly-v4/generate-global-windows.ts` |
| `GlobalWindowDescriptor` / `WindowCandidate` | `span-assembly-v4/v4-types.ts` |
| `V4_LIMITS.windowMinSyllables` | `span-assembly-v4/v4-limits.ts`（=2） |
| `recallTopKForWindows` | `span-assembly-v4/recall-topk-for-windows.ts` |
| `CanonicalRecallQuery.surfaceText` | `span-assembly-v4/utterance-recall-cache.ts` |
| `computeCandidateScore` / `windowText` | `lexicon/candidate-score.ts` |
| Orchestrator LTR+Recall | `span-assembly-v4/span-assembly-v4-orchestrator.ts` ~187–225 |
| Compat | `span-assembly-v4/candidate-compatibility-graph.ts` |
