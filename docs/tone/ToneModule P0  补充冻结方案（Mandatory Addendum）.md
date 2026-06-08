# ToneModule P0

补充冻结方案（Mandatory Addendum）

版本：P0 Supplement Freeze
日期：2026-06-03

---

# 一、文档优先级

本文档优先级：

```text
ToneModule P0 Supplement
>
ToneModule P0 Freeze
```

如发生冲突：

以本文档为准。

---

# 二、Tone 推理位置冻结

必须冻结：

```text
Tone 推理
仅允许发生在

FW Worker
```

---

允许：

```text
processed_audio
↓
Tone CNN
↓
toneTokens
```

---

禁止：

```text
Node
↓
ctx.audio
↓
Tone CNN
```

---

原因：

FW timestamp 对应：

```text
processed_audio
```

不是：

```text
ctx.audio
```

直接切片将产生错位。

---

# 三、两阶段架构冻结

ToneModule 分为：

## Phase A

FW Worker

负责：

```text
audio
↓
toneTokens
```

---

输出：

```ts
ToneToken[]
```

---

## Phase B

Node Pipeline

负责：

```text
toneTokens
↓
toneMatchScore
```

---

禁止：

```text
Node 重跑 Tone CNN
```

---

# 四、ASR Tone 与 Candidate Tone 分离

必须冻结：

```text
ASR Tone

与

Candidate Tone
```

来源不同。

---

## ASR Tone

唯一来源：

```text
toneTokens
```

---

禁止：

```text
textToToneSyllables(span.text)
```

---

## Candidate Tone

来源：

```text
tone_pinyin_key
```

优先。

---

fallback：

```text
candidate.word
↓
pinyin-pro
```

仅用于：

```text
reference
```

---

禁止：

```text
ASR Query Tone
```

使用：

```text
span.text
↓
pinyin-pro
```

---

# 五、删除 Legacy Tone

P0 必须移除：

```text
toneDistance
```

作为排序依据。

---

禁止：

```ts
const asrTone =
textToToneSyllables(span.text);
```

---

禁止：

```ts
sort by toneDistance
```

---

允许：

```text
diagnostics
```

保留。

---

# 六、Dedup 解耦冻结

当前：

```text
Dedup
↓
words = null
```

---

因此：

```text
toneTokens
```

不得依赖：

```text
words
```

长期存在。

---

必须：

```text
Dedup 之前
生成 toneTokens
```

---

推荐：

```ts
UtteranceResponse.toneTokens
```

顶层挂载。

---

禁止：

```text
仅存在 Segment.words
```

---

# 七、Node 数据结构冻结

新增：

```ts
interface UtteranceTonePayload {
  toneEnabled: boolean;

  toneTokens: ToneToken[];

  toneTokenCount: number;

  toneConfidenceAvg?: number;

  skippedReason?:
    | "no_audio"
    | "no_timestamps"
    | "non_zh"
    | "model_error";
}
```

---

挂接：

```ts
ASRResult
```

---

禁止：

```text
修改 text
segments
words
```

语义。

---

# 八、ToneToken 冻结

```ts
interface ToneToken {
  token: string;

  start: number;
  end: number;

  tonePosterior: {
    t1: number;
    t2: number;
    t3: number;
    t4: number;
    t5: number;
  };

  confidence: number;
}
```

---

禁止增加：

```text
domain
intent
topic
```

字段。

---

# 九、Span 映射冻结

ApprovedSpan

通过：

```text
字符索引
```

映射：

```text
toneTokens
```

---

禁止：

```text
重新对齐
```

---

禁止：

```text
Forced Alignment
```

---

禁止：

```text
WhisperX
```

---

原因：

FW 已有字级 timestamp。

---

# 十、Tone Score 冻结

Tone 仅作为：

```text
candidateScore
```

附加项。

---

禁止：

```text
Hard Filter
```

---

禁止：

```text
单独排序键
```

---

必须：

```ts
finalCandidateScore =
baseCandidateScore
+
wTone * toneMatchScore
```

---

# 十一、与 Domain P2 共存

若 Domain P2 同时存在：

必须冻结：

```ts
finalCandidateScore =
baseCandidateScore
+
wDomain * sentenceDomainMatchScore
+
wTone * toneMatchScore
```

---

禁止：

```text
多个排序链
```

---

禁止：

```text
tone 覆盖 domain
```

---

禁止：

```text
domain 覆盖 tone
```

---

# 十二、语言范围冻结

P0：

```text
仅支持 zh
```

---

禁止：

```text
粤语
```

---

禁止：

```text
英语
```

---

禁止：

```text
多语言混合
```

---

后续单独评估。

---

# 十三、性能冻结

目标：

```text
整句 Tone 推理
≤ 20ms CPU
```

---

不是：

```text
单字 20ms
```

---

必须：

```text
Batch 推理
```

---

禁止：

```text
逐字模型加载
```

---

# 十四、验收拆分

## Tone Runtime

通过：

```text
toneTokens
存在

tonePosterior
存在

toneMatchScore
存在
```

---

## Tone Ranking

通过：

```text
少冰
烧饼
哨兵
```

产生不同：

```text
toneMatchScore
```

---

## End-to-End

不作为 P0 必达。

---

因为：

```text
Recall

Lexicon

KenLM
```

仍会影响最终结果。

---

# 十五、明确不做

## 不做

```text
ToneDistance
```

---

## 不做

```text
Text Tone Query
```

---

## 不做

```text
Forced Alignment
```

---

## 不做

```text
WhisperX
```

---

## 不做

```text
第二套 ASR
```

---

## 不做

```text
Session Topic
```

---

## 不做

```text
CPU LLM Tone 判断
```

---

## 不做

```text
IME Tone
```

接入。

---

# 十六、Target List

## FW

* [ ] Tone CNN
* [ ] toneTokens
* [ ] UtteranceTonePayload

---

## Pipeline

* [ ] toneMatchScore
* [ ] candidateScore 集成

---

## Cleanup

* [ ] 删除 toneDistance 排序
* [ ] 删除 textToToneSyllables(span.text) Query 路径

---

## Diagnostics

* [ ] tone_inference_ms
* [ ] toneTokenCount
* [ ] toneConfidenceAvg

---

# 十七、Check List

* [ ] Tone 推理仅在 FW Worker
* [ ] Node 不切音频
* [ ] Dedup 不影响 toneTokens
* [ ] Tone 不修改 Span
* [ ] Tone 不修改 IME
* [ ] Tone 不修改 KenLM
* [ ] Tone 不修改 Apply
* [ ] Tone 不引入 Forced Alignment
* [ ] Tone 不引入第二套 ASR
* [ ] Tone Runtime ≤20ms
* [ ] Tone Ranking 可观测
* [ ] Legacy Tone 完全退出主链
