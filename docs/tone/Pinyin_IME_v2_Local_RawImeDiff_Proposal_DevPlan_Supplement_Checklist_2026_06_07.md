# Pinyin IME v2 Local Raw-IME Diff Proposal — 开发方案补充清单

**对照文档：** [Pinyin IME v2 Local Raw-IME Diff Proposal 开发方案.md](./Pinyin%20IME%20v2%20Local%20Raw-IME%20Diff%20Proposal%20开发方案.md)（V1.0）  
**代码基线：** `electron_node/electron-node/main/src/fw-detector/pinyin-ime-v2/`  
**审计依据：** [Pinyin_IME_v2_Local_RawImeDiff_Proposal_Audit_2026_06_07.md](./Pinyin_IME_v2_Local_RawImeDiff_Proposal_Audit_2026_06_07.md)  
**日期：** 2026-06-07

本文档汇总开发方案 V1.0 与**实际代码**对照后，需要在开发前**补充写入方案**或**开发时强制遵守**的信息与约束。按优先级排列。

---

## 一、必须在方案中补写的集成细节（P0）

### 1.1 Proposal 内插入位置（方案 §三未写清）

当前 `run-pinyin-ime-v2-span-proposal.ts` 顺序为：

```text
collectDiffSpansFromCandidates → [此处替换 rawDiffSpans] → aggregateDiffSpanSupport
→ buildInstabilityRegions → applyBoundaryDiscovery
→ buildBoundaryCompatibleTopKDiff（4D，并行保留）
```

**补充约束：**

| 项 | 要求 |
|----|------|
| 替换时机 | 在 `collectDiffSpansFromCandidates` **之后**、`aggregateDiffSpanSupport` **之前** |
| 仍跑整句 diff | 即使最终替换，**仍须**先调用 `collectDiffSpansFromCandidates`，以保留 `diagnostics.alignFailedCount` |
| `diagnostics.diffSpanCount` | 必须反映**最终**进入 pipeline 的 `diffSpans.length`（替换后） |
| instability | local 替换后，`instabilityRegions` 由 local diffSpans **重新派生**（现有逻辑不变） |
| 4D 不关闭 | `boundaryCompatibleTopKSpans` **继续生成**；d001 仍会有「想/少」4D span，靠 Normalizer `minSpanChars=2` 过滤 |

### 1.2 激活条件精确语义（方案 §七需细化）

代码事实（`pinyin-ime-v2-diff-spans.ts` L109）：

```typescript
const unionTopK = candidates.slice(0, topK);
```

**补充约束：**

```typescript
// 推荐写法（与现有 alignFailedCount 语义一致）
const evaluatedCount = Math.min(input.config.topK, candidates.length);
const localActivated =
  evaluatedCount > 0 &&
  alignFailedCount === evaluatedCount;
```

| 场景 | 是否激活 local |
|------|----------------|
| 5 候选、5 次 alignFailed | ✅ |
| 2 候选（decode 仅 2 条）、2 次 alignFailed | ✅ |
| 5 候选、3 次 alignFailed、2 次成功（如 d002） | ❌ — 用 existingDiffSpans |
| `candidateCount === 0` / 无 CJK | ❌ — 早退，不进入 builder |

**禁止：** `alignFailedCount > 0` 即激活（部分失败仍走整句 diff 成功路径）。

### 1.3 「禁止混用」的精确含义（方案 §七）

| 允许 | 禁止 |
|------|------|
| local 替换后的 `diffSpans` + 既有 `instabilityRegions` + 既有 `boundaryCompatibleTopKSpans` 进入 Normalizer | 将 local spans **追加** 到 non-empty existingDiffSpans（d002 回归：2 span → 1 span） |
| 4D 与 local diff **并存**于 Normalizer 输入 | 将 local span 写入 `boundaryCompatibleTopKSpans` |

### 1.4 d001「蓝美马分」验收口径（方案 §十需改写）

探针实跑（per-token 逻辑）：

| 目标 | 实际产出 |
|------|----------|
| 精确 rawSpan=`蓝美马分` | per-token 分为 `有蓝` + `马分` |
| 覆盖错字区 | Normalizer `mergeAdjacent` 合并为 **`有蓝美马分`** (24–29，5 音节) ✅ |

**补充验收约束（二选一写入方案）：**

- **V1.0 推荐：** 接受 rawSpan 为 **`钟贝`** + **覆盖音节的合并 span**（`有蓝美马分` 或 interval 级 `蓝美马分`），不要求 per-token 精确四字。
- **V1.1 可选：** 增加 `wordForInterval`（复用 4D 内部逻辑）对 resegment 区间产出精确 `蓝美马分`。

### 1.5 `selectedSpanCount > 0` 非纯 Proposal 指标（方案 §十）

`resolve-pinyin-ime-v2-spans.ts` 路径：

```text
Proposal diffSpans → Normalizer → SpanSelector（lexiconNearNeighbor 排序）→ mapSelectedSpansToFwSpans
```

**补充约束：**

| 层级 | d001 开发后预期 |
|------|-----------------|
| Proposal `diffSpanCount` | ≥ 2（含「钟贝」）— **必验** |
| Normalizer `normalizedSpanCount` | ≥ 2 — **必验** |
| `selectedSpanCount > 0` | 依赖 `recallSpanTopK` neighbor；**批测验收**，单测可 mock neighbor |

---

## 二、接口与实现约束补充（P0）

### 2.1 `LocalRawImeDiffInput` 建议简化

方案 §五同时要求 Step 1 调用 `selectTrustedTopKCandidates` 又在 input 传入 `trustedCandidates`，**冗余且易漂移**。

**建议写入方案：**

```typescript
export type LocalRawImeDiffInput = {
  rawAsrText: string;
  candidates: PinyinImeV2Candidate[];
  alignmentScores: BoundaryAlignmentScore[];
  // charRanges 由 builder 内部 buildCharSyllableRanges(rawAsrText) 生成，不外部传入
};
```

或保留 `charRanges` 但 **禁止** proposal 外构建后传入不同实例（测试除外）。

### 2.2 比较函数必须是 `normalizeTraditionalChinese`

| 函数 | 用途 |
|------|------|
| `normalizeTraditionalChinese` | ✅ local diff 比较（与 4D `wordForInterval` 一致） |
| `normalizeForImeAlignment` | ❌ 不用于 local diff（去标点/空格，会改变 rawSlice 语义） |

代码位置：`normalize-for-ime-alignment.ts` L50。

### 2.3 过滤常量必须与 Normalizer 默认一致

`runPinyinImeV2SpanProposal` 入参仅有 `config.topK`，**不含** `minSpanChars` 等。

**补充约束：** builder 内引用 `DEFAULT_PINYIN_IME_V2`（`pinyin-ime-v2-config.ts`）：

```typescript
minSpanChars: 2
maxSpanChars: 6
minSyllables: 2
maxSyllables: 5
```

音节计数使用 `textToSyllables`（`../../lexicon/phonetic/pinyin`），与 `pinyin-ime-v2-span-normalizer.ts` L107 **相同**。

### 2.4 Token 级过滤：interval 音节数

方案 Step 6 需同时写明：

```typescript
const intervalSyllables = token.syllableEnd - token.syllableStart;
// intervalSyllables 与 textToSyllables(rawSlice).length 均须在 [2, 5]
```

避免单音节 token（如「每」syllable 23–24）产生 span。

### 2.5 CJK 判定

复用 `pinyin-ime-v2-pinyin-stream.ts` 相同正则：

```typescript
/[\u4e00-\u9fff\u3400-\u4dbf]/
```

`rawSlice` 必须**全部**为 CJK run 内字符（映射失败则 skip）。

### 2.6 `PinyinImeV2DiffSpan` 字段填充

| 字段 | 规则 |
|------|------|
| `rawSpan` | `rawAsrText.slice(start, end)` |
| `start` / `end` | 来自 `syllableRangeToRawCharRange` |
| `candidateRank` | Contributing ranks 中 **最小 rank** |
| `supportCount` | **distinct trusted ranks** 命中该 `[start,end)` 的数量 |

**禁止**新增 `LocalRawImeDiffSpan` 运行时类型（方案已写，保持）。

### 2.7 `applyBoundaryDiscovery` 对 local span 的副作用

local span 替换后仍经过 `snapSpanToSyllableBoundaries`。**单测须断言** d001「钟贝」(11–13) snap 后坐标不变或仍覆盖目标区。

---

## 三、允许修改文件清单补充（P1）

方案 §二「允许修改」过窄，按现有工程惯例应补充：

| 文件 | 动作 | 说明 |
|------|------|------|
| `pinyin-ime-v2-local-raw-ime-diff.ts` | 新增 | 方案已列 |
| `pinyin-ime-v2-local-raw-ime-diff.test.ts` | 新增 | 方案 Test 已列但未写入允许修改 |
| `run-pinyin-ime-v2-span-proposal.ts` | 修改 | 方案已列 |
| `run-pinyin-ime-v2-span-proposal.test.ts` | 修改 | d001 / 门控集成 |
| `pinyin-ime-v2-types.ts` | 修改 | `PinyinImeV2ProposalDiagnostics` 新字段 |
| `pinyin-ime-v2-diagnostics.ts` | 修改 | `emptyProposalDiagnostics` 默认值 |
| `index.ts` | 修改（可选） | export `buildLocalRawImeDiffSpans` |
| `pinyin-ime-v2-freeze-contract.test.ts` | 修改（建议） | 断言 imeWord 不进 selector / 无 fourth pipeline |
| `resolve-pinyin-ime-v2-spans.ts` | **默认不改** | 见 §四 |
| `fw-detector/types.ts` | **默认不改** | 见 §四 |

**仍禁止：** Normalizer、SpanSelector、Recall、Tone、KenLM、Apply、decoder、domain recall。

---

## 四、Diagnostics 与可观测性补充（P1）

### 4.1 两层 diagnostics

| 层 | 类型 | 字段 |
|----|------|------|
| Proposal | `PinyinImeV2ProposalDiagnostics` | 方案 §八全部字段 — **必加** |
| Active path | `PinyinImeV2ActiveDiagnostics`（`fw-detector/types.ts`） | 方案 **未列** |

**补充约束：**

- V1.0 **最低要求：** Proposal diagnostics 完整输出；单测断言 `localRawImeDiffExampleSpans` 含钟贝样例。
- **批测可见性（可选）：** 若 dialog_200 批测需读 `localRawImeDiffActivated`，须另开 Amendment 修改 `resolve-pinyin-ime-v2-spans.ts` + `PinyinImeV2ActiveDiagnostics` 透传 — **当前方案冻结范围未包含**。

### 4.2 `localRawImeDiffActivated` 类型一致性

现有 Proposal diagnostics 中 `diffZeroBoundaryPositive` 为 **`number`（0/1）**。

**建议：** 新字段统一 `number`（0/1）或明确写 `boolean` 并在 `emptyProposalDiagnostics` 设 `false`。

### 4.3 `localRawImeDiffExampleSpans` 类型

```typescript
export type LocalRawImeDiffExampleSpan = {
  rawSlice: string;
  imeWord: string;       // diagnostics only
  syllableStart: number;
  syllableEnd: number;
  rawStart: number;
  rawEnd: number;
  source: 'local_raw_ime_diff';
};
```

**禁止**该类型出现在 `PinyinImeV2DiffSpan`、`FwSpanDiagnostics`、`NormalizedSpan`。

### 4.4 下游 signal 语义（方案未写）

local span 经 Normalizer 进入 SpanSelector 后：

| 字段 | 值 |
|------|-----|
| `NormalizedSpan.fromBoundaryTopKDiff` | `false` |
| `PinyinImeV2SelectedSpan.reason` | `ime_v2_diff` |
| `FwSpanDiagnostics.signals` | `['ime_v2_diff_hint']` |

**不新增** `ime_v2_local_raw_ime_diff` reason（避免改 SpanSelector / map-selected-span）。

---

## 五、trustedTopK 与 4D 边界补充（P1）

### 5.1 trusted 选取规则（复用代码）

`selectTrustedTopKCandidates`（`pinyin-ime-v2-boundary-compatible-topk-diff.ts`）：

- `tokens.length > 0`
- `compatibilityScore >= BOUNDARY_COMPATIBILITY_MATCH_THRESHOLD`（**0.5**）
- 无 raw 粗边界时 compat 默认为 **1**（`pinyin-ime-v2-boundary-align.ts` L68–74）

**补充约束：** local diff **不另设** compat 阈值；与 4D 共用 trusted 集合。

### 5.2 是否要求 `MIN_TRUSTED_FOR_DIFF = 2`

4D 在 `trustedCount < 2` 时不产出 span。local diff **方案未写**。

**建议写入方案：**

- V1.0：**不强制** trusted≥2（d001 trusted=5；trusted=1 时 supportCount 恒为 1 仍可通过 Normalizer）。
- 若 FP 过高再 Amendment 增加 `trustedCount >= 2` 门控。

### 5.3 4D 并存行为（d001 必知）

local 激活后 Normalizer 输入仍为 **三路合并**：

```text
diffSpans(local) + instabilityRegions + boundaryCompatibleTopKSpans(想/少)
```

**预期：** 4D 单字 span 被 Normalizer 丢弃；local 2+ 字 span 保留。无需关闭 4D。

---

## 六、测试清单补充（P1）

方案 §九/§十二应追加：

| # | 测试 | 断言 |
|---|------|------|
| T1 | `buildLocalRawImeDiffSpans` 单元 | 输入 mock token → 输出 `PinyinImeV2DiffSpan[]` |
| T2 | d001 集成（真实 dict） | `localRawImeDiffActivated=1`；spans 含「钟贝」 |
| T3 | 钟贝→中杯 | start=11,end=13,supportCount=5 |
| T4 | 蓝美马分区域 | `有蓝美分` 或合并 span 覆盖 char 25–29 |
| T5 | alignFailed 门控 | d002：`localRawImeDiffActivated=0`；norm spans 数量不变 |
| T6 | d003 不退化 | `normAfter >= normBefore` |
| T7 | imeWord 隔离 | `mapSelectedSpansToFwSpans` 输出无 imeWord 字段 |
| T8 | freeze contract | 新模块不含 `applyFwSpanReplacements` / `segmentForJobResult=` |
| T9 | 部分 alignFailed | 3/5 failed → local **不**激活 |
| T10 | `applyBoundaryDiscovery` | local span 坐标 snap 后仍有效 |
| T11 | 空 trusted | trustedCount=0 → local spans=[]，不 crash |
| T12 | dialog_200 batch | contract 200/200；记录 fw_triggered / no_spans |

**探针复用：** `tests/experiments/_local-raw-ime-diff-audit-probe.js` 作批测前 sanity check。

---

## 七、指标与验收补充（P1）

### 7.1 方案 §十一指标分层

| 指标 | 责任阶段 | 目标 |
|------|----------|------|
| `localRawImeDiffSpanCount` | Proposal | d001 ≥ 2 |
| `diffSpanCount`（替换后） | Proposal | d001 ≥ 2 |
| `normalizedSpanCount` | Normalizer 输出 | d001 ≥ 2 |
| `selectedSpanCount` | SpanSelector | d001 > 0（批测） |
| `fw_triggered` | 全链路 | 106 → **121~131**（预估，非硬保证） |
| `apply > 0` | KenLM | **不要求**本阶段 |

### 7.2 contract 200/200 定义

批测 `contract_failures: []` 来自既有 batch runner 契约（字段/schema/链路完整性），**非**「必须 fw_triggered 提升」。方案应写明：**contract 与 fw 指标分开验收**。

### 7.3 下一阶段衔接（方案 §十一末尾）

「PrimaryDomain General → AllDomainWeakRecall」**不在本 Proposal PR 范围**；本 PR 合并后单独开 Phase，避免 scope 混入。

---

## 八、风险与边界补充（P2）

| 风险 | 方案是否覆盖 | 补充 |
|------|--------------|------|
| d002 Normalizer 合并退化 | ✅ §七 | 必须以 **替换** 非追加；单测硬断言 |
| span 爆炸（169/200 有 local） | 部分 | SpanSelector `maxApprovedSpans=4` 裁剪；批测看 capped 率 |
| IME 错词 FP | 未写 | trusted compat≥0.5；后续可加 supportCount≥2 |
| resegment 切分 | 未写 | V1.0 接受合并 span；V1.1 wordForInterval |
| KenLM 压力 | 未写 | fw 上升可接受；Apply 仍由 KenLM 门控 |
| domain 未启用 | 未写 | 批测 payload `lexicon_v2_intent_enabled: false` 不变 |
| Tone 统计 | 未写 | Proposal 在 Tone 之前，路径不变 |

---

## 九、文档与索引补充（P2）

开发完成后建议同步（非本 PR 阻塞）：

| 文档 | 内容 |
|------|------|
| `docs/pinyin-v2/ARCHITECTURE.md` | Proposal 两路 diff：整句 / local fallback |
| `docs/tone/Lexicon_Tone_2026_06_07_文档索引.md` | 链接开发报告 |
| 开发方案 V1.0 | 吸收本清单 §一–§七 后升 **V1.1** |

---

## 十、开发前 Checklist（可直接打勾）

### 方案文档

- [ ] §三 写入 proposal 内精确插入点与 4D 并存说明
- [ ] §七 激活条件改为 `alignFailedCount === min(topK, candidates.length)`
- [ ] §十 「蓝美马分」改为区域覆盖验收口径
- [ ] §十 拆分 Proposal 指标 vs selectedSpanCount 指标
- [ ] §二 补充允许修改的 `*.test.ts` / `index.ts`
- [ ] §五 简化 `LocalRawImeDiffInput`（alignmentScores 入参）
- [ ] §八 明确 ExampleSpan 类型与 0/1 约定
- [ ] §十一 分离 contract vs fw 验收；下阶段 Domain 单独立项

### 实现

- [ ] `buildLocalRawImeDiffSpans` 使用 `normalizeTraditionalChinese`
- [ ] 过滤常量引用 `DEFAULT_PINYIN_IME_V2`
- [ ] interval + rawSlice 双音节 gate
- [ ] `[start,end)` dedupe + distinct rank supportCount
- [ ] 替换 rawDiffSpans（非 append）
- [ ] 更新 `diagnostics.diffSpanCount` / local* 字段
- [ ] `applyBoundaryDiscovery` 仍作用于替换后 diffSpans

### 测试

- [ ] T1–T12 全部存在
- [ ] freeze-contract 补充 local diff 边界
- [ ] dialog_200 batch + 探针 JSON 归档

### 禁止项复核

- [ ] Normalizer / SpanSelector / Recall / Tone / KenLM / Apply **git diff 为空**
- [ ] decoder / TopK / primaryDomain **git diff 为空**
- [ ] imeWord **未进入** FwSpan / replacement pipeline

---

## 十一、与代码文件对照索引

| 关注点 | 文件 | 行/符号 |
|--------|------|---------|
| Proposal 主流程 | `run-pinyin-ime-v2-span-proposal.ts` | L75–115 |
| alignFailed 统计 | `pinyin-ime-v2-diff-spans.ts` | L104–131 |
| trustedTopK | `pinyin-ime-v2-boundary-compatible-topk-diff.ts` | L37–55 |
| syllable→raw | 同上 | L90–119 |
| Normalizer 合并 | `pinyin-ime-v2-span-normalizer.ts` | L34–75, L115–159 |
| SpanSelector reason | `pinyin-ime-v2-span-selector.ts` | L36–44 |
| FwSpan 映射 | `map-selected-span-to-fw.ts` | L7–23 |
| Active diagnostics | `fw-detector/types.ts` | L258–286 |
| 默认 gate | `pinyin-ime-v2-config.ts` | L6–17 |
| Freeze 契约 | `pinyin-ime-v2-freeze-contract.test.ts` | 全文 |

---

## 十二、结论

开发方案 V1.0 **方向正确**，与审计及代码兼容；但在 **pipeline 插入点、激活条件精度、蓝美马分验收口径、Normalizer 三路并存、allowed files、diagnostics 分层、selectedSpanCount 依赖** 等处需按本清单补写后方可开工，以避免：

1. d002 类 **追加模式回归**  
2. d001 **批测 selectedSpanCount=0** 误判为 Proposal 失败  
3. 开发范围与 **Active diagnostics / resolve 透传** 预期不一致  
4. 过滤常量与 Normalizer **漂移**

建议：将本清单合并进开发方案 **V1.1**，再进入编码。
