# Pinyin IME v2 Local Raw-IME Diff Proposal

# 开发方案补充文档（V1.1）

版本：V1.1
日期：2026-06-07
性质：开发前补充约束（冻结架构）

---

# 一、Proposal 集成补充

## 1.1 Proposal 插入位置

当前 Proposal 主流程：

```text
collectDiffSpansFromCandidates
↓
aggregateDiffSpanSupport
↓
buildInstabilityRegions
↓
applyBoundaryDiscovery
↓
buildBoundaryCompatibleTopKDiff
```

Local Raw-IME Diff 集成后：

```text
collectDiffSpansFromCandidates
↓
Local Raw-IME Diff Fallback
↓
aggregateDiffSpanSupport
↓
buildInstabilityRegions
↓
applyBoundaryDiscovery
↓
buildBoundaryCompatibleTopKDiff
```

约束：

* 保留 collectDiffSpansFromCandidates 调用
* 保留 alignFailedCount diagnostics
* 不跳过整句 diff
* 不关闭 4D

---

## 1.2 激活条件

禁止：

```typescript
alignFailedCount > 0
```

即激活 fallback。

必须：

```typescript
const evaluatedCount =
  Math.min(config.topK, candidates.length);

const localActivated =
  evaluatedCount > 0 &&
  alignFailedCount === evaluatedCount;
```

说明：

```text
全部失败
↓
使用 local fallback

部分成功
↓
继续使用 existingDiffSpans
```

---

## 1.3 替换而非追加

允许：

```text
existingDiffSpans
↓
替换为
localRawImeDiffSpans
```

禁止：

```text
existingDiffSpans
+
localRawImeDiffSpans
```

原因：

审计已确认 d002 存在：

```text
追加
↓
Normalizer merge
↓
Span 数退化
```

风险。

---

# 二、d001 验收口径修正

## 2.1 蓝美马分

V1.0 不要求：

```text
蓝美马分
```

必须作为独立 span 出现。

允许：

```text
有蓝美马分
```

或：

```text
覆盖蓝美马分音节区间的合并 span
```

通过。

---

## 2.2 必验指标

Proposal 层：

```text
localRawImeDiffSpanCount ≥ 2
diffSpanCount ≥ 2
```

包含：

```text
钟贝
```

相关 span。

---

## 2.3 非必验指标

单测阶段：

```text
selectedSpanCount > 0
```

不是 Proposal 唯一验收标准。

因为：

```text
selectedSpanCount
```

仍依赖：

```text
Normalizer
SpanSelector
neighbor probe
```

---

# 三、LocalRawImeDiffInput 修正

推荐结构：

```typescript
type LocalRawImeDiffInput = {
  rawAsrText: string;
  candidates: PinyinImeV2Candidate[];
  alignmentScores: BoundaryAlignmentScore[];
};
```

说明：

* trustedTopK 在 builder 内部计算
* charRanges 在 builder 内部生成
* 禁止 Proposal 外部传入不同实例

---

# 四、比较与过滤规则

## 4.1 比较函数

必须：

```typescript
normalizeTraditionalChinese()
```

禁止：

```typescript
normalizeForImeAlignment()
```

原因：

后者会处理空格、标点，
可能改变 rawSlice 语义。

---

## 4.2 过滤常量

统一引用：

```typescript
DEFAULT_PINYIN_IME_V2
```

参数：

```typescript
minSpanChars = 2
maxSpanChars = 6

minSyllables = 2
maxSyllables = 5
```

禁止硬编码。

---

## 4.3 双重音节过滤

同时满足：

```typescript
intervalSyllables
```

和：

```typescript
textToSyllables(rawSlice)
```

均落在：

```text
[2,5]
```

范围内。

---

## 4.4 CJK 约束

必须全部满足：

```typescript
/[\u4e00-\u9fff\u3400-\u4dbf]/
```

映射失败：

```text
skip
```

---

# 五、DiffSpan 填充规则

保持：

```typescript
PinyinImeV2DiffSpan
```

不新增运行时类型。

字段：

```typescript
rawSpan
start
end
candidateRank
supportCount
```

规则：

```typescript
candidateRank
=
最小贡献 rank
```

```typescript
supportCount
=
distinct trusted ranks
```

---

# 六、Boundary Discovery 约束

Local diff 生成后：

```text
applyBoundaryDiscovery
```

仍继续运行。

新增单测：

```text
钟贝
```

经过：

```text
snapSpanToSyllableBoundaries
```

后仍覆盖目标区。

---

# 七、允许修改文件

允许：

```text
pinyin-ime-v2-local-raw-ime-diff.ts
pinyin-ime-v2-local-raw-ime-diff.test.ts
run-pinyin-ime-v2-span-proposal.ts
run-pinyin-ime-v2-span-proposal.test.ts
pinyin-ime-v2-types.ts
pinyin-ime-v2-diagnostics.ts
index.ts（可选）
pinyin-ime-v2-freeze-contract.test.ts
```

默认不修改：

```text
resolve-pinyin-ime-v2-spans.ts
fw-detector/types.ts
```

禁止修改：

```text
Normalizer
SpanSelector
Recall
Tone
KenLM
Apply
Decoder
IME TopK
PrimaryDomain
Domain Recall
```

---

# 八、Diagnostics 补充

新增：

```typescript
localRawImeDiffActivated
localRawImeDiffSpanCount
localRawImeDiffCandidateCount
localRawImeDiffTrustedCandidateCount
localRawImeDiffDroppedCount
localRawImeDiffSingleCharCount
localRawImeDiffExampleSpans
```

---

## ExampleSpan

```typescript
type LocalRawImeDiffExampleSpan = {
  rawSlice:string;
  imeWord:string;
  syllableStart:number;
  syllableEnd:number;
  rawStart:number;
  rawEnd:number;
  source:'local_raw_ime_diff';
};
```

仅允许存在于：

```text
Proposal diagnostics
```

禁止进入：

```text
DiffSpan
FwSpan
Recall
Tone
KenLM
Apply
```

---

# 九、TrustedTopK 约束

复用：

```typescript
selectTrustedTopKCandidates()
```

规则：

```text
compatibilityScore >= 0.5
tokens.length > 0
```

---

V1.0：

```text
trustedCount >= 1
```

即可参与。

禁止新增：

```text
trustedCount >= 2
```

硬门控。

---

# 十、测试补充

新增：

| 编号  | 内容                   |
| --- | -------------------- |
| T1  | LocalRawImeDiff 单元测试 |
| T2  | d001 集成测试            |
| T3  | 钟贝→中杯                |
| T4  | 蓝美马分区域覆盖             |
| T5  | alignFailed 门控       |
| T6  | d003 不退化             |
| T7  | imeWord 隔离           |
| T8  | freeze-contract      |
| T9  | 部分 alignFailed       |
| T10 | Boundary snap        |
| T11 | trusted=0            |
| T12 | dialog_200 batch     |

---

# 十一、指标分层

Proposal：

```text
localRawImeDiffSpanCount ≥ 2
diffSpanCount ≥ 2
```

Normalizer：

```text
normalizedSpanCount ≥ 2
```

Batch：

```text
fw_triggered
106 → 121~131
```

预估。

---

Contract：

```text
200/200
```

独立验收。

---

Apply：

```text
不要求 >0
```

---

# 十二、开发前最终 Checklist

## 文档

* [ ] 插入位置写明
* [ ] 激活条件写明
* [ ] 替换非追加写明
* [ ] 蓝美马分验收口径修正
* [ ] Diagnostics 补齐

## 实现

* [ ] normalizeTraditionalChinese
* [ ] DEFAULT_PINYIN_IME_V2
* [ ] interval + rawSlice 双 gate
* [ ] interval dedupe
* [ ] supportCount distinct rank
* [ ] local 替换 existingDiffSpans

## 测试

* [ ] T1-T12
* [ ] freeze-contract
* [ ] dialog_200 batch

## 禁止项

* [ ] Normalizer git diff 为空
* [ ] SpanSelector git diff 为空
* [ ] Recall git diff 为空
* [ ] Tone git diff 为空
* [ ] KenLM git diff 为空
* [ ] Apply git diff 为空
* [ ] imeWord 未进入 replacement pipeline

---

# 结论

Local Raw-IME Diff Proposal 方案方向正确。

在补齐：

```text
插入点
激活条件
替换策略
Diagnostics
测试矩阵
```

后可进入开发。

本阶段仅解决：

```text
Proposal 发现 span
```

问题。

不处理：

```text
Domain Weak Recall
KenLM Apply
PrimaryDomain
```

相关任务。
