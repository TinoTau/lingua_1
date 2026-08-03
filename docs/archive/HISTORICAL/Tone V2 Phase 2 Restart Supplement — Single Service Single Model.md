<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Tone V2 Phase 2 Restart Supplement — Single Service Single Model.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Tone V2 Phase 2 Restart Supplement — Single Service / Single Model

## 0. 文档目的

本文件用于补充重新启动后的 Tone V2 Phase 2 开发方案。

本阶段不采用 Model Registry、Backend Registry、模型切换、热切换或单服务多模型。

Phase 2 必须建立在 Phase 1 Freeze 之上，只允许增强单个 Tone 服务实例内的模型 artifact、backend adapter、metadata、diagnostics 与质量验证能力。

如与 Phase 1 Freeze 冲突，以 Phase 1 Freeze 为准。

---

# 1. Phase 2 总原则

Tone V2 Phase 2 必须遵守：

```text
One service instance
→ One model artifact
→ One backend adapter
→ One featureVersion
→ One TonePosterior output
```

如果未来需要新模型，应新增对应服务实例或独立服务适配，不得在同一个服务实例内做模型选择、模型切换、模型路由或多 backend dispatch。

---

# 2. 禁止项

Phase 2 禁止新增或恢复：

```text
Model Registry
Backend Registry
active model
TONE_MODEL_ID
registry default
model switching
hot switching
runtime backend routing
multi-model loading
multi-backend dispatch
Assembly Tone Guard
Shadow Tone Runtime
Offline Runtime 替代主链
**Historical Issue:** Smoke Runtime（现行不存在）
Bootstrap
Compatibility loader
Gateway / Scheduler Tone harness
```

如发现相关历史文档或代码残留，默认判定为 Architecture Drift，处理方式为 DELETE 或归档为废弃文档。

---

# 3. Phase 2 允许方向

Phase 2 允许开发：

```text
单模型 artifact contract 加固
单 backend adapter contract 加固
模型权重升级准备
featureVersion 与当前模型 artifact 绑定验证
训练数据 / 标注 / benchmark 准备
optional diagnostics 扩展
```

Phase 2 不允许改变：

```text
Runtime Hop
Required Data Contract
Decision Ownership
Recall Tone Decision
Ranking 关系
Assembly tone-free
KenLM tone-free
Apply tone-free
```

---

# 4. Single Model Artifact Contract

当前 Tone 服务实例只能绑定一个模型 artifact。

模型路径来源：

```text
TONE_MODEL_PATH
或默认 tone_cnn_p0.npz
```

`TONE_MODEL_PATH` 只表示当前服务实例的固定模型路径，不表示可切换模型列表。

模型路径变更后必须重启 FW Worker。

禁止在运行时通过 API、配置热更新、registry 或 active model 字段切换模型。

---

# 5. Single Backend Adapter Contract

Phase 2 可以将当前 NumPy 推理从 `classifier.py` 中抽出为单一 backend adapter，例如：

```text
tone_module/backends/numpy_p0.py
```

但不得新增：

```text
get_backend(name)
backend registry
backend routing table
multi backend dispatch
runtime backend selection
```

Backend adapter 只负责：

```text
Mel feature
→ model inference
→ ndarray[N,5]
```

Backend adapter 不得负责：

```text
Feature extraction
Metadata decision
Runtime routing
Recall decision
Ranking decision
Diagnostics decision
HTTP schema
Node schema
```

---

# 6. Feature SSOT Contract

Feature Baseline 必须保持单一 SSOT。

当前不允许 `mel.py` 与 `contract.py` 维护两份独立常量。

应收敛为：

```text
contract.py
→ Feature baseline SSOT

mel.py
→ 引用 contract.py 中的 Feature baseline
```

冻结基线仍为：

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

只有 Feature Extraction 发生变化，才允许 bump `featureVersion`。

仅更换权重或 adapter，不得修改 `featureVersion`。

---

# 7. Weight Upgrade Contract

Phase 2 可以替换模型权重，例如：

```text
tone_cnn_p0.npz
→ tone_cnn_p1.npz
```

但必须满足：

```text
Required payload 不变
TonePosterior 不变
AcousticToneSlice 不变
UtteranceAcousticTonePayload 不变
Runtime Hop 不变
Decision Ownership 不变
```

如果新权重使用相同 feature extraction，则 `featureVersion` 必须保持不变。

如果新权重需要不同 feature extraction，则不得直接接入当前服务，必须先定义新的 featureVersion 并重新走冻结流程。

---

# 8. New Model Deployment Contract

新模型不得通过同一服务实例内部切换实现。

新模型接入方式：

```text
复制或新增服务实例
→ 独立 port
→ 独立 env
→ 独立 TONE_MODEL_PATH
→ 独立 backend adapter
→ Node 指向对应 endpoint
```

不得在同一 FW Worker 内加载多个模型。

不得在同一 FW Worker 内根据请求选择模型。

---

# 9. Metadata Contract

Phase 2 可扩展 optional metadata，例如：

```text
modelVersion
trainingVersion
datasetVersion
buildTime
modelHash
notes
```

这些字段只能进入：

```text
diagnostics.toneModule
```

不得进入：

```text
Recall
Ranking
Assembly
KenLM
Apply
Required HTTP schema
Required Node schema
```

Metadata 不得影响最终决策。

---

# 10. Diagnostics Contract

允许新增 optional diagnostics：

```text
modelVersion
trainingVersion
datasetVersion
modelHash
backendAdapter
artifactPath
loadMs
```

所有字段均为 optional。

Diagnostics 只用于观测，不得参与：

```text
tonePenalty
candidateScore
Recall SQL
Ranking
Assembly
KenLM
Apply
```

---

# 11. Loader Contract

Loader 必须继续 Fail-Closed。

以下情况必须返回：

```text
ready=false
toneEnabled=false
skippedReason=model_error
```

包括：

```text
missing artifact
corrupt artifact
invalid shape
featureVersion mismatch
unsupported adapter
metadata invalid
```

禁止：

```text
fallback
bootstrap
mock weights
保留旧模型 ready=true
silent upgrade
compatibility runtime
```

---

# 12. reset singleton 约束

`reset_tone_loader_singleton` 或类似 reset 函数只允许测试使用。

禁止生产代码调用。

应增加注释或测试门禁，确认 reset / reload 不进入 Runtime 主链。

---

# 13. Offline Training Boundary

`train_tone_cnn.py` 可以作为离线训练工具存在。

但离线训练不得接入 Runtime。

离线 benchmark 不得替代 Node E2E。

训练产物只有在生成固定 artifact，并通过 Loader、FW Runtime、Node E2E、dialog_200 回归后，才允许作为模型权重进入服务实例。

---

# 14. Deprecated Registry 文档处理

废弃的 Registry / Switching 相关方案文档不得继续作为开发依据。

应处理：

```text
Tone_V2_Phase2A_Development_Plan_Supplement_Audit_2026_06_29.md
```

处理方式：

```text
DELETE
或
move to archive/deprecated 并在 README 标注“废弃，不得作为 SSOT”
```

不得 RESTORE 其中的 Model Registry、Backend Registry 或 switching 设计。

---

# 15. Regression Gate

Phase 2 完成后必须验证：

```text
Python loader tests
classifier fail-closed tests
FW readiness / queue recovery tests
tone-match-score tests
tone-recall-counterfactual tests
dialog_200 Node E2E batch
```

必须区分：

```text
FW-only
Node E2E
```

禁止用 FW-only HTTP scan 替代 Node E2E。

Node E2E 通过标准：

```text
tone_effective_chain == evaluated_count
model_error == 0
assembly_guard_absent_all == true
```

---

# 16. Acceptance Criteria

Phase 2 通过必须满足：

```text
Runtime Hop 未变化
Required Schema 未变化
Decision Ownership 未变化
Single Service / Single Model 成立
无 Model Registry
无 Backend Registry
无 switching
无 hot reload
无 backend routing
Feature Baseline 单一 SSOT
Loader Fail-Closed 保持
Tone 仍只在 Recall / Ranking 生效
Assembly / KenLM / Apply tone-free
dialog_200 Node E2E 无回归
```

---

# 17. Architecture Compliance Criteria

开发完成后必须证明：

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

仍为唯一 Runtime。

不得出现：

```text
第二 Runtime
第二 Pipeline
第二 Tone Decision
Model Registry
Backend Registry
Model Switching
Hot Reload
Shadow Tone
Offline Runtime
Bootstrap
Compatibility Loader
```

---

# 18. KEEP / MODIFY / RESTORE / DELETE

## KEEP

```text
Phase 1 Runtime Hop
Required Data Contract
Ownership Contract
Loader Fail-Closed
Recall tonePenalty
Ranking 使用 Recall score
Assembly tone-free
KenLM tone-free
Apply tone-free
Single Service / Single Model
TONE_MODEL_PATH as fixed model path
train_tone_cnn.py as offline tool only
```

## MODIFY

```text
单模型 artifact contract
单 backend adapter module
Feature SSOT 收敛
Optional metadata
Optional diagnostics
Weight upgrade runbook
New service instance runbook
reset singleton test-only guard
Regression documentation
```

## RESTORE

无。

禁止恢复：

```text
Assembly Tone Guard
Model Registry
Backend Registry
Shadow Runtime
Offline Runtime
Bootstrap
Compatibility Runtime
**Historical Issue:** Smoke Runtime（现行不存在）
```

## DELETE

```text
废弃 Registry / Switching 方案文档
或移动到 archive/deprecated 并明确标注废弃
```

---

# 19. Target List

Phase 2 第一批开发项：

```text
1. 收敛 feature baseline SSOT：mel.py 引用 contract.py
2. 抽出单一 numpy_p0 backend adapter，不引入 registry / routing
3. 加固 single model artifact contract
4. 扩展 optional metadata / diagnostics
5. 编写权重升级 runbook：更换 TONE_MODEL_PATH + 重启服务
6. 编写新模型新服务实例 runbook
7. 增加 reset singleton test-only guard
8. 归档或删除废弃 Registry 方案文档
9. 补充 Node E2E 验收标准
```

---

# 20. Check List

开发完成后确认：

```text
无 registry
无 switching
无 backend routing
无多模型加载
无 Runtime Hop 修改
无 Required Schema 修改
无 Recall / Ranking 接口修改
无 Assembly Tone Logic
无 KenLM Tone
无 Apply Tone
Feature baseline 单一来源
Loader fail-closed 仍生效
dialog_200 E2E 通过
```

---

# 21. Final Constraint

Phase 2 的目标不是重新设计 Tone Runtime。

Phase 2 的目标是在 Phase 1 已冻结的单服务单模型 Runtime 上，为后续模型质量提升建立稳定、可验证、不可漂移的 artifact / adapter / diagnostics 基础。

任何引入模型选择、模型切换、多 backend 路由或第二 Tone Decision 的实现，即使功能可运行，也必须判定为 Architecture Drift。
