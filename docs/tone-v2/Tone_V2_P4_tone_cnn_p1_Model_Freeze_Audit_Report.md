# Tone V2 Phase 4 — `tone_cnn_p1` Model Freeze Audit Report

**Date:** 2026-06-29  
**Audit Type:** Read-only Model Freeze Audit（**非开发**；未修改代码 / 配置 / 模型 / 测试数据 / 既有文档）  
**Audit Target:** 判断 `tone_cnn_p1.npz` 是否可作为当前 Tone V2 的**冻结模型版本**  
**Artifact:** `electron_node/services/faster_whisper_vad/tone_module/models/tone_cnn_p1.npz`

**依据 SSOT：**

- Phase 1 Freeze · [TONE_V2_CONTRACT_FREEZE.md](./TONE_V2_CONTRACT_FREEZE.md)
- [Tone_V2_Phase2_Foundation_Freeze_Audit_Report_2026_06_29.md](./Tone_V2_Phase2_Foundation_Freeze_Audit_Report_2026_06_29.md)
- [Tone_V2_Phase3_Model_Capability_Foundation_Freeze_Audit_Report_2026_06_29.md](./Tone_V2_Phase3_Model_Capability_Foundation_Freeze_Audit_Report_2026_06_29.md)
- [Tone_V2_P4_Training_Report.md](./Tone_V2_P4_Training_Report.md)
- [Tone_V2_P4_Offline_Quality_Evaluation_Report.md](./Tone_V2_P4_Offline_Quality_Evaluation_Report.md)
- [Tone_V2_P4_Node_E2E_Test_Report.md](./Tone_V2_P4_Node_E2E_Test_Report.md)
- 当前仓库代码与 artifact（审计日现场复核）

---

## Executive Summary

| 维度 | 结论 |
|------|------|
| Artifact Contract | **PASS** |
| `modelVersion=tone_cnn_p1` | **PASS** |
| `featureVersion=p0-v1` | **PASS** |
| `backend=numpy_p0` | **PASS** |
| `validate_artifact` | **PASS**（审计日现场重跑） |
| Offline Evaluation | **CONDITIONAL PASS**（继承 P4 离线报告） |
| Node E2E Runtime Validation | **PASS**（架构回归门全过；覆盖率 109/200） |
| Runtime Hop | **未变化** |
| Decision Ownership | **未变化** |
| Architecture Drift | **未发现 Material Drift** |
| 模型质量退化（E2E 可比子集） | **未发现** |
| **是否允许冻结 `tone_cnn_p1`** | **是 — 附条件** |

**裁决：** `tone_cnn_p1` **准予**作为 Tone V2 在 `featureVersion=p0-v1` / `backend=numpy_p0` 下的**冻结生产模型 artifact**，须以 **SHA256 钉死** + **`TONE_MODEL_PATH` 部署**；离线弱势类与未跑满 dialog_200 记入**冻结后监控条件**，不构成架构或契约否决。

### Final Verdict: **CONDITIONAL PASS**

| 通过项 | 条件项（不否决冻结，须跟踪） |
|--------|------------------------------|
| 全链路 Contract / Validation / E2E 架构门 | 离线 accuracy 73.2%（中等）；t3/t5 recall 偏弱 |
| 0 `model_error`；109/109 `effective_chain` | E2E 仅 109/200（15 min cap） |
| 可比子集 CER 无回归 | 存在高置信离线错分样例 |
| Phase 1–3 Foundation 未被破坏 | SSOT 文档默认路径仍为 `tone_cnn_p0.npz`（文档滞后，非 artifact 缺陷） |

---

## 1. Artifact Contract Verification

### 1.1 Required Weights（`TONE_V2_CONTRACT_FREEZE.md` §7 · `loader.py`）

| 张量 | 期望 Shape | Actual | 结果 |
|------|-------------|--------|------|
| `w1` | (80, 32) | (80, 32) | **PASS** |
| `b1` | (32,) | (32,) | **PASS** |
| `w2` | (32, 5) | (32, 5) | **PASS** |
| `b2` | (5,) | (5,) | **PASS** |
| `mel_mean` | (80,) optional | (80,) | **PASS** |
| `mel_std` | (80,) optional | (80,) | **PASS** |

### 1.2 Optional Metadata（Addendum II · 不得进入 Decision）

| 字段 | 期望 | Actual | 进入 Decision？ |
|------|------|--------|----------------|
| `featureVersion` | `p0-v1` | `p0-v1` | **否**（Loader 校验 only） |
| `modelVersion` | `tone_cnn_p1` | `tone_cnn_p1` | **否**（diagnostics only） |
| `backend` | `numpy_p0` | `numpy_p0` | **否** |
| `formatVersion` | `npz-v1` | `npz-v1` | **否** |
| `trainingVersion` | 日期 | `2026-06-29` | **否** |
| `datasetVersion` | 可选 | `CS5647Team3/data_mini` | **否** |
| `buildTime` | 可选 | `2026-06-29T10:32:34Z` | **否** |
| `metrics` | 可选 | train/val acc 等 | **否** |
| `validationResult` | **禁止** | **不存在** | — **PASS** |

### 1.3 Runtime Diagnostics（不得写入 npz）

| 字段 | 在 npz 内？ | 裁决 |
|------|------------|------|
| `artifactPath` | **否** | **PASS** |
| `artifactHash` / `loadMs` | **否** | **PASS**（Runtime 生成） |

### 1.4 文件完整性

| 项 | 值 |
|----|-----|
| Path | `tone_module/models/tone_cnn_p1.npz` |
| Size | 15,760 bytes |
| SHA256 | `8b22ba13fc9ea32f0b8138294348fb786273b11150b38a4b2193fd0966f1a194` |

**Artifact Contract Verification: PASS**

---

## 2. FeatureVersion Verification

| 检查 | Expected（`contract.py` SSOT） | Actual | 结果 |
|------|-------------------------------|--------|------|
| npz `featureVersion` | `p0-v1` | `p0-v1` | **PASS** |
| `P0_COMPATIBLE_FEATURE_VERSIONS` | `{p0-v1, mel_mean_80_v1}` | 在兼容集内 | **PASS** |
| Mel 常量 SSOT | `contract.py` `P0_*` | `mel.py` / `inference.py` 仍 import `contract` | **PASS**（代码未变） |
| 训练生成新 featureVersion | **禁止** | 未生成 | **PASS** |

**FeatureVersion Verification: PASS**

---

## 3. Backend Verification

| 检查 | Expected | Actual | 结果 |
|------|----------|--------|------|
| npz `backend` | `numpy_p0` | `numpy_p0` | **PASS** |
| Adapter 实现 | `tone_module/backends/numpy_p0.py` | 存在；`infer_batch` 未改 | **PASS** |
| Backend Registry / routing | **禁止** | `backends/__init__.py` 明示 no registry；`test_phase2_contracts` 扫描通过 | **PASS** |
| Acceptance 路径 | `numpy_p0.infer_batch` | `validate_artifact` adapter 阶段 PASS | **PASS** |

**Backend Verification: PASS**

---

## 4. Validation Result

### 4.1 审计日现场 `validate_artifact`（只读重跑）

```text
validation=PASS | schema=True | shape=True | loader=True | adapter=True
passed=True
```

| 阶段 | 结果 |
|------|------|
| Schema Validation | **PASS** |
| Shape Validation | **PASS** |
| Loader.load(artifact) | **PASS** |
| Runtime Adapter (`infer_batch`) | **PASS** |
| **Artifact Acceptance** | **PASS** |

### 4.2 Python Regression Gate（审计日）

```text
unittest: test_phase3_contracts + test_phase2_contracts + test_loader
Ran 25 tests — OK
```

**Validation Result: PASS**

---

## 5. Offline Quality Result

**来源：** [Tone_V2_P4_Offline_Quality_Evaluation_Report.md](./Tone_V2_P4_Offline_Quality_Evaluation_Report.md)（审计未重跑离线全量；`validate_artifact` 已现场复核）

| 指标 | 值 | 门禁 |
|------|-----|------|
| Offline Accuracy | **0.7323**（1,808 val 音节） | 观测 |
| Posterior collapse | **未检测到** | **PASS** |
| t3 recall | 60.9% | **偏弱** |
| t5 recall | 58.8%（support=80） | **偏弱** |
| 高置信错误 | 存在（0.94+） | 监控项 |
| 进入 Runtime Decision | **否** | **PASS**（隔离） |

**离线报告原判：** **CONDITIONAL PASS**

**模型冻结语义：** 离线质量**中等**，不构成 Artifact Contract 或 Adapter Acceptance 否决；按 Addendum II §6–§7，**不得**单独作为 Foundation 否决依据，但须作为**冻结后质量 backlog** 跟踪。

**Offline Quality Result: CONDITIONAL PASS**

---

## 6. Node E2E Result

**来源：** [Tone_V2_P4_Node_E2E_Test_Report.md](./Tone_V2_P4_Node_E2E_Test_Report.md) · `tone-v2-phase4-p1-deploy-dialog200-batch-result.json`

| 指标 | 值 | 门禁 |
|------|-----|------|
| `evaluated_count` | 109 | 观测（15 min cap） |
| `effective_chain_count` | **109 / 109** | **PASS** |
| `model_error_count` | **0** | **PASS** |
| `toneEnabled_count` | 109 | **PASS** |
| `recall_tone_active_count` | 109 | **PASS** |
| `assembly_guard_absent` | **true** | **PASS** |
| FW `utterance_ready`（批前） | **true** | **PASS** |
| Loader 探针 `modelVersion` | `tone_cnn_p1` | **PASS** |

**E2E 原判：** **PASS**（Runtime Validation / Node Integration）

**覆盖缺口：** dialog_200 仅 **109/200** — 属**观测与运维条件**，非架构 FAIL。

**Node E2E Result: PASS**（附覆盖率条件）

---

## 7. Frozen Architecture Verification

### 7.1 Runtime Hop（与 Phase 1–3 冻结一致）

```text
FW Worker → run_tone_inference → UtteranceResponse.tone
→ ASRResult.tone → ctx.acousticToneSlices
→ Recall → Ranking → Assembly → KenLM → Apply
```

| Hop 节点 | 代码锚点（审计日） | 变化 |
|----------|-------------------|------|
| ASR → slices | `asr-step.ts` → `ctx.acousticToneSlices` | **无** |
| Recall 消费 slices | `recall-topk-for-windows.ts` → `acousticSlices` | **无** |
| Tone 决策 | `computeToneScoreResult` · `tonePenalty` | **无** |
| Assembly | tone-free | **无** |

### 7.2 禁止项扫描

| 禁止项 | 结果 |
|--------|------|
| Model Registry / hot_reload / model_switch | **未发现** |
| Backend Registry / runtime routing | **未发现** |
| Second Tone HTTP pipeline | **未发现** |
| Assembly tone guard 复活 | **未发现**（E2E `assembly_guard_absent_all=true`） |
| Offline eval 进入在线 Gate | **未发现** |

**Frozen Architecture Verification: PASS**

---

## 8. Decision Ownership Verification

| 模块 | Owner（冻结） | 审计 Actual | 变化 |
|------|--------------|-------------|------|
| Posterior Provider | FW `tone_module` | E2E `toneEnabled` + slices | **无** |
| **Tone Decision** | **Recall** | `recallToneCompatibleCount` / `recallToneFallbackCount` 非零 | **无** |
| Sentence Ranking | Ranking | 间接 via Recall score | **无** |
| Assembly / KenLM / Apply | Tone-free | guard absent | **无** |

`modelVersion` / `artifactHash`：**仅 diagnostics**；未进入 `tonePenalty` 或 SQL 排序。

**Decision Ownership Verification: PASS**

---

## 9. Regression Gate

| 回归门 | 来源 | 结果 |
|--------|------|------|
| Feature Parity Test | `test_phase3_contracts` | **PASS** |
| Runtime Adapter Validation Test | `test_phase3_contracts` | **PASS** |
| Artifact Validation Test | `test_phase3_contracts` + 现场 `validate_artifact` | **PASS** |
| Offline Evaluation Isolation Test | `test_phase3_contracts` | **PASS** |
| Phase 2 Deployment Boundary | `test_phase2_contracts` | **PASS** |
| E2E `model_error_count == 0` | P4 batch | **PASS** |
| E2E `effective_chain == evaluated` | P4 batch | **PASS**（109/109） |
| E2E 可比 CER 无退化 | d011–d109 重叠 | **PASS** |

**Regression Gate: PASS**

---

## 10. Quality Comparison

### 10.1 Node E2E（dialog_200 子集）

| 指标 | P3 基线（prior deploy） | P4 `tone_cnn_p1` | Δ / 备注 |
|------|------------------------|------------------|----------|
| 评估条数 | 190 | 109 | P4 时间触顶 |
| `effective_chain` | 190/190 | 109/109 | 均为 100% |
| `model_error` | 0 | 0 | 一致 |
| `mean_cer`（全批） | 0.283 | 0.220 | **不可直接对比**（样本集不同） |
| `mean_cer`（重叠 d011–d109） | 0.220 | **0.211** | **无退化**（略优） |
| d001–d010 | 10× ASR 冷启动失败 | **10/10 成功** | 环境改善，非模型契约 |

### 10.2 离线（仅 p1）

| 指标 | 值 |
|------|-----|
| val accuracy | 0.732 |
| collapse | 否 |
| 弱势类 | t3 / t5 |

### 10.3 退化裁决

| 类型 | 结论 |
|------|------|
| 架构 / 契约退化 | **无** |
| Runtime effective_chain 退化 | **无** |
| E2E 识别质量（可比子集） | **无显著退化** |
| 离线 posterior 质量 | **中等**（非本轮冻结否决项） |

**Quality Comparison: PASS**（E2E 可比子集）；离线为 **CONDITIONAL**

---

## 11. Architecture Drift

| 区域 | Expected | Actual | Severity | 处置 |
|------|----------|--------|----------|------|
| Runtime Hop | Phase 1 冻结链 | 未变 | — | **KEEP** |
| Single Service / Single Model | 单 npz + env | `TONE_MODEL_PATH` → p1 | — | **KEEP** |
| Loader fail-closed | 坏 artifact → model_error | 0 model_error | — | **KEEP** |
| `config.py` 默认路径 | `tone_cnn_p0.npz` | 仍为 p0 文件名 | **LOW** | **MODIFY**（冻结后 SSOT / Runbook 钉 p1 + hash；**非**代码改动） |
| `TONE_V2_CONTRACT_FREEZE.md` 默认模型 | 提及 p0 | 未写入 p1 冻结条目 | **LOW** | **MODIFY**（Frozen Architecture Update 轮次） |
| Registry / Switching | 禁止 | 未出现 | — | **KEEP** |

**Material Architecture Drift: 无**

---

## 12. KEEP / MODIFY / RESTORE / DELETE

### KEEP（准予冻结 · 生产 SSOT）

| 项 | 说明 |
|----|------|
| **`tone_cnn_p1.npz`** | SHA256 `8b22ba13…` · 冻结生产模型 artifact |
| `featureVersion=p0-v1` | 与 Phase 1–3 Feature SSOT 一致 |
| `backend=numpy_p0` | 与 Phase 2 Backend Freeze 一致 |
| `validate_artifact` 四阶段门禁 | 换权重仍须 PASS |
| Runtime / Loader / Contract / Recall 决策链 | Phase 1–3 全部延续 |
| 部署方式 | `TONE_MODEL_PATH` + FW **重启**（禁止热切换） |

### MODIFY（冻结后 · 非本轮审计执行）

| 项 | 说明 |
|----|------|
| `TONE_V2_CONTRACT_FREEZE.md` | 增加 **Phase 4 Model Freeze** 段落：canonical `modelVersion` · SHA256 · 默认部署路径 |
| `Tone_V2_Phase2_Deployment_Runbook.md` | 生产默认指向 `tone_cnn_p1.npz` + hash 校验步骤 |
| `config.py` 默认 `_DEFAULT_MODEL_PATH` | 可选改为 `tone_cnn_p1.npz`（**须**走再冻结若改代码） |
| E2E 批脚本 | 可选 ASR 预热 + 延长 cap 跑满 200 |
| 模型质量 backlog | t3/t5 数据与训练改进（Phase 4+） |

### RESTORE

无。

### DELETE

| 项 | 说明 |
|----|------|
| `tone_cnn_p0` 作为**生产** canonical 模型 | 由 `tone_cnn_p1` 取代（p0 可保留为历史 / 回归对照，**非**删除文件） |
| Registry / Switching 路线 | 继续 **DELETE**（不得恢复） |

---

## 13. 是否允许冻结 `tone_cnn_p1`

| # | 审计项 | 结果 |
|---|--------|------|
| 1 | artifact 符合 Contract | **是** |
| 2 | `modelVersion=tone_cnn_p1` | **是** |
| 3 | `featureVersion=p0-v1` | **是** |
| 4 | `backend=numpy_p0` | **是** |
| 5 | `validate_artifact` PASS | **是**（现场复核） |
| 6 | offline evaluation | **CONDITIONAL PASS** |
| 7 | Node E2E PASS | **是**（架构门；109/200 覆盖） |
| 8 | Runtime Hop 未变化 | **是** |
| 9 | Decision Ownership 未变化 | **是** |
| 10 | Architecture Drift | **无 Material Drift** |
| 11 | 模型质量退化 | **E2E 可比子集无退化** |
| 12 | **允许冻结** | **是 — 附条件** |

**冻结生效条件（运维 SSOT，建议写入后续文档同步轮次）：**

1. 生产 `TONE_MODEL_PATH` 指向本 artifact，且 **SHA256 校验** 与上表一致。  
2. 换权重或重训须重新 `validate_artifact` + Runtime Validation。  
3. dialog_200 **全量** E2E 与 t3/t5 质量改进为**冻结后监控**，不阻塞本次 Model Freeze 裁决。

---

## 14. Final Verdict

# **CONDITIONAL PASS**

`tone_cnn_p1` **准予冻结**为 Tone V2 当前 **`p0-v1` / `numpy_p0`** canonical 模型版本。

**通过理由：** Artifact Contract、Feature/Backend、Validation、E2E 架构回归、Runtime Hop、Decision Ownership 全部符合 Phase 1–3 冻结；`model_error=0`；`effective_chain` 100%；无可比 E2E 质量退化。

**条件理由：** 离线质量仅为中等（CONDITIONAL PASS）；dialog_200 未跑满；SSOT 文档默认仍写 `tone_cnn_p0` — 属**文档/运维同步**与**质量 backlog**，不构成契约或架构否决。

---

**审计员签署：** Read-only Model Freeze Audit · 2026-06-29  
**现场复核：** `validate_artifact` · npz metadata/shape · unittest 25/25 · E2E JSON 统计
