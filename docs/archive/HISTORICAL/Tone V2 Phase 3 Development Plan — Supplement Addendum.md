<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Tone V2 Phase 3 Development Plan — Supplement Addendum.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Tone V2 Phase 3 Development Plan — Supplement Addendum

## 文档定位

本文档补充《Tone V2 Phase 3 — Model Capability Development Plan》。

仅补充开发约束、实现契约、Artifact Contract、Training Boundary、Validation Boundary 与 Acceptance。

不得改变：

* Phase 1 Freeze
* Phase 2 Foundation Freeze
* Runtime Hop
* Required Data Contract
* Decision Ownership
* Single Service / Single Model

---

# 1. Artifact Contract Clarification

Artifact Contract 必须与 Loader Contract 保持完全一致。

文档不得再使用：

```text
weights
bias
```

作为 Required 字段描述。

Required Parameters：

```text
w1
b1
w2
b2
```

Optional Parameters：

```text
mel_mean
mel_std
featureVersion
modelVersion
trainingVersion
datasetVersion
buildTime
modelHash
notes
```

除 Required Parameters 外，其余字段均属于 Optional Metadata。

Loader Fail-Closed：

只校验：

* Required Parameters
* Required Metadata

不得因为 Optional Metadata 缺失而拒绝加载。

---

# 2. Validation Boundary Contract

Validation：

必须拆分为两个阶段。

## Stage 1

Artifact Validation

负责：

```text
Schema Validation
Shape Validation
Metadata Validation
Loader Compatibility
```

属于：

Offline Validation。

不得启动 FW Runtime。

不得修改 Artifact。

---

## Stage 2

Runtime Validation

负责：

```text
FW Load

↓

Node E2E

↓

dialog_200
```

属于：

Deployment Verification。

不得作为：

Artifact Validation

的一部分。

不得进入：

Training Pipeline。

---

# 3. Runtime / Training Parity Contract

Training 与 Runtime：

必须保持：

Feature Parity。

Validation：

必须使用：

Runtime Backend Adapter

验证训练产物。

流程：

```text
Training
        │
        ▼
Artifact
        │
        ▼
Runtime Backend Adapter
        │
        ▼
Posterior
        │
        ▼
Validation
```

禁止：

Training 使用独立推理逻辑作为最终验证结果。

训练脚本中的 `_softmax` 或其它内部实现，仅允许用于训练过程。

最终 Validation 必须经过：

Runtime Adapter。

---

# 4. Feature SSOT Contract Supplement

Training：

不得继续维护：

任何：

Feature Hardcode。

包括：

```text
N_MELS

MIN_SLICE_SEC

HIDDEN

FFT

Hop Length
```

统一引用：

```text
contract.py
```

Feature Baseline。

Training：

不得重新定义：

Feature Version。

---

# 5. Offline Evaluation Boundary

Offline Tone Quality Evaluation：

负责：

```text
Accuracy

Posterior Distribution

Confidence Distribution

Confusion Matrix
```

允许：

Posterior Calibration

研究。

但：

Calibration：

不得进入：

Runtime。

不得进入：

Recall。

不得进入：

Ranking。

不得改变：

Tone Penalty。

不得作为：

Runtime Gate。

---

# 6. Legacy Tool Boundary

以下工具：

```text
audit_tone_reliability.py

audit_runtime_acceptance.py
```

继续保留。

用途：

人工分析。

不得作为：

Phase 3 Quality SSOT。

不得替代：

Offline Tone Quality Evaluation。

不得替代：

Node E2E。

---

# 7. MC-07 Acceptance Clarification

MC-07：

分为两层。

## Foundation Regression

继续验证：

```text
effective_chain

model_error
```

目标：

确认：

Runtime 未回归。

---

## Model Quality Validation

验证：

```text
Offline Quality Evaluation

↓

Node E2E

↓

dialog_200（全量）
```

目的：

验证：

模型质量。

不得：

作为：

Foundation Freeze

重新验收。

---

# 8. FeatureVersion Constraint

仅更换：

模型权重：

不得：

修改：

```text
featureVersion
```

只有：

Feature Extraction：

发生变化。

允许：

重新定义：

Feature Version。

并重新执行：

Freeze。

禁止：

Training Script

自行：

生成：

新的：

Feature Version。

---

# 9. README / Documentation Alignment

Phase 3 启动后：

README：

必须新增：

Phase 3。

包括：

* Development Scope
* Runtime Boundary
* Training Boundary
* Evaluation Boundary
* Artifact Contract

禁止：

README：

继续引用：

任何：

Registry、

Switching、

Multi-Model

方案。

---

# 10. Regression Gate Supplement

新增：

## Feature Parity Test

确认：

Training：

与：

Runtime：

使用：

同一：

Feature Baseline。

---

## Artifact Validation Test

确认：

Artifact：

符合：

Loader Contract。

---

## Runtime Adapter Validation

确认：

Validation：

通过：

Runtime Backend Adapter。

---

## Offline Evaluation Test

确认：

Offline Evaluation：

未进入：

Runtime Decision。

---

# 11. KEEP / MODIFY / RESTORE / DELETE

## KEEP

* Runtime Hop
* Required Contract
* Decision Ownership
* Single Service / Single Model
* Loader Fail-Closed
* Feature SSOT
* Backend Adapter
* Deployment Runbook
* Legacy audit tools（人工分析）

---

## MODIFY

* Artifact Contract 文档
* Validation Boundary
* Training / Runtime Parity
* MC-07 Acceptance
* FeatureVersion Constraint
* README Alignment
* Regression Gate

---

## RESTORE

无。

禁止恢复：

* Registry
* Backend Registry
* Switching
* Routing
* Shadow Runtime
* Bootstrap
* Compatibility Runtime

---

## DELETE

无新增 DELETE。

继续保持：

Registry / Switching

相关方案：

处于：

Deprecated / Archive。

---

# Final Constraint

Phase 3 的开发目标是：

提升模型能力。

不是：

修改 Runtime。

不是：

修改 Decision。

不是：

重新设计 Service。

任何开发导致：

* Runtime Drift
* Decision Drift
* Contract Drift
* Feature Drift
* Training 与 Runtime 不一致

均视为：

Architecture Drift。

必须停止开发并重新执行冻结流程。
