Tone V2 P8 — Feature V2 Foundation Specification

Document Type

Foundation Specification (Frozen)

Project

Lingua Tone V2

Phase

P8 — Feature V2 Foundation

Status

Frozen Design Specification

Authority

Single Source of Truth (SSOT)

1. Purpose

P8 的目标不是训练新的 Tone 模型，而是建立新的 Feature Foundation。

P0 Foundation 已经完成以下目标：

建立 Runtime Tone 主链；
建立 Canonical Dataset；
建立 Training Engineering；
建立 Artifact Contract；
建立 Runtime Contract；
建立 Feature Baseline。

Root Cause Audit 已确认：

P0 Feature Foundation 采用的 Mean-Mel Feature 是符合当时工程目标的设计，并非错误实现。

但随着 Canonical Dataset、Canonical Evaluation 和 Runtime Quality Audit 的完成，P0 Feature Foundation 已经达到能力上限。

因此：

P8 不继续修改 P0 Feature。

P8 建立新的 Feature Foundation。

P0 保持冻结。

2. Scope

P8 仅负责：

Runtime Timestamp Contract
Feature Contract
Feature Extractor
Feature Tensor
Feature Version
Training Timestamp Adapter
Feature Shard V2
Runtime / Training Shared Feature Foundation

P8 不负责：

CNN
CRNN
Conformer
Optimizer
Loss
Epoch
Learning Rate
Dataset Expansion
Runtime Recall
Candidate Ranking
KenLM
Lexicon

上述内容属于后续阶段。

3. Design Objectives

P8 必须满足以下目标。

DO-01

保持 Runtime Mainline 不变。

Feature Foundation 升级不得改变 Runtime Decision Chain。

DO-02

Training 与 Runtime 共用同一个 Feature Extractor。

整个系统只允许存在一个 Feature Extractor。

DO-03

Training 与 Runtime 共用同一个 Feature Contract。

不得分别定义 Runtime Feature Contract 与 Training Feature Contract。

DO-04

Runtime WordInfo 成为唯一 Timestamp Contract。

整个系统不得新增第二 Timestamp Contract。

DO-05

Feature Contract 与 Dataset Foundation 解耦。

Dataset 负责 Ground Truth。

Feature Foundation 负责 Feature。

DO-06

Feature Foundation 应能够支持未来：

CNN
CRNN
Conformer
Transformer

无需再次修改 Feature Contract。

4. Architecture
Runtime
FW
        │
        ▼
WordInfo
        │
        ▼
Feature Extractor
        │
        ▼
Feature Tensor
        │
        ▼
Tone Model
        │
        ▼
Tone Posterior
        │
        ▼
Recall
        │
        ▼
Candidate Ranking
        │
        ▼
Final Candidate
Training
TextGrid
        │
        ▼
SyllableSample
        │
        ▼
WordInfo Adapter
        │
        ▼
WordInfo
        │
        ▼
Feature Extractor
        │
        ▼
Feature Tensor
        │
        ▼
Feature Shard V2
        │
        ▼
Tone Model
Feature Foundation

Feature Foundation 的职责只有：

Audio

+

WordInfo

↓

Feature Tensor

Feature Foundation 不属于：

Dataset
Runtime
Training

Feature Foundation 是独立层。

Training 与 Runtime 都只是消费者。

5. Runtime Timestamp Contract

Runtime Timestamp Contract 定义为：

WordInfo

WordInfo 是整个 Tone V2 的唯一 Timestamp Contract。

Training 不允许重新定义 Timestamp。

Dataset 不允许定义 Runtime Timestamp。

Validation 不允许定义新的 Timestamp。

未来所有 Runtime Boundary Provider 必须输出 WordInfo。

不得新增：

FeatureTimestampRecord
RuntimeTimestampRecord
TrainingTimestampRecord
Timestamp Wrapper

WordInfo 成为 Runtime Timestamp SSOT。

6. Responsibility Boundary
Dataset Foundation

负责：

TextGrid
Ground Truth
Label
Boundary

不得负责：

Feature
Feature Contract
Feature Tensor
Runtime

负责：

Runtime Audio
WordInfo

不得负责：

Feature Definition
Feature Version
Feature Contract
Training

负责：

WordInfo Adapter
Feature Shard Generation
Model Training

不得负责：

Runtime Contract
Feature Contract
Feature Foundation

负责：

Feature Extractor
Feature Version
Feature Contract
Feature Tensor

不得负责：

Dataset
Runtime Logic
Training Logic
Loader
Diagnostics
Model

负责：

消费 Feature Tensor。

不得定义：

Feature。

不得修改：

Feature Contract。

7. Ownership
Component	Owner
TextGrid	Dataset Foundation
SyllableSample	Dataset Foundation
WordInfo	Runtime Contract
Feature Extractor	Feature Foundation
Feature Contract	Feature Foundation
Feature Version	Feature Foundation
Feature Tensor	Feature Foundation
Feature Shard	Training Engineering
Model	Model Layer

Owner 拥有定义权。

Consumer 不允许修改 Contract。

8. Frozen Constraints
FC-01

Runtime Mainline 保持冻结。

不得增加：

Shadow
Compatibility
Registry
Switching
Second Pipeline
FC-02

Runtime Timestamp Contract：

唯一：

WordInfo。

FC-03

整个系统：

只有一个：

Feature Extractor。

FC-04

整个系统：

只有一个：

Feature Contract。

FC-05

整个系统：

只有一个：

Feature Tensor。

FC-06

Dataset Foundation 不拥有 Feature。

FC-07

Training 不拥有 Feature。

FC-08

Runtime 不拥有 Feature。

FC-09

Feature Foundation 不依赖 Dataset Foundation。

FC-10

Feature Foundation 不依赖 Runtime Implementation。

9. Development Principles

P8 开发必须遵循以下原则：

Runtime WordInfo 是唯一 Timestamp Contract。
Feature Foundation 是唯一 Feature Owner。
Training 与 Runtime 共用 Feature Extractor。
Feature Contract 不允许因 Training 或 Runtime 而分叉。
Feature Tensor 不允许存在多个版本同时参与 Runtime。
Runtime Mainline 保持不变。
Dataset 只负责 Ground Truth。
Feature Foundation 只负责 Audio + WordInfo → Feature Tensor。
Model 只消费 Feature Tensor。
后续所有模型升级必须建立在 Feature Foundation 之上，不得重新定义 Runtime Contract。

Part 1 完

# Part 2 — Feature Contract Specification

---

# 10. Runtime Timestamp Contract

Feature Foundation 仅接受 Runtime Timestamp Contract。

Runtime Timestamp Contract 定义如下：

```text
WordInfo
```

WordInfo 是整个 Feature Foundation 的唯一 Timestamp Contract。

Training、Runtime、Validation、Feature Shard、Model 全部围绕 WordInfo 建立。

不得新增任何新的 Timestamp Contract。

---

## 10.1 WordInfo Contract

WordInfo 定义如下：

```typescript
interface WordInfo {

    word: string;

    start: number;

    end: number;

    probability: number;

}
```

其中：

| 字段 | 说明 | Feature 使用 |
|------|------|-------------|
| word | Runtime Token | 否 |
| start | Slice Start | 是 |
| end | Slice End | 是 |
| probability | Runtime Metadata | 否 |

Feature Foundation 只消费：

```text
start

end
```

word 与 probability 属于 Runtime Metadata。

不得进入 Feature Tensor。

不得影响 Feature。

---

## 10.2 Timestamp Semantics

WordInfo 表示：

```text
Audio Timeline

───────────────

start

───────────────

end
```

Feature Foundation 不关心：

- Token 来源
- ASR 来源
- Runtime Provider

Feature Foundation 只关心：

```text
Audio

+

start

+

end
```

---

## 10.3 Timestamp Ownership

WordInfo 属于：

```text
Runtime Contract
```

Feature Foundation：

消费 WordInfo。

Training：

消费 WordInfo。

Validation：

消费 WordInfo。

Model：

不拥有 WordInfo。

Dataset：

不拥有 WordInfo。

---

# 11. Training Timestamp Adapter

Training 不允许直接使用：

```text
TextGrid

↓

Feature
```

Training 必须采用：

```text
TextGrid

↓

SyllableSample

↓

WordInfo Adapter

↓

WordInfo
```

WordInfo Adapter 是：

Training 与 Dataset 的唯一连接点。

---

## 11.1 Adapter Responsibility

WordInfo Adapter：

职责只有：

字段转换。

例如：

```text
SyllableSample

↓

WordInfo
```

除此之外：

全部禁止。

---

Adapter 不允许：

- Feature Extraction
- Audio Processing
- Label Generation
- Feature Normalization
- Runtime Decision
- Diagnostics
- Validation

---

## 11.2 Adapter Output

Adapter 输出：

统一：

WordInfo。

Feature Foundation：

永远：

只认识：

WordInfo。

不得认识：

- TextGrid
- SyllableSample
- Dataset Object

---

## 11.3 Adapter Constraints

Adapter：

不得改变：

Boundary。

不得改变：

Label。

不得改变：

Timestamp。

不得：

重新估计：

Boundary。

Adapter：

只是：

Contract Conversion。

---

# 12. Feature Extractor Contract

Feature Extractor：

属于：

Feature Foundation。

Feature Extractor：

整个系统：

唯一。

Training：

Runtime：

共享。

不得：

分别实现。

---

## 12.1 Extractor Interface

唯一接口：

```text
extract_feature(

audio,

sampleRate,

wordInfo

)
```

输入：

```text
PCM Audio

+

WordInfo
```

输出：

```text
Feature Tensor
```

除此之外：

不得增加：

第二接口。

---

## 12.2 Extractor Responsibility

Feature Extractor：

唯一职责：

```text
Audio

+

WordInfo

↓

Feature Tensor
```

不得负责：

- Runtime
- Dataset
- Training
- Loader
- Artifact
- Diagnostics
- Validation

---

## 12.3 Feature Pipeline

Feature Pipeline：

定义如下：

```text
Audio

↓

Slice

↓

Frame Normalize

↓

Feature Compute

↓

Tensor Assemble

↓

Feature Tensor
```

Feature Pipeline：

不得：

读取：

Dataset。

不得：

读取：

TextGrid。

不得：

读取：

SyllableSample。

---

## 12.4 Audio Slice

Audio Slice：

统一采用：

```text
WordInfo.start

↓

WordInfo.end
```

Feature Foundation：

不得：

重新估计：

Boundary。

不得：

重新 Alignment。

不得：

均分 Token。

不得：

重新切词。

Runtime：

负责：

提供：

WordInfo。

Feature：

负责：

消费：

WordInfo。

---

# 13. Feature Contract

Feature Contract：

定义：

Feature Tensor。

Feature Contract：

由：

Feature Version：

唯一决定。

不得：

由：

Training。

Runtime。

Model。

共同决定。

---

## 13.1 Feature Version

建议：

```text
p1-frame-mel-f0-v1
```

Feature Version：

唯一决定：

- Tensor Shape
- Channel Layout
- Normalization Policy
- Padding Policy
- Interpolation Policy

除此之外：

不得：

决定：

其他内容。

---

## 13.2 Feature Shape

Feature Shape：

```text
64

×

83
```

Rows：

Frame。

Columns：

Channel。

整个系统：

统一。

不得：

Training：

64。

Runtime：

48。

---

## 13.3 Channel Layout

Channel 顺序：

冻结：

```text
0~79

Log Mel

80

Log F0

81

Delta Log F0

82

Voiced Flag
```

不得：

交换：

Channel。

不得：

动态：

Channel。

新增：

Channel。

必须：

升级：

Feature Version。

---

## 13.4 Normalization

Feature Contract：

必须：

统一：

Normalization。

Training：

Runtime：

必须：

完全一致。

不得：

Training：

一种。

Runtime：

一种。

---

## 13.5 Padding Policy

Padding：

属于：

Feature Contract。

不得：

Training：

一种。

Runtime：

一种。

---

## 13.6 Interpolation Policy

Interpolation：

属于：

Feature Contract。

不得：

Training：

Linear。

Runtime：

Spline。

---

## 13.7 Crop Policy

Crop：

属于：

Feature Contract。

不得：

Training：

Center Crop。

Runtime：

Tail Crop。

---

# 14. Feature Tensor

Feature Tensor：

属于：

Feature Foundation。

Training：

消费。

Runtime：

消费。

Model：

消费。

任何消费者：

不得：

修改：

Feature。

---

## 14.1 Feature Tensor Ownership

Owner：

```text
Feature Foundation
```

Consumers：

- Runtime
- Training
- Validation
- Model

不得：

改变：

Tensor Shape。

不得：

改变：

Channel。

不得：

增加：

Feature。

---

## 14.2 Feature Tensor Immutability

Feature Tensor：

生成以后：

不可修改。

不得：

Training：

追加：

Feature。

不得：

Runtime：

追加：

Feature。

不得：

Validation：

追加：

Feature。

---

# 15. Boundary Provider Independence

Boundary Provider：

不是：

Feature Contract。

Boundary Provider：

只是：

Boundary Source。

例如：

Training：

```text
TextGrid
```

Runtime：

```text
FW WordInfo
```

未来：

其他：

ASR：

```text
Runtime WordInfo
```

Feature Foundation：

永远：

只消费：

WordInfo。

不得：

依赖：

Boundary Provider。

---

# 16. Contract Rules

整个 Feature Foundation：

必须满足：

Rule-01

只有一个：

Timestamp Contract。

---

Rule-02

只有一个：

Feature Extractor。

---

Rule-03

只有一个：

Feature Contract。

---

Rule-04

只有一个：

Feature Tensor。

---

Rule-05

Training：

Runtime：

共享：

Feature Foundation。

---

Rule-06

Feature Version：

唯一决定：

Tensor。

---

Rule-07

Boundary Provider：

不得影响：

Feature。

---

Rule-08

Dataset：

不得进入：

Feature Foundation。

---

Rule-09

Runtime：

不得定义：

Feature。

---

Rule-10

Training：

不得定义：

Feature。

Part 2 完。

# Part 3 — Runtime, Training and Feature Shard Foundation

---

# 17. Runtime Pipeline

Feature Foundation 不改变 Runtime Mainline。

Runtime Pipeline 保持如下：

```text
FW
        │
        ▼
WordInfo
        │
        ▼
Feature Extractor
        │
        ▼
Feature Tensor
        │
        ▼
Tone Model
        │
        ▼
Tone Posterior
        │
        ▼
Recall
        │
        ▼
Candidate Ranking
        │
        ▼
Final Candidate
```

Feature Foundation 只负责：

```text
WordInfo

↓

Feature Tensor
```

Tone Model 之后的所有逻辑均属于 Runtime Decision Layer。

Feature Foundation 不参与：

- Recall
- Candidate Merge
- Candidate Ranking
- Decision
- Apply

---

# 18. Runtime Processing

Runtime Feature Processing 必须保持统一。

输入：

```text
PCM Audio

+

WordInfo
```

处理流程：

```text
Audio

↓

Slice

↓

Frame Normalization

↓

Feature Extraction

↓

Tensor Assembly

↓

Feature Tensor
```

输出：

```text
Feature Tensor
```

Runtime Feature Processing 不允许：

- 修改 WordInfo
- 修改 Timestamp
- 修改 Boundary
- 修改 Token
- 修改 Runtime Decision

---

# 19. Runtime Failure Handling

Feature Foundation 属于 Runtime Fail-Closed。

当出现以下情况：

- WordInfo 不存在
- start >= end
- Audio Slice 无效
- Feature Extraction Failure
- Tensor Generation Failure

必须：

Fail Closed。

不得：

- 推测 Timestamp
- 自动补 Boundary
- 自动重新切片
- 自动降级第二 Feature

---

Skipped Sample 必须进入 Diagnostics。

不得进入 Runtime Decision。

---

# 20. Training Pipeline

Training Pipeline 定义如下：

```text
TextGrid

↓

SyllableSample

↓

WordInfo Adapter

↓

WordInfo

↓

Feature Extractor

↓

Feature Tensor

↓

Feature Shard V2

↓

Model
```

Training Pipeline 与 Runtime Pipeline 唯一区别：

Boundary Provider。

除此之外：

全部共享。

---

# 21. Training Responsibilities

Training 负责：

- Ground Truth
- WordInfo Adapter
- Feature Shard Build
- Model Training

Training 不负责：

- Runtime Timestamp
- Runtime Feature
- Runtime Contract
- Feature Contract

---

Training 不允许：

新增：

Training Feature。

Training Tensor。

Training Contract。

Training Runtime。

---

# 22. Feature Shard V2

Feature Shard V2 属于：

Training Engineering。

Feature Shard：

不是：

Feature Foundation。

Feature Foundation：

负责生成：

Feature Tensor。

Training Engineering：

负责保存：

Feature Tensor。

职责必须分离。

---

## 22.1 Feature Shard Build

Feature Shard Build：

流程如下：

```text
WordInfo

↓

Feature Extractor

↓

Feature Tensor

↓

Feature Shard V2
```

Feature Shard：

不得：

直接读取：

TextGrid。

不得：

直接读取：

SyllableSample。

不得：

自行生成：

Feature。

---

## 22.2 Feature Shard Content

Feature Shard 建议保存：

```text
Feature Tensor

Tone Label

Feature Version

Optional Diagnostics
```

Feature Shard 不保存：

- Runtime Object
- Dataset Object
- TextGrid
- SyllableSample

Feature Tensor 必须成为唯一训练输入。

---

## 22.3 Feature Shard Version

Feature Version：

决定：

Feature Shard。

例如：

```text
training_feature_shard_v2

↓

featureVersion

↓

p1-frame-mel-f0-v1
```

不同 Feature Version：

不得共享：

Feature Shard。

---

# 23. Diagnostics

Diagnostics：

属于：

Verification。

不得：

进入：

Feature。

不得：

进入：

Model。

不得：

进入：

Runtime Decision。

---

Diagnostics 建议记录：

- Feature Version
- Feature Shape
- Slice Duration
- Frame Count
- Tensor Dimension
- Tensor Statistics
- Extraction Time

Diagnostics：

不得：

改变：

Feature。

---

# 24. Trace

Feature Trace：

建议如下：

```text
WordInfo

↓

Audio Slice

↓

Frame Normalize

↓

Feature Extraction

↓

Tensor Assembly

↓

Feature Tensor

↓

Tone Model

↓

Tone Posterior
```

Trace：

必须：

可追溯。

Feature Tensor：

必须：

能够追溯：

对应：

WordInfo。

---

# 25. Boundary Consistency

Boundary Consistency：

属于：

Verification。

不是：

Training。

不是：

Runtime。

不是：

Feature。

执行顺序：

```text
Boundary Consistency Audit

PASS

↓

Canonical Feature Shard V2

↓

Training
```

FAIL：

禁止：

生成：

Canonical Feature Shard。

---

Boundary Audit：

只能：

比较：

Boundary。

不得：

生成：

Feature。

不得：

训练。

不得：

改变：

Feature Contract。

---

# 26. Loader

Loader：

属于：

Training Engineering。

Loader：

职责：

读取：

Feature Shard。

不得：

重新：

Feature Extraction。

不得：

重新：

Normalization。

不得：

重新：

Interpolation。

Loader：

只负责：

读取：

Feature Tensor。

---

# 27. Runtime / Training Equality

Runtime：

Training：

必须满足：

```text
WordInfo

↓

Feature Extractor

↓

Feature Tensor
```

完全一致。

不得：

Runtime：

Feature A。

Training：

Feature B。

不得：

Runtime：

Extractor A。

Training：

Extractor B。

整个系统：

只允许：

一套：

Feature Foundation。

---

# 28. Feature Foundation Mainline

P8 Feature Foundation：

最终唯一主链：

```text
                 Dataset Foundation
                        │
                 SyllableSample
                        │
                 WordInfo Adapter
                        │
                        ▼
FW ───────────────► WordInfo
                        │
                        ▼
             Shared Feature Extractor
                        │
                        ▼
                 Feature Tensor V2
                  │             │
                  │             │
                  ▼             ▼
            Training         Runtime
                  │             │
                  └──────┬──────┘
                         ▼
                    Tone Model
                         ▼
                  Tone Posterior
                         ▼
                      Recall
                         ▼
                 Candidate Ranking
                         ▼
                  Final Candidate
```

整个系统：

只有：

- 一个 Runtime Timestamp Contract
- 一个 Feature Extractor
- 一个 Feature Contract
- 一个 Feature Tensor
- 一个 Runtime Mainline

不得新增：

- 第二 Timestamp
- 第二 Feature
- 第二 Pipeline
- 第二 Runtime
- 第二 Extractor
- Shadow
- Compatibility
- Registry
- Switching

P8 Foundation 的目标不是增加新的功能，而是建立未来所有 Tone Model（CNN、CRNN、Conformer 等）共同依赖的唯一 Feature Foundation。

# Part 4 — Development Constraints, Verification and Acceptance

---

# 29. Development Constraints

P8 Feature V2 Foundation 属于 Foundation Upgrade。

本阶段目标：

建立统一 Feature Foundation。

不得在本阶段引入任何新的 Runtime 业务逻辑。

---

## DC-01

不得改变 Runtime Mainline。

Runtime：

必须保持：

```text
FW

↓

WordInfo

↓

Feature Extractor

↓

Feature Tensor

↓

Tone Model
```

Feature Foundation：

只能替换：

Feature Contract。

不得改变：

Decision Chain。

---

## DC-02

不得修改 Runtime Contract。

WordInfo：

已经冻结。

Feature Foundation：

只能消费：

WordInfo。

不得：

重新定义：

Timestamp。

不得：

包装：

WordInfo。

不得：

重新估计：

Boundary。

---

## DC-03

不得建立第二 Pipeline。

整个系统：

只能存在：

一条：

Feature Mainline。

禁止：

- Runtime Feature Pipeline
- Training Feature Pipeline
- Offline Feature Pipeline
- Shadow Pipeline
- Compatibility Pipeline
- Experimental Pipeline

---

## DC-04

不得建立第二 Feature。

整个系统：

Feature：

唯一。

Runtime：

Training：

Validation：

全部共享。

---

## DC-05

不得建立第二 Feature Extractor。

Extractor：

整个系统：

唯一。

任何：

Training。

Runtime。

Validation。

不得：

重新实现：

Feature。

---

## DC-06

不得修改 Dataset Foundation。

Dataset：

负责：

Ground Truth。

Feature Foundation：

不得：

修改：

Dataset。

不得：

增加：

Dataset Logic。

---

## DC-07

不得修改 Runtime Decision。

Feature Foundation：

只能输出：

Feature Tensor。

之后：

所有：

Decision：

保持：

冻结。

---

# 30. Feature Version Policy

Feature Version：

唯一决定：

Feature Contract。

包括：

- Tensor Shape
- Channel Layout
- Normalization
- Padding
- Interpolation
- Crop Policy

不得：

由：

Model。

Training。

Runtime。

共同决定。

---

## FV-01

任何：

Feature Contract：

修改。

必须：

升级：

Feature Version。

---

## FV-02

不同：

Feature Version。

不得：

共享：

Feature Shard。

---

## FV-03

不同：

Feature Version。

不得：

混合：

训练。

---

# 31. Runtime Compatibility

Runtime：

必须：

只消费：

当前：

Feature Version。

不得：

自动：

Compatibility。

不得：

Runtime：

转换：

Feature。

不得：

自动：

升级：

Tensor。

---

# 32. Acceptance Criteria

开发完成后：

必须满足：

以下条件。

---

## AC-01

Runtime Timestamp：

唯一：

WordInfo。

---

## AC-02

Training：

必须：

WordInfo Adapter。

不得：

直接：

Feature：

TextGrid。

---

## AC-03

Training：

Runtime：

共享：

Feature Extractor。

---

## AC-04

Training：

Runtime：

共享：

Feature Contract。

---

## AC-05

Training：

Runtime：

共享：

Feature Tensor。

---

## AC-06

Feature Tensor：

必须：

由：

Feature Foundation：

唯一生成。

---

## AC-07

Dataset：

不得：

拥有：

Feature。

---

## AC-08

Training：

不得：

拥有：

Feature。

---

## AC-09

Runtime：

不得：

拥有：

Feature。

---

## AC-10

Feature Foundation：

成为：

唯一：

Feature Owner。

---

# 33. Frozen Architecture Verification

开发完成后：

必须验证：

Frozen Architecture：

仍然成立。

验证项：

---

## FAV-01

Runtime Mainline：

保持：

冻结。

---

## FAV-02

Runtime Timestamp：

保持：

WordInfo。

---

## FAV-03

Feature Foundation：

保持：

唯一。

---

## FAV-04

Feature Extractor：

保持：

唯一。

---

## FAV-05

Feature Contract：

保持：

唯一。

---

## FAV-06

Runtime：

Training：

不存在：

Feature 分叉。

---

## FAV-07

Feature Foundation：

未侵入：

Runtime。

---

## FAV-08

Feature Foundation：

未侵入：

Dataset。

---

# 34. Semantic Acceptance

不仅验证：

Feature：

存在。

必须验证：

Feature：

真正：

参与：

最终：

Decision。

验证路径：

```text
WordInfo

↓

Feature Tensor

↓

Tone Model

↓

Tone Posterior

↓

Recall

↓

Candidate Ranking

↓

Final Candidate
```

必须确认：

Feature Tensor：

真实：

影响：

Tone Posterior。

Tone Posterior：

真实：

影响：

Recall。

不得：

出现：

Feature：

存在。

Model：

未消费。

---

# 35. Contract Verification

验证：

Contract：

一致性。

包括：

---

CV-01

Timestamp Contract。

---

CV-02

Feature Contract。

---

CV-03

Feature Version。

---

CV-04

Tensor Shape。

---

CV-05

Channel Layout。

---

CV-06

Padding Policy。

---

CV-07

Interpolation Policy。

---

CV-08

Crop Policy。

---

所有：

Training。

Runtime。

Validation。

必须：

完全一致。

---

# 36. Regression Gate

Feature V2：

只有：

全部：

PASS。

才能：

进入：

Training。

---

## RG-01

Frozen Architecture Verification

PASS

---

## RG-02

Semantic Acceptance

PASS

---

## RG-03

Contract Verification

PASS

---

## RG-04

Boundary Consistency Gate

PASS

---

## RG-05

Feature Version Verification

PASS

---

## RG-06

Feature Tensor Verification

PASS

---

## RG-07

Training / Runtime Equality

PASS

---

## RG-08

Runtime Mainline Verification

PASS

---

## RG-09

Decision Path Verification

PASS

---

## RG-10

Regression Test

PASS

---

# 37. Development Exit Criteria

P8 Foundation 开发完成：

必须满足：

- Runtime Mainline 保持冻结；
- WordInfo 成为唯一 Timestamp Contract；
- Feature Foundation 成为唯一 Feature Owner；
- Feature Extractor 唯一；
- Feature Contract 唯一；
- Feature Tensor 唯一；
- Runtime 与 Training 完全共享 Feature Foundation；
- 不存在第二 Timestamp；
- 不存在第二 Feature；
- 不存在第二 Pipeline；
- Feature Tensor 真正参与最终 Decision；
- 所有 Regression Gate 全部 PASS。

满足以上条件后：

P8 Foundation 正式冻结。

后续所有：

CNN、

CRNN、

Conformer、

Transformer、

均建立在该 Foundation 之上。

不得再次修改：

Runtime Contract。

不得再次修改：

Feature Foundation。

# Part 5 — Frozen Principles

---

# 38. Foundation Principles

P8 Feature V2 Foundation 是整个 Tone V2 后续所有模型的基础层。

任何 Feature、模型或训练策略均不得绕过本章定义的原则。

除非进入新的 Foundation Phase，否则不得修改。

---

# FP-01 Runtime Timestamp Contract SSOT

Runtime WordInfo 是整个系统唯一 Timestamp Contract。

任何 Feature、Training、Validation、Diagnostics、Runtime 均必须建立在 WordInfo 之上。

禁止新增：

- FeatureTimestampRecord
- RuntimeTimestampRecord
- TrainingTimestampRecord
- Timestamp Wrapper
- Compatibility Timestamp

Runtime Timestamp SSOT 永远只有：

```text
WordInfo
```

---

# FP-02 Runtime Mainline Frozen

Feature Foundation 不得改变 Runtime Mainline。

Runtime Mainline 永远保持：

```text
FW

↓

WordInfo

↓

Feature Extractor

↓

Feature Tensor

↓

Tone Model

↓

Tone Posterior

↓

Recall

↓

Candidate Ranking

↓

Final Candidate
```

Feature Foundation 只能改变：

Feature Tensor。

不得改变：

Decision Path。

---

# FP-03 Single Feature Extractor

整个系统：

只有一个：

Feature Extractor。

Training：

Runtime：

Validation：

共享。

不得：

分别实现。

不得：

Shadow。

不得：

Compatibility。

不得：

Runtime Version。

不得：

Training Version。

---

# FP-04 Single Feature Contract

整个系统：

只有一个：

Feature Contract。

Feature Contract：

由：

Feature Version：

唯一决定。

不得：

Training：

定义。

不得：

Runtime：

定义。

不得：

Model：

定义。

不得：

Loader：

定义。

---

# FP-05 Single Feature Tensor

整个系统：

只有一个：

Feature Tensor。

Feature Tensor：

属于：

Feature Foundation。

Training：

Runtime：

Validation：

全部消费：

同一个：

Tensor。

不得：

Runtime Tensor。

不得：

Training Tensor。

不得：

Compatibility Tensor。

---

# FP-06 Feature Foundation Ownership

Feature Foundation：

拥有：

- Feature Contract
- Feature Version
- Feature Extractor
- Feature Tensor

除此之外：

不得拥有：

Runtime。

不得拥有：

Dataset。

不得拥有：

Training。

不得拥有：

Loader。

不得拥有：

Model。

---

# FP-07 Dataset Independence

Dataset Foundation：

负责：

Ground Truth。

Boundary。

Label。

Dataset：

不得：

定义：

Feature。

不得：

拥有：

Feature Contract。

不得：

拥有：

Feature Tensor。

不得：

进入：

Runtime。

---

# FP-08 Runtime Independence

Runtime：

负责：

Audio。

WordInfo。

Runtime：

不得：

定义：

Feature。

不得：

修改：

Feature。

不得：

拥有：

Feature Version。

不得：

拥有：

Feature Tensor。

---

# FP-09 Training Independence

Training：

负责：

WordInfo Adapter。

Feature Shard。

Model Training。

Training：

不得：

定义：

Feature。

不得：

修改：

Feature。

不得：

拥有：

Feature Contract。

不得：

拥有：

Feature Version。

---

# FP-10 Boundary Provider Independence

Boundary Provider：

只是：

Boundary Source。

例如：

Training：

```text
TextGrid
```

Runtime：

```text
FW WordInfo
```

未来：

其他 Runtime：

仍然：

输出：

WordInfo。

Feature Foundation：

永远：

只认识：

WordInfo。

不得：

认识：

Boundary Provider。

不得：

根据：

Boundary Provider：

改变：

Feature。

---

# FP-11 WordInfo Adapter Principle

WordInfo Adapter：

只是：

Contract Adapter。

不得：

承担：

Feature。

不得：

承担：

Training。

不得：

承担：

Runtime。

不得：

承担：

Validation。

职责：

只有：

```text
SyllableSample

↓

WordInfo
```

---

# FP-12 Feature Foundation Boundary

Feature Foundation：

唯一职责：

```text
Audio

+

WordInfo

↓

Feature Tensor
```

除此之外：

全部禁止。

不得：

读取：

Dataset。

不得：

读取：

TextGrid。

不得：

读取：

Training。

不得：

读取：

Runtime。

不得：

读取：

Loader。

---

# FP-13 Version Principle

Feature Version：

唯一决定：

Feature Contract。

包括：

- Tensor Shape
- Channel Layout
- Padding
- Crop
- Interpolation
- Normalization

修改以上任意内容：

必须：

升级：

Feature Version。

---

# FP-14 Feature Evolution Principle

后续：

CNN。

CRNN。

Conformer。

Transformer。

均建立在：

Feature Foundation：

之上。

不得：

重新定义：

Feature。

不得：

重新定义：

Timestamp。

不得：

重新定义：

Runtime。

---

# FP-15 Single Source of Truth

整个 Feature Foundation：

只有一个：

SSOT。

```text
Runtime WordInfo

↓

Feature Extractor

↓

Feature Tensor
```

不得：

出现：

第二：

SSOT。

---

# FP-16 No Compatibility Principle

Feature Foundation：

禁止：

Compatibility。

包括：

- Compatibility Feature
- Compatibility Timestamp
- Compatibility Tensor
- Compatibility Pipeline
- Compatibility Runtime

Feature Version：

升级：

即：

新 Foundation。

不得：

兼容：

旧 Feature。

---

# FP-17 No Shadow Principle

禁止：

Shadow。

包括：

- Shadow Runtime
- Shadow Extractor
- Shadow Feature
- Shadow Pipeline
- Shadow Training

整个系统：

只有：

唯一主链。

---

# FP-18 No Dual Pipeline Principle

禁止：

任何：

Dual Pipeline。

包括：

Training。

Runtime。

Validation。

Diagnostics。

不得：

为了：

实验：

增加：

第二 Pipeline。

---

# FP-19 Semantic Principle

Feature Foundation：

必须：

真正：

参与：

最终：

Decision。

不得：

出现：

Feature：

存在。

Feature：

生成。

Feature：

未参与：

最终：

Decision。

Semantic Verification：

必须：

验证：

```text
WordInfo

↓

Feature Tensor

↓

Tone Model

↓

Tone Posterior

↓

Recall

↓

Candidate Ranking

↓

Final Candidate
```

---

# FP-20 Foundation Upgrade Principle

Feature Foundation：

属于：

Foundation。

不是：

Training。

不是：

Runtime。

不是：

Model。

任何：

Feature Foundation：

修改。

必须：

进入：

新的：

Foundation Phase。

不得：

通过：

普通：

Feature Development。

不得：

通过：

Model Tuning。

不得：

通过：

Runtime Patch。

不得：

通过：

Compatibility。

---

# P8 Final Frozen Principle

P8 Feature V2 Foundation 的最终冻结原则如下：

> Runtime WordInfo 是唯一 Timestamp Contract SSOT；Training 的唯一职责是将 Ground Truth（TextGrid / SyllableSample）转换为 WordInfo；Feature Foundation 的唯一职责是将 Audio + WordInfo 转换为统一的 Feature Tensor；Feature Foundation 拥有唯一的 Feature Contract、Feature Version、Feature Extractor 和 Feature Tensor；Training、Runtime、Validation、Feature Shard、Model 全部共享同一个 Feature Foundation，不允许任何第二 Timestamp Contract、第二 Feature Contract、第二 Feature Extractor、第二 Feature Tensor 或第二 Pipeline 存在。未来所有 Tone 模型（CNN、CRNN、Conformer、Transformer 等）均建立在该 Foundation 之上，而不得重新定义 Runtime Contract 或 Feature Foundation。

# Part 6 — Development Scope, KEEP / MODIFY / RESTORE / DELETE and Final Acceptance

---

# 39. Development Scope

P8 Feature V2 Foundation 的开发范围仅限于 Feature Foundation。

本阶段目标：

建立统一 Feature Foundation。

不得扩展 Runtime 功能。

不得扩展业务流程。

不得修改 Decision Layer。

---

## Included

P8 包括：

- Runtime Timestamp Contract
- WordInfo Adapter
- Feature Extractor
- Feature Contract
- Feature Version
- Feature Tensor
- Feature Shard V2
- Shared Runtime / Training Feature Foundation

---

## Excluded

P8 不包括：

- CNN
- CRNN
- Conformer
- Transformer
- Optimizer
- Learning Rate
- Loss Function
- Dataset Expansion
- Runtime Recall
- Candidate Ranking
- KenLM
- Lexicon
- Runtime Business Logic

上述内容属于后续阶段。

---

# 40. KEEP

以下内容保持冻结。

不得修改。

---

## KEEP-01

Runtime Mainline。

保持：

```text
FW

↓

WordInfo

↓

Feature Extractor

↓

Feature Tensor

↓

Tone Model

↓

Tone Posterior

↓

Recall

↓

Candidate Ranking

↓

Final Candidate
```

---

## KEEP-02

Runtime Timestamp Contract。

WordInfo：

保持唯一：

Timestamp Contract。

---

## KEEP-03

Dataset Foundation。

Ground Truth。

Boundary。

Label。

保持冻结。

---

## KEEP-04

Training Engineering。

Training：

负责：

Feature Shard。

保持职责。

---

## KEEP-05

Runtime Fail Closed。

保持：

Fail Closed。

不得：

Silent Recovery。

---

## KEEP-06

Tone Runtime Service。

保持：

Single Service。

---

## KEEP-07

Single Runtime Mainline。

不得：

增加：

第二 Runtime。

---

# 41. MODIFY

以下内容：

允许修改。

但只能在：

Feature Foundation：

范围内。

---

## MODIFY-01

Feature Contract。

升级：

Feature Version。

---

## MODIFY-02

Feature Extractor。

升级：

Frame Feature。

---

## MODIFY-03

Feature Tensor。

升级：

Tensor Layout。

---

## MODIFY-04

Feature Shard。

升级：

Feature Shard V2。

---

## MODIFY-05

Training Adapter。

新增：

WordInfo Adapter。

---

## MODIFY-06

Training Build。

使用：

Feature Version V2。

---

所有 MODIFY：

不得：

影响：

Runtime Contract。

---

# 42. RESTORE

恢复：

Runtime 与 Training：

统一：

Feature Foundation。

---

## RESTORE-01

Training：

恢复：

Runtime Contract。

Training：

不得：

继续：

使用：

Dataset Contract。

---

## RESTORE-02

Feature Foundation。

恢复：

唯一：

Feature。

---

## RESTORE-03

Feature Ownership。

恢复：

Feature Foundation：

Owner。

Training：

Runtime：

Consumer。

---

## RESTORE-04

Single Extractor。

恢复：

唯一：

Feature Extractor。

---

# 43. DELETE

以下内容：

必须删除。

不得保留：

兼容。

不得保留：

Legacy。

---

## DELETE-01

FeatureTimestampRecord。

删除。

---

## DELETE-02

Training Timestamp Contract。

删除。

---

## DELETE-03

Runtime Timestamp Wrapper。

删除。

---

## DELETE-04

Training Feature。

删除。

---

## DELETE-05

Runtime Feature。

删除。

---

## DELETE-06

Shadow Feature。

删除。

---

## DELETE-07

Compatibility Feature。

删除。

---

## DELETE-08

Training Feature Pipeline。

删除。

---

## DELETE-09

Runtime Feature Pipeline。

删除。

---

## DELETE-10

Dual Pipeline。

删除。

---

## DELETE-11

Feature Compatibility Layer。

删除。

---

## DELETE-12

任何：

第二：

Feature Foundation。

删除。

---

# 44. Final Acceptance

P8 Feature Foundation：

完成后：

必须满足：

以下条件。

---

## Runtime

Runtime：

保持：

唯一主链。

PASS。

---

## Timestamp

WordInfo：

唯一：

Timestamp Contract。

PASS。

---

## Feature

Feature Contract：

唯一。

PASS。

---

## Extractor

Feature Extractor：

唯一。

PASS。

---

## Tensor

Feature Tensor：

唯一。

PASS。

---

## Version

Feature Version：

唯一决定：

Tensor。

PASS。

---

## Ownership

Feature Foundation：

唯一：

Feature Owner。

PASS。

---

## Dataset

Dataset：

不拥有：

Feature。

PASS。

---

## Runtime

Runtime：

不拥有：

Feature。

PASS。

---

## Training

Training：

不拥有：

Feature。

PASS。

---

## Pipeline

不存在：

第二 Pipeline。

PASS。

---

## Runtime Equality

Training：

Runtime：

共享：

同一个：

Feature Foundation。

PASS。

---

## Semantic

Feature Tensor：

真正：

进入：

Tone Model。

真正：

影响：

Tone Posterior。

真正：

影响：

Recall。

PASS。

---

## Architecture

Frozen Architecture：

保持成立。

PASS。

---

## Regression

所有：

Regression Gate：

PASS。

---

## Boundary

Boundary Consistency：

PASS。

---

## Contract

Contract Verification：

PASS。

---

# 45. Foundation Completion Criteria

P8 Feature Foundation：

只有满足以下全部条件：

才能冻结。

- Runtime Mainline 未改变；
- Runtime Timestamp Contract 唯一；
- Feature Foundation 唯一；
- Feature Contract 唯一；
- Feature Extractor 唯一；
- Feature Tensor 唯一；
- Feature Version 唯一；
- Training 与 Runtime 完全共享 Feature Foundation；
- Dataset Foundation 与 Feature Foundation 完全解耦；
- Feature Foundation 与 Runtime 完全解耦；
- 不存在第二 Timestamp Contract；
- 不存在第二 Feature Contract；
- 不存在第二 Feature Extractor；
- 不存在第二 Feature Tensor；
- 不存在第二 Pipeline；
- Feature 真正参与最终 Decision；
- Frozen Architecture Verification PASS；
- Semantic Acceptance PASS；
- Contract Verification PASS；
- Regression Gate PASS。

满足上述全部条件后：

P8 Feature V2 Foundation 正式冻结。

---

# P8 Final Statement

P8 的目标不是训练新的 Tone 模型，而是建立未来所有 Tone 模型共同依赖的统一 Feature Foundation。

自 P8 冻结后：

Runtime Contract 保持稳定；

Feature Foundation 保持稳定；

后续所有模型升级（CNN、CRNN、Conformer、Transformer 等）均只能建立在本 Foundation 之上，不得重新定义 Runtime Timestamp Contract，不得重新定义 Feature Contract，不得建立新的 Feature Pipeline，不得绕过本规范定义的唯一主链。

本规范自冻结之日起成为 Tone V2 Feature Foundation 的唯一 SSOT。