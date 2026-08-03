<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Tone_Model_V2_Production_CNN_Development_Report.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Tone Model V2 Production CNN Development Report

**日期：** 2026-07-12  
**类型：** Tone Model V2（Production Architecture）开发  
**依据：** [Tone Model V2 Production Architecture（冻结方案）](./Tone%20Model%20V2%20Production%20Architecture（冻结方案）.md)  
**训练入口：** `python -m tone_module.run_tone_model_v2_production`

---

## Executive Summary

| 维度 | 结果 |
|------|------|
| 新架构 | `conv1d_production_v2` |
| 可训练参数 | **301,061**（冻结方案建议 250K–500K 区间内） |
| 全量 GPU 训练 | ✅ 完成（57 epoch · early stop · AISHELL-3 997,992 cache） |
| Best Validation | **val_acc = 0.8248**（best epoch **47**） |
| 对照 Baseline | **+11.04 pp**（0.7144 → 0.8248） |
| 目标 val_acc ≥ 90% | ❌ **未达成** |
| Production Candidate Artifact | ✅ `tone_cnn_production_v2_candidate_20260712.npz` |
| Baseline 覆写 | ✅ **No** — `tone_cnn_p1_v1_production_20260712.npz` 未修改 |
| validate_artifact_v1 | ✅ PASS |
| Torch→NumPy 导出 Parity | ✅ PASS（maxAbsLogitsDiff ≈ 0.0032） |
| Runtime 代码修改 | **无**（仅扩展 loader / numpy_p1 架构分发，P1 向后兼容） |

### Final Verdict

**B — Production CNN 显著优于 P9-A Baseline，但未达 Phase D Promotion 标准（≈90%）。**

按冻结方案 **Phase E**，下一轮应进入 **CNN + BiGRU（CRNN）** 路线，而非继续扩大 Tiny CNN。

---

## 1. 新模型结构（conv1d_production_v2）

### 1.1 数据流

```text
Input (N, 64, 83)
  → per-channel z-score (feature_mean / feature_std)
  → transpose → (N, 83, 64)

Conv1d: 83 → 96, kernel=5, pad=2
  → BatchNorm1d(96) → ReLU

Conv1d: 96 → 192, kernel=5, pad=2
  → BatchNorm1d(192) → ReLU

Residual Block:
  Conv1d: 192 → 192, kernel=3, pad=1
  → BatchNorm1d(192) → ReLU
  → + skip (192 channels)

Global Average Pooling (time axis)
  → Dropout(0.2) [训练时]
  → FC: 192 → 192 → ReLU
  → FC: 192 → 96  → ReLU
  → FC: 96  → 5   (logits)
  → softmax → 5-class Tone Posterior
```

### 1.2 设计要点（对齐冻结方案 §6）

| 组件 | 实现 |
|------|------|
| 更深 Conv | 3 层 Conv1d（96 / 192 / 192） |
| 更宽 Channel | 96 → 192（旧模型 32 → 64） |
| BatchNorm | 每层 Conv 后 BN（推理用 running stats） |
| Residual | Conv3 + skip（同通道 192） |
| Dropout | p=0.2（仅训练；导出推理关闭） |
| 双层 FC | 192 → 96 → 5 |
| RNN | **未引入** |

### 1.3 代码位置

| 模块 | 路径 |
|------|------|
| NumPy 推理 | `tone_module/models/cnn_production_v2.py` |
| PyTorch 训练 | `tone_module/models/cnn_production_v2_torch.py` |
| 训练编排 | `tone_module/training/gpu/trainer_v2.py` |
| 导出 / Parity | `tone_module/training/gpu/export_v2.py` |
| 全量入口 | `tone_module/run_tone_model_v2_production.py` |
| Contract | `tone_module/contract.py`（`P2_*` 常量 + `ToneModelWeightsV2`） |

---

## 2. 参数数量

| 项 | 值 |
|----|-----|
| **可训练参数（V2）** | **301,061** |
| 冻结方案建议区间 | 250,000 – 500,000 |
| Artifact 文件大小 | ~1.27 MB（`tone_cnn_production_v2_candidate_20260712.npz`） |

参数统计函数：`tone_module.models.cnn_production_v2.count_trainable_params()`

---

## 3. 与旧模型（P9-A Baseline）对比

| 维度 | P9-A Baseline | Production CNN V2 | 变化 |
|------|---------------|-------------------|------|
| 架构 | `conv1d_global_pool_v1` | `conv1d_production_v2` | 新架构 |
| 参数量 | ~14,533 | **301,061** | **≈20.7×** |
| Conv 层 | 2（32→64） | 3（96→192→192）+ Residual | 更深更宽 |
| BatchNorm | 无 | 有（3 处） | 新增 |
| FC 层 | 1（64→5） | 2（192→96→5） | 双层 |
| 优化器 | SGD / 高 lr | **AdamW** + Cosine + WD | 升级 |
| AMP / Early Stop | 无 | **有** | 升级 |
| Best val_acc | **0.7144** | **0.8248** | **+11.04 pp** |
| Best epoch | 19 | 47 | — |
| train_acc @ best | 0.727 | 0.904 | 容量提升后 train 更高 |
| train–val gap @ best | ~1.3 pp | ~7.9 pp | 轻微过拟合迹象，但仍可接受 |

### 3.1 Per-class Accuracy 对比

| Class | Baseline (P9-A) | V2 Candidate | Δ |
|-------|-----------------|--------------|---|
| t1 | 0.750 | **0.852** | +10.2 pp |
| t2 | 0.733 | **0.836** | +10.3 pp |
| t3 | 0.632 | **0.738** | +10.6 pp |
| t4 | 0.733 | **0.851** | +11.8 pp |
| t5 | 0.607 | **0.751** | +14.4 pp |

**观察：** 五类均有显著提升；t3/t5 仍为最弱类（与 Baseline 一致），是后续 CRNN 的重点。

---

## 4. Runtime 兼容性确认

### 4.1 冻结 Contract（未修改）

| 项 | 值 | 状态 |
|----|-----|------|
| Feature Shape | `(64, 83)` | ✅ 不变 |
| Feature Version | `p1-frame-mel-f0-v1` | ✅ 不变 |
| Output | 5 logits → posterior | ✅ 不变 |
| Artifact Format | Production npz | ✅ 兼容 |
| Backend | `numpy_p1` | ✅ 不变 |
| WordInfo / processed_audio / Recall / KenLM / Node | — | ✅ 未触碰 |

### 4.2 加载与推理验证

```text
validate_artifact_v1: validation=PASS | schema=True | shape=True | loader=True | adapter=True
ToneModelLoaderV1.load(candidate): ready=True
infer_batch: logits shape (N, 5) ✅
```

### 4.3 实现说明（向后兼容扩展）

为支持 V2 权重键与 BN running stats，**扩展**（非破坏）：

- `tone_module/loader_v1.py` — `save_artifact_v2` / V1·V2 架构分发
- `tone_module/backends/numpy_p1.py` — 按 `modelArchitecture` 路由推理
- `tone_module/validate_artifact_v1.py` — V2 schema 校验

**P9-A Baseline artifact 仍可按原路径加载**；本轮未修改 Runtime 主链路代码。

### 4.4 导出 Parity

| 项 | 值 |
|----|-----|
| maxAbsLogitsDiff | 0.00315 |
| argmaxAgreement | 1.0 |
| parityPass | **true**（阈值 0.05） |

---

## 5. Validation 结果

### 5.1 数据集与 Cache

| 项 | 值 |
|----|-----|
| Dataset | AISHELL-3（`openslr_aishell3` / `v1`） |
| Feature Cache | `tone_module/_data_cache/.../training_features_v2` |
| cacheSampleCount | **997,992** |
| Train / Val | **850,680 / 147,312** |
| Holdout | speaker · val_ratio=0.15 · seed=42 |

### 5.2 训练配置

| 项 | 值 |
|----|-----|
| GPU | NVIDIA GeForce RTX 4060 Laptop GPU |
| Epochs（上限） | 60 |
| 实际训练 | **57**（early stop, patience=10） |
| Batch Size | 128 |
| Optimizer | AdamW（lr=3e-4, weight_decay=1e-2） |
| Scheduler | CosineAnnealingLR |
| AMP | ✅ |
| Training Wall Time | **~4,953 s（~82.5 min）** |
| Peak VRAM | ~53 MB |

### 5.3 核心指标

| 指标 | 值 |
|------|-----|
| **Validation Accuracy** | **0.8248** |
| Baseline（对照） | 0.7144 |
| **Δ vs Baseline** | **+0.1104（+11.04 pp）** |
| Target | 0.90 |
| **Target Met** | **false** |
| Macro F1 | 0.8097 |
| Weighted F1 | 0.8248 |

### 5.4 Per-class Metrics

| Class | Accuracy | Precision | Recall | F1 |
|-------|----------|-----------|--------|-----|
| t1 | 0.852 | 0.855 | 0.852 | 0.853 |
| t2 | 0.836 | 0.834 | 0.836 | 0.835 |
| t3 | 0.738 | 0.726 | 0.738 | 0.732 |
| t4 | 0.851 | 0.848 | 0.851 | 0.849 |
| t5 | 0.751 | 0.808 | 0.751 | 0.779 |

### 5.5 Confusion Matrix（行=真实，列=预测）

```text
           t1      t2      t3      t4     t5
t1      27467    2170     537    1930    136
t2       1818   28909    2132    1331    390
t3        368    1789   17048    3562    335
t4       2326    1330    3226   42286    513
t5        149     450     539     780   5791
```

**主要混淆：** t3↔t4（3562）、t2↔t3（2132）、t1↔t4（1930）— 与声调边界及上声变调相关，纯 CNN 容量可能不足。

### 5.6 Epoch 摘要

| Milestone | train_acc | val_acc |
|-----------|-----------|---------|
| Epoch 1 | 0.708 | 0.746 |
| Epoch 14 | 0.858 | 0.817 |
| Epoch 34 | 0.890 | 0.824 |
| **Epoch 47（best）** | **0.904** | **0.825** |
| Epoch 57（early stop） | 0.910 | 0.824 |

完整 epoch 历史：`tone_module/models/candidate/training_metrics_v2_20260712.json`  
训练日志：`tone_module/models/candidate/training_log_v2_20260712.txt`

---

## 6. 是否达到下一阶段 Production Candidate 标准

### 6.1 冻结方案 Phase 判定

| Phase | 条件 | 本轮结果 |
|-------|------|----------|
| Phase A — Production CNN 开发 | 250K–500K 参数 CNN | ✅ **达成** |
| Phase B — Production Training | 全量重训 + 完整 Metrics | ✅ **达成** |
| Phase C — Business Validation | 替换 TONE_MODEL_PATH 跑 Node 业务验证 | ⏳ **待执行**（本轮范围外） |
| Phase D — Promotion | val_acc **≈90%** | ❌ **未达成**（0.8248） |
| Phase E — CRNN 备用路线 | Production CNN 不足 90% | ✅ **触发** |

### 6.2 Production Candidate 裁决

| 标准 | 要求 | 结果 |
|------|------|------|
| 显著优于 Baseline | val_acc > 0.7144 | ✅ **+11.04 pp** |
| 达到 Promotion 门槛 | val_acc ≥ 0.90 | ❌ **差 7.52 pp** |
| Artifact 可加载 / 推理 | validate + loader + parity | ✅ |
| 不覆写 Production Baseline | 独立 candidate 路径 | ✅ |

**结论：** 本轮产物为 **有效的 Production Candidate（技术验收通过）**，但 **不具备直接 Promotion 为 Production 的条件**。按冻结方案应进入 **Phase E：CNN + BiGRU**，而非继续堆叠 Tiny CNN 或仅调 Loss。

---

## 7. 产出物清单

| 产出 | 路径 |
|------|------|
| Candidate Artifact | `tone_module/models/candidate/tone_cnn_production_v2_candidate_20260712.npz` |
| trainingVersion | `production_cnn_v2_candidate_20260712` |
| Metrics JSON | `tone_module/models/candidate/training_metrics_v2_20260712.json` |
| Training Log | `tone_module/models/candidate/training_log_v2_20260712.txt` |

**未修改：**

- `tone_module/models/production/tone_cnn_p1_v1_production_20260712.npz`（Baseline）
- Runtime / Node / FW / Recall / Feature Cache

---

## 8. 建议下一步

1. **Phase C — Business Validation：** 将 `TONE_MODEL_PATH` 指向 V2 candidate，重跑 Phase 1.5 同类业务验证（不改 Runtime 代码）。
2. **Phase E — CRNN：** 在保持 `(64,83)` I/O 与 npz 导出兼容前提下，开发 `conv1d_bigru_v1`（或冻结方案命名），目标弥补 t3/t4/t5 时序混淆。
3. **可选微调（非优先）：** Weighted CE / Label smoothing 可在 CRNN 路线并行试验；单独调 Loss 难以弥补 7.5 pp 缺口。

---

## 9. 复现命令

```powershell
cd D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad

python -m tone_module.run_tone_model_v2_production `
  --output tone_module/models/candidate/tone_cnn_production_v2_candidate_20260712.npz `
  --metrics-out tone_module/models/candidate/training_metrics_v2_20260712.json
```

验证加载：

```powershell
python -c "from tone_module.validate_artifact_v1 import validate_artifact_v1; print(validate_artifact_v1('tone_module/models/candidate/tone_cnn_production_v2_candidate_20260712.npz').to_notes())"
```

---

**报告生成：** 2026-07-12 · Tone Model V2 Production CNN Development Round
