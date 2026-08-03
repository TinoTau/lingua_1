<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Tone V2 Phase 3 — Supplement Addendum II.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Tone V2 Phase 3 — Supplement Addendum II

## 文档定位

本文档补充《Tone V2 Phase 3 Development Plan》和《Supplement Addendum》。

目的：

进一步消除文档歧义、统一 Artifact Contract、Validation Contract、Regression Gate 与 Acceptance Contract。

不得修改：

* Runtime
* Decision Ownership
* Loader Contract
* Backend Adapter
* Feature SSOT
* Phase 1 Freeze
* Phase 2 Foundation Freeze

本补充仅增加开发约束，不新增功能。

---

# 1. Artifact Metadata Contract Clarification

Artifact Metadata：

统一划分为三个层级。

## Required Parameters

```text
w1
b1
w2
b2
```

Loader：

必须存在。

否则：

Fail Closed。

---

## Optional Artifact Metadata

允许写入：

```text
featureVersion
modelVersion
trainingVersion
datasetVersion
buildTime
backend
formatVersion
notes
metrics
```

全部：

Optional。

不得影响：

Loader Decision。

---

## Runtime Diagnostics Metadata

以下字段：

不得存入 npz。

Runtime 自动生成：

```text
artifactPath
artifactHash
loadMs
backendAdapter
```

这些字段：

仅属于 Runtime Diagnostics。

不得作为：

Artifact Metadata。

---

# 2. FeatureVersion Contract Clarification

featureVersion：

统一来源：

```text
contract.py
```

训练：

禁止：

生成：

新的：

featureVersion。

若：

Artifact：

缺少：

featureVersion。

Loader：

解释为：

```text
P0_FEATURE_VERSION
```

记录：

Warning。

继续：

加载。

不得：

Fail。

---

# 3. ValidationResult Contract

删除：

独立：

```text
validationResult
```

字段。

Validation：

结果：

属于：

Validation Report。

不得：

进入：

Artifact。

不得：

进入：

Loader。

若：

需要：

备注。

统一：

使用：

```text
notes
```

---

# 4. Validation Pipeline Clarification

Validation：

固定：

四阶段。

```text
Artifact
        │
        ▼
Schema Validation
        │
        ▼
Runtime Adapter Validation
        │
        ▼
Artifact Acceptance
        │
        ▼
Runtime Validation
```

说明：

Artifact Validation：

结束于：

Artifact Acceptance。

Runtime Validation：

属于：

Node Integration。

不得：

回写：

Artifact。

---

# 5. Runtime Adapter Acceptance

训练：

允许：

使用：

内部：

```text
_softmax
```

计算：

loss。

允许：

计算：

accuracy。

但是：

最终：

Artifact：

Acceptance：

必须：

通过：

```text
numpy_p0.infer_batch
```

完成。

不得：

使用：

训练：

accuracy

直接：

决定：

Artifact：

是否：

部署。

---

# 6. Offline Evaluation Contract

Offline Tone Quality Evaluation：

唯一职责：

评价：

Posterior。

包括：

```text
Accuracy

Confusion Matrix

Posterior Distribution

Confidence Distribution
```

允许：

Calibration：

实验。

Calibration：

不得：

进入：

Runtime。

不得：

进入：

Recall。

不得：

进入：

Ranking。

不得：

进入：

Penalty。

---

# 7. Model Quality Acceptance

Foundation Regression：

保持：

```text
effective_chain

model_error
```

验证：

Runtime。

---

Model Quality：

至少满足：

```text
Offline Evaluation

PASS
```

以及：

```text
Node E2E

无回归
```

dialog_200：

用于：

模型质量验证。

不得：

重新作为：

Foundation Freeze

依据。

CER：

如存在：

仅用于：

观测。

不是：

Runtime Contract。

---

# 8. Regression Gate Clarification

Phase 3：

新增：

四项测试：

## Feature Parity Test

验证：

Training：

与：

Runtime：

使用：

同一：

Feature Baseline。

---

## Runtime Adapter Validation Test

验证：

Artifact：

通过：

Runtime Backend Adapter。

---

## Artifact Validation Test

验证：

Artifact：

符合：

Loader Contract。

---

## Offline Evaluation Isolation Test

验证：

Offline Evaluation：

未进入：

Runtime。

未进入：

Decision。

---

上述四项：

全部：

属于：

Python Unit Test。

不得：

依赖：

FW。

不得：

依赖：

Node。

不得：

依赖：

HTTP。

---

# 9. Documentation Alignment

README：

增加：

Phase 3。

注明：

Phase 3：

属于：

Model Capability。

不是：

Runtime。

所有：

Artifact：

Validation：

Acceptance：

均引用：

本 Addendum。

---

# 10. KEEP / MODIFY / RESTORE / DELETE

## KEEP

* Runtime Freeze
* Loader Contract
* Feature SSOT
* Backend Adapter
* Single Service / Single Model
* audit_* 工具（人工分析）
* test_loader
* test_phase2_contracts

---

## MODIFY

* train_tone_cnn.py
* Artifact Metadata
* Validation Pipeline
* Runtime Adapter Acceptance
* README
* Phase 3 Regression Tests

---

## RESTORE

无。

---

## DELETE

删除：

```text
validationResult
```

独立字段。

统一：

使用：

Validation Report

或：

notes。

---

# Final Constraint

Phase 3：

允许：

修改：

Training。

Artifact。

Validation。

Offline Evaluation。

不得：

修改：

Runtime。

Decision。

Loader。

Recall。

Ranking。

Assembly。

KenLM。

Apply。

任何开发导致：

Training 与 Runtime Feature 不一致、

Artifact Acceptance 不经过 Runtime Adapter、

Offline Evaluation 进入 Runtime、

均判定为：

Architecture Drift。
