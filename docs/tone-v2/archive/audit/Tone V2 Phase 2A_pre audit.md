请按照当前冻结架构和 Lingua Project Constitution，对 Tone V2 Phase 2 重新进行开发前只读代码审计。

本轮不是开发任务，不得修改代码、配置、模型、文档或测试数据。

本轮目标：

在 Tone V2 Phase 1 已冻结的基础上，重新确认 Phase 2 的真实开发起点，并审计当前代码是否具备进入 Phase 2 的条件。

特别注意：

Phase 2 不做单服务多模型。

Phase 2 不做 Model Registry。

Phase 2 不做 Backend Registry。

Phase 2 不做模型切换。

一个 Tone 服务实例只绑定一个模型、一个 backend adapter、一个 featureVersion。

如果未来需要增加新模型，应新增对应服务实例或独立服务适配，不得在同一个服务内部选择、切换或路由多个模型。

---

# 0. 审计依据

必须以以下内容为唯一依据：

- docs/tone-v2/TONE_V2_CONTRACT_FREEZE.md
- docs/tone-v2/Tone_V2_Phase1_Freeze_Report.md
- docs/tone-module/ARCHITECTURE.md
- docs/fw-detector/freeze/FROZEN.md
- docs/CODING/Lingua Project Constitution（Project SSOT）.md
- 当前仓库代码

不得参考已经废弃的 Phase 2-A Model Registry / Backend Registry / Model Switch 方案。

不得恢复或引入：

- Model Registry
- Backend Registry
- active model
- TONE_MODEL_ID
- registry default
- model switching
- hot switching
- runtime backend routing
- Assembly Tone Guard
- Shadow Tone
- Offline Tone
- Smoke Runtime
- Bootstrap
- Compatibility loader
- Gateway / Scheduler Tone harness

---

# 1. Frozen Architecture Verification

核对 Phase 1 冻结 Runtime 是否仍然成立：

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

必须逐 hop 检查：

代码入口
输入
输出
生产调用方
消费方
是否进入主链路
是否被旁路绕过
是否被后续模块覆盖
是否仍参与最终 Runtime

输出：

Frozen Architecture Matrix

字段：

| Hop | Expected | Actual | Effective | Impact | Severity | Verdict |

2. Phase 2 Direction Audit

请基于 Single Service / Single Model 原则，重新判断 Phase 2 应该从哪里开始。

允许的 Phase 2 方向只能是：

单模型 artifact contract 加固
单 backend adapter contract 加固
模型权重升级准备
featureVersion 与当前模型的绑定验证
模型质量提升前的训练数据 / 标注 / benchmark 准备
optional diagnostics 扩展

禁止的 Phase 2 方向：

单服务多模型
Model Registry
Backend Registry
模型切换
hot reload
runtime routing
多 backend dispatch
Required Schema breaking change
Runtime hop change
KenLM tone
Apply tone
Assembly Tone Guard
second pipeline
shadow runtime
offline runtime
smoke replacement
bootstrap fallback
compatibility layer

输出：

Phase 2 Direction Matrix

字段：

| Candidate Direction | Allowed / Forbidden | Reason | Drift Risk | Verdict |

3. Architecture Drift Audit

检查是否存在任何架构漂移或历史残留：

Model Registry 残留
Backend Registry 残留
active model / modelId 残留
TONE_MODEL_ID 残留
hot switch / reload 残留
backend dispatch 残留
第二 Tone Pipeline
独立 Node Tone Step
第二 HTTP tone 出口
Assembly Tone Guard
KenLM tone 参数
Apply tone 参数
Offline / Standalone / Shadow Runtime
Smoke Corpus 替代
Bootstrap / fallback / mock weights
Compatibility loader
Gateway / Scheduler Tone integration
临时测试路径进入主链

输出：

Drift Matrix

字段：

| Drift Item | Expected | Actual | Impact | Severity | Action |

Action 必须为：

KEEP / MODIFY / RESTORE / DELETE

4. Single Service / Single Model Audit

审计当前 Tone 服务是否符合：

One service instance
→ one model artifact
→ one backend adapter
→ one featureVersion
→ one TonePosterior output

必须检查：

tone_module/contract.py
tone_module/loader.py
tone_module/classifier.py
tone_module/config.py
tone_module/inference.py
api_routes.py
service.json
环境变量 / 模型路径

确认：

当前是否仍是单模型服务；
是否存在模型选择逻辑；
是否存在多个模型同时加载；
是否存在 backend routing；
是否存在运行时切换；
是否存在 registry / active model 概念；
TONE_MODEL_PATH 是否仅作为当前服务实例的固定模型路径；
新模型是否需要以新服务实例 / 独立服务适配方式接入。

输出：

Single Service / Single Model Matrix

字段：

| Item | Expected | Actual | Effective | Drift Risk | Verdict |

5. Ownership Matrix

核对 Phase 1 冻结 Ownership 是否仍然成立：

Tone = Posterior Provider
Recall = Tone Decision
Ranking = Sentence Ranking
Assembly = Sentence Assembly，不拥有 Tone Decision
KenLM = Language Model，不读 tone
Apply = Final Replace，不读 tone

必须检查是否出现：

双 Owner
Hidden Owner
Decision 被转移
Diagnostics 字段被误用于 Decision
Metadata 字段进入 Recall / Ranking
模型 / backend 直接输出 decision

输出：

Ownership Matrix

字段：

| Object / Module | Expected Owner | Actual Owner | Consumer | Decision Owner | Verdict |

6. Data Contract Audit

核对 Required Data Contract 是否保持不变：

TonePosterior:

{ t1, t2, t3, t4, t5 }

AcousticToneSlice:

{ start, end, tonePosterior, confidence }

UtteranceAcousticTonePayload:

{ toneEnabled, acousticToneSlices, sliceCount, toneConfidenceAvg?, skippedReason? }

HTTP skippedReason 只能是：

no_audio
no_timestamps
non_zh
model_error

必须确认：

Required 字段未被修改
Optional 字段未升级为 Required
Metadata 未进入 Runtime Required Schema
diagnostics 未进入 Decision
toneReason 未混入 skippedReason
backend / model / feature 字段没有进入 Recall / Ranking

输出：

Data Contract Matrix

7. Interface Contract Audit

检查接口契约是否保持：

run_tone_inference 输入 / 输出
ToneClassifier / Loader / Contract 模块边界
UtteranceResponse.tone
ASRResult.tone
ctx.acousticToneSlices
recallTopKForWindows tone 输入
tone-match-score
sentence rerank / KenLM / Apply 无 tone 输入

输出：

Interface Contract Matrix

字段：

| Interface | Expected | Actual | Effective | Breaking Risk | Verdict |

8. Model / Backend Adapter Readiness Audit

Phase 2 允许围绕单模型服务做模型能力提升，但不得做 registry 或 switching。

请审计当前代码中：

当前模型 artifact 是如何固定加载的；
backend adapter 是否已经明确；
模型 metadata 是否足以描述当前 artifact；
featureVersion 是否与当前 artifact 绑定；
loadError 是否可诊断；
backend 字段是否仅 diagnostics；
modelHash / modelVersion / formatVersion 是否未进入 Decision；
是否需要先清理已有 registry / dispatch 设计残留。

输出：

Model / Backend Adapter Readiness Matrix

并明确：

Phase 2 第一批允许开发项是什么。

9. Decision Path Matrix

必须确认 Tone 仍然只在 Recall / Ranking 生效：

Recall tone_exact / tonePenalty 是否存在
candidateScore 是否受 tonePenalty 影响
Ranking 是否使用 Recall 输出
Assembly 是否只消费 score，不重新解释 tone
KenLM 是否 tone-free
Apply 是否 tone-free

必须区分：

功能存在

和：

功能生效

输出：

Decision Path Matrix

字段：

| Function | Exists | Effective | Final Decision Position | Covered / Bypassed | Verdict |

10. Dead Feature Matrix

检查是否存在：

已删除但重新出现的 guard
orphan filter
unused type alias
dead diagnostics
unused metadata
unused loader method
unused backend field
unused featureVersion
tests only feature
docs only feature
diagnostics only but被文档说成生效的 feature
registry / switching 相关死代码或文档残留

输出：

Dead Feature Matrix

字段：

| Feature | Exists | Effective | Used By Main Runtime | Impact | Action |

11. Hidden Gate / Weight / Context Audit

检查是否存在隐性门控或权重失效：

toneTimestampOnlyEnabled
word_timestamps
minSliceSec
featureVersion alias
metadataWarning
skippedReason
no_timestamps
no_pattern
queue readiness
servicePreferences
TONE_MODEL_PATH
Recall fallback
tonePenalty weight
candidateScore 覆盖
Assembly bucket priority 覆盖 tone score
KenLM 覆盖 Recall choice

输出：

Hidden Gate Matrix

字段：

| Gate / Weight / Context | Expected | Actual | Failure Mode | Impact | Severity |

12. Regression Gate Audit

核对 Phase 1 冻结后必须保留的回归是否仍可执行：

Python loader tests
classifier fail-closed tests
FW readiness / queue recovery tests
freeze-contract tests
tone-match-score tests
tone-recall-counterfactual tests
dialog_200 Node E2E batch
d001 probe 条件项

必须区分：

FW-only

和：

Node E2E

不得用 FW-only 结果替代 Node E2E。

输出：

Regression Gate Matrix

13. Required Repair Matrix

对所有发现列出：

KEEP

MODIFY

RESTORE

DELETE

特别注意：

RESTORE 不能用于恢复已删除的 shadow / guard / offline / bootstrap / registry / switching。

如果发现历史漂移逻辑重新出现，默认 DELETE。

输出：

Required Repair Matrix

字段：

| Item | Expected | Actual | Impact | Severity | Action | Owner |

14. 报告输出要求

生成审计报告：

Tone_V2_Phase2_Restart_PreDev_Code_Audit_2026_06_XX.md

报告必须包含：

Executive Summary
Frozen Architecture Verification
Phase 2 Direction Audit
Architecture Drift Audit
Single Service / Single Model Matrix
Ownership Matrix
Data Contract Matrix
Interface Contract Matrix
Model / Backend Adapter Readiness Matrix
Decision Path Matrix
Dead Feature Matrix
Hidden Gate Matrix
Regression Gate Matrix
Required Repair Matrix
KEEP / MODIFY / RESTORE / DELETE
Final Verdict

Final Verdict 必须明确回答：

Phase 1 冻结是否仍然成立？
Tone V2 是否仍只有唯一 Runtime / Pipeline / Decision Path？
Tone 服务是否符合 Single Service / Single Model？
是否存在 Model Registry / Backend Registry / switching / routing 残留？
Tone 是否仍只在 Recall / Ranking 生效？
是否存在 Architecture Drift / Contract Drift / Decision Drift / Runtime Drift？
是否存在功能存在但不生效？
是否存在功能生效但被后续覆盖？
是否存在 hidden gate / hidden weight / context loss？
是否可以重新开始 Phase 2？
Phase 2 第一批允许开发项是什么？
是否有必须先修复的问题？

裁决只能使用：

PASS
CONDITIONAL PASS
FAIL