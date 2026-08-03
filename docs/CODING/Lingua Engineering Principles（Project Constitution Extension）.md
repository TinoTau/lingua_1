---
status: REFERENCE_DATA
baseline: FW_V4_FREEZE_2026_08_03
classified_by: 2026-08-04_Documentation_Governance_Residual_Backlog_Closure
---

# Lingua Engineering Principles（Project Constitution Extension）

**Version:** v1.0
**Status:** FROZEN
**Scope:** 全项目（Framework / Runtime / Dataset / Training / AI Model）

---

# 1. Single Source of Truth（SSOT）

每一项能力只能存在一个最终来源（Single Source of Truth）。

禁止：

* 多份 Contract
* 多份 Runtime 逻辑
* 多份 Decision
* 多份 Pipeline
* 多份 Dataset Contract
* 多份 Validation Logic

允许：

唯一 SSOT。

所有历史版本必须：

Archive。

---

# 2. Single Mainline

任何时候：

只能存在：

一个：

真正参与最终决策的主链。

禁止：

Shadow

A/B

Dual Pipeline

Second Pipeline

Compatibility Pipeline

Offline Replacement

Registry Routing

Runtime Switching

---

# 3. Function Exists ≠ Function Effective

任何功能：

不仅需要存在。

必须证明：

真正参与：

最终决策。

必须验证：

Function Exists

↓

Function Effective

↓

Decision Ownership

↓

Counterfactual Verification

否则：

视为：

Dead Feature。

---

# 4. Frozen Architecture First

任何开发：

不得：

修改：

冻结架构。

如需修改：

必须：

重新：

Architecture Review

↓

Architecture Audit

↓

Architecture Freeze

不得：

直接：

修改：

Runtime。

---

# 5. Responsibility Isolation

Framework

Dataset

Training

Runtime

Validation

Documentation

必须：

职责隔离。

任何模块：

只负责：

自己的：

职责。

禁止：

跨层：

Decision。

---

# 6. Dataset Foundation 与 Training Engineering 解耦

Dataset Foundation：

负责：

Dataset

↓

Materialize

↓

Manifest

↓

Adapter

↓

Alignment

↓

SyllableSample

Training Engineering：

负责：

Feature Shard

↓

Shard Reader

↓

Sequential Feature Reader

↓

Mini-batch Reader

↓

Training

**SSOT：** [docs/tone-v2/TONE_V2_TRAINING_ENGINEERING_FREEZE.md](../tone-v2/TONE_V2_TRAINING_ENGINEERING_FREEZE.md)

**禁止术语：** Streaming Feature · Streaming Training

两者：

不得：

互相修改。

---

# 7. Runtime 与 Model 解耦

Runtime：

不知道：

模型：

是谁。

模型：

不知道：

Runtime。

Runtime：

只认识：

Artifact Contract。

---

# 8. Data Source 可扩展

新增数据集：

只能：

新增：

DatasetAdapter

AlignmentProvider

禁止：

修改：

Training Foundation。

---

# 9. Alignment Provider Principle

Alignment：

不是：

TextGrid。

TextGrid：

只是：

当前：

默认：

Alignment Provider。

以后：

可以：

FW Timestamp

Forced Alignment

其它 Provider

但：

Dataset Contract：

保持：

不变。

---

# 10. Canonical Principle

任何时候：

只有：

一个：

Canonical。

例如：

Canonical Runtime

Canonical Dataset

Canonical Model

Canonical Contract

Canonical Feature

未来：

可以：

存在：

Candidate。

但是：

最终：

只有：

一个：

Canonical。

---

# 11. Runtime Validation Principle

Runtime Validation：

只能：

验证：

Runtime。

不能：

验证：

Dataset。

不能：

验证：

Training。

不能：

验证：

模型质量。

---

# 12. Dataset Probe Principle

Dataset Probe：

只负责：

Dataset。

不得：

参与：

Decision。

不得：

证明：

Runtime。

不得：

证明：

模型。

---

# 13. Four-Level Verification

Level 1

Unit Test

↓

Level 2

Dataset Probe

↓

Level 3

Runtime Validation

↓

Level 4

Architecture Verification

不得：

创造：

新的：

Verification Level。

---

# 14. Terminology Freeze

禁止：

Smoke

Deployment Smoke

Shadow

Registry

Switching

Second Pipeline

Dual Pipeline

A/B

作为：

正式：

术语。

历史：

必须：

标记：

Historical Issue。

---

# 15. No Hidden Logic

禁止：

隐式：

Rule

Weight

Gate

Fallback

Compatibility

Magic Number

Hardcode

所有：

Decision：

必须：

可追踪。

---

# 16. No Historical Residue

任何：

兼容代码

历史代码

Dead Code

Deprecated Logic

必须：

明确：

KEEP

MODIFY

RESTORE

DELETE

不得：

长期：

保留。

---

# 17. Counterfactual Verification

任何：

核心功能：

必须：

证明：

禁用：

以后：

系统：

出现：

可解释：

退化。

否则：

不能：

证明：

功能：

真正：

参与：

Decision。

---

# 18. Architecture Before Performance

任何：

性能优化：

不得：

修改：

Architecture。

不得：

修改：

Contract。

不得：

修改：

Decision。

---

# 19. Data Before Model

模型：

无法：

突破：

数据。

当：

连续：

多轮：

训练：

指标：

几乎：

一致。

首先：

分析：

Dataset。

禁止：

继续：

重复：

训练。

---

# 20. Tooling Before Scale

任何：

扩大：

Dataset：

之前。

必须：

完成：

Dataset Foundation

↓

Training Engineering

↓

Tooling

否则：

禁止：

扩大：

训练规模。

---

# 21. Canonical Dataset Principle

当前：

AISHELL-3：

定义为：

Current Canonical Training Dataset。

未来：

允许：

新增：

Dataset。

但：

任何时候：

只有：

一个：

Current Canonical Dataset。

---

# 22. Freeze Before Iterate

任何：

Foundation：

完成：

以后。

必须：

Freeze。

之后：

只能：

新增：

Capability。

不得：

持续：

修改：

Foundation。

---

# 23. AI Development Principle

AI：

负责：

能力。

Framework：

负责：

稳定。

Dataset：

负责：

知识。

Training：

负责：

学习。

Runtime：

负责：

部署。

任何：

模块：

不得：

承担：

其它：

模块：

职责。

---

# Final Principle

任何新增功能、模块、模型、数据集、接口或流程，在进入开发前必须回答四个问题：

1. 它属于哪个层（Framework / Dataset / Training / Runtime）？
2. 它是否破坏已有 Frozen Architecture？
3. 它是否真正进入唯一主链（Single Mainline）？
4. 它是否已经有 SSOT，还是正在制造新的 SSOT？

如果不能明确回答，则不得开始开发。
