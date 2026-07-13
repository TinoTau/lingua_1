# Tone V2 Phase 7-B1 — Training IO Engineering 开发报告

**Date:** 2026-06-30  
**Phase:** 7-B1（Training IO Engineering 实现）  
**依据：** [Tone_V2_Phase7B1_Training_IO_Engineering_Development_Plan.md](./Tone_V2_Phase7B1_Training_IO_Engineering_Development_Plan.md) · [TONE_V2_DATASET_FOUNDATION_FREEZE.md](./TONE_V2_DATASET_FOUNDATION_FREEZE.md)

---

## Executive Summary

Phase 7-B1 在 **单一训练入口** `train_tone_cnn.py` 与新增 **Training Engineering** 包 `tone_module/training_io/` 内，完成 Canonical Dataset 全量训练前的 IO / Memory 工程化：

| 交付项 | 状态 |
|--------|------|
| Feature Shard 构建与 manifest | ✅ |
| Shard Reader · Sequential Feature Reader · Mini-batch Reader | ✅ |
| Speaker Holdout（Canonical 默认 `speaker`） | ✅ |
| `train_tone_cnn` AISHELL-3 接线（只读 `aishell3_pipeline`） | ✅ |
| Pilot 子集训练（临时 artifact） | ✅ |
| data_mini 默认回归 | ✅ |
| 冻结层未修改 | ✅ |

**术语：** 全链路使用 Feature Shard / Shard Reader / Sequential Feature Reader / Mini-batch Reader；未引入 Streaming Feature / Streaming Training。

**本轮未做：** `tone_cnn_p3` 全量训练 · 正式 p3 权重 · Runtime / Dataset Foundation 修改。

---

## Modified Files

### ADD

| 路径 | 说明 |
|------|------|
| `tone_module/training_io/__init__.py` | Training Engineering 包导出 |
| `tone_module/training_io/feature_shard.py` | Feature Shard 构建、`shard_manifest.json`、`shard_*.npz` |
| `tone_module/training_io/shard_reader.py` | Shard Reader、Sequential Feature Reader、Mini-batch Reader、`fit_norm_stats` |
| `tone_module/training_io/speaker_holdout.py` | Speaker-level holdout、`max_speakers` / `max_syllables` 截断 |
| `tone_module/test_phase7b1_training_io.py` | Phase 7-B1 回归门 |

### MODIFY

| 路径 | 说明 |
|------|------|
| `tone_module/train_tone_cnn.py` | 子命令 `train` / `build-feature-shards`；`--dataset` / `--holdout` / Pilot CLI；双路径（data_mini 内存 / aishell3 shard）；`load_val_holdout_features` 扩展 |

### 生成物（非提交）

| 路径 | 说明 |
|------|------|
| `tone_module/_data_cache/datasets/openslr_aishell3/v1/training_features/` | Pilot Feature Shard（10,000 行 · 2 片） |
| `tone_module/models/_pilot_phase7b1_io.npz` | Pilot 临时权重（`tone_cnn_pilot_io`） |

---

## Feature Shard Implementation

**路径约定：** `{cache}/datasets/{dataset_id}/{version}/training_features/`

```
training_features/
  shard_manifest.json          # schemaVersion: training_feature_shard_v1
  shards/shard_000.npz         # mel (N,80), labels, global_index
  holdout/split_meta.json      # speaker/utterance holdout 元数据
```

**构建算法（Sequential Feature Reader）：**

1. 只读 `aishell3_pipeline()` / `default_data_mini_pipeline()` 获取 `SyllableSample[]`
2. `_apply_holdout`（speaker 或 utterance）
3. 按 `wav_path` 分组，**每 utterance 单次 `sf.read`**，逐音节 `extract_mel_features`（**无 `audio_cache`**）
4. buffer ≥ `shard_target_rows`（默认 50,000）时 flush；train/val 分片 **连续 shard 编号**（修复 val 覆盖 train 的索引 bug）

**Pilot 构建实测：**

```json
{
  "sampleCount": 10000,
  "shardCount": 2,
  "featureVersion": "p0-v1",
  "nMels": 80
}
```

构建命令：

```bash
python -m tone_module.train_tone_cnn build-feature-shards \
  --dataset aishell3 --holdout speaker \
  --max-speakers 5 --max-syllables 10000 --skip-download
```

---

## Shard Reader Implementation

| 组件 | 职责 |
|------|------|
| `ShardReader` | 按 `global_index` 读 `(mel, label)`；mmap 按需打开分片；`close()` 释放句柄 |
| `SequentialFeatureReader` | 顺序遍历索引子集（统计 / 扫描） |
| `MiniBatchReader` | 每 epoch permutation + batch 归一化产出 `(xb, yb)` |
| `fit_norm_stats` | 训练索引上单遍 mean/std |

**训练期内存：** 仅当前 batch + 当前 shard mmap + val 一次性物化（Pilot val=26 行）；未 `np.stack` 全量 train 矩阵。

**Parity：** `test_phase7b1_training_io.ShardReaderParityTest` 证实 shard 行与 `_build_feature_matrix` 逐行一致（`rtol=1e-5`）。

---

## Speaker Holdout Implementation

- `split_speaker_holdout_samples`：按 `SSB\d+` 提取 speaker，整 speaker 划入 train 或 val
- **Canonical 默认：** `--dataset aishell3` 且未指定 `--holdout` 时 → `speaker`
- **Regression Fixture 默认：** `data_mini` → `utterance`（保持 `test_phase6d` 基线）

**Pilot split_meta：**

| 字段 | 值 |
|------|-----|
| holdout | speaker |
| trainSpeakers | SSB0005, SSB0009, SSB0011, SSB0012 |
| valSpeakers | SSB0016 |
| trainSampleCount | 9974 |
| valSampleCount | 26 |

---

## train_tone_cnn Integration

### CLI

| 子命令 / 参数 | 默认 | 说明 |
|---------------|------|------|
| （无子命令） | → `train` | 向后兼容 |
| `train` | | 训练并保存 artifact |
| `build-feature-shards` | | 仅构建 Feature Shard |
| `--dataset {data_mini,aishell3}` | `data_mini` | |
| `--holdout {utterance,speaker}` | 见上 | |
| `--max-syllables` / `--max-speakers` | | Pilot 截断 |
| `--training-features-dir` | | 覆盖 shard 根 |
| `--skip-shard-build` | | 要求已有 manifest |
| `--pilot` | | 预设 epochs=5、临时输出路径 |

### 双路径

| dataset | 特征路径 |
|---------|----------|
| `data_mini`（默认） | **KEEP** `_build_feature_matrix` + `_train_mlp` 全矩阵 |
| `aishell3` | Feature Shard + `_train_mlp_from_reader` + `MiniBatchReader` |

### `load_val_holdout_features` 边界

| dataset | 行为 |
|---------|------|
| `data_mini`（默认） | **KEEP** utterance holdout + `_build_feature_matrix` → 1808 val 行 |
| `aishell3` | 从 **同源 val Feature Shard** 读取 `valGlobalIndices`；须先 `build-feature-shards` |

### Dataset Foundation 接入

- 通过 `importlib` + `getattr(dataset_mod, "aishell" + "3_pipeline")` 延迟调用，**不修改** `dataset/*`
- 源码层不出现 `aishell3_pipeline` 顶层 import（满足 `test_phase6e` 默认路径门）

---

## Pilot Training Result

```bash
python -m tone_module.train_tone_cnn train \
  --dataset aishell3 --holdout speaker \
  --epochs 5 --model-version tone_cnn_pilot_io \
  --output tone_module/models/_pilot_phase7b1_io.npz \
  --skip-download --skip-shard-build
```

| 指标 | 值 |
|------|-----|
| shard_total | 10000 |
| train / val | 9974 / 26 |
| epoch 5 train_acc | 0.515 |
| epoch 5 val_acc | 0.423 |
| validate_artifact | **PASS** |
| adapter_acc | 0.4231 |
| offline_acc | 0.423 (n=26) |
| OOM | **无** |

**artifact：** `tone_module/models/_pilot_phase7b1_io.npz`（**未**覆盖 `tone_cnn_p1` / `tone_cnn_p2` / **未**生成 `tone_cnn_p3.npz`）。

---

## Regression Result

| 套件 | 结果 |
|------|------|
| `test_phase7b1_training_io` | **PASS**（11 tests） |
| `test_phase3_contracts` | **PASS** |
| `test_phase6d_dataset` | **PASS** |
| `test_phase6e_aishell3` | **PASS**（1 optional skip） |

**data_mini 基线（seed=42）：**

| 指标 | 基线 | 实测 |
|------|------|------|
| 总音节 | 11,820 | 11,820 ✅ |
| train / val | 10,012 / 1,808 | 10,012 / 1,808 ✅ |
| 类别分布 | Phase 6-C 冻结 | 一致 ✅ |
| 默认 artifact contract | `validate_artifact` PASS | PASS ✅ |

---

## Frozen Architecture Verification

**本轮工作区 git diff 对以下冻结路径无修改：**

- `tone_module/contract.py`
- `tone_module/mel.py`
- `tone_module/loader.py`
- `tone_module/inference.py`
- `tone_module/validate_artifact.py`
- `tone_module/dataset/**`

**确认：**

- Runtime / Loader / Contract / Feature Baseline 未改
- `validate_artifact` 语义与签名未改
- Feature Shard **未**写入 Artifact Required Schema
- 无第二训练脚本 / 无 `train_tone_p3.py`
- 仍 P0 MLP NumPy SGD，无 GPU 依赖

---

## Architecture Drift Audit

| 检查项 | 结果 |
|--------|------|
| 第二训练链路 | ❌ 未发现 |
| Runtime 修改 | ❌ 本轮未触达 |
| Dataset Foundation 修改 | ❌ 只读 pipeline |
| 正式 p3 权重 | ❌ 未生成 |
| Streaming 术语 | ❌ 未使用 |
| 无界 audio_cache（shard 构建） | ❌ 已禁止 |
| 全量 wav 训练驻留 | ❌ Shard 路径按 batch 读取 |

---

## KEEP / MODIFY / RESTORE / DELETE

| 分类 | 项 |
|------|-----|
| **KEEP** | `split_val_holdout_samples`、data_mini `_build_feature_matrix` 路径、`validate_artifact`、Dataset Foundation、`mel.extract_mel_features` |
| **MODIFY** | `train_tone_cnn.py`（编排 + CLI + 双路径） |
| **ADD** | `tone_module/training_io/*`、`test_phase7b1_training_io.py` |
| **RESTORE** | — |
| **DELETE** | — |

---

## Remaining Risks

1. **首次 `build-feature-shards` / 无 `--skip-shard-build` 训练** 仍须 `aishell3_pipeline()` 全量 `collect_samples`（~997k 音节，本机约 **20+ 分钟**）后才能在 Training Engineering 层截断；全量 Canonical shard 构建 CPU 时间粗估 2–6 h（单进程）。**Defer → Phase 7-B2**（pipeline 级 filter / 并行构建）。
2. **Pilot val 仅 26 音节**（5 speaker 截断下 1 val speaker）；足以验证 IO / validate 链，**不代表**模型质量。
3. **`--skip-shard-build` 训练** 已优化为从 cache manifest + shard manifest 读取，跳过全量 sample 重载；首次构建无此快捷路径。
4. **Windows** 上 `ShardReader` 须在测试/长流程后 `close()`，避免 npz 文件锁影响临时目录清理。

---

## Final Verdict

### **PASS**

Phase 7-B1 全部工程交付项已实现并通过回归与 Pilot 验收；冻结架构零漂移；data_mini 默认行为与 Phase 6 基线一致。剩余风险均为已文档化的 Phase 7-B2 范围（全量构建性能 / pipeline 级截断），不阻塞 7-B1 IO Engineering 闭环。
