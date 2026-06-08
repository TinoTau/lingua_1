# Pinyin IME v2 Local Raw-IME Diff Proposal 开发方案

版本：V1.0
日期：2026-06-07
性质：Proposal 层冻结架构增强

---

# 一、目标

修复：

```text
d001

钟贝 → 中杯
蓝美马分 → 蓝莓马芬
```

无法产生 span 的问题。

---

当前：

```text
diffSpans
↓
alignFailed
↓
diffSpanCount=0
```

导致：

```text
Proposal
无法发现错误区域
```

---

目标：

在不修改：

```text
Normalizer
SpanSelector
Recall
Tone
KenLM
Apply
```

的前提下，

增加：

```text
Local Raw-vs-IME Diff
```

作为：

```text
diffSpans 的 fallback
```

---

# 二、冻结原则

禁止修改：

```text
Normalizer
SpanSelector
Recall
ToneModule
KenLM
Apply
IME Decoder
IME TopK
PrimaryDomain
Domain Recall
```

---

允许修改：

```text
run-pinyin-ime-v2-span-proposal.ts
pinyin-ime-v2-types.ts
pinyin-ime-v2-diagnostics.ts
```

允许新增：

```text
pinyin-ime-v2-local-raw-ime-diff.ts
```

---

# 三、目标架构

现有：

```text
rawText
↓
diffSpans
↓
Normalizer
↓
SpanSelector
```

---

调整后：

```text
rawText
↓
diffSpans

如果：
alignFailedCount == candidateCount

↓

localRawImeDiffSpans

↓

diffSpans

↓

Normalizer

↓

SpanSelector
```

---

# 四、设计原则

localRawImeDiff：

只负责：

```text
发现可疑区域
```

不负责：

```text
生成替换词
生成候选
修改文本
```

---

后续职责保持：

```text
Recall
↓
Tone
↓
KenLM
↓
Apply
```

不变。

---

# 五、接口设计

新增：

```typescript
export function buildLocalRawImeDiffSpans(
    input: LocalRawImeDiffInput
): PinyinImeV2DiffSpan[]
```

---

输入：

```typescript
interface LocalRawImeDiffInput {

    rawText:string

    candidates:PinyinImeV2Candidate[]

    trustedCandidates:PinyinImeV2Candidate[]

    charRanges:CharSyllableRange[]

}
```

---

输出：

```typescript
PinyinImeV2DiffSpan[]
```

保持现有类型。

禁止新增：

```text
LocalRawImeDiffSpan
```

独立运行时类型。

---

# 六、核心逻辑

## Step 1

获取 trustedTopK

复用：

```typescript
selectTrustedTopKCandidates()
```

---

## Step 2

遍历 token

```typescript
for token in candidate.tokens
```

---

token：

```typescript
{
    word,
    syllableStart,
    syllableEnd
}
```

---

## Step 3

音节映射

复用：

```typescript
syllableRangeToRawCharRange()
```

---

获得：

```typescript
rawStart
rawEnd
```

---

## Step 4

获取 rawSlice

```typescript
rawSlice =
    rawText.slice(rawStart,rawEnd)
```

---

## Step 5

比较

```typescript
normalize(rawSlice)
!=
normalize(token.word)
```

成立：

进入候选。

---

## Step 6

过滤

保留：

```text
charLength >= 2
charLength <= 6

syllables >= 2
syllables <= 5

CJK only
```

---

单字：

```text
禁止生成
```

---

## Step 7

Interval 去重

同一个：

```text
[start,end)
```

仅保留一次。

---

支持度：

```typescript
supportCount =
    distinct trusted ranks
```

---

# 七、激活条件

必须：

```typescript
alignFailedCount
==
candidateCount
```

---

否则：

继续使用：

```typescript
existingDiffSpans
```

---

禁止：

```text
localRawImeDiff
与 existingDiffSpans 同时混用
```

---

原因：

审计确认：

```text
d002

追加模式

↓

Normalizer 合并

↓

退化
```

---

# 八、Diagnostics

新增：

```typescript
localRawImeDiffActivated:boolean
```

---

```typescript
localRawImeDiffSpanCount:number
```

---

```typescript
localRawImeDiffCandidateCount:number
```

---

```typescript
localRawImeDiffTrustedCandidateCount:number
```

---

```typescript
localRawImeDiffDroppedCount:number
```

---

```typescript
localRawImeDiffSingleCharCount:number
```

---

```typescript
localRawImeDiffExampleSpans:[]
```

---

Example：

```json
{
  "rawSlice":"钟贝",
  "imeWord":"中杯",
  "syllableStart":10,
  "syllableEnd":12,
  "rawStart":11,
  "rawEnd":13,
  "source":"local_raw_ime_diff"
}
```

仅允许出现在：

```text
diagnostics
```

禁止进入：

```text
Recall
Tone
KenLM
Apply
```

---

# 九、Target List

## Core

* [ ] 新建 pinyin-ime-v2-local-raw-ime-diff.ts
* [ ] 实现 buildLocalRawImeDiffSpans
* [ ] trustedTopK 复用
* [ ] syllable interval 映射复用
* [ ] raw interval dedupe

---

## Proposal

* [ ] run-pinyin-ime-v2-span-proposal.ts 接入
* [ ] alignFailed fallback
* [ ] diagnostics 输出

---

## Test

* [ ] d001 专项
* [ ] 钟贝→中杯
* [ ] 蓝美马分→蓝莓马芬
* [ ] alignFailed fallback
* [ ] d002 不退化
* [ ] d003 不退化

---

## Batch

* [ ] dialog_200
* [ ] contract 200/200

---

# 十、Check List

## Functional

* [ ] d001 local diff span >= 2
* [ ] 包含钟贝
* [ ] 包含蓝美马分区域
* [ ] selectedSpanCount > 0

---

## Regression

* [ ] d002 不退化
* [ ] d003 不退化

---

## Runtime

* [ ] SpanSelector 无改动
* [ ] Normalizer 无改动
* [ ] Recall 无改动
* [ ] Tone 无改动
* [ ] KenLM 无改动
* [ ] Apply 无改动

---

## Metrics

目标：

```text
fw_triggered

106
↓

121~131
```

---

```text
no_spans

继续下降
```

---

```text
contract

200/200
```

---

# 十一、验收标准

必须满足：

```text
Proposal 新增 localRawImeDiff
```

---

```text
仅在 alignFailed 全灭时激活
```

---

```text
不新增第四条主链
```

---

```text
不修改冻结模块
```

---

```text
d001 成功产生 span
```

---

```text
d002
d003

无回归
```

---

```text
ToneModule
Recall
KenLM
Apply

零代码改动
```

通过后进入下一阶段：

```text
PrimaryDomain
General → AllDomainWeakRecall
```

开发。
