# Weak Domain Priority + Fuzzy Span Recall 开发前审计（只读）

禁止修改代码。
禁止提交补丁。
禁止重构。
禁止调整 Proposal / Normalizer / SpanSelector / ToneModule / KenLM / Apply。
禁止新增 LLM。
禁止绕过 Recall / KenLM / Apply。

本轮只做开发前代码审计，并生成审计报告文档：

```text
Weak_Domain_Priority_Fuzzy_Recall_Audit_2026_06_07.md
```

---

# 一、背景

当前链路已冻结为：

```text
ASR
→ Pinyin IME v2 Proposal
→ Normalizer
→ SpanSelector
→ Recall
→ Tone sort
→ KenLM
→ Apply
```

已完成并建议冻结：

```text
ToneModule
tone_pinyin_key
SpanSelector
Local Raw-IME Diff Proposal
```

当前真实质量审计显示：

```text
fw_triggered = 158 / 200
apply = 0
final CER 未改善
```

主要瓶颈：

```text
Recall miss / recallEmpty
span 边界不准
primaryDomain=general 时 domain_lexicon 不参与
```

已知数据：

```text
158 FW 案例中：
77 案 Recall miss
47 案无可修复 span / span 边界错误
32 案 Recall+Tone OK 但 KenLM reject
```

餐饮场景中：

```text
domain_hits = 0
active_domain = base_only
cafe Recall Top1/Top3/Top5 命中 = 0
```

但 SQLite 中实际存在：

```text
中杯
大杯
小杯
美式
蓝莓马芬
```

因此本轮审计目标是：

1. 审计 Weak Domain Priority / All-Domain Weak Recall 是否已存在、是否被关闭、是否需要重建；
2. 审计 span recall 是否需要增加 fuzzy recall；
3. 审计如何允许：

   * span 多出连接词；
   * span 少量边界偏移；
   * 用户使用简称；
   * domain 未知时仍能召回专业词；
4. 所有候选最终仍由 KenLM / Apply 裁决。

---

# 二、核心设计目标

## 目标 A：Weak Domain Priority

当前：

```text
primaryDomain = general
→ domainIds = []
→ active_domain = base_only
```

目标：

```text
primaryDomain = general / unknown / null
→ base + idiom + all enabled domain weak recall
```

要求：

```text
domain 候选可以进入 Recall 候选池
但必须降权
不得直接强替换
不得绕过 Tone / KenLM / Apply
```

当：

```text
primaryDomain = restaurant
```

目标：

```text
base + idiom + restaurant strong domain recall + other domain weak recall
```

---

## 目标 B：Fuzzy Span Recall

当前 span 可能不精确，例如：

```text
钟贝少
→ 实义词应为：钟贝 / 中杯

有蓝美马分
→ 实义词应为：蓝美马分 / 蓝莓马芬
```

要求 Recall 层支持：

```text
span 内允许丢弃连接词 / 功能词 / 前后缀噪声
保留实义词部分进行召回
```

但禁止：

```text
对每个 span 做暴力排列组合
生成大量子串
绕过 KenLM
直接替换
```

---

## 目标 C：简称 / 缩写 Recall

用户可能说简称，例如：

```text
蓝莓马芬 → 蓝莓
卡布奇诺 → 卡布
短信提醒 → 短信
```

要求审计当前词库是否有：

```text
alias
shortName
abbr
phrase alias
```

如果没有，评估如何通过 fuzzy recall / alias 字段实现。

---

# 三、审计范围

请重点审计以下文件：

```text
local-span-recall.ts
recall-span-topk-v2.ts
domain-recall-merge.ts
industry-routing-domain-resolver.ts
lexicon-runtime-v2.ts
merge-span-candidates.ts
domain-boost-calculator.ts
resolve-pinyin-ime-v2-spans.ts
fw-sentence-rerank-pipeline.ts
build-sentence-candidates.ts
rerank-fw-sentences.ts
apply-span-replacements.ts
```

以及：

```text
lexicon sqlite schema
base_lexicon
domain_lexicon
target_lexicon
alias 表 / abbreviation 表 / phrase 表
repair_target 字段
prior_score 字段
domain_id 字段
tone_pinyin_key 字段
```

输出完整调用链：

```text
selected span
→ recallSpanTopK
→ resolveDomainIdsForRecall
→ lookupBaseByPinyinKey
→ lookupDomainByPinyinKey
→ candidate merge
→ tone sort
→ sentence candidate builder
→ KenLM
→ Apply
```

---

# 四、Weak Domain Priority 审计

请回答：

1. 当前 `primaryDomain=general` 为什么得到 `domainIds=[]`？
2. 历史设计中的 weak domain priority / all-domain weak recall 是否还存在代码？
3. 如果存在：

   * 哪个 feature flag 控制？
   * 为什么当前 dialog_200 没启用？
   * 是否被 `industryRoutingUsed=false` 阻断？
4. 如果不存在：

   * 当前最小恢复点在哪个函数？
5. `enabledDomains` 当前从哪里来？
6. 是否能安全获得全部合法 domain？
7. domain 候选当前如何计算 boost / prior？
8. 是否已有 domain 降权机制？

输出矩阵：

| primaryDomain | 当前 domainIds | 当前查 domain | 目标 domainIds                    | 目标权重  |
| ------------- | ------------ | ---------- | ------------------------------- | ----- |
| general       | ?            | ?          | all enabled domains weak        | low   |
| null/unknown  | ?            | ?          | all enabled domains weak        | low   |
| restaurant    | ?            | ?          | restaurant strong + others weak | mixed |
| medical       | ?            | ?          | medical strong + others weak    | mixed |

---

# 五、Weak Domain Priority 目标策略评估

请评估以下策略：

## 策略 1：general 查询 all enabled domains，但统一降权

```text
base: normal
idiom: normal
all domains: weak
```

## 策略 2：primaryDomain 明确时 strong + weak

```text
primary domain: strong
secondary / other domains: weak
```

## 策略 3：仅 repair_target=true 的 domain 词参与 weak recall

```text
domain_lexicon.repair_target = true
enabled = true
```

请输出：

| 策略 | 命中收益 | 误召回风险 | 性能风险 | 是否推荐 |
| -- | ---- | ----- | ---- | ---- |

---

# 六、Fuzzy Span Recall 审计

当前实际 span 边界存在偏移：

```text
钟贝少
有蓝美马分
做一杯美食
悲就行谢谢
赶时间小背
```

请审计 Recall 当前是否只按：

```text
whole span pinyin_key
```

查询。

如果是，请评估新增 fuzzy span variants 的可行性。

---

# 七、Fuzzy Span Variant 生成原则

请评估以下 variant 生成机制：

## 7.1 首尾裁剪

仅允许有限裁剪：

```text
原 span
去掉首 1 字
去掉尾 1 字
去掉首尾各 1 字
```

例如：

```text
钟贝少
→ 钟贝
→ 贝少
```

```text
有蓝美马分
→ 蓝美马分
→ 有蓝美马
```

限制：

```text
variant 数 <= 4
variant 字数 2~6
音节数 2~5
```

---

## 7.2 停用词 / 连接词剥离

维护小型 function-word list，例如：

```text
有
要
想
点
做
一
杯
个
的
了
吗
呢
请
帮
我
就
行
谢谢
```

只允许剥离：

```text
span 首尾
```

不允许中间任意删除。

例如：

```text
有蓝美马分 → 蓝美马分
悲就行谢谢 → 悲 / 大悲? 需要谨慎
```

请判断哪些词适合加入列表，哪些不适合。

---

## 7.3 N-gram 实义片段

对长 span 仅生成有限 n-gram：

```text
2~5 字连续片段
最多 topK variants
```

但必须有约束：

```text
保留 CJK
不跨太长
不生成所有排列组合
不超过 maxFuzzyVariantsPerSpan
```

---

## 7.4 简称 / alias

审计词库是否已有 alias 字段。

如果有：

```text
span variant
→ alias lookup
→ canonical word
```

如果没有：

建议是否新增：

```text
alias_pinyin_key
alias_text
canonical_word
domain_id
```

但本轮只审计，不开发。

---

# 八、Fuzzy Recall 查询方式

请评估：

## 方式 A：生成 fuzzy span variants 后复用 recallSpanTopK

```text
span
→ variants[]
→ pinyin_key
→ lookup base/domain
```

优点：最少改动。

---

## 方式 B：在 SQL 层做模糊查询

```text
LIKE
prefix/suffix
edit distance
```

风险：性能高、不可控。

---

## 方式 C：新增 precomputed alias / search key

适合简称、固定缩写。

请判断最适合当前冻结架构的方案。

要求：

不要推荐 SQL LIKE 全库扫描。

---

# 九、候选合并与权重设计

请设计候选来源标记：

```typescript
source:
  | 'exact_base'
  | 'exact_domain_strong'
  | 'exact_domain_weak'
  | 'fuzzy_base'
  | 'fuzzy_domain_weak'
  | 'alias_domain'
```

请审计当前 candidate 类型是否支持这些 source。

如果不支持，建议最小字段扩展。

---

## 权重原则

建议：

```text
exact base > exact strong domain > fuzzy strong domain > exact weak domain > fuzzy weak domain > alias weak
```

但注意：

最终仍由：

```text
Tone
KenLM
Apply
```

裁决。

请审计当前 merge / finalScore 是否能表达：

```text
weak domain penalty
fuzzy penalty
alias penalty
```

输出建议：

| candidate source | priority/penalty | 理由 |
| ---------------- | ---------------- | -- |

---

# 十、候选数量控制

必须审计现有 cap：

```text
perSpanLimit
maxDomainCandidates
maxSentenceCandidates
maxSpans
```

并给出 fuzzy recall 后的新 cap 建议：

```text
maxFuzzyVariantsPerSpan <= 4
maxFuzzyCandidatesPerVariant <= 2
maxWeakDomainCandidatesPerSpan <= 4
final perSpanLimit 不变或小幅调整
```

要求：

```text
不能让候选爆炸
不能明显增加 KenLM 长尾
```

---

# 十一、d001 / d002 / d003 专项模拟

请只读模拟：

## d001

Actual spans:

```text
钟贝少
深便
有蓝美马分
```

目标：

```text
钟贝 → 中杯
蓝美马分 → 蓝莓马芬
```

请输出：

| span | fuzzy variants | general recall | weak domain recall | expected hit |
| ---- | -------------- | -------------- | ------------------ | ------------ |

---

## d002

Actual spans:

```text
做一杯美食
悲就行谢谢
```

目标：

```text
美食 → 美式
大悲 → 大杯
```

请输出同表。

---

## d003

Actual spans:

```text
燕麦
少病
赶时间小背
```

目标：

```text
少病 → 少冰
小背 → 小杯
```

请输出同表。

---

# 十二、跨场景风险模拟

请对 hospital / bank / tech / friend 场景模拟 weak all-domain + fuzzy recall。

重点检查是否出现：

```text
餐饮词污染医院
医疗词污染银行
技术词污染日常聊天
```

输出：

| 场景 | 原 span | fuzzy/domain candidate | 风险等级 | 是否会被 KenLM 大概率拒绝 |
| -- | ------ | ---------------------- | ---- | ---------------- |

---

# 十三、性能审计

估算 fuzzy + weak domain 后：

```text
Recall avg / p95
KenLM combination count
candidate count
```

变化。

输出：

| 指标 | 当前 | 预计 | 风险 |
| -- | -- | -- | -- |

---

# 十四、最小开发方案建议

请基于审计结果给出最小开发方案，但不要开发。

要求包含：

1. Weak Domain Priority 是否要恢复或新建；
2. Fuzzy Span Variant 是否放在 Recall 层；
3. 是否需要新增 alias 表或先不做；
4. 需要修改哪些文件；
5. 需要新增哪些 diagnostics；
6. 如何保证不偏离冻结架构；
7. 如何保证候选不爆炸；
8. 如何验收。

禁止提出新架构。
禁止新增 LLM。
禁止修改 Proposal / Normalizer / SpanSelector。
禁止修改 ToneModule。
禁止修改 KenLM。
禁止修改 Apply。

---

# 十五、建议 diagnostics

请审计是否需要新增：

```typescript
weakDomainEnabled
weakDomainIds
weakDomainCandidateCount
fuzzyRecallEnabled
fuzzyVariantCount
fuzzyCandidateCount
fuzzyVariantExamples
candidateSourceBreakdown
recallEmptyBeforeFuzzy
recallEmptyAfterFuzzy
domainHitsBeforeWeak
domainHitsAfterWeak
```

---

# 十六、验收标准建议

开发后至少应满足：

1. contract PASS 200/200
2. primaryDomain=general 时 domain_hits > 0
3. cafe Recall TopK 命中率 > 0
4. d001:

   * `钟贝少` 能通过 fuzzy variant 召回 `中杯`
   * `有蓝美马分` 能召回 `蓝莓马芬`
5. d002:

   * `做一杯美食` 能召回 `美式`
   * `悲就行谢谢` 能召回 `大杯`
6. d003:

   * `赶时间小背` 能召回 `小杯`
7. `少冰` 若词库缺失，必须报告为 lexicon coverage issue
8. candidate 数不爆炸
9. KenLM / Apply 不改
10. Apply 不要求立即 >0，但 KenLM 可获得更多有效句级候选
11. ToneModule 路径不变
12. Proposal / Normalizer / SpanSelector 不改

---

# 十七、最终报告要求

请生成 Markdown 审计报告：

```text
Weak_Domain_Priority_Fuzzy_Recall_Audit_2026_06_07.md
```

报告必须回答：

1. weak domain priority 是否已存在？
2. 当前为什么 primaryDomain=general 时 domain_hits=0？
3. 是否应恢复 all-domain weak recall？
4. fuzzy span recall 是否适合放在 Recall 层？
5. d001/d002/d003 是否能通过 weak+fuzzy 召回目标词？
6. 简称/alias 当前是否支持？
7. 是否需要新增 alias 数据结构？
8. 风险与性能影响？
9. 最小开发方案？
10. target list 与 checklist？

只读审计。
不要开发。

```
```
