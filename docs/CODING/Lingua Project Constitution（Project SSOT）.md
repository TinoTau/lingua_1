# Lingua Project Constitution（Project SSOT）

## Purpose

以下规则适用于本项目所有：

* 代码审计
* 开发方案
* 开发
* 测试
* 验收
* 文档整理
* 架构分析
* Bug 修复
* 重构

这些规则优先级高于默认软件工程最佳实践、高于 AI 自主优化策略。

除非用户明确要求，否则不得违反。

---

# Rule 0：Single Runtime · Single Path · Single Truth（最高优先级）

本项目绝对禁止为了开发、测试、验证、兼容、过渡或演示而创建第二套实现。

整个项目始终只有：

* 一个 Runtime
* 一个 Pipeline
* 一个 Decision Path
* 一个 Benchmark
* 一个 Acceptance
* 一个 Dataset
* 一个 Contract
* 一个 Source of Truth（SSOT）

不得产生任何双链路。

---

## Tone V2 验收术语（子模块 · 与 Rule 0 一致）

Tone V2 文档与 Runbook **必须**使用 [docs/tone-v2/TONE_V2_TERMINOLOGY.md](../tone-v2/TONE_V2_TERMINOLOGY.md) 定义的 **四级验收体系**，不得用 Smoke / Deployment Smoke 描述验收类型：

| Level | 名称 |
|-------|------|
| 1 | Unit Test |
| 2 | Dataset Probe（含 Join Audit · Dataset Statistics Probe · Fixture Test） |
| 3 | Runtime Validation（`TONE_MODEL_PATH` → FW Restart → Node E2E） |
| 4 | Architecture Verification |

**Dataset Probe 不得替代 Runtime Validation。** 上文 Rule 0 禁止的 Shadow / Smoke Version 等与 Tone V2 禁止术语列表一致。

### Tone V2 Dataset Foundation（子模块 · Rule 0 澄清）

[Rule 0](#rule-0single-runtime--single-path--single-truth最高优先级) 中「一个 Dataset」指 **一个 Dataset Foundation SSOT**（框架与契约），**不是**「全世界只能有一种训练语料」。

| 角色 | 当前实现 |
|------|----------|
| **Dataset Foundation** | 唯一 — [TONE_V2_DATASET_FOUNDATION_FREEZE.md](../tone-v2/TONE_V2_DATASET_FOUNDATION_FREEZE.md) |
| **Current Canonical Training Dataset** | AISHELL-3（`openslr_aishell3`） |
| **Regression Fixture** | `data_mini` |
| **未来语料** | 仅 **新增** `DatasetAdapter` + `AlignmentProvider` — **禁止**第二条 Dataset Pipeline |

### Tone V2 Training Engineering（子模块 · Rule 0 澄清）

[Rule 0](#rule-0single-runtime--single-path--single-truth最高优先级) 中 Training 数据 **消费** Dataset Foundation 产出的 `SyllableSample[]`；IO 与物化由独立 SSOT 管辖。

| 角色 | 当前实现 |
|------|----------|
| **Training Engineering** | 唯一 — [TONE_V2_TRAINING_ENGINEERING_FREEZE.md](../tone-v2/TONE_V2_TRAINING_ENGINEERING_FREEZE.md) |
| **正式 Training IO** | Feature Shard → Shard Reader → Sequential Feature Reader → Mini-batch Reader → Training |
| **Canonical Feature Shard** | `openslr_aishell3/v1/training_features/`（P7-B2） |
| **未来模型** | `tone_cnn` · `tone_crnn` · 后续 — **复用** Training Engineering；改 IO 须再冻结 |

**Training Engineering 与 Dataset Foundation · Runtime 完全解耦。**

---

## 禁止新增

禁止新增任何：

* Smoke Version
* Shadow Runtime
* Shadow Pipeline
* Shadow Contract
* Shadow Dataset
* Shadow Benchmark
* Shadow Acceptance
* Shadow Metric
* Offline Runtime
* Standalone Runtime
* Temporary Runtime
* Compatibility Runtime
* Experimental Runtime
* Placeholder Runtime
* Bootstrap Runtime
* Fake Runtime
* Mock Runtime

如果真实功能尚未完成：

明确说明：

```text
当前功能尚未完成
```

不得创建临时方案。

---

## 不允许缩减任务

AI 不得主动缩减用户任务。

例如：

用户要求：

恢复 dialog_200

意味着：

恢复完整 dialog_200。

不得自动改为：

Smoke。

用户要求：

恢复 Runtime。

不得自动改为：

最小可运行版本。

如果当前无法完成：

直接说明：

未完成。

不要缩减 Scope。

---

## 不允许扩大任务

AI 不得主动扩大用户任务。

例如：

用户要求：

Node Runtime。

不得扩展：

Gateway

Scheduler

Web

用户要求：

Tone。

不得扩展：

System Integration。

用户要求：

Posterior。

不得扩展：

Decision。

---

# Rule 1：Frozen Architecture First

本项目采用 Frozen Architecture。

除非用户明确要求修改架构，否则不得：

* 修改责任边界
* 修改 Pipeline
* 修改 Runtime
* 修改 Contract
* 修改 Decision Ownership
* 修改 Data Flow

如果认为必须修改：

必须明确说明：

```text
以下内容将偏离 Frozen Architecture。
```

未经确认：

不得进入开发方案。

---

# Rule 2：Current Requirement First

只解决：

当前需求。

不要提前解决未来问题。

不要为了 Corner Case 增加复杂逻辑。

不要主动增加功能。

不要主动补充模块。

---

# Rule 3：Current Code SSOT

所有分析：

必须以：

当前代码

作为唯一事实。

不得依据：

历史方案。

不得依据：

未来规划。

不得推测当前实现。

---

# Rule 4：Single Responsibility

每个模块：

只允许承担：

冻结设计中的职责。

不得扩大。

例如：

Tone：

只负责：

Posterior。

不得承担：

* Decision
* Ranking
* Repair
* Replacement
* Filter
* Candidate Selection

Detector：

只负责：

Span Detection。

不得承担：

Repair。

---

# Rule 5：Fail Closed

本项目：

Fail Closed 优先。

不得为了：

继续运行：

增加：

* Bootstrap
* Fallback
* Silent Upgrade
* Compatibility Layer
* Fake Ready
* Mock Output

模型不存在：

就是失败。

不要自动降级。

---

# Rule 6：No Compatibility

本项目没有历史包袱。

没有线上兼容要求。

优先：

删除。

不要增加：

* Legacy Wrapper
* Compatibility Layer
* Transition Layer
* Deprecated Adapter
* Dual Logic

旧逻辑不用：

直接删除。

---

# Rule 7：Runtime First

所有设计：

围绕真实 Runtime。

不得为了：

测试、

Benchmark、

Evaluation

重新设计 Runtime。

不得新增第二条 Pipeline。

---

# Rule 8：Exist ≠ Effective

所有审计：

必须区分：

Exists

Effective

不仅检查：

是否存在。

还必须确认：

是否真正参与：

最终 Runtime。

最终 Decision。

---

# Rule 9：No Autonomous Optimization

AI 不得：

自主：

优化。

自主：

扩展。

自主：

降低开发量。

自主：

增加复杂度。

如果认为存在更好的方案：

必须明确标注：

```text
以下建议将改变当前设计，不属于 Frozen Architecture。
```

未经确认：

不得写入开发方案。

---

# Rule 10：Development Priority

所有开发：

严格遵循：

Frozen Architecture

↓

Current Requirement

↓

Current Code

↓

Minimal Modification

↓

Development

↓

Testing

不得反向推导架构。

---

# Rule 11：Decision Ownership Freeze

最终 Decision 永远属于冻结架构指定模块。

不得因为：

Benchmark、

Testing、

Runtime、

Diagnostics

改变：

Decision Ownership。

Tone 永远只是 Posterior。

Detector 永远只是 Detector。

Contract 永远只是 Contract。

---

# Rule 12：Architecture Drift Default Policy

如果发现：

* 第二条 Pipeline
* 第二条 Runtime
* 第二条 Benchmark
* 第二条 Dataset
* 第二条 Contract
* 第二条 Acceptance
* 第二条 Decision Path

默认判定：

Architecture Drift。

默认处理：

DELETE。

不要：

兼容。

不要：

等待以后清理。

除非用户明确要求保留。

---

# Rule 13：Before Every Proposal（必须先检查）

任何开发方案输出之前，必须先完成以下自检：

### Frozen Architecture Check

是否改变了冻结架构？

### Responsibility Check

是否扩大了模块职责？

### Runtime Check

是否创建了第二条 Runtime？

### Scope Check

是否扩大了用户任务？

是否缩减了用户任务？

### Contract Check

是否新增 Contract？

是否改变 Contract？

### Pipeline Check

是否新增第二条 Pipeline？

### Decision Check

是否改变最终 Decision Ownership？

### Shadow Check

是否新增：

* Smoke
* Shadow
* Offline
* Standalone
* Bootstrap
* Temporary
* Compatibility

如果任意答案为：

YES。

必须停止。

向用户说明原因。

不得继续输出开发方案。

---

# Final Principle

如果：

AI 默认最佳实践

与

用户当前需求

发生冲突。

永远：

优先：

用户需求。

如果：

Frozen Architecture

与

AI 自主优化

发生冲突。

永远：

优先：

Frozen Architecture。

如果：

开发便利性

与

Single Runtime · Single Path · Single Truth

发生冲突。

永远：

优先：

Single Runtime · Single Path · Single Truth。

任何违反上述原则的开发方案、代码、文档或测试，都应视为 Architecture Drift，不应进入开发阶段。
