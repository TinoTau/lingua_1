Tone V2 P8-C — Feature Contract Specification
Document Type

Frozen Feature Contract Specification

Relationship

本规范是 P8-C Feature V2 Foundation Specification 的数值契约补充。

本规范定义：

DSP Contract
Feature Contract
Tensor Contract
Extractor Contract
Shard Contract
Numerical Contract

不得修改 Runtime Architecture。

不得修改 Runtime Mainline。

不得新增 Runtime 功能。

1. Purpose

本规范用于冻结 Feature Foundation 的所有数值契约。

P8-C 定义：

Architecture。

Addendum 定义：

Implementation Boundary。

本规范定义：

Feature Contract。

任何 Feature Version 必须满足本规范。

2. DSP Contract

Feature V2 DSP 必须统一。

冻结：

Sample Rate
Frame Length
Hop Length
FFT Size
Mel Filter
Log Scale

DSP Contract 属于 Feature Contract。

Training 与 Runtime 必须完全一致。

任何修改：

必须升级 Feature Version。

3. Frame Contract

Feature Tensor：

固定：

64 Frames。

Frame 表示：

时间维。

不得：

Training：

48。

Runtime：

64。

Frame 数属于 Feature Contract。

4. Tensor Contract

Tensor Shape：

(Frame, Channel)

固定：

64 × 83

Rows：

Frame。

Columns：

Channel。

不得交换维度。

不得自动推断。

5. Channel Contract

冻结：

0~79

Log Mel

80

Log F0

81

Delta Log F0

82

Voiced Flag

Channel 顺序属于 Contract。

新增 Channel：

必须升级 Feature Version。

6. Interpolation Contract

Feature Tensor：

统一采用：

唯一：

Interpolation Algorithm。

Training。

Runtime。

Validation。

必须一致。

不得：

分别实现。

7. Padding Contract

Padding：

属于 Feature Contract。

Padding Policy：

唯一。

不得：

Training：

一种。

Runtime：

一种。

8. Crop Contract

Crop：

属于 Feature Contract。

Overflow：

统一处理。

不得：

Training。

Runtime。

分别实现。

9. F0 Contract

冻结：

Pitch Algorithm
Unvoiced Policy
Missing Policy
Smoothing Policy

任何修改：

必须升级 Feature Version。

10. Delta F0 Contract

冻结：

差分方向
边界处理
Unvoiced Frame

不得：

Training。

Runtime。

分别实现。

11. Voiced Contract

冻结：

Voiced Flag：

生成规则。

Training。

Runtime。

Validation。

必须一致。

12. WordInfo Adapter Contract

Adapter：

唯一职责：

SyllableSample

↓

WordInfo

不得：

修改：

Boundary。

不得：

重新估计：

Timestamp。

不得：

参与：

Feature。

不得：

参与：

Training Decision。

13. Extractor Contract

Extractor：

唯一接口：

extract_feature(
    audio,
    sampleRate,
    wordInfo
)

输出：

Feature Tensor

整个系统：

唯一。

Training：

Runtime：

共享。

14. Feature Tensor Equality Contract

对于：

Audio

+

WordInfo

Training。

Runtime。

必须生成一致 Feature Tensor。

允许：

浮点误差。

不得：

算法差异。

15. Feature Shard Contract

Feature Shard：

保存：

Feature Tensor
Tone Label
Feature Version

不得：

保存：

Runtime Object。

不得：

保存：

Dataset Object。

16. Numerical Tolerance

Feature Equality：

允许：

浮点误差。

不得：

结构误差。

Contract：

必须统一。

17. Contract Verification

必须验证：

DSP
Tensor Shape
Channel Layout
Feature Version
Interpolation
Padding
Crop
F0
Delta F0
Voiced

全部 PASS。

18. Regression Gate

新增：

Feature Equality Test
Tensor Contract Test
DSP Contract Test
Feature Version Test
Feature Shard Contract Test
Runtime / Training Equality Test

全部 PASS。

Final Contract

Feature Contract 是 Feature Foundation 的唯一数值定义。

Training。

Runtime。

Validation。

Feature Shard。

Model。

全部共享同一 Contract。

不得新增：

第二 Feature Contract
第二 DSP Contract
第二 Tensor Contract
第二 Extractor Contract

Feature Version 是唯一允许修改 Feature Contract 的入口。