# Tone V2 Phase 1 — Contract Freeze & Loader Foundation Development Plan

> **归档说明（2026-06-29）：** Phase 1 已 CLOSED。文中「Backend Registry / Model Registry」为 Phase 1 阶段**明确不做**或历史展望；Phase 2 Foundation 已冻结为 Single Service / Single Model — 见 [TONE_V2_CONTRACT_FREEZE.md](./TONE_V2_CONTRACT_FREEZE.md)。

## 文档性质

Phase 1 开发方案（冻结架构版）

本阶段目标：

完成 Tone V2 的 Contract Freeze，并建立 Loader Foundation。

本阶段：

不是模型训练。

不是模型选型。

不是 CRNN。

不是 Backend Registry 完整实现。

不是 Runtime 重构。

---

# 一、设计目标

本阶段目标只有两个：

## Goal A

冻结：

Tone Runtime Contract。

保证：

以后：

模型、

Backend、

Feature、

Loader

全部：

不能改变：

Runtime。

---

## Goal B

建立：

Loader Foundation。

保证：

以后：

模型可以替换。

Runtime：

保持：

完全一致。

---

# 二、Frozen Architecture

Runtime：

保持：

```text
FW Worker
↓

run_tone_inference()

↓

UtteranceResponse.tone

↓

ASRResult.tone

↓

ctx.acousticToneSlices

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

任何：

Tone Pipeline。

不得：

改变：

任何：

Hop。

---

# 三、设计约束

## Runtime

KEEP

不得修改：

任何：

Runtime 顺序。

---

## Decision

KEEP

Tone：

仍然：

只是：

Posterior Provider。

最终：

Decision：

仍属于：

Recall

↓

Ranking

↓

Assembly

↓

KenLM

↓

Apply

---

## Assembly

DELETE

本阶段：

明确：

删除：

Assembly Tone Guard。

理由：

当前：

Tone：

已经：

在：

Recall

↓

Ranking

生效。

Assembly：

再次：

Decision：

属于：

第二：

Decision Point。

违反：

Frozen Architecture。

---

## KenLM

KEEP

不得：

新增：

Tone。

---

## Apply

KEEP

不得：

新增：

Tone。

---

# 四、Contract Freeze

本阶段：

正式冻结：

## Runtime Contract

包括：

```text
run_tone_inference()

UtteranceResponse.tone

ASRResult.tone

ctx.acousticToneSlices
```

---

## Data Contract

冻结：

```text
TonePosterior

AcousticToneSlice

UtteranceAcousticTonePayload
```

冻结：

Required 字段。

Implementation：

允许：

修改。

---

## Ownership Contract

冻结：

FW：

负责：

Posterior。

Recall：

负责：

Decision。

Assembly：

负责：

Sentence。

KenLM：

负责：

Language。

Apply：

负责：

Replace。

不得：

重复：

Owner。

---

## Feature Contract

冻结：

Feature：

输出。

例如：

Mel：

Feature：

Window：

Sample Rate。

Backend：

不得：

改变：

Feature Output。

---

## Backend Boundary Contract

冻结：

Backend：

允许：

决定：

Inference。

不得：

决定：

Runtime。

不得：

决定：

Schema。

不得：

决定：

Decision。

---

## Diagnostics Contract

冻结：

长期：

保留：

字段。

例如：

```text
toneEnabled

skippedReason

toneInferenceMs

toneConfidenceAvg
```

Optional：

保持：

Optional。

---

# 五、Loader Foundation

注意：

不是：

完整：

Loader。

仅建立：

Loader Foundation。

---

## Loader Contract

新增：

Loader Interface。

例如：

```text
Load()

Unload()

Ready()

Metadata()

Backend()
```

---

## Metadata Contract

本阶段：

建立：

Metadata：

结构。

例如：

```text
modelVersion

backend

featureVersion

formatVersion

modelHash
```

注意：

当前：

只是：

Contract。

不是：

Runtime Required。

---

## Fail Closed

KEEP

模型：

缺失：

↓

ready=false

↓

toneEnabled=false

↓

skippedReason=model_error

不得：

Fallback。

---

# 六、接口

输入：

```text
NPZ

Metadata

Backend
```

输出：

```text
TonePosterior

AcousticToneSlice
```

不得：

新增：

HTTP 字段。

不得：

新增：

Node 字段。

---

# 七、代码逻辑

Loader：

负责：

```text
Model

↓

Metadata

↓

Validation

↓

Ready
```

Inference：

继续：

负责：

Posterior。

不得：

重新：

设计：

Inference。

---

# 八、数据结构

Freeze：

```text
TonePosterior

AcousticToneSlice

UtteranceAcousticTonePayload
```

Metadata：

新增：

Contract：

但：

暂时：

Optional。

---

# 九、Diagnostics / Trace

保持：

现有：

Trace。

新增：

Optional：

```text
backend

modelVersion

featureVersion

modelHash
```

不得：

进入：

Decision。

---

# 十、Target List

必须完成：

* Runtime Contract Freeze
* Data Contract Freeze
* Ownership Contract Freeze
* Backend Boundary Freeze
* Diagnostics Freeze
* Loader Foundation
* Metadata Contract
* Loader Interface
* Fail Closed 保持
* 删除 Assembly Tone Guard
* 文档同步

不得：

开发：

CRNN。

不得：

开发：

Model Registry。

不得：

开发：

Training。

不得：

新增：

Runtime。

---

# 十一、Check List

开发完成后：

确认：

* Runtime 未改变
* Decision 未改变
* Tone Position 未改变
* HTTP Schema 未改变
* Node Schema 未改变
* Required 字段未改变
* Fail Closed 未改变
* Queue Recovery 未改变
* Shadow 不存在
* **Historical Issue:** 独立 Smoke 路径不存在（现行用四级验收体系）
* Offline 不存在

---

# 十二、Regression List

必须重跑：

* freeze-contract.test.ts
* tone-match-score.test.ts
* test_classifier_fail_closed
* audit_runtime_acceptance --part all
* dialog_200
* d001 probe
* FW readiness tests

不得：

新增：

第二套：

Benchmark。

---

# 十三、Acceptance Criteria

必须满足：

Runtime：

200/200。

Tone：

Fail Closed。

Tone：

Posterior：

正常。

Recall：

Tone：

仍然：

Effective。

Assembly：

没有：

Tone Decision。

KenLM：

没有：

Tone。

Apply：

没有：

Tone。

---

# 十四、Architecture Compliance Criteria

确认：

Runtime：

仍然：

```text
FW Worker
↓

Tone

↓

HTTP

↓

Node

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

不存在：

第二：

Pipeline。

不存在：

第二：

Runtime。

不存在：

第二：

Decision。

不存在：

Shadow。

不存在：

**Historical Issue：** 独立验收旁路不存在（现行用四级验收体系 · 见 TONE_V2_TERMINOLOGY.md）。

不存在：

Offline。

---

# 十五、KEEP / MODIFY / RESTORE / DELETE

## KEEP

* Runtime Contract
* Data Contract
* Ownership Contract
* Feature Boundary
* Backend Boundary
* Fail Closed
* Queue Recovery
* Recall Tone
* Ranking Tone
* Diagnostics

## MODIFY

* Loader Foundation
* Metadata Contract
* 文档同步

## RESTORE

无。

## DELETE

* Assembly Tone Guard
* toneGuard 文档承诺
* 任何第二 Tone Decision
* 任何 Shadow Runtime
* 任何 Offline Runtime
* 任何 Bootstrap

---

# 十六、Frozen Architecture Verification

必须确认：

Tone：

真正：

参与：

Recall。

而不是：

仅：

存在。

---

# 十七、Semantic Acceptance

必须验证：

禁用：

Tone：

Recall：

退化。

启用：

Tone：

Recall：

恢复。

证明：

Tone：

真正：

Effective。

---

# 十八、Contract Verification

验证：

所有：

Contract：

未变化。

Implementation：

允许：

变化。

---

# 十九、Regression Gate

只有：

全部：

Regression：

PASS。

才能：

进入：

Phase 2。

---

# 最终目标

Phase 1 完成后：

形成：

唯一：

Tone Runtime。

唯一：

Tone Contract。

唯一：

Loader Foundation。

后续：

Backend、

模型、

训练、

全部：

只能：

遵守：

本 Contract。

不得：

重新：

设计：

Runtime。
