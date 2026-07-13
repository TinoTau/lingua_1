# Tone V2 — Training Engineering Freeze（SSOT）

**状态：** FROZEN  
**生效：** 2026-06-30（Phase 7-B Close）  
**优先级：** Training Foundation IO 层 **唯一 SSOT**；与 [TONE_V2_DATASET_FOUNDATION_FREEZE.md](./TONE_V2_DATASET_FOUNDATION_FREEZE.md)（数据层）· [TONE_V2_CONTRACT_FREEZE.md](./TONE_V2_CONTRACT_FREEZE.md)（Runtime · Artifact）并列。  
**术语：** [TONE_V2_TERMINOLOGY.md](./TONE_V2_TERMINOLOGY.md) · [TONE_V2_DOCUMENTATION_STYLE_GUIDE.md](./TONE_V2_DOCUMENTATION_STYLE_GUIDE.md)  
**运维指南：** [TONE_V2_TRAINING_ENGINEERING_GUIDE.md](./TONE_V2_TRAINING_ENGINEERING_GUIDE.md)  
**证据：** [Tone_V2_Phase7B1_Training_IO_Engineering_Development_Report.md](./Tone_V2_Phase7B1_Training_IO_Engineering_Development_Report.md) · [Tone_V2_Phase7B2_Canonical_Feature_Shard_Acceptance_Report.md](./Tone_V2_Phase7B2_Canonical_Feature_Shard_Acceptance_Report.md) · [Tone_V2_Phase7B_Training_Engineering_Freeze_Report.md](./Tone_V2_Phase7B_Training_Engineering_Freeze_Report.md)

> 修改本文档所列 **冻结组件** 须走 **Training Engineering 再冻结** 流程。  
> **不得**以 Dataset / Runtime / Contract 便利为由修改 Training Engineering 冻结体。  
> **禁止**在文档与实现中使用「Streaming Feature」「Streaming Training」— 见 TERMINOLOGY 正名。

---

## 1. 冻结范围（Frozen Scope）

以下构成 Tone V2 **唯一 Training Engineering SSOT**，**禁止直接修改**（bugfix 除外须走再冻结）：

| 组件 | 代码锚点 | 职责 |
|------|----------|------|
| **Feature Shard** | `tone_module/training_io/feature_shard.py` | 从 `SyllableSample[]` 构建 `shard_*.npz` · mel 特征物化 · 写入 manifest |
| **Shard Manifest** | `training_features/shard_manifest.json` | schemaVersion · featureVersion · holdout · shard 索引 · logical digest |
| **Shard Reader** | `tone_module/training_io/shard_reader.py` | 只读访问 Feature Shard 文件 |
| **Sequential Feature Reader** | 同上 `SequentialFeatureReader` | 顺序遍历 train/val 特征行 |
| **Mini-batch Reader** | 同上 `MiniBatchReader` | batch 采样 · shuffle · epoch 覆盖 |
| **Speaker Holdout（Canonical）** | `tone_module/training_io/speaker_holdout.py` | 说话人级 train/val 划分 · Canonical 默认 `holdout=speaker` |
| **Training IO Contract** | manifest schema · `training_feature_shard_v1` | 特征维度 · dtype · split 槽 · 与 `contract.py` featureVersion 对齐 |
| **Canonical Feature Shard** | `{cache}/datasets/openslr_aishell3/v1/training_features/` | P7-B2 全量物化证据 |
| **Canonical Training Input** | Shard Reader 链 → `fit_norm_stats` → 训练张量 | **唯一**正式大规模训练 IO |
| **train_tone_cnn Training IO** | `tone_module/train_tone_cnn.py` | 子命令 `train` · `build-feature-shards`；`--dataset aishell3` 接线 |
| **Pilot Training Path** | `data_mini` 默认 · `_pilot_phase7b1_io.npz` | Regression Fixture 回归；**不**替代 Canonical |
| **Training IO Validation** | `tone_module/training_io/probe_feature_shard.py` | `build` · `accept` · `repeatability` |
| **Feature Shard Acceptance** | `test_phase7b1_training_io.py` · `test_phase7b2_canonical_feature_shard.py` | Level 1 回归 · B2 冻结门 |
| **Training Engineering 包导出** | `tone_module/training_io/__init__.py` | 公共 API 面 |

**不在 Training Engineering 冻结内（属模型能力 / Artifact）：** `classifier` 结构 · 损失函数 · 超参搜索 · `validate_artifact` 语义 · Runtime · Loader。

---

## 2. 唯一正式 Training IO 主链（冻结）

```text
Dataset Foundation（上游 · 非本 SSOT）
    SyllableSample[]
        ↓
Feature Shard（build-feature-shards / feature_shard.py）
    shard_manifest.json + shard_*.npz
        ↓
Shard Reader
        ↓
Sequential Feature Reader
        ↓
Mini-batch Reader
        ↓
Training（train_tone_cnn train）
    → npz artifact → validate_artifact
```

**裁决：** 上链为 Tone V2 **唯一正式 Training IO**。  
**禁止：** 训练路径绕过 Feature Shard 直接全量 `audio_cache` 加载（Canonical 规模）；**禁止**第二套 Training IO Pipeline。

**与 Dataset Foundation 边界：** Training Engineering **仅消费** `SyllableSample[]`；**不得**修改 Adapter · Provider · Manifest · Join 语义。  
**与 Runtime 边界：** `training_io/` **不** import `inference` · `classifier` · `loader` · FW Decision。

---

## 3. Canonical Feature Shard（P7-B2 基线）

| 项 | 值 |
|----|-----|
| Cache 槽 | `{cache}/datasets/openslr_aishell3/v1/training_features/` |
| schemaVersion | `training_feature_shard_v1` |
| featureVersion | `p0-v1` |
| nMels | **80** |
| sampleCount | **997,992** |
| shardCount | **21** |
| holdout | **speaker**（train **186** / val **32** 说话人） |
| train syllables | **850,680** |
| val syllables | **147,312** |
| 磁盘 | **332 MB** |
| manifest_logical_digest | `ad0f76623743a429848918dd2345bff3af7a78aa8b70fffdfbd164b3b7c9c300` |
| 验收 JSON | `phase7b2_acceptance.json` |

**构建（运维）：**

```bash
python -m tone_module.training_io.probe_feature_shard build \
  --cache-dir tone_module/_data_cache
```

---

## 4. Regression Fixture（data_mini · 默认不变）

| 项 | 基线 |
|----|------|
| `train_tone_cnn` 默认 pipeline | `default_data_mini_pipeline` |
| syllables | **11,820** |
| train / val | **10,012 / 1,808** |
| CI 行为 | **不得**因 Canonical 接线改变默认 |

Canonical 全量训练须 **显式** `--dataset aishell3`（及 shard 路径）；**不得**静默切换默认语料。

---

## 5. 模型复用裁决（tone_cnn · tone_crnn · future）

| 模型 | Training Engineering |
|------|----------------------|
| `tone_cnn`（当前） | **复用** 本 SSOT 全链 |
| `tone_crnn`（未来） | **复用** Feature Shard · Reader · Holdout · IO Contract |
| 未来任意 Tone 模型 | **复用** Training Engineering；**仅**可新增模型头 / 损失 / 训练循环细节 |

**禁止（须 Training Engineering 再冻结）：** 为单模型便利修改 Feature Shard schema · Reader 协议 · Speaker Holdout 语义 · manifest 必填字段。

---

## 6. Training IO Validation（验收门）

**唯一 CLI SSOT：** `python -m tone_module.training_io.probe_feature_shard`

| 子命令 | 职责 |
|--------|------|
| `build` | 调用 `build-feature-shards` 构建 Canonical Feature Shard |
| `accept` | Level 1 测试 + manifest 校验 + holdout 计数 + Mini-batch epoch + 无 `audio_cache` 源码审计 |
| `repeatability` | manifest logical digest 可重复性 |

> **Training IO Validation** 是 Training Engineering 验收门；**不是** Runtime Validation（Level 3）；**不是** Dataset Probe（Level 2）。见 [TONE_V2_TERMINOLOGY.md](./TONE_V2_TERMINOLOGY.md)。

**门禁（`accept` · P7-B2 校准）：**

| Gate | 阈值 |
|------|------|
| sample_count | 997,992 |
| train_syllables | 850,680 |
| val_syllables | 147,312 |
| train_speakers | 186 |
| val_speakers | 32 |
| mini_batch_epoch | 完整覆盖 train 集 |
| audio_cache_in_training_io | **禁止**（源码审计） |

---

## 7. 允许 / 禁止修改（Freeze 后）

| 允许 | 禁止（须 Training Engineering 再冻结） |
|------|----------------------------------------|
| 新 **模型** 训练脚本接入 Mini-batch Reader | 修改 `training_feature_shard_v1` schema |
| 调整 **模型** 超参 · 架构 · checkpoint | 修改 Shard Reader / Sequential / Mini-batch 协议 |
| 运维：重建 Canonical shard（同 contract） | 修改 Speaker Holdout 默认语义 |
| Pilot / 限流：`max_speakers` · `max_syllables`（非 Canonical accept） | 第二 Training IO 入口 · 旁路 Reader |
| 模型能力阶段：换权重 · 新 artifact | 为训练便利修改 `contract.py` · `mel.py` · Dataset Foundation |

---

## 8. Regression Gate（Training Engineering）

```powershell
cd electron_node/services/faster_whisper_vad
python -m unittest tone_module.test_phase7b1_training_io tone_module.test_phase7b2_canonical_feature_shard tone_module.test_phase6d_dataset tone_module.test_phase6e_aishell3 -q
```

| 门 | 期望 |
|----|------|
| `test_phase7b1_training_io` | Shard parity · Reader · holdout · pilot |
| `test_phase7b2_canonical_feature_shard` | manifest · digest · 计数（fixture 或本地 shard） |
| `test_phase6d_dataset` | data_mini 基线不变 |
| `test_phase6e_aishell3` | Dataset Foundation 冻结层不变 |
| 全量 Canonical（运维） | `probe_feature_shard accept` → **PASS** |

**Dataset Foundation 回归（正交）：** `probe_aishell3 accept` — 见 Dataset Foundation SSOT。

---

## 9. 相关文档

| 文档 | 关系 |
|------|------|
| [TONE_V2_DATASET_FOUNDATION_FREEZE.md](./TONE_V2_DATASET_FOUNDATION_FREEZE.md) | 上游 SyllableSample；**正交** |
| [TONE_V2_CONTRACT_FREEZE.md](./TONE_V2_CONTRACT_FREEZE.md) | Runtime · Artifact · featureVersion |
| [TONE_V2_TRAINING_ENGINEERING_GUIDE.md](./TONE_V2_TRAINING_ENGINEERING_GUIDE.md) | 运维 Runbook |
| [README.md](./README.md) | 文档索引 |

---

*Training Engineering Freeze — no Runtime / Dataset Foundation / Training logic code changes in freeze round.*
