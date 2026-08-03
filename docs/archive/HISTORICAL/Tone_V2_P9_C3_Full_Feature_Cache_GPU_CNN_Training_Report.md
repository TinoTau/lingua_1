<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Tone_V2_P9_C3_Full_Feature_Cache_GPU_CNN_Training_Report.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Tone V2 P9-C3 — Full Feature Cache + GPU CNN Training Report

**Date:** 2026-07-10  
**Phase:** P9-C3 Full Feature Cache Build + GPU CNN Training  
**Type:** 开发 + 全量执行

**主链（不变）：**

```text
TextGrid → SyllableSample → WordInfo Adapter → WordInfo
→ feature_v2.extract_feature → Feature Tensor (64,83)
→ materialized training cache → Torch CUDA CNN Training
→ TonePosterior (5) → npz-p1-v1 → validate_artifact_v1 → numpy_p1 probe
```

---

## Executive Summary

| 维度 | 结果 |
|------|------|
| PyTorch CUDA | ✅ 2.6.0+cu124 · RTX 4060 Laptop |
| GPU Training 模块 | ✅ `tone_module/training/gpu/*` |
| AISHELL-3 全量 Cache | ✅ **997,992** samples · 20 shards · 0 failures |
| Cache Parity (256) | ✅ max_abs_diff=0.0 |
| GPU Smoke (1k) | ✅ validate_artifact_v1 PASS |
| 全量 GPU 训练 | ✅ 20 epochs · best val_acc **0.699** |
| Artifact | ✅ `tone_cnn_p1_v1_full.npz` |
| numpy_p1 Probe | ✅ posterior (N,5) · softmax 合法 |
| p0 fallback | ✅ 无 |
| Runtime 影响 | ✅ 无 |
| 回归测试 | ✅ 33/33 PASS |

### Final Verdict: **PASS**

---

## Environment Installation Result

在 `electron_node/services/faster_whisper_vad/.venv` 安装：

```bash
pip install torch --index-url https://download.pytorch.org/whl/cu124
```

`requirements.txt` 已记录 torch 可选依赖说明。

---

## GPU Environment Probe

输出：`tone_module/models/p9c3_gpu_env_probe.json`

```json
{
  "torchVersion": "2.6.0+cu124",
  "cudaAvailable": true,
  "cudaRuntimeVersion": "12.4",
  "deviceName": "NVIDIA GeForce RTX 4060 Laptop GPU",
  "deviceCount": 1,
  "vramBytes": 8585216000,
  "conv1dForwardBackward": true,
  "float32TensorOnCuda": true,
  "readyForTraining": true
}
```

---

## GPU Training Module Development

| 模块 | 路径 |
|------|------|
| env_probe | `tone_module/training/gpu/env_probe.py` |
| dataloader | `tone_module/training/gpu/dataloader.py` |
| trainer | `tone_module/training/gpu/trainer.py` |
| export | `tone_module/training/gpu/export.py` |
| metrics | `tone_module/training/gpu/metrics.py` |
| Torch CNN | `tone_module/models/cnn_p1_torch.py` |
| Windows-safe cache CLI | `tone_module/build_feature_cache_v2_parallel.py` |
| Cache parity CLI | `tone_module/verify_cache_parity_v2.py` |

`train_tone_v2_model.py` 新增 `--training-backend torch` 与 cache-only 全量训练路径。

---

## Frozen Training Path Verification

- ✅ 唯一 extractor：`feature_v2.extract_feature`
- ✅ featureVersion：`p1-frame-mel-f0-v1`
- ✅ shape：`(64,83)`
- ✅ Cache 仅训练输入优化
- ✅ Runtime 不 import `training/*`
- ✅ 无 p0 fallback / registry / 双主链

---

## Full AISHELL-3 Cache Build Result

**命令（Windows spawn-safe）：**

```bash
python -m tone_module.build_feature_cache_v2_parallel \
  --dataset aishell3 --num-workers 8 --skip-download --resume
```

**路径：** `tone_module/_data_cache/datasets/openslr_aishell3/v1/training_features_v2/`

| 字段 | 值 |
|------|-----|
| sampleCount | **997,992** |
| shardCount | 20 |
| featureVersion | `p1-frame-mel-f0-v1` |
| featureShape | `[64, 83]` |
| failureCount | **0** |
| buildBackend | `parallel_v2_cpu_extract` |
| numWorkers | 8 |

**Resume 段 buildStats：**

| 指标 | 值 |
|------|-----|
| elapsedSec | 721.2 |
| utteranceCount | 88,035 |
| avgMsPerSyllable | 0.723 |

> 注：首次构建因 Windows `train_tone_cnn` spawn 与超大 `build_state.json` 中断；已修复为轻量 state + memmap finalize + 独立 CLI。

---

## Cache Parity Result

`tone_module/models/p9c3_full_cache_parity.json`（256 随机样本）：

```json
{
  "sampleSize": 256,
  "maxAbsDiff": 0.0,
  "labelsMatch": true,
  "shapeOk": true,
  "timestampOk": true,
  "parityPass": true
}
```

---

## GPU Smoke Training Result

**1k cache + 1 epoch torch：**

| 指标 | 值 |
|------|-----|
| train / val | 966 / 34 |
| val_acc | 0.412 |
| validate_artifact_v1 | PASS |
| artifact | `tone_cnn_p1_v1_gpu_smoke.npz` |

---

## Full GPU Training Config

```bash
python -m tone_module.train_tone_v2_model train \
  --dataset aishell3 \
  --feature-cache-dir tone_module/_data_cache/datasets/openslr_aishell3/v1/training_features_v2 \
  --training-backend torch \
  --epochs 20 \
  --batch-size 128 \
  --lr 0.01 \
  --output tone_module/models/tone_cnn_p1_v1_full.npz \
  --skip-download
```

| 参数 | 值 |
|------|-----|
| trainingBackend | `torch_cuda_v1` |
| device | CUDA |
| train samples | 850,680 |
| val samples | 147,312 |
| holdout | speaker |

---

## Full Training Log Summary

| Epoch | train_loss | train_acc | val_loss | val_acc | dur(s) |
|-------|------------|-----------|----------|---------|--------|
| 1 | 1.312 | 0.429 | 1.243 | 0.460 | 196 |
| 5 | 0.945 | 0.639 | 0.917 | 0.648 | 44 |
| 10 | 0.846 | 0.681 | 0.849 | 0.685 | 44 |
| 14 | 0.812 | 0.695 | **0.815** | **0.699** | 45 |
| 20 | 0.777 | 0.709 | 0.811 | 0.699 | 44 |

| 指标 | 值 |
|------|-----|
| **Best epoch** | **14** |
| **Best val_acc** | **0.699** |
| Final train_acc | 0.709 |
| Total wall time | ~25 min（~1507 s） |
| Peak VRAM (reported) | ~31 MB |

---

## Torch→NumPy Export Parity

| 指标 | 值 |
|------|-----|
| maxAbsLogitsDiff | ~0.0038 |
| argmaxAgreement | **100%** |
| threshold | 1e-2 |
| parityPass | ✅ |

> CUDA 训练后权重与 NumPy forward 存在微小 float32 数值差，但 argmax 完全一致；artifact 由 `numpy_p1` 验收。

---

## Artifact Validation Result

`tone_module/models/tone_cnn_p1_v1_full_validate.json`：

```
validation=PASS | schema=True | shape=True | loader=True | adapter=True
```

| 字段 | 值 |
|------|-----|
| formatVersion | `npz-p1-v1` |
| featureVersion | `p1-frame-mel-f0-v1` |
| backend | `numpy_p1` |
| modelArchitecture | `conv1d_global_pool_v1` |

---

## V2 Inference Probe Result

`tone_module/models/tone_cnn_p1_v1_full_probe.json`：

```json
{
  "passed": true,
  "posterior_shape": [256, 5],
  "softmax_sum_min": 0.9999998,
  "softmax_sum_max": 1.0000002,
  "used_p0_loader": false
}
```

---

## Performance Summary

| 阶段 | 耗时 | 备注 |
|------|------|------|
| 1k cache build | 12.3 s | 4 workers |
| 全量 cache（resume 段） | 721 s | 8 workers · ~462k 新样本 |
| 全量 cache 总样本 | 997,992 | 含断点续建 |
| 全量 GPU 训练 20ep | ~25 min | batch=128 · RTX 4060 |

---

## Frozen Architecture Verification

- ✅ Feature Contract 未改
- ✅ WordInfo Contract 未改
- ✅ `inference.py` 未改
- ✅ Cache 非 Feature SSOT
- ✅ Torch 隔离在 Training Domain

---

## Regression Test Result

```
tone_module.test_phase9c3_*        10/10 PASS
tone_module.test_phase9a_*          9/9  PASS
tone_module.test_phase9c2_*        14/14 PASS
合计                               33/33 PASS
```

---

## KEEP / MODIFY / RESTORE / DELETE / RECLASSIFY

| 动作 | 项 |
|------|-----|
| **KEEP** | WordInfo · extract_feature · Feature Contract · p0 Runtime · numpy_p1 · P8-D path |
| **MODIFY** | 新增 GPU training 子模块 · torch trainer · cache finalize · train CLI |
| **RESTORE** | 目标 = 全量训练交付，不是训练平台 |
| **DELETE** | 无 p0 fallback |
| **RECLASSIFY** | GPU Training = lingua_1 内部训练域模块 |

---

## 十问终答

| # | 问题 | 答案 |
|---|------|------|
| 1 | PyTorch CUDA 是否安装成功？ | **是** |
| 2 | GPU 是否实际参与 CNN 训练？ | **是** |
| 3 | AISHELL-3 全量 Feature Cache 是否完成？ | **是** — 997,992 samples |
| 4 | 全量 Feature 生成实际耗时？ | Resume 段 **~12 min**；含断点续建总会话约 **~60–90 min** |
| 5 | Cache 与 online reference 是否一致？ | **是** — 256 样本 parity PASS |
| 6 | Torch→NumPy 导出是否一致？ | **是** — argmax 100%；logits diff < 1e-2 |
| 7 | 全量 GPU 训练是否完成？ | **是** |
| 8 | 全量训练实际耗时？ | **~25 min**（20 epochs） |
| 9 | 最佳 train/val accuracy？ | train **0.709** · val **0.699**（epoch 14） |
| 10 | artifact / numpy_p1 / Runtime？ | **PASS** · 无 p0 fallback · Runtime 未改 |

---

## Remaining Risks

1. **Windows multiprocessing：** 须使用 `python -m tone_module.build_feature_cache_v2_parallel`，勿用 `train_tone_cnn` 作为 pool 父进程。
2. **Export parity 阈值：** CUDA 训练后 logits 差约 3e-3；已用 1e-2 + argmax 100% gate。
3. **Runtime V2 接入：** 模型已具备进入 Runtime V2 接入审计条件，但本轮 **未修改 Runtime**。

---

## Final Verdict

### **PASS**

P9-C3 完成 AISHELL-3 全量 V2 Feature Cache 物化、PyTorch CUDA 全量 CNN 训练、numpy_p1 artifact 导出与验收；冻结主链与 Feature Contract 保持不变。
