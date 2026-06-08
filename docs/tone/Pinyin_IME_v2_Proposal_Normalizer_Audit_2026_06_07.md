# Pinyin IME V2 Proposal / Normalizer 只读审计报告

**日期：** 2026-06-07  
**性质：** 只读事实审计（未改码）  
**数据源：** `lexicon-tone-dialog200-spanselector-batch-result.json` + 离线重放 `runPinyinImeV2SpanProposal` / `normalizePinyinImeV2Spans`  
**探针：** `tests/experiments/_readonly-proposal-normalizer-audit.mjs`（只读，非产品路径）

---

## 一、Proposal 与 Normalizer 定位

| 文件 | 函数 | 输入 | 输出 |
|------|------|------|------|
| `run-pinyin-ime-v2-span-proposal.ts` | `runPinyinImeV2SpanProposal` | `rawAsrText`, `dict`, `{ topK }` | `PinyinImeV2SpanProposal` |
| `pinyin-ime-v2-boundary.ts` | `applyBoundaryDiscovery` | `rawAsrText`, `diffSpans`, `instabilityRegions` | 音节对齐后的 diff + instability |
| `pinyin-ime-v2-span-normalizer.ts` | `normalizePinyinImeV2Spans` | 三类 span 源 + `rawAsrText` + char/syllable 配置 | `{ spans, dropped }` |
| `resolve-pinyin-ime-v2-spans.ts` | `resolvePinyinImeV2Spans` | profile + rawText | 编排 Proposal → **SpanSelector** → FwSpan |

### 实际链路

```text
rawAsrText
  → normalizeForImeAlignment + extractRawCoarseBoundaries
  → textToPinyinStream → decodeRawTextTopK (topK≤5)
  → computeBoundaryAlignmentDiagnostics (4C, 仅 diagnostics)
  → collectDiffSpansFromCandidates (字符 diff)
  → buildInstabilityRegions + aggregateDiffSpanSupport
  → applyBoundaryDiscovery (音节 snap)
  → buildBoundaryCompatibleTopKDiff (4D boundary span)
        ↓
PinyinImeV2SpanProposal
        ↓
normalizePinyinImeV2Spans
  → toIntervals → mergeAdjacent → char/syllable 门控
        ↓
SpanSelector（本轮不审计）
```

---

## 二、Proposal 输出类型与生成规则

### `PinyinImeV2SpanProposal` 结构

```typescript
{
  rawAsrText: string;
  candidates: PinyinImeV2Candidate[];      // decode TopK
  diffSpans: PinyinImeV2DiffSpan[];
  instabilityRegions: PinyinImeV2InstabilityRegion[];
  boundaryCompatibleTopKSpans: BoundaryCompatibleTopKSpan[];
  diagnostics: PinyinImeV2ProposalDiagnostics;
}
```

### diffSpans

| 项 | 说明 |
|----|------|
| **生成函数** | `collectDiffSpansFromCandidates` → `diffReplacementSpans` |
| **条件** | 对每个 TopK candidate：`rawAsrText` 与 `candidate.text` 字符级 diff；**仅 substitution 链**；insert/delete → `alignFailed` |
| **失败门控** | 编辑距离 `> max(m,n) * 0.6` → 整 candidate 丢弃（`alignFailedCount++`） |
| **输出字段** | `{ rawSpan, start, end, candidateRank, supportCount }` |

### instabilityRegions

| 项 | 说明 |
|----|------|
| **生成函数** | `buildInstabilityRegions(diffSpans)` |
| **条件** | 来自 diffSpans 区间合并；`supportCount` = 覆盖该区间的 distinct candidateRank 数 |
| **输出字段** | `{ rawSpan, start, end, variants[], supportCount }` |

### boundaryCompatibleTopKSpans

| 项 | 说明 |
|----|------|
| **生成函数** | `buildBoundaryCompatibleTopKDiff` |
| **条件 1** | `selectTrustedTopKCandidates`：token 路径存在 + 4C compatibility ≥ threshold |
| **条件 2** | trustedCount ≥ 2 |
| **条件 3** | 收集 trusted token 音节区间；区间内 ≥2 个不同 variant 词 |
| **条件 4** | `syllableRangeToRawCharRange` 映射 raw 偏移成功 |
| **输出字段** | `{ rawSpan, start, end, syllableStart, syllableEnd, supportCount, confidence, variants, contributingRanks }` |

> **注意：** 4D span **不是** diffSpans 的 fallback 语义；当 `diffSpanCount=0` 且 `boundaryCompatibleTopKSpanCount>0` 时，diagnostics 记 `diffZeroBoundaryPositive=1`（d001 即此类）。

---

## 三、d001 完整 Trace

**参考：** 热拿铁 **中杯** · **蓝莓马芬**  
**ASR：** `你好,我想点一杯热拿铁钟贝少糖 深便温 以下今天有蓝美马分吗?`

### 3.1 Proposal 阶段

| 字段 | 值 |
|------|-----|
| `candidateCount` | 5 |
| `diffSpanCount` | **0** |
| `instabilityRegionCount` | **0** |
| `boundaryCompatibleTopKSpanCount` | **2** |
| `alignFailedCount` | **5**（TopK 全部 align 失败） |
| `diffZeroBoundaryPositive` | **1** |
| `trustedTopKCount` | 5 |

**diffSpans：** `[]`  
**instabilityRegions：** `[]`

**boundaryCompatibleTopKSpans（实际内容，非钟贝/蓝美马分）：**

| rawSpan | start–end | variants | 说明 |
|---------|-----------|----------|------|
| `想` | 4–5 | 向, 想 | ASR 原文已是「想」，非 ASR 错字区 |
| `少` | 13–14 | 勺, 少, 绍 | ASR 原文已是「少」（少糖），非错字区 |

**IME TopK 样例（rank 1）：**  
`你好我向点以被热拿铁中杯勺趟身边文艺下今天游览每马芬吗`  
（句级结构与 raw 差异极大 → 触发 `alignFailed`，**字符 diff 路径零输出**）

**proposalDiagnostics 要点：**

- `decodeMs`: 28
- `boundaryCompatibilityScoreMax/Avg`: 1
- `tokenSourceConflictDiagnosticCount`: 5
- `normalizedTextDiffDiagnosticCount`: 5

### 3.2 Normalizer 阶段

输入 2 个 boundaryTopK interval，merge 后仍为 2 个（不相邻，未合并）。

| span | 来源 | 保留/删除 | 删除原因 | 精确规则 |
|------|------|-----------|----------|----------|
| `想` | boundaryTopK | **删除** | `single_char` | Rule-3：`charLen(1) < minSpanChars(2)` |
| `少` | boundaryTopK | **删除** | `single_char` | Rule-3：同上 |

补充：若仅去掉 Rule-3，Rule-5 仍会删除（`textToSyllables('想').length === 1 < minSyllables(2)`）。

**Normalizer 输出：** `spans=[]`，`dropped.length=2` → SpanSelector `selectedSpanCount=0`。

---

## 四、Normalizer 全部规则（按代码顺序）

### Rule-1 — 收集 interval

- **条件：** 调用 `toIntervals(diffSpans, instabilityRegions, boundaryCompatibleTopKSpans)`
- **作用：** 三类 proposal 源统一为 `RawInterval[]`，标记 `fromInstability` / `fromBoundaryTopKDiff`

### Rule-2 — 相邻/重叠合并（mergeAdjacent）

- **条件：** 排序后 `current.start <= last.end + 1`（重叠或相邻 1 字符）
- **作用：** 合并 interval；`end` 取 max；`supportCount` 取 max；`rawSpan` 取较长字符串；flags OR

### Rule-3 — 最小字符数（single_char）

- **条件：** `rawSpan = rawAsrText.slice(start, end)` 且 `charLen < config.minSpanChars`（默认 **2**）
- **作用：** `dropped`，reason=`single_char`

### Rule-4 — 最大字符数（too_long）

- **条件：** `charLen > config.maxSpanChars`（默认 **6**）
- **作用：** `dropped`，reason=`too_long`

### Rule-5 — 音节数门控（syllable_out_of_range）

- **条件：** `textToSyllables(rawSpan).length` 不在 `[minSyllables, maxSyllables]`（默认 **[2, 5]**）
- **作用：** `dropped`，reason=`syllable_out_of_range`

### Rule-6 — 通过

- **条件：** Rule-3/4/5 均未触发
- **作用：** 写入 `spans[]`

> Normalizer **无** neighbor / lexicon / support / domain / Recall 判断。

---

## 五、dialog_200 统计（200 条离线重放）

### 5.1 按 span 次计数（drop 事件）

| Rule | 删除次数 |
|------|----------|
| `single_char` | **164** |
| `too_long` | **8** |
| `syllable_out_of_range` | **3** |
| `intervalMerge`（输入 span 被合并消减） | **597** |
| 通过保留 | **174** |

### 5.2 按 case 计数（至少触发一次）

| Rule | 影响 case 数 |
|------|--------------|
| `single_char` | **98** |
| `too_long` | **8** |
| `syllable_out_of_range` | **3** |
| Normalizer 后仍空（有输入但 0 span） | **65** |
| 有 selected span（当前 SpanSelector 后 fw 路径） | **106** |

### 5.3 Top 删除规则

1. **intervalMerge** — 597 次（结构性合并，非 veto）
2. **single_char** — 164 次 / 98 案
3. **too_long** — 8 次 / 8 案
4. **syllable_out_of_range** — 3 次 / 3 案

---

## 六、设计漂移判断

**原始冻结：** IME 发现 span → 每句 2~4 个 → Recall

**Normalizer 当前是否承担：**

| 判断类型 | 是否存在 | 代码位置 |
|----------|----------|----------|
| neighbor | **否** | — |
| 词库 | **否** | — |
| support | **否** | — |
| domain | **否** | — |
| Recall-like | **否** | — |

Normalizer 仅承担：**interval 合并 + 字符长度 + 音节数** 结构过滤，与冻结文档「Recall-ready syllableCount ∈ [2,5]」一致。

**漂移在 Proposal 层而非 Normalizer：**

- d001 的 **diffSpans=0** 来自 `diffReplacementSpans` 整句 align 失败（`alignFailedCount=5`），非 Normalizer。
- 4D boundary span 在 d001 上落在 **正确字「想/少」** 的单音节 interval，**未覆盖** ASR 错字「钟贝/蓝美马分」。

---

## 七、d001 删除类型结论

| 候选 | 实际 ASR 错字 | Proposal 是否产出 | Normalizer 删除 |
|------|---------------|-------------------|-----------------|
| 钟贝 | ✓ | **否**（diff=0；4D 未落此区间） | — |
| 蓝美马分 | ✓ | **否** | — |
| 想 | ✗（原文正确） | 是（4D 误区间） | **A 结构过滤** `single_char` + 潜在 `syllable_out_of_range` |
| 少 | ✗（原文正确） | 是（4D 误区间） | **A 结构过滤** 同上 |

**结论：**

- d001 根因 **不是**「钟贝/蓝美马分被 Normalizer 逻辑过滤」——Proposal **从未产出** 这两个 span。
- Normalizer 删除的是 **两个 1 字 4D span（想、少）**，属于 **A 结构过滤**（`minSpanChars=2` + `minSyllables=2`）。
- **不是 B**（无「boundaryTopK 不允许进入」类逻辑；boundaryTopK 会进入 Normalizer，但被 char/syllable 门控丢弃）。

---

## 八、最小放宽模拟（仅分析）

### d001 — 逐规则放宽

| 模拟 | selectedSpanCount | 进入 Recall 的 span | 是否命中 ASR 错字 |
|------|-------------------|---------------------|-------------------|
| 基线 | 0 | — | — |
| 仅 `minSpanChars=1` | 0 | — | syllable 门控仍杀 |
| 仅 `minSyllables=1` | 0 | — | single_char 仍杀 |
| **`minSpanChars=1` + `minSyllables=1`** | **2** | `想`, `少` | **否**（非钟贝/蓝美马分） |
| 取消 merge | 0 | — | 两 span 仍各 1 字 |

### dialog_200 — 批量模拟（Normalizer 配置）

| 配置 | 有 selected span 的 case 数 | empty_after_normalizer |
|------|----------------------------|------------------------|
| 基线 | 106 | 65 |
| 仅放宽 char 或仅放宽 syllable | 106 | 65 |
| **同时 `minSpanChars=1` + `minSyllables=1`** | **167** | **4** |
| `maxSpanChars=8` | 106 | 65 |

> 同时放宽两 gate 会大量放行 1 字 4D 噪声 span，**fw_triggered 理论 +61**，但 Recall 质量风险高。

---

## 九、最终结论

| # | 问题 | 答案 |
|---|------|------|
| 1 | Proposal 是否已发现 d001 问题区域（钟贝/蓝美马分）？ | **否**。`diffSpans=0`（TopK 整句 align 全失败）；4D 产出 2 span 但落在「想/少」正确字上，**未覆盖错字区**。 |
| 2 | d001 被哪条 Normalizer 规则删除？ | 两个 4D span 均因 **Rule-3 `single_char`**（`charLen=1 < minSpanChars=2`）；Rule-5 亦会拦截。 |
| 3 | 该规则设计目的？ | 保证 Recall 输入为 **≥2 字、2~5 音节** 的 span（冻结 Normalizer 注释与 config 默认）。 |
| 4 | 是否符合原始冻结设计？ | **Normalizer 本身符合**；d001 失败主因是 **Proposal 未发现错字 span**，非 Normalizer 越权。 |
| 5 | 是否设计漂移？ | **Normalizer 无漂移**；**Proposal（diff align 阈值 + 4D 音节映射）** 与「发现 ASR 错字区间」目标存在 gap。 |
| 6 | dialog_200 中该规则影响？ | `single_char`：**164 次 / 98 案**；与 empty_after_normalizer **65 案**高度重叠。 |
| 7 | 是否应该调整？ | **不应仅放宽 Normalizer 解决 d001**（会放行错误 1 字 span）。应优先 **Proposal：diff/4D 覆盖 ASR Substitution 区**。 |
| 8 | 最小调整方案（建议方向，非本轮开发） | ① 降低或分段 `diffReplacementSpans` 整句 align 失败率；或 token-path 局部 diff；② 4D `syllableRangeToRawCharRange` 对齐 ASR/raw diff 区；③ d001 类 `diffZeroBoundaryPositive` 单独审计 4D 误区间。Normalizer 仅当 Proposal 产出 **2+ 字错字 span** 后才讨论。 |
| 9 | 预计对 fw_triggered 的影响？ | 仅放宽 Normalizer 双 gate：**+61**（106→167，含大量 1 字噪声）；**不能**靠此修复 d001 餐饮错词。修复 Proposal 命中钟贝/蓝美马分：取决于 diff/4D 改造，**非 Normalizer 单点可调**。 |

---

## 十、禁止项确认

本轮 **未** 修改：`SpanSelector` / `Recall` / `Tone` / `KenLM` / `Apply` / 任何产品源码逻辑。

---

## 附录 — 关键代码引用

Proposal 编排：`run-pinyin-ime-v2-span-proposal.ts` L75–112  
diff align 失败：`pinyin-ime-v2-diff-spans.ts` L45–47, L94–96  
4D span 生成：`pinyin-ime-v2-boundary-compatible-topk-diff.ts` L150–214  
Normalizer 门控：`pinyin-ime-v2-span-normalizer.ts` L125–157  
