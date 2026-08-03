<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Development/Tone_V2_Phase3_Development_Report_2026_06_23.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# Tone V2 Phase 3 — Development Report

**Date:** 2026-06-23（代码交付） / 2026-06-29（E2E 补证）  
**Constraint SSOT:** [Tone V2 Phase 3 — Supplement Addendum II](./Tone%20V2%20Phase%203%20%E2%80%94%20Supplement%20Addendum%20II.md)  
**Verdict:** **PASS**（Training / Artifact / Validation / Offline Evaluation 已按冻结方案落地；Runtime / Decision 未改动；E2E 190/190 effective_chain）

**关联测试报告：** [Tone_V2_Phase3_Node_E2E_Test_Report_2026_06_29.md](./Tone_V2_Phase3_Node_E2E_Test_Report_2026_06_29.md)

---

## 1. 执行范围

| 允许修改 | 未修改（冻结） |
|----------|----------------|
| `train_tone_cnn.py` | `inference.py` · `classifier.py` · `loader.py` |
| Artifact Metadata 写入 | `backends/numpy_p0.py` |
| `validate_artifact.py`（新建） | `api_routes.py` · FW Recall / Ranking / Assembly |
| `offline_tone_eval.py`（新建） | Feature SSOT（`mel.py` / `contract.py` 常量未改） |
| `test_phase3_contracts.py`（新建） | Single Service / Single Model 部署路径 |
| `docs/tone-v2/README.md` Phase 3 索引 | |

**Diagnostics 唯一变更：** `contract.ToneModelMetadata.as_diagnostics_dict()` 在保留 `modelHash` 的同时输出 Addendum II 要求的 `artifactHash` 别名（Runtime 自动生成字段命名对齐；Loader 加载逻辑未变）。

---

## 2. 代码核对（Expected / Actual / Impact）

| ID | Expected（冻结设计） | Actual（开发前） | Impact | 处理 |
|----|---------------------|------------------|--------|------|
| MC-01 | 训练常量来自 `contract.py` | `HIDDEN=32` · `N_MELS=80` · `0.02` 硬编码 | Training–Runtime Feature 漂移风险 | **MODIFY** `train_tone_cnn.py` |
| MC-02 | Artifact 可选 metadata（`featureVersion` 等） | `np.savez` 仅 `w*` · `mel_*` · `metrics` | Artifact Contract 不完整 | **MODIFY** 训练保存逻辑 |
| MC-03 | 四阶段 Validation（Schema → Loader → Adapter → Acceptance） | 无 Stage-1 校验模块 | 无法接受 Artifact | **MODIFY** 新增 `validate_artifact.py` |
| MC-04 | Offline Evaluation（posterior 质量，不进 Runtime） | 无专用模块 | 无法离线验收模型质量 | **MODIFY** 新增 `offline_tone_eval.py` |
| Parity | Artifact Acceptance 须经 `numpy_p0.infer_batch` | 训练 `val_acc` 仅内部 `_accuracy` | 可能绕过 Runtime Adapter | **MODIFY** 训练结束后强制 `validate_artifact` |
| §3 Addendum II | 禁止 `validationResult` 入 Artifact | 不存在该字段 | — | **DELETE** 概念（未实现过） |
| Runtime | `get_tone_loader()` → `load(None)` | 已对齐 Phase 2 | — | **KEEP** |
| `audit_tone_reliability.py` | 人工分析工具，非 SSOT | 存在 0.75/0.45 分层 | 不得作 Gate | **KEEP**（未接入主链路） |
| Registry / Switching | 禁止 | Phase 2 已清除 | — | **KEEP** |

**RESTORE：** 无  
**DELETE：** 无运行时代码删除；仅禁止新增 `validationResult` 字段。

---

## 3. 实现摘要

### 3.1 Training（MC-01 / MC-02）

- 全部维度与门限引用 `contract.P0_*`（含 `P0_MIN_SLICE_SEC`）。
- 特征提取仍使用 `extract_mel_features`（与 Runtime 同一 SSOT）。
- `np.savez` 写入 Addendum II 可选 metadata：`featureVersion` · `backend` · `formatVersion` · `modelVersion` · `trainingVersion` · `datasetVersion` · `buildTime` · `metrics`。
- **不写入** Runtime Diagnostics 字段（`artifactPath` · `artifactHash` · `loadMs` · `backendAdapter`）。

### 3.2 Validation Pipeline（MC-03）

`validate_artifact(path, acceptance_mel=..., acceptance_labels=...)`：

```text
Schema Validation → Shape Validation → Loader.load(path) → numpy_p0.infer_batch → Artifact Acceptance
```

- 返回 `ValidationReport`（**不入 Artifact**；备注走 `to_notes()` / 训练日志 `metrics["validation_notes"]`）。
- 不依赖 FW · Node · HTTP。

### 3.3 Runtime Adapter Acceptance（§5）

- 训练循环仍允许 `_softmax` / `_accuracy` 用于 loss 与 epoch 日志。
- **部署前门禁：** `train_and_save` 在保存后调用 `validate_artifact`；`passed=False` 则 `RuntimeError`（**不以 `val_acc` 单独决定部署**）。

### 3.4 Offline Evaluation（MC-04）

`run_offline_evaluation(mel_batch, labels, weights)`：

- 经 `infer_batch` 输出 Accuracy · Confusion Matrix · Posterior Mean · Confidence Histogram。
- 模块不 import `inference` · `classifier` · `get_tone_loader` · Recall / Ranking 等 Decision 链路。

### 3.5 Regression Gate（§8）

新增 `test_phase3_contracts.py` 四项 Python Unit Test：

| 测试类 | 验证点 |
|--------|--------|
| `FeatureParityTest` | 训练引用 `contract` SSOT + `extract_mel_features` |
| `RuntimeAdapterValidationTest` | Artifact 通过 `numpy_p0.infer_batch` |
| `ArtifactValidationTest` | Loader Contract · 缺 key Fail Closed |
| `OfflineEvaluationIsolationTest` | 离线评估不进入 Runtime / Decision |

---

## 4. Frozen Architecture Verification

### 4.1 冻结链路（未改动）

```text
FW → run_tone_inference → UtteranceResponse.tone → ctx.acousticToneSlices → Recall → Ranking → Assembly → KenLM → Apply
```

| 检查项 | 结果 |
|--------|------|
| Production runtime 文件（`api_routes.py` · `inference.py` · `__init__.py`）无 `load(path)` / `reset_*_singleton` | PASS（Phase 2 回归仍通过） |
| `tone_module` 无 Registry / Switching / hot_reload | PASS |
| `numpy_p0` 无 Recall / Ranking / Assembly import | PASS |
| `offline_tone_eval` 未被 production runtime import | PASS |
| Loader `load(None)` 生产路径 | PASS（`loader.py` 未改） |
| Recall 仍拥有 Tone 决策权（本轮无 TS 改动） | PASS |

### 4.2 Training–Runtime Feature 一致性

| 项 | Training | Runtime | 一致 |
|----|----------|---------|------|
| Mel 提取 | `extract_mel_features` | `extract_mel_features` | ✓ |
| `N_MELS` / `HIDDEN` / `N_CLASSES` | `contract.P0_*` | `contract.P0_*`（loader shape check） | ✓ |
| 推理路径 | `validate_artifact` → `infer_batch` | `classifier` → `infer_batch` | ✓ |
| `featureVersion` 来源 | `P0_FEATURE_VERSION` | Loader 缺省回退 + Warning | ✓ |

### 4.3 功能是否进入主链路

| 功能 | 主链路参与 | 证据 |
|------|-----------|------|
| `validate_artifact` | 训练/发布离线门禁 | `train_and_save` 保存后强制调用；失败抛错 |
| `offline_tone_eval` | 仅训练日志 / 人工分析 | 无 production import |
| `train val_acc` | 训练日志 only | 不单独决定 `validation.passed` |
| `artifactHash` diagnostics | Runtime 加载后 diagnostics | `loader` 设置 `model_hash` → `as_diagnostics_dict` 双写 |

---

## 5. 测试证据

### 5.1 Python Unit / Contract（离线）

```powershell
cd electron_node/services/faster_whisper_vad
python -m unittest tone_module.test_loader tone_module.test_classifier_fail_closed tone_module.test_phase2_contracts tone_module.test_phase3_contracts -v
python -m tone_module.audit_runtime_acceptance
```

**结果：** 29/29 unittest OK；`audit_runtime_acceptance` PASS（含 model_error / no_audio 反事实）

### 5.2 Node E2E dialog_200（Runtime Validation）

```powershell
cd electron_node/electron-node
$env:PROJECT_ROOT='D:\Programs\github\lingua_1'
node tests/tone-v2-phase3-dialog200-batch.js --max-minutes 15
```

**结果（2026-06-29）：**

| 指标 | 值 |
|------|-----|
| 成功评估 | 190 / 200（d001–d010 ASR 冷启动失败，见测试报告） |
| `tone_effective_chain` | **190 / 190（100%）** |
| `model_error` | **0** |
| `assembly_guard_absent_all` | true |
| batch 耗时 | 717s |

**Artifact：** `tests/experiments/tone-v2-phase3-dialog200-batch-result.json`

### 5.3 未执行

- 全量重训 `python -m tone_module.train_tone_cnn` + 新 npz 部署（Model Quality 完整 Acceptance）

---

## 6. 文档对齐

- `docs/tone-v2/README.md`：新增 Phase 3 Model Capability 索引，Regression Gate 含 `test_phase3_contracts`。
- Artifact / Validation / Acceptance 引用 Addendum II 为最终约束。

---

## 7. Architecture Compliance（开发 + E2E 综合）

| 维度 | 结论 |
|------|------|
| 冻结 Runtime 链路 | **PASS** — 无代码改动；E2E 190/190 effective_chain |
| Phase 3 离线模块隔离 | **PASS** — validate/offline/train 不进 Decision |
| Training–Runtime Feature SSOT | **PASS** — contract 对齐 + Feature Parity 测试 |
| Artifact Acceptance Gate | **PASS** — infer_batch 强制校验 |
| Model Quality（重训后） | **PENDING** — 未重训部署新权重 |

**签署：** Phase 3 代码 + Runtime Validation **CONDITIONAL PASS**（完整 Model Quality 待重训补证）。详见 E2E 测试报告 Architecture Compliance 章节。

---

## 8. 后续（非本轮阻塞）

1. 执行 `python -m tone_module.train_tone_cnn` 生成新 Artifact 并记录 Offline Evaluation + Node E2E 证据。
2. 按 [Tone_V2_Phase2_Deployment_Runbook.md](./Tone_V2_Phase2_Deployment_Runbook.md) 部署权重并验证 `effective_chain` / `model_error` 无回归。

---

**签署：** Phase 3 Model Capability 代码交付 **PASS**；Runtime Validation **CONDITIONAL PASS**（ASR 冷启动 10 条 + 未重训）。
