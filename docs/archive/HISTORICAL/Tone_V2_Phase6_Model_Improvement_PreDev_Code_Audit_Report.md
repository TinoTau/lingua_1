<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/Tone_V2_Phase6_Model_Improvement_PreDev_Code_Audit_Report.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# Tone V2 Phase 6 — Model Improvement 开发前代码审计报告

**Date:** 2026-06-29  
**Audit Type:** Read-only Pre-Development Code Audit（**非训练** · **非 Runtime 开发**）  
**Scope:** 评估当前模型训练体系是否具备长期迭代能力；后续 `tone_cnn_p2` / `tone_cnn_p3` / `tone_crnn_p1` 等是否**无需修改** Runtime、Decision、Contract、Service Boundary、Training Foundation、Artifact Contract 与 Validation Pipeline  
**Phase 6 定位:** Model Improvement（同冻结架构下的模型质量迭代）

**依据 SSOT：**

- Phase 1 Freeze · [TONE_V2_CONTRACT_FREEZE.md](./TONE_V2_CONTRACT_FREEZE.md)
- [Tone_V2_Phase2_Foundation_Freeze_Audit_Report_2026_06_29.md](./Tone_V2_Phase2_Foundation_Freeze_Audit_Report_2026_06_29.md)
- [Tone_V2_Phase3_Model_Capability_Foundation_Freeze_Audit_Report_2026_06_29.md](./Tone_V2_Phase3_Model_Capability_Foundation_Freeze_Audit_Report_2026_06_29.md)
- [Tone_V2_P4_Training_Report.md](./Tone_V2_P4_Training_Report.md) · [Tone_V2_P4_tone_cnn_p1_Model_Freeze_Audit_Report.md](./Tone_V2_P4_tone_cnn_p1_Model_Freeze_Audit_Report.md)
- 当前仓库代码（`tone_module/*` · Node E2E 脚本 · FW Runtime）

> **说明：** 仓库内**未发现**独立「Phase 5」冻结文档或训练脚本增量。本审计将 **Phase 3 Training Foundation Freeze + Phase 4 训练/部署/Model Freeze 实践** 视为当前「模型开发平台」的实证基线；若项目口头所称 P5 指 P4 后续运维固化，与代码现状一致。

---

## Executive Summary

| 审计问题 | 结论 |
|----------|------|
| Training Pipeline 是否完全可复用？ | **同架构（P0 MLP）权重迭代：是**；**新架构（CRNN 等）：否**（须新训练脚本，符合冻结设计） |
| Artifact Contract 是否允许多 `modelVersion` 共享？ | **是** — `modelVersion` 为 optional diagnostics；Required schema 与 `featureVersion` 绑定 |
| Validation Pipeline 是否与模型结构解耦？ | **否** — 与 **P0 MLP + `numpy_p0`** 耦合；结构解耦仅在同 schema 内 |
| Offline Evaluation 是否可直接复用？ | **是**（同 backend / 同权重 schema） |
| Runtime Validation / Node E2E 是否无需修改？ | **基本无需改 Runtime**；E2E 脚本建议泛化（见 MODIFY） |
| Runtime / Decision 耦合？ | **无** — FW `tone_module` 不读 `modelVersion` 做决策 |
| `tone_cnn_p1` 特判？ | **Runtime 无**；仅 E2E 批脚本与默认路径残留 `p0`/`p1` 字符串 |
| Registry / Switching / 第二链路？ | **未发现** |
| **是否已形成可长期复用的 Model Development Platform？** | **CONDITIONAL PASS** |

### Final Verdict: **CONDITIONAL PASS**

**平台已成立（P0 MLP 权重迭代域）：** `tone_cnn_p2` / `tone_cnn_p3` 可沿 **Dataset → `train_tone_cnn` → npz → `validate_artifact` → `offline_tone_eval` → Node E2E → Model Freeze** 完成全生命周期，**无需修改 Runtime / Decision / Contract / Service Boundary**。

**平台边界（冻结设计内，非缺陷）：** `tone_crnn_p1` 属**新架构**，按 Phase 2/3 Foundation **允许且要求** MODIFY Training Foundation（新训练脚本 ± 新 adapter ± 新 `featureVersion`），**不得**假设「零 Foundation 改动」；Runtime Hop 仍可保持不变，但 Artifact / Validation 须扩展或并行。

---

## 1. Architecture Drift Audit

### 1.1 冻结主链（审计日代码）

```text
FW Worker → run_tone_inference → UtteranceResponse.tone
→ ctx.acousticToneSlices → Recall → Ranking → Assembly → KenLM → Apply
```

| 检查项 | Expected | Actual | Exists | Effective | Severity |
|--------|----------|--------|--------|-----------|----------|
| Runtime Hop | Phase 1 冻结 | `inference.py` → `classifier` → `numpy_p0`；Node `asr-step` → `acousticToneSlices` → Recall | ✓ | ✓ | — |
| Decision Ownership | Recall owns Tone | `recall-topk-for-windows.ts` · `computeToneScoreResult` | ✓ | ✓ | — |
| Single Service / Single Model | 单 env 路径 | `get_tone_loader().load(None)` + `TONE_MODEL_PATH` | ✓ | ✓ | — |
| Model Registry / Switching | 禁止 | `test_phase2_contracts` 全模块扫描 | ✗ | ✗ | — |
| Offline → Runtime Gate | 禁止 | `offline_tone_eval` 无 production import | ✓ | ✓ | — |
| Training → Decision | 禁止 | `train_tone_cnn` 无 recall/ranking import | ✓ | ✓ | — |
| `modelVersion` 进入 Decision | 禁止 | Loader / Classifier 仅 diagnostics | ✓ | ✓ | — |

**Material Architecture Drift：无**

### 1.2 训练侧漂移（非 Runtime）

| 区域 | Expected | Actual | Impact | Severity |
|------|----------|--------|--------|----------|
| 默认 artifact 文件名 | 运维可配置 | `config.py` / `loader.py` / `train_tone_cnn` 默认 `tone_cnn_p0.npz` | 易误部署旧默认 | **LOW** |
| E2E 脚本 | 模型无关 | `tone-v2-phase4-p1-deploy-dialog200-batch.js` 硬编码 p1 路径/SESSION | 每版复制脚本 | **LOW** |
| 数据集 | 可替换 | `DATASET_REPO` 硬编码 HF `CS5647Team3/data_mini` | 换数据集须改脚本或加 CLI | **MED** |
| CRNN 训练入口 | 新脚本（冻结预期） | **不存在** `train_tone_crnn.py` | 新架构须 Phase 6 开发 | **INFO**（设计内） |

---

## 2. Training Reusability Matrix

| 能力 | `tone_cnn_p2` / `p3`（同 P0 MLP） | `tone_crnn_p1`（新结构） | 代码锚点 | 裁决 |
|------|-----------------------------------|--------------------------|----------|------|
| 训练入口 | **复用** `python -m tone_module.train_tone_cnn` | **须新建** `train_tone_crnn.py`（或等价） | `train_tone_cnn.py` | p2/p3 **KEEP**；CRNN **MODIFY** |
| Feature 提取 | **复用** `extract_mel_features` + `contract.P0_*` | 若仍 80-dim mel：**复用**；若改特征：**新 featureVersion + 再冻结** | `mel.py` · `contract.py` | 同 mel **KEEP** |
| 网络结构 | **复用** 80→32→5 MLP | **不同** — 当前仅 `_train_mlp` | L168–234 `train_tone_cnn.py` | CRNN **MODIFY** |
| 元数据 CLI | **复用** `--model-version` `--output` `--training-version` | 同 | L361–381 | **KEEP** |
| 训练后 Validation | **复用** `validate_artifact` 内嵌调用 | 仅当输出满足 P0 schema + `numpy_p0` | L321–330 | 同 schema **KEEP** |
| 训练后 Offline Eval | **复用** `run_offline_evaluation` 内嵌 | 同 backend 时 **KEEP** | L332–353 | **KEEP** |
| Dataset 来源 | **硬编码** `CS5647Team3/data_mini` | 同脚本或新脚本 | L36–37 | **MODIFY**（`--dataset` CLI） |
| import Decision | **禁止** | 无违规 | `test_phase3_contracts` | **KEEP** |
| 第二训练链路 | **禁止** | 仅 `train_tone_cnn.py` 一条生产训练链 | — | **KEEP**（CRNN 为**新**链，非旁路） |

**Training Pipeline 可复用性：**

- **P0 权重迭代（p2/p3）：PASS — 完全可复用**
- **CRNN/Transformer：FAIL「零改动」— 须 Training Foundation MODIFY（与 Phase 3 Freeze §十二一致）**

---

## 3. Artifact Compatibility Matrix

### 3.1 Required Contract（`loader.py` · `TONE_V2_CONTRACT_FREEZE.md` §7）

| 字段 / 张量 | 约束 | 跨 `modelVersion` 共享？ |
|-------------|------|-------------------------|
| `w1,b1,w2,b2` | 固定 P0 shapes | **同架构共享 schema**；不同架构 **不兼容** |
| `mel_mean,mel_std` | (80,) optional | 同 `p0-v1` **共享** |
| `featureVersion` | `p0-v1`（Loader 校验） | **所有 P0 MLP 版本必须相同** |
| `backend` | `numpy_p0` | **共享** |
| `modelVersion` | optional string | **p0/p1/p2/p3 任意字符串，互不影响 Loader** |
| `trainingVersion` / `datasetVersion` / `metrics` | optional | **共享机制** |
| `validationResult` | **禁止** | 未实现 ✓ |

### 3.2 版本兼容表

| Artifact | `featureVersion` | `backend` | Weight Schema | Runtime Loader | 无需改 Runtime？ |
|----------|------------------|-----------|---------------|----------------|------------------|
| `tone_cnn_p0` | p0-v1 | numpy_p0 | P0 MLP | ✓ | **是** |
| `tone_cnn_p1` | p0-v1 | numpy_p0 | P0 MLP | ✓（已验证） | **是** |
| `tone_cnn_p2` | p0-v1 | numpy_p0 | P0 MLP | ✓（预期） | **是** |
| `tone_cnn_p3` | p0-v1 | numpy_p0 | P0 MLP | ✓（预期） | **是** |
| `tone_crnn_p1` | 可能需 **新** featureVersion | 可能需 **新** adapter | **非 P0 MLP** | **当前会 shape fail** | **Runtime Hop 可不变**；须 **新 adapter 文件** + Artifact/Loader 扩展或新服务实例（Phase 2 Freeze） |

**Artifact Contract 允许多 `modelVersion` 共享同一 Required schema：是（仅限同 `featureVersion` + 同 backend + 同张量形状）。**

---

## 4. Validation Reusability Matrix

| 阶段 | 实现 | 与 `modelVersion` 解耦？ | 与 **结构** 解耦？ | p2/p3 复用 | CRNN 复用 |
|------|------|-------------------------|-------------------|-----------|----------|
| Schema | `_schema_validation` | ✓ | ✗（固定 4 keys） | ✓ | 须扩展 keys |
| Shape | `_validate_shapes` / Loader | ✓ | ✗（P0 80×32×5） | ✓ | ✗ |
| Loader | `ToneModelLoader.load` | ✓ | ✗ | ✓ | ✗ |
| Adapter | `numpy_p0.infer_batch` | ✓ | ✗（MLP 图固定） | ✓ | 须新 adapter |
| CLI | 无 `__main__` | — | — | `python -c` 或 train 内嵌 | 同 |

**第二 Validation Pipeline：未发现**（仅 `validate_artifact.py` 单管线）。

**Validation 与模型结构解耦：否 — 与 P0 MLP + `numpy_p0` 正确耦合（冻结设计）。**

同架构权重升级：**validate_artifact 可直接复用，无需修改。**

---

## 5. Deployment Reusability Matrix

| 环节 | 机制 | `modelVersion` 特判？ | p2/p3 需改？ | 说明 |
|------|------|----------------------|-------------|------|
| 部署路径 | `TONE_MODEL_PATH` env | **无** | **否** | `ServiceProcessRunner` 继承 `process.env` |
| 默认回退 | `config.py` → `tone_cnn_p0.npz` | 文件名非特判 | 建议运维显式 env | **MODIFY** 文档/默认路径 |
| FW 加载 | `load(None)` | **无** | **否** | fail-closed |
| 热切换 | **禁止** | — | 换权重须重启 | Phase 2 Freeze |
| Node E2E（通用） | `tone-v2-phase3-dialog200-batch.js` | **无** | **否** | 模型无关指标 |
| Node E2E（P4 副本） | `tone-v2-phase4-p1-deploy-dialog200-batch.js` | 默认路径 → p1 | p2/p3 应改 env/OUT | **MODIFY** 泛化为单脚本 + `--out` |
| Model Freeze | 人工审计报告 | — | 复制报告模板 | **KEEP** 流程 |

**Runtime Validation（架构门）：无需修改代码即可部署新 P0 MLP 权重。**

---

## 6. Model Lifecycle Matrix

| 生命周期阶段 | 工具 / 产物 | p2/p3 可复用？ | CRNN 可复用？ | 改 Runtime？ | 改 Foundation？ |
|--------------|------------|---------------|--------------|-------------|----------------|
| Dataset | HF `data_mini` + `_data_cache` | ✓（同数据） | ✓ / 新数据须 CLI | 否 | 可选 **MODIFY** dataset CLI |
| Training | `train_tone_cnn.py` | ✓ | ✗ 新脚本 | 否 | CRNN：**MODIFY** |
| Artifact | `.npz` + metadata | ✓ | ✗ 新 schema 时扩展 | 否 | 可能 **MODIFY** Contract |
| `validate_artifact` | 四阶段门禁 | ✓ | ✗ 除非同 schema | 否 | 同 schema：**KEEP** |
| Offline Evaluation | `offline_tone_eval.py` | ✓ | 同 adapter 时 ✓ | 否 | **KEEP** |
| Deployment | `TONE_MODEL_PATH` + 重启 | ✓ | 新 adapter 时新实例 | 否* | 否* |
| Node E2E | phase3 batch + env | ✓ | ✓（架构门） | 否 | 否 |
| Model Freeze | 审计报告 + SHA256 | ✓ | ✓ | 否 | 否 |

\*CRNN 若需新 `backend` adapter 文件，Runtime **Hop 不变**，但 FW 内 `classifier` 委托的 adapter **须开发** — 属 Phase 2 允许的 adapter 扩展，**不是** Recall/Decision 改动。

### 8 项重点审计答复

| # | 问题 | 结论 |
|---|------|------|
| 1 | Training Pipeline 完全可复用？ | **同 P0 MLP：是**；**CRNN：否**（须新训练脚本 — 冻结预期） |
| 2 | Artifact Contract 允许多版本共享？ | **是**（`modelVersion` 仅 diagnostics；Required schema 共享） |
| 3 | Validation 与结构解耦？ | **否**（与 P0+`numpy_p0` 绑定 — 正确） |
| 4 | Offline Evaluation 直接复用？ | **是**（同 weights schema） |
| 5 | Runtime Validation 无需修改？ | **是**（运维 env 即可） |
| 6 | Node E2E 无需修改？ | **是**（用 phase3 通用脚本；避免 p4 硬编码副本） |
| 7 | 隐藏耦合/特判/第二链路？ | Runtime **无**；见 §7 残留项 |
| 8 | 完整生命周期仅走既定链路？ | **P0 MLP：是**；**CRNN：须 Foundation MODIFY 后成立** |

---

## 7. 残留项扫描（Runtime 耦合 · Hardcode · 特判）

| 类别 | 发现 | 位置 | 影响 | 处置 |
|------|------|------|------|------|
| **Runtime 耦合** | Training/Offline 未 import Runtime Decision | — | 无 | **KEEP** |
| **Model Hardcode** | 默认 `model_version="tone_cnn_p0"` | `train_tone_cnn.py` L255, L364 | 误用默认名 | **KEEP** CLI 覆盖；开训须 `--model-version` |
| **Feature Hardcode** | 已消除；训练引用 `contract.P0_*` | `test_phase3_contracts` 保障 | 无 | **KEEP** |
| **Dataset Hardcode** | `DATASET_REPO = "CS5647Team3/data_mini"` | `train_tone_cnn.py` L36 | 换数据集须改代码 | **MODIFY** `--dataset-repo` CLI |
| **路径硬编码** | `tone_cnn_p0.npz` 默认 | `loader.py` L29 · `config.py` L195 · `train_tone_cnn` L38 | 运维混淆 | **MODIFY** 文档/Runbook；改默认须再冻结 |
| **ModelVersion 特判** | **无** Runtime/Recall 分支 | grep 全仓 fw-detector | 无 | **KEEP** |
| **tone_cnn_p1 特判** | E2E 默认 `TONE_MODEL_PATH` → p1 | `tone-v2-phase4-p1-deploy-dialog200-batch.js` L29–38 | p2 脚本复制 | **MODIFY** 泛化 E2E |
| **隐藏门控** | 仅 `toneTimestampOnlyEnabled`（冻结） | Node Recall | 无新增 | **KEEP** |
| **兼容逻辑** | `P0_COMPATIBLE_FEATURE_VERSIONS` | `contract.py` | 冻结内 | **KEEP** |
| **Registry / Switching** | 未发现 | `test_phase2_contracts` | 无 | **KEEP** |
| **第二训练链路** | 无旁路 | 仅 `train_tone_cnn.py` | 无 | **KEEP** |
| **第二 Validation Pipeline** | 无 | 仅 `validate_artifact.py` | 无 | **KEEP** |
| **offline CLI** | 无独立 `__main__` | `offline_tone_eval.py` | 须 Python API 或 train 内嵌 | **MODIFY** 可选 CLI 包装 |

---

## 8. Required Improvement Matrix

| ID | 项 | 必要性 | 影响范围 | Phase 6 阻塞？ | 处置 |
|----|-----|--------|----------|---------------|------|
| RI-01 | 泛化 Node E2E 为单脚本（`TONE_MODEL_PATH` / `--out` / `--session`） | 中 | 测试 | **否** | **MODIFY** |
| RI-02 | `train_tone_cnn` 增加 `--dataset-repo` / `--cache-dir` 文档化 | 中 | 训练 | **否**（同数据集可不做了） | **MODIFY** |
| RI-03 | Runbook 钉死生产 `tone_cnn_p1` → 后续 p2/p3 切换步骤 | 低 | 运维 | **否** | **MODIFY** 文档 |
| RI-04 | `offline_tone_eval` 独立 CLI（`--artifact` `--output-json`） | 低 | 离线 | **否** | **MODIFY** |
| RI-05 | `validate_artifact` 增加 `python -m` CLI | 低 | 校验 | **否** | **MODIFY** |
| RI-06 | `train_tone_crnn.py` + 新 adapter（若 Phase 6 做 CRNN） | 高（仅 CRNN 路线） | Training Foundation | **是（CRNN 路线）** | **MODIFY**（冻结允许） |
| RI-07 | E2E ASR 预热 / 跑满 dialog_200 | 低 | 质量观测 | **否** | **MODIFY** 测试脚本 |
| RI-08 | Model Freeze 报告模板化 | 低 | 流程 | **否** | **KEEP** 人工审计 |

**无 RESTORE / DELETE 项**（Registry 路线继续 DELETE 概念，不得恢复）。

---

## 9. KEEP / MODIFY / RESTORE / DELETE

### KEEP（冻结 · Phase 6 不得触碰）

| 类别 | 内容 |
|------|------|
| **Runtime** | Hop · `inference.py` · `api_routes` tone 路径 |
| **Decision** | Recall `tone-recall` · `computeToneScoreResult` · Ownership |
| **Contract** | `TonePosterior` · `AcousticToneSlice` · `skippedReason` 四值 · P0 Feature SSOT |
| **Service Boundary** | Single Service / Single Model · `TONE_MODEL_PATH` · 禁止热切换 |
| **Loader** | `load(None)` · fail-closed · `_validate_shapes`（P0） |
| **Backend** | `numpy_p0.infer_batch` |
| **Training Foundation 核心** | `contract.py` · `validate_artifact` 四阶段 · `offline_tone_eval` 隔离 · `test_phase2/3_contracts` |
| **同架构迭代** | `train_tone_cnn.py` + CLI metadata |

### MODIFY（Phase 6 Model Improvement 允许 · 不触碰 Runtime/Decision）

| 项 | 说明 |
|----|------|
| **权重训练** | `tone_cnn_p2/p3`：`train_tone_cnn --model-version tone_cnn_pX --output ...` |
| **数据集** | 可选 CLI；或继续 `data_mini` |
| **E2E / 运维脚本** | 泛化 batch；ASR 预热 |
| **离线/校验 CLI** | 便利包装，非第二管线 |
| **CRNN 路线** | 新 `train_tone_crnn.py` + 新 adapter 模块 + 新 artifact 验收（**Training Foundation 扩展**，非 Runtime 开发） |
| **文档** | Runbook · SSOT 默认模型 · Phase 6 计划 |

### RESTORE

无。

### DELETE

| 项 | 说明 |
|----|------|
| Registry / Switching / 第二 Runtime Tone 管线 | 继续禁止 |
| `validationResult` artifact 字段 | 继续禁止 |
| 每模型复制一份 E2E 脚本（反模式） | 建议收敛为单脚本 |

---

## 10. Regression Gate（开发前基线）

| 门禁 | 审计日状态 |
|------|-----------|
| `test_phase2_contracts` | 可执行（部署边界 · Feature SSOT · Loader `load(None)`） |
| `test_phase3_contracts` | 可执行（Feature Parity · Adapter · Artifact · Offline 隔离） |
| `test_loader` | 可执行 |
| `validate_artifact(tone_cnn_p1.npz)` | **PASS**（P4 已证） |
| Node E2E 架构门 | P4：**109/109 effective_chain · 0 model_error** |
| Runtime 无 `modelVersion` 分支 | grep **PASS** |

Phase 6 开发不得使上述门禁回退。

---

## 11. 最终问题答复

### Q1：当前是否已形成可长期复用的 Model Development Platform？

**是 — 在明确定义的平台域内：**

```text
featureVersion = p0-v1
backend = numpy_p0
Weight schema = P0 MLP (80→32→5)
Posterior contract = TonePosterior t1–t5
```

该域内已具备：**训练 → artifact → 校验 → 离线评估 → 部署烟测 → E2E → Model Freeze** 闭环，且与 Runtime/Decision **解耦**。

**否 — 若将「平台」理解为任意架构（CRNN/Transformer）零 Foundation 改动：** 与 Phase 2/3 冻结冲突；CRNN 须 **Training Foundation MODIFY**，非平台缺失。

### Q2：后续模型开发是否可完全复用现有 Framework，而无需再次修改 Runtime 或 Foundation？

| 模型 | Runtime | Decision | Contract | Service Boundary | Training Foundation | Validation |
|------|---------|----------|----------|------------------|---------------------|------------|
| **tone_cnn_p2** | **无需** | **无需** | **无需** | **无需** | **无需**（CLI 即可） | **无需** |
| **tone_cnn_p3** | **无需** | **无需** | **无需** | **无需** | **无需** | **无需** |
| **tone_crnn_p1** | **Hop 无需** | **无需** | 可能 **扩展** | 可能 **新服务实例** | **须 MODIFY**（新训练脚本 + adapter） | **须 MODIFY** 或并行 adapter 验收 |

**简答：**

- **`tone_cnn_p2` / `p3`：可以。** 完全复用现有 Framework；仅运维 `TONE_MODEL_PATH`、CLI 元数据与 Model Freeze 文档。
- **`tone_crnn_p1`：不可以「零 Foundation 改动」。** 可复用 **Offline 评估模式、E2E 架构门、部署 Runbook、Model Freeze 流程**；须 **新增训练与 adapter 层**，**不得**修改 Recall/Ranking/Assembly 冻结链。

### Final Verdict: **CONDITIONAL PASS**

Phase 6（Model Improvement）**可以启动**：

1. **优先路线（推荐）：** P0 MLP 权重迭代 `tone_cnn_p2/p3` — **零 Runtime/Foundation 契约改动**。  
2. **扩展路线：** CRNN — 仅限 **Training / Adapter / Artifact** 扩展，须单独走 **Foundation 补充冻结** 后再训，不得偷改 Runtime Hop。

---

**审计员签署：** Read-only Pre-Development Code Audit · Phase 6 Model Improvement · 2026-06-29
