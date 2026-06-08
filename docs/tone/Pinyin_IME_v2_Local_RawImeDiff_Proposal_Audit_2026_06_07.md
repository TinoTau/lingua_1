# Pinyin IME v2 Proposal Local Raw-vs-IME Diff 开发前审计（只读）

**日期：** 2026-06-07  
**约束：** 只读；未修改 Proposal / Normalizer / SpanSelector / Recall / Tone / KenLM / Apply / IME TopK / domain recall。  
**探针：** `electron_node/electron-node/tests/experiments/_local-raw-ime-diff-audit-probe.js`  
**输出 JSON：** `electron_node/electron-node/tests/experiments/_local-raw-ime-diff-audit-output.json`  
**批测基线：** `lexicon-tone-dialog200-spanselector-batch-result.json`（fw_triggered=106/200）

---

## 执行摘要

| 问题 | 结论 |
|------|------|
| 能否在 Proposal 层实现 local raw-vs-IME diff？ | **能** — 现有 token syllable 数据足够 |
| 最适合扩展哪个 source？ | **合并进 `diffSpans`**（当整句 alignFailed 时作为 fallback） |
| 是否需要第四类 pipeline 类型？ | **不需要进入 Normalizer/Selector**；可新增 diagnostics 数组，运行时 concat 到 `diffSpans` |
| d001 能否捕捉？ | **能** — 「钟贝」精确；「蓝美马分」经 Normalizer 合并为「有蓝美马分」（5 音节，可过 gate） |
| dialog_200 覆盖？ | alignFailed 门控下 **139/200** 案产生 local span；**101** 案 norm 增量；**56** 案 fw=false 且 gated 后有 span |
| 最大风险？ | 无门控时 Normalizer 相邻合并导致 **d002 退化**（2 span → 1 span） |
| 最小方案？ | 新模块 + `alignFailed` 全灭时 **替换** diff 路径 + dedupe by raw interval |

---

## 一、背景与目标

当前 d001 失败根因（见 [Proposal 深度审计](./Pinyin_IME_v2_Proposal_Deep_Audit_2026_06_07.md)）：

- 整句 substitution-only Levenshtein → `alignFailedCount=5` → `diffSpanCount=0`
- 4D 找 TopK 互分歧 → 落在 ASR 正确字「想/少」
- IME TopK 已含「中杯」等 token，但整句 diff 无法暴露

**本轮目标：** 在 Proposal 层基于 trusted TopK token syllable interval，比较 `rawSlice` vs `imeWord`，产出 **raw 坐标 span**（不输出 replacement），进入既有 Normalizer → SpanSelector → Recall → Tone → KenLM → Apply 链路。

---

## 二、完整调用链（现有 + 目标插入点）

### 2.1 现有链路

```text
rawText
  ↓ normalizeForImeAlignment (diagnostics only)
  ↓ textToPinyinStream(rawText) → syllables[]
  ↓ decodeRawTextTopK(syllables, dict, topK) → candidates[].tokens[]
  ↓ computeBoundaryAlignmentDiagnostics → alignmentScores[]
  ↓ collectDiffSpansFromCandidates (整句 diffReplacementSpans)
  ↓ aggregateDiffSpanSupport → buildInstabilityRegions → applyBoundaryDiscovery
  ↓ buildBoundaryCompatibleTopKDiff → selectTrustedTopKCandidates
  ↓ boundaryCompatibleTopKSpans
Proposal 输出
  ↓ resolvePinyinImeV2Spans
  ↓ normalizePinyinImeV2Spans(diff + instability + boundaryTopK)
  ↓ selectPinyinImeV2Spans
  ↓ mapSelectedSpansToFwSpans → Recall → Tone → KenLM → Apply
```

### 2.2 目标插入点（建议）

```text
rawText
  → textToPinyinStream
  → decodeRawTextTopK
  → candidate.tokens[]
  → selectTrustedTopKCandidates (复用 4D)
  → for each token syllable interval:
        rawRange = syllableRangeToRawCharRange(charRanges, sylStart, sylEnd)
        rawSlice = rawText.slice(rawRange)
        imeWord = token.word
        if normalize(rawSlice) ≠ normalize(imeWord) → local span
  → [门控] alignFailedCount === candidateCount ?
        diffSpans = localRawImeDiffSpans   // 替换整句 diff
     : diffSpans = existing diffSpans       // 保持 d002 等
  → Normalizer → SpanSelector → …
```

**关键：** 插入在 `runPinyinImeV2SpanProposal` 内、`aggregateDiffSpanSupport` 之前或之后；**不修改** Normalizer / SpanSelector 签名。

---

## 三、现有 token / syllable 数据是否足够

### 3.1 candidate token 字段（已具备）

```typescript
// pinyin-ime-v2-types.ts L11-L16
export type PinyinImeV2Token = {
  word: string;
  syllableStart: number;
  syllableEnd: number;
  source: PinyinImeV2DictEntrySource;  // 必填，非 optional
};
```

decoder 在 `extendState` 时为每条 beam path 累积 tokens（`pinyin-ime-v2-decoder.ts` L172 `tokens: state.tokens`）。

### 3.2 数据复用表

| 数据 | 是否已有 | 文件 | 可否复用 |
|------|----------|------|----------|
| raw syllable stream | ✅ | `pinyin-ime-v2-pinyin-stream.ts` → `textToPinyinStream` | 直接复用 |
| raw char → syllable range | ✅ | `buildCharSyllableRanges` | 直接复用 |
| syllable → raw char 映射 | ✅ | `syllableRangeToRawCharRange` | 直接复用 |
| candidate token syllableStart/End | ✅ | `PinyinImeV2Token` | 直接复用 |
| token.word | ✅ | decoder token path | 直接复用 |
| trustedTopK candidates | ✅ | `selectTrustedTopKCandidates` | 直接复用（compat ≥ 0.5） |
| OpenCC / normalize | ✅ | `normalizeTraditionalChinese` | 比较用；**不写入 raw** |
| wordForInterval（多 token 拼接） | ✅ | `boundary-compatible-topk-diff.ts` 内部 | 建议用于 resegment 场景 |

**结论：** 无需新数据源；无需改 decoder / IME TopK。

---

## 四、局部 diff 生成逻辑可行性

### 4.1 目标伪代码评估

用户提出的 per-token 逻辑 **技术上可行**，探针已在 dist 上验证通过。

**必须补充的工程约束（探针发现）：**

1. **alignFailed 门控（强烈建议）** — 见 §九、d002 回归。
2. **按 raw interval dedupe** — 同一 `[start,end)` 多 rank 贡献 → `supportCount = distinct ranks`。
3. **可选：interval 级 wordForInterval** — 当 IME 将一词拆为多 token 时，per-token 会切分 rawSlice（d001「蓝美马分」→「有蓝」+「马分」）；Normalizer 相邻合并可恢复为「有蓝美马分」，但 interval 级更精确。

### 4.2 复用性判断

| 组件 | 复用 |
|------|------|
| `syllableRangeToRawCharRange` | ✅ 完全复用 |
| `selectTrustedTopKCandidates` | ✅ 完全复用 |
| `normalizeTraditionalChinese` | ✅ 比较复用 |
| `buildCharSyllableRanges` | ✅ 完全复用 |
| Normalizer char/syllable gate | ✅ 现有 `minSpanChars=2`, `maxSpanChars=6`, `minSyllables=2`, `maxSyllables=5` |

### 4.3 归入哪类 proposal？

| 方案 | 评价 |
|------|------|
| **A：扩展 boundaryCompatibleTopKSpans** | ❌ 语义错误（4D=TopK 互分歧）；SpanSelector 会标 `ime_v2_boundary_topk_diff`；与冻结注释「sole V2.0 boundary span source」冲突 |
| **B：新增 localRawImeDiffSpans 第四类** | ⚠️ 诊断清晰，但 **Normalizer/Selector 仅消费三类** — 若不改它们，必须在 Proposal 末尾 **concat 到 diffSpans** |
| **C：改造 diffSpans（alignFailed fallback）** | ✅ **最贴合冻结架构** — 语义即 raw↔IME 差异；Normalizer/Selector **零改动** |

### 4.4 明确建议

**推荐方案 C + diagnostics 旁路数组：**

- 新建 `buildLocalRawImeDiffSpans()` → 输出 `PinyinImeV2DiffSpan[]`
- 当 `alignFailedCount === candidates.length` 时，**用 local spans 替代**（非追加）整句 diff 结果
- `PinyinImeV2SpanProposal` 可增 `localRawImeDiffSpans` 字段 **仅用于 diagnostics/trace**
- 返回前 `diffSpans = localOnly ? localRawImeDiffSpans : existingDiffSpans`

**不新增第四类 pipeline 类型**（避免 Normalizer/Selector 变更）。

---

## 五、设计边界审计

| 边界 | 目标逻辑是否违反 |
|------|------------------|
| 不替换文本 | ✅ 只输出 rawSpan + raw 坐标 |
| 不输出 candidate 替换词 | ✅ imeWord 不进 `PinyinImeV2DiffSpan` / `FwSpanDiagnostics` |
| imeWord 不进 Apply | ✅ `mapSelectedSpanToFwSpan` 仅映射 rawSpan（L16 `text: span.rawSpan`） |
| 只输出 raw span 位置 | ✅ |
| Recall 仍生成候选 | ✅ |
| Tone 仍只排序 Recall | ✅ |
| KenLM/Apply 仍最终裁决 | ✅ |
| 不放宽 Normalizer / SpanSelector | ✅ 使用现有 gate |
| 不修改 IME TopK | ✅ |

**imeWord 仅允许：** Proposal diagnostics / 单测 assert / debug JSON，**禁止**进入 `NormalizedSpan`、`PinyinImeV2SelectedSpan`、`FwSpanDiagnostics.candidates`。

---

## 六、与现有 diffSpans / 4D 的关系

### 6.1 三类现有 proposal

| 类 | 语义 | 与 local diff 关系 |
|----|------|-------------------|
| `diffSpans` | raw ↔ candidate **整句** substitution | local diff 是其 **音节级 fallback** |
| `instabilityRegions` | diffSpans 合并区间 | local 成功后仍可由 diff 派生 |
| `boundaryCompatibleTopKSpans` | trusted TopK **互分歧** | **正交**；保留不变，避免「想/少」与 local 混淆 |

### 6.2 方案对比（维护性 / 冻结 / 诊断）

| 方案 | 维护性 | 冻结架构 | 诊断清晰度 |
|------|--------|----------|------------|
| A 扩展 4D | 差（语义混） | 偏离 §十一 | 差 |
| B 第四类 + concat | 中 | 需改 types，不必改 Normalizer | 优 |
| **C alignFailed fallback** | **优** | **最小 Amendment** | 中（靠 diagnostics 补） |

**4D 保留理由：** d003 等 case 在 diff=0 时仍靠 4D 触发 fw；local diff 与 4D 应 **并存**，Normalizer 继续三路合并。

---

## 七、d001 专项预期（探针实跑）

**raw：** `你好,我想点一杯热拿铁钟贝少糖 深便温 以下今天有蓝美马分吗?`  
**trustedTopKCount：** 5

### 7.1 关键 token trace（shouldCreateSpan=true）

| token (imeWord) | syllableStart | syllableEnd | rawSlice | normalizeEqual | shouldCreateSpan |
|-----------------|---------------|-------------|----------|----------------|------------------|
| 中杯 | 10 | 12 | **钟贝** | false | **true** |
| 游览 | 21 | 23 | 有蓝 | false | true |
| 马芬 | 24 | 26 | 马分 | false | true |
| 身边 | 14 | 16 | 深便 | false | true |

rank1–5 在「中杯/游览」interval 上均 shouldCreateSpan=true（supportCount=5）。

### 7.2 「蓝美马分」专项

| 方式 | 产出 |
|------|------|
| per-token | 「有蓝」(24–26) + 「马分」(27–29) 两个 span |
| Normalizer mergeAdjacent | 合并为 **「有蓝美马分」**(24–29，5 音节) ✅ 过 gate |
| interval 22–26 + wordForInterval | rawSlice=**「蓝美马分」**，imeWord=「游览每马芬」→ 可产出精确 4 字 span（**开发可选优化**） |

**d001 alignFailed 门控后 norm 输出（3 spans）：**

1. `钟贝` (11–13) ← 目标 ✅  
2. `深便` (16–18) ← 同音区额外 span（Recall/KenLM 裁决）  
3. `有蓝美马分` (24–29) ← 覆盖「蓝美马分」错字区 ✅（含前缀「有」）

**required diagnostics 示例：**

```json
{
  "rawSlice": "钟贝",
  "imeWord": "中杯",
  "syllableStart": 10,
  "syllableEnd": 12,
  "source": "local_raw_ime_diff"
}
```

---

## 八、dialog_200 影响面估算

探针：per-token local diff + 现有 Normalizer gate；**未**施加 alignFailed 门控的「无门控」统计如下。

### 8.1 无门控（不推荐部署）

| 指标 | 数量 |
|------|------|
| total | 200 |
| 可能产生 localRawImeDiffSpans | **169** |
| localPassNorm（仅 local 源） | **165** |
| fw_triggered=false 但 localPassNorm>0 | **61** |
| empty normBefore 但 localPassNorm>0 | **61** |
| normGainPositive | **104** |
| 新增 span 总数（raw local） | **591** |
| 2+ 字 span | **591** |
| 单字 span | **0** |
| Normalizer 删除（仅 local 源） | **44** |
| local 过 norm 总数 | **356** |

### 8.2 alignFailed 门控（推荐策略）

| 指标 | 数量 |
|------|------|
| 触发 local 替换 diff 的 case | **139** |
| norm 增量 case | **101** |
| fw=false 且 gated 后有 norm span | **56** |
| d001 gated norm spans | **3** |
| d002 gated norm spans | **2**（与现网 **不变** ✅） |

### 8.3 Top20 预计收益案例（gated 逻辑，localPassNorm>0）

| id | scenario | 代表 local span | imeWord | 现 fw | 预计进 Selector |
|----|----------|-----------------|---------|-------|-----------------|
| d001 | cafe | 钟贝 | 中杯 | false | **是**（+有蓝美马分、深便） |
| d009 | taxi | 望金… | IME 词 | false | 是 |
| d010 | hospital | 多 span | — | false | 是 |
| d046 | cafe | 中貝 等 | 中杯 | false | 是 |
| d181 | cafe | 钟贝类 | 中杯 | false | 是 |
| d092 | cafe | 大背类 | 大杯 | false | 是 |
| d003 | cafe | 少病 | 烧饼/哨兵 | true | 是（+1 norm，不退化） |
| d005 | meeting | 多 span | — | true | 是 |
| d011 | hospital | 多 span | — | true | 是 |

完整 Top20 见 `_local-raw-ime-diff-audit-output.json` → `top20Gain`。

### 8.4 fw_triggered 预估

- 现网：**106/200**
- gated 后 **56** 案 fw=false 但有新增 norm span；考虑 maxApprovedSpans=4、neighbor 排序、Recall 命中，保守 **+15~25 fw_triggered → 121~131**（约 +14~24% 相对）
- apply>0 仍取决于 KenLM，不在本轮承诺范围

---

## 九、风险审计

### 9.1 风险矩阵

| 风险 | 等级 | 触发原因 | 缓解边界 |
|------|------|----------|----------|
| Normalizer 合并吞 span（**d002**） | **高** | local **追加**到已有 diffSpans → mergeAdjacent 合并为「做一杯美食」 | **alignFailed 全灭才启用 local**；禁止与整句 diff 混并 |
| span 数爆炸 | 中 | 169 案 × 多 token | alignFailed 门控 + interval dedupe；maxApprovedSpans=4 裁剪 |
| IME 错词制造 FP span | 中 | trusted TopK 全错 | 要求 trusted compat≥0.5；supportCount≥2（可选） |
| resegment 切分 rawSlice | 中 | per-token vs IME 切词不一致 | interval 级 wordForInterval；或接受 Normalizer 合并 |
| KenLM 压力 | 低~中 | fw_triggered 上升 | SpanSelector cap=4；Recall topK 不变 |
| domain 未启用 | 低 | 餐饮 recall 仍 general | 不修改 domain；span 发现与 recall 解耦 |
| d002 / d003 退化 | **高→低** | 无门控时 d002 norm 2→1 | alignFailed 门控后 d002=2、d003=3 ✅ |
| ToneModule 统计 | 无 | Proposal 在 Tone 之前 | 路径不变 |
| imeWord 泄漏到 Apply | 高（若实现错误） | 类型/design 违规 | 单测 + freeze contract 断言 |

### 9.2 d002 回归证据（探针）

| 策略 | norm spans |
|------|------------|
| 现网 | `做一杯美食`, `悲就行谢谢` |
| local **追加** | **`做一杯美食` 仅 1 条** ❌ |
| local **替换**（alignFailed=0，不启用） | **不变 2 条** ✅ |

---

## 十、最小开发方案（不开发，仅建议）

### 10.1 新增/修改文件

| 文件 | 动作 |
|------|------|
| **新增** `pinyin-ime-v2-local-raw-ime-diff.ts` | `buildLocalRawImeDiffSpans()` |
| **修改** `run-pinyin-ime-v2-span-proposal.ts` | 调用 builder；alignFailed 门控合并 |
| **修改** `pinyin-ime-v2-types.ts` | diagnostics 字段；可选 `localRawImeDiffSpans` trace |
| **修改** `pinyin-ime-v2-diagnostics.ts` | 新 diagnostics 默认值 |
| **修改** `index.ts` | export（如需） |
| **新增** `pinyin-ime-v2-local-raw-ime-diff.test.ts` | 单测 |
| **修改** `run-pinyin-ime-v2-span-proposal.test.ts` | d001 集成 |
| **不修改** Normalizer / SpanSelector / resolve 签名（可选 resolve 透传 diagnostics） |

### 10.2 核心逻辑

```text
localSpans = buildLocalRawImeDiffSpans({ rawAsrText, candidates, alignmentScores })
if (alignFailedCount === candidates.length && candidates.length > 0):
    rawDiffSpans = localSpans
else:
    rawDiffSpans = collectDiffSpansFromCandidates(...).diffSpans
// 后续 instability / boundary 不变
```

### 10.3 与 Normalizer / SpanSelector

- local span 以 `PinyinImeV2DiffSpan` 进入 `diffSpans`
- Normalizer：`fromBoundaryTopKDiff=false`（与现 diff 相同）
- SpanSelector：`reason=ime_v2_diff`（现有逻辑）

### 10.4 测试范围

见 §十二。

### 10.5 验收指标

见 §十三。

---

## 十一、推荐 diagnostics

### 11.1 Proposal diagnostics 新增字段

| 字段 | 含义 |
|------|------|
| `localRawImeDiffSpanCount` | 生成的 local span 数（gate 前） |
| `localRawImeDiffCandidateCount` | 参与贡献的 trusted candidate 数 |
| `localRawImeDiffDroppedCount` | 被 char/syllable gate 拒绝数（builder 内） |
| `localRawImeDiffSingleCharCount` | 单字被过滤数 |
| `localRawImeDiffTrustedCandidateCount` | trustedTopK 数 |
| `localRawImeDiffActivated` | 是否触发 alignFailed 替换（0/1） |
| `localRawImeDiffExampleSpans` | 最多 3 条 debug（含 imeWord，**仅 diagnostics**） |

### 11.2 d001 必须输出的 example

```json
{
  "rawSlice": "钟贝",
  "imeWord": "中杯",
  "syllableStart": 10,
  "syllableEnd": 12,
  "rawStart": 11,
  "rawEnd": 13,
  "source": "local_raw_ime_diff"
}
```

---

## 十二、测试建议

| 测试 | 目的 |
|------|------|
| d001 专项 | alignFailed=5 → local 激活 → norm≥2 spans 含「钟贝」 |
| 钟贝→中杯 | rawSlice/坐标/supportCount=5 |
| 蓝美马分 | 接受「有蓝美马分」或 interval 优化后「蓝美马分」 |
| 不允许单字 span | builder 内过滤 charLen<2 |
| imeWord 不进 replacement | freeze contract + mapSelectedSpanToFwSpan 断言 |
| alignFailed 门控 | d002 norm spans 仍为 2 |
| d003 不退化 | normAfter≥normBefore |
| dialog_200 batch | fw_triggered / no_spans / contract |
| SpanSelector 不变 | 现有 134 tests PASS |
| Normalizer 不变 | 现有 tests PASS |
| Recall/Tone/KenLM/Apply 零 diff | 仅 Proposal 文件 git diff |

---

## 十三、验收标准

| 标准 | 目标 |
|------|------|
| contract PASS | 200/200 |
| d001 local 2+ 字 span | 含「钟贝」 |
| d001 selectedSpanCount | >0（依赖 neighbor，Proposal 侧 norm>0 必达） |
| d002 / d003 | 不退化 |
| fw_triggered | 106 → **121~131**（预估） |
| no_spans | 继续下降 |
| span 总数 | 不爆炸（gate + cap） |
| Apply | 不要求立即 >0 |
| ToneModule | 路径不变 |
| Normalizer / SpanSelector / Recall / KenLM / Apply | **零修改** |
| IME TopK | **零修改** |

---

## 十四、最终结论

1. **可以实现** — token syllable + `syllableRangeToRawCharRange` + `selectTrustedTopKCandidates` 数据完备。  
2. **最适合扩展 `diffSpans`**（alignFailed 全灭时 **替换**，非追加）。  
3. **不需要第四类 pipeline 类型** — 可选 diagnostics 数组；运行时并入 `diffSpans`。  
4. **d001 可捕捉** — 「钟贝」精确；「蓝美马分」经合并为「有蓝美马分」。  
5. **dialog_200** — gated 下 139 案激活，101 案 norm 增量，56 案 fw=false→有 span 潜力。  
6. **最大风险** — 无门控时 Normalizer 合并破坏 d002；**alignFailed 门控为必选项**。  
7. **最小开发** — 新 TS 模块 + proposal 集成 + diagnostics + 单测；不碰下游冻结链路。

---

## 附录：探针复现

```powershell
cd electron_node/electron-node
node tests/experiments/_local-raw-ime-diff-audit-probe.js
```

输出： `tests/experiments/_local-raw-ime-diff-audit-output.json`
