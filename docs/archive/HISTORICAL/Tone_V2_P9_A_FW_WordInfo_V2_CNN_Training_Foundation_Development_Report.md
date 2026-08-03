<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Tone_V2_P9_A_FW_WordInfo_V2_CNN_Training_Foundation_Development_Report.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Tone V2 P9-A — FW-WordInfo V2 CNN Training Foundation Development Report

**Date:** 2026-07-04  
**Phase:** P9-A FW-WordInfo V2 Tone Model Training Foundation Development  
**Type:** Development（非 Runtime 接入 · 非 p0 修改）

**唯一训练主链：**

```text
TextGrid → SyllableSample → WordInfo Adapter → WordInfo
→ extract_feature(audio, sampleRate, wordInfo)
→ Feature Tensor (64, 83) → CNN → TonePosterior (5)
```

---

## Executive Summary

| 交付项 | 状态 |
|--------|------|
| 独立 V2 训练入口 `train_tone_v2_model` | ✅ 新增 |
| 轻量 1D CNN baseline | ✅ `models/cnn_p1.py` |
| V2 artifact schema `npz-p1-v1` | ✅ 与 p0 完全隔离 |
| `numpy_p1` backend + `ToneModelLoaderV1` | ✅ fail-closed |
| `validate_artifact_v1` | ✅ |
| Anti-fallback gate | ✅ `test_phase9a_v2_cnn_training.py` |
| Training Path gate | ✅ WordInfo → extract_feature → CNN |
| p0 Runtime / loader / mel / inference | ✅ 未修改 |
| Feature Shard V2 | ✅ 未进入 V2 训练主链 |

**测试：** P9-A 9/9 PASS · P8-D + Phase 2/3 回归 45/45 PASS  
**Pilot smoke：** 120 syllables · 2 epochs · artifact validation PASS

### Final Verdict: **PASS**

---

## Single Training Path Verification

V2 训练 **仅有一条主链**，由 `train_tone_v2_model.extract_v2_features_via_wordinfo()` → `build_v2_training_batch()` 实现：

```text
SyllableSample → syllable_sample_to_word_info → WordInfo
→ extract_feature(audio, sr, wordInfo) → (64, 83)
→ label sidecar → CNN batch → TonePosterior (5)
```

**禁止项静态扫描（`test_train_v2_source_has_no_p0_fallback`）：** 源码中不存在  
`extract_mel_features` · `_build_feature_matrix` · `ShardReader` · `ShardReaderV2` · `feature_shard_v2` · `build_feature_shards_v2` · `mel_mean_80_v1`

**不存在 online/cached 双主链：** V2 训练入口不读取 Feature Shard V2。

---

## FW WordInfo Contract Usage

| 检查项 | 结果 |
|--------|------|
| Adapter 输出 `shared_types.WordInfo` | ✅ |
| Extractor 仅接收 `WordInfo.start/end` | ✅ `feature_v2.extract_feature` |
| SyllableSample 不进入 Extractor | ✅ |
| label 保留为 sidecar | ✅ 不在 WordInfo 内 |
| 与 FW Runtime WordInfo 同构 | ✅ 同一 dataclass |

---

## V2 Training Entry

**模块：** `tone_module/train_tone_v2_model.py`

```bash
# Pilot（data_mini，120 syllables，3 epochs）
python -m tone_module.train_tone_v2_model train --dataset data_mini --pilot

# 正式 pilot 参数示例
python -m tone_module.train_tone_v2_model train \
  --dataset data_mini \
  --epochs 20 \
  --batch-size 64 \
  --output tone_module/models/tone_cnn_p1_v1.npz
```

| 属性 | 值 |
|------|-----|
| 默认输出 | `models/tone_cnn_p1_v1.npz` |
| 默认 modelVersion | `tone_cnn_p1_v1` |
| 与 p0 `train` 关系 | **完全隔离** — 不复用 `train_and_save` |

---

## CNN Model Architecture

**文件：** `tone_module/models/cnn_p1.py`

| 属性 | 值 |
|------|-----|
| 架构 ID | `conv1d_global_pool_v1` |
| 输入 | `(N, 64, 83)` → 内部 `(N, 83, 64)` |
| Conv1 | 83→32, kernel=3, ReLU |
| Conv2 | 32→64, kernel=3, ReLU |
| Pool | Global average over time |
| FC | 64→5 logits → softmax |
| 输出 | `(N, 5)` TonePosterior |
| 训练 | NumPy SGD（无 torch） |

**未实现（按 P9-A 范围）：** CRNN · GRU · LSTM · Conformer

---

## Artifact Schema

**formatVersion:** `npz-p1-v1`  
**隔离：** 无 `w1/b1/w2/b2/mel_mean/mel_std`

| 字段 | 值 / 形状 |
|------|-----------|
| `featureVersion` | `p1-frame-mel-f0-v1` |
| `inputShape` | `[64, 83]` |
| `outputShape` | `[5]` |
| `backend` | `numpy_p1` |
| `modelArchitecture` | `conv1d_global_pool_v1` |
| `conv1_w/b`, `conv2_w/b`, `fc_w/b` | CNN 权重 |
| `feature_mean`, `feature_std` | `(83,)` per-channel |
| `metrics` | train_acc, val_acc, epochs, … |

**写入：** `loader_v1.save_artifact_v1()`  
**验收：** `validate_artifact_v1()`

---

## Backend / Loader / Validator

| 组件 | 路径 | 职责 |
|------|------|------|
| `numpy_p1` | `backends/numpy_p1.py` | `(N,64,83)` → `(N,5)` posteriors |
| `ToneModelLoaderV1` | `loader_v1.py` | 加载 P1 artifact；拒绝 p0 keys |
| `validate_artifact_v1` | `validate_artifact_v1.py` | Schema → Shape → Loader → infer_batch |

**Fail-closed 验证：**

| 场景 | 结果 |
|------|------|
| p0 `ToneModelLoader` 加载 V1 artifact | ❌ 拒绝（缺 w1） |
| V1 loader 加载 p0 npz | ❌ 拒绝（p0 keys） |
| `numpy_p1` 接收 `(N,80)` | ❌ ValueError |

**未修改：** `numpy_p0` · p0 `ToneModelLoader` · `inference.py` · `mel.py`

---

## Anti-fallback Gate Result

| Gate | 结果 |
|------|------|
| 无 `extract_mel_features` | ✅ PASS |
| 无 `_build_feature_matrix` | ✅ PASS |
| 无 ShardReader v1/v2 | ✅ PASS |
| 无 p0 model keys | ✅ PASS |
| p0/V1 loader 互拒 | ✅ PASS |

---

## Training Path Gate Result

| Gate | 结果 |
|------|------|
| SyllableSample → WordInfo boundary 一致 | ✅ |
| WordInfo → extract_feature → `(64,83)` | ✅ |
| Tensor + label → CNN → `(N,5)` softmax | ✅ |
| 不依赖 Feature Shard V2 | ✅ |
| Pilot end-to-end train + validate | ✅ PASS |

---

## KEEP / MODIFY / RESTORE / DELETE / RECLASSIFY

| 动作 | 项 |
|------|-----|
| **KEEP** | p0 Runtime · p0 train · P8-D V2 path · Adapter · extract_feature · Feature Contract · Shard V2 as cache |
| **MODIFY** | `contract.py` — P1 artifact 常量 |
| **新增 KEEP** | `train_tone_v2_model.py` · `models/cnn_p1.py` · `numpy_p1` · `loader_v1` · `validate_artifact_v1` · `test_phase9a_*` |
| **RESTORE** | 训练目标 = CNN model training（非 Shard build） |
| **DELETE** | 无 |
| **RECLASSIFY** | Shard V2 仍为 optional cache only |

---

## Frozen Architecture Verification

| 检查项 | 结果 |
|--------|------|
| Runtime Mainline 未改 | ✅ |
| p0 training path 仍为 legacy | ✅ |
| 无双训练链路 | ✅ |
| 无 registry / switching / shadow | ✅ |
| 无 FeatureTimestampRecord 类 | ✅ |
| Dataset Foundation 未改 | ✅ |
| Recall / Ranking / KenLM / Lexicon 未改 | ✅ |

---

## 七问终答

| # | 问题 | 答案 |
|---|------|------|
| 1 | V2 Tone 训练是否真正使用 WordInfo 数据结构？ | **是** — 经 Adapter 进入 `extract_feature` |
| 2 | 是否仍存在双训练链路？ | **否** — 仅 WordInfo → extract_feature 单链 |
| 3 | 是否仍依赖 Feature Shard V2？ | **否** — 训练入口零 Shard 依赖 |
| 4 | 是否存在 p0 fallback？ | **否** — 静态 gate + loader 互拒 |
| 5 | V2 artifact 是否与 p0 完全隔离？ | **是** — 独立 schema / keys / loader |
| 6 | 是否可以开始 pilot training？ | **是** — `--pilot` smoke 已通过 |
| 7 | 是否可以开始 AISHELL-3 full training？ | **条件性可以** — 在线 WordInfo 路径支持 aishell3，但全量在线提取耗时长；Feature Shard V2 可作 **可选** 性能优化，**不得**替代主链；建议先 `--max-syllables` pilot 再扩全量 |

---

## Final Verdict

### **PASS**

P9-A 已打通 FW WordInfo → extract_feature → CNN → TonePosterior → V2 artifact 完整训练闭环；单训练主链成立；p0 完全隔离且未改动。

---

## 新增文件索引

| 文件 | 用途 |
|------|------|
| `tone_module/train_tone_v2_model.py` | V2 独立训练 CLI |
| `tone_module/models/cnn_p1.py` | 1D CNN + NumPy 训练 |
| `tone_module/backends/numpy_p1.py` | P1 推理 backend |
| `tone_module/loader_v1.py` | P1 artifact 加载/保存 |
| `tone_module/validate_artifact_v1.py` | P1 artifact 验收 |
| `tone_module/test_phase9a_v2_cnn_training.py` | P9-A gates |
