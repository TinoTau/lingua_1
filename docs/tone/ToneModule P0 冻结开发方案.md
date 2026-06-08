# ToneModule P0 冻结开发方案

版本：P0 Freeze
日期：2026-06-03

---

# 一、项目目标

新增：

```text
ToneModule
```

用于：

```text
音频级普通话音调识别
```

而不是：

```text
文本反查音调
```

---

目标：

利用：

```text
FW Word Timestamp
+
原始音频
```

获得：

```text
每个字的声调概率
```

用于：

```text
Recall Candidate Ranking
```

---

不用于：

```text
直接替换文本

直接修改 Span

直接修改 KenLM

直接 Apply
```

---

# 二、设计原则

## 原则1

Tone 必须来自：

```text
音频
```

禁止：

```text
汉字
↓
Pinyin
↓
Tone
```

---

## 原则2

ToneModule 独立存在。

不修改：

```text
IME
HintGate
ApprovedSpan
```

---

## 原则3

Tone 只是：

```text
Ranking Signal
```

不是：

```text
Hard Filter
```

---

## 原则4

Tone 不参与：

```text
Span Discovery
```

---

## 原则5

主链保持：

```text
rawAsrText
↓
IME
↓
HintGate
↓
Recall
↓
ToneModule
↓
Candidate Builder
↓
KenLM
↓
Apply
```

---

# 三、部署位置

推荐：

```text
electron_node/services/faster_whisper_vad/
```

原因：

FW 已经拥有：

```text
audio

segment timestamp

word timestamp
```

---

避免：

```text
重复传输音频

重复对齐
```

---

# 四、架构

## 当前

```text
FW Worker

↓

text

segments

words
```

---

## 新增

```text
FW Worker

↓

ToneModule

↓

text

segments

words

toneTokens
```

---

# 五、数据结构

## ToneToken

```ts
export interface ToneToken {
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

## FW Segment

新增：

```ts
toneTokens?: ToneToken[];
```

---

示例：

```json
{
  "token":"少",
  "start":1.58,
  "end":1.74,

  "tonePosterior":{
    "t1":0.02,
    "t2":0.05,
    "t3":0.89,
    "t4":0.03,
    "t5":0.01
  },

  "confidence":0.89
}
```

---

# 六、FW 接口

## 当前

```json
{
  "text":"少病",
  "segments":[]
}
```

---

## 新增

```json
{
  "text":"少病",

  "segments":[
    {
      "text":"少病",

      "words":[
        {
          "word":"少",
          "start":1.58,
          "end":1.74
        }
      ],

      "toneTokens":[]
    }
  ]
}
```

---

保持兼容。

禁止修改：

```text
text

segments

words
```

已有字段。

---

# 七、Tone Model

## P0

推荐：

```text
Small CNN
```

---

输入：

```text
80 Mel Features
```

---

输出：

```text
5-class

1声
2声
3声
4声
轻声
```

---

要求：

```text
CPU

离线

<5MB
```

---

禁止：

```text
LLM

GPU

第二套ASR
```

---

# 八、推理流程

## Step1

获取：

```text
word timestamp
```

---

例如：

```text
少

1.58
↓

1.74
```

---

## Step2

切音频：

```text
audio[1.58~1.74]
```

---

## Step3

提取：

```text
Mel Spectrogram
```

---

## Step4

Tone Classifier

输出：

```text
tonePosterior
```

---

## Step5

写入：

```text
toneTokens
```

---

# 九、Recall 集成

新增：

```ts
candidateTonePattern
```

---

例如：

```text
少冰

3 1
```

---

```text
烧饼

1 3
```

---

```text
哨兵

4 1
```

---

## Tone Score

```ts
toneMatchScore
```

---

只参与：

```text
Candidate Ranking
```

---

禁止：

```text
直接过滤
```

---

# 十、Builder 集成

允许：

```ts
candidateScore +=
toneMatchScore
```

---

禁止：

```text
改变组合数量
```

---

禁止：

```text
改变 TopK
```

---

禁止：

```text
改变 KenLM Query Count
```

---

# 十一、Diagnostics

新增：

```ts
toneEnabled
```

---

```ts
toneTokenCount
```

---

```ts
toneConfidenceAvg
```

---

```ts
candidateToneScore
```

---

```ts
toneRankingDelta
```

---

# 十二、Target List

## FW

* [ ] ToneModule
* [ ] toneTokens
* [ ] ToneToken DTO

---

## Audio

* [ ] Audio Slice
* [ ] Mel Feature

---

## Model

* [ ] Tone CNN
* [ ] 5-class Output

---

## Recall

* [ ] Tone Score

---

## Diagnostics

* [ ] Tone Metrics

---

# 十三、Check List

## 架构

* [ ] 不修改 IME
* [ ] 不修改 HintGate
* [ ] 不修改 ApprovedSpan
* [ ] 不修改 Apply

---

## 性能

* [ ] 单句 <20ms
* [ ] CPU可运行
* [ ] 无GPU依赖

---

## 功能

* [ ] toneToken 可输出
* [ ] tonePosterior 可输出
* [ ] Tone Ranking 生效

---

## 安全

* [ ] 无音频时自动降级
* [ ] 无 timestamp 时自动降级
* [ ] 非中文自动关闭

---

# 十四、P0 验收

必须完成：

```text
少病
↓
少冰
烧饼
哨兵
```

输出：

```text
Tone Score
```

---

以及：

```text
评审
平身

上线
上限

检查
检察
```

输出：

```text
Tone Score
```

---

验证：

```text
Tone 是否提供额外区分度
```

---

# 十五、冻结边界

明确不做：

## ToneDistance

删除。

---

## Text Tone

删除。

---

## Pinyin Tone

删除。

---

## Forced Alignment

不做。

---

## 第二套 ASR

不做。

---

## Session Topic

不做。

---

## CPU LLM

不参与 Tone 判断。

---

# 十六、最终目标

ToneModule 负责：

```text
提供声学约束
```

---

Recall 负责：

```text
生成候选
```

---

KenLM 负责：

```text
句子排序
```

---

三者职责严格分离。
