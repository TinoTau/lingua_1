# Recover V5 Phase B — 代码补充说明与实施约束

**对应方案**：[Recover_V5_Phase_B_Nbest_Diff_Window_Pipeline_2026-05-22.md](./Recover_V5_Phase_B_Nbest_Diff_Window_Pipeline_2026-05-22.md)  
**冻结决策**：[Recover_V5_Frozen_Decisions_2026-05-22.md](./Recover_V5_Frozen_Decisions_2026-05-22.md)（D-01、D-07）  
**日期**：2026-05-22  
**前置**：Phase A（词条 pinyin / priorScore 就绪）

---

## 0. 已确认决策（实施必须遵守）

| 决策 | 对本 Phase 的要求 |
|------|-------------------|
| **D-01 替换 V4** | 删除滑窗/observed 窗主路径；V5 仅 diff 驱动 |
| **D-07 不跨 chunk** | context 扩展示截断在 chunk 内；窗 `[start,end)` 必须单 chunk 子集 |
| **D-07 双尺度** | **仅**在 diff context 内同时枚举 2–3（细）与 4–5（粗）；**禁止**整 chunk / 无 diff fallback |
| **D-03** | 句组合仍 ≤2 active windows（Phase D），本 Phase 只产出窗 |

---

## 1. 当前窗管线代码基线

### 1.1 主入口

`recallSegmentWindowCandidates(segmentText, hypotheses, runtime)` — `lexicon/window-recall.ts` L346+

调用链：`lexicon-recall-step.ts` → 上式；segment 来源 `ctx.segmentForJobResult ?? ctx.asrText`。

### 1.2 `buildSegmentWindows` 四类窗（L233–284）

| 顺序 | 来源 | 函数/标签 |
|------|------|-----------|
| 1 | 段内滑动 | `enumerateAsrWindows(segmentText)` → `h0-aw-*` |
| 2 | confusion 精确子串 | `findConfusionObservedSpans` → `cf` |
| 3 | fuzzy + chunk 拼音对齐 observed | `cffz` / `cfpy` |
| 4 | n-best 上 confusion 映射 | `nb{rank}cf` |

**合并**：`mergeAsrWindows(sliding, extras)` — 按 `start:end:text` 去重。

### 1.3 滑动窗参数（硬编码）

`enumerate-asr-windows.ts`：

- `minChars: 2`, `maxChars: 8`, `maxWindows: 192`
- 仅含 CJK 的窗（`hasCjk`）
- 不跨标点 chunk（`detectSuspiciousSpans`）

### 1.4 与 n-best 相关的现有逻辑（非 diff-first）

**`augmentFromNbestSlices`**（L289–340）：

- 对 **已有** `windows[]` 逐 hyp 比较 slice
- 要求 `hypText.length === segmentText.length`，否则 `segment_hypothesis_mismatch` drop
- 不等长时 **不** 产生 diff 窗，只记 drop events

**`mapHypothesisSpanToSegment`**（L218–230）：

- 等长：直接用 span 坐标
- 不等长：`segmentText.indexOf(span.text)` 重定位

### 1.5 坐标冻结

- `SEGMENT_HYPOTHESIS_INDEX = 0` — 所有窗 `hypothesisIndex` 为 0
- Phase B **必须保持** segment-first 写回坐标（与 `applySentenceRepair`、selector 一致）

### 1.6 无 diff 时当前行为

- 仍可能有大量 sliding 窗 → recall → 可能空 `WindowCandidate`
- skip：`no_window_expansion_candidate`（sentence-repair），**非** `no_diff_span`
- `noWindowBucket`：`pinyin_no_hit` / `no_observed_substring` / `segment_alignment_risk` 等

---

## 2. n-best 输入约束（Aggregation 实装）

### 2.1 Hypothesis 来源

- `ctx.asrHypotheses`：`buildAsrHypotheses` / `syncAsrHypothesesToSegment`
- `ctx.asrNbest`：原始 CTC HTTP 证据
- `ctx.segmentSynthetic`：segment ≠ CTC rank0 时为 true，**仍可能** `ctcNbestPreserved: true`

### 2.2 Phase B diff 检测必须使用的文本对

| 角色 | 推荐来源 | 约束 |
|------|----------|------|
| top1 | `hypotheses.find(rank===0).text` 或 `segmentText` | 与 `segmentForJobResult` 对齐规则须文档化 |
| 其他 hyp | `hypotheses.filter(rank!==0)` | **不得**假设与 segment 等长 |

**禁止**：仅复用 `augmentFromNbestSlices` 的等长前提作为唯一 diff 机制。

### 2.3 字符级 diff 建议

- 对每对 `(top1, hypText)` 做序列 diff（插入/删除/替换）
- 输出 `DiffSpan[]` 后再映射到 **segment 字符坐标**
- segment 与 rank0 不一致时：以 **segment 为坐标系**，top1 文本用 rank0 或 segment 规则写清（建议：diff 在 segment 上，hyp 文本通过 `sync` 元数据对齐）

### 2.4 与 `segment_alignment_diagnostics` 关系

- 已有 `nbest_augment_diagnostics`、`nbestAugmentDropEvents`（上限 32 条）
- Phase B 新增 `diff_span_diagnostics`，**复用** drop 事件模式，避免 extra 膨胀

---

## 3. Phase B 目标模块与路径建议

方案建议 `asr-repair/windowing/`；当前窗代码在 `lexicon/`。**约束二选一**（团队冻结其一）：

| 选项 | 说明 |
|------|------|
| **B-PATH-1（推荐）** | 新模块放 `lexicon/nbest-diff-span.ts`、`lexicon/diff-context-windows.ts`，`window-recall.ts` 改入口 |
| B-PATH-2 | 放 `asr-repair/windowing/`，`window-recall.ts` import |

**不得** 在 Phase B 修改 `hotword-recall.ts` TopK 逻辑（属 Phase C）。

---

## 4. 实施约束（冻结）

### 4.1 窗长

```typescript
allowedWindowLengths = [2, 3, 4, 5]  // 来自 qualityConfig，禁止硬编码 6-8
```

- `enumerateAsrWindows` 主路径 **默认关闭**（`features.lexiconRecall.useDiffWindows: true` 或 V5 contract）
- legacy 滑窗仅 `LEXICON_LEGACY_SLIDING_WINDOW=1` 调试，且 **不得** 进入 V5 批测 pass

### 4.2 Context expansion（D-07：禁止跨 chunk）

```typescript
diffContextLeft = 2, diffContextRight = 2  // qualityConfig
// 先算 [span.start-left, span.end+right]，再与所在 chunk [c0,c1) 求交：
contextStart = max(chunk.start, span.start - left)
contextEnd = min(chunk.end, span.end + right)
```

- **禁止** context 越过 **chunk** 边界（**冻结**，非仅 segment 边界）
- 跨 chunk 的 diff 区域：按 chunk **拆分** 为多个独立 context，各自枚举，**不得** 生成跨 chunk 单窗
- `cross_boundary_risk` 仍可报告 observed 风险；**窗坐标** 不得跨 chunk

### 4.2.1 双尺度窗（D-07：仅 diff context，硬冻结）

**前置条件**：`detectNbestDiffSpans` 产出至少一个 diff span；否则 **不调用** 本枚举，直接 `no_diff_span`（**禁止** 用 chunk 顶替）。

**枚举区域**（唯一）：

```text
region = intersect(
  expandDiffSpanContext(diffSpan, left=2, right=2),
  chunkBounds
)
```

在 `region` 上 **且仅在 `region` 上**：

| 尺度 | 窗长 | 用途 |
|------|------|------|
| fine | 2、3 | 局部音节/字词错误 |
| coarse | 4、5 | 词组、术语、成语级召回 |

实现：`enumerateWindowsFromDiffContext(region, fine=[2,3])` + `enumerateWindowsFromDiffContext(region, coarse=[4,5])`，合并去重 → Phase C。

**禁止（B-C6）**：

- 整 chunk 上扫 2–3 / 4–5（无 diff 覆盖也扫）
- 无 diff 时 fallback 到 `detectSuspiciousSpans` 全 chunk 枚举
- 仅用单尺度（仅 fine 或仅 coarse）
- 1 / 6+ 字窗；`enumerateAsrWindows` 滑窗

**批测指标**：`full_chunk_dual_scale_count === 0`；有窗时 `windows_from_nbest_diff_count === windows_enumerated`。

### 4.3 windowTrigger 与可追溯性

每个 `AsrWindow` / 扩展 metadata 必须含：

```typescript
windowTrigger: 'nbest_diff'
diffSpanId: string      // 稳定 hash(span+rank)
hypothesisRank: number // 触发 diff 的 hyp rank
```

写入 `WindowRecallDiagnostics`：

- `windowsFromNbestDiffCount`
- `slidingWindowCount`（目标 0）
- `windowLengthDistribution: Record<2|3|4|5, number>`

### 4.4 无 diff 必须 skip（核心）

```typescript
if (diffSpans.length === 0) {
  // 不得调用 enumerateAsrWindows 作为 fallback
  ctx.recoverSkipped = true;
  ctx.recoverLifecycleSkipReason = 'no_diff_span';
  ctx.repairSkipReason = 'no_diff_span';
  return { candidates: [], diagnostics: { ... } };
}
```

**约束 B-C1**：无 diff 时 **不得** fallback 滑窗/chunk 双尺度；仅 `no_diff_span`。  
**约束 B-C2**：双尺度 **仅**在 diff context 区间内枚举；违反即不符合 V5 Phase B。

### 4.5 保留但降级（Phase B）

| 模块 | Phase B 处置 |
|------|----------------|
| `augmentFromNbestSlices` | 删除或合并进 diff 管线；禁止与 diff 窗双计 |
| confusion/fuzzy observed 窗 | **不**作为窗枚举来源（可 Phase C 作 recall 辅助，非 B） |
| `DEFAULT_MAX_WINDOW_CANDIDATES = 192` | 改为 diff 窗预算（建议 ≤ 64，配置化） |

---

## 5. 与现有类型的衔接

### 5.1 `AsrWindow`（`lexicon-types.ts`）

当前：`{ windowId, text, start, end, syllables }`

Phase B 扩展（二选一）：

- 扩展 `AsrWindow` 可选字段 `meta?: DiffWindowMeta`
- 或并行 `DiffAsrWindow extends AsrWindow`

**约束**：`syllables` 仍由 `textToSyllables(windowText, bundlePinyin?)` 生成；diff 窗文本来自 **segment 切片**，不是 hyp 全文替换 segment。

### 5.2 `recallOnWindows` 不变

Phase B 只改 **windows[] 输入**；`recallHotwordsForWindow` 仍由 Phase C 替换主召回。

---

## 6. result.extra / 批测（Phase B 最小集）

Phase E 完整 metrics；Phase B 须在 `window_recall_diagnostics` 增加：

| 字段 | 说明 |
|------|------|
| `windowsFromNbestDiffCount` | diff 触发窗数 |
| `slidingWindowCount` | 必须为 0（V5） |
| `noDiffSpan` | boolean |
| `windowLengthDistribution` | 仅键 2–5 |

`run-dialog-200-batch.js`：可先加 summary 字段，contract 仍 `historical-restore-v1`。

---

## 7. 测试约束

### 7.1 须新增单测文件

- `lexicon/nbest-diff-span.test.ts`（或 asr-repair/windowing）
- 更新 `window-recall.test.ts`：断言主路径无 `enumerateAsrWindows` 调用（mock）

### 7.2 须覆盖的现有回归

| 测试 | 注意 |
|------|------|
| `sync-asr-hypotheses-to-segment.test.ts` | diff 在 segmentSynthetic 下仍应有 hyp 列表 |
| `segment-alignment-diagnostics.test.ts` | drop reason 不与 diff span 冲突 |
| `lexicon-recall.test.ts` | 改为 diff 窗驱动后更新 fixture |

### 7.3 验收（方案指标）

```text
windows_from_nbest_diff / windows_enumerated ≥ 95%  （有 hyp 差异的 case）
sliding_window_count = 0
window_length_distribution keys ⊆ {2,3,4,5}
no_diff_span 可统计
```

**批测预期**：短期 `window_candidate_count` 可能 **下降**（去掉滑窗+observed 窗）— 属预期，靠 Phase C TopK 拉回。

---

## 8. 禁止项（Phase B）

| ID | 禁止 |
|----|------|
| B-X1 | fallback 到 `enumerateAsrWindows` 当 no diff |
| B-X2 | 修改 `candidateScore` / TopK / KenLM |
| B-X3 | 改变 `SEGMENT_HYPOTHESIS_INDEX` 或 `applySentenceRepair` 写回语义 |
| B-X4 | 仅等长 slice 作为唯一 diff（必须支持 insertion/deletion） |
| B-X5 | 1 字窗或 6+ 字窗 |

---

## 9. 依赖

```text
Phase A（pinyin/prior 数据）→ Phase B（diff 窗）
Phase B → Phase C（TopK 吃 windows[]）
Phase B 的 no_diff_span → Phase D（gate 统一）
```
