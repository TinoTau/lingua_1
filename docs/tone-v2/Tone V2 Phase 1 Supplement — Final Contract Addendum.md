# Tone V2 Phase 1 Supplement — Final Contract Addendum

## 文档性质

本文件补充《Tone V2 Phase 1 Development Plan Supplement》。

目的：

补齐第二轮审计仍发现的 Contract、Runtime Boundary、Acceptance 与 Regression 约束。

本文件不新增任何业务功能。

不得改变 Frozen Architecture。

不得新增 Pipeline。

不得新增 Runtime。

---

# 1. Diagnostics Contract 补充

## 1.1 skippedReason 与 toneReason

必须区分：

### HTTP skippedReason

表示：

```text
整个 Tone 推理没有执行成功
```

允许值：

```text
no_audio
no_timestamps
non_zh
model_error
```

属于：

```text
Utterance 级状态
```

---

### toneReason

表示：

```text
某个 Recall Candidate 的 Tone 匹配原因
```

允许值（SSOT：`tone-match-score.ts` · `docs/tone-module/ARCHITECTURE.md` §4）：

```text
match
mismatch
no_pattern
```

属于：

```text
Window Candidate（Recall / Ranking 打分结果）
```

**不得与 `toneLookupStage` 混淆。** SQL 阶段 lookup 阶段枚举为：

```text
tone_exact
plain_fallback
plain_only_no_pattern
```

`tone_exact` / `plain_*` 属于 **Recall SQL 观测**，**不是** `toneReason`。

不得作为：

```text
HTTP skippedReason
Node toneSkippedReason
```

两者职责必须永久分离。

---

# 2. Word Timestamp Contract

Tone Runtime 的 Effective 前提：

```text
ASR word_timestamps == true
```

若：

```text
word_timestamps 不存在
```

必须：

```text
toneEnabled=false
skippedReason=no_timestamps
```

不得：

* 自动推断时间轴；
* 等分时间；
* 文本估算时间；
* Fake Timestamp。

Word Timestamp 属 Runtime Required。

---

# 3. Slice Contract

Tone Slice 必须来自：

```text
Audio
↓

Word Timestamp
↓

Acoustic Slice
```

不得来自：

```text
Dedup 后文本
Token
LLM
SQL
```

任何：

```text
TonePosterior
AcousticToneSlice
```

必须保持：

Acoustic Origin。

---

# 4. Multi-Batch Contract

多 Batch Runtime：

必须：

```text
normalizeAcousticSlices()

↓

offsetAcousticSlices()

↓

ctx.acousticToneSlices
```

形成：

全局时间轴。

禁止：

每个 Batch 独立时间。

禁止：

重新编号。

禁止：

丢失 Offset。

---

# 5. Feature Compatibility Contract

生产 Feature：

冻结：

```text
sampleRate=16000
featureVersion=p0-v1
```

非：

16000Hz

允许：

Runtime Defensive Resample。

但：

不得：

改变：

featureVersion。

不得：

作为：

Feature Upgrade。

---

# 6. Loader Metadata Contract

Metadata：

允许：

缺失：

```text
featureVersion
```

若缺失：

统一：

解释为：

```text
p0-v1
```

同时：

Diagnostics：

增加：

```text
metadataWarning=featureVersion_missing
```

不得：

silent upgrade。

不得：

自动 bump。

---

# 7. Loader Error Contract

Loader：

内部：

```text
load_error
```

必须：

映射：

```text
diagnostics.toneModule.loadError
```

不得：

进入：

HTTP Required Schema。

不得：

进入：

Recall。

不得：

进入：

Ranking。

---

# 8. Contract Freeze Deliverable

Phase 1 必须产生：

唯一：

Contract Freeze 文档。

例如：

```text
TONE_V2_CONTRACT_FREEZE.md
```

或：

扩展：

```text
tone-module/ARCHITECTURE.md
```

不得：

多个：

Freeze SSOT。

---

# 9. Semantic Acceptance 补充

除了：

Penalty 数学正确。

还必须验证：

反事实：

```text
toneTimestampOnlyEnabled=true

↓

Tone Effective
```

与：

```text
toneTimestampOnlyEnabled=false

↓

Tone Disabled
```

证明：

Tone：

真正：

参与：

Recall。

而不是：

仅存在：

Runtime。

---

# 10. Regression Contract

Regression：

必须区分：

## FW Runtime

验证：

```text
run_tone_inference

↓

UtteranceResponse
```

## Node E2E

验证：

```text
ctx.acousticToneSlices

↓

Recall

↓

Ranking
```

不得：

FW Runtime：

代替：

Node E2E。

---

# 11. Phase 1 Completion Gate

Phase 1 完成必须同时满足：

## Runtime

* Runtime Hop 未改变；
* Required Schema 未改变；
* Tone 仍为 Posterior Provider。

## Contract

* Contract Freeze 文档完成；
* Loader Foundation 完成；
* Metadata Contract 完成。

## Cleanup

* Assembly Tone Guard 删除；
* Orphan Filter 删除；
* toneGuardBlockedCount 删除；
* Tone Guard 文档删除；
* Alias 删除。

## Tests

* GATE-RANK-02 修正；
* GATE-RANK-04 改为负向验证；
* Semantic Acceptance 反事实通过；
* dialog_200 全量通过；
* FW Readiness 通过。

---

# 12. Final Architecture Constraint

任何后续开发：

包括：

Backend

Model

Training

Registry

Feature

Inference

只能：

改变：

Implementation。

不得：

改变：

```text
FW Worker
↓

run_tone_inference

↓

TonePosterior

↓

AcousticToneSlice

↓

Recall

↓

Ranking

↓

Assembly

↓

KenLM

↓

Apply
```

不得：

新增：

第二 Runtime。

第二 Decision。

第二 Tone Pipeline。

第二 Tone Output。

任何违反上述约束的实现，即使功能正确，也必须判定为：

```text
Architecture Drift
```
