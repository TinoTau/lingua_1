# Tone V2 Phase 3 — Model Capability Foundation Freeze Audit Report

**Date:** 2026-06-29  
**Audit Type:** Read-only Freeze Audit（无代码 / 配置 / 模型 / 测试数据 / 既有文档修改）  
**Scope:** Phase 3 Model Capability **Foundation**（非 Model Quality）  
**依据（唯一）：**

- Tone V2 Phase 1 Freeze · Phase 2 Foundation Freeze  
- [Tone V2 Phase 3 — Model Capability Development Plan](./Tone%20V2%20Phase%203%20%E2%80%94%20Model%20Capability%20Development%20Plan.md)  
- [Phase 3 Supplement Addendum](./Tone%20V2%20Phase%203%20Development%20Plan%20%E2%80%94%20Supplement%20Addendum.md)  
- **[Phase 3 Supplement Addendum II](./Tone%20V2%20Phase%203%20%E2%80%94%20Supplement%20Addendum%20II.md)**（最终约束）  
- [Tone_V2_Phase3_Development_Report_2026_06_23.md](./Tone_V2_Phase3_Development_Report_2026_06_23.md)  
- [Tone_V2_Phase3_Node_E2E_Test_Report_2026_06_29.md](./Tone_V2_Phase3_Node_E2E_Test_Report_2026_06_29.md)  
- 当前仓库实际代码  

**证据产物：**

- `tone_module/test_phase3_contracts.py` · 29/29 unittest PASS  
- `python -m tone_module.audit_runtime_acceptance` PASS  
- `tests/experiments/tone-v2-phase3-dialog200-batch-result.json`（190/190 effective_chain；model_error=0）

---

## Executive Summary

| 项 | 裁决 |
|----|------|
| **Final Verdict** | **PASS** |
| Phase 3 Foundation 可冻结 | **是** |
| 可进入 Model Quality Development | **是** |
| 未重训权重是否阻塞 Foundation Freeze | **否**（符合 Addendum II §7 / §10 及审计指令） |

Phase 3 已形成可长期冻结的**模型开发基础**：Training 与 Runtime 解耦，Artifact 为唯一桥梁，Validation 为唯一离线部署门禁，Offline Evaluation 与 Runtime Validation 职责分离，Runtime / Decision / Contract / Service Boundary 保持 Phase 2 冻结不变。

---

## 一、Training Foundation Matrix

| 层级 | 设计 | 代码实现 | 测试 / 证据 | 可冻结 |
|------|------|----------|-------------|--------|
| **Training** | `train_tone_cnn.py`；常量来自 `contract.P0_*`；`extract_mel_features` | ✓ `train_tone_cnn.py` L32–34, L133, L179–183, L298+ | `FeatureParityTest` | **KEEP** |
| **Artifact** | npz：`w1,b1,w2,b2` required + optional metadata | ✓ `np.savez` 含 featureVersion/backend/formatVersion 等 | `ArtifactValidationTest` | **KEEP** |
| **Artifact Validation** | Schema → Shape → Loader | ✓ `validate_artifact.py` | `ArtifactValidationTest` | **KEEP** |
| **Runtime Adapter Acceptance** | 必经 `numpy_p0.infer_batch` | ✓ `_adapter_validation` → `infer_batch` | `RuntimeAdapterValidationTest` | **KEEP** |
| **Artifact Acceptance** | `validate_artifact.passed`；非 `val_acc` 单独门禁 | ✓ `train_and_save` L318+ `raise RuntimeError` if not passed | `ValidationReportContractTest` | **KEEP** |
| **Offline Tone Quality Evaluation** | posterior 质量；不进 Runtime | ✓ `offline_tone_eval.py` | `OfflineEvaluationIsolationTest` | **KEEP** |
| **Runtime Validation** | Node Integration；不回写 Artifact | ✓ `tone-v2-phase3-dialog200-batch.js` | E2E 190/190 effective | **KEEP** |
| **Node E2E** | 验证 Runtime 未回归；非模型质量验收 | ✓ 见 E2E 报告 | 非 Foundation 阻塞项 | **KEEP** |

**解耦确认：**

| 命题 | 结论 | 证据 |
|------|------|------|
| Training 与 Runtime 已解耦 | **成立** | 训练仅 import `mel` · `contract` · `validate_artifact`；无 `inference` / `classifier` / FW |
| Artifact 为唯一桥梁 | **成立** | Runtime 仅经 `Loader.load(npz)` → `infer_batch`；训练产出 npz |
| Validation 为唯一离线部署门禁 | **成立** | `validation.passed` 决定 train 是否成功；E2E 不替代 Validation |
| Offline Evaluation 不进入 Runtime | **成立** | 无 production import；Isolation 测试 PASS |
| 后续训练无需修改 Runtime | **成立** | 同 featureVersion + 同 adapter 契约下仅换权重 / 训练脚本 |

---

## 二、Frozen Runtime Matrix

| 检查项 | Phase 2 冻结 | Phase 3 后 Actual | 变化 |
|--------|-------------|-------------------|------|
| Runtime Hop | FW → `run_tone_inference` → `UtteranceResponse.tone` → `ASRResult.tone` → `ctx.acousticToneSlices` → Recall → Ranking → Assembly → KenLM → Apply | 未改 `inference.py` · `classifier.py` · `loader.py` · `numpy_p0.py` · `api_routes.py` | **无** |
| Decision Ownership | Recall 拥有 Tone Decision | E2E：`recall.toneEnabled=true`；`recallToneFallbackCount>0` | **无** |
| Required Contract | `TonePosterior` · `AcousticToneSlice` · `skippedReason` 四值 | `tone_types.py` 未改 | **无** |
| Single Service / Single Model | `get_tone_loader()` → `load(None)` | `test_phase2_contracts.LoaderContractTest` PASS | **无** |
| Assembly Tone Guard | 禁止 | E2E `assembly_guard_absent_all=true` | **无** |
| KenLM / Apply tone-free | 禁止 | 无 TS 改动 | **无** |

**裁决：** Runtime **完全保持** Phase 2 Foundation Freeze。

---

## 三、Training Boundary Matrix

**审计范围：** `train_tone_cnn.py` · `validate_artifact.py` · `offline_tone_eval.py`

| 禁止 Import / 耦合 | train | validate | offline_eval |
|-------------------|-------|----------|--------------|
| Runtime Decision (`inference` / `classifier`) | ✗ | ✗ | ✗ |
| Recall | ✗ | ✗ | ✗ |
| Ranking | ✗ | ✗ | ✗ |
| Assembly | ✗ | ✗ | ✗ |
| KenLM | ✗ | ✗ | ✗ |
| Apply | ✗ | ✗ | ✗ |
| `get_tone_loader` 生产单例 | ✗ | ✗（仅用 `ToneModelLoader` 离线校验） | ✗ |

**允许 Import：**

| 模块 | 用途 |
|------|------|
| `contract` | Feature SSOT |
| `mel.extract_mel_features` | 与 Runtime 同 baseline |
| `backends.numpy_p0.infer_batch` | Adapter Acceptance / Offline Eval |
| `loader.ToneModelLoader` / `ToneModelWeights` | Loader Contract 校验 / 权重类型 |

**裁决：** Training Boundary **成立**；无 Decision 泄漏。

---

## 四、Artifact Contract Matrix

| 字段类 | Addendum II / Loader | 训练写入 | Loader 读取 | 进入 Decision |
|--------|---------------------|----------|-------------|---------------|
| **Required** `w1,b1,w2,b2` | 必须 | ✓ | ✓ shape 校验 | **否**（仅权重） |
| `mel_mean` / `mel_std` | 可选归一化 | ✓ | ✓ | **否** |
| `featureVersion` | 来自 `P0_FEATURE_VERSION` | ✓ | ✓ 兼容集校验 | **否** |
| `backend` | optional | ✓ `P0_BACKEND` | diagnostics | **否** |
| `formatVersion` | optional | ✓ `npz-v1` | diagnostics | **否** |
| `modelVersion` | optional | ✓ | diagnostics | **否** |
| `trainingVersion` | optional | ✓ | diagnostics | **否** |
| `datasetVersion` / `buildTime` | optional | ✓ | diagnostics | **否** |
| `metrics` | optional | ✓（含 val_acc 观测） | 日志 only | **否** |
| `validationResult` | **禁止** | ✗ 不存在 | ✗ | **否** |
| `artifactPath` / `artifactHash` / `loadMs` | Runtime Diagnostics only | ✗ 不写入 npz | Loader 运行时填充 | **否** |
| `modelHash` | Runtime sha256 | ✗ 不写入 npz | `loader._file_sha256` → diagnostics | **否** |

**Loader Contract：** `validate_artifact` → `ToneModelLoader.load(path)` 与生产 loader 同契约；缺 key fail-closed。

**裁决：** Artifact Contract **成立**；Metadata **不进入** Runtime Decision。

---

## 五、Validation Matrix

| 阶段 | 职责域 | 实现 | 回写 Artifact |
|------|--------|------|---------------|
| Schema Validation | Offline | `_schema_validation` | **否** |
| Shape Validation | Offline | `_shape_validation` + `_validate_shapes` | **否** |
| Runtime Adapter Validation | Offline | `_adapter_validation` → `infer_batch` | **否** |
| Artifact Acceptance | Offline | `ValidationReport.passed` | **否**（仅 `to_notes()` / 训练日志） |
| Runtime Validation | Node Integration | `tone-v2-phase3-dialog200-batch.js` | **否** |

**职责分离：**

| 命题 | 结论 |
|------|------|
| Artifact Validation 属于 Offline | **是** — 无 FW/HTTP/Node 依赖 |
| Runtime Validation 属于 Node Integration | **是** — HTTP `run-pipeline-with-audio` |
| 两者无职责混淆 | **是** — E2E 不替代 `validate_artifact.passed` |

**裁决：** Validation Contract **成立**。

---

## 六、Runtime Adapter Matrix

| 检查项 | Expected | Actual | 裁决 |
|--------|----------|--------|------|
| 最终部署门禁经 Backend Adapter | `infer_batch` | `validate_artifact` + 生产 `classifier` 同路径 | **PASS** |
| 训练 `val_acc` 不单独决定部署 | Addendum II §5 | `passed` 由 schema/shape/loader/adapter 决定 | **PASS** |
| Loss / 内部 `_accuracy` 仅训练日志 | Addendum II §5 | epoch 日志 + `metrics.val_acc` 观测 | **PASS** |
| Calibration 不进 Runtime | Addendum II §6 | 无 calibration 模块接入 production | **PASS** |
| Artifact Acceptance 必经 `infer_batch` | Addendum II §5 | `_adapter_validation` 强制调用 | **PASS** |

**裁决：** Runtime Adapter Acceptance **成立**。

---

## 七、Offline Evaluation Matrix

| 检查项 | Expected | Actual | 裁决 |
|--------|----------|--------|------|
| Accuracy | ✓ | `run_offline_evaluation` | **PASS** |
| Confusion Matrix | ✓ | `_confusion_matrix` | **PASS** |
| Posterior Distribution | ✓ | `posterior_mean` | **PASS** |
| Confidence Distribution | ✓ | `confidence_histogram` | **PASS** |
| Calibration 未进入 Runtime | 禁止 | 无代码路径 | **PASS** |
| 未进入 Recall | 禁止 | 无 import | **PASS** |
| 未进入 Ranking / Penalty | 禁止 | 无 import | **PASS** |
| 未进入 Assembly / KenLM / Apply | 禁止 | 无 import | **PASS** |

**裁决：** Offline Evaluation **成功隔离**。

---

## 八、Feature SSOT Matrix

| 引用方 | SSOT 来源 | 硬编码漂移 |
|--------|-----------|------------|
| `contract.py` | `P0_*` · `ToneFeatureBaseline` | 基准定义点 |
| `mel.py` | import `P0_*` | 无（Phase 2 已冻结） |
| `inference.py` | `P0_MIN_SLICE_SEC` | 无 |
| `loader.py` | `P0_N_MELS` · `P0_HIDDEN` · `P0_N_CLASSES` | 无 |
| `train_tone_cnn.py` | `contract.P0_*` | 无 `HIDDEN=32` 等遗留 |
| `validate_artifact.py` | `P0_N_CLASSES` | 无 |
| `offline_tone_eval.py` | `P0_N_CLASSES` | 无 |

**裁决：** Feature SSOT **成立**；Training / Runtime / Loader 同源 `contract.py`。

---

## 九、Architecture Drift Matrix

| 漂移项 | 检查结果 | Severity | 处置 |
|--------|----------|----------|------|
| Registry / Backend Registry | 仅出现于 `test_phase2_contracts` 禁止列表扫描 | — | **KEEP** 无漂移 |
| Switching / Routing / Hot Reload | 未发现于 `tone_module` 生产代码 | — | **KEEP** |
| Shadow / Offline / Bootstrap Runtime | 无替代主链 | — | **KEEP** |
| Second Pipeline / Second Decision | 无 | — | **KEEP** |
| Assembly Guard / Tone Guard | `assembly_guard_absent_all=true` | — | **KEEP** |
| Hidden Gate / Hidden Weight | 无新增未文档化门控 | — | **KEEP** |
| Dead Feature | `validate_artifact` / `offline_tone_eval` 有测试覆盖且 train 调用 | — | **KEEP** |
| Context Loss | acousticToneSlices → Recall 链路 E2E 生效 | — | **KEEP** |
| `audit_tone_reliability.py` 0.75/0.45 | 人工工具；未接入 Gate | LOW | **KEEP**（非 SSOT） |
| `artifactHash` diagnostics 别名 | `contract.as_diagnostics_dict` 双写 | LOW | **KEEP**（命名对齐；Loader 逻辑未变） |

**裁决：** **不存在** Material Architecture Drift。

---

## 十、Regression Matrix

| Gate | 要求 | 状态 | 用途 |
|------|------|------|------|
| Feature Parity Test | Phase 3 §8 | ✓ `test_phase3_contracts.FeatureParityTest` | Training–Runtime baseline |
| Artifact Validation Test | Phase 3 §8 | ✓ `ArtifactValidationTest` | Loader Contract |
| Runtime Adapter Validation Test | Phase 3 §8 | ✓ `RuntimeAdapterValidationTest` | `infer_batch` |
| Offline Evaluation Isolation Test | Phase 3 §8 | ✓ `OfflineEvaluationIsolationTest` | 不进 Decision |
| Loader Contract Test | Phase 2+ | ✓ `test_loader` | Fail-closed |
| Counterfactual Test | Phase 1/2 | ✓ `test_classifier_fail_closed` + `audit_runtime_acceptance` | model_error / no_audio |
| Phase 2 Contract Scan | Phase 2 | ✓ `test_phase2_contracts` | Registry / load(None) |
| Node E2E Runtime Validation | Phase 3 §7 | ✓ 190/190 effective；0 model_error | **Runtime 未回归** |

**说明：** 本轮 Node E2E **不用于**模型质量验收；**未重训**不否决 Foundation Freeze（审计指令 + Addendum II §7 / §10）。

---

## 十一、Documentation Alignment Matrix

| 文档 | 与代码 / 冻结一致 | 漂移 |
|------|------------------|------|
| Phase 3 Development Plan + Addendum I/II | 一致 | — |
| Development Report 2026-06-23 | 一致 | — |
| Node E2E Test Report 2026-06-29 | 一致 | — |
| `README.md` | Phase 3 标为 IN PROGRESS | **LOW** — 冻结后应标 CLOSED（**MODIFY**，属冻结后文档同步，不阻塞 Foundation 裁决） |
| `TONE_V2_CONTRACT_FREEZE.md` | 未并入 Phase 3 Training Foundation / 新 Regression Gate | **LOW** — 应经 Frozen Architecture Update 同步（**MODIFY**，不阻塞 Foundation 代码冻结） |
| `ARCHITECTURE.md` | Runtime 段仍有效 | Phase 3 训练链可补充（**MODIFY**，后续文档任务） |

**裁决：** 代码与 Phase 3 方案 / 报告 **无 Architecture / Decision / Contract 漂移**；主契约 SSOT 文档滞后为**文档同步债**，不构成 Foundation FAIL。

---

## 十二、Freeze Decision — KEEP / MODIFY / RESTORE / DELETE

### 正式进入 Phase 3 Foundation Freeze（SSOT）

| 类别 | 内容 |
|------|------|
| **训练管线** | `tone_module/train_tone_cnn.py`（contract SSOT · metadata · post-save `validate_artifact`） |
| **Artifact 契约** | Required `w1,b1,w2,b2`；Optional metadata per Addendum II；禁止 `validationResult` |
| **校验管线** | `tone_module/validate_artifact.py`（Schema → Shape → Loader → Adapter → Acceptance） |
| **离线评估** | `tone_module/offline_tone_eval.py`（posterior 质量；隔离 Decision） |
| **回归门禁** | `tone_module/test_phase3_contracts.py` + 既有 Phase 2 gates |
| **部署烟测** | `tests/tone-v2-phase3-dialog200-batch.js` |
| **边界规则** | Training 不得 import Decision；Artifact 为唯一 Runtime Bridge；Adapter Acceptance 必经 `infer_batch` |
| **冻结延续** | Phase 1 + Phase 2 Runtime / Decision / Loader / Backend / Feature SSOT **全部 KEEP** |

### 属于后续 Model Quality Development（非 Foundation）

| 内容 |
|------|
| 全量重训 `python -m tone_module.train_tone_cnn` |
| Offline Evaluation **PASS 阈值**与质量基线 |
| 新权重 `TONE_MODEL_PATH` 部署 + 模型质量 E2E |
| CNN 结构改进 · CRNN · Transformer **训练脚本**（须遵守本 Foundation：同 bridge 或新 adapter + 新服务实例 per Phase 2） |
| 测试脚本 ASR 冷启动预热（d001–d010） |

### KEEP

Phase 1/2 全部冻结项 · `numpy_p0` · `loader` · `inference` · `classifier` · `contract` P0 常量 · `audit_tone_reliability`（人工）· `audit_runtime_acceptance`

### MODIFY（冻结后文档 / 运维；非 Foundation 代码）

- `TONE_V2_CONTRACT_FREEZE.md` — 并入 Phase 3 Foundation + Regression Gate  
- `README.md` — Phase 3 → CLOSED / FROZEN  
- `ARCHITECTURE.md` — Training Foundation 数据流段落  
- E2E 批脚本 — ASR ready probe  

### RESTORE

无。

### DELETE

- `validationResult` 作为 Artifact 字段（概念级；代码未实现）  
- Registry / Switching 路线（延续 Phase 2 DELETE；不得恢复）

---

## 十三、Final Verdict — 十二问答复

| # | 问题 | 答案 |
|---|------|------|
| 1 | Phase 3 Foundation 是否可以冻结？ | **是 — PASS** |
| 2 | Training Foundation 是否成立？ | **是** |
| 3 | Artifact 是否成为唯一 Runtime Bridge？ | **是**（npz → Loader → adapter → posterior） |
| 4 | Validation Contract 是否成立？ | **是** |
| 5 | Runtime Adapter Acceptance 是否成立？ | **是**（`infer_batch` 门禁） |
| 6 | Offline Evaluation 是否成功隔离？ | **是** |
| 7 | Feature SSOT 是否成立？ | **是**（`contract.py`） |
| 8 | Runtime 是否保持冻结？ | **是**（Phase 2 不变；E2E 190/190 effective） |
| 9 | 是否存在 Architecture Drift？ | **否**（无 Material Drift） |
| 10 | 后续 CNN/CRNN/Transformer 是否无需修改 Runtime 即可继续开发？ | **是** — 在遵守本 Foundation 前提下：同 `featureVersion` + 同 posterior 契约可仅换训练/权重；**新架构 / 新 featureVersion / 新 adapter 须新训练脚本 + 新 adapter 模块**；**新服务实例**规则仍适用 Phase 2 Freeze，**不得**改 Runtime Hop / Decision |
| 11 | 哪些内容正式进入 Phase 3 Foundation Freeze？ | 见 §十二 SSOT 表 |
| 12 | 下一阶段是否可直接进入 Model Quality Development？ | **是** |

---

## Final Verdict

# **PASS**

Tone V2 Phase 3 Model Capability **Foundation** 准予冻结。

---

## 冻结后约束（强制）

未来任何模型开发（CNN、CRNN、Transformer 等）**不得修改**已冻结的：

- Runtime · Decision · Contract · Service Boundary  
- Training Foundation 管线形态  
- Artifact Contract · Validation Contract  

如需修改上述内容，**必须重新执行完整冻结流程**。

Model Quality Development 可在本 Foundation 上直接进行，包括重训、离线质量验收、权重部署与模型质量观测 E2E；不得以模型质量结果否定已冻结的 Foundation 架构。

---

**审计员签署：** Read-only Freeze Audit · 2026-06-29  
**关联证据：** `tone-v2-phase3-dialog200-batch-result.json` · 29/29 unittest · `audit_runtime_acceptance`
