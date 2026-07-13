# Tone V2 Model Capability — Pre-Development Code Audit

**Date:** 2026-06-29  
**Type:** 只读代码审计（模型能力开发前 · 非开发）  
**前提：** Phase 1 Freeze · Phase 2 Foundation Freeze（[Foundation Freeze Audit](./Tone_V2_Phase2_Foundation_Freeze_Audit_Report_2026_06_29.md) · [TONE_V2_CONTRACT_FREEZE.md](./TONE_V2_CONTRACT_FREEZE.md)）  
**排除：** Registry / Switching / Multi-Model 废弃路线

---

## Executive Summary

在 Phase 2 Foundation 仍成立的前提下，**可以进入模型能力开发**，但真实起点是「**离线训练 + artifact 生成 + 离线评估**」，而非 Runtime / Decision 改造。

| 维度 | 裁决 |
|------|------|
| Foundation 仍有效 | ✅ Runtime 主链已贯通（131/131 effective_chain）；无 Tone 架构漂移 |
| 模型能力可开发 | ✅ **CONDITIONAL** — 须先对齐训练脚本 Feature SSOT 与 artifact metadata |
| 模型质量已达标 | ❌ **未证明** — 无系统化 offline benchmark；E2E CER 属 ASR/FW 综合指标 |
| Runtime 应为质量差主因 | ❌ **无证据** — 链路生效；质量问题应归因权重/训练/标注/posterior |

**Final Verdict：CONDITIONAL PASS**

---

## 1. Frozen Architecture Verification

| 冻结项 | 代码 | E2E/测试 | 状态 |
|--------|------|----------|------|
| Runtime Hop | `api_routes` → `inference` → `asr-step` → `fw-detector-v4-path` → Recall | 131/131 effective_chain | ✅ KEEP |
| Required Data Contract | `tone_types.py` · `types.ts` | 未 breaking | ✅ KEEP |
| Decision Ownership | Recall `tonePenalty`；下游 tone-free | counterfactual 2/2 | ✅ KEEP |
| Single Service / Single Model | `get_tone_loader()` · `numpy_p0` | test_phase2_contracts | ✅ KEEP |
| Loader fail-closed | `loader.py` | 0 model_error E2E | ✅ KEEP |
| Backend boundary | `numpy_p0.infer_batch` only | Production Scan | ✅ KEEP |
| Feature SSOT（Runtime） | `mel.py`/`inference.py` ← `contract.py` | test_phase2_contracts | ✅ KEEP |
| 禁止 Registry/Switching | tone_module 无 | grep negative | ✅ KEEP |

**结论：** Foundation **未被破坏**；模型能力开发 **不得** 触碰上表。

---

## 2. Architecture Drift Audit

| 检查项 | Expected | Actual | Severity | 处置 |
|--------|----------|--------|----------|------|
| Tone Model Registry | 禁止 | 无 | — | **KEEP** |
| Runtime model switch | 禁止 | 无 | — | **KEEP** |
| Assembly Guard | 禁止 | 文件不存在 | — | **KEEP** |
| 训练脚本 import Runtime 主链 | 禁止 | `train_tone_cnn` **未** import loader/inference/api | — | **KEEP** |
| 训练产物进 Runtime 无验证 | 风险 | 无 CI 门禁绑定 train→loader | MEDIUM | **MODIFY** |
| `train_tone_cnn` Feature 硬编码 | 应引用 contract | `HIDDEN`/`N_MELS`/`0.02` 本地常量 | MEDIUM | **MODIFY** |
| Lexicon `profile-registry` 等 | 非 Tone Model Registry | 存在但不同域 | LOW | **KEEP**（非 Tone） |
| `freeze-contract` CLEANUP-2 | 全绿 | `hardDropCount` 失败 | MEDIUM | **MODIFY**（FW 并行，非 Tone 阻塞） |

**无 Tone 域 Runtime / Decision 漂移。**

---

## 3. Training Pipeline Boundary Matrix

| 组件 | 路径 | 与 Runtime 关系 | Feature SSOT | 进主链？ | 裁决 |
|------|------|-----------------|--------------|----------|------|
| `train_tone_cnn.py` | 离线训练 | **解耦**（仅 `mel.extract_mel_features`） | 间接经 `mel.py`；架构维度硬编码 | ❌ | **MODIFY** 对齐 contract |
| `train_tone_cnn` 数据集 | HF `CS5647Team3/data_mini` | 离线 | — | ❌ | **KEEP** |
| `mel.py` | 共享 Feature | Runtime 同源 | ✅ contract | ✅（经 mel） | **KEEP** |
| `loader.py` | Runtime only | 生产 | ✅ contract | ✅ | **KEEP** |
| `audit_runtime_acceptance.py` | FW HTTP 验收脚本 | 依赖运行中 FW | 用 `run_tone_inference` | ❌ 非训练 | **KEEP**（E2E 辅助） |
| `audit_tone_reliability.py` | FW HTTP 抽样 posterior | 依赖运行中 FW | 无 | ❌ | **KEEP**（质量探针，非 SSOT benchmark） |
| `tests/experiments/tone-module-p1-probe-offline.mjs` | Recall 离线探针 | **无** FW tone_module | 手工 mock posterior | ❌ | **KEEP**（Recall 行为，非声学模型 benchmark） |

**训练与 Runtime 已解耦；边界清晰。缺口在训练侧 SSOT 一致性与 artifact 产出规范。**

---

## 4. Artifact Contract Matrix

| 要求 | Loader 期望 | `train_tone_cnn` 产出 | 对齐？ |
|------|-------------|----------------------|--------|
| Required keys `w1,b1,w2,b2` | ✅ 校验 | ✅ 写入 | ✅ |
| Shape `(80,32)` · `(32,5)` 等 | ✅ `P0_*` | 硬编码 80/32/5 | ⚠️ 值一致、来源未 SSOT |
| `mel_mean` / `mel_std` | optional | ✅ 写入 | ✅ |
| `featureVersion` | 缺省→`p0-v1`+warning | **未写入** | ⚠️ **MODIFY** 建议显式 `p0-v1` |
| `modelVersion` / `trainingVersion` 等 | optional diagnostics | **未写入** | ⚠️ **MODIFY** 建议训练写入 |
| `metrics` | optional | ✅ val_acc 等 | ✅ |
| `backend` in npz | Loader 用 `P0_BACKEND` 默认 | 未写入 | ✅（Loader 默认） |
| 仅换权重 bump featureVersion | 禁止 | 训练未写 version | ✅ 无误 bump 风险 |

**artifact contract 对 Loader 基本足够**（required 权重可加载）；**建议补齐** 显式 metadata 与训练后 validation 脚本。

---

## 5. Feature SSOT Matrix

| 位置 | SSOT 来源 | 硬编码/漂移 | 影响 |
|------|-----------|-------------|------|
| `contract.py` | **唯一 baseline** | — | SSOT |
| `mel.py` | `P0_*` import | 无 | ✅ Runtime |
| `inference.py` | `P0_MIN_SLICE_SEC` | 无 | ✅ Runtime |
| `train_tone_cnn.py` | `N_MELS=80`, `HIDDEN=32`, `0.02` | **未 import contract** | ⚠️ 训练/Runtime 漂移风险 |
| `train_tone_cnn.py` mel 路径 | `extract_mel_features` | 与 Runtime 同源 | ✅ |
| `classifier.py` / `numpy_p0` | `contract.P0_*` | 无 | ✅ Runtime |

**审计项 #9：** 存在训练脚本 hardcode 与 Feature SSOT **潜在漂移**（当前值相同，维护时易分叉）。

**featureVersion 误用（#8）：** 训练未写 `featureVersion`；Loader 默认 `p0-v1`。**仅换权重不应 bump** — 当前流程符合；若改 mel 算法须 bump + 新实例/再冻结。

---

## 6. Model Quality Readiness Matrix

| 能力 | 存在？ | 有效？ | 归因 |
|------|--------|--------|------|
| Runtime 主链贯通 | ✅ | ✅ 131/131 | Foundation 成立 |
| Posterior 产出 | ✅ | ✅ sliceCount>0 | FW 正常 |
| Recall 使用 posterior | ✅ | ✅ fallback/compatible>0 | Decision 生效 |
| 声学分类准确率 benchmark | ⚠️ 仅 `train` 内 val_acc | 离线 | **权重/训练数据** |
| 标注数据管线 | ✅ AISHELL-3 TextGrid via train | 离线 | **训练数据** |
| Calibration 模块 | ❌ | — | **待开发** |
| confidence 进 Decision | ❌ | `confidence` 在 slice 上；Recall 用 pattern/penalty | **非 Runtime 失效** |
| E2E CER (mean 0.22) | ✅ dialog_200 | 综合 ASR+FW | **不能单独证明 tone 差或好** |

**不得将 CER / 识别效果差归因于 Runtime**，除非 `effective_chain` 断裂或 `model_error` — 当前 **均无**。

---

## 7. Benchmark / Evaluation Matrix

| 工具 | 类型 | 替代 Node E2E？ | 评估对象 | 裁决 |
|------|------|------------------|----------|------|
| `train_tone_cnn` val_acc | 离线 | ❌ | 音节分类 | **KEEP** |
| `audit_tone_reliability.py` | FW HTTP 抽样 | ❌ | posterior 分布 | **KEEP**（辅助） |
| `audit_runtime_acceptance.py` | FW+inference 集成 | ❌ | Runtime 集成 | **KEEP**（非模型 benchmark SSOT） |
| `tone-v2-phase*-dialog200-batch.js` | Node E2E | **金标准** | 全链路 | **KEEP** |
| `tone-module-p1-probe-offline.mjs` | Recall mock | ❌ | Recall 排序 | **KEEP**（非声学） |
| `tests/experiments/tone-module-p*.py/mjs` | 历史实验 | ❌ | 混合 | **KEEP** 非门禁 |
| **专用 offline tone benchmark** | — | — | — | **缺失 · MODIFY** |

**审计项 #5：** 有零散评估，**无**统一「posterior 质量 / calibration」离线 benchmark SSOT；**不得**用 FW-only scan 替代 Node E2E（与冻结一致）。

---

## 8. Runtime Non-Interference Matrix

| 风险 | 代码证据 | 是否接入 Decision | 裁决 |
|------|----------|-------------------|------|
| 训练脚本 hook loader | 无 import | ❌ | ✅ |
| val_acc 进 Recall | 无 | ❌ | ✅ |
| diagnostics 进 Recall | Recall 无 metadata 引用 | ❌ | ✅ |
| `tone_confidence_avg` 进 penalty | grep Recall 无 confidence 门控 | ❌ | ✅ |
| offline probe 改 Runtime | experiments 非主链 | ❌ | ✅ |
| Shadow/Offline Runtime 替代 E2E | 无 | ❌ | ✅ |

**审计项 #7：** 当前 **无** 将质量评估逻辑接入 Runtime Decision 的实现；后续开发须保持。

---

## 9. Dead Feature Matrix

| 项 | Exists | Effective | 说明 |
|----|--------|-----------|------|
| `train_tone_cnn.py` | ✅ | ❌ Runtime | 离线；**非死代码** |
| `numpy_p0` | ✅ | ✅ E2E | 主链 |
| `audit_*.py` | ✅ | 手动运行 | 工具脚本 |
| `confidence` on slice | ✅ | ❌ Decision | Required 字段；观测/契约 |
| experiments `tone-module-p*` | ✅ | ❌ CI | 历史实验 |
| Registry（Tone） | ❌ | ❌ | — |

---

## 10. Required Repair Matrix（模型能力开发前 / 并行）

| ID | 项 | 优先级 | 处置 | 阻塞开发？ |
|----|-----|--------|------|------------|
| MC-01 | `train_tone_cnn` 引用 `contract.py`（`P0_N_MELS`/`P0_HIDDEN`/`P0_MIN_SLICE_SEC`） | **P0** | **MODIFY** | **是**（首批训练前） |
| MC-02 | 训练 `np.savez` 写入 `featureVersion=p0-v1` + optional `modelVersion`/`datasetVersion` | **P1** | **MODIFY** | 否（建议首批） |
| MC-03 | 新增 `validate_artifact.py` 或扩展现有 test 为训练后门禁 | **P1** | **MODIFY** | 否 |
| MC-04 | 建立 offline tone benchmark（音节准确率 / confusion / calibration） | **P1** | **MODIFY** | 否（可与训练并行） |
| MC-05 | 权重升级 Runbook 回归清单绑定新 artifact | **P2** | **KEEP** Runbook | 否 |
| MC-06 | `freeze-contract` CLEANUP-2 | **P2** | **MODIFY** | **否**（非 Tone） |
| MC-07 | dialog_200 全量 200 质量评估 | **P2** | 模型 QA 阶段 | 否 |

---

## 11. KEEP / MODIFY / RESTORE / DELETE

| 处置 | 对象 |
|------|------|
| **KEEP** | Phase 2 Foundation 全部 Runtime/Loader/Backend/Contract 代码 |
| **KEEP** | `mel.py` 作为训练与 Runtime 共享 Feature 实现 |
| **KEEP** | `test_loader` / `test_phase2_contracts` / E2E batch 为回归门禁 |
| **KEEP** | `audit_*` 为手动工具（标注非 SSOT benchmark） |
| **MODIFY** | `train_tone_cnn.py` SSOT + artifact metadata |
| **MODIFY** | 补齐 offline benchmark / artifact validation（新脚本，不动 Runtime） |
| **MODIFY** | span-assembly `hardDropCount`（并行） |
| **RESTORE** | 无 |
| **DELETE** | 无（禁止恢复 Registry 路线） |

---

## 12. 能力分层摘要

| 层 | 现状 | 下一阶段允许 |
|----|------|--------------|
| **Runtime** | 冻结 · 生效 | **禁止改** |
| **Model** | P0 npz 可部署；质量未达标 | 新权重 · 同 `p0-v1` |
| **Training** | `train_tone_cnn` 可用；SSOT 未对齐 | 数据 · 训练 · 标注扩展 |
| **Evaluation** | 零散脚本 | 离线 benchmark + Node E2E 验收 |
| **Diagnostics** | optional 已扩展 | 填充 metadata 值；**不进 Decision** |

---

## 13. 十问裁决

| # | 问题 | 答案 |
|---|------|------|
| 1 | 当前是否可以进入模型能力开发？ | **是（CONDITIONAL PASS）** — 先 MC-01 |
| 2 | 第一批允许开发项？ | ① 训练脚本对齐 contract ② 重训/换权重（同 featureVersion）③ 离线 benchmark ④ artifact metadata/validation ⑤ 标注数据扩展 |
| 3 | 训练脚本是否需先对齐 Feature SSOT？ | **是** — `train_tone_cnn` 硬编码须改引 `contract.py` |
| 4 | artifact contract 是否已足够？ | **基本足够**（Loader 可加载）；建议显式 metadata + 验证脚本 |
| 5 | benchmark 是否存在？是否需补齐？ | **部分存在**；需 **专用 offline posterior benchmark**（不替代 Node E2E） |
| 6 | Runtime/Training/Evaluation 边界是否不清？ | **总体清晰**；训练 SSOT 与 benchmark SSOT 待补齐 |
| 7 | 是否存在破坏 Phase 2 Foundation 的风险？ | **当前无**；风险在 **误引入 Registry / 改 Runtime / bump featureVersion 不换实例** |
| 8 | 是否须先修 freeze-contract？ | **否**（非 Tone 阻塞）；建议并行 |
| 9 | 是否允许新增模型权重？ | **是** — 同 featureVersion + `TONE_MODEL_PATH` + 重启 + 回归 |
| 10 | 是否禁止改 Runtime/Decision/Required Schema？ | **是 — 冻结禁止** |

---

## 14. Acceptance 三分法

| 判断 | 结论 |
|------|------|
| **Foundation 是否仍有效** | ✅ **是** |
| **模型能力是否可开发** | ✅ **是（有条件）** |
| **模型质量是否已经达标** | ❌ **否** — 需 offline benchmark + 可选全量 E2E QA |

---

## Final Verdict

```text
CONDITIONAL PASS
```

**条件：** 启动模型能力开发首批工作前，完成 **MC-01**（`train_tone_cnn.py` 对齐 `contract.py` Feature SSOT）；**MC-02–MC-04** 应在首版新权重接入前或同期完成。

**后续模型能力开发唯一依据：**

1. [TONE_V2_CONTRACT_FREEZE.md](./TONE_V2_CONTRACT_FREEZE.md)  
2. [../tone-module/ARCHITECTURE.md](../tone-module/ARCHITECTURE.md)  
3. [Tone_V2_Phase2_Deployment_Runbook.md](./Tone_V2_Phase2_Deployment_Runbook.md)  
4. 本审计报告（开发边界）

**可以进入模型能力开发前代码审计（实现轮）** — 以 SSOT + 本报告 Required Repair 为检查清单。

---

**审计类型：** 只读 · 未修改代码、配置、模型、文档（除本报告）、测试数据。
