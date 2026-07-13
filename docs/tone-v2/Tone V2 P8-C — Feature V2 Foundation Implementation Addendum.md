Tone V2 P8-C — Feature V2 Foundation Implementation Addendum
Document Type

Frozen Implementation Addendum

Relationship

本文件为 Tone V2 P8-C Feature V2 Foundation Specification 的唯一实施补充。

本文件不得修改 P8-C 的设计目标。

本文件仅补充：

实现约束
数据契约
接口契约
验收要求
Regression Gate
Frozen Architecture Verification

不得新增新的 Runtime 架构。

不得新增新的业务流程。

1. Purpose

本补充规范用于消除 Feature V2 Foundation 实施过程中仍可能产生的：

架构漂移
Contract 漂移
Runtime / Training 分叉
Ownership 漂移
Decision Drift
Semantic Drift

所有补充均建立在 P8-C 冻结架构之上。

2. KEEP

保持冻结：

Runtime Mainline
Runtime WordInfo SSOT
Dataset Foundation
Runtime Fail Closed
Single Feature Extractor
Single Feature Contract
Single Feature Tensor
Single Runtime Pipeline
Tone Posterior → Recall 主链

不得修改。

3. MODIFY

以下内容补充进入 P8-C。

M-01 Feature Tensor Shape

冻结：

Tensor Shape

(Frame, Channel)

Rows：

Frame。

Columns：

Channel。

不得交换轴序。

M-02 Frame Policy

冻结：

Feature Tensor：

64 Frames

Frame 数属于 Feature Contract。

不得由 Runtime 或 Training 单独决定。

M-03 Interpolation Policy

Interpolation：

属于：

Feature Contract。

Training 与 Runtime 必须采用同一算法。

不得分别实现。

M-04 F0 Contract

冻结：

F0 Algorithm
Unvoiced Policy
Missing Value Policy
Smoothing Policy

任何修改：

必须升级 Feature Version。

M-05 Delta F0

冻结：

ΔF0 的定义。

包括：

差分方向
边界处理
Unvoiced Frame
M-06 Voiced Flag

冻结：

Voiced Flag 的生成规则。

不得由不同 Runtime 分别实现。

M-07 Feature Normalization Ownership

Signal Domain Normalization：

属于：

Feature Contract。

Dataset Statistics：

属于：

Model Layer。

Loader：

不得重新计算：

Normalization。

M-08 WordInfo Adapter

WordInfo Adapter：

必须输出合法 WordInfo。

不得：

生成空 Timestamp。

不得：

修改 Boundary。

Adapter：

仅负责：

Contract Conversion。

M-09 Shared Extractor

Training：

Runtime：

统一调用：

Feature Extractor。

不得：

复制 Feature 计算逻辑。

M-10 Boundary Consistency Gate

Canonical Feature Shard V2：

必须在：

Boundary Consistency PASS 后生成。

否则：

禁止生成 Canonical Dataset。

M-11 Runtime / Training Equality

对于同一：

Audio

+

WordInfo

Training：

Runtime：

必须生成一致的 Feature Tensor。

允许浮点误差。

不得存在算法差异。

4. RESTORE

恢复：

R-01

Training：

必须：

SyllableSample

↓

WordInfo Adapter

↓

WordInfo

↓

Feature Extractor

不得直接进入 Feature。

R-02

恢复：

Feature Foundation：

唯一 Owner。

Training。

Runtime。

Validation：

均为 Consumer。

R-03

恢复：

Single Feature Extractor。

不得保留多处 Feature 实现。

R-04

Boundary Audit：

恢复至 Feature Shard V2 构建之前执行。

5. DELETE

必须删除：

FeatureTimestampRecord
Training Timestamp Contract
Runtime Timestamp Wrapper
Runtime Feature
Training Feature
Compatibility Feature
Shadow Feature
Dual Pipeline
第二 Feature Foundation

所有删除项不得保留兼容逻辑。

6. Architecture Compliance Requirements

开发完成后必须验证：

Runtime Mainline 未改变；
Runtime WordInfo 仍为唯一 Timestamp Contract；
Feature Contract 唯一；
Feature Extractor 唯一；
Feature Tensor 唯一；
Runtime 与 Training 共用 Feature Foundation；
Dataset Foundation 未进入 Feature Foundation；
Feature Foundation 未进入 Runtime Decision Layer。
7. Semantic Acceptance

必须验证：

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

Feature Tensor 必须真实影响 Posterior。

Posterior 必须真实影响 Recall。

不得仅验证 Feature 能生成。

8. Regression Requirements

必须新增：

Boundary Consistency Gate
Feature Equality Test
Feature Contract Test
Feature Version Test
Tensor Shape Test
Runtime Mainline Test
Semantic Acceptance Test

所有 Gate 必须 PASS。

9. Final Frozen Rules

新增以下冻结原则：

FP-21 Feature Contract Ownership

Feature Contract 是 Feature Foundation 的唯一职责。

Feature Version、Tensor Layout、Feature Extractor 均由 Feature Contract 定义。

Extractor 必须实现 Contract。

不得反向定义 Contract。

FP-22 Runtime / Training Equality

Training 与 Runtime 的 Feature Foundation 必须完全一致。

Boundary Provider 可以不同。

Feature Contract 不得不同。

FP-23 Feature Equality Gate

相同 Audio 与 WordInfo 输入必须得到一致的 Feature Tensor。

该 Gate 为 Feature V2 Foundation 冻结前的必过门禁。

FP-24 Boundary Provider Independence

Boundary Provider 只负责提供 Boundary。

不得改变：

Feature Contract。

不得改变：

Feature Tensor。

不得改变：

Feature Version。

Final Verdict

本补充文档仅补充 P8-C 的实现约束与验收要求。

不修改 P8-C 的设计目标。

不修改 Runtime Mainline。

不新增任何新的 Feature Pipeline。

P8-C 与本补充文档共同构成 Tone V2 Feature Foundation 的唯一实施 SSOT。