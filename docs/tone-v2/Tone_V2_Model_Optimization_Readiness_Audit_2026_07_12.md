# Tone V2 Model Optimization Readiness Audit

**日期：** 2026-07-12  
**类型：** Model Optimization Readiness Audit（只读）  
**审计范围：** `electron_node/services/faster_whisper_vad/tone_module`（Training / Dataset / Label / Model / Loss / Optimizer / Feature 训练侧 / Validation）  
**非范围：** Runtime · Node · FW · Recall · Lexicon · KenLM · Pipeline（均已冻结）

**Production Baseline 参照：**

```text
artifact: tone_cnn_p1_v1_production_20260712.npz
val_acc  = 0.7144  (acceptance: 0.71438, 147,312 val samples)
best_epoch = 19
```

---

## 1. Executive Summary

| 问题 | 结论 |
|------|------|
| 为何停在 71.4%？ | **三声（t3）与轻声（t5）识别最弱**；**t3↔t4 双向混淆**占主要误差；模型容量极小（~14.5K 参数）且 **Loss 无类权重**；train/val gap 仅 ~1.3pp → **非严重过拟合，更像容量 + 类混淆瓶颈** |
| 第一轮应优化什么？ | **仅增加 Inverse-Frequency Weighted CrossEntropy（class weight）** |
| 预计收益 | **+2 ~ +4 pp val_acc**（~73–75%），无法单靠一轮达到 90% |
| Runtime 可否 100% 冻结？ | **是** — 同架构 `conv1d_global_pool_v1` + 同 npz schema |
| 第一轮后是否直接 Production Training？ | **是** — 走 `run_phase1_baseline_recovery` 同等流程，新 `trainingVersion`，不覆写现有 baseline |

---

## 2. 当前模型结构（来自代码）

**实现文件：** `models/cnn_p1_torch.py` · `models/cnn_p1.py` · `contract.py`

**架构 ID：** `conv1d_global_pool_v1`（`P1_MODEL_ARCHITECTURE`）

```text
Input (N, 64, 83)  float32
    │  per-channel z-score: (x - feature_mean) / feature_std  [83-dim, 存于 artifact]
    ▼
Permute → (N, 83, 64)          # 83 channels × 64 time frames
    ▼
Conv1d(in=83, out=32, k=3, pad=1)
    ▼
ReLU
    ▼
Conv1d(in=32, out=64, k=3, pad=1)
    ▼
ReLU
    ▼
Global Average Pool (time dim) → (N, 64)
    ▼
Linear(64 → 5)  → logits
    ▼
Softmax（推理时 numpy_p1 / 训练时 CrossEntropyLoss on logits）
```

### 2.1 层级参数表

| 层 | 类型 | 配置 | 参数量 |
|----|------|------|--------|
| Input norm | z-score | `feature_mean` (83,) + `feature_std` (83,) | 166（统计量，非可训练） |
| Conv1 | Conv1d | in=**83**, out=**32**, kernel=**3**, pad=**1** | 32×83×3 + 32 = **8,000** |
| Act1 | ReLU | — | 0 |
| Conv2 | Conv1d | in=**32**, out=**64**, kernel=**3**, pad=**1** | 64×32×3 + 64 = **6,208** |
| Act2 | ReLU | — | 0 |
| Pool | Global mean over T=64 | — | 0 |
| FC | Linear | 64 → **5** | 64×5 + 5 = **325** |
| Output | 5-class softmax | t1–t5 | 0 |
| **可训练合计** | | | **≈ 14,533** |

- **Dropout：** 无  
- **BatchNorm：** 无  
- **初始化：** He-style `normal(0, sqrt(2/(C_in×K)))`（`init_cnn_p1_weights`）

---

## 3. Feature 输入（训练侧）

**SSOT：** `contract.py` · `feature_v2.py`

| 项 | 值 |
|----|-----|
| 张量形状 | **`(64, 83)`** — 64 固定帧 × 83 通道 |
| featureVersion | `p1-frame-mel-f0-v1` |

### 3.1 通道构成（实际代码，非历史文档）

| 通道索引 | 内容 | 说明 |
|----------|------|------|
| 0–79 | **log-mel** | 80 维，log10 功率 mel |
| 80 | **log F0** | 帧级 lag 自相关 F0 → log10(Hz) |
| 81 | **delta log F0** | 仅相邻**有声**帧差分；无声/边界 → 0 |
| 82 | **voiced mask** | 0/1 |

**明确不存在（当前实现）：**

- mel 的 **delta / delta2** — 未实现  
- 仅 F0 通道有 delta（`P1_CH_DELTA_LOG_F0`）

### 3.2 归一化

| 阶段 | 方式 |
|------|------|
| 特征提取 | 原始 log-mel / F0 / mask，**无**逐帧归一化 |
| 训练前 | `fit_feature_norm(x_train)` → 每通道 mean/std over (N×T) |
| 训练 / 推理 | `(x - mean) / std`，mean/std **写入 npz**（`feature_mean`, `feature_std`） |

**结论：** 归一化在 **模型输入前** 已完成（基于训练集统计），与 Runtime 使用同一组 mean/std。

---

## 4. Loss

**实现：** `training/gpu/trainer.py` L80

```python
criterion = nn.CrossEntropyLoss()
```

| 能力 | 状态 |
|------|------|
| CrossEntropy | ✅ |
| Label Smoothing | ❌ |
| Focal Loss | ❌ |
| Class Weight | ❌（`weight=` 未传） |
| Weighted Loss（样本级） | ❌ |

NumPy 训练路径（`models/cnn_p1.py` `train_sgd_step`）同样为 **无权重 CE**。

---

## 5. Optimizer & 训练策略

**实现：** `training/gpu/trainer.py`

| 项 | 状态 | 值 / 说明 |
|----|------|-----------|
| Optimizer | ✅ SGD | `torch.optim.SGD(lr=0.01)` |
| Learning Rate | ✅ 固定 | **0.01**，无 decay |
| Scheduler | ❌ | 无 Cosine / Step / Plateau |
| Warmup | ❌ | |
| Weight Decay | ❌ | |
| Gradient Clip | ❌ | |
| Early Stop | ❌ | 固定 **20 epochs**；仅 **best val_acc checkpoint** |
| Best Checkpoint | ✅ | `val_acc >= best` 时保存 state |
| Mixed Precision | ❌ | 无 autocast/AMP |
| Gradient Accumulation | ❌ | |
| Seed | ✅ | 42 |

**Production Baseline 训练配置（冻结 P9-C3）：** epochs=20, batch=128, lr=0.01, seed=42, backend=`torch_cuda_v1`。

---

## 6. Dataset

| 项 | 值 |
|----|-----|
| 数据源 | **AISHELL-3**（OpenSLR SLR93） |
| Adapter | `dataset/adapter_openslr_aishell3.py` |
| 对齐 | **lars76 MFA TextGrid** → `textgrid_pinyin_v1` |
| Holdout | **Speaker holdout** — `split_speaker_holdout_samples` |
| val_ratio | **0.15** |
| seed | **42** |
| Feature Cache | `_data_cache/.../training_features_v2` |
| cacheSampleCount | **997,992** |
| Train / Val | **850,680 / 147,312** |
| cacheSchemaVersion | `training_feature_shard_v2` |

**冻结状态：** Dataset · Alignment · Split · Feature Cache **均已冻结**（本轮 Phase 1.5 / Recovery 未改）；优化轮应 **复用同一 cache**，不重建。

---

## 7. Label

**来源：** `dataset/alignment_textgrid.py`

```text
TextGrid interval text → 拼音+tone 正则 ^([a-z]+)([1-5])$
tone digit 1–5 → label 0–4 (t1–t5)
```

| 类 | label int | 含义 |
|----|-----------|------|
| t1 | 0 | 一声 |
| t2 | 1 | 二声 |
| t3 | 2 | 三声 |
| t4 | 3 | 四声 |
| t5 | 4 | 轻声 |

- 标签挂在 **`SyllableSample.label`**，不进入 `WordInfo`  
- 过短 interval（&lt; `P0_MIN_SLICE_SEC`）与非拼音 token **跳过**

---

## 8. Validation 输出

### 8.1 训练循环内（`training/gpu/trainer.py` + `metrics.py`）

| 指标 | 实现 |
|------|------|
| overall accuracy (train/val) | ✅ |
| val_loss / train_loss | ✅ |
| per-epoch 历史 JSON | ✅ `epoch_history` |
| best_val_acc / best_epoch | ✅ |

### 8.2 离线 Acceptance（`artifact_governance.py`）

| 指标 | 实现 |
|------|------|
| val_acc（全量 147,312） | ✅ |
| per-class accuracy | ✅ |
| confusion matrix (5×5) | ✅ |
| precision | ❌ |
| recall | ❌ |
| F1 | ❌ |
| macro-F1 / weighted-F1 | ❌ |

**产物：** `models/production/acceptance_20260712.json`

---

## 9. 71.4% 主要误差来源（真实 metrics）

**数据源：** `acceptance_20260712.json` · `training_log_20260712.txt`

### 9.1 Per-class accuracy

| 类 | Val support | Accuracy | 与均值差距 |
|----|-------------|----------|------------|
| t1 | 32,240 | **75.0%** | +3.6 pp |
| t2 | 34,580 | **73.3%** | +1.9 pp |
| t3 | 23,102 | **63.2%** | **−8.2 pp** |
| t4 | 49,681 | **73.3%** | +1.9 pp |
| t5 | 7,709 | **60.7%** | **−10.7 pp** |

### 9.2 主要混淆对（off-diagonal，按计数）

| 真实 → 预测 | 错误数 | 占该类比例 |
|-------------|--------|------------|
| **t4 → t3** | 6,510 | 13.1% |
| **t3 → t4** | 4,452 | **19.3%** |
| t1 → t2 | 3,997 | 12.4% |
| t2 → t1 | 3,610 | 10.4% |
| t1 → t4 | 3,136 | 9.7% |

**合计误差：** 147,312 − 105,237 = **42,075** 错误；其中 **t3↔t4 相关错误 ≈ 10,962（~26% 的总错误）**。

### 9.3 训练曲线诊断

| 信号 | 值 | 解读 |
|------|-----|------|
| best epoch train_acc | 0.727 | |
| best epoch val_acc | 0.714 | |
| train−val gap | **~1.3 pp** | **非严重过拟合** |
| val_acc @ ep10→19 | 0.696 → 0.714 | 仍在缓慢上升 → **略欠拟合 / 容量受限** |

### 9.4 结论（有 metrics 支撑）

1. **类间声学混淆（尤其 t3↔t4）** 是第一大误差源  
2. **t5 样本最少（5.2%）且 acc 最低** — 类不平衡未在 Loss 中处理  
3. **t3 acc 最低** — 非单纯样本少，混淆更严重  
4. **小模型 + 无类权重 CE** — 在 71% 平台期合理

**不是主因：** 严重过拟合（gap 小）、Feature 未归一化（已实现）、Dataset 未冻结。

---

## 10. 已实现训练能力（避免重复开发）

| 能力 | 状态 | 位置 |
|------|------|------|
| Feature Cache v2 | ✅ | `build_feature_cache_v2_parallel.py` |
| memmap 大数组 | ✅ | `shard_reader_v2.py` |
| Speaker holdout split | ✅ | `speaker_holdout.py` |
| GPU CUDA 训练 | ✅ | `training/gpu/trainer.py` |
| Batch DataLoader | ✅ | `training/gpu/dataloader.py` |
| Torch→NumPy export parity | ✅ | `training/gpu/export.py` |
| Best checkpoint by val_acc | ✅ | `trainer.py` |
| Epoch metrics JSON | ✅ | `metrics.py` |
| validate_artifact_v1 | ✅ | schema/shape/loader/adapter |
| Full-val acceptance + CM | ✅ | `artifact_governance.py` |
| Probe inference | ✅ | `probe_v2_inference.py` |
| Phase1 recovery orchestrator | ✅ | `run_phase1_baseline_recovery.py` |
| Artifact governance 目录 | ✅ | `models/production|candidate|smoke` |
| 并行 cache build | ✅ | Phase 9c2 |
| NumPy 参考训练步 | ✅ | `cnn_p1.py`（非主路径） |

---

## 11. 缺失能力（按预期收益排序）

| 优先级 | 缺失能力 | 理由 | Runtime 冻结兼容 |
|--------|----------|------|------------------|
| **P0** | **Class-weighted CE** | t5 最少、t3/t5 acc 最低；实现成本极低 | ✅ |
| P1 | Class-balanced sampling | 与权重互补，但改变采样分布（第二轮） | ✅ |
| P2 | LR Scheduler（Cosine / Step） | 固定 lr=0.01，ep19 仍升 | ✅ |
| P3 | 更多 epoch + Early Stop | val 曲线未饱和 | ✅ |
| P4 | Label smoothing | 缓解 t3↔t4 硬边界 | ✅ |
| P5 | 训练侧 SpecAugment（cache 上） | 不改 Feature Contract | ✅（仅训练输入扰动） |
| P6 | 更深/wider CNN 或 CRNN | 需保持 export 布局或 **新 backend** | ⚠️ CRNN 需 Runtime 适配 |
| P7 | Focal Loss | 与 class weight 重叠 | ✅ |

**本轮不建议首轮同时做：** 架构升级（破坏 Runtime 100% 冻结）或多变量消融。

---

## 12. 第一轮实验计划（单变量）

```text
Production Baseline (val_acc 0.7144)
        │
        ▼
仅增加：Inverse-Frequency Weighted CrossEntropy
        │  weight[c] ∝ 1 / freq[c]  (train set, normalized)
        │  其余不变：cache · split · arch · epochs=20 · batch=128 · lr=0.01 · seed=42
        ▼
Candidate artifact → acceptance → 与 baseline 对比 CM / per-class
```

**不改：** Dataset · Feature · 网络结构 · Optimizer 类型 · LR 数值 · Epoch 数 · Runtime。

**成功判据：**

- overall val_acc **&gt; 0.7144**  
- **t3 或 t5 per-class acc 明确上升**  
- t3↔t4 混淆计数下降

---

## 13. 90% 目标可行性（Runtime 100% 冻结）

| 维度 | 评估 |
|------|------|
| 当前 | 71.4% |
| 目标 | 90% |
| 差距 | **~18.6 pp** |

在 **Runtime / Feature Contract / npz schema / conv1d_global_pool_v1 架构完全冻结** 前提下：

| 工作层 | 是否必要 | 说明 |
|--------|----------|------|
| Weighted Loss + 采样平衡 | 必要 | 先吃掉 t5/t3 尾部 |
| Scheduler + 更长训练 | 必要 | 当前略欠拟合 |
| Label smoothing / Focal | 有帮助 | 针对 t3↔t4 |
| 训练侧 augmentation | 有帮助 | 不改 DSP contract |
| **同架构加大宽度/深度** | 可能必要 | 仍可用同一 export 键名，但需验证 parity 工具 |
| CRNN / Attention | **与 Runtime 冻结冲突** | 需新 backend，超出「100% 冻结」 |

**判断：** 90% **不能**在 Runtime 绝对冻结 + 当前极小 CNN 下单轮达到；需 **多轮模型层迭代**（Loss → 训练策略 → 同 schema 扩容）。合理中期目标：**75–80%**（加权 Loss + scheduler + 更长训练）；**85%+** 可能需要同 schema 更宽网络或接受新 backend 版本。

---

## 14. Final Checklist

| 项目 | 已完成 | 缺失 | 是否建议第一轮优化 |
|------|--------|------|-------------------|
| Dataset (AISHELL-3 + cache) | ✅ | — | 否（冻结） |
| Label (TextGrid pinyin 1–5) | ✅ | — | 否 |
| Feature (64×83, mel+F0) | ✅ | mel delta/delta2 | 否（Contract 冻结） |
| CNN (conv1d_global_pool_v1) | ✅ | Dropout/BN/更深网络 | 否（首轮） |
| Loss (plain CE) | ✅ | class weight | **是** |
| Optimizer (SGD) | ✅ | AdamW, weight decay | 否（首轮） |
| Scheduler | ❌ | Cosine/Step | 否（第二轮） |
| Validation (acc + CM) | ✅ | P/R/F1 | 否（可加报告，非训练阻塞） |
| Confusion Matrix | ✅ | — | 否（用于验收） |
| Class Weight | ❌ | 实现 | **是** |
| Sampling (balanced) | ❌ | WeightedRandomSampler | 否（第二轮） |
| Data Augmentation | ❌ | SpecAugment on cache | 否（第三轮） |
| Mixed Precision | ❌ | AMP | 否 |
| Best Checkpoint | ✅ | — | 否 |
| Early Stop | ❌ | patience | 否（第二轮） |
| GPU Training + memmap | ✅ | — | 否 |
| Feature Cache | ✅ | — | 否（冻结） |

---

## 15. 最终结论（五问）

### 1. 当前 71.4% 的真正瓶颈是什么？

**声学类间混淆（t3↔t4，占 ~26% 总错误）+ 轻声/三声弱类（t5 60.7%、t3 63.2%）+ 小容量 CNN 在无类权重 CE 下的平台期。** 非严重过拟合（train−val ≈ 1.3pp）。

### 2. 下一轮第一项应优化什么？（只能一个）

**Inverse-Frequency Weighted CrossEntropy（class weight）。**

### 3. 预计收益多少？

**+2 ~ +4 pp overall val_acc**（约 **73.5%–75.5%**）；t5、t3 per-class 优先受益。**不能**一轮到 90%。

### 4. 是否可以保持 Runtime 100% 冻结？

**是。** 同架构、同 npz 键、同 `numpy_p1` 推理路径；仅权重与 `trainingVersion` 更新。

### 5. 第一轮优化后是否直接重新 Production Training？

**是。** 使用 `run_phase1_baseline_recovery` 同等流程：

- 复用冻结 Feature Cache  
- 新 `trainingVersion`（如 `weighted_ce_exp1_YYYYMMDD`）  
- 输出至 `models/candidate/` → acceptance 通过后晋升 `production/`  
- **不覆写** `tone_cnn_p1_v1_production_20260712.npz`（保留 Phase 2 对比基准）

---

## 16. 代码索引

| 主题 | 文件 |
|------|------|
| 模型结构 | `models/cnn_p1_torch.py`, `models/cnn_p1.py`, `contract.py` |
| Feature | `feature_v2.py`, `contract.py` (P1_*) |
| Loss / Train | `training/gpu/trainer.py` |
| DataLoader | `training/gpu/dataloader.py` |
| Label | `dataset/alignment_textgrid.py` |
| Split | `training_io/speaker_holdout.py` |
| Acceptance | `artifact_governance.py`, `models/production/acceptance_20260712.json` |
| Recovery 入口 | `run_phase1_baseline_recovery.py` |

---

*Audit scope: tone_module only · No code modified · Metrics from production acceptance 2026-07-12.*
