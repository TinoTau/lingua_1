# Coarse-to-Fine Full Coverage Span Assembly 开发前代码审计（只读）

**日期：** 2026-06-08  
**性质：** 只读架构可行性审计（禁止改码 / 禁止开发）  
**约束：** 不调整 KenLM / Apply / ToneModule；不推翻既有 Recall / Tone / KenLM / Apply，仅评估 span 定位与候选组装层重构可行性。

---

## 0. 审计结论（Executive Summary）

| 问题 | 结论 |
|------|------|
| FW raw 是否足够提供 coarse boundary？ | **部分足够**：文本级 CJK/标点/空白粗边界已有；ASR word/segment/timestamp 仅在 **Legacy 归档路径**，活跃 IME 链 **未接入** |
| coarse span 能否覆盖全句 CJK 音节？ | **可实现但缺 SSOT**：`extractRawCoarseBoundaries` + `buildCharSyllableRanges` 可拼出全覆盖分区，但 char↔syllable 为 **run 内线性比例近似**，非精确双向表 |
| Recall 是否支持 syllable n-gram 查询？ | **机制可复用、调用形态不支持**：`recallSpanTopKV2` 对 **给定 2–5 音节 key** 精确查桶；**无** coarse 内滑窗枚举、无 overlapping merge、无 residual |
| 是否需要 candidate graph？ | **是（新增）**：当前仅有 char offset span + 整段 recall，无 `syllableStart/End`、provenance、路径拼装 |
| oral_function / oral_particle？ | **需新 layer**：V3 四表 schema 无此 tier；仅有 fuzzy 功能音节硬编码集 |
| utterance domain vote 能否只作用本句？ | **需新模块**：现有 industry routing / weak domain 绑 **session profile**；候选 diag 的 `domains`/`domainScore` 在活跃路径 **恒空** |
| KenLM / Apply 可复用？ | **可**：若 V3 组装层最终输出与 `FwSpanDiagnostics` + `SpanReplacementPick[]` 兼容 |
| 是否建议新链路？ | **是**：建议 `spanAssemblyV3Enabled` 独立链路，**禁止**与 Proposal→SpanSelector 双路径混跑 |
| 最大风险 | n-gram SQL 查询量、候选图边爆炸、domain 误投票、KenLM delta 仍可能阻断 apply（已知 d001） |

**总体判定：** 目标机制 **架构上可行**，但属于 **FW Repair V3 新编排层**，不是对现有 Proposal/Normalizer/SpanSelector 的小补丁；P0 应新建 `CoarseSpanAssembly` 模块，复用 `recallSpanTopKV2` / `fuzzy-pinyin-key-builder` / `weak-domain-recall-resolver`，不修改 KenLM/Apply/ToneModule。

---

## 一、目标机制与现状对照

### 1.1 目标链路

```text
FW raw boundary segments
  → 全覆盖 coarse spans
  → coarse 内 syllable n-gram 滑窗
  → pinyin/tone fuzzy recall
  → 前后音节延展验证 + overlapping merge
  → 本句 utterance domain vote
  → 每 coarse span topK 路径（≤3）
  → 句级 beam n-best（≤16）
  → KenLM rerank（既有）
  → Apply（既有）
```

### 1.2 现状链路（活跃）

```text
ASR raw
  → pinyin-ime-v2 Proposal（diff / instability / boundary-topk）
  → Normalizer（2–6 字 / 2–5 音节门控，合并相邻）
  → SpanSelector（maxApprovedSpans=4，按 score 截断）
  → recallSpanTopK（整段 span 一次 recall）
  → buildSentenceCandidates（笛卡尔积）
  → rerankFwSentences（KenLM batch ≤16+1）
  → mapSentenceToApprovedReplacements → Apply
```

**差距：** 现状只对 **少量异常 span** 做 recall；**未覆盖** 未进入 Proposal 的 CJK 区间；无 coarse 内 n-gram；无候选图；无 residual；无句级 domain vote（仅 profile 级 boost）。

---

## 二、Coarse Span 边界能力审计（§二）

### 2.1 可复用字段

| 来源 | 文件 | 字段 / 能力 | 状态 |
|------|------|-------------|------|
| ASR 词级 | `task-router/types.ts` | `AsrWordInfo { word, start?, end?, probability? }` | ✅ 类型存在 |
| ASR 段级 | `task-router/types.ts` | `SegmentInfo { text, words[], avg_logprob, ... }` | ✅ 写入 `ctx.asrSegments` |
| Legacy 门控 | `legacy/archive/fw-detector-span/fw-metadata-span-gate.ts` | word prob → char `[start,end)` | ⚠️ **归档，orchestrator 未调用** |
| 文本粗边界 | `extract-raw-coarse-boundaries.ts` | `RawBoundary { start, end, syllableStart, syllableEnd, kind }` | ✅ 活跃，**仅诊断** |
| CJK run | `pinyin-ime-v2-pinyin-stream.ts` | `CharSyllableRange { charStart, charEnd, syllableStart, syllableEnd }` | ✅ |
| char→syllable | `extract-raw-coarse-boundaries.ts` | `syllableIndexForCharOffset()` | ⚠️ run 内 **floor 比例插值** |
| syllable→raw | `pinyin-ime-v2-boundary-compatible-topk-diff.ts` | `syllableRangeToRawCharRange()` | ⚠️ 同上 |
| Proposal active span | `pinyin-ime-v2-span-normalizer.ts` | `NormalizedSpan { start, end, rawSpan }` | ✅ 仅异常区 |
| IME token path | `pinyin-ime-v2-types.ts` | `PinyinImeV2Token.syllableStart/End` | ✅ 提案层，未下沉 recall |

### 2.2 缺口

1. **无统一 `CoarseSpan` SSOT**：`RawBoundary`（文本）与 `FwMetadataSpanCandidate`（ASR 元数据）语义分裂，无桥接。
2. **活跃路径不读 ASR timestamps**：`resolvePinyinImeV2Spans` 仅收 `rawText`，word boundary 丢失。
3. **无 per-char 双向索引**：标点/拉丁在 syllable 空间无 slot；无法保证「整句每个 CJK 音节恰好落入唯一 coarse 分区」。
4. **粗边界不参与 fine span**：`computeBoundaryAlignmentDiagnostics` 只写 diagnostics，不约束搜索空间。
5. **Normalizer 合并相邻 interval**：与「保留多粒度 n-gram」目标 **相反**（合并为大 span，而非细分）。

### 2.3 全覆盖可行性

| 策略 | 可行性 | 说明 |
|------|--------|------|
| 标点/空白切分 + CJK run | **高** | `extractRawCoarseBoundaries` 已具备 |
| ASR word boundary 切分 | **中** | 需从 ctx 接线 + 与文本 offset 对齐 |
| Proposal active ∪ 未覆盖 segment | **高** | 需显式 **补集** 算法：全句 CJK syllable 区间减去已选 fine span |
| 单字主动扫描 | **禁止** | 与需求一致；仅 passive residual |

---

## 三、滑窗细分与 Recall 能力（§三）

### 3.1 当前 Recall 行为

| 项 | 实现 | 限制 |
|----|------|------|
| 入口 | `local-span-recall.ts` → `recallSpanTopKV2` | 单次传入 **整段** `spanText` |
| 音节长度 | `MIN_SYLLABLES=2`, `MAX_SYLLABLES=5` | 越界 skip |
| SQL | `lookupBase/DomainByPinyinKey(key, termLength)` | `termLength = variantSyllables.length`（汉字数≈音节数） |
| Fuzzy | `buildFuzzyPinyinVariants` | trim / function_syllable_strip；≤4 variants；**禁止**中间删/重排 |
| 任意子串 | **无** | 无对 coarse 内 `[i,j)` 枚举循环 |

### 3.2 是否支持「不依赖原始 span 字符长度」查询？

**部分支持。** V1.2 已实现 `termLength = variantSyllables.length`（如 钟贝少 3 音节 → `zhong|bei` 2 音节查桶）。但：

- 调用方必须 **显式传入** 子串 syllables + 对齐后的 `windowText`；
- **无内置** coarse 内 2/3/4/5-gram 滑窗；
- **无** 单音节主动 recall（符合 P0 禁止项）。

### 3.3 实现滑窗的最小复用方式（设计建议，非开发）

```text
for each coarseSpan.syllables[s..e]:
  for len in 2..min(5, e-s):
    for i in s..e-len:
      recallSpanTopKV2(syllables[i:i+len], alignWindowText(...), ...)
```

**禁止项对照：** 当前 fuzzy 符合（无汉字 fuzzy、无 LIKE、无 edit distance 全库）；中间删音节/重排未实现 ✅。

**P1 tone_pinyin_key：** runtime 有 `tone_pinyin_key` 列，但 P0 recall 路径仅用 `pinyin_key`；P1 可并行评估 tone 索引，不阻塞 V3 架构。

---

## 四、候选验证与 overlapping merge（§四）

### 4.1 当前支持度

| 能力 | 状态 | 位置 |
|------|------|------|
| candidate syllable length = n-gram length | ✅ recall 内 `hotword.word.length === syllables.length` | `recall-span-topk-v2.ts` |
| pinyin key 匹配 | ✅ `syllablesKey` 精确 | `pinyin-index.ts` |
| 前后音节延展为更长词 | ❌ | 无 |
| overlapping 命中合并为长候选 | ❌ | tier merge 仅 **按 word 去重**，非区间 merge |
| residual interval | ❌ | 无 |
| candidate provenance | ⚠️ | `RecallCandidateKind` + `WindowCandidateSource`；无 graph edge 类型 |
| syllable interval on candidate | ❌ | `FwSpanCandidateDiag` 无 `syllableStart/End` |

### 4.2 d001 示例（有蓝美马分）模拟

**Coarse span syllables（假设）：** `you | lan | mei | ma | fen`（5）

| n-gram | 可能 recall（词库 + weak domain） | 合并后 |
|--------|-----------------------------------|--------|
| `lan\|mei` | 蓝莓（2 字，若存在） | 指向更长词碎片 |
| `mei\|ma` | 莓马（噪声）/ 无 | — |
| `lan\|mei\|ma\|fen` | **蓝莓马芬**（fuzzy strip `you` 后） | ✅ 已在本轮 Weak+Fuzzy 批测验证 |
| residual | `you` | → oral_function / particle 路径 |

**现状：** 仅当 IME 选出 span「有蓝美马分」整段时 recall 命中；**无** 滑窗合并逻辑；`you` 不进入 residual 处理。

---

## 五、候选图与路径拼装（§五）

### 5.1 目标数据结构（缺失）

需新增（建议）：

```typescript
type CoarseSpanAssembledCandidate = {
  syllableStart: number;   // coarse 内相对索引
  syllableEnd: number;
  rawStart: number;
  rawEnd: number;
  replacementText: string;
  source: 'base_term' | 'domain_term' | 'oral_function' | 'oral_particle' | 'passive_domain_weak' | 'unknown' | 'noise';
  domainId?: string;
  score: number;
  provenance: { ngramKey: string; variantKind?: string; recallKind?: RecallCandidateKind };
};
```

### 5.2 当前 `FwSpanCandidateDiag` 对照

| 字段 | 现有 | 缺口 |
|------|------|------|
| raw offset | ✅ `span.start/end`（span 级） | 候选级无 |
| syllableStart/End | ❌ | 需新增 |
| replacementText | ✅ `word` | — |
| source | ✅ `WindowCandidateSource`（4 值） | 无 oral/unknown |
| domainId | ⚠️ `domains[]` 在 pipeline 写死 `[]` | `fw-sentence-rerank-pipeline.ts:71` |
| score | ✅ `candidateScore` | 无 coverage/path 惩罚项 |
| provenance | ❌ | — |

### 5.3 路径评分

当前仅 `sum(candidateScore)`（`build-sentence-candidates.ts`）。**无** 长词优先、覆盖率、碎片惩罚、oral 低权。

---

## 六、本句 Domain Vote（§六）

### 6.1 现有 domain evidence

| 字段 | Recall 候选 | FW diag |
|------|-------------|---------|
| `domain_id` | `HotwordEntry.domain` / `domains` | span.`domain` 固定 `'general'` |
| source layer | base / domain tier | 未下沉 |
| `prior_score` | ✅ | ✅ |
| `repair_target` | ✅ | ✅ |
| candidate kind | ✅ `RecallCandidateKind` | ❌ |

### 6.2 现有 vote 机制（非 utterance-scoped）

| 机制 | 文件 | 是否写 session |
|------|------|----------------|
| `primaryDomain` / `secondaryDomains` | `domain-recall-merge.ts` | 来自 profile / CPU LLM |
| Industry routing 投票 | `industry-routing-domain-resolver.ts` | 读 session intent，**可影响多轮** |
| Weak domain plan | `weak-domain-recall-resolver.ts` | 读 profile + enabledDomains |

**缺口：** 无 **仅本句**、**不写 profile** 的 `utteranceDomainVote`。

### 6.3 建议投票公式（审计建议，非实现）

```text
domainScore[d] = Σ (candidateScore × sourceWeight × coverageWeight × priorWeight)
```

| sourceWeight 建议 | 值 |
|-------------------|-----|
| domain_term strong | 1.0 |
| domain_term weak | 0.2 |
| base_term | 0.5 |
| oral_function | 0.15 |
| oral_particle | 0.1 |
| unknown/noise | 0.05 |

**短句证据不足：** 总 evidence < 阈值 → 保持 weak domain 全 enabled，不强投票（与 V1.2 weak 策略一致）。

**禁止写入：** `session profile` / `primaryDomain` / CPU LLM memory — 需在 V3 模块内 **局部变量** 完成，filter 后再组装。

---

## 七、整句 n-best 组装（§七）

### 7.1 现有模块审计

| 模块 | 行为 | 能否接收 coarse assembled candidates |
|------|------|--------------------------------------|
| `build-sentence-candidates.ts` | **笛卡尔积** + sort + slice(16) | ⚠️ 需输入 `SpanReplacementPick[][]`；**非 beam** |
| `candidate-sentence-builder.ts` | 单 span 替换预览 | ✅ 可复用 |
| `rerank-fw-sentences.ts` | KenLM batch `[raw, ...candidates]` | ✅ 可复用 |
| `apply-span-replacements.ts` | 右到左替换 | ✅ 可复用 |
| `fw-sentence-rerank-pipeline.ts` | 编排 recall→build→rerank | ⚠️ 需改为吃 V3 组装输出 |

### 7.2 与目标差距

| 目标 | 现状 |
|------|------|
| beam search，每步 beam≤16 | ❌ 全笛卡尔积后截断 |
| 不生成全笛卡尔积 | ❌ `buildSentenceCandidates` 显式笛卡尔积 |
| raw baseline 保留 | ✅ `rerankFwSentences` 含 raw |
| per-span cap 8/4/2 | ✅ `per-span-candidate-limit.ts` |

**建议：** V3 在 **coarse span 内** 用 DP/beam 产出 ≤3 条 assembled path；**句级** 再用 beam（16）组合 coarse paths，替代当前笛卡尔积；最终仍交 `rerankFwSentences`。

### 7.3 重叠 span 风险

- Normalizer **合并**重叠；SpanSelector **不**做非重叠筛选。
- `buildSentenceCandidates` **假设** spans 不重叠；重叠时右到左替换结果不可解释。
- V3 全覆盖 coarse partition **应互斥**，从设计上消除重叠。

---

## 八、Passive Residual Span（§八）

### 8.1 现状

**无 residual 概念。** 未覆盖音节留在 raw 文本中，不进入 recall。

### 8.2 需新增

| 项 | 必要性 |
|----|--------|
| `residual interval` 数据结构 | **必须** |
| `oral_function_lexicon` tier | **建议** |
| `oral_particle_lexicon` tier | **建议** |
| `unknown` / `noise` placeholder edge | **建议**（低权，供 KenLM 判断） |
| passive 单字 | **允许**（仅 residual 触发，禁止全句扫描） |

### 8.3 residual recall 顺序（目标）

```text
oral_particle → oral_function → weak domain → base → unknown/noise
```

当前仅有：`base + domain (+ fuzzy)`，function 音节仅在 fuzzy strip 硬编码集。

---

## 九、口语词表与 SQLite Schema（§九）

### 9.1 当前 V3 四表

`schemaVersion: lexicon-v3-four-table-v1`（`node_runtime/lexicon/v3/manifest.json`）

| 表 | 行数（约） | 用途 |
|----|-----------|------|
| `base_lexicon` | 50000 | 通用 |
| `domain_lexicon` | 25 domains | 领域 |
| `idiom_lexicon` | 22192 | 4 字成语 |
| `industry_routing_lexicon` | 9 | 路由关键词 |

**无** `oral_function` / `oral_particle` 表或列。

### 9.2 新增 layer 可行性

| 方案 | 工作量 | 说明 |
|------|--------|------|
| 新表 `oral_function_lexicon` / `oral_particle_lexicon` | 中 | schema bump + `lexicon-runtime-v2` + patch 管线 |
| 复用 `base` + `tags` / `source` 过滤 | 低 | 需约定 `source=oral_function` SSOT；runtime 需读 tags（**当前不读**） |
| 仅代码内冻结小表（类似 `FUZZY_FUNCTION_SYLLABLES`） | 低 | 不适合大规模 oral 词，适合 P0 语气词 |

**建议：** P0 用 **冻结常量 + 小 JSON overlay**；P1 再纳入 V3 schema 第五、六表，避免阻塞 V3 链路架构验证。

### 9.3 词表设计约束（审计确认）

- oral 词：**低权重**，作边界锚点，不主动替换关键词 ✅ 与 KenLM 终审兼容
- 最终裁决仍在 KenLM / Apply — **不违反审计约束**

---

## 十、性能审计（§十）

### 10.1 d001 量级估算

**原文：** `你好,我想点一杯热拿铁钟贝少糖 深便温 以下今天有蓝美马分吗?`  
**CJK 音节约：** 27（标点后纯 CJK 计数）

假设 V3 切为 **5 个 coarse span**，平均 **5.4 音节/span**：

| 阶段 | 估算量 | 说明 |
|------|--------|------|
| coarse span 数 | 5–8 | 标点 + 可选 ASR word |
| 每 span n-gram 数（2–5） | ≈ Σ_{L=2}^{5}(s-L+1) | s=5 → 10；s=8 → 22 |
| 总 n-gram 查询（无 cap） | 50–150 / 句 | 5 span × 10–30 |
| × weak 4 domain | 200–600 SQL | **必须 cap** |
| fuzzy ×4 variants | 上限 ×4 | 已有 perVariantLimit=2 |
| candidate graph edges | O(n² × topK) | topK=2 → ~100 edge/span |
| domain vote | O(edges × domains) | 轻量 |
| coarse path beam | 3^5 = 243 上界 | cap → 16 |
| sentence KenLM | ≤17 queries | 与现网相同 |

### 10.2 性能风险表

| 阶段 | 当前耗时（参考） | 预计耗时 | 风险 | 控制手段 |
|------|------------------|----------|------|----------|
| Proposal+Selector | ~30ms decode（d001） | 0（V3 可旁路） | 低 | flag 互斥 |
| Recall / span | recall_ms avg **1.85ms** × **3 span** | **15–50ms** / 句 | **高** | n-gram topK≤2；weak domain cap；LRU 复用 |
| n-gram SQL | d001 v2_sql **43** | **100–400** 无 cap | **高** | 每 n-gram topK≤2；span 内 edge 剪枝 |
| domain vote | ~0 | <1ms | 低 | 句内局部 |
| coarse path DP | 无 | 1–5ms | 中 | topK≤3 / span |
| sentence beam | 笛卡尔积+sort | 2–10ms | 中 | beam≤16，禁全笛卡尔积 |
| KenLM rerank | d001 **~6s**（主导） | 同量级 | **高** | 保持 input≤16；**非 V3 引入** |
| Pipeline 总 | avg **3725ms** | +50–200ms 若 Recall 爆炸 | 中 | 上表 cap |

**本轮 Weak+Fuzzy 批测：** Recall 子阶段未成为瓶颈；KenLM **~6s/case** 仍为端到端主因。

---

## 十一、与现有架构关系（§十一）

### 11.1 能否替代 Proposal / Normalizer / SpanSelector？

| 组件 | 替代？ | 说明 |
|------|--------|------|
| Proposal（IME diff） | **不直接替代** | IME 仍可提供 **active region 信号** 加权，但 V3 coarse 分区应独立 |
| Normalizer | **旁路** | V3 自有 coarse 归一化；Normalizer 门控（2–6 字）与 n-gram 目标冲突 |
| SpanSelector | **旁路** | V3 用 candidate graph + path score 替代「选 4 个异常 span」 |

### 11.2 建议架构

```text
[flag off] 旧链路：
  Proposal → Normalizer → SpanSelector → Recall → KenLM → Apply

[flag on]  V3 链路：
  FW raw (+可选 ASR words) → CoarseSpanAssembly → NgramRecall → GraphAssembly
    → UtteranceDomainVote → SentenceBeam → KenLM → Apply
```

**禁止：** 两条链路同时改同一 raw 文本的不同 span 集而不定义优先级。

### 11.3 灰度 flag

建议：`features.fwDetector.spanAssemblyV3Enabled`（默认 **false**），与 `weakDomainRecallEnabled` / `fuzzyPinyinRecallEnabled` 正交。

### 11.4 可复用模块

| 模块 | 复用方式 |
|------|----------|
| `recallSpanTopKV2` | 作为 n-gram 查询引擎 |
| `fuzzy-pinyin-key-builder` | variant 生成 |
| `weak-domain-recall-resolver` | SQL domain 列表 |
| `candidate-score` / `domain-boost-calculator` | 打分 |
| `tone-recall-sort` | 可选 per-ngram tone slice |
| `build-sentence-candidates` / `rerankFwSentences` / Apply | 句级后半段 |

---

## 十二、d001 专项模拟（§十二）

**Raw：** `你好,我想点一杯热拿铁钟贝少糖 深便温 以下今天有蓝美马分吗?`

### 12.1 建议 coarse 切分（文本标点 + CJK run）

| # | coarseSpan（文本） | syllables（约） | 来源 |
|---|-------------------|-----------------|------|
| C1 | `你好` | `ni\|hao` (2) | 标点切分 |
| C2 | `我想点一杯热拿铁钟贝少糖` | `wo\|xiang\|dian\|yi\|bei\|re\|na\|tie\|zhong\|bei\|shao\|tang` (12) | CJK run（过长，需二级切分或 ASR word） |
| C3 | `钟贝少糖` | `zhong\|bei\|shao\|tang` (4) | Proposal active 子区 |
| C4 | `深便温以下` | `shen\|bian\|wen\|yi\|xia` (5) | 标点/语义 |
| C5 | `今天有蓝美马分吗` | `jin\|tian\|you\|lan\|mei\|ma\|fen\|ma` (8) | CJK run |

> **注：** C2 与 C3/C5 重叠需 V3 规则：**Proposal active 优先细分**，其余用标点/ASR 补全 **互斥 partition**。

### 12.2 各 coarse span 模拟（基于本轮批测 + 词库探针）

| coarseSpan | 关键 n-gram hits | domain evidence | assembled candidates（top≤3） |
|------------|------------------|-----------------|-------------------------------|
| C3 `钟贝少糖` | `zhong\|bei`→**中杯**；`bei\|shao`→?；`shao\|tang`→少糖? | restaurant weak | ① `[zhong,bei]`→中杯 + residual `shao\|tang` ② 整段保持 ③ noise |
| C5 `…有蓝美马分吗` | strip `you`→`lan\|mei\|ma\|fen`→**蓝莓马芬** | restaurant weak | ① `you`→oral_function? ② `[lan,mei,ma,fen]`→蓝莓马芬 ③ 兰梅马芬 |
| C4 `深便温以下` | `shen\|bian`→身边；`bian\|wen`→便温（无词） | base 弱 | ① 身边+以下（短语拼装）② unknown ③ raw 保留 |
| C1 `你好` | exact base | general | ① raw ② （通常不替换） |

### 12.3 重点验证

| 目标 | V3 模拟 | 当前批测 |
|------|---------|----------|
| 钟贝少糖→中杯+少糖 | graph 可拆 `[zhong,bei]` + `[shao,tang]` | 仅整段「钟贝」→中杯；「少糖」未单独 span |
| 有蓝美马分→有+蓝莓马芬 | residual `you` + 4-gram 命中 | ✅ recall 已有蓝莓马芬；`you` 未处理 |
| 深便温以下 | oral/unknown 低权 | 身边/申辩 候选；非目标「顺便」 |

**句级 KenLM（现状）：** Top 组合已含「中杯」「蓝莓马芬」，但 `maxDelta≈0.00033 < 0.03` → apply=0。**V3 不解决此瓶颈**（审计约束不调 KenLM）。

---

## 十三、失败模式审计（§十三）

| case | 候选爆炸风险 | 误投票风险 | KenLM 风险 | 缓解方式 |
|------|--------------|------------|------------|----------|
| `yi shi zhong xin` 高频同音 | **高**（4-gram 多） | 中（tech vs general） | 中 | n-gram topK≤2；短 evidence 不 strong vote |
| `yi xia` / `shi jian` | 中 | 低 | 低 | oral_function 白名单；低权 |
| 跨领域「系统/服务/中心/订单」 | 中 | **高** | 中 | utterance vote 阈值；domain strong 需 coverage≥2 |
| `那个就是一下` 口语噪音 | 中 | 低 | **高**（乱替换） | oral 低权 + unknown；KenLM 终审 |
| 短句「中杯」「看一下」 | 低 | 中 | 中 | 整 span=词；避免 over-merge |
| 「不要冰」 | 低 | 低 | 中 | lexicon gap → unknown，非 recall failure |
| 噪音/咳嗽/停顿 | 低 | 低 | **高** | coarse 边界吸收为 noise span；不 recall |

---

## 十四、开发前结论与最小方案（§十四）

### 14.1 必答清单

| # | 问题 | 答案 |
|---|------|------|
| 1 | FW raw 足够 coarse boundary？ | **部分足够**；需接 ASR words + 统一 `CoarseSpan` |
| 2 | 全覆盖 CJK 音节？ | **可做到**；需互斥 partition + 补集算法 |
| 3 | Recall 支持 n-gram？ | **引擎可复用**；需 V3 滑窗编排器 |
| 4 | 需 candidate graph？ | **是** |
| 5 | 需 oral 词表？ | **是**（P0 可冻结常量，P1 入库） |
| 6 | utterance vote 仅本句？ | **需新模块**；禁止写 profile |
| 7 | 复用 KenLM/Apply？ | **是** |
| 8 | 性能瓶颈？ | n-gram SQL 数量；KenLM 已是端到端瓶颈 |
| 9 | 新建 V3 链路？ | **强烈建议** |
| 10 | 保留旧链路 baseline？ | **是**（flag off） |

### 14.2 最小开发方案（P0 建议范围）

**新增（允许）：**

| 模块 | 职责 |
|------|------|
| `coarse-span-partition.ts` | raw → 互斥 coarseSpans（标点 + Proposal active + 补集） |
| `coarse-span-ngram-recall.ts` | 滑窗 2–5 syllable → 调 `recallSpanTopKV2` |
| `coarse-candidate-graph.ts` | overlapping merge + residual + path topK≤3 |
| `utterance-domain-vote.ts` | 句内 vote，输出 filter 权重 |
| `coarse-sentence-beam.ts` | beam≤16 组装句候选 |
| `span-assembly-v3-orchestrator.ts` | flag 入口，输出 `FwSpanDiagnostics[]` |

**修改（最小）：**

- `fw-detector-orchestrator.ts`：flag 分流仅 **一处**
- `node-config-types.ts` / defaults：`spanAssemblyV3Enabled`

**禁止修改：** KenLM、Apply、ToneModule、Proposal 内部（可只读消费其 active span 列表）。

### 14.3 P0 验收指标（建议）

| 指标 | 目标 |
|------|------|
| coarse partition 覆盖率 | 100% CJK 音节落入恰好一个 coarse span |
| d001 recall | C3 产出中杯；C5 产出蓝莓马芬；residual `you` 有 oral 候选 |
| SQL 查询/句 | ≤150（含 cap） |
| recall 子阶段 P95 | <15ms（与 V1.2 一致） |
| contract dialog_200 | 200/200（flag on 不破坏契约） |
| apply / CER | **非 P0 硬性**（KenLM 未动）；记录 recall 命中率即可 |

### 14.4 与本轮 Weak+Fuzzy 关系

Weak+Fuzzy 已验证 **单 span 多 variant recall** 可行（d001 domain_hits>0，候选含中杯/蓝莓马芬）。V3 将其 **泛化为 coarse 内多 n-gram + graph 拼装**，是 natural 演进，**不应**在 SpanSelector 上打补丁实现全覆盖。

---

## 附录 A：关键代码索引

| 主题 | 路径 |
|------|------|
| 粗边界提取 | `fw-detector/pinyin-ime-v2/extract-raw-coarse-boundaries.ts` |
| char↔syllable | `fw-detector/pinyin-ime-v2/pinyin-ime-v2-pinyin-stream.ts` |
| Proposal 编排 | `fw-detector/pinyin-ime-v2/run-pinyin-ime-v2-span-proposal.ts` |
| Normalizer | `fw-detector/pinyin-ime-v2/pinyin-ime-v2-span-normalizer.ts` |
| SpanSelector | `fw-detector/pinyin-ime-v2/pinyin-ime-v2-span-selector.ts` |
| FW 映射 | `fw-detector/pinyin-ime-v2/map-selected-span-to-fw.ts` |
| Recall | `lexicon-v2/recall-span-topk-v2.ts`, `lexicon/local-span-recall.ts` |
| Fuzzy | `lexicon-v2/fuzzy-pinyin-key-builder.ts` |
| 句级组装 | `fw-detector/build-sentence-candidates.ts` |
| KenLM rerank | `fw-detector/rerank-fw-sentences.ts` |
| 管线 | `fw-detector/fw-sentence-rerank-pipeline.ts` |
| Legacy ASR gate | `legacy/archive/fw-detector-span/fw-metadata-span-gate.ts` |
| Lexicon manifest | `node_runtime/lexicon/v3/manifest.json` |

## 附录 B：参考批测

- Weak+Fuzzy dialog_200：`tests/weak-domain-fuzzy-dialog200-batch-result.json`
- 测试报告：`docs/tone/Weak_Domain_Fuzzy_Pinyin_Recall_Dialog200_Test_Report_2026_06_07.md`

---

*本报告为只读审计产物，未修改任何产品代码。*
