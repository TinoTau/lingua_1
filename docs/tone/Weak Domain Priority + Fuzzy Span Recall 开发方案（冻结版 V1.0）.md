# Weak Domain Priority + Fuzzy Pinyin Recall

# 开发方案（修正版 V1.1）

版本：V1.1
日期：2026-06-07
性质：Recall 层质量增强（冻结架构版）

---

# 一、方案修正说明

V1.0 中存在一个偏差：

```text
Fuzzy Span Variant
```

被描述成：

```text
对原始中文字做裁剪
```

例如：

```text
有蓝美马分
↓
蓝美马分
```

这种方式。

---

这不是最终设计。

原因：

```text
中文字边界本身不可靠
```

而且：

```text
Proposal
↓
SpanSelector
```

已经负责产生 span。

Recall 不应该再次尝试：

```text
中文切词
中文重组
中文排列组合
```

---

正确方案：

```text
Span
↓
拼音化
↓
Tone Pinyin Key
↓
Fuzzy Pinyin Recall
```

---

因此：

```text
Fuzzy
```

作用对象是：

```text
pinyin_key
tone_pinyin_key
```

不是：

```text
raw Chinese text
```

---

# 二、目标

解决：

```text
span边界偏移
```

造成的 Recall Miss。

例如：

```text
钟贝少
```

实际目标：

```text
中杯
```

---

```text
有蓝美马分
```

实际目标：

```text
蓝莓马芬
```

---

```text
赶时间小背
```

实际目标：

```text
小杯
```

---

同时解决：

```text
primaryDomain=general
```

时：

```text
domain_hits = 0
```

的问题。

---

# 三、冻结原则

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

允许修改：

```text
local-span-recall.ts

recall-span-topk-v2.ts

domain-boost-calculator.ts

recall-v2-diagnostics.ts

lexicon-fw-recall-config.ts
```

---

允许新增：

```text
fuzzy-pinyin-key-builder.ts
```

---

# 四、总体架构

当前：

```text
selectedSpan
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

调整后：

```text
selectedSpan
↓
TonePinyinKey Builder
↓
Fuzzy Pinyin Key Builder
↓
Weak Domain Recall
↓
Recall Merge
↓
Tone
↓
KenLM
↓
Apply
```

---

说明：

```text
只增强 Recall 输入
```

后续链路：

```text
Tone
KenLM
Apply
```

完全不变。

---

# 五、Weak Domain Priority

## 当前

general：

```text
domainIds=[]
```

↓

```text
base_only
```

---

结果：

```text
中杯
蓝莓马芬
美式
```

虽然存在于 domain 库。

但：

```text
Recall TopK = 空
```

---

## 调整后

general：

```text
base
+
idiom
+
all enabled domains (weak)
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

medical：

```text
base
+
medical strong
+
other domains weak
```

---

# 六、Domain 权重

推荐：

```typescript
PRIMARY_DOMAIN_WEIGHT = 1.0

SECONDARY_DOMAIN_WEIGHT = 0.5

WEAK_DOMAIN_WEIGHT = 0.2
```

---

候选来源：

```text
exact_base
```

无惩罚。

---

```text
exact_domain_strong
```

轻微加权。

---

```text
exact_domain_weak
```

轻微降权。

---

原则：

```text
允许进入候选池
```

但：

```text
不能压制 base
```

---

# 七、Fuzzy Pinyin Recall

核心思想：

```text
模糊拼音
不是模糊汉字
```

---

Recall 输入：

```text
rawSpan
```

例如：

```text
钟贝少
```

---

转换：

```text
tone_pinyin_key

zhong1 bei4 shao3
```

---

生成：

```text
tone key variants
```

---

然后：

```text
lookupTonePinyinKey()
```

---

最终：

```text
Recall TopK
```

---

# 八、Variant 生成规则

## Rule 1

原始 Tone Key

保留。

例如：

```text
zhong1 bei4 shao3
```

---

## Rule 2

去尾一个音节

```text
zhong1 bei4 shao3
↓
zhong1 bei4
```

---

## Rule 3

去头一个音节

```text
you3 lan2 mei2 ma3 fen1
↓
lan2 mei2 ma3 fen1
```

---

## Rule 4

去头去尾

```text
you3 lan2 mei2 ma3 fen1
↓
lan2 mei2 ma3
```

---

限制：

```text
最多4个 key variant
```

---

# 九、Function Word Strip

不是：

```text
删除中文字
```

---

而是：

```text
删除功能音节
```

---

例如：

```text
you lan mei ma fen
```

识别：

```text
you
```

属于：

```text
function syllable
```

---

允许：

```text
去头
```

---

结果：

```text
lan mei ma fen
```

---

注意：

```text
仅允许首尾
```

---

禁止：

```text
中间删除
```

---

禁止：

```text
重排音节
```

---

# 十、Tone 优先级

查询顺序：

## 第一层

```text
tone_pinyin_key
```

精确匹配。

---

例如：

```text
zhong1 bei4
```

↓

```text
中杯
```

---

## 第二层

tone fuzzy。

例如：

```text
zhong1 bei4 shao3
↓
zhong1 bei4
```

---

## 第三层

plain pinyin_key。

例如：

```text
zhong bei
```

---

原则：

```text
tone exact
>
tone fuzzy
>
plain pinyin
```

---

# 十一、候选来源

新增：

```typescript
candidateSource
```

---

支持：

```text
exact_base

exact_domain_strong

exact_domain_weak

fuzzy_tone

fuzzy_tone_domain

fuzzy_plain

fuzzy_plain_domain
```

---

# 十二、候选打分

新增：

```typescript
fuzzyPenalty
```

---

建议：

```text
exact_base
0
```

---

```text
exact_domain_strong
0
```

---

```text
exact_domain_weak
-0.02
```

---

```text
fuzzy_tone
-0.03
```

---

```text
fuzzy_tone_domain
-0.05
```

---

```text
fuzzy_plain
-0.08
```

---

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

# 十三、Alias

P0：

```text
不新增 Alias 表
```

---

原因：

当前问题：

```text
span边界偏移
```

和：

```text
domain recall缺失
```

远大于：

```text
简称
```

问题。

---

Alias 留到 P2。

---

# 十四、数据结构

新增：

```typescript
type FuzzyPinyinVariant = {
  toneKey:string;
  plainKey:string;
  source:
    | 'exact'
    | 'trim_head'
    | 'trim_tail'
    | 'trim_both'
    | 'function_syllable_strip';
}
```

---

新增：

```typescript
type RecallSourceBreakdown = {
  exactBase:number;
  exactDomainStrong:number;
  exactDomainWeak:number;

  fuzzyTone:number;
  fuzzyToneDomain:number;

  fuzzyPlain:number;
  fuzzyPlainDomain:number;
}
```

---

# 十五、Diagnostics

新增：

```typescript
weakDomainEnabled
```

---

```typescript
weakDomainIds
```

---

```typescript
weakDomainCandidateCount
```

---

```typescript
fuzzyRecallEnabled
```

---

```typescript
fuzzyVariantCount
```

---

```typescript
fuzzyToneHitCount
```

---

```typescript
fuzzyPlainHitCount
```

---

```typescript
candidateSourceBreakdown
```

---

```typescript
domainHitsBeforeWeak
```

---

```typescript
domainHitsAfterWeak
```

---

```typescript
recallEmptyBeforeFuzzy
```

---

```typescript
recallEmptyAfterFuzzy
```

---

# 十六、Target List

## Domain

* [ ] weakDomainRecallEnabled
* [ ] resolveRecallDomainIds()
* [ ] all enabled domains weak
* [ ] strong + weak 混合模式

---

## Fuzzy Pinyin

* [ ] buildFuzzyToneKeyVariants()
* [ ] trim_head
* [ ] trim_tail
* [ ] trim_both
* [ ] function_syllable_strip

---

## Recall

* [ ] fuzzy recall merge
* [ ] candidate dedupe
* [ ] fuzzy penalty

---

## Diagnostics

* [ ] weakDomainEnabled
* [ ] weakDomainIds
* [ ] fuzzyVariantCount
* [ ] fuzzyToneHitCount
* [ ] fuzzyPlainHitCount

---

## Batch

* [ ] dialog_200
* [ ] cafe subset
* [ ] contract

---

# 十七、Check List

## d001

* [ ] 钟贝少 → 中杯
* [ ] 有蓝美马分 → 蓝莓马芬

---

## d002

* [ ] 美食 → 美式
* [ ] 大悲 → 大杯

---

## d003

* [ ] 小背 → 小杯

---

## Domain

* [ ] general 时 domain_hits > 0

---

## Recall

* [ ] recallEmpty 下降

---

## Runtime

* [ ] Tone 无修改
* [ ] KenLM 无修改
* [ ] Apply 无修改

---

## Performance

* [ ] Recall avg < 5ms
* [ ] Recall p95 < 15ms
* [ ] maxSentenceCandidates=16

---

# 十八、验收标准

必须满足：

```text
general
↓
domain_hits > 0
```

---

```text
Recall 命中率显著提升
```

---

```text
餐饮 TopK 命中率 > 0
```

---

```text
d001
d002
d003

全部通过
```

---

```text
contract
200/200
```

---

```text
Proposal
Normalizer
SpanSelector
Tone
KenLM
Apply

零代码改动
```

---

# 十九、冻结条件

通过后冻结：

```text
Weak Domain Priority V1
```

---

```text
Fuzzy Pinyin Recall V1
```

---

进入下一阶段：

```text
Recall
↓
Tone
↓
KenLM
↓
Apply

真实替换效果验证
```
