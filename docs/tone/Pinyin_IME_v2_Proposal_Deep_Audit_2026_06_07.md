# Pinyin IME V2 Proposal 深度审计（只读）

**日期：** 2026-06-07  
**约束：** 只读；未修改 Proposal / Normalizer / SpanSelector / Recall / Tone / KenLM / Apply 任何产品代码。  
**探针：** `electron_node/electron-node/tests/experiments/_proposal-deep-audit-probe.js`  
**离线输出：** `electron_node/electron-node/tests/experiments/_proposal-deep-audit-output.json`  
**批测基线：** `lexicon-tone-dialog200-spanselector-batch-result.json`（fw_triggered=106/200）

---

## 一、Proposal 全部实现定位

### 1.1 函数表

| 文件 | 函数 | 输入 | 输出 |
|------|------|------|------|
| `run-pinyin-ime-v2-span-proposal.ts` | `runPinyinImeV2SpanProposal` | `{ rawAsrText, dict, config:{ topK } }` | `PinyinImeV2SpanProposal`（candidates、diffSpans、instabilityRegions、boundaryCompatibleTopKSpans、diagnostics） |
| `pinyin-ime-v2-diff-spans.ts` | `collectDiffSpansFromCandidates` | `rawAsrText`, `candidates[]`, `topK` | `{ diffSpans: PinyinImeV2DiffSpan[], alignFailedCount }` |
| `pinyin-ime-v2-diff-spans.ts` | `diffReplacementSpans` | `raw: string`, `candidate: string` | `{ spans: RawDiffSpan[], alignFailed: boolean }` |
| `pinyin-ime-v2-instability.ts` | `buildInstabilityRegions` | `diffSpans[]` | 合并重叠区间 → `PinyinImeV2InstabilityRegion[]`（supportCount = 不同 rank 数） |
| `pinyin-ime-v2-instability.ts` | `aggregateDiffSpanSupport` | `diffSpans[]` | 回填每条 diff span 的 `supportCount`（来自 merged region） |
| `pinyin-ime-v2-boundary.ts` | `applyBoundaryDiscovery` | `rawAsrText`, `diffSpans`, `instabilityRegions` | 音节边界 snap 后的 diffSpans + instabilityRegions + `boundaryAdjustedCount` |
| `pinyin-ime-v2-boundary-compatible-topk-diff.ts` | `buildBoundaryCompatibleTopKDiff` | `{ rawAsrText, candidates, alignmentScores, totalSyllables }` | `{ spans, trustedTopKCount, tokenSourceConflictDiagnosticCount }` |
| `pinyin-ime-v2-boundary-compatible-topk-diff.ts` | `syllableRangeToRawCharRange` | `charRanges[]`, `syllableStart`, `syllableEnd` | `{ start, end } \| null`（raw 字符坐标） |
| `pinyin-ime-v2-boundary-compatible-topk-diff.ts` | `selectTrustedTopKCandidates` | `candidates[]`, `alignmentScores[]`, `minCompatibility=0.5` | `{ trusted[], trustedCount }` |

**辅助（Proposal 内调用，非用户清单但构成链路）：**

| 文件 | 函数 | 作用 |
|------|------|------|
| `normalize-for-ime-alignment.ts` | `normalizeForImeAlignment` | OpenCC / 归一化（diagnostics） |
| `extract-raw-coarse-boundaries.ts` | `extractRawCoarseBoundaries` | 标点/空格粗边界 |
| `pinyin-ime-v2-pinyin-stream.ts` | `textToPinyinStream` | raw → 音节流 |
| `pinyin-ime-v2-decoder.ts` | `decodeRawTextTopK` | beam decode → TopK candidates + tokens |
| `pinyin-ime-v2-boundary-align.ts` | `computeBoundaryAlignmentDiagnostics` | raw 粗边界 vs IME token 边界 → `compatibilityScore` |

### 1.2 实际调用链

```text
rawText
  ↓ normalizeForImeAlignment + extractRawCoarseBoundaries + textToPinyinStream
decode TopK  (decodeRawTextTopK)
  ↓ computeBoundaryAlignmentDiagnostics → alignmentScores
diffSpans    (collectDiffSpansFromCandidates → diffReplacementSpans × TopK)
  ↓ aggregateDiffSpanSupport
instabilityRegions (buildInstabilityRegions)
  ↓ applyBoundaryDiscovery (snapSpanToSyllableBoundaries)
boundaryCompatibleTopKSpans (buildBoundaryCompatibleTopKDiff)
  ↓ selectTrustedTopKCandidates + syllableRangeToRawCharRange
Proposal 输出 → normalizePinyinImeV2Spans → selectPinyinImeV2Spans（本审计不展开）
```

---

## 二、diffSpans 生成机制审计

### 2.1 `collectDiffSpansFromCandidates()` 如何工作

1. 取 `candidates.slice(0, topK)`（默认 Top5）。
2. 对每条 candidate 调用 `diffReplacementSpans(rawAsrText, candidate.text)`。
3. 若 `alignFailed === true`：`alignFailedCount++`，**该 candidate 不产生任何 span**。
4. 若成功：把每条 substitution span 包装为 `PinyinImeV2DiffSpan`（含 `candidateRank`、`supportCount=1`）。
5. 返回 TopK union（未做跨 candidate 去重；去重/support 聚合在 `aggregateDiffSpanSupport`）。

### 2.2 字符对齐算法

`diffReplacementSpans` 使用 **标准 Levenshtein DP**（插入/删除/替换代价均为 1）：

- 建 `dp[m+1][n+1]`，`m=|raw|`，`n=|candidate|`。
- 回溯从 `(m,n)` 到 `(0,0)`，优先走 `eq`，否则按 `sub` / `del` / `ins` 最小代价分支。
- **仅当回溯链全部为 `eq` 或连续 `sub` 时**才输出 span；遇到任意 `ins` 或 `del` → 整 candidate **`alignFailed`**，span 清空。

即：**不是 general edit script diff，而是 substitution-only 对齐**（注释写明「Aligns with Span Coverage audit」）。

### 2.3 `alignSuccess` 条件

同时满足：

1. `raw !== candidate` 且两者非空；
2. `dp[m][n] ≤ max(m,n) × 0.6`；
3. 回溯路径中 **无 insert/delete**，只有 eq 与 sub；
4. 连续 sub 合并为 `{ start, end, source, target }` span。

### 2.4 `alignFailed` 条件

任一触发即失败：

| 原因 | 代码位置 |
|------|----------|
| raw 或 candidate 为空 | L23–24 |
| `dp[m][n] > max(m,n) × 0.6` | L45–46 |
| 回溯中出现 `ins` 或 `del` | L94–95 |

### 2.5 为何 `editDistance > max(m,n)*0.6` 直接丢弃？

**设计意图（代码注释 + V1 审计对齐）：**

- 注释：`Aligns with Span Coverage audit (substitution-only spans)`。
- V1 Span Coverage 审计（`docs/pinyin-v1/archive/Pinyin_IME_V1_Span_Coverage_Audit_2026_06_03.md`）定义的是 **raw↔candidate 字符 diff union**，但未写 0.6 数值。
- **0.6 阈值首次出现在 V2 实现** `pinyin-ime-v2-diff-spans.ts` L45，属于 **工程门控**：当句级编辑距离超过长度 60% 时，认为整句对齐不可信，避免 DP 在严重长度/结构漂移下产出伪 substitution span。

**是否有测试证明 0.6 必要？**

- **无。** 现有单测仅覆盖：
  - 完全相同 → 空 span；
  - 「你号→你好」单字替换 → 1 span。
- **无** 针对 0.6 阈值、长句 ins/del 拒绝、或 dialog 级回归的单测。

---

## 三、d001 TopK 重放

**批测 raw（d001）：**  
`你好,我想点一杯热拿铁钟贝少糖 深便温 以下今天有蓝美马分吗?`  
（`|raw|=31`，threshold = `max(31,31)×0.6 = 18.6`）

### 3.1 完整 TopK

| rank | text | editDistance | threshold | alignSuccess | alignFailedReason |
|------|------|--------------|-----------|--------------|-------------------|
| 1 | 你好我向点以被热拿铁中杯勺趟身边文艺下今天游览每马芬吗 | 19 | 18.6 | **false** | `editDistance_gt_0.6_maxLen` |
| 2 | 你好我向点以被热拿铁中杯少趟身边文艺下今天游览每马芬吗 | 18 | 18.6 | **false** | `backtrace_has_ins_or_del` |
| 3 | 你好我想点以被热拿铁中杯勺趟身边文艺下今天游览每马芬吗 | 18 | 18.6 | **false** | `backtrace_has_ins_or_del` |
| 4 | 你好我想点以被热拿铁中杯少趟身边文艺下今天游览每马芬吗 | 17 | 18.6 | **false** | `backtrace_has_ins_or_del` |
| 5 | 你好我向点以被热拿铁中杯绍趟身边文艺下今天游览每马芬吗 | 19 | 18.6 | **false** | `editDistance_gt_0.6_maxLen` |

### 3.2 为何 `alignFailedCount = 5`

1. **句级结构漂移大**：IME 解码句与 raw 在标点、空格、多音节词切分上不一致（如 raw「点一杯」vs IME「向点以被」），Levenshtein 最优路径必然含大量 **ins/del**。
2. rank1/5 额外触发 **0.6 硬门控**（ED=19 > 18.6）。
3. rank2–4 虽 ED≤18.6，但回溯仍含 ins/del → **substitution-only 规则整句否决**。
4. IME 在目标区已给出正确词形（「中杯」「每马芬」≈蓝莓马芬），但 diff 路径比较的是 **整句字符串**，无法落到「钟贝/蓝美马分」局部 span。

**关键事实：** TopK 里 **有**「中杯」token，但 **diffSpans 路径完全看不到**，因为 align 在句级失败。

---

## 四、alignFailed 对 dialog_200 的真实影响

离线重放 200 案（`runPinyinImeV2SpanProposal`，topK=5）：

| 指标 | 数量 |
|------|------|
| total | **200** |
| alignFailedCount>0 | **142** |
| diffSpanCount=0 | **170** |
| diffSpanCount=0 且 boundaryPositive>0 | **141** |
| 全部 TopK alignFailed 且 diffSpanCount=0 | **141** |
| 上述 + selectedSpanCount=0（整条 pipeline 无 span） | **59** |
| 上述 + fw_triggered=false | **59** |

**解读：**

- **141/200** 的 diff 路径被 alignFailed **完全关闭**（TopK 无一通过句级 substitution 对齐）。
- **141** 中有 **141** 靠 4D boundary 补位（`diffZeroBoundaryPositive`），但补位常落在 **ASR 正确字上的 TopK 分歧**，非错字区。
- **59** 案：alignFailed 全灭 diff + boundary/Normalizer/Selector 也未留下可用 span → **fw 未触发**（占 200 的 **29.5%**）。
- 另有 **82** 案：alignFailed 全灭 diff，但 4D 仍产出 span 并触发 fw（如 d003）。

### Top20 受影响案例（alignFailed=5, diff=0, selected=0, fw=false）

| id | scenario | boundaryTopK | raw 摘要 |
|----|----------|--------------|----------|
| d001 | cafe | 2 | 钟贝…蓝美马分 |
| d009 | taxi | 2 | 望金斯赫布…赌不赌 |
| d010 | hospital | 2 | 要並做個歇常規 |
| d012 | hospital | 2 | 请家休息 |
| d016 | friend | 1 | 周末要上班了 |
| d021 | tech_deploy | 2 | 候选生成炼鹿 |
| d026 | interview | 2 | 夸团队写作 |
| d029 | classroom | 2 | 覺嗎 |
| d034 | bank | 2 | 開通短信提醒 |
| d037 | restaurant | 2 | 烤创…像蔡薇拉 |
| d038 | restaurant | 2 | 等多久 |
| d041 | gym | 2 | 更意識規則 |
| d046 | cafe | 3 | 中貝…知识蛋糕 |
| d053 | taxi | 2 | 深圳南善…隔电话会 |
| d054 | taxi | 2 | 杭州系系部 |
| d056 | hospital | 2 | 低哨 |
| d061 | friend | 1 | 江邊騎行 |
| d065 | tech_deploy | 2 | 後選生 |
| d067 | customer_service | 1 | 重复「我定」 |
| d070 | interview | 2 | 视频项目 |

---

## 五、boundaryCompatibleTopKDiff 审计

### 5.1 `buildBoundaryCompatibleTopKDiff()` 机制

1. **`selectTrustedTopKCandidates`**：有 token path 且 `compatibilityScore ≥ 0.5`（`BOUNDARY_COMPATIBILITY_MATCH_THRESHOLD`）的 candidates；按 compat 降序、rank 升序排序。**不删除** pipeline 中的 candidates，仅用于 4D diff。
2. 若 `trustedCount < 2` → 空 spans。
3. **`collectTokenSyllableIntervals`**：trusted TopK 所有 token 的 `[syllableStart, syllableEnd)` 并集（去重）。
4. 对每个 interval，在 trusted 内收集 **`wordForInterval`**（重叠 token.word 拼接 + OpenCC 归一化）。
5. 若 **≥2 个不同 word 变体** → 产出 span。
6. **`syllableRangeToRawCharRange`**：按 `buildCharSyllableRanges(raw)` 的 CJK run 线性插值，把音节区间映射回 raw 字符 `[start, end)`。
7. `rawSpan = rawAsrText.slice(start, end)`；`confidence = min(1, variants.length / trustedCount)`。

### 5.2 trustedTopK 如何选？

- 条件：`tokens.length > 0` 且 boundary alignment `compatibilityScore ≥ 0.5`。
- d001：**5/5** 均满足 → `trustedTopKCount=5`。
- 排序：compat 高者优先；同 compat 则 rank 小者优先。

### 5.3 boundaryCompatibilityScore 是什么？

来自 `computeBoundaryAlignmentDiagnostics`（`pinyin-ime-v2-boundary-align.ts`）：

- 提取 raw 粗边界（标点/空格）的音节切分点 vs IME token 切分点；
- 统计 raw 边界点在 IME 切分点 ±1 音节内匹配数；
- `compatibilityScore = matchedBoundaryCount / rawBoundaryCount`（无 raw 边界时默认为 1）。

**注意：** 这是 **边界结构一致性**，不是「IME 文本是否纠正 ASR 错字」。

### 5.4 为何 trustedTopKCount=5 却没有「钟贝/蓝美马分」？

4D **不比较 raw 与 IME 的词形差异**，只比较 **trusted TopK 彼此之间** 在同一 syllable interval 上的 **token 词形是否分歧**。

d001 在目标 interval：

| 错字区 | syllable range | trusted TopK 词形 |
|--------|----------------|-------------------|
| 钟贝 (11–13) | 10–12 | **全部为「中杯」** → variants=1 → **skip** |
| 蓝美马分 (25–29) | 22–26 | **全部为「每马芬」等一致写法** → variants=1 → **skip** |

仅有 2 个 interval 出现 TopK 内分歧：

| syllable | variants | 映射 raw |
|----------|----------|----------|
| 3–4 | 向 / 想 | 「想」(4–5) — raw 本身正确 |
| 12–13 | 勺 / 少 / 绍 | 「少」(13–14) — raw 本身正确 |

### 5.5 syllable → raw 映射

`syllableRangeToRawCharRange` 在含 interval 的 CJK run 内做 **均匀线性分配**：

```text
charsPerSyllable = (charEnd - charStart) / (syllableEnd - syllableStart)
start = charStart + floor(relSylStart * charsPerSyllable)
end   = charStart + ceil(relSylEnd * charsPerSyllable)
```

d001 的 CJK runs（探针）：

| char range | syllable range |
|------------|----------------|
| 0–2 | 0–2 |
| 3–15 | 2–14 |
| 16–19 | 14–17 |
| 20–30 | 17–27 |

---

## 六、d001 Boundary Trace

### 6.1 目标错字区音节

| 区域 | raw 字 | charStart–charEnd | syllableStart–syllableEnd | 音节 |
|------|--------|-------------------|---------------------------|------|
| 钟贝 | 钟贝 | 11–13 | 10–12 | zhong, bei |
| 蓝美马分 | 蓝美马分 | 25–29 | 22–26 | lan, mei, ma, fen |

映射函数验证：`mappedRaw` = `{11,13}` 与 `{25,29}` ✅（音节→raw 几何本身正确）。

### 6.2 实际产出的 boundary span

| # | rawSpan | syllableStart | syllableEnd | rawStart | rawEnd | variants |
|---|---------|---------------|-------------|----------|--------|----------|
| 1 | 想 | 3 | 4 | 4 | 5 | 向, 想 |
| 2 | 少 | 12 | 13 | 13 | 14 | 勺, 少, 绍 |

### 6.3 为何是「想/少」而非「钟贝/蓝美马分」

1. **4D 信号源是 TopK 内分歧**，不是 raw vs IME。
2. 「想/少」处 ASR **已经正确**，但 IME Top5 在 token 切分/同音字上仍有 **向↔想、勺↔少↔绍** 抖动 → 满足 `variantEntries.length ≥ 2`。
3. 「钟贝/蓝美马分」处 ASR **错误**，但 IME **一致** 解为「中杯」「每马芬」→ TopK 内 **无变体** → 4D **静默**。
4. 随后 Normalizer 对 #1/#2 打 `single_char`（`minSpanChars=2`）删除 → `selectedSpanCount=0`。

---

## 七、4D 是否存在设计偏差

**代码事实结论：当前 4D 同时在找 B 与 C，而不是 A。**

| 选项 | 定义 | 是否符合代码 |
|------|------|--------------|
| **A** | ASR 错字区域（raw vs 正确 IME 差异） | **否** — 无 raw slice vs IME word 比较 |
| **B** | IME TopK 不稳定区域 | **部分** — 要求 ≥2 variants，即 TopK 分歧 |
| **C** | token path 边界变化区域 | **是** — interval 来自 token syllable 切分 |

`buildBoundaryCompatibleTopKDiff` 注释原文：*Fine spans from syllable-interval word differences among trusted TopK token paths.*

因此 d001 现象 **不是实现 bug**，而是 **规格即：TopK 互分歧区**，天然偏向 ASR 已对齐音节的「解码抖动」，而非 ASR 同音误识区。

---

## 八、Proposal 是否偏离原始设计

**原始设计意图：**  
`IME decode → 发现可疑区域 → Span`，使 **ASR 同音误识别** 能产出 span，供 Recall/KenLM 修正。

### 典型案例

| case | 目标错字 | Proposal 是否发现错字区 | 断点 |
|------|----------|-------------------------|------|
| **d001** 钟贝→中杯 | 钟贝 (11–13) | **否** | diff：5/5 alignFailed；4D：interval 10–12 全「中杯」无分歧 |
| **d001** 蓝美马分→蓝莓马芬 | 蓝美马分 (25–29) | **否** | 同上；4D interval 22–26 无 variant |
| **d002** 美食→美式 | 美食 (7–9) | **部分** | diff 产出「食」(8–9) 单字 span，非完整「美食」；boundary 未命中 |
| **d002** 大悲→大杯 | 大悲 (12–14) | **部分** | diff 合并为「悲就行谢谢」(12–17) 大 span；boundary 命中「做/就行」非「大悲」 |
| **d003** 少病→少冰 | 少病 (11–13) | **boundary 是** | diff=0（alignFailed）；4D 命中「少病」但 variants 是烧饼/哨兵（IME 同音词），非「少冰」 |
| **d047** 大背→大杯 | 大背 | **否（boundary）** | diff 有大 span「背就行谢谢」；4D 仅「红/茶」 |

**结论：** 当前 Proposal **未稳定满足**「ASR 同音误识 → span 落在错字区」目标。  
- **diff 路径**：句级 substitution-only + 0.6 门控，对 dialog 长句 **大面积失效**（141/200）。  
- **4D 路径**：补偿 diff 空白，但语义是 **TopK 互分歧**，常落在 **正确字** 或 **无关抖动**。

---

## 九、最小修复方向（仅分析，禁止开发）

### 方案 A：alignFailed 不丢弃 → 局部 diff

| 维度 | 评估 |
|------|------|
| **命中率** | 高 — d001 rank2–4 的 ED≤18.6，若按 **token/syllable 区间** 做 raw↔IME 局部 substitution，可命中「钟贝↔中杯」「蓝美马分↔每马芬」 |
| **风险** | 中 — 句级 ins/del 多，盲目放宽句级 DP 会引入 FP；须限定在 **共享音节对齐区间** |
| **性能** | 低增 — 每 candidate 多 O(音节数) 次短串 diff |
| **冻结设计** | **需 Amendment** — 当前冻结注释为 substitution-only **整句**；局部 diff 属 Proposal 语义扩展，但不触碰 Recall/Tone/KenLM |

### 方案 B：4D 优先锚定 raw vs trustedTopK 差异区

| 维度 | 评估 |
|------|------|
| **命中率** | **最高（针对同音误识）** — 直接在 syllable interval 比较 `rawSlice` vs `wordForInterval(trustedTop1)`，不等即 proposal |
| **风险** | 中 — raw 切分与 token 边界不对齐时可能扩 span；需与 Normalizer minSpanChars 协同 |
| **性能** | 低 — 复用现有 interval 枚举 |
| **冻结设计** | **需 Amendment** — 改变 4D「仅 TopK 互分歧」定义；与 V2.0 §十一「sole span source」文档需同步 |

### 方案 C：trustedTopK token path 直接生成 span proposal

| 维度 | 评估 |
|------|------|
| **命中率** | 高 — 每个 token 与 raw 同 syllable 切片比较，天然 2+ 字 span（如「中杯」） |
| **风险** | **高 FP** — 标点/空格/繁简/整句 resegment 都会产生「伪差异」；需强 gate（仅 CJK 同音、min length、neighbor） |
| **性能** | 中 — token 数 × TopK |
| **冻结设计** | **大幅偏离** 当前 4D 定义，实质新建 Proposal 源 |

### 推荐优先级（理论）

1. **B + 局部 A**（音节对齐下的 raw↔IME word diff）— 最小且对准「同音误识」  
2. 单独 A 不够 — 4D 仍会在 d001 类 case 上产「想/少」噪声  
3. 单独 C 噪声最大，需最多 downstream 约束

---

## 十、最终结论

| 问题 | 结论 |
|------|------|
| **d001 为何没发现钟贝/蓝美马分？** | diff：5/5 句级 alignFailed；4D：目标 interval 上 TopK 词形一致（「中杯」「每马芬」），**无 TopK 内 variant** → 两路均静默 |
| **alignFailed=5 根因？** | 长句 ASR vs IME 句级结构漂移 → Levenshtein 路径含 ins/del；rank1/5 另超 0.6 阈值 |
| **diffSpan 机制最大问题？** | **整句 substitution-only 对齐** 与 **拼音 IME 按音节 resegment** 根本不匹配；141/200 diff 路径被关 |
| **4D 为何定位到想/少？** | 4D 找 **TopK 互分歧**；「想/少」处 ASR 正确但 decode 抖动；钟贝/蓝美马分处 TopK **一致** 故跳过 |
| **Proposal 是否偏离原始目标？** | **是（行为层面）** — 规格实现的是「TopK 不稳定/边界分歧」，非「ASR 错字 vs IME 纠正」 |
| **dialog_200 受影响规模？** | 141 案 diff 全灭；59 案完全无 span 且无 fw；142 案至少 1 次 alignFailed |
| **最大收益改动点？** | **Proposal 层：音节对齐的 raw↔IME word diff**（方案 B，可叠加局部 A） |
| **最小修复方向？** | 在现有 token syllable interval 上增加 **`rawSlice !== normalize(imeWord)`** 提案；保留现有 4D 作为 secondary 信号；不放宽句级 ins/del |
| **预计 fw_triggered 提升？** | 当前 106/200（53%）。59 案 completely blocked — 若 Proposal 修复覆盖其中 **40–70%**（≈24–41 案）且 Normalizer 放行 2+ 字 span → **+12–20 fw_triggered（→118–126，约 +11–19% 相对）**；含 d001 类 cafe 同音词则偏上限。apply>0 仍取决于 Recall/KenLM，本审计不估 |

---

## 附录：探针复现

```powershell
cd electron_node/electron-node
node tests/experiments/_proposal-deep-audit-probe.js
```

输出：`tests/experiments/_proposal-deep-audit-output.json`
