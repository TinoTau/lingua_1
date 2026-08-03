<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/README.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Tone V2 — 文档索引（SSOT）

**Phase 1：** CLOSED（2026-06-29）  
**Phase 2 Foundation：** CLOSED / FROZEN（2026-06-29）  
**Phase 3 Model Capability Foundation：** CLOSED / FROZEN（2026-06-29）  
**Phase 4 Model Freeze：** `tone_cnn_p1` canonical（2026-06-29）  
**Phase 6-A：** Model Iteration Platform Cleanup（工具链泛化 · 非 Runtime）  
**Phase 6-D：** Dataset Pipeline Foundation（DatasetAdapter · AlignmentProvider · CacheLayout）  
**Phase 6-E：** AISHELL-3 Dataset Adapter（`OpenSlrAishell3DatasetAdapter` · `probe_aishell3`）  
**Phase 7-A：** Dataset Foundation **CLOSED / FROZEN**（2026-06-29）— [TONE_V2_DATASET_FOUNDATION_FREEZE.md](./TONE_V2_DATASET_FOUNDATION_FREEZE.md)  
**Phase 7-B：** Training Engineering **CLOSED / FROZEN**（2026-06-30）— [TONE_V2_TRAINING_ENGINEERING_FREEZE.md](./TONE_V2_TRAINING_ENGINEERING_FREEZE.md)  
**Terminology Freeze：** 四级验收术语 SSOT（2026-06-29）— [Tone_V2_Terminology_Freeze_Report.md](./Tone_V2_Terminology_Freeze_Report.md)

---

## 术语 SSOT（必读）

| 文档 | 用途 |
|------|------|
| **[TONE_V2_TERMINOLOGY.md](./TONE_V2_TERMINOLOGY.md)** | **唯一术语 SSOT** — Level 1–4 验收体系 |
| [TONE_V2_DOCUMENTATION_STYLE_GUIDE.md](./TONE_V2_DOCUMENTATION_STYLE_GUIDE.md) | 文档写作与禁止词 |

```text
Level 1  Unit Test
Level 2  Dataset Probe  →  Join Audit · Dataset Statistics Probe · Fixture Test
Level 3  Runtime Validation  →  TONE_MODEL_PATH → FW Restart → Node E2E
Level 4  Architecture Verification  →  Frozen Architecture · Drift
```

**禁止**将 Dataset Probe 与 Runtime Validation 混用。**禁止**新文档使用 Smoke / Deployment Smoke 作为验收类型（语料脚本 **文件名** 除外）。

---

## Dataset Foundation（Phase 7-A · FROZEN · Training only）

**SSOT：** [TONE_V2_DATASET_FOUNDATION_FREEZE.md](./TONE_V2_DATASET_FOUNDATION_FREEZE.md)

| 角色 | 数据集 | `dataset_id` |
|------|--------|--------------|
| **Current Canonical Training Dataset** | AISHELL-3 全量（OpenSLR + lars76） | `openslr_aishell3` |
| **Regression Fixture** | `CS5647Team3_data_mini` | `CS5647Team3_data_mini` |

| 模块 | 用途 |
|------|------|
| `tone_module/dataset/dataset_contract.py` | `SyllableSample` · `DatasetManifest` · Adapter/Provider 协议 — **FROZEN** |
| `tone_module/dataset/adapter_hf_zip.py` | `HuggingFaceZipDatasetAdapter`（Regression Fixture） |
| `tone_module/dataset/adapter_openslr_aishell3.py` | `OpenSlrAishell3DatasetAdapter`（Canonical） |
| `tone_module/dataset/probe_aishell3.py` | materialize / join-audit / stats / **`accept`** — **FROZEN** |
| `tone_module/dataset/alignment_textgrid.py` | `TextGridPinyinAlignmentProvider` — **FROZEN** |
| `tone_module/dataset/cache_layout.py` | 多 dataset/version 缓存槽 — **FROZEN** |
| `tone_module/train_tone_cnn.py` | 训练编排器（默认仍 `data_mini`；Canonical 显式 `--dataset aishell3`） |

**扩展新语料（Baker · 企业 · 用户）：** **仅**新增 `DatasetAdapter` +（必要时）`AlignmentProvider`；**不得**修改 Dataset Foundation Framework。  
**Runbook：** [Tone_V2_Phase6E_AISHELL3_Dataset_Adapter_Runbook.md](./Tone_V2_Phase6E_AISHELL3_Dataset_Adapter_Runbook.md)  
**P7-A 验收：** [Tone_V2_Phase7A_AISHELL3_Full_Dataset_Acceptance_Report.md](./Tone_V2_Phase7A_AISHELL3_Full_Dataset_Acceptance_Report.md) · [Tone_V2_Phase7A_Dataset_Foundation_Freeze_Report.md](./Tone_V2_Phase7A_Dataset_Foundation_Freeze_Report.md)

**术语（P6-E）：** **Dataset Probe**（Level 2）与 **Runtime Validation**（Level 3）**不得混用**。见 [TONE_V2_TERMINOLOGY.md](./TONE_V2_TERMINOLOGY.md)。

---

## Training Engineering（Phase 7-B · FROZEN · Training only）

**SSOT：** [TONE_V2_TRAINING_ENGINEERING_FREEZE.md](./TONE_V2_TRAINING_ENGINEERING_FREEZE.md) · **Guide：** [TONE_V2_TRAINING_ENGINEERING_GUIDE.md](./TONE_V2_TRAINING_ENGINEERING_GUIDE.md)

```text
SyllableSample[]  →  Feature Shard  →  Shard Reader  →  Sequential Feature Reader  →  Mini-batch Reader  →  Training
```

| 模块 | 用途 |
|------|------|
| `tone_module/training_io/feature_shard.py` | Feature Shard 构建 · manifest — **FROZEN** |
| `tone_module/training_io/shard_reader.py` | Shard / Sequential / Mini-batch Reader — **FROZEN** |
| `tone_module/training_io/speaker_holdout.py` | Speaker Holdout（Canonical 默认）— **FROZEN** |
| `tone_module/training_io/probe_feature_shard.py` | `build` · `accept` · `repeatability` — **FROZEN** |
| `training_features/`（Canonical 槽） | 997,992 · 21 shard · P7-B2 基线 |

**P7-B 验收：** [Tone_V2_Phase7B2_Canonical_Feature_Shard_Acceptance_Report.md](./Tone_V2_Phase7B2_Canonical_Feature_Shard_Acceptance_Report.md) · [Tone_V2_Phase7B_Training_Engineering_Freeze_Report.md](./Tone_V2_Phase7B_Training_Engineering_Freeze_Report.md)  
**历史依据：** [Tone_V2_Phase7B_Training_Engineering_PreDev_Audit_Report.md](./Tone_V2_Phase7B_Training_Engineering_PreDev_Audit_Report.md) · [Tone_V2_Phase7B1_Training_IO_Engineering_Development_Report.md](./Tone_V2_Phase7B1_Training_IO_Engineering_Development_Report.md)

**模型复用：** `tone_cnn` · `tone_crnn` · 未来模型 **全部复用** Training Engineering；改 IO 须 **Training Engineering 再冻结**。

---

## Model iteration tooling（Phase 6-A SSOT）

| 工具 | 用途 |
|------|------|
| `electron-node/tests/tone-v2-dialog200-batch.js` | **Runtime Validation**（Level 3）· dialog_200 batch（`--session` `--out` `TONE_MODEL_PATH` `--wait-fw`） |
| `python -m tone_module.train_tone_cnn` | P0 MLP 训练（`--model-version` `--output` `--dataset-repo` …） |
| `python -m tone_module.validate_artifact` | Artifact 四阶段验收（`--artifact` `--json-out`） |
| `python -m tone_module.offline_tone_eval` | 离线 posterior 质量（`--artifact` `--json-out` 或 `--eval-json`） |

**Deprecated（薄包装，勿再复制）：** `tone-v2-phase1/phase3/phase4-*-dialog200-batch.js` → 转发至 `tone-v2-dialog200-batch.js`

**Canonical：** `tone_cnn_p1` · **Candidate：** `tone_cnn_p2` / `p3` — 换模型仅 `TONE_MODEL_PATH` + FW 重启；禁止 Registry / Switching / Hot Reload。

---

## Phase 3（Model Capability Foundation — 非 Runtime）

Phase 3 仅修改 **Training · Artifact · Validation · Offline Evaluation**，**不得**修改 Runtime · Decision · Loader · Recall · Ranking。

| 文档 | 用途 |
|------|------|
| [Phase 3 Model Capability Development Plan](./Tone%20V2%20Phase%203%20%E2%80%94%20Model%20Capability%20Development%20Plan.md) | 主方案 |
| [Phase 3 Supplement Addendum](./Tone%20V2%20Phase%203%20Development%20Plan%20%E2%80%94%20Supplement%20Addendum.md) | 执行补充 |
| **[Phase 3 Supplement Addendum II](./Tone%20V2%20Phase%203%20%E2%80%94%20Supplement%20Addendum%20II.md)** | **最终执行约束** — Artifact / Validation / Regression / Acceptance |

Artifact Metadata · Validation Pipeline · Offline Evaluation 均以 **Addendum II** 为准。

---

## 唯一有效 SSOT（修改须走再冻结流程）

| 文档 | 用途 |
|------|------|
| **[TONE_V2_CONTRACT_FREEZE.md](./TONE_V2_CONTRACT_FREEZE.md)** | **唯一契约 SSOT** — Runtime · Data · Ownership · Phase 2 Foundation · Loader · Backend · Diagnostics · Regression |
| **[TONE_V2_DATASET_FOUNDATION_FREEZE.md](./TONE_V2_DATASET_FOUNDATION_FREEZE.md)** | **唯一 Dataset Foundation SSOT** — Contract · Adapter · Provider · Cache · Probe · Canonical / Fixture |
| **[TONE_V2_TRAINING_ENGINEERING_FREEZE.md](./TONE_V2_TRAINING_ENGINEERING_FREEZE.md)** | **唯一 Training Engineering SSOT** — Feature Shard · Reader · Holdout · Training IO · Canonical Shard |
| **[TONE_V2_TERMINOLOGY.md](./TONE_V2_TERMINOLOGY.md)** | **唯一术语 SSOT** — 四级验收体系 · 禁止词 |
| [TONE_V2_DOCUMENTATION_STYLE_GUIDE.md](./TONE_V2_DOCUMENTATION_STYLE_GUIDE.md) | 文档风格与 Historical Issue 模板 |
| **[../tone-module/ARCHITECTURE.md](../tone-module/ARCHITECTURE.md)** | Tone 模块实现 · 数据流 · Node 集成 |
| **[Tone_V2_Phase2_Deployment_Runbook.md](./Tone_V2_Phase2_Deployment_Runbook.md)** | 权重升级 · 新服务实例（运维） |

**后续模型能力开发前代码审计** 仅对照上表 **四份** SSOT 文档 + 当前代码。

### 关联 FW SSOT（Tone 段落已同步）

| 文档 | 路径 |
|------|------|
| FW 主架构 | [../fw-detector/ARCHITECTURE.md](../fw-detector/ARCHITECTURE.md) |
| Ranking V1.2 | [../fw-detector/assembly/RANKING_V1_2.md](../fw-detector/assembly/RANKING_V1_2.md) |
| FW Framework Freeze | [../fw-detector/freeze/FROZEN.md](../fw-detector/freeze/FROZEN.md) |
| Diagnostics | [../fw-detector/diagnostics/FROZEN.md](../fw-detector/diagnostics/FROZEN.md) |

---

## 冻结证据（归档保留 · 非 SSOT · 不得与契约冲突）

| 文档 | 说明 |
|------|------|
| [Tone_V2_Phase1_Freeze_Report.md](./Tone_V2_Phase1_Freeze_Report.md) | Phase 1 关闭裁决 |
| [Tone_V2_Phase1_Node_E2E_Runtime_Recovery_Report.md](./Tone_V2_Phase1_Node_E2E_Runtime_Recovery_Report.md) | Phase 1 E2E 200/200 |
| [Tone_V2_Phase2_Foundation_Freeze_Audit_Report_2026_06_29.md](./Tone_V2_Phase2_Foundation_Freeze_Audit_Report_2026_06_29.md) | Phase 2 Foundation 冻结审计 |
| [Tone_V2_Phase2_Development_Report.md](./Tone_V2_Phase2_Development_Report.md) | Phase 2 开发报告 |
| [Tone_V2_Phase2_Node_E2E_Test_Report.md](./Tone_V2_Phase2_Node_E2E_Test_Report.md) | Phase 2 E2E 131/131 |
| [Tone_V2_Phase2_Foundation_Documentation_Update_Report_2026_06_29.md](./Tone_V2_Phase2_Foundation_Documentation_Update_Report_2026_06_29.md) | Phase 2 Foundation 文档同步 |
| [Tone_V2_Phase7A_Dataset_Foundation_Freeze_Report.md](./Tone_V2_Phase7A_Dataset_Foundation_Freeze_Report.md) | Phase 7-A Dataset Foundation 冻结 |
| [Tone_V2_Phase7A_AISHELL3_Full_Dataset_Acceptance_Report.md](./Tone_V2_Phase7A_AISHELL3_Full_Dataset_Acceptance_Report.md) | P7-A 全量 Level 2 验收证据 |
| [Tone_V2_Phase7B_Training_Engineering_Freeze_Report.md](./Tone_V2_Phase7B_Training_Engineering_Freeze_Report.md) | Phase 7-B Training Engineering 冻结 |
| [Tone_V2_Phase7B2_Canonical_Feature_Shard_Acceptance_Report.md](./Tone_V2_Phase7B2_Canonical_Feature_Shard_Acceptance_Report.md) | P7-B2 Canonical Feature Shard 验收证据 |

---

## 历史依据（只读 · 已并入 CONTRACT_FREEZE · 不得指导实现）

| 文档 | 说明 |
|------|------|
| Phase 1 Development Plan / Supplement / Final Addendum | Phase 1 过程 |
| [Phase 2 Restart Supplement](./Tone%20V2%20Phase%202%20Restart%20Supplement%20%E2%80%94%20Single%20Service%20Single%20Model.md) | Phase 2 方案（已冻结） |
| [Phase 2 Restart Supplement Addendum](./Tone%20V2%20Phase%202%20Restart%20Supplement%20Addendum.md) | Phase 2 执行约束（已冻结） |

---

## 归档（Deprecated / Audit — 非 SSOT · Do Not Use For Development）

| 路径 | 内容 |
|------|------|
| **[archive/deprecated/](./archive/deprecated/)** | **Historical Issue** — Registry / Switching / Multi-Model / Phase2A 废弃方案 |
| **[archive/audit/](./archive/audit/)** | 过程审计报告（含历史术语；**非 SSOT**） |

以下模式文档**不得**作为实现依据：`Tone_V2_*_Audit_*.md`（根目录已迁入 `archive/audit/`）· `_audit_*.json` · 旧 Phase2A Registry 路线。

**现行行为** 以 **TONE_V2_CONTRACT_FREEZE.md** + **ARCHITECTURE.md** + Regression Gate 为准。

---

## Regression Gate（摘要）

```powershell
cd electron_node/electron-node
npm run build:main
npm run test:fw-detector
# 通用 Tone E2E（需 Node :5020 + FW 已用 TONE_MODEL_PATH 启动）
node tests/tone-v2-dialog200-batch.js --limit 1 --no-wait-fw
```

```powershell
cd electron_node/services/faster_whisper_vad
python -m unittest tone_module.test_loader tone_module.test_classifier_fail_closed tone_module.test_phase2_contracts tone_module.test_phase3_contracts tone_module.test_phase6d_dataset tone_module.test_phase6e_aishell3 tone_module.test_phase7b1_training_io tone_module.test_phase7b2_canonical_feature_shard -q
python -m tone_module.validate_artifact --artifact tone_module/models/tone_cnn_p1.npz
```

**Foundation E2E 证据：** `tests/experiments/tone-v2-phase2-dialog200-batch-result.json`（131/131 effective_chain）
