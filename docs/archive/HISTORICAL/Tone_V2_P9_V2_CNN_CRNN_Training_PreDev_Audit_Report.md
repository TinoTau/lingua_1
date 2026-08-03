<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/Tone_V2_P9_V2_CNN_CRNN_Training_PreDev_Audit_Report.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# Tone V2 P9 — V2 CNN/CRNN Training PreDev Audit Report

**Date:** 2026-07-04  
**Phase:** P9 V2 CNN/CRNN Training PreDev Audit  
**Type:** 训练前审计（**只读** · **非开发** · **非训练** · **零代码修改**）

**冻结前提（P8-D 已 PASS）：**

```text
TextGrid → SyllableSample → WordInfo Adapter → WordInfo
→ extract_feature(audio, sampleRate, wordInfo)
→ Feature Tensor (N, 64, 83) + Label (N,)
```

**P9 主目标：**

```text
Feature Tensor (64, 83) → CNN/CRNN Model → TonePosterior (5,) → Artifact
```

**Feature Shard V2：** optional training cache — 非架构目标，非训练前唯一必需阶段。

**依据：**

- [Tone V2 P8-C Feature V2 Foundation Development Specification.md](./Tone%20V2%20P8-C%20Feature%20V2%20Foundation%20Development%20Specification.md)
- [Tone V2 P8-C — Feature V2 Foundation Implementation Addendum.md](./Tone%20V2%20P8-C%20%E2%80%94%20Feature%20V2%20Foundation%20Implementation%20Addendum.md)
- [Tone V2 P8-C — Feature Contract Specification.md](./Tone%20V2%20P8-C%20%E2%80%94%20Feature%20Contract%20Specification.md)
- [Tone_V2_P8_D_V2_Training_Path_Acceptance_Report.md](./Tone_V2_P8_D_V2_Training_Path_Acceptance_Report.md)
- [Tone_V2_P8_C_Scope_Drift_Audit_Report.md](./Tone_V2_P8_C_Scope_Drift_Audit_Report.md)
- [Tone_V2_P8_C_Feature_V2_Foundation_Freeze_Audit_Report.md](./Tone_V2_P8_C_Feature_V2_Foundation_Freeze_Audit_Report.md)
- 当前仓库实际代码（只读核对）

---

## Executive Summary

| 维度 | 结论 |
|------|------|
| V2 Training Path 前提 | **已具备** — P8-D PASS；在线 batch + 可选 Shard V2 cache |
| V2 模型训练能力 | **未实现** — 无 CNN/CRNN 定义、无 V2 训练循环、无 V2 artifact 契约 |
| p0 主链 / Runtime | **冻结完好** — `inference` / `loader` / `numpy_p0` 未改 |
| P9 开发准入 | **可进入** — 前提条件满足，需先补齐 P9 开发矩阵 |
| 正式开训 | **不可** — 缺模型代码 + 训练入口 + artifact 验收 gate |
| Scope Drift | **代码层已修正**；P9 须以 Model Training 为主叙事 |

### Final Verdict: **CONDITIONAL PASS**

**理由：** P8 Feature Foundation 与 V2 Training Input Path 已冻结并通过验收，**训练数据前提成立**；但 P9 所要求的 CNN/CRNN 模型、训练编排、V2 artifact schema、V2 offline eval 与 anti-fallback 门禁 **全部缺失**。可进入 P9 **开发**，不可直接进入 **正式训练**。

---

## Training Input Path Audit

### 1.1 当前已具备（KEEP）

| 能力 | 路径 | 输出 |
|------|------|------|
| 在线 V2 Training Path | `training_io/v2_training_path.py` | `(N, 64, 83)` + `(N,)` |
| CLI 验收入口 | `train_tone_cnn build-v2-training-batch` | 同上，无 Shard 依赖 |
| 可选缓存 | `feature_shard_v2.py` + `shard_reader_v2.py` | 同一 `extract_feature` 物化 |
| 在线 ≡ 缓存 | `test_phase8d` OnlineVsCacheEqualityTest | max abs diff ≤ `1e-5` |
| 共用 Extractor | `feature_v2.extract_feature` | 唯一 V2 Extractor |

**代码锚点：**

- `build_v2_training_batch()` — `v2_training_path.py` L97–128
- `build_v2_training_batch_for_dataset()` — `train_tone_cnn.py` L169–195
- `build_feature_shards_v2()` — `feature_shard_v2.py` L158–228（cache only）

### 1.2 P9 训练入口必须消费 vs 必须禁止

| 输入源 | P9 允许 | 当前状态 |
|--------|---------|----------|
| `V2TrainingInputBatch` / `(N,64,83)` + `(N,)` | **必须** | ✅ 可生成 |
| `ShardReaderV2` cached tensors | **可选** | ✅ 可读，无 norm/batch IO |
| p0 `(N,80)` mean-mel | **禁止** | ⚠️ `train` 子命令仍默认此路径 |
| `extract_mel_features` | **禁止** | ⚠️ `train_and_save` / `_build_feature_matrix` 仍用 |
| `_build_feature_matrix` | **禁止（V2 训练）** | ⚠️ 仍为 p0 主编排 |
| `training_feature_shard_v1` / `ShardReader` v1 | **禁止（V2 训练）** | ⚠️ aishell3 p0 训练仍用 |
| `mel_mean_80_v1` | **禁止（V2 训练）** | ⚠️ p0 artifact 仍用 |
| SyllableSample → Feature 直连 | **禁止** | ✅ 经 Adapter→WordInfo |

### 1.3 Online vs Cached 训练模式建议

| 模式 | 架构清洁度 | 性能 | Scope Drift 风险 | P9 建议 |
|------|-----------|------|------------------|---------|
| **Online** | 最高 — 主链即 SSOT | 低（重复 DSP） | 无 | **必须支持**（pilot / smoke / regression） |
| **Cached** | 高 — 同一 extract_feature | 高（大规模） | 中（若成为唯一入口则 drift） | **必须支持**（aishell3 全量） |
| **Cached-only** | — | — | **高** — 重现 P8-C Shard-centric drift | **禁止作为唯一模式** |

**审计结论：**

- P9 正式训练入口 **应同时支持 online / cached**，默认策略：
  - `data_mini` / smoke → online
  - `aishell3` 全量 → cached（`ShardReaderV2`），但 **不得** 跳过 online path 回归 gate
- 共用 `feature_v2.extract_feature` — **已满足**（shard builder 与 online path 均调用）
- 若只支持 cached → **会** 重新造成 Shard-centric scope drift — **须规避**

### 1.4 训练批 IO 缺口（P9 开发必需）

| 组件 | P0 现状 | V2 缺口 |
|------|---------|---------|
| `fit_norm_stats` | `shard_reader.py` L104–124，绑定 `nMels=80` | **缺 `fit_norm_stats_v2`** — 3D `(64,83)` 归一化 |
| `MiniBatchReader` | `shard_reader.py` L127–152，2D mel batch | **缺 `MiniBatchReaderV2`** |
| val holdout loader | `load_val_holdout_features` → v1 ShardReader / p0 mel | **缺 V2 holdout 加载** |

**分类：** V2 Training Path **KEEP**；P0 batch IO **KEEP（legacy）**；V2 batch IO **MODIFY（新增）**。

---

## Model Architecture PreDev Audit

### 2.1 Feature Tensor 结构（冻结 · 不可改）

| 属性 | 值 | 来源 |
|------|-----|------|
| Shape | `(64, 83)` | `contract.P1_FEATURE_SHAPE` |
| Time 维 | T = 64 fixed frames | `P1_FIXED_FRAMES` |
| Channel 维 | C = 83 | 80 log-mel + log_f0 + delta_log_f0 + voiced |
| featureVersion | `p1-frame-mel-f0-v1` | `P1_FEATURE_VERSION` |
| 类别数 | 5 | `P0_N_CLASSES`（Tone T1–T5） |

**P9 硬约束：** 不得修改 Feature Contract、Tensor Shape、Channel 布局。

### 2.2 架构适配性分析

Feature Tensor 语义：**短音节 clip 的帧级声学特征**，T=64 帧（≈640 ms @ 10 ms hop），C=83 多通道。

| 架构 | 适配性 | 说明 |
|------|--------|------|
| **1D CNN over time** | **高** | 输入 `(N, C, T) = (N, 83, 64)`；Conv1d kernel 3–7；GlobalAvgPool → FC → 5 |
| **CRNN (CNN + RNN)** | **高** | Conv1d 提取局部模式 → RNN 建模时序 → FC → 5；适合声调轮廓 |
| **CNN-GRU (BiGRU)** | **高** | 64 帧短序列；BiGRU 参数少于 BiLSTM；**P9 CRNN 首选 RNN 单元** |
| **CNN-LSTM (BiLSTM)** | **中** | 可行但参数量更大；作为 GRU 对照实验，非第一版默认 |
| **Conformer** | **低（P9）** | 64 帧过短、参数量过大；P8-C 列为未来选项，**P9 第一版应避免** |
| **纯 MLP（当前 p0）** | **不适用** | p0 为 `(80,)` mean-mel；**不得**作为 V2 基线 |

### 2.3 模型输入 / 输出定义（P9 应冻结）

```text
Input:  feature_batch float32 (N, 64, 83)  — 训练时可 reshape 为 (N, 83, 64) for Conv1d
Output: logits float32 (N, 5) → softmax → TonePosterior {t1..t5}
Loss:   cross_entropy(logits, labels)  — labels ∈ {0,1,2,3,4}
```

**Normalization（P9 须冻结，当前未定义）：**

- 推荐 **per-channel** mean/std，shape `(83,)` — 与 p0 per-mel-dim 策略类比，可覆盖 mel + F0 辅助通道
- 写入 artifact：`feature_mean` / `feature_std`（**非** `mel_mean` / `mel_std`）
- 不得在 P9 引入第二套 Feature 归一化契约于 Extractor 层

### 2.4 P9 第一版架构优先级建议

| 优先级 | 架构 | 理由 |
|--------|------|------|
| **P9-A（第一版默认）** | **轻量 1D CNN** | 最低复杂度；快速建立 V2 artifact + eval 闭环；便于 ablation |
| **P9-B（第二实验）** | **CNN + BiGRU** | 声调时序建模；参数量可控；优于 LSTM 作为首 CRNN |
| **P9-C（对照）** | **CNN + BiLSTM** | 仅作 GRU 对照，非默认 |
| **P9 排除** | Conformer / Transformer | 过度复杂；违背「第一版避免过度复杂」原则 |

**不得建议：** 修改 Feature Contract · 修改 `(64,83)` · 新增 Feature Channel。

---

## Artifact Contract Audit

### 3.1 P9 V2 Artifact 应如何定义

| 字段 | P9 要求值 | 当前 p0 现状 | 差距 |
|------|-----------|--------------|------|
| `featureVersion` | **`p1-frame-mel-f0-v1`** | `p0-v1` / `mel_mean_80_v1` | ❌ 无 P1 artifact |
| `inputShape` | **`[64, 83]`** | 隐含 `(80,)` | ❌ 无 shape 元数据 |
| `outputShape` | **`[5]`** | `(5,)` via MLP | ❌ 无显式字段 |
| `modelVersion` | e.g. **`tone_cnn_p1_v1`** / **`tone_crnn_p1_v1`** | `tone_cnn_p0` | ❌ 需新命名空间 |
| `backend` | e.g. **`numpy_p1`** 或 **`torch_p1`** | `numpy_p0` | ❌ 不存在 |
| `formatVersion` | 建议 **`npz-p1-v1`** | `npz-v1`（绑定 P0 MLP keys） | ❌ 需新 schema |
| 权重键 | CNN/CRNN 层权重（非 w1/b1/w2/b2） | `w1,b1,w2,b2` | ❌ 完全不同 |
| `feature_mean` / `feature_std` | shape `(83,)` | `mel_mean/mel_std` shape `(80,)` | ❌ 需新键名 |
| p0 兼容 | **必须隔离** | loader 仅接受 P0_COMPATIBLE | ✅ fail-closed 已有 |
| featureVersion mismatch | **fail-closed** | `loader.py` L178–182 拒绝非 P0 | ✅ 模式可复用 |

### 3.2 隔离要求

| 规则 | 状态 |
|------|------|
| p0 loader 不得接收 `(64,83)` | ✅ 当前 `_validate_shapes` 仅 `(80,×)` |
| V2 backend 不得接收 `(80,)` mean-mel | N/A — V2 backend 不存在 |
| V2 artifact 不得被 p0 `validate_artifact` 误 PASS | ✅ 当前必 FAIL（缺 w1/b1/w2/b2） |
| 两套 artifact 文件隔离 | ⚠️ 需命名约定（如 `tone_cnn_p1_v1.npz` vs `tone_cnn_p0.npz`） |

### 3.3 P9 应冻结的 Artifact Schema（PreDev 建议 · 待 P9 Spec 正式化）

```json
{
  "formatVersion": "npz-p1-v1",
  "featureVersion": "p1-frame-mel-f0-v1",
  "inputShape": [64, 83],
  "outputShape": [5],
  "modelVersion": "tone_cnn_p1_v1",
  "modelArchitecture": "conv1d_global_pool",
  "backend": "numpy_p1",
  "feature_mean": "(83,) float32",
  "feature_std": "(83,) float32",
  "weights": "<architecture-specific keys>",
  "metrics": { "val_acc": 0.0, "train_acc": 0.0, "epochs": 0 }
}
```

**分类：** p0 artifact schema **KEEP**；V2 artifact schema **MODIFY（新增，不修改 p0）**。

---

## Backend / Loader Audit

### 4.1 当前 Backend 事实

| 组件 | 路径 | 输入 | 状态 |
|------|------|------|------|
| `numpy_p0` | `backends/numpy_p0.py` | `(N, 80)` mel | **冻结 · KEEP** |
| `ToneModelLoader` | `loader.py` | P0 npz keys + P0 shapes | **冻结 · KEEP** |
| `validate_artifact` | `validate_artifact.py` | P0 schema → `numpy_p0.infer_batch` | **冻结 · KEEP** |
| V2 backend | — | `(N, 64, 83)` or `(N, 83, 64)` | **不存在** |
| torch | `_audit_env_probe.py` 探测 only | — | **未用于训练/推理** |

### 4.2 P9 Backend / Loader 需求

| 候选 | 用途 | P9 是否必需 | 约束 |
|------|------|-------------|------|
| **`numpy_p1`** | 训练 + offline eval（无 torch 依赖） | **推荐第一版** | 新文件；**不得改** `numpy_p0` |
| **`torch_p1`** | 训练（GPU）+ export | **可选** | 若引入 torch，须隔离于 Runtime |
| **`ToneModelLoaderV1`** 或 loader 内 `featureVersion` 分流 | 加载 P1 artifact | **必需（训练验收）** | fail-closed；**不得** registry/switching |
| Runtime 接入 | inference 使用 V2 | **P9 不需要** | 后续独立阶段 |

### 4.3 分流原则（P9 应实现）

```text
featureVersion == p0-v1 | mel_mean_80_v1  → numpy_p0 + ToneModelLoader (existing)
featureVersion == p1-frame-mel-f0-v1      → numpy_p1 + ToneModelLoaderV1 (new)
mismatch                                   → fail-closed (reject load)
```

**禁止：**

- 修改 `numpy_p0`
- Runtime hot-switch / model_registry / backend_registry
- 单一 loader 静默降级到 p0

**分类：** `numpy_p0` / p0 loader **KEEP**；`numpy_p1` + V1 loader **MODIFY（新增）**。

---

## Training Loop Audit

### 5.1 `train_tone_cnn.py` 现状

| 检查项 | 事实 | 文件位置 |
|--------|------|----------|
| 默认训练路径 | **p0** | `train_and_save` L591–763 |
| `_build_feature_matrix` | **存在** — p0 mel | L338–354 |
| `extract_mel_features` | **存在** — p0 | L28, L351 |
| p0 `ShardReader` | **存在** — aishell3 | L714–725 |
| V2 batch 构建 | **存在** — 仅数据，不训练 | `build-v2-training-batch` |
| V2 训练循环 | **不存在** | — |
| 实际 CNN/CRNN | **不存在** — 名为 CNN 实为 NumPy MLP | `_train_mlp` |
| torch 训练 | **不存在** | 全目录无训练路径 `import torch` |

### 5.2 CLI 子命令矩阵

| 子命令 | 功能 | P9 关系 |
|--------|------|---------|
| `train` | p0 MLP 训练 | **legacy KEEP** — V2 不得复用 |
| `build-feature-shards` | p0 v1 cache | **legacy KEEP** |
| `build-feature-shards-v2` | V2 cache | **optional KEEP** |
| `build-v2-training-batch` | V2 在线 batch | **KEEP** — smoke gate |
| **`train-v2`**（建议） | V2 CNN/CRNN 训练 | **P9 必需新增** |

### 5.3 训练入口隔离建议

| 方案 | 优点 | 缺点 | 建议 |
|------|------|------|------|
| A: `train_tone_cnn train-v2` 子命令 | 复用 dataset/holdout 工具 | 文件名 `train_tone_cnn` 易误导 | **可行 · 须 `--feature-version` 强制** |
| B: 新文件 `train_tone_v2_model.py` | 命名清晰 · p0 完全隔离 | 部分代码重复 | **推荐** |
| C: `train --feature-version p1` 共用 | 单入口 | **p0 fallback 风险高** | **不推荐** |

**P9 必需 guard：**

- V2 训练入口 **不得** 调用 `_build_feature_matrix` / `extract_mel_features` / `ShardReader` v1
- 缺 `--feature-version p1-frame-mel-f0-v1` 或等价常量 → **fail-closed**
- 默认 `train` 子命令行为 **不变**（p0 legacy）

### 5.4 训练特性：P9 必需 vs 后续实验

| 特性 | P9 必需 | 说明 |
|------|---------|------|
| V2 训练循环（epoch / batch / loss） | **是** | 核心交付 |
| train/val holdout（复用现有 split） | **是** | 已有 speaker/utterance holdout |
| per-epoch metrics 打印 | **是** | 最低可观测性 |
| checkpoint / best-val 保存 | **是** | 产出 artifact |
| V2 artifact save + validate | **是** | 训练验收 gate |
| V2 offline eval | **是** | holdout accuracy |
| early stopping | 否（P9+） | 可先固定 epoch |
| class weight | 否（P9+） | 视 label 分布再定 |
| confusion matrix | 否（P9+） | offline eval 扩展 |
| F0/channel ablation | 否（实验） | 非 P9 blocker |
| LR scheduler / hyperparam search | 否（实验） | P8-C 明确属后续 |

**分类：** p0 `train_and_save` **KEEP**；V2 training entry **MODIFY（新增）**。

---

## Scope Drift Audit

### 6.1 P9 主目标 vs 非目标

| 层级 | P9 主目标 | 非目标（不得再次主导） |
|------|-----------|------------------------|
| **Model Training** | CNN/CRNN → TonePosterior → Artifact | — |
| Feature Tensor | 消费 `(64,83)` | 重新定义 Contract |
| Training IO | transport（batch / cache read） | 架构 SSOT |
| Feature Shard V2 | optional cache | Feature Foundation / 架构目标 |
| Manifest / Digest / Reader | 工程辅助 | 训练验收对象 |
| Runtime / Recall / Ranking | **后置** | P9 不得混入 |

### 6.2 当前 Scope 状态（P8-D 修正后）

| 断言 | 状态 |
|------|------|
| Feature Shard 只是 cache | ✅ 代码 docstring/CLI 已 RECLASSIFY |
| Training IO 只是 transport | ✅ `v2_training_path` 不定义 Contract |
| Model Training 才是 P9 主目标 | ⚠️ **代码尚未开始** — P9 开发须以此为中心 |
| 无 Shard-centric 新 drift | ✅ P8-D 测试 gate 存在 |

### 6.3 RESTORE 叙事

```text
Training objective = Feature Tensor → CNN/CRNN Model → TonePosterior → Artifact
                  ≠ Canonical Shard Build
                  ≠ Feature Shard V2 全量验收
```

---

## Semantic Acceptance Planning

### 7.1 验收链路分层

```text
[L1 训练验收 — P9 范围]
Feature Tensor → V2 Model → TonePosterior → offline accuracy / confusion matrix

[L2 Artifact 验收 — P9 范围]
npz schema → loader V1 → numpy_p1.infer_batch → validate_artifact_v1

[L3 语义验收 — P9 后置]
TonePosterior → Recall → Candidate Ranking → Final Candidate

[L4 Runtime 验收 — 更后置]
inference.py 接入 extract_feature + V2 backend → Node E2E
```

### 7.2 关键原则

| 原则 | 说明 |
|------|------|
| Offline accuracy ≠ Runtime semantic acceptance | val_acc 仅 L1；Recall 排名变化需 L3 |
| V2 posterior 必须能进入 Recall | **后续阶段** — P9 不实现 |
| Tensor counterfactual → posterior 变化 | P9 offline 可测（同 WordInfo 不同 audio） |
| Posterior counterfactual → Recall ranking 变化 | L3 · FW 集成后 |
| Runtime 接入不得混入 P9 训练 | P8-C / 冻结架构明确要求 |

### 7.3 P9 完成后 → 下一步验收（P10 建议）

1. **Counterfactual posterior test** — 固定 boundary，变换 F0/mel → posterior 必变
2. **Recall injection dry-run** — offline 注入 `TonePosterior` 到 Recall mock
3. **Runtime predev audit** — `inference.py` 切换 `extract_feature` 的可行性与影响面
4. **Node E2E semantic gate** — 全链路排名变化验收

---

## Regression / Gate Audit

### 8.1 训练前 Gate 矩阵

| Gate | 状态 | P9 开训前 |
|------|------|-----------|
| V2 Training Path PASS | ✅ P8-D | **必须** — 已满足 |
| Feature Contract PASS | ✅ Phase 8 tests | **必须** — 已满足 |
| Shape `(64,83)` PASS | ✅ | **必须** — 已满足 |
| No p0 fallback（V2 train entry） | ❌ 未实现 | **必须** — P9 开发 deliverable |
| F0 Contract Regression | ✅ Phase 8 | **建议保留** |
| Online vs cache equality | ✅ P8-D | **必须** — 已满足 |
| Boundary consistency | ✅ Phase 8 | **必须** — 已满足 |
| V2 artifact validation | ❌ 未实现 | **必须** — P9 开发 deliverable |
| V2 offline evaluation | ❌ 未实现 | **必须** — P9 开发 deliverable |
| Runtime semantic acceptance | N/A | **后置** — 非 P9 blocker |
| p0 Phase 2/3 regression | ✅ 23 tests | **必须** — 开发后仍跑 |

### 8.2 P9 建议新增测试（`test_phase9_*`）

| 测试 | 断言 |
|------|------|
| `test_phase9_no_p0_fallback` | V2 train 源码无 `extract_mel_features` / `_build_feature_matrix` |
| `test_phase9_artifact_schema` | P1 npz keys + shape + featureVersion |
| `test_phase9_loader_fail_closed` | p0 loader 拒绝 P1 artifact；P1 loader 拒绝 p0 |
| `test_phase9_infer_batch_shape` | `(N,64,83)` → `(N,5)` posteriors |
| `test_phase9_train_smoke` | 小 batch 1-epoch smoke 产出合法 artifact |

---

## KEEP / MODIFY / RESTORE / DELETE / RECLASSIFY

### KEEP

| 组件 | 理由 |
|------|------|
| p0 Runtime（`inference.py` / `mel.py` / `numpy_p0` / p0 loader） | 生产冻结 |
| p0 training path（`train` / `_build_feature_matrix` / v1 shard） | legacy |
| P8-D V2 Training Path（`v2_training_path` / `build-v2-training-batch`） | P9 输入 SSOT |
| Feature Shard V2 | optional cache |
| Feature Contract（`P1_*` / `extract_feature`） | 冻结 |
| Dataset Foundation | 未改 |
| Phase 8 回归测试 | gate |

### MODIFY（P9 开发范围）

| 组件 | 动作 |
|------|------|
| V2 model definition（CNN / CRNN） | **新增** |
| V2 training entry（`train-v2` 或 `train_tone_v2_model.py`） | **新增** |
| `fit_norm_stats_v2` + `MiniBatchReaderV2` | **新增** |
| V2 artifact schema + save | **新增** |
| `numpy_p1` + `ToneModelLoaderV1`（或分流） | **新增** |
| `validate_artifact_v1` + `offline_tone_eval_v2` | **新增** |
| `test_phase9_*` | **新增** |

### RESTORE

| 叙事 | 动作 |
|------|------|
| Training objective | **恢复为 Model Training**，非 Shard build |
| P9 文档/PR 描述 | 以 CNN/CRNN + Artifact 为中心 |

### DELETE

| 目标 | 说明 |
|------|------|
| V2 path 静默回落 p0 | **禁止** — 若存在须删除（当前无 V2 train path，无此代码） |
| Feature Shard 作为架构目标 | **禁止叙事** — 非删代码 |

### RECLASSIFY

| 组件 | 定位 |
|------|------|
| Feature Shard V2 | training cache only |
| `build-feature-shards-v2` | optional materialization |
| `train_tone_cnn train` | p0 legacy trainer（非 V2） |

---

## Required Development Matrix

| # | Deliverable | Priority | Blocker for 正式训练 |
|---|-------------|----------|---------------------|
| 1 | P9 Spec 冻结：modelArchitecture + artifact schema + norm policy | P0 | **是** |
| 2 | `models/cnn_p1.py` 或等价 — Conv1d baseline | P0 | **是** |
| 3 | `fit_norm_stats_v2` + `MiniBatchReaderV2` | P0 | **是（cached 模式）** |
| 4 | `train_tone_v2_model.py` 或 `train-v2` CLI | P0 | **是** |
| 5 | `numpy_p1.infer_batch(feature_batch, weights)` | P0 | **是** |
| 6 | `ToneModelLoaderV1` + fail-closed featureVersion | P0 | **是** |
| 7 | `validate_artifact_v1` | P0 | **是** |
| 8 | `offline_tone_eval_v2`（V2 holdout 数据源） | P0 | **是** |
| 9 | `test_phase9_*` regression | P0 | **是** |
| 10 | CNN+BiGRU 变体 | P1 | 否（第二实验） |
| 11 | torch 训练路径 | P2 | 否（性能优化） |
| 12 | Runtime / Recall 接入 | P3+ | 否（后续阶段） |

**预估：** Deliverable 1–9 完成后方可 **正式开训**；1–4 + online-only smoke 可支持 **pilot 开训**。

---

## Final Verdict

### **CONDITIONAL PASS**

---

## 十问终答

| # | 问题 | 答案 |
|---|------|------|
| 1 | 当前是否已经具备 V2 CNN/CRNN 训练前提？ | **数据前提：是**（P8-D PASS）；**模型/训练/artifact 前提：否** |
| 2 | P9 第一版应优先 CNN、CRNN、CNN-GRU 还是 CNN-LSTM？ | **优先轻量 1D CNN**；第二实验 **CNN+BiGRU**；LSTM 为对照；Conformer 排除 |
| 3 | 是否必须先实现 V2 backend / loader？ | **是** — 至少 `numpy_p1` + `ToneModelLoaderV1` + `validate_artifact_v1`（训练验收闭环） |
| 4 | 是否可以不经 Feature Shard V2 直接训练？ | **是** — online path 已成立；pilot/smoke 应走 online |
| 5 | 是否应支持 online 与 cached 两种训练输入？ | **是** — 双模式；online 为架构 gate，cached 为规模优化 |
| 6 | 训练入口是否必须与 p0 完全隔离？ | **是** — 新入口 + featureVersion guard；**不得**共用 `train` 默认路径 |
| 7 | 是否存在 p0 fallback 风险？ | **是（高）** — 当前 `train` 默认 p0；V2 开发须显式 anti-fallback gate |
| 8 | 是否可以进入 P9 开发？ | **是** — Feature Foundation + Training Path 已冻结 |
| 9 | 是否可以开始正式训练？ | **否** — 缺 Deliverable 1–9 |
| 10 | 训练完成后下一步验收是什么？ | **L2 artifact validation → L1 offline eval → L3 Recall counterfactual → L4 Runtime predev** |

---

## 附录：关键代码事实索引

| 事实 | 路径 |
|------|------|
| P1 Feature Contract | `tone_module/contract.py` L102–161 |
| 唯一 V2 Extractor | `tone_module/feature_v2.py` `extract_feature` L200–224 |
| V2 online batch | `tone_module/training_io/v2_training_path.py` |
| V2 cache builder | `tone_module/training_io/feature_shard_v2.py` |
| p0 训练主编排 | `tone_module/train_tone_cnn.py` `train_and_save` |
| p0 artifact 验收 | `tone_module/validate_artifact.py` |
| p0 loader fail-closed | `tone_module/loader.py` L178–182 |
| p0 runtime | `tone_module/inference.py` `extract_mel_features` |
| TonePosterior 5-class | `tone_module/tone_types.py` |
| P8-D 验收报告 | [Tone_V2_P8_D_V2_Training_Path_Acceptance_Report.md](./Tone_V2_P8_D_V2_Training_Path_Acceptance_Report.md) |
