<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Tone_Model_V2_CNN_Freeze.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Tone Project Master Freeze（Architecture & Development Policy）

**文档角色：** **Tone Project 唯一冻结文档**（含 P9-B Development Baseline 全量冻结记录）  
**日期：** 2026-07-13（P9-B Freeze）· 2026-07-13（Master Policy 增补）  
**状态：** **FROZEN**  
**类型：** Tone Project Master Freeze + Production CNN V2 Development Baseline Freeze

> 本文档是 Tone 项目后续开发的**唯一准据**。任何 Tone 相关工作必须先对照本文档；不得在未提出 **Architecture Unfreeze** 的前提下修改 Runtime / Feature / Node / FW 等冻结边界。  
> **Part I** 为项目级长期约束；**Part II** 为 P9-B（`tone_cnn_production_v2_candidate_20260712`）模型与指标冻结记录（保留原 `Tone_Model_V2_CNN_Freeze.md` 全部内容）。

---

# Part I — Tone Project Master Policy

## A. Model Contract Freeze（永久冻结）

以下契约属于 **永久冻结**，除非正式 **Architecture Unfreeze**，不得修改。

### A.1 Input

```text
Feature Tensor Shape: (64, 83)
  — 64 frames × 83 channels (mel + f0 + … per p1-frame-mel-f0-v1)
```

### A.2 Output

```text
5 Tone Posterior (t1–t5)
  — logits → softmax → AcousticToneSlice posterior
```

### A.3 Feature Version

```text
p1-frame-mel-f0-v1
```

### A.4 Artifact

```text
Production npz
  — formatVersion: npz-p1-v1
  — backend: numpy_p1
  — 权重 + feature_mean / feature_std + metadata
```

### A.5 Runtime API

```text
AcousticToneSlice
```

- 字段语义、注入点、`toneEnabled` / `skippedReason` 契约 **不得修改**
- Tone 推理入口、`numpy_p1` batch infer 输出 shape `(N, 5)` **不得修改**

### A.6 Node Interface

```text
Tone → Recall → KenLM → Final
```

- 链路拓扑与职责边界 **不得修改**
- 不得在本冻结期内改动 Node 侧 Tone 消费协议、Recall 注入方式、KenLM 排序接口

**Contract SSOT：** `tone_module/contract.py` · `validate_artifact_v1` · Phase 1/1.5 验收报告

---

## B. Performance Budget（性能预算）

**正式结论：暂无正式 Performance Budget（无文档化门禁阈值）。**

当前项目 **未冻结** 以下数值为硬性 SLA；不得将下表当作 Promotion 阻塞条件，亦不得凭空编造 Budget：

| 维度 | 状态 |
|------|------|
| Tone inference latency（单 slice / batch） | **暂无正式 Budget** |
| CPU 推理预算 | **暂无正式 Budget** |
| GPU 推理预算 | **暂无正式 Budget** |
| Memory Budget（Runtime 加载 + 推理） | **暂无正式 Budget** |

**仅作观测参考（非门禁）：**

| 观测来源 | 记录 |
|----------|------|
| Phase 1 Runtime 探针 | `tone_inference_ms` 约 9–15 ms / case（历史批测） |
| Phase 1.5 smoke | batchInference ≈ 23 ms / 6 slices（P9-A） |
| P9-B Business（整链） | mean pipeline ≈ 4739 ms；mean FW detector ≈ 1310 ms |
| P9-B 训练 Peak VRAM | ≈ 53 MB（训练侧，非 Runtime 部署预算） |

后续若需正式 Budget，须单独 **Architecture Unfreeze** 议题立项，不得隐式写入模型实验。

---

## C. Development Boundary（开发边界）

### C.1 唯一允许开发的内容

| 允许 | 说明 |
|------|------|
| **Model Architecture** | 网络内部结构（CNN / CRNN / Transformer / Conformer / TCN 等） |
| **Training** | 训练流程、epoch、early stop、AMP 等 |
| **Dataset** | 仅 **新增数据** 或 **新增 cache 版本** 时；不得改动 Runtime Feature 定义 |
| **Label** | 5-tone 分类标签策略（在不动 Runtime Label 契约前提下） |
| **Loss** | CE / weighted CE / label smoothing 等 |
| **Optimizer** | AdamW / scheduler / weight decay 等 |
| **Export** | Torch → NumPy npz；须保持 Artifact Contract 兼容 |

### C.2 禁止开发的内容（除非 Architecture Unfreeze）

| 禁止 | 说明 |
|------|------|
| **Runtime** | `tone_module` 推理主链路、loader 契约破坏式修改 |
| **Feature** | `(64,83)`、`p1-frame-mel-f0-v1`、processed_audio 特征提取 |
| **WordInfo** | FW WordInfo V2 契约 |
| **FW** | faster-whisper-vad 检测与组装主链 |
| **Recall** | Tone Recall / pattern / penalty 逻辑 |
| **Lexicon** | 词库与 Intent |
| **Domain Vote** | Domain 投票与组装 |
| **KenLM** | 句子级 rerank |
| **Node** | 聚合、分割、pipeline 编排 |

**活跃开发对象：** 仅 **Tone Model**（权重 + 训练 + 离线/业务验收）。

---

## D. Tone Project Goal（项目最高目标）

```text
1. Offline Accuracy ≈ 90%
2. Business：能够稳定命中细分 Domain、专业词（在冻结链路上观测提升）
3. Runtime：零修改（I/O 与 API 100% 兼容）
4. Feature Contract：永久冻结
```

| 目标 | 当前状态（P9-B） | 下一阶段 |
|------|------------------|----------|
| Offline val_acc | **0.8248** | → **≈0.90** |
| Business 端到端 | exact 14% / CER 0.220（无净改善） | Tone Model V3 继续观测 |
| Runtime 零修改 | ✅ 已验证 | 保持 |
| Feature 永久冻结 | ✅ | 保持 |

---

## E. Baseline Policy（双 Baseline 政策）

目前存在 **两个 Baseline**，职责不可混淆：

### E.1 Business Baseline — P9-A

```text
conv1d_global_pool_v1
tone_cnn_p1_v1_production_20260712.npz
trainingVersion: production_baseline_20260712
Phase 1.5 run_20260712_rerun
```

| 属性 | 政策 |
|------|------|
| 角色 | **历史业务基线** |
| 用途 | Phase 1.5 文档对照、Node E2E 历史复现 |
| 状态 | **永久保留**；不得删除 |
| 新模型主对照 | ❌ **禁止** |

### E.2 Development Baseline — P9-B

```text
conv1d_production_v2
tone_cnn_production_v2_candidate_20260712.npz
trainingVersion: production_cnn_v2_candidate_20260712
offline val_acc: 0.8248
```

| 属性 | 政策 |
|------|------|
| 角色 | **Tone Model Development Baseline** |
| 用途 | 所有新模型（V3 及以后）的 **首要** 离线 + 业务对照 |
| 状态 | **FROZEN**（Part II 全量记录） |
| vs Tiny CNN | ❌ 不得再作为主要比较对象 |

---

## F. Promotion Policy（升级流程）

任何模型进入 Production，**统一** 采用以下流水线；**任一阶段失败不得 Promotion**：

```text
Development
    ↓
Offline Validation（vs P9-B：acc / per-class / CM / P/R/F1）
    ↓
Business Validation（dialog_200 + tone-sensitive A/B；仅 TONE_MODEL_PATH）
    ↓
Promotion Decision（文档化 Verdict）
    ↓
Production Deployment（TONE_MODEL_PATH / 部署路径变更须单独批准）
```

| 阶段 | 最低要求 |
|------|----------|
| Offline | 显著优于 P9-B；目标朝向 ≈90% |
| Business | 无 `model_error`；相对 P9-B / Business Baseline 有文档化对比 |
| Promotion | 双阶段 Verdict 非 C；不得跳过 Business |
| Production | 不覆写历史 baseline 文件；独立 artifact 命名 |

---

## G. Architecture Policy（架构政策）

| 层级 | 政策 |
|------|------|
| **Runtime** | **冻结** — 不得为模型实验改动主链路 |
| **Model 内部** | **允许** — CNN、CRNN、Transformer、Conformer、TCN 等 |
| **Artifact I/O** | **冻结** — `(64,83)` in · 5 posterior out · `numpy_p1` npz |
| **版本 vs 架构** | **解耦** — 见 §H Version Policy |

新架构通过 `modelArchitecture` 字符串区分（如 `conv1d_bigru_v1`），**不得** 要求 Runtime 为单一架构改名。

---

## H. Version Policy（版本政策 · 与架构解耦）

**版本代号** 与 **modelArchitecture** 分离记录：

```text
P9-A   Tiny CNN              architecture: conv1d_global_pool_v1
P9-B   Production CNN V2     architecture: conv1d_production_v2     [FROZEN · Dev Baseline]
P9-C   Tone Model V3         architecture: TBD（实验臂）
```

| 代号 | 名称 | 架构（示例） | 状态 |
|------|------|--------------|------|
| **P9-A** | Tiny CNN | `conv1d_global_pool_v1` | 历史 · 已退役为主要对照 |
| **P9-B** | Production CNN V2 | `conv1d_production_v2` | **FROZEN** — Development Baseline |
| **P9-C** | **Tone Model V3** | 单独记录，如 `conv1d_bigru_v1` / `conformer_v1` / `tcn_v1` | **唯一活跃升级线** |

**P9-C 架构候选（非冻结、可并行实验）：**

- `conv1d_bigru_v1`（CRNN）
- Transformer / Conformer / TCN 等

均属于 **Tone Model V3** 实验架构；Promotion 时须在 artifact metadata 写明 `modelArchitecture`，Runtime 仍通过 loader 架构分发加载。

---

## I. Tone Project Freeze Policy（总冻结政策）

以后任何开发，若涉及下列内容，**必须** 单独提出 **Architecture Unfreeze** 议题；否则 **不得修改**：

| 须 Unfreeze 的域 |
|------------------|
| Runtime |
| Feature |
| Artifact Contract（I/O shape / backend / metadata schema） |
| Node |
| FW |
| Recall |
| Lexicon |

**默认规则：** 未解冻 = 禁止改动。Tone Model 训练与导出不在此列，但须遵守 Model Contract Freeze。

---

# Part II — P9-B Development Baseline Freeze（Production CNN V2）

> 以下章节保留原 `Tone_Model_V2_CNN_Freeze.md` 全部冻结内容，作为 P9-B 权威记录。


## 0. Baseline Definition（正式定义）

```text
Tone Model Development Baseline
  =
Production CNN V2 Candidate
  tone_cnn_production_v2_candidate_20260712.npz
  trainingVersion: production_cnn_v2_candidate_20260712
  modelArchitecture: conv1d_production_v2
  offline val_acc: 0.8248
  freeze date: 2026-07-13
```

---

## 1. Architecture Freeze

### 1.1 架构标识

| 字段 | 冻结值 |
|------|--------|
| `modelArchitecture` | **`conv1d_production_v2`** |
| `modelVersion` | `tone_cnn_production_v2` |
| 可训练参数 | **301,061** |
| 输入 | `(64, 83)` per slice |
| 输出 | **5 logits** → softmax posterior |
| RNN | **无** |

### 1.2 网络结构（冻结）

```text
Input (N, 64, 83)
  → per-channel z-score (feature_mean / feature_std)
  → transpose → (N, 83, 64)

Conv1d: 64 → 96,  kernel=5, pad=2
  → BatchNorm1d(96) → ReLU

Conv1d: 96 → 192, kernel=5, pad=2
  → BatchNorm1d(192) → ReLU

Residual Block:
  Conv1d: 192 → 192, kernel=3, pad=1
  → BatchNorm1d(192) → ReLU
  → + skip (192 channels)

Global Average Pooling (time axis)
  → Dropout(p=0.2) [仅训练]
  → FC: 192 → 192 → ReLU
  → FC: 192 → 96  → ReLU
  → FC: 96  → 5
  → softmax → Tone Posterior (5 class)
```

### 1.3 通道 / Kernel / 组件（冻结）

| 组件 | 冻结值 | Contract 常量 |
|------|--------|---------------|
| Conv1 out channels | **96** | `P2_CNN_CONV1_OUT` |
| Conv2 out channels | **192** | `P2_CNN_CONV2_OUT` |
| Residual out channels | **192** | `P2_CNN_RES_OUT` |
| Kernel (Conv1/2) | **5**, pad=2 | `P2_CNN_KERNEL5` |
| Kernel (Residual) | **3**, pad=1 | `P2_CNN_KERNEL3` |
| FC1 out | **192** | `P2_FC1_OUT` |
| FC2 out | **96** | `P2_FC2_OUT` |
| BatchNorm ε | **1e-5** | `P2_BN_EPS` |
| Dropout | **0.2**（训练） | `cnn_production_v2_torch.py` |
| Residual | **有**（Conv3 + skip） | — |
| 双层 FC | **有** | — |

### 1.4 代码 SSOT

| 模块 | 路径 |
|------|------|
| Contract | `tone_module/contract.py`（`P2_*`） |
| NumPy 推理 | `tone_module/models/cnn_production_v2.py` |
| PyTorch 训练 | `tone_module/models/cnn_production_v2_torch.py` |
| 训练入口 | `tone_module/run_tone_model_v2_production.py` |

**冻结后不得修改上述架构常量或网络拓扑。**

---

## 2. Training Config Freeze

### 2.1 训练配置（冻结）

| 项 | 冻结值 |
|----|--------|
| 训练入口 | `python -m tone_module.run_tone_model_v2_production` |
| `trainingBackend` | `torch_cuda_v2_production` |
| Optimizer | **AdamW** |
| Learning Rate | **3e-4** |
| Weight Decay | **1e-2** |
| Scheduler | **CosineAnnealingLR**（T_max=epochs） |
| Epochs（上限） | **60** |
| 实际训练 epoch | **57**（early stop） |
| Best Epoch | **47** |
| Batch Size | **128** |
| AMP | **启用**（`torch.autocast` fp16 + GradScaler） |
| Early Stop | **patience=10**（监控 val_acc） |
| Seed | **42** |
| Loss | CrossEntropyLoss |
| GPU | NVIDIA GeForce RTX 4060 Laptop GPU |
| Peak VRAM | ~53 MB |
| Training Wall Time | ~4,813 s（~80 min） |

### 2.2 训练产出指标（best checkpoint）

| 项 | 值 |
|----|-----|
| `best_train_acc` | 0.9042 |
| `best_val_acc` | **0.8248** |
| Torch→NumPy parity | PASS（maxAbsLogitsDiff ≈ 0.0032） |

### 2.3 训练工件

| 文件 | 路径 |
|------|------|
| Metrics JSON | `tone_module/models/candidate/training_metrics_v2_20260712.json` |
| Training Log | `tone_module/models/candidate/training_log_v2_20260712.txt` |

---

## 3. Dataset Freeze

### 3.1 数据集

| 项 | 冻结值 |
|----|--------|
| Dataset | **AISHELL-3**（`openslr_aishell3` / `v1`） |
| Alignment | `textgrid_pinyin_v1` |
| Feature Cache | `tone_module/_data_cache/datasets/openslr_aishell3/v1/training_features_v2` |
| cacheSampleCount | **997,992** |
| cacheSchemaVersion | `training_feature_shard_v2` |

### 3.2 Train / Validation Split（冻结）

| 项 | 值 |
|----|-----|
| Holdout 策略 | **speaker holdout** |
| val_ratio | **0.15** |
| seed | **42** |
| Train samples | **850,680** |
| Val samples | **147,312** |

### 3.3 Feature Version（冻结）

| 项 | 值 |
|----|-----|
| `featureVersion` | **`p1-frame-mel-f0-v1`** |
| Feature Shape | **`(64, 83)`** |
| 不得重制 Runtime Feature | ✅ |

---

## 4. Artifact Freeze

### 4.1 冻结 Artifact

| 字段 | 冻结值 |
|------|--------|
| **文件名** | `tone_cnn_production_v2_candidate_20260712.npz` |
| **路径** | `electron_node/services/faster_whisper_vad/tone_module/models/candidate/tone_cnn_production_v2_candidate_20260712.npz` |
| `trainingVersion` | **`production_cnn_v2_candidate_20260712`** |
| `modelArchitecture` | **`conv1d_production_v2`** |
| `modelVersion` | `tone_cnn_production_v2` |
| `featureVersion` | `p1-frame-mel-f0-v1` |
| `formatVersion` | `npz-p1-v1` |
| `backend` | `numpy_p1` |
| 文件大小 | ~1.27 MB |
| `validate_artifact_v1` | **PASS** |

### 4.2 部署说明

- **可作为长期 Development Baseline** 对照件保存
- **不是** Production Release；不得默认写入 Runtime 部署路径
- **不得覆写** `tone_cnn_p1_v1_production_20260712.npz`（P9-A 历史件）
- 测试时通过 `TONE_MODEL_PATH` 指向本 artifact

### 4.3 复现加载

```powershell
$env:TONE_MODEL_PATH = "D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad\tone_module\models\candidate\tone_cnn_production_v2_candidate_20260712.npz"
```

---

## 5. Offline Validation Freeze

**Val set：** 147,312 samples（speaker holdout）  
**对照历史：** P9-A Tiny CNN val_acc **0.7144**

### 5.1 Overall

| 指标 | 冻结值 |
|------|--------|
| **Validation Accuracy** | **0.8248** |
| Macro Precision | 0.8142 |
| Macro Recall | 0.8057 |
| Macro F1 | 0.8097 |
| Weighted Precision | 0.8250 |
| Weighted Recall | 0.8248 |
| Weighted F1 | 0.8248 |
| Δ vs P9-A | **+11.04 pp** |
| Target（≈90%） | **未达成**（差 7.52 pp） |

### 5.2 Per-class Accuracy

| Class | Accuracy | Precision | Recall | F1 |
|-------|----------|-----------|--------|-----|
| t1 | 0.852 | 0.855 | 0.852 | 0.853 |
| t2 | 0.836 | 0.834 | 0.836 | 0.835 |
| t3 | 0.738 | 0.726 | 0.738 | 0.732 |
| t4 | 0.851 | 0.848 | 0.851 | 0.849 |
| t5 | 0.751 | 0.808 | 0.751 | 0.779 |

**最弱类：** t3、t5（与 t3↔t4 混淆相关）

### 5.3 Confusion Matrix（行=真实，列=预测）

```text
           t1      t2      t3      t4     t5
t1      27467    2170     537    1930    136
t2       1818   28909    2132    1331    390
t3        368    1789   17048    3562    335
t4       2326    1330    3226   42286    513
t5        149     450     539     780   5791
```

**主要混淆：** t3↔t4（3562）、t2↔t3（2132）、t1↔t4（1930）

---

## 6. Business Validation Freeze

**报告：** [Tone_Model_V2_Candidate_Business_Validation_Report_2026_07_12.md](./Tone_Model_V2_Candidate_Business_Validation_Report_2026_07_12.md)  
**Run ID：** `run_20260712_v2_candidate`  
**语料：** `dialog_200`（200 case）+ 27 tone-sensitive A/B fixture  
**对照：** Phase 1.5 P9-A Business Baseline（`run_20260712_rerun`）

### 6.1 dialog_200（Tone ON）

| 指标 | P9-A Baseline | **V2 Dev Baseline** | Δ |
|------|---------------|---------------------|---|
| 成功率 | 200/200 | **200/200** | 0 |
| `toneEnabled` | 100% | **100%** | 0 |
| `model_error` | 0 | **0** | 0 |
| tone exact hit（case 级） | 89.5% | **91.0%** | +1.5 pp |
| tone exact hit（累计） | 566 | 532 | -34 |
| candidate rerank rate | 24.5% | **23.5%** | -1.0 pp |
| exact match | 14.0% | **14.0%** | 0 |
| mean CER | 0.219 | **0.220** | +0.001 |

### 6.2 A/B Fixture（27 tone-sensitive）

| 指标 | P9-A Baseline | **V2 Dev Baseline** | Δ |
|------|---------------|---------------------|---|
| posterior present | 27/27 | **27/27** | 0 |
| final changed | 12/27 (44.4%) | **12/27 (44.4%)** | 0 |
| improvement vs expected | 5/27 (18.5%) | **5/27 (18.5%)** | 0 |
| regression vs expected | 4/27 (14.8%) | **3/27 (11.1%)** | -1 case |
| no effect | 15/27 (55.6%) | **15/27 (55.6%)** | 0 |
| low-margin posterior | 16.7% | **44.4%** | +27.7 pp |
| KenLM top1 变化 | 70.4% | **63.0%** | -7.4 pp |

### 6.3 Runtime Latency

| 指标 | P9-A | **V2** | Δ |
|------|------|--------|---|
| mean pipeline | 4837 ms | **4739 ms** | -98 ms |
| mean FW detector | 1325 ms | **1310 ms** | -15 ms |

### 6.4 Business 裁决（冻结记录）

- 声学层有改善（tone exact +1.5 pp、regression -1）
- **端到端 exact match / CER 无净改善**
- **不得 Promotion 为 Production**；**不得替换 Phase 1.5 Business Baseline**
- 作为 **Development Baseline** 冻结有效

---

## 7. Runtime Compatibility Freeze

### 7.1 兼容性确认

| 检查项 | 状态 |
|--------|------|
| `ToneModelLoaderV1.load` | ✅ ready |
| `numpy_p1` infer_batch | ✅ logits `(N, 5)` |
| `validate_artifact_v1` | ✅ PASS |
| Feature Contract `(64,83)` | ✅ 不变 |
| `featureVersion` | ✅ `p1-frame-mel-f0-v1` |
| Artifact Metadata | ✅ 兼容 |
| Diagnostics（trainingVersion / modelArchitecture / artifactPath） | ✅ 可观测 |
| Torch→NumPy export parity | ✅ PASS |

### 7.2 禁止项确认

| 项 | 状态 |
|----|------|
| Shadow 双链路 | ❌ 不存在 |
| Fallback 到 P9-A | ❌ 不存在 |
| 自动切换 Baseline | ❌ 不存在 |
| Runtime 代码本轮修改 | ❌ 无（仅历史扩展 loader 架构分发，向后兼容） |

---

## 8. Baseline Metrics Summary（Development Baseline 唯一对照）

今后任何 Tone 模型实验报告必须包含与本表的对比（**首要对照 P9-B，不得再以 P9-A 为主对照**）：

| 维度 | **Development Baseline（冻结）** |
|------|--------------------------------|
| 架构 | `conv1d_production_v2` |
| 参数 | 301,061 |
| 离线 val_acc | **0.8248** |
| Macro F1 | 0.8097 |
| t3 acc / t5 acc | 0.738 / 0.751 |
| Business tone exact（case） | **91.0%** |
| Business exact match | **14.0%** |
| Business mean CER | **0.220** |
| A/B improvement / regression | **5 / 3**（27 fixtures） |
| `model_error` | **0** |
| mean pipeline latency | **4739 ms** |

---

## 9. Target Definition（Tone Model V3 离线目标）

```text
Offline Validation Accuracy
  82.48%  (P9-B Development Baseline)
    ↓
  ≈ 90%   (Tone Project Goal)

Runtime / Feature / Artifact I/O
  保持 100% 冻结兼容
```

| 项 | 值 |
|----|-----|
| 当前 Development Baseline（P9-B） | **0.8248** |
| Promotion 门槛 | **≈0.90** |
| 缺口 | **7.52 pp** |
| 业务端到端 | Business Validation 继续观测；非 Runtime 解冻条件 |

---

## 10. Version Policy（Part II 摘要）

**权威版本政策见 Part I §H。** 摘要：

```text
P9-A   Tiny CNN              conv1d_global_pool_v1     [历史 · Business Baseline 存档]
P9-B   Production CNN V2     conv1d_production_v2    [FROZEN · Development Baseline]
P9-C   Tone Model V3         architecture 单独记录      [唯一活跃开发线]
```

| 代号 | 名称 | 状态 |
|------|------|------|
| **P9-A** | Tiny CNN | 历史保留；不得继续开发；不得作为主要比较对象 |
| **P9-B** | Production CNN V2 | **FROZEN** — Development Baseline（Part II） |
| **P9-C** | Tone Model V3 | 待开发 — 架构如 `conv1d_bigru_v1` 等，见 Part I §H |

---

## 11. Tiny CNN Retirement

### 11.1 退役对象

```text
conv1d_global_pool_v1
tone_cnn_p1_v1_production_20260712.npz
trainingVersion: production_baseline_20260712
```

### 11.2 退役政策

| 用途 | 政策 |
|------|------|
| 历史 Baseline 存档 | ✅ 保留 |
| Phase 1.5 Business Baseline 文档引用 | ✅ 保留 |
| 新模型主要对照 | ❌ **禁止** — 改用 P9-B |
| 继续开发 / 重训 | ❌ **禁止** |
| Runtime 默认部署 | ❌ 不变更（本轮无 Deployment） |

**P9-A 已完成历史使命：** 验证 Feature / Runtime / Artifact / Node 闭环。

---

## 12. Tone Model V3 Entry Criteria（P9-C 进入条件）

满足以下全部条件，**可以进入 P9-C Tone Model V3 开发**：

| # | 条件 | 状态 |
|---|------|------|
| 1 | P9-B Architecture / Training / Dataset / Artifact 已冻结 | ✅ |
| 2 | 离线 Validation 完整记录（acc / per-class / CM / P/R/F1） | ✅ |
| 3 | Business Validation 完整记录（dialog_200 + A/B） | ✅ |
| 4 | Runtime 兼容确认（Loader / numpy_p1 / 无 Shadow） | ✅ |
| 5 | 离线 val_acc 未达 90% → 触发 Phase E | ✅（0.8248） |
| 6 | P9-B 保留为 V3 实验对照臂 | ✅ 政策冻结 |
| 7 | Feature `(64,83)` / `p1-frame-mel-f0-v1` 不变 | ✅ |
| 8 | 不得修改 Runtime 主链路 | ✅ |
| 9 | Tone Project Master Policy（Part I）已冻结 | ✅ |

### Tone Model V3 开发约束（自 Master Freeze 起生效）

1. **输入输出：** 保持 `(64,83)` → 5 posterior；npz 导出兼容 `numpy_p1`
2. **对照实验：** 必须报告 vs **P9-B**（0.8248）；P9-A 仅作可选历史附表
3. **不得回退：** 不得在 P9-A 上继续迭代
4. **Business：** candidate 完成后复用 Phase 1.5 同类 `dialog_200` + A/B（仅 `TONE_MODEL_PATH`）
5. **架构：** `modelArchitecture` 独立命名；允许 CRNN / Transformer / Conformer / TCN 等，均属 P9-C

---

## 13. Final Checklist

### Part I — Tone Project Master

| 项 | 状态 |
|----|------|
| Model Contract Freeze | ✅ Part I §A |
| Performance Budget 声明 | ✅ 暂无正式 Budget（Part I §B） |
| Development Boundary | ✅ Part I §C |
| Tone Project Goal | ✅ Part I §D |
| Baseline Policy（双 Baseline） | ✅ Part I §E |
| Promotion Policy | ✅ Part I §F |
| Architecture Policy | ✅ Part I §G |
| Version Policy（P9-C = Tone Model V3） | ✅ Part I §H |
| Tone Project Freeze Policy | ✅ Part I §I |

### Part II — P9-B Development Baseline

| 项 | 状态 |
|----|------|
| Runtime Frozen | ✅ 本轮未修改 |
| Feature Frozen | ✅ `p1-frame-mel-f0-v1` / `(64,83)` |
| Dataset Frozen | ✅ AISHELL-3 997,992 cache / speaker holdout |
| CNN V2 Frozen | ✅ architecture + weights artifact |
| Tiny CNN Retired | ✅ 历史保留；非主要对照 |
| Baseline Metrics Frozen | ✅ §5 + §6 + §8 |
| Artifact Frozen | ✅ `tone_cnn_production_v2_candidate_20260712.npz` |
| Compatibility Frozen | ✅ Loader / numpy_p1 / validate / parity |

---

## 14. Final Verdict

## **Tone Project Architecture 正式冻结**

| 裁决 | 内容 |
|------|------|
| **Master Freeze** | Tone Project 长期开发约束已写入 **Part I**；本文档为 **唯一冻结准据** |
| **P9-B** | Production CNN V2 正式冻结为 **Tone Model Development Baseline** |
| **P9-A** | 保留为 **Business Baseline** 历史存档；退役为主要模型对照 |
| **活跃开发** | 后续 **唯一** 活跃对象：**Tone Model（P9-C Tone Model V3）** |
| **Runtime 链路** | Tone → Recall → KenLM → Node **正式退出开发阶段**（冻结维护） |
| **下一阶段** | 可以进入 **P9-C Tone Model V3** 开发（架构单独记录，Runtime 零修改） |

---

## 15. 关联文档与工件

| 文档 / 工件 | 路径 |
|-------------|------|
| 冻结方案 | [Tone Model V2 Production Architecture（冻结方案）.md](./Tone%20Model%20V2%20Production%20Architecture（冻结方案）.md) |
| 开发报告 | [Tone_Model_V2_Production_CNN_Development_Report.md](./Tone_Model_V2_Production_CNN_Development_Report.md) |
| 业务验证 | [Tone_Model_V2_Candidate_Business_Validation_Report_2026_07_12.md](./Tone_Model_V2_Candidate_Business_Validation_Report_2026_07_12.md) |
| Phase 1.5 Business Baseline | [Tone_V2_Phase1_5_Production_Baseline_Business_Validation_Report_2026_07_12.md](./Tone_V2_Phase1_5_Production_Baseline_Business_Validation_Report_2026_07_12.md) |
| Artifact | `tone_module/models/candidate/tone_cnn_production_v2_candidate_20260712.npz` |
| Training Metrics | `tone_module/models/candidate/training_metrics_v2_20260712.json` |
| Business Raw | `tmp/tone_v2_candidate_business_validation/run_20260712_v2_candidate/` |

---

*Master Freeze effective: 2026-07-13 · Tone Project 唯一冻结文档 · P9-B locked · Next: P9-C Tone Model V3*
