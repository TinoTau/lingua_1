Tone Model V2 Production Architecture（冻结方案）

版本：V2.0（Production）
状态：Architecture Freeze
适用范围：Tone Module 全量模型升级

1. 项目目标

Tone Module 已完成：

Runtime Integration
Feature SSOT
Production Artifact
Node E2E
Business Baseline

因此：

整个 Runtime 已冻结。

后续所有开发：

只允许修改 Tone 模型本身。

2. 已冻结内容（禁止修改）

以下模块已经完成验证，不再进入开发范围。

ASR
FW
↓

WordInfo
↓

Timestamp

冻结。

Runtime
processed_audio

↓

feature_v2

↓

Tone Runtime

↓

Posterior

冻结。

Feature Contract

输入固定：

64 Frame

×

83 Channel

不得修改。

Artifact Contract

保持：

Production npz

保持 Metadata。

保持 Loader。

Runtime API

保持：

Input

↓

Posterior

↓

AcousticToneSlice

不得修改。

Node

保持：

Tone

↓

Recall

↓

KenLM

完全冻结。

3. 当前 Production Baseline

当前：

conv1d_global_pool_v1

参数：

约：

14533

Validation：

71.44%

说明：

当前模型属于：

P9-A

Lightweight Validation CNN

用途：

验证 Feature
验证 Runtime
验证 Artifact
验证 Node

不是最终 Production 网络。

4. Tone Model V2 的定位

目标：

真正 Production 模型。

要求：

Accuracy

≈90%

保持：

Runtime

100%

兼容
5. Runtime Compatibility

以下接口全部保持一致。

Input：

64 × 83

Output：

5 Tone Posterior

Artifact：

npz

Runtime：

numpy backend

Node：

无需任何修改。

6. 新模型原则

不是：

Tiny CNN

而是：

Production CNN

但是：

不能改变：

Feature

Contract

Runtime

Artifact
7. 推荐网络

建议：

Input

64×83

↓

Conv1D

64

Kernel=5

↓

BatchNorm

↓

ReLU

↓

Conv1D

128

Kernel=5

↓

BatchNorm

↓

ReLU

↓

Residual

↓

Conv1D

128

Kernel=3

↓

BatchNorm

↓

ReLU

↓

Global Average Pool

↓

Dropout

↓

FC

128

↓

ReLU

↓

FC

64

↓

ReLU

↓

FC

5

保持：

Posterior

5 Class
8. 参数规模

当前：

14 K

建议：

250 K

～

500 K

原因：

当前：

Train

72.7%

Validation

71.4%

Gap 极小。

说明：

不是过拟合。

更像：

模型容量不足。

9. 为什么不用 CRNN

当前：

Feature：

64 Frame

已经覆盖一个音节。

因此：

优先验证：

增加 CNN Capacity

是否已经能够达到目标。

只有：

Production CNN

↓

仍然无法达到

≈90%

才进入：

CNN

+

BiGRU
10. 为什么暂不使用 Transformer

原因：

当前任务：

Single Syllable Tone Classification

不是：

长序列建模。

Transformer：

收益：

可能不足以抵消复杂度。

因此：

Production CNN：

优先。

11. 训练框架升级

保持：

Dataset：

AISHELL-3

Feature Cache：

997992

升级：

AdamW

↓

Cosine Scheduler

↓

Weight Decay

↓

AMP

↓

Early Stop

↓

Best Checkpoint

增加：

Confusion Matrix

Precision

Recall

F1
12. Dataset

保持：

AISHELL-3

保持：

Feature Cache

不得重新制作 Runtime Feature。

13. Label

保持：

当前：

5 Tone

Classification

不得修改：

Runtime Label。

14. 导出

继续：

Production npz

Metadata：

保持：

兼容。

Runtime：

无需修改。

15. 验证

至少输出：

Validation Accuracy

Per-class Accuracy

Precision

Recall

F1

Confusion Matrix

并与：

71.44%

直接比较。

16. Business Validation

生成：

新的：

Production Candidate

替换：

TONE_MODEL_PATH

重新执行：

Node

↓

Business Validation

不得修改：

任何：

Runtime。

17. 开发阶段
Phase A

Production CNN

开发。

目标：

≈250K

～

500K

Parameter
Phase B

Production Training。

重新训练。

Phase C

Business Validation。

重新测试。

Phase D

如果：

≈90%

则：

Promotion：

Production。

Phase E（备用）

如果：

Production CNN：

仍然：

不足：

≈90%

再进入：

CNN

+

BiGRU

而不是：

继续：

调整：

Tiny CNN。

18. 不再允许开发的内容

以下内容永久冻结：

FW

Node

Runtime

Feature

Artifact Contract

AcousticToneSlice

Recall

Lexicon

Domain Vote

KenLM

不得：

再次：

进入：

开发。

19. 最终目标

整个 Tone Module 后续路线冻结如下：

Feature V2
        ✅

↓

Production Runtime
        ✅

↓

Production Baseline
        ✅

↓

Tone Model V2
        ← 当前阶段

↓

Production Training

↓

Business Validation

↓

Accuracy ≈90%

↓

Production Release
需要补充的一点（建议作为 V2 开发前的第一步）

我建议不要直接开始实现上述网络。

先确认一个关键点：

当前 numpy_p1 导出器究竟支持哪些网络算子。

这是唯一还需要确认的技术问题，但它属于 Tone 模型内部实现，不是 Runtime 架构问题。

如果导出器目前只支持：

Conv1D
ReLU
Global Average Pool
FC

那么 V2 网络应首先设计成完全兼容这些算子；如果需要新增如 BatchNorm、Residual 等支持，应先扩展导出器和 numpy_p1 推理器，再开发新网络。这样可以确保 Runtime Contract 完全不变，同时避免开发完成后才发现无法导出或加载。