# Tone V2 Phase 1 Development Plan Supplement

> **归档说明（2026-06-29）：** 本文档为 Phase 1 历史依据。文中「Backend Registry / Model Registry」等 Phase 2 展望 **已被废弃**；现行 Phase 2 Foundation 以 [TONE_V2_CONTRACT_FREEZE.md](./TONE_V2_CONTRACT_FREEZE.md)（Single Service / Single Model）为准。**不得**作为开发 SSOT。

## 0. 文档目的

本补充文档用于完善《Tone V2 Phase 1 — Contract Freeze & Loader Foundation Development Plan》。

本文件不新增业务功能，不改变既定设计目标，不引入第二链路。

仅补充：

* 实现约束
* 数据契约
* 接口契约
* 决策链路约束
* 验收标准
* 回归要求
* 架构漂移清理项

确保 Phase 1 开发完成后，验证的不只是功能存在，而是冻结架构仍然真实参与最终 Runtime 和最终 Decision。

---

# 1. Phase 1 边界补充

Phase 1 只允许完成：

```text
Contract Freeze
Loader Foundation
Metadata Contract
Feature Baseline
Diagnostics Optional Fields
Guard / Orphan 清理
Regression Gate 修复
```

Phase 1 禁止：

```text
CRNN
Public Model
Training
Model Selection
Backend Registry 完整实现
Gateway / Scheduler
Offline Benchmark
Standalone Tone
Shadow Runtime
**Historical Issue:** Smoke Corpus
第二条 Pipeline
第二个 Tone Decision Point
```

---

# 2. Runtime Freeze 补充

冻结 Runtime 顺序：

```text
FW Worker
→ run_tone_inference
→ UtteranceResponse.tone
→ ASRResult.tone
→ ctx.acousticToneSlices
→ Recall
→ Ranking
→ Assembly
→ KenLM
→ Apply
```

Tone 只允许作为：

```text
Posterior Provider
```

Tone 不允许承担：

```text
Decision
Repair
Candidate Selection
Filter
Assembly Guard
KenLM Rerank
Apply
```

---

# 3. Loader Foundation 补充

## 3.1 必须新增的模块边界

Phase 1 可以新增：

```text
tone_module/contract.py
tone_module/loader.py
```

建议职责：

```text
contract.py
→ metadata / contract dataclass / validation result

loader.py
→ load / unload / ready / metadata / backend
```

不得新增：

```text
第二个 inference 入口
第二个 HTTP tone 出口
第二个 Node tone 消费入口
```

---

## 3.2 Loader 与现有 Singleton 的关系

现有：

```text
get_tone_classifier()
```

仍为 Runtime 入口。

Phase 1 必须明确：

* Loader 是否由 `ToneClassifier` 调用；
* Loader 是否替代 `_load()`；
* `Unload()` 后 inference 行为；
* 重新 Load 是否允许热替换；
* Load 失败是否立即 fail-closed；
* 是否允许保留旧模型继续 ready=true。

裁决：

```text
Load 失败不得保留旧模型继续 ready=true。
Load 失败必须 ready=false。
```

---

## 3.3 Loader Fail-Closed Contract

任何模型加载失败：

```text
missing
corrupt
invalid format
metadata invalid
shape mismatch
backend unsupported
feature mismatch
```

必须返回：

```text
ready=false
toneEnabled=false
skippedReason=model_error
```

禁止：

```text
bootstrap
fallback
silent upgrade
mock weights
fake ready
legacy compatibility
```

---

# 4. Metadata Contract 补充

Phase 1 可以定义 Metadata Contract，但不得把未接线字段写成 Runtime Required。

## 4.1 Optional Metadata

允许新增 optional diagnostics：

```text
formatVersion
modelVersion
backend
featureVersion
modelHash
```

这些字段：

* 可进入 diagnostics；
* 可进入 loader metadata；
* 不得进入 Recall Decision；
* 不得进入 Ranking Decision；
* 不得进入 Assembly / KenLM / Apply；
* 不得成为 HTTP required schema；
* 不得成为 Node required schema。

---

## 4.2 Metadata Required 边界

Phase 1 可定义 Loader 内部 required metadata。

但 Runtime required schema 仍只能是：

```text
TonePosterior
AcousticToneSlice
UtteranceAcousticTonePayload
ASRResult.tone
ctx.acousticToneSlices
```

不得把：

```text
modelHash
backend
featureVersion
formatVersion
modelVersion
```

升级为 Node Runtime required 字段。

---

# 5. Feature Contract 补充

Phase 1 必须冻结 P0 Feature Baseline。

## 5.1 P0 Feature Baseline

```text
featureVersion = p0-v1
sampleRate = 16000
nMels = 80
nFft = 512
hopLength = 160
fMin = 50
fMax = 7600
minSliceSec = 0.02
```

## 5.2 Feature Ownership

```text
Feature extraction
→ Runtime / tone_module/mel.py

Feature version
→ Loader metadata / diagnostics

Model
→ 只消费 feature，不拥有 Runtime 输出契约
```

Feature 可以在未来修改，但必须 bump `featureVersion`。

Feature 修改不得改变：

```text
TonePosterior
AcousticToneSlice
UtteranceAcousticTonePayload
```

---

# 6. NPZ Normalization Contract

当前 P0 支持可选：

```text
mel_mean
mel_std
```

Phase 1 必须明确：

```text
mel_mean / mel_std 存在
→ 使用模型内归一化参数

mel_mean / mel_std 缺失
→ Runtime 无归一化或使用当前默认行为

缺失 mel_mean / mel_std
→ 不得 silent 修改 featureVersion
```

归一化策略必须与 `featureVersion` 绑定。

---

# 7. skippedReason Contract 补充

必须区分两层 skipped reason。

## 7.1 HTTP skippedReason

HTTP 层只允许：

```text
no_audio
no_timestamps
non_zh
model_error
```

## 7.2 Node toneSkippedReason

Node 诊断层可以包含：

```text
tone_timestamp_disabled
no_acoustic_slices
no_pattern
```

约束：

```text
HTTP skippedReason
≠
Node toneSkippedReason
```

两者不得混用。

---

# 8. Dedup Boundary Contract

Tone 推理位置冻结为：

```text
ASR success
→ run_tone_inference
→ dedup
```

Tone 必须使用：

```text
processed_audio
原始 word timestamps
```

不得改为：

```text
dedup 后文本
dedup 后 word timestamps
text-derived tone
```

Tone 必须保持声学来源。

---

# 9. Timestamp Alignment Contract

Tone pattern 生成依赖：

```text
acousticToneSlices
wordTimeSpans
syllable alignment
```

如果：

```text
slice 数
≠
音节数
```

则：

```text
no pattern
plain SQL fallback
```

该行为属于 Expected Behavior，不得通过 fake timestamp / equal split timestamp 修复。

---

# 10. HTTP Early Return Contract

ASR 早退路径允许没有 `tone` 字段。

例如：

```text
空 transcript
音频质量不足
ASR 未成功
```

冻结约束：

```text
ASR 成功路径必须尝试 Tone。
ASR 未成功路径 tone 可 absent。
```

不得为了补齐字段生成 fake tone。

---

# 11. ASR Rerun Boundary

当前 FW 生产路径：

```text
disableAsrRerun = true
```

ASR rerun 未复制 tone 属于非生产路径。

Phase 1 不修 rerun。

冻结说明：

```text
Tone V2 Contract 只覆盖 FW 生产路径。
ASR rerun 不属于 Tone V2 Phase 1。
```

---

# 12. Diagnostics Contract 补充

新增 optional diagnostics 只能挂载到：

```text
diagnostics.toneModule
```

允许：

```text
backend
modelVersion
featureVersion
modelHash
loadError
formatVersion
```

禁止：

```text
进入 Recall input
进入 Ranking score
进入 Assembly decision
进入 KenLM
进入 Apply
成为 HTTP required field
成为 Node required field
```

---

# 13. Assembly Tone Guard 裁决

## 13.1 裁决

```text
DELETE
```

删除：

```text
apply-tone-assembly-guard.ts
toneGuard 文档承诺
toneGuardBlockedCount
相关未生效测试
```

## 13.2 理由

Tone 已在：

```text
Recall
→ Ranking
```

通过：

```text
tone_exact
tonePenalty × candidateScore
```

生效。

Assembly 再增加 Tone Guard 会形成第二个 Tone Decision Point，违反：

```text
Single Decision Ownership
Single Runtime
Single Path
```

## 13.3 验收

必须确认：

```text
runDomainAwareAssembly
runSpanAssemblyV4Orchestrator
fw-detector-v4-path
```

均无：

```text
applyToneAssemblyGuard
toneGuardBlockedCount
ToneGuardBlockTrace
```

---

# 14. Orphan Filter 清理

当前存在独立：

```text
filter-domain-candidates-per-span.ts
```

但生产路径使用：

```text
assemble-domain-aware-span-sets.ts
```

中的内联逻辑。

裁决：

```text
DELETE orphan 或合并为唯一实现后删除重复入口。
```

不得保留两个同名/近似职责实现。

---

# 15. 类型与别名清理

删除或收敛：

```text
RankedSpanCandidateSet
ToneGuardBlockTrace
UtteranceTonePayload
UtteranceTonePayloadModel
```

要求：

* 无未导出类型 import；
* 无历史别名误导；
* 声学 Tone 统一使用 `UtteranceAcousticTonePayload`。

---

# 16. 文档 SSOT 同步

以生产事实为准：

```text
docs/fw-detector/assembly/FROZEN_V1_2.md
```

必须同步修改：

```text
RANKING_V1_2.md
ARCHITECTURE.md
diagnostics/FROZEN.md
```

删除所有声称 Assembly Tone Guard 生效的描述。

文档必须明确：

```text
Tone Effective Location = Recall / Ranking
Tone Not Effective Location = Assembly Guard / KenLM / Apply
```

---

# 17. Regression Gate 修复

## 17.1 GATE-RANK-02

当前测试断言 `pickTopKFromBuckets`，但生产路径使用：

```text
selectPerSpanCandidates
stableSortPicks
sameDomainCandidates
```

必须修改测试，使其验证生产路径。

禁止测试非生产路径造成假绿。

---

## 17.2 GATE-RANK-04

如果原测试覆盖 `applyToneAssemblyGuard`，应修改为负向测试：

```text
Assembly Tone Guard 不存在
生产 orchestrator 无引用
toneGuardBlockedCount 不存在
```

---

# 18. Semantic Acceptance 补充

必须验证 Tone 真的参与 Recall / Ranking。

## 18.1 反事实测试

配置：

```text
toneTimestampOnlyEnabled = true
```

应出现：

```text
tone pattern
tone_exact
tone penalty
```

配置：

```text
toneTimestampOnlyEnabled = false
```

应退化为：

```text
plain SQL
no tone penalty
```

这用于证明：

```text
Tone Exists
≠
Tone Effective
```

---

# 19. Regression List 补充

Phase 1 完成后必须执行：

```text
freeze-contract.test.ts
tone-match-score.test.ts
span-assembly-v4-tone-score.test.ts
test_classifier_fail_closed
audit_runtime_acceptance --part all
validate-dialog200-full.py
FW readiness / queue recovery tests
```

条件项：

```text
d001-timestamp-tone-probe.mjs
```

仅在 Electron Node 已启动且 ASR service 注册正常时执行。

必须区分：

```text
FW-only
Node E2E
```

不得把 FW-only 结果冒充 Node E2E。

---

# 20. Acceptance Criteria 补充

Phase 1 通过必须满足：

* Runtime hop 不变；
* Required schema 不变；
* Fail-closed 不变；
* Tone 只在 Recall / Ranking 生效；
* Assembly 无 Tone Decision；
* KenLM 无 Tone；
* Apply 无 Tone；
* Loader metadata 不进入 Decision；
* Feature baseline 已冻结；
* No shadow；
* No minimal-only corpus gate；
* No offline；
* No standalone；
* No bootstrap；
* No compatibility wrapper。

---

# 21. Architecture Compliance Criteria

必须验证：

```text
FW Worker
→ Tone
→ HTTP
→ Node
→ Recall
→ Ranking
→ Assembly
→ KenLM
→ Apply
```

仍为唯一链路。

不得出现：

```text
Tone Pipeline Step
Standalone Tone Service
Second Tone Output
Tone Assembly Guard
KenLM Tone Rerank
Apply Tone Decision
Gateway Tone Benchmark
Scheduler Tone Acceptance
```

---

# 22. Target List

## 必须完成

* [ ] 新增 `tone_module/contract.py`
* [ ] 新增或改造 `tone_module/loader.py`
* [ ] 明确 `get_tone_classifier()` 生命周期
* [ ] 冻结 P0 Feature Baseline
* [ ] 定义 Metadata Contract
* [ ] Diagnostics optional 字段挂载到 `diagnostics.toneModule`
* [ ] 删除 Assembly Tone Guard
* [ ] 删除 orphan filter 或收敛为唯一实现
* [ ] 删除 toneGuard 文档承诺
* [ ] 修复 GATE-RANK-02 测试漂移
* [ ] 增加 Semantic Acceptance 反事实测试
* [ ] 同步文档 SSOT

## 禁止完成

* [ ] CRNN
* [ ] Public Model
* [ ] Training
* [ ] Model Selection
* [ ] Backend Registry 完整实现
* [ ] Gateway / Scheduler
* [ ] Offline / Standalone / Shadow Runtime

---

# 23. Check List

开发完成后确认：

* [ ] `applyToneAssemblyGuard` 不存在或无生产引用
* [ ] `toneGuardBlockedCount` 不存在或已标记删除
* [ ] KenLM 无 tone 参数
* [ ] Apply 无 tone 参数
* [ ] `UtteranceAcousticTonePayload` 为唯一声学 Tone payload
* [ ] Loader failure 统一映射 `model_error`
* [ ] Metadata 字段不进入 Recall / Ranking
* [ ] Feature baseline 已写入 Freeze 文档
* [ ] HTTP skippedReason 与 Node toneSkippedReason 已区分
* [ ] dedup 前推理边界已文档化
* [ ] d001 probe 不作为 FW-only 验收替代

---

# 24. KEEP / MODIFY / RESTORE / DELETE

## KEEP

* Runtime hop
* Data schema
* Ownership boundary
* fail-closed
* `toneTimestampOnlyEnabled`
* Recall tone_exact
* Ranking tone penalty
* KenLM tone-free
* Apply tone-free
* Queue recovery
* No shadow / no offline / no bootstrap

## MODIFY

* Loader Foundation
* Metadata Contract
* Feature baseline documentation
* Diagnostics optional fields
* GATE-RANK-02
* Semantic Acceptance tests
* Documentation SSOT

## RESTORE

无。

不得恢复：

```text
shadow
offline
standalone
bootstrap
gateway tone harness
minimal-only corpus
```

## DELETE

* Assembly Tone Guard
* toneGuard documentation promise
* toneGuardBlockedCount
* orphan filter duplicate
* obsolete acoustic tone aliases
* non-contract audit artifacts inside `tone_module/` if they pollute API ownership

---

# 25. Final Constraint

Phase 1 的目标不是让模型更准。

Phase 1 的目标是让后续任何模型只能在唯一冻结链路中工作：

```text
Model / Backend / Feature
→ Loader
→ run_tone_inference
→ TonePosterior
→ AcousticToneSlice
→ Recall / Ranking
```

任何实现如果绕过该链路，或在 Assembly / KenLM / Apply 新增 Tone Decision，即使功能正确，也必须视为 Architecture Drift。
