<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/Tone_V2_Phase3_Model_Capability_Development_Plan_Supplement_Audit_2026_06_29.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# Tone V2 Phase 3 — Model Capability Development Plan Supplement Audit

**Date:** 2026-06-29  
**Type:** 只读审计（方案补充核对 · 非开发）  
**审计对象：** [Tone V2 Phase 3 — Model Capability Development Plan.md](./Tone%20V2%20Phase%203%20%E2%80%94%20Model%20Capability%20Development%20Plan.md)  
**对照：** [TONE_V2_CONTRACT_FREEZE.md](./TONE_V2_CONTRACT_FREEZE.md) · [Tone_V2_Model_Capability_PreDev_Code_Audit_2026_06_29.md](./Tone_V2_Model_Capability_PreDev_Code_Audit_2026_06_29.md) · 当前仓库代码

---

## Executive Summary

Phase 3 方案**方向正确**：与 Phase 1/2 Foundation 冻结一致，明确将开发限制在 Training / Artifact / Validation / Offline Evaluation，禁止 Runtime/Decision 变更。

与**当前代码**对照：Target List MC-01–MC-04 **均未落地**（与 Pre-Dev 审计一致）；方案存在 **14 项设计缺口/歧义**、**6 项代码与方案未对齐**、**4 项隐含前提未写明**、**3 项测试/验收缺口**。

**无** Tone Model Registry、无训练进 Runtime 主链、无 Recall 被 posterior 质量门控覆盖。

**审计裁决：CONDITIONAL PASS** — 方案可作为 Phase 3 开发依据，但须先吸收本补充清单（尤其 artifact 字段命名、Validation 边界、MC-07 量化标准、训练/推理 parity、SSOT 索引）。

---

## 1. 与冻结设计一致性

| 维度 | Phase 3 方案 | 代码现状 | 一致性 |
|------|--------------|----------|--------|
| Runtime Hop | 禁止改 | 未变 | ✅ |
| Required Data Contract | 禁止改 | `tone_types.py` | ✅ |
| Decision Ownership | 禁止改 | Recall `tonePenalty` | ✅ |
| Single Service / Single Model | KEEP | `get_tone_loader()` · `load(None)` | ✅ |
| Feature SSOT（Runtime） | contract 唯一 | `mel.py`/`inference.py` 已引用 | ✅ |
| Feature SSOT（Training） | train→contract | `train_tone_cnn` **硬编码** 80/32/0.02 | ❌ **MC-01 未做** |
| Artifact metadata | MC-02 目标 | `np.savez` **无** featureVersion 等 | ❌ **未实现** |
| Artifact Validation | MC-03 新增 | 仅 `test_loader.py` 片段覆盖 | ⚠️ **不完整** |
| Offline Evaluation | MC-04 新增 | 无专用模块 | ❌ **未实现** |
| Registry / Switching | 禁止 | 无 | ✅ |
| Phase 3 进 SSOT 索引 | 应列入 | `README.md` **无** Phase 3 | ⚠️ 文档缺口 |

---

## 2. 补充项清单

### 2.1 设计缺失 / 方案歧义

| ID | 补充内容 | 来源 | 风险 | 影响范围 | 建议 |
|----|----------|------|------|----------|------|
| **P3-01** | **§6 Required 字段写为「weights / bias」不准确**：Loader 实际为 `w1,b1,w2,b2` + optional `mel_mean,mel_std` | 设计缺失 | **MEDIUM** | Artifact 文档 · Validation | **MODIFY** 方案 §6 与 CONTRACT_FREEZE 对齐 |
| **P3-02** | **`validationResult` diagnostics（§11/§16）**：`contract.py` `ToneModelMetadata` **无** 此字段；Loader 不读 npz 内 validationResult | 设计缺失 | **MEDIUM** | metadata · diagnostics | **MODIFY** 方案：声明仅 diagnostics 可选；实现时扩展 `as_diagnostics_dict` **或** 仅存 `notes`；**不得**进 Loader gate |
| **P3-03** | **MC-02 仅列三种 metadata**，CONTRACT_FREEZE 另有 `datasetVersion`/`buildTime`/`notes`/`modelHash` | 设计缺失 | **LOW** | MC-02 范围 | **MODIFY** 方案：列全 optional 集或引用 CONTRACT_FREEZE §7 |
| **P3-04** | **§7 Validation 含「FW Runtime Validation」**：未定义是 validate 脚本内起 FW，还是部署后人工 Runtime Validation；易误解为改 Runtime | 设计缺失 | **HIGH** | MC-03 · 验收 | **MODIFY**：拆为 **Loader Validation（离线）** + **Runtime Validation（运维，非 validate 改 Runtime）** |
| **P3-05** | **MC-07「dialog_200 全量通过」无量化定义**：Foundation 用 `effective_chain`；模型质量阶段是否要求 CER 阈值、posterior 指标、仅无回归？ | 设计缺失 | **HIGH** | MC-06/07 · Acceptance | **MODIFY** §20：分层 — Foundation 回归（effective_chain/model_error） vs 模型质量（offline benchmark 阈值 + 可选 CER 观测） |
| **P3-06** | **Offline Evaluation 与 `audit_tone_reliability.py` 关系未写**：现有脚本为 FW HTTP 抽样，非 labeled accuracy | 设计缺失 | **MEDIUM** | MC-04 | **MODIFY**：标明 legacy probe；MC-04 为**新** labeled offline 模块 |
| **P3-07** | **训练/推理 parity**：方案要求 Feature 一致，但未要求 Validation 调用 `numpy_p0.infer_batch` 对照训练 `_softmax` | 设计缺失 | **MEDIUM** | MC-03 · MC-04 | **MODIFY**：Validation 必须经 **Runtime 同 adapter** 推理抽检 |
| **P3-08** | **Calibration**：Pre-Dev 审计提及，Phase 3 §9 仅 Confidence Distribution，无 calibration 目标/禁止进 Decision | 设计缺失 | **LOW** | 范围边界 | **MODIFY** §9：允许 offline calibration **研究**；**禁止** runtime 门控 |
| **P3-09** | **Regression List 未写 Python venv / 执行路径** | 设计缺失 | **LOW** | CI/本地 | **MODIFY** §19：`faster_whisper_vad` 目录 + `python -m unittest` |
| **P3-10** | **权重文件名 `tone_cnn_p1.npz` vs `modelVersion=p1`**：未约定命名与 metadata 对应 | 设计缺失 | **LOW** | 部署 | **MODIFY** Runbook 交叉引用 |
| **P3-11** | **Phase 3 文档未进 README SSOT/历史索引** | 文档漂移 | **MEDIUM** | 索引 | **MODIFY** README（冻结后或开发启动时） |
| **P3-12** | **§15「禁止 Runtime Cleanup」表述易歧义**：应明确为 Phase 3 **不得删除/重构 Runtime 代码** | 设计缺失 | **LOW** | 范围 | **MODIFY** 措辞 |
| **P3-13** | **`mel_mean_80_v1` legacy**：仅换权重须保持 `p0-v1`；方案 §10 正确但未写禁止训练写出 `mel_mean_80_v1` 除非刻意 legacy | 设计缺失 | **MEDIUM** | featureVersion | **MODIFY** §6/§10 |
| **P3-14** | **Node E2E 脚本仍名 `tone-v2-phase1-dialog200-batch.js`**：Phase 3 复用时的 session/产物命名 | 设计缺失 | **LOW** | MC-06/07 | **MODIFY** §19：可复用脚本，输出 `tone-v2-phase3-*-result.json` |

### 2.2 代码实现 vs 方案 Target（未实现 = 开发项）

| ID | 补充内容 | 来源 | 风险 | 影响范围 | 建议 |
|----|----------|------|------|----------|------|
| **P3-C01** | **MC-01：`train_tone_cnn.py` L33-35, L133 硬编码** `HIDDEN/N_MELS/0.02`；未 `import contract` | 代码实现 | **HIGH** | 训练 · Feature 漂移 | **MODIFY**（P0） |
| **P3-C02** | **MC-02：`np.savez` 无 `featureVersion`/`modelVersion`/`trainingVersion`** | 代码实现 | **MEDIUM** | artifact | **MODIFY**（P1） |
| **P3-C03** | **MC-03：无 `validate_artifact.py`**；`test_loader` 仅单元级 | 代码实现 | **MEDIUM** | 门禁 | **MODIFY**（P1） |
| **P3-C04** | **MC-04：无 offline labeled benchmark 模块** | 代码实现 | **MEDIUM** | 质量 | **MODIFY**（P1） |
| **P3-C05** | **训练内联 `_softmax` + 手工 MLP**，与 `numpy_p0.infer_batch` **重复实现** | 代码实现 | **MEDIUM** | parity 漂移 | **MODIFY**：训练后 validation 走 adapter；长期可训练脚本调用 `infer_batch` 算 val_acc |
| **P3-C06** | **`models/tone_cnn_p0.npz` 不在仓库**；`audit_runtime_acceptance` 已注明 deploy via `TONE_MODEL_PATH` | 代码实现 | **LOW** | 部署前提 | **KEEP** + 方案写清运维前提 |

### 2.3 架构漂移 / 旁路 / 失效

| ID | 补充内容 | 来源 | 风险 | 影响范围 | 建议 |
|----|----------|------|------|----------|------|
| **P3-D01** | **`audit_tone_reliability.py` 置信度分档 0.75/0.45 硬编码**：仅观测，**不进** Decision；易被误作质量门控 | 架构漂移（误用风险） | **MEDIUM** | 评估 | **KEEP** 脚本；**MODIFY** 方案标明非 MC-04 SSOT |
| **P3-D02** | **`tests/experiments/tone-module-p*.mjs/py`**：历史实验，mock posterior 测 Recall；**非**声学模型评估 | 文档/边界 | **LOW** | 评估 | **KEEP** 归档；**不得**当 Phase 3 benchmark |
| **P3-D03** | **`confidence` on slice Exists 但 Recall 不用**：Required 字段；非失效 | 代码实现 | **LOW** | Contract | **KEEP**；Phase 3 **禁止**将 confidence 接入 penalty |
| **P3-D04** | **`freeze-contract` CLEANUP-2** 仍失败 | 测试发现 | **MEDIUM** | `npm run test:fw-detector` | **MODIFY** 并行（非 Tone Phase 3 阻塞，但 §19 全量跑会红） |

### 2.4 隐含前提（方案应显式写出）

| ID | 前提 | 现状 | 若失效 |
|----|------|------|--------|
| **P3-P01** | 训练数据 HF `CS5647Team3/data_mini` 可下载 | `huggingface_hub` 在 requirements | 训练无法开箱 |
| **P3-P02** | 标注来自 TextGrid 拼音 tone1-5；与 Runtime 字级 timestamp **不同域** | train 音节级；Runtime 词级 slice | offline acc **不能**直接等于 E2E 提升 |
| **P3-P03** | 新权重部署：`TONE_MODEL_PATH` + **重启** FW | Runbook 已有 | 热切换假失败 |
| **P3-P04** | Node E2E 需 `servicePreferences` 启用 `faster-whisper-vad` | Phase 1/2 已记录 | E2E 假失败 |

### 2.5 Exists vs Effective

| 项 | Exists | Effective | 主链路 | 说明 | 建议 |
|----|--------|-----------|--------|------|------|
| `train_tone_cnn.py` | ✅ | ❌ Runtime | ❌ | 离线；**未** SSOT 对齐 | **MODIFY** MC-01 |
| `test_loader.py` | ✅ | ✅ 单测 | ❌ | 部分 Loader 契约 | **KEEP** + 扩展 validate |
| `numpy_p0.infer_batch` | ✅ | ✅ E2E | ✅ | Runtime 推理 | **KEEP** |
| `audit_tone_reliability` | ✅ | 手动 | ❌ | FW 抽样 | **KEEP** 非 SSOT |
| `audit_runtime_acceptance` | ✅ | 手动 | ❌ | 集成审计 | **KEEP** 非 MC-04 |
| MC-01–04 方案目标 | ✅ 文档 | ❌ 代码 | — | 待 Phase 3 开发 | **MODIFY** 按计划 |
| `confidence` → Decision | ✅ 字段 | ❌ | ❌ | 设计内 | **KEEP** 禁止接入 |

---

## 3. 矩阵摘要

### 3.1 Frozen Architecture Verification

与 Pre-Dev 审计一致：**Foundation 仍有效**；Phase 3 方案 **不冲突**。

### 3.2 Training Pipeline Boundary Matrix

| 边界 | 方案 | 代码 | 裁决 |
|------|------|------|------|
| Training 不进 Runtime | ✅ | train 无 loader/api import | **KEEP** |
| train→contract SSOT | ✅ | ❌ 硬编码 | **MODIFY** |
| mel 共享 | ✅ | train→mel→contract | **KEEP** |
| 训练→artifact→validate→部署 | ✅ | validate 缺失 | **MODIFY** |

### 3.3 Artifact Contract Matrix

| 字段 | CONTRACT_FREEZE | Phase 3 §6 | train 产出 | 裁决 |
|------|-----------------|------------|------------|------|
| w1,b1,w2,b2 | required | 「weights」 | ✅ | **MODIFY** 文档用词 |
| mel_mean/std | optional | 未写 | ✅ | **MODIFY** 方案补充 |
| featureVersion | optional | MC-02 | ❌ | **MODIFY** |
| modelVersion 等 | optional | MC-02 部分 | ❌ | **MODIFY** |
| validationResult | 方案 §11 | 有 | ❌ contract 无 | **MODIFY** 方案/contract 二选一 |

### 3.4 Feature SSOT Matrix

| 文件 | Runtime | Training | 一致？ |
|------|---------|----------|--------|
| contract.py | SSOT | 应引用 | train **未**引用 |
| mel.py | ← contract | ← mel | ✅ 间接 |
| inference.py | ← contract | — | ✅ |

### 3.5 Runtime Non-Interference Matrix

| 风险 | 状态 |
|------|------|
| 训练 hook Loader/Inference | ❌ 无 |
| offline metric 进 Recall | ❌ 无 |
| validationResult 进 Decision | ❌ 无（未实现） |
| Registry | ❌ 无 |

---

## 4. Required Repair Matrix（开发前吸收）

| 优先级 | ID | 动作 | 处置 |
|--------|-----|------|------|
| P0 | P3-C01 / P3-01 | 方案 §6 字段精确化 + train→contract | **MODIFY** |
| P0 | P3-04 | Validation 分层定义 | **MODIFY** 方案 |
| P1 | P3-C02–C04 | MC-02/03/04 实现 | **MODIFY** 开发 |
| P1 | P3-05 | MC-07 验收量化 | **MODIFY** 方案 |
| P1 | P3-07 / P3-C05 | adapter parity 门禁 | **MODIFY** |
| P2 | P3-11 | README 索引 Phase 3 | **MODIFY** 文档 |
| P2 | P3-D04 | CLEANUP-2 | **MODIFY** 并行 |
| — | P3-D01–D03 | legacy 脚本边界 | **KEEP** |

---

## 5. KEEP / MODIFY / RESTORE / DELETE

### KEEP

- Phase 1/2 Foundation 全部 Runtime · Loader · Backend · Decision 代码
- `mel.py` 作为训练/Runtime 共享 Feature 实现
- `test_loader` · `test_phase2_contracts` · `tone-recall-counterfactual`
- `Deployment Runbook` 权重升级路径
- `audit_*` 作为**非 SSOT** 手动工具
- `confidence` 作 Required 字段但 **不进** Recall

### MODIFY

- **方案文档**：P3-01–P3-14 补充项
- **`train_tone_cnn.py`**：MC-01/02
- **新增** `validate_artifact.py`（或等价）· offline eval 模块：MC-03/04
- **README**：Phase 3 索引（开发启动或 Phase 3 文档冻结时）
- **可选** `contract.py`：若采纳 `validationResult` diagnostics

### RESTORE

无。

### DELETE

无（禁止恢复 Registry；禁止 Phase 3 删 Runtime）。

---

## 6. 方案内部一致性核对

| 检查点 | 结果 |
|--------|------|
| 与 Phase 1/2 Freeze 冲突 | **无** |
| 与 Pre-Dev 审计一致 | **是**（MC-01–04 待开发） |
| §6 artifact 与 Loader 一致 | **否** — P3-01 |
| §7 Validation vs Runtime | **需澄清** — P3-04 |
| §20 与 Foundation E2E 131 关系 | **需分层** — P3-05 |
| Target List 可执行 | **是**（缺细节） |

---

## 7. 十问（对应开发决策）

| # | 问题 | 审计答案 |
|---|------|----------|
| 1 | 方案能否作为 Phase 3 依据？ | **CONDITIONAL PASS** |
| 2 | 首批开发项？ | MC-01 → MC-02/03/04 → MC-05/06 → MC-07 |
| 3 | 须先修 train SSOT？ | **是**（P0） |
| 4 | 须补充方案再开发？ | **是** — P3-04/05/07 等 |
| 5 | 代码有架构漂移？ | **Tone 域无**；训练硬编码为 **契约漂移** |
| 6 | 质量差能归因 Runtime？ | **不能**（除非链路断） |
| 7 | 禁止改 Runtime？ | **是** — 方案与冻结一致 |

---

## 8. Final Verdict

```text
CONDITIONAL PASS
```

**条件：** 开发启动前将本补充清单 **P3-01、P3-04、P3-05、P3-07** 写入 Phase 3 方案或 ADR；**MC-01** 为首个代码项。

**禁止：** 以 Phase 3 为名修改 Runtime/Recall/引入 Registry；以 offline benchmark 替代 Node E2E；将 `audit_tone_reliability` 置信度分档作 Decision 门控。

---

**审计类型：** 只读 · 未修改代码、配置、模型、SSOT 文档或测试数据（本报告除外）。
