<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Tone_V2_Phase1_Production_Baseline_Recovery_Training_Report_2026_07_12.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Tone V2 Phase 1 — Production Baseline Recovery Training Report

**日期：** 2026-07-12  
**类型：** Production Baseline Recovery Training  
**目标：** 恢复 P9-C3 等价全量 Production Baseline Artifact（独立命名，不覆写 Runtime 默认文件）

---

## Executive Summary

| 维度 | 结果 |
|------|------|
| GPU Full Training | ✅ 完成（20 epochs · AISHELL-3 997,992 cache） |
| Best Validation | **val_acc = 0.7144**（best epoch **19**） |
| Artifact | ✅ `production/tone_cnn_p1_v1_production_20260712.npz` |
| trainingVersion | `production_baseline_20260712`（非 smoke） |
| validate_artifact_v1 | ✅ PASS |
| Probe | ✅ PASS |
| Runtime Loader | ✅ 无需改代码，`TONE_MODEL_PATH` 即可加载 |
| Smoke 覆写 Production | ✅ **No** — `tone_cnn_p1_v1_full.npz` 仍为 `p10_structural_smoke` |

### Final Verdict: **A — Production Baseline Restored**

可进入 Phase 2（Runtime Domain 优化训练）。

---

## 十三、必须回答（10 问）

| # | 问题 | 答案 |
|---|------|------|
| 1 | Production Baseline 是否训练成功？ | **是** |
| 2 | 是否恢复真正 Production Artifact？ | **是** — 850,680 train / 147,312 val · 20 epoch GPU 全量训练 |
| 3 | Artifact 是否独立命名？ | **是** — `tone_module/models/production/tone_cnn_p1_v1_production_20260712.npz` |
| 4 | 是否再出现 Smoke 覆盖 Production？ | **No** — `tone_cnn_p1_v1_full.npz` 未修改 |
| 5 | Validation 是否 PASS？ | **是** |
| 6 | Probe 是否 PASS？ | **是** |
| 7 | Runtime 是否无需修改即可加载？ | **是** — `ToneModelLoaderV1` + `ToneClassifier` ready |
| 8 | Node 是否无需修改即可运行？ | **是** — 协议不变；部署时设 `TONE_MODEL_PATH` |
| 9 | 是否形成 Production Baseline？ | **是** |
| 10 | 是否具备进入 Phase 2 条件？ | **是** |

---

## 十四、Production Baseline 统计

### Dataset & Cache

| 项 | 值 |
|----|-----|
| Dataset | AISHELL-3（`openslr_aishell3` / `v1`） |
| Alignment | `textgrid_pinyin_v1` |
| Holdout | speaker · val_ratio=0.15 · seed=42 |
| Feature Cache | `tone_module/_data_cache/datasets/openslr_aishell3/v1/training_features_v2` |
| cacheSampleCount | **997,992** |
| cacheFeatureVersion | `p1-frame-mel-f0-v1` |
| cacheSchemaVersion | `training_feature_shard_v2` |
| Train / Val | **850,680 / 147,312** |

### Training（P9-C3 冻结配置）

| 项 | 值 |
|----|-----|
| 命令入口 | `python -m tone_module.run_phase1_baseline_recovery` |
| trainingBackend | `torch_cuda_v1` |
| GPU | NVIDIA GeForce RTX 4060 Laptop GPU |
| torch | 2.6.0+cu124 |
| Epochs | 20 |
| Batch Size | 128 |
| Learning Rate | 0.01 |
| Seed | 42 |
| Training Wall Time | **~1238 s（~20.6 min）** |
| Best Epoch | **19** |
| Best val_acc | **0.7144** |
| Final train_acc | 0.729 |

**对照 P9-C3（2026-07-10）：** best val_acc **0.699** @ epoch 14。本轮恢复结果在同一量级且略高（随机种子 / 内存路径差异可接受）。

### Epoch 摘要

| Epoch | train_acc | val_acc | dur(s) |
|-------|-----------|---------|--------|
| 1 | 0.443 | 0.485 | 57 |
| 5 | 0.658 | 0.660 | 46 |
| 10 | 0.701 | 0.696 | 116 |
| 14 | 0.716 | 0.710 | 108 |
| 19 | 0.727 | **0.714** | 42 |
| 20 | 0.729 | 0.714 | 40 |

完整日志：`tone_module/models/production/training_log_20260712.txt`

### Artifact

| 项 | 值 |
|----|-----|
| **Path** | `tone_module/models/production/tone_cnn_p1_v1_production_20260712.npz` |
| modelVersion | `tone_cnn_p1_v1` |
| trainingVersion | `production_baseline_20260712` |
| featureVersion | `p1-frame-mel-f0-v1` |
| formatVersion | `npz-p1-v1` |
| backend | `numpy_p1` |

### Validation

```text
validation=PASS | schema=True | shape=True | loader=True | adapter=True
```

报告：`tone_module/models/production/validate_20260712.json`

### Acceptance（全量 Val · 分块推理）

| 项 | 值 |
|----|-----|
| val_acc | **0.71438** |
| valSamples | 147,312 |

**Per-class accuracy**

| Class | Accuracy |
|-------|----------|
| t1 | 0.750 |
| t2 | 0.733 |
| t3 | 0.632 |
| t4 | 0.733 |
| t5 | 0.607 |

**Confusion matrix：** 见 `tone_module/models/production/acceptance_20260712.json`

### Probe

```json
{
  "passed": true,
  "feature_version": "p1-frame-mel-f0-v1",
  "backend": "numpy_p1",
  "posterior_shape": [32, 5],
  "softmax_sum_min": 0.9999999,
  "softmax_sum_max": 1.0000001
}
```

报告：`tone_module/models/production/probe_20260712.json`

### Runtime Compatibility

| 检查 | 结果 |
|------|------|
| `ToneModelLoaderV1.load(TONE_MODEL_PATH)` | ✅ ready |
| `ToneClassifier` | ✅ ready · `numpy_p1` |
| Runtime 代码修改 | **无** |

验证命令：

```powershell
$env:TONE_MODEL_PATH="...\production\tone_cnn_p1_v1_production_20260712.npz"
python -c "from tone_module.loader_v1 import ToneModelLoaderV1; ..."
```

### Node Compatibility

| 检查 | 结果 |
|------|------|
| Node / FW / Recall 代码修改 | **无** |
| 部署方式 | FW 进程设置 `TONE_MODEL_PATH` 指向 production npz |
| 协议 | 不变 |

---

## Artifact Governance（本轮允许改动）

### 目录结构

```text
tone_module/models/
  production/   tone_cnn_p1_v1_production_20260712.npz
  candidate/
  smoke/        tone_cnn_structural_smoke.npz  (从 full.npz 归档副本)
  ARTIFACT_GOVERNANCE.md
```

### 新增治理模块

| 文件 | 用途 |
|------|------|
| `tone_module/artifact_governance.py` | 路径规范 · acceptance · metadata sidecar |
| `tone_module/run_phase1_baseline_recovery.py` | Phase1 恢复训练编排（CUDA 先于 config 导入） |
| `tone_module/models/ARTIFACT_GOVERNANCE.md` | 命名与晋升规则 |

### 未覆写文件

| 文件 | trainingVersion | 状态 |
|------|-----------------|------|
| `tone_cnn_p1_v1_full.npz` | `p10_structural_smoke` | **未修改**（Runtime 默认仍指向 smoke，需手动设 `TONE_MODEL_PATH` 使用 baseline） |

---

## 基础设施修复（训练可运行性 · 非超参调整）

本轮机器 RAM 有限（全量 train cache ~16.8 GiB），且 Windows 上 `config` 先于 CUDA 导入会导致 cudnn 崩溃。以下 **最小修复** 仅恢复 P9-C3 同等训练能力，**未改变** epoch / batch / lr / dataset / cache：

| 文件 | 修复 |
|------|------|
| `training_io/shard_reader_v2.py` | 大数组 memmap 分配 |
| `models/cnn_p1.py` `fit_feature_norm` | 分块统计（数学等价） |
| `training/gpu/dataloader.py` | memmap 不 pin_memory / 避免整表复制 |
| `run_phase1_baseline_recovery.py` | CUDA 训练先于 `config` 导入 |

---

## 部署 Production Baseline（Runtime）

**不修改代码。** 启动 FW 前：

```powershell
$env:TONE_MODEL_PATH="D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad\tone_module\models\production\tone_cnn_p1_v1_production_20260712.npz"
# 然后启动 faster_whisper_vad_service（端口按环境配置）
```

**禁止**在未完成 acceptance 前将新权重写入 `tone_cnn_p1_v1_full.npz`。

---

## 十五、最终 Verdict

# A — Production Baseline Restored

Production Baseline 已恢复，可作为 Phase 2 Runtime Domain 优化训练的唯一比较基准。

---

## 产物索引

| 产物 | 路径 |
|------|------|
| Production Artifact | `tone_module/models/production/tone_cnn_p1_v1_production_20260712.npz` |
| Training Log | `tone_module/models/production/training_log_20260712.txt` |
| Metrics / Acceptance | `tone_module/models/production/acceptance_20260712.json` |
| Validate | `tone_module/models/production/validate_20260712.json` |
| Probe | `tone_module/models/production/probe_20260712.json` |
| Governance | `tone_module/models/ARTIFACT_GOVERNANCE.md` |

---

*本轮未修改 Runtime / Node / Feature / Dataset / Split / 训练超参策略。*
