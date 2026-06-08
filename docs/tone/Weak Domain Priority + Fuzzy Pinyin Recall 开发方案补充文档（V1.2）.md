# Weak Domain Priority + Fuzzy Pinyin Recall

# 开发方案补充文档（V1.2）

日期：2026-06-07

性质：开发方案补充（冻结版）

关联文档：

* Weak Domain Priority + Fuzzy Pinyin Recall 开发方案 V1.1
* Weak_Domain_Priority_Fuzzy_Recall_Audit_2026_06_07
* Weak_Domain_Priority_Fuzzy_Recall_DevPlan_Supplement_Checklist_2026_06_07

---

# 一、文档目的

本补充文档用于修正 V1.1 中与当前代码实现不一致的部分。

原则：

```text
不改变总体架构
不扩大 Scope
不引入新链路
仅补充实际落地约束
```

冻结架构保持：

```text
Proposal
↓
Normalizer
↓
SpanSelector
↓
Recall
↓
Tone
↓
KenLM
↓
Apply
```

---

# 二、P0 与 P1 边界重新冻结

## P0

仅实现：

```text
Weak Domain Recall
+
Plain Pinyin Variant Recall
```

---

禁止进入 P0：

```text
tone_pinyin_key SQL
tone_key 索引
tone_key runtime API
tone_key cache
```

---

原因：

当前 runtime 不存在：

```typescript
lookupTonePinyinKey()
```

仅存在：

```typescript
lookupBaseByPinyinKey()

lookupDomainByPinyinKey()
```

均基于：

```text
pinyin_key
```

查询。

---

因此：

P0：

```text
span
↓
syllables
↓
plain pinyin variants
↓
Recall
```

---

P1：

```text
tone_pinyin_key
```

相关能力。

---

# 三、Variant 查询冻结规则

Recall 不允许：

```text
中文字裁剪
中文字重组
中文字模糊匹配
SQL LIKE
全表扫描
```

---

仅允许：

```text
拼音音节序列变体
```

例如：

```text
zhong|bei|shao
```

↓

```text
zhong|bei
```

---

允许：

```text
trim_head
trim_tail
trim_both
function_syllable_strip
```

---

禁止：

```text
删除中间音节
重排音节
编辑距离搜索
```

---

# 四、Variant Length 冻结规则

当前 SQLite 查询依赖：

```sql
(pinyin_key, length(word))
```

联合索引。

---

因此：

每个 Variant 查询必须：

```typescript
termLength =
variantSyllables.length
```

---

示例：

原始：

```text
钟贝少

3 syllables
```

Variant：

```text
钟贝

2 syllables
```

查询：

```typescript
termLength = 2
```

---

禁止：

```typescript
termLength = originalSpanLength
```

否则 Recall 必然失效。

---

# 五、Weak Domain Priority 冻结规则

## 当前

general：

```text
domainIds=[]
```

↓

```text
base only
```

---

## P0

general：

```text
base
+
all enabled domains weak
```

---

restaurant：

```text
base
+
restaurant strong
+
other domains weak
```

---

## 权重

```typescript
PRIMARY_DOMAIN_WEIGHT = 1.0

SECONDARY_DOMAIN_WEIGHT = 0.5

WEAK_DOMAIN_WEIGHT = 0.2
```

---

原则：

```text
允许进入候选池

不允许压制 base
```

---

# 六、Industry Routing 互斥规则

当前存在：

```text
useIndustryRouting
```

配置。

---

新增：

```text
weakDomainRecallEnabled
```

后：

必须明确：

```text
weak domain
与
industry routing

不可重复放大查询
```

---

推荐冻结：

```text
weakDomainRecallEnabled=true
```

时：

```text
industry routing
关闭
```

---

或：

```text
industry routing
仅负责 strong

weak domain
独立负责 fallback
```

---

禁止：

```text
双路径同时查全域
```

---

# 七、Candidate Score 补充

V1.1 未写明：

```text
candidate-score.ts
```

修改。

---

P0 必须允许修改：

```text
candidate-score.ts
```

用于：

```typescript
fuzzyPenalty
```

实现。

---

推荐：

```text
exact_base
0
```

```text
exact_domain_strong
0
```

```text
exact_domain_weak
-0.02
```

```text
fuzzy_plain
-0.08
```

```text
fuzzy_plain_domain
-0.10
```

---

最终：

```text
candidateScore
+
domainBoost
-
fuzzyPenalty
```

---

# 八、Tone 排序补充

当前：

```text
sortRecallHitsByToneCompatibility()
```

使用：

```text
acousticTonePattern
```

排序。

---

Variant 变短时：

必须：

```typescript
variantPattern =
acousticTonePattern.slice(
  0,
  variantSyllableLength
)
```

---

示例：

```text
zhong|bei|shao
```

↓

```text
zhong|bei
```

---

Pattern：

```text
3 syllables
```

↓

```text
2 syllables
```

---

禁止：

```text
3音节Pattern
对比
2音节Candidate
```

---

# 九、Repair Target 约束

保持冻结：

```text
candidateRequireRepairTarget=true
```

---

Weak Domain：

不得绕过：

```text
repair_target
```

过滤。

---

所有 Weak Candidate：

仍需：

```text
repair_target=1
```

---

# 十、Diagnostics 补充

新增：

```typescript
weakDomainEnabled
weakDomainIds
weakDomainCandidateCount

fuzzyRecallEnabled
fuzzyVariantCount

fuzzyCandidateCount

candidateSourceBreakdown

recallEmptyBeforeFuzzy
recallEmptyAfterFuzzy

domainHitsBeforeWeak
domainHitsAfterWeak
```

---

新增：

```typescript
fuzzyVariantExamples
```

用于批测验证。

---

# 十一、性能冻结

保持：

```text
maxSentenceCandidates=16
```

---

保持：

```text
perSpanLimit
```

原配置。

---

新增：

```text
variant <= 4
```

---

新增：

```text
perVariantLimit <= 2
```

---

目标：

```text
Recall Avg < 5ms
Recall P95 < 15ms
```

---

# 十二、验收修订

## d001

通过：

```text
钟贝少
→ 中杯
```

---

通过：

```text
有蓝美马分
→ 蓝莓马芬
```

---

## d002

通过：

```text
美食
→ 美式
```

---

通过：

```text
大悲
→ 大杯
```

---

## d003

通过：

```text
小背
→ 小杯
```

---

## 非目标

```text
深便
→ 顺便
```

暂不作为 P0 验收。

---

# 十三、Lexicon Gap

以下问题不属于：

```text
Weak Domain
+
Fuzzy Recall
```

范围。

---

当前确认：

```text
少冰
```

不存在于 SQLite。

---

因此：

```text
少病
→ 少冰
```

失败时：

必须标记：

```text
Lexicon Coverage Gap
```

而不是：

```text
Recall Failure
```

---

# 十四、允许修改文件（最终版）

新增允许：

```text
candidate-score.ts

node-config-types.ts

node-config-defaults.ts

weak-domain-recall-resolver.ts

fuzzy-pinyin-key-builder.ts
```

---

保持允许：

```text
local-span-recall.ts

recall-span-topk-v2.ts

domain-boost-calculator.ts

recall-v2-diagnostics.ts

lexicon-fw-recall-config.ts
```

---

禁止修改：

```text
Proposal

LocalRawImeDiff

Normalizer

SpanSelector

ToneModule

KenLM

Apply
```

---

# 十五、最终冻结结论

P0：

```text
Weak Domain Recall
+
Plain Pinyin Variant Recall
```

---

P1：

```text
Tone Key Recall
```

---

P2：

```text
Phrase Alias
+
Lexicon Coverage Expansion
```

---

通过后冻结：

```text
Weak Domain Priority V1
```

```text
Fuzzy Pinyin Recall V1
```

进入：

```text
Recall
↓
Tone
↓
KenLM
↓
Apply

真实替换收益验证阶段
```
