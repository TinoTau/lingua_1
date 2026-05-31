# P3.3 FW Metadata Span Gate 开发方案（FW-only）

基于开发前只读审计报告整理。

## 核心目标

用 Faster-Whisper 原生 metadata 取代：

- Legacy Detector
- KenLM Span Gate（已否决）

形成：

ASR Metadata
→ Metadata Span Gate
→ Lexicon Runtime V2 Recall
→ KenLM Weak Veto
→ Apply

---

## 架构

### 当前

ASR
→ Legacy Detector
→ Recall
→ KenLM
→ Apply

### 新方案

ASR
→ FW Metadata Span Gate
→ Recall
→ KenLM Weak Veto
→ Apply

---

## Python 服务改造

开启：

```python
word_timestamps=True
```

返回：

- words
- probability
- avg_logprob
- compression_ratio
- no_speech_prob

---

## Node 数据结构

```ts
interface AsrWordInfo {
  word: string;
  start?: number;
  end?: number;
  probability?: number;
}
```

```ts
interface SegmentInfo {
  text: string;
  start?: number;
  end?: number;
  no_speech_prob?: number;
  avg_logprob?: number;
  compression_ratio?: number;
  words?: AsrWordInfo[];
}
```

---

## Metadata Span Gate

新增：

```text
fw-metadata-span-gate.ts
```

输入：

```ts
{
  text,
  segments,
  maxSpans
}
```

输出：

```ts
{
  spans,
  diagnostics
}
```

---

## Span 来源

优先级：

1. alias_exact_hit
2. low_word_probability
3. low_segment_avg_logprob
4. high_compression_ratio（辅助）
5. high_no_speech_prob（辅助）

---

## 配置

```json
{
  "spanGateMode": "fw_metadata_gate",
  "maxSpans": 2,
  "wordProbabilityThreshold": 0.65,
  "segmentAvgLogprobThreshold": -1.0
}
```

---

## Target List

### P0

- Python word_timestamps
- SegmentInfo 扩展
- WordInfo 扩展
- fw-metadata-span-gate.ts
- orchestrator 接入
- alias exact hit
- low probability gate

### P1

- Metadata Mapping Test
- Span Selection Test
- Alias Test
- dialog_200 回归

### P2

- Threshold 调参
- Cafe Case 验证
- 性能验证

---

## Check List

- 不修改 CTC
- 不修改 Recover
- 不修改主链顺序
- 不修改 KenLM weak_veto
- 不允许 Lexicon 反推 Span
- span/job ≤ 2
- FW degrade = 0
- CER ≤ Phase2
- Recall 降低 ≥80%
- 无 KenLM Gate 固定开销

开发依据审计报告：
\uE200filecite\uE202turn20file0\uE201
