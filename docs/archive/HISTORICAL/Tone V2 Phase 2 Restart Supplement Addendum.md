<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Tone V2 Phase 2 Restart Supplement Addendum.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Tone V2 Phase 2 Restart Supplement Addendum

## 文档定位

本文档补充《Tone V2 Phase 2 Restart Supplement》。

仅补充开发约束、接口契约、实现边界、回归要求及验收标准。

不得修改 Phase 1 Freeze。

不得改变 Runtime Hop。

不得改变 Decision Ownership。

不得新增 Registry、Switching 或 Multi-Model 设计。

---

# 1. Backend Adapter Boundary Contract

Backend Adapter 的职责必须唯一且固定。

Runtime 数据流定义如下：

```text
Audio Slice
        │
        ▼
inference.py
        │
        ▼
mel.py
        │
Mel Feature
        │
        ▼
Backend Adapter
        │
        ▼
TonePosterior
```

职责划分：

### inference.py

负责：

* Audio Slice 管理
* 时间窗口组织
* 调用 Mel Feature

不得负责：

* 模型推理
* Decision

---

### mel.py

负责：

* Feature Extraction
* Mel Spectrogram
* Feature Baseline

不得负责：

* 模型推理
* Metadata
* Runtime Decision

---

### Backend Adapter

输入：

```text
mel_batch
```

输出：

```text
TonePosterior
```

Backend Adapter 仅允许负责：

* 权重加载
* 模型推理
* Posterior 输出

Backend Adapter 禁止负责：

* Feature Extraction
* Runtime Routing
* Model Selection
* Recall
* Ranking
* Assembly
* Diagnostics Decision
* HTTP Schema
* Node Schema

Backend Adapter 不得直接依赖：

```text
Recall
Ranking
Assembly
KenLM
Apply
```

---

# 2. Legacy FeatureVersion Contract

Phase 2 保持：

```text
P0_COMPATIBLE_FEATURE_VERSIONS
```

继续作为兼容集合。

目的：

允许已有生产 artifact 正常加载。

Phase 2：

不得删除。

不得缩减。

只有当所有生产 artifact 全部迁移完成，并重新执行 Freeze 后，才允许移除。

---

# 3. Production Loader Contract

生产 Runtime：

Loader 必须固定为：

```text
load(None)
```

Loader 自行读取：

```text
TONE_MODEL_PATH
```

禁止：

```text
load(path)
```

进入生产主链。

显式：

```text
load(path)
```

仅允许：

* Python Unit Test
* Loader Test
* Artifact Validation Tool

不得：

通过 HTTP、

Node、

Service API、

Diagnostics、

Runtime Reload

调用。

---

# 4. New Model Deployment Contract

新增模型：

不得通过：

```text
Model Registry
Backend Registry
Runtime Switching
Hot Reload
```

实现。

唯一允许方式：

```text
新模型
        │
        ▼
新增服务实例
        │
        ▼
独立 service.json
        │
        ▼
独立 TONE_MODEL_PATH
        │
        ▼
独立 Backend Adapter
        │
        ▼
Node 配置新的 Endpoint
```

不得：

在同一 FW Worker 内：

* 加载多个模型；
* 根据请求切换模型；
* 根据 metadata 选择模型；
* 根据 backend 字段切换推理。

---

# 5. Reset Singleton Contract

所有：

```text
reset_*_singleton
```

函数：

仅允许：

测试环境调用。

生产 Runtime：

禁止调用。

任何生产代码：

不得：

Import、

Invoke、

Indirect Invoke

Reset API。

Regression：

必须增加：

Production Runtime Scan。

确认：

生产路径不存在：

```text
reset_*_singleton
```

调用。

---

# 6. Deprecated Document Contract

以下文档：

```text
Registry
Switching
Multi-Model
Backend Registry
```

相关方案：

不得继续作为：

开发依据。

必须：

* DELETE；
  或：
* archive/deprecated；

并明确标注：

```text
Deprecated

Not SSOT

Do Not Use For Development
```

README：

不得继续引用：

上述文档。

---

# 7. Regression Gate Supplement

Regression 必须新增：

## Feature Baseline Test

验证：

```text
mel.py
```

使用：

```text
contract.py
```

唯一 Feature Baseline。

不得存在：

重复常量。

---

## Loader Contract Test

验证：

生产 Runtime：

只能：

```text
load(None)
```

不得：

调用：

```text
load(path)
```

---

## Backend Boundary Test

验证：

Backend Adapter：

仅输入：

```text
Mel Feature
```

仅输出：

```text
TonePosterior
```

不得引用：

```text
Recall
Ranking
Assembly
KenLM
Apply
```

---

## Deployment Boundary Test

验证：

生产 Runtime：

不存在：

```text
Registry
Switching
Routing
Hot Reload
```

相关实现。

---

# 8. Acceptance Criteria Supplement

除主方案外，必须同时满足：

```text
Backend Adapter 不参与 Feature；

Feature Baseline 唯一来源；

Legacy FeatureVersion 保持兼容；

生产 Loader 仅允许 load(None)；

新模型必须新增服务实例；

生产 Runtime 无 Registry；

生产 Runtime 无 Switching；

生产 Runtime 无 Hot Reload；

Reset API 未进入 Runtime；

废弃 Registry 文档已删除或归档；

Regression 全部通过。
```

---

# 9. KEEP / MODIFY / RESTORE / DELETE

## KEEP

```text
Single Service / Single Model

Phase 1 Runtime Hop

Decision Ownership

Loader Fail Closed

Legacy FeatureVersion Compatibility

Offline Training Boundary
```

---

## MODIFY

```text
Backend Adapter Boundary

Loader Contract

Deployment Runbook

Regression Gate

Acceptance Criteria
```

---

## RESTORE

无。

禁止恢复：

```text
Registry

Switching

Shadow Runtime

Bootstrap

Compatibility Runtime
```

---

## DELETE

```text
Registry 相关方案文档

Switching 相关方案文档

Backend Registry 设计文档

废弃 Supplement Audit
```

---

# Final Constraint

Phase 2 允许增强模型能力。

Phase 2 不允许改变：

* Runtime；
* Contract；
* Decision；
* Ownership；
* Service Boundary。

任何引入：

```text
Model Registry

Model Switching

Runtime Routing

Multi-Model

Second Pipeline

Second Decision
```

即判定为：

```text
Architecture Drift
```

必须终止开发并重新执行冻结流程。
