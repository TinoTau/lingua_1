# P3.3 FW Metadata Span Gate 补充冻结方案 V1.1

日期：2026-05-30

依据：
- P3.3 开发方案
- FW Metadata Span Gate 审计报告
- P3.3 补充清单

---

# 一、执行摘要

本补充文档用于修正原 P3.3 开发方案中遗漏的实现细节。

重点补充：

1. 三向 Span Gate 模式解析
2. KenLM Scorer 创建条件修正
3. Metadata SSOT 约束
4. Python Dedup Metadata 保留策略
5. Alias Exact Hit 实现边界
6. FwSpanDiagnostics 映射规范
7. P0 遗漏文件清单
8. Freeze Contract 要求
9. 批测配置冻结
10. 验收指标冻结

---

# 二、冻结架构

最终架构：

ASR Metadata
→ FW Metadata Span Gate
→ Lexicon Runtime V2 Recall
→ KenLM Weak Veto
→ Apply

禁止：

- KenLM 全句找 Span
- Lexicon 反推 Span
- Topic Keywords 参与 Span 选择
- CTC 使用 Metadata Gate
- Recover 使用 Metadata Gate

---

# 三、Span Gate 模式

必须支持：

```ts
type FwSpanGateMode =
  | "legacy_detector"
  | "kenlm_gate_filter"
  | "fw_metadata_gate";
```

执行顺序：

```text
fw_metadata_gate
↓
kenlm_gate_filter
↓
legacy_detector
```

默认：

```json
{
  "spanGateMode": "fw_metadata_gate"
}
```

---

# 四、KenLM Scorer 约束

Metadata Gate 禁止创建 Span 阶段 KenLM。

允许：

```text
KenLM Weak Veto
```

禁止：

```text
KenLM Span Detection
```

修正：

```ts
const kenlmScorer =
  enableKenLMGate
    ? createKenlmBatchScorer()
    : null;
```

不得再使用：

```ts
enableKenLMGate || spanGateActive
```

---

# 五、SSOT 约束

Metadata Gate 输入来源：

```ts
ctx.rawAsrText

ctx.asrSegments
??
ctx.asrResult?.segments
```

禁止：

```ts
ctx.segmentForJobResult
```

原因：

```text
segmentForJobResult
属于 FW 输出链路
不是输入链路
```

---

# 六、Python Metadata 约束

必须开启：

```python
word_timestamps=True
```

新增输出：

```text
words
avg_logprob
compression_ratio
no_speech_prob
```

---

# 七、Dedup 阻塞项

当前问题：

```text
update_segments_after_deduplication()

重建 segments

导致 metadata 丢失
```

必须先定案。

推荐方案：

```text
Dedup 后重新对齐 words
```

允许备用：

```text
保留 avg_logprob
丢弃 words
```

禁止：

```text
静默丢弃 metadata
```

---

# 八、Alias Exact Hit

禁止：

```text
扫描 Base Lexicon
```

允许：

```text
Alias Key Scan
```

来源：

```text
alias-index.ts
```

禁止依赖：

```text
confusions.jsonl
```

原因：

```text
当前为空文件
```

---

# 九、FwSpanDiagnostics 映射

统一：

```ts
{
  text,
  start,
  end,

  domain: "general",

  riskScore,

  signals,

  candidates: [],

  applied: false
}
```

禁止新增：

```ts
source
```

---

# 十、新增 Signal

必须新增：

```ts
alias_exact_hit

low_word_probability

low_segment_avg_logprob
```

可选新增：

```ts
high_compression_ratio
```

复用：

```ts
low_no_speech_prob
```

禁止：

```ts
detector_pinyin_hint
```

出现在 Metadata Gate 路径。

---

# 十一、Fallback Legacy

允许：

```json
{
  "allowSegmentFallbackScan": true,
  "fallbackLegacyMaxSpans": 1
}
```

触发条件：

```text
无 words
或
alignment failed
且
avg_logprob 低
```

限制：

```text
maxSpans=1
```

---

# 十二、Node 数据结构补充

同步修改：

```text
task-router/types.ts

faster-whisper-asr-strategy.ts

inference-service.ts

aggregator-middleware.ts
```

所有新增字段：

```text
optional
```

保持兼容。

---

# 十三、P0 遗漏文件

必须补充：

```text
fw-config.ts

fw-detector/types.ts

node-config-types.ts

node-config-defaults.ts

fw-detector-orchestrator.ts

map-fw-metadata-span.ts

lexicon-runtime.ts

result_listener.py

text_processing.py

fw-metadata-span-gate.test.ts

phase3-p33-batch.js

analyze-phase3-p33-audit.mjs
```

---

# 十四、Freeze Contract

必须通过：

```text
freeze-contract.test.ts

fw-detector-gate.mjs
```

要求：

```text
Metadata Gate

不得 import

Lexicon Recall
```

Span 负责找位置。

Recall 负责找候选。

---

# 十五、批测配置冻结

必须固定：

```json
{
  "spanGateMode": "fw_metadata_gate",
  "kenlmSpanGate": {
    "enabled": false
  },
  "useLexiconRuntimeV2Recall": true,
  "useIndustryRouting": false,
  "maxBaseCandidates": 2,
  "maxDomainCandidates": 3,
  "maxIdiomCandidates": 0
}
```

---

# 十六、验收标准

全部满足：

```text
dialog_200 PASS

span/job ≤ 2

FW apply > 0

FW degrade = 0

CER ≤ 35.93%

Recall 调用下降 ≥80%

KenLM Span Query = 0

无 12s Gate 开销

CTC Tests PASS
```

---

# 十七、Target List

P0

- Python Metadata 输出
- Dedup Metadata 保留
- Metadata Gate 实现
- Alias Exact Hit
- Orchestrator 三分支
- Diagnostics
- Config 接入

P1

- Metadata Mapping Test
- Alignment Test
- Alias Test
- Fallback Test
- dialog_200 回归

P2

- Threshold 调参
- Cafe Case
- 中杯 Case
- 性能验证

---

# 十八、最终冻结结论

P3.3 不再尝试：

```text
KenLM 找 Span
```

正式切换为：

```text
FW Metadata 找 Span
Lexicon 找候选
KenLM 做 Veto
```

这是当前仓库最符合性能、质量和维护性的实现路径。
