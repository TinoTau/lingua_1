# Tone V2 Phase 3 — Model Capability Development Plan

## 文档定位

本文档定义 **Tone V2 Phase 3（Model Capability）** 的开发方案。

前置条件：

* Phase 1 Freeze：已完成
* Phase 2 Foundation Freeze：已完成

Phase 3 的目标是提升 **Tone 模型能力**，而不是修改 Runtime、Decision 或服务架构。

如与 Phase 1 / Phase 2 Foundation Freeze 冲突，以冻结文档为准。

---

# 1. Development Scope

## 本阶段目标

仅允许开发：

* Training Pipeline
* Model Weight
* Artifact Generation
* Artifact Validation
* Offline Tone Quality Evaluation

不得修改：

* Runtime Hop
* Required Data Contract
* Decision Ownership
* Recall
* Ranking
* Assembly
* KenLM
* Apply
* Single Service / Single Model
* Loader Contract
* Backend Adapter Boundary
* Feature SSOT

---

# 2. Architecture Constraint

Phase 3 必须建立在以下冻结 Runtime 上：

```text
FW Worker
        │
        ▼
run_tone_inference
        │
        ▼
UtteranceResponse.tone
        │
        ▼
ASRResult.tone
        │
        ▼
ctx.acousticToneSlices
        │
        ▼
Recall
        │
        ▼
Ranking
        │
        ▼
Assembly
        │
        ▼
KenLM
        │
        ▼
Apply
```

不得新增：

* Runtime Step
* Decision Step
* Pipeline
* Service
* Registry
* Switching
* Routing

---

# 3. Phase Boundary

## Runtime

已经冻结。

禁止修改。

---

## Training

允许修改。

负责：

* 数据
* 标注
* 模型训练
* 权重生成

不得进入 Runtime。

---

## Evaluation

允许修改。

负责：

Posterior Quality Evaluation。

不得进入 Runtime。

---

## Artifact

允许修改。

负责：

Runtime 与 Training 的唯一桥梁。

不得直接参与 Decision。

---

# 4. Training Contract

Training Pipeline：

必须保持：

```text
Dataset
        │
        ▼
Training
        │
        ▼
Artifact
        │
        ▼
Artifact Validation
        │
        ▼
FW Runtime
        │
        ▼
Node E2E
```

训练结果不得直接进入 Runtime。

所有训练产物必须首先通过：

Artifact Validation。

之后才能：

进入 FW Runtime。

---

# 5. Feature SSOT Contract

Feature Baseline：

唯一来源：

```text
contract.py
```

Runtime：

```text
mel.py

↓

contract.py
```

Training：

```text
train_tone_cnn.py

↓

contract.py
```

禁止：

```text
N_MELS = 80

HIDDEN = 32

MIN_SLICE_SEC = 0.02
```

等硬编码再次出现。

Feature Extraction：

保持：

Runtime 与 Training：

完全一致。

---

# 6. Artifact Contract

Artifact：

必须保持：

Loader Contract。

当前 Required：

```text
weights

bias
```

保持不变。

新增 Optional Metadata：

```text
featureVersion

modelVersion

trainingVersion
```

不得新增：

Runtime Decision 字段。

不得新增：

Recall 字段。

不得新增：

Ranking 字段。

Metadata：

仅用于：

Diagnostics。

---

# 7. Artifact Validation Contract

新增：

Artifact Validation。

流程：

```text
Artifact
        │
        ▼
Schema Validation
        │
        ▼
Shape Validation
        │
        ▼
FeatureVersion Validation
        │
        ▼
Loader Compatibility
        │
        ▼
FW Runtime Validation
```

任何 Validation Failure：

不得进入：

Runtime。

Validation：

不得修改：

Artifact。

仅负责：

验证。

---

# 8. Backend Adapter Contract

Backend Adapter：

保持：

Phase 2 Foundation。

输入：

```text
Mel Batch
```

输出：

```text
TonePosterior
```

禁止新增：

* Runtime Routing
* Backend Switching
* Model Switching
* Registry
* Decision

Backend：

仅负责：

Inference。

---

# 9. Offline Tone Quality Evaluation

新增：

Tone Quality Evaluation。

负责：

Posterior Quality。

包括：

```text
Accuracy

Confusion Matrix

Posterior Distribution

Confidence Distribution
```

本模块：

属于：

Offline Evaluation。

不得：

替代：

Node E2E。

不得：

进入：

Runtime Decision。

---

# 10. Weight Upgrade Contract

允许：

重新训练：

新权重。

例如：

```text
tone_cnn_p0.npz

↓

tone_cnn_p1.npz
```

要求：

Feature Extraction：

保持一致。

则：

```text
featureVersion

保持：

p0-v1
```

不得：

升级：

featureVersion。

只有：

Feature Extraction：

发生变化。

允许：

重新定义：

featureVersion。

并重新执行：

Freeze。

---

# 11. Diagnostics Contract

允许补充：

```text
modelVersion

trainingVersion

validationResult
```

Diagnostics：

仅用于：

观测。

不得：

进入：

Decision。

不得：

影响：

Recall。

不得：

影响：

Ranking。

---

# 12. KEEP

保持：

* Runtime Hop
* Required Data Contract
* Decision Ownership
* Loader Contract
* Backend Adapter Boundary
* Feature SSOT
* Single Service / Single Model
* Artifact Required Schema

---

# 13. MODIFY

允许修改：

* train_tone_cnn.py
* Artifact Metadata
* Artifact Validation
* Offline Tone Quality Evaluation
* Training Dataset
* Training Script
* Weight Generation

---

# 14. RESTORE

无。

禁止恢复：

* Registry
* Backend Registry
* Switching
* Routing
* Shadow Runtime
* Offline Runtime
* Bootstrap
* Compatibility Runtime

---

# 15. DELETE

无。

禁止新增：

任何：

Runtime Cleanup。

---

# 16. Diagnostics Sample

```json
{
  "toneModule": {
    "featureVersion": "p0-v1",
    "modelVersion": "p1",
    "trainingVersion": "2026-06-29",
    "validationResult": "PASS"
  }
}
```

全部：

Optional。

---

# 17. Target List

## MC-01（P0）

Training：

统一引用：

```text
contract.py
```

禁止：

Feature Hardcode。

---

## MC-02（P1）

Artifact：

新增：

```text
featureVersion

modelVersion

trainingVersion
```

Metadata。

---

## MC-03（P1）

新增：

Artifact Validation。

包括：

* Schema Validation
* Shape Validation
* Loader Validation

---

## MC-04（P1）

新增：

Offline Tone Quality Evaluation。

包括：

* Accuracy
* Confusion Matrix
* Posterior Distribution
* Confidence Distribution

---

## MC-05（P2）

重新训练：

第一版权重。

生成：

新 Artifact。

---

## MC-06（P2）

Node E2E：

重新验证：

新权重。

---

## MC-07（P2）

dialog_200：

全量 200 条：

质量验证。

说明：

本项属于模型质量验收，不属于 Runtime Foundation 验收。

---

# 18. Check List

开发完成确认：

* Runtime Hop 未变化；
* Required Schema 未变化；
* Recall Decision 未变化；
* Feature SSOT 唯一；
* Training 无 Feature Hardcode；
* Artifact Metadata 正确；
* Artifact Validation 全部通过；
* Backend Adapter 未变化；
* Offline Evaluation 正常；
* 新权重正常加载；
* Node E2E 正常；
* dialog_200 可完成全量质量验证。

---

# 19. Regression List

必须重新验证：

* Feature SSOT
* Loader Contract
* Artifact Validation
* Backend Boundary
* Counterfactual Test
* Node E2E
* dialog_200
* Frozen Architecture Verification

不得：

使用：

Offline Benchmark：

替代：

Node E2E。

---

# 20. Acceptance Criteria

必须同时满足：

* Runtime Foundation 保持冻结；
* Training 与 Runtime 保持解耦；
* Artifact Contract 保持兼容；
* Feature Baseline 唯一；
* 新权重可部署；
* Artifact Validation 全部通过；
* Offline Evaluation 建立；
* Node E2E 无回归；
* dialog_200 全量通过（模型质量阶段）。

---

# 21. Architecture Compliance Criteria

开发完成必须证明：

* Runtime Hop 未变化；
* Required Contract 未变化；
* Decision Ownership 未变化；
* Single Service / Single Model 未变化；
* Loader Contract 未变化；
* Backend Adapter Boundary 未变化；
* Feature SSOT 未变化；
* Training 不进入 Runtime；
* Evaluation 不进入 Runtime；
* Diagnostics 不进入 Decision；
* Artifact 是 Training 与 Runtime 的唯一桥梁；
* 不存在 Runtime Drift；
* 不存在 Decision Drift；
* 不存在 Contract Drift；
* 不存在 Registry；
* 不存在 Switching；
* 不存在第二 Pipeline；
* 不存在第二 Decision。

---

# Final Constraint

Phase 3 的目标是提升模型能力，而不是重新设计 Runtime。

所有开发必须限制在：

```text
Training
        │
        ▼
Artifact
        │
        ▼
Validation
        │
        ▼
Offline Evaluation
```

任何修改 Runtime、Decision、Required Contract、Service Boundary 或引入 Registry、Switching、Multi-Model 的实现，都必须判定为 **Architecture Drift**，禁止进入开发。
