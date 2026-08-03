<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/Tone_V2_Phase3_Development_Plan_Supplement_Addendum_Audit_2026_06_29.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# Tone V2 Phase 3 — Supplement Addendum Audit

**Date:** 2026-06-29  
**Type:** 只读审计（Addendum 补充核对 · 非开发）  
**审计对象：** [Tone V2 Phase 3 Development Plan — Supplement Addendum.md](./Tone%20V2%20Phase%203%20Development%20Plan%20%E2%80%94%20Supplement%20Addendum.md)  
**对照：** [Phase 3 主方案](./Tone%20V2%20Phase%203%20%E2%80%94%20Model%20Capability%20Development%20Plan.md) · [Phase 3 方案补充审计](./Tone_V2_Phase3_Model_Capability_Development_Plan_Supplement_Audit_2026_06_29.md) · [TONE_V2_CONTRACT_FREEZE.md](./TONE_V2_CONTRACT_FREEZE.md) · 当前代码

---

## Executive Summary

Addendum **有效吸收**了首轮 Phase 3 补充审计中的多项 HIGH 缺口（Artifact 字段命名、Validation 两阶段、Runtime Adapter Parity、Legacy 工具边界、MC-07 分层、Calibration 禁止进 Decision）。

与**当前代码**对照：**MC-01–MC-04 及 §10 新增四门回归测试均未实现**；Addendum 自身仍有 **7 项内部歧义/缺口**、**4 项与主方案/CONTRACT_FREEZE 未对齐**、**5 项代码未满足 Addendum 契约**。

**无** Tone Registry、无训练进 Runtime 主链、无 Calibration/置信度分档进 Recall。

**审计裁决：CONDITIONAL PASS** — Addendum 可作为 Phase 3 **最终执行约束**（优先于主方案冲突处），开发前须吸收本清单剩余项。

---

## 1. Addendum 对首轮审计的消解情况

| 首轮 ID | 内容 | Addendum 是否覆盖 | 状态 |
|---------|------|-------------------|------|
| P3-01 | weights/bias 用词 | §1 Required `w1..b2` | ✅ 已消解（主方案 §6 **未改** → 见 P3A-D01） |
| P3-04 | Validation 边界 | §2 Stage1/2 | ✅ 已消解 |
| P3-05 | MC-07 分层 | §7 两层 | ✅ 部分消解（质量层仍无量化阈值 → P3A-03） |
| P3-06 | legacy audit 工具 | §6 | ✅ 已消解 |
| P3-07 | adapter parity | §3 | ✅ 已消解（代码未实现 → P3A-C03） |
| P3-08 | Calibration 边界 | §5 | ✅ 已消解 |
| P3-11 | README Phase 3 | §9 | ✅ 已要求（**未执行** → P3A-D02） |
| P3-02 | validationResult | — | ❌ **未消解**（主方案仍有 → P3A-01） |
| P3-09 | venv/路径 | — | ❌ 未写 |
| P3-10 | p1 命名约定 | — | ❌ 未写 |

---

## 2. 与冻结设计一致性

| 维度 | Addendum | 代码 | 一致性 |
|------|----------|------|--------|
| Runtime / Decision | 禁止改 | 未变 | ✅ |
| Artifact Required `w1..b2` | §1 | Loader 一致 | ✅ |
| Optional metadata 缺失不 fail | §1 | Loader 缺 featureVersion→默认 `p0-v1` | ✅ |
| Stage1 不启 FW | §2 | 无 validate 脚本 | N/A（待建） |
| Validation 经 `numpy_p0` | §3 | train 用 `_accuracy`+`_softmax` | ❌ **违反 Addendum** |
| train→contract 无 hardcode | §4 | `HIDDEN/N_MELS/0.02/N_CLASSES` 硬编码 | ❌ |
| Training 不写新 featureVersion | §8 | 未写任何 version | ✅（默认路径） |
| Legacy tools 非 SSOT | §6 | 存在、未进 Decision | ✅ |
| §10 四门新测试 | 要求 | **不存在** | ❌ 待开发 |

---

## 3. 补充项清单

### 3.1 Addendum / 文档内部（设计缺失或歧义）

| ID | 补充内容 | 来源 | 风险 | 影响范围 | 建议 |
|----|----------|------|------|----------|------|
| **P3A-01** | **`validationResult`**：主方案 §11/§16 仍有；Addendum §1 optional 列表**未列**；`contract.py` **无** 此字段 | 设计缺失 | **MEDIUM** | diagnostics | **MODIFY** 主方案：删除或迁入 `notes`；Addendum 显式 **禁止/弃用**；不得进 Loader |
| **P3A-02** | **§1「Required Metadata」与 Optional 列表矛盾**：`featureVersion` 在 Optional 列表，但 Loader 行为为「缺失→默认+warning」非 fail | 设计缺失 | **MEDIUM** | Artifact §1 | **MODIFY** Addendum：改为「featureVersion 缺失时 Loader 解释为 `p0-v1`（warning）」；删除「Required Metadata」歧义表述 |
| **P3A-03** | **§7 Model Quality 层仍无量化**：offline accuracy 阈值、dialog_200 除 effective_chain 外是否要求 CER/Recall 指标变化 | 设计缺失 | **HIGH** | MC-07 · 验收 | **MODIFY** Addendum：增加 Model Quality 最低门槛（如 offline val_acc 基线 + E2E 无 model_error + 可选 CER 观测非回归） |
| **P3A-04** | **§1 `modelHash` 在 npz optional**：Loader **始终**用文件 SHA256 覆盖 `metadata.model_hash`，不读 npz 内 `modelHash` | 设计缺失 | **LOW** | metadata | **MODIFY** Addendum：npz 内不写 modelHash；hash 仅 Runtime diagnostics |
| **P3A-05** | **`metrics` 训练字典**：train 写入 `metrics`；Addendum/CONTRACT 均未列；Loader 仅日志读取 | 设计缺失 | **LOW** | artifact | **MODIFY** Addendum：列为 **Training-only optional blob**；不进 diagnostics Decision |
| **P3A-06** | **§1 未列 `formatVersion`/`backend`**：CONTRACT_FREEZE §7 有；Addendum optional 列表缺 | 文档漂移 | **LOW** | SSOT 对齐 | **MODIFY** Addendum 引用 CONTRACT_FREEZE 或补全 |
| **P3A-07** | **§10 四门测试无 CI 挂载说明**：未写与 `test_phase2_contracts`/`test_loader` 关系 | 设计缺失 | **MEDIUM** | Regression | **MODIFY** §10：指定 `test_phase3_*.py` 路径与 `unittest` 命令 |

### 3.2 主方案 / SSOT 与 Addendum 未对齐（文档漂移）

| ID | 补充内容 | 来源 | 风险 | 影响范围 | 建议 |
|----|----------|------|------|----------|------|
| **P3A-D01** | **主方案 §6 仍写 weights/bias**；Addendum §1 已禁止该表述 | 文档漂移 | **MEDIUM** | 开发误读 | **MODIFY** 主方案 §6 或标注「以 Addendum §1 为准」 |
| **P3A-D02** | **§9 README Phase 3 未执行**：`README.md` 无 Phase 3 条目 | 文档漂移 | **MEDIUM** | 索引 | **MODIFY**（Phase 3 启动时，非 SSOT 契约变更） |
| **P3A-D03** | **Phase 3 主方案/Addendum 未进 README**；仅 CONTRACT_FREEZE + Phase2 | 文档漂移 | **LOW** | 索引 | **MODIFY** README「历史依据」或「Phase 3 进行中」 |
| **P3A-D04** | **CONTRACT_FREEZE `artifactPath`/`loadMs`/`backendAdapter`** 为 Runtime 填充；Addendum §1 全列在 npz optional，易混淆 | 文档漂移 | **LOW** | 文档 | **MODIFY** Addendum：区分 **npz keys** vs **Runtime diagnostics** |

### 3.3 代码实现 vs Addendum（未实现 = 开发项）

| ID | 补充内容 | 来源 | 风险 | 影响范围 | 建议 |
|----|----------|------|------|----------|------|
| **P3A-C01** | **§4 Feature hardcode**：`train_tone_cnn` L33-35 `HIDDEN/N_MELS/N_CLASSES`、L133 `0.02` | 代码实现 | **HIGH** | MC-01 | **MODIFY** |
| **P3A-C02** | **§1 Optional metadata**：`np.savez` 无 featureVersion/modelVersion/trainingVersion 等 | 代码实现 | **MEDIUM** | MC-02 | **MODIFY** |
| **P3A-C03** | **§3 最终 Validation 须经 adapter**：`_accuracy` 用训练内 `_softmax`，**非** `numpy_p0.infer_batch` | 代码实现 | **HIGH** | parity · MC-03 | **MODIFY** |
| **P3A-C04** | **§2 Stage1 Artifact Validation**：无 `validate_artifact.py` | 代码实现 | **MEDIUM** | MC-03 | **MODIFY** |
| **P3A-C05** | **§5 Offline Evaluation**：无 MC-04 模块 | 代码实现 | **MEDIUM** | 质量 | **MODIFY** |
| **P3A-C06** | **§10 Feature Parity Test**：无 training 侧测试 | 测试发现 | **MEDIUM** | Regression | **MODIFY** 新增 |
| **P3A-C07** | **§10 Runtime Adapter Validation Test**：无 adapter 对 artifact 抽检测试 | 测试发现 | **MEDIUM** | Regression | **MODIFY** 新增 |
| **P3A-C08** | **§10 Offline Evaluation 不进 Decision Test**：无门禁 | 测试发现 | **LOW** | Regression | **MODIFY** 新增（可静态 grep Recall） |

### 3.4 架构漂移 / 旁路 / 误用风险

| ID | 补充内容 | 来源 | 风险 | 影响范围 | 建议 |
|----|----------|------|------|----------|------|
| **P3A-R01** | **`audit_tone_reliability` 0.75/0.45 分档**：Addendum §6 已界定非 SSOT；仍可能被当作 Calibration Gate | 架构漂移（误用） | **MEDIUM** | 评估 | **KEEP** + 脚本头注释引用 §6 |
| **P3A-R02** | **`audit_runtime_acceptance` 调 `run_tone_inference`**：属 Stage2 范畴，**不得**并入 Stage1 validate 脚本 | 代码实现 | **LOW** | Validation 边界 | **KEEP** 作 Runtime Validation 工具 |
| **P3A-R03** | **`val_acc` 作部署门槛**：若仅用训练 `_accuracy` 放行 artifact，**违反** §3 | 架构漂移 | **HIGH** | 验收 | **MODIFY** 部署前必须 adapter validation |
| **P3A-R04** | **`freeze-contract` CLEANUP-2** | 测试发现 | **MEDIUM** | §19 全量 Jest | **MODIFY** 并行（非 Tone） |
| **P3A-R05** | **`confidence` Exists 不进 Recall**：Addendum §5 禁止 Calibration Gate | 代码实现 | **LOW** | Decision | **KEEP** |

### 3.5 隐含前提（Addendum 应显式写出）

| ID | 前提 | 现状 | 若失效 |
|----|------|------|--------|
| **P3A-P01** | Stage1 validate **零网络、零 FW 进程** | 未实现 | CI 误依赖 6007 |
| **P3A-P02** | `featureVersion` 写入须为 `P0_FEATURE_VERSION` 常量，非训练脚本发明 | §8 原则有 | 误写 `p0-v2` → Loader fail |
| **P3A-P03** | 音节级 train label vs 词级 Runtime slice **域不同** | 未写 | offline↑ E2E 不保证↑ |
| **P3A-P04** | `mel_mean_80_v1` 仅 legacy 部署；新训练应写 `p0-v1` | §8 权重不换 version | 混淆 legacy |
| **P3A-P05** | Stage2 dialog_200 需 Node+FW+`servicePreferences` | 继承 Phase 1/2 | 假失败 |

### 3.6 Exists vs Effective

| 项 | Exists | Effective | 主链路 | 说明 | 建议 |
|----|--------|-----------|--------|------|------|
| Addendum §2 Stage1/2 分离 | ✅ 文档 | ❌ 工具链 | — | 待 MC-03 | **MODIFY** |
| Addendum §3 adapter parity | ✅ 文档 | ❌ train 未用 | — | P3A-C03 | **MODIFY** |
| `numpy_p0.infer_batch` | ✅ | ✅ E2E | ✅ | Runtime | **KEEP** |
| train `_softmax` | ✅ | 仅训练循环 | ❌ | **不得**作最终 validation | **KEEP** 训练内；**MODIFY** 验收路径 |
| `test_phase2_contracts` Feature test | ✅ | Runtime only | ❌ | 不含 train | **MODIFY** §10 |
| Legacy `audit_*` | ✅ | 手动 | ❌ | §6 边界 | **KEEP** |
| MC-04 offline SSOT | ❌ | — | — | 待建 | **MODIFY** |

---

## 4. 矩阵摘要

### 4.1 Frozen Architecture Verification

Foundation **仍有效**；Addendum **强化** Training/Validation 边界，**不冲突** Phase 1/2。

### 4.2 Training Pipeline Boundary Matrix

| 边界 | Addendum | 代码 | 裁决 |
|------|----------|------|------|
| Training 不进 Runtime | §2 Stage1 不启 FW | train 无 loader/api | **KEEP** |
| train→contract | §4 | 硬编码 | **MODIFY** |
| 最终验证→adapter | §3 | `_accuracy` 旁路 | **MODIFY** |
| Feature 经 mel 共享 | 隐含 | train→mel→contract | **KEEP** |

### 4.3 Artifact Contract Matrix（Addendum §1 vs Loader）

| 字段 | Addendum | Loader | train 产出 | 裁决 |
|------|----------|--------|------------|------|
| w1,b1,w2,b2 | Required | Required | ✅ | **KEEP** |
| mel_mean/std | Optional | Optional | ✅ | **KEEP** |
| featureVersion 等 | Optional | 缺省→p0-v1 | ❌ | **MODIFY** train |
| modelHash in npz | Optional | 文件 hash 覆盖 | N/A | **MODIFY** 文档 |
| metrics | 未列 | log only | ✅ | **MODIFY** 文档 |

### 4.4 Validation Boundary Matrix

| 阶段 | Addendum | 代码 | 裁决 |
|------|----------|------|------|
| Stage1 Schema/Shape/Loader | §2 | `test_loader` 片段 | **MODIFY** 专用 validate |
| Stage1 禁 FW | §2 | — | **MODIFY** |
| Stage2 FW+E2E+dialog_200 | §2/§7 | 手动脚本 | **KEEP** 工具 |
| Adapter parity in Stage1 | §3 | ❌ | **MODIFY** |

### 4.5 Runtime Non-Interference Matrix

| 风险 | 状态 |
|------|------|
| Calibration 进 Recall | ❌ 无 |
| offline metric 进 Runtime | ❌ 无 |
| audit 置信度分档进 Decision | ❌ 无（误用风险 P3A-R01） |
| Registry | ❌ 无 |

### 4.6 Regression Gate Matrix（Addendum §10）

| 测试 | Addendum | 代码 | 裁决 |
|------|----------|------|------|
| Feature Parity | 要求 | Runtime only (`test_phase2_contracts`) | **MODIFY** +train |
| Artifact Validation | 要求 | `test_loader` 部分 | **MODIFY** |
| Runtime Adapter Validation | 要求 | 仅 signature 测试 | **MODIFY** |
| Offline Evaluation 不进 Decision | 要求 | 无 | **MODIFY** |
| Phase 2 contracts | 继承 | ✅ | **KEEP** |

---

## 5. Required Repair Matrix

| 优先级 | ID | 动作 |
|--------|-----|------|
| **P0** | P3A-C01, P3A-C03, P3A-R03 | train→contract；adapter 最终 validation |
| **P1** | P3A-C02, C04–C08, P3A-03 | metadata；validate/eval 模块；MC-07 量化 |
| **P1** | P3A-01, D01 | 主方案/validationResult 与 Addendum 对齐 |
| **P2** | P3A-D02–D04, P3A-04–07 | 文档/README/字段澄清 |
| **并行** | P3A-R04 | CLEANUP-2 |

---

## 6. KEEP / MODIFY / RESTORE / DELETE

### KEEP

- Phase 1/2/Addendum 禁止项（Runtime/Decision/Registry）
- `mel.py` 共享 Feature、`numpy_p0`、`loader` fail-closed
- `audit_tone_reliability` / `audit_runtime_acceptance`（§6 人工分析）
- `confidence` 作 Required 字段但不进 Recall
- `test_phase2_contracts` / `test_loader`（扩展而非替换）

### MODIFY

- `train_tone_cnn.py`（§4/§3/§8）
- 新增 Stage1 validate + MC-04 offline eval + §10 四门测试
- 主方案 §6 weights/bias、validationResult（P3A-01/D01）
- Addendum 补充 P3A-02–07
- README Phase 3（§9，启动时）

### RESTORE

无。

### DELETE

- **不得**恢复 Registry/Switching
- **建议弃用**主方案 `validationResult` 作为独立字段（并入 `notes` 或删除示例）

---

## 7. 验收三分法（Addendum 语境）

| 判断 | 结论 |
|------|------|
| **Foundation 是否仍有效** | ✅ 是 |
| **Addendum 是否足以指导开发** | ✅ **CONDITIONAL** — 吸收 P3A-03/07 后 |
| **模型质量是否已达标** | ❌ 否 — MC-04/05 未做 |
| **代码是否已符合 Addendum** | ❌ 否 — MC-01–04 与 §10 未落地 |

---

## 8. Final Verdict

```text
CONDITIONAL PASS
```

**Addendum 可作为 Phase 3 最终执行约束**（与主方案冲突时 **以 Addendum 为准**）。

**开发启动条件：**

1. 吸收 **P3A-03**（Model Quality 量化）、**P3A-07**（测试路径）  
2. 首个代码项：**P3A-C01 + P3A-C03**（contract SSOT + adapter validation）  
3. **禁止**以 `val_acc`（训练内 `_softmax`）单独作为 artifact 放行依据  

---

**审计类型：** 只读 · 未修改代码、配置、模型、SSOT 或测试数据（本报告除外）。
