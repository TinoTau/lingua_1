# Tone Open-Source Model Investigation Report

**Date:** 2026-06-29  
**Purpose:** Tone V2 Phase 4（Model Quality Development）开源初始化调研  
**Constraint:** 本轮不修改 Runtime / Loader / Contract / 已冻结代码  
**P0 Feature Baseline SSOT:** `tone_module/contract.py`（16 kHz · 80 mels · hop 160 · fmin 50 · fmax 7600 · 5 classes）

---

## 调研范围

| # | 项目 | 论文 | GitHub |
|---|------|------|--------|
| ① | **ToneNet** | [Gao et al., Interspeech 2019](https://www.isca-archive.org/interspeech_2019/gao19c_interspeech.html) | https://github.com/saber5433/ToneNet |
| ② | **Mandarin-Tone-Classification** | 无正式学术论文（课程/个人项目 README） | https://github.com/alicex2020/Mandarin-Tone-Classification |

**未纳入：** Whisper · Paraformer · FunASR · 第三方社区重训权重 · HuggingFace 非作者模型。

---

## 本地资产路径

| 资产 | 路径 |
|------|------|
| ToneNet 源码（含官方权重） | `tone_module/models/opensource/ToneNet/` |
| Mandarin-Tone-Classification 源码 | `tone_module/models/opensource/Mandarin-Tone-Classification/` |
| ToneNet 论文 PDF | `tone_module/models/papers/gao19c_interspeech_2019_ToneNet.pdf`（506 KB） |

---

## ① ToneNet

### Project

ToneNet: A CNN Model of Tone Classification of Mandarin Chinese（普通话音节声调分类 CNN）

### License

**MIT License**（`opensource/ToneNet/LICENSE`，Copyright 2019 saber5433）

### Paper

| 项 | 内容 |
|----|------|
| 标题 | ToneNet: A CNN Model of Tone Classification of Mandarin Chinese |
| 作者 | Qiang Gao, Shutao Sun, Yaping Yang |
| 会议 | Interspeech 2019, pp. 3367–3371 |
| DOI | [10.21437/Interspeech.2019-1483](https://doi.org/10.21437/Interspeech.2019-1483) |
| PDF | 已下载至 `models/papers/gao19c_interspeech_2019_ToneNet.pdf` |

### GitHub

- **URL:** https://github.com/saber5433/ToneNet  
- **默认分支:** master  
- **最后提交:** `eb0b342`（2019-11-27）  
- **Download Status:** **已 clone**（`git clone --depth 1`）

### Official Pretrained Weight

| 渠道 | 结果 |
|------|------|
| GitHub **Releases** | **无**（API 返回 `[]`） |
| **仓库内作者提交文件** | **有** — `Model/ToneNet.hdf5`（42,542,120 bytes） |
| `pretrain model/ToneNet.hdf5` | **有** — 与 `Model/ToneNet.hdf5` **SHA256 完全相同**（重复副本） |
| Google Drive | **未发现**官方链接 |
| HuggingFace | **未发现** `saber5433/ToneNet` 官方模型页 |
| 论文补充材料 | **无**独立权重下载说明 |

**SHA256:** `7EA0396CC7007BD2411C3A470BA014E89F9D60B86C1F703DD1A2F0644B884055`

**判定:** **Yes** — 权重由作者在官方 GitHub 仓库内直接提供（`ModelCheckpoint` 保存至 `Model/ToneNet.hdf5`，见 `ToneNet.py` L129）。**非第三方重训。**

**Download Status:** 随源码 clone **已就位**；无需额外下载。

### Dataset

- **SCSC**（Syllable Corpus of Standard Chinese Dataset）  
- 仓库内含 `mono/` 单音节 wav 样本（作者一并提交，体量较大）  
- 论文报告：99.16% accuracy / 99.11% f1（干净）；加噪 97.07% accuracy

### Network Structure

Keras **2D CNN + MLP**（`ToneNet.py`）：

```text
Input (225×225×3 RGB 图像)
→ Conv2D 64 (5×5, stride 3) + BN + ReLU + MaxPool
→ Conv2D 128 (3×3) + BN + ReLU + MaxPool
→ Conv2D 256 (3×3) ×2 + BN + ReLU + MaxPool
→ Conv2D 512 (3×3) + BN + ReLU + MaxPool
→ Flatten → Dense 1024 → Dense 1024 → Dense 4 → Softmax
```

- 优化器：SGD（lr=0.001, momentum=0.9, Nesterov）  
- 训练：50 epochs，batch 128，`ModelCheckpoint` 保存最优

### Input Feature

Mel 谱经 **librosa** 提取后 **保存为 JPG 伪彩色图**，再经 ImageNet 式 `preprocess_input`（`utils.py`）：

| 参数 | ToneNet | P0 `contract.py` | 匹配 |
|------|---------|------------------|------|
| 表示形式 | 225×225×3 图像 | 80 维向量（time-avg mel） | **否** |
| `n_mels` | 64 | 80 | **否** |
| `n_fft` | 2048 | 512 | **否** |
| `hop_length` | 16 | 160 | **否** |
| `fmin` / `fmax` | 50 / **350 Hz** | 50 / **7600 Hz** | **否** |
| 采样率 | wav 原生（SCSC） | **16000** 强制 | **未对齐** |

来源：`Feature_Extraction.py`

### Output Definition

- **4 类** softmax（阴平–去声；**不含轻声/第五声**）  
- 标签：`label-1` → 0..3（`ToneNet.py` L25）  
- **非** `{t1,t2,t3,t4,t5}` 五维 `TonePosterior` 契约

### 是否适合当前 Tone V2 Runtime

| 维度 | 评估 |
|------|------|
| 任务类型 | ✓ 普通话 Tone Classification（非 ASR） |
| 输入 | ✗ 图像 mel，与 `extract_mel_features` 80 维向量不兼容 |
| 输出 | ✗ 4 类 vs P0 **5 类** posterior |
| 切片假设 | ✓ 音节级输入；FW 已提供 word timestamp，无需 CTC/对齐 |
| 权重加载 | ✗ Keras HDF5 2D CNN **无法**直接载入 `numpy_p0` MLP adapter |

**结论:** **不适合**作为当前 Runtime 的直接替换或零改动初始化；适合作为 **Phase 4 架构与训练流程参考**。

### 是否推荐作为 `tone_cnn_p1` 初始化

**不推荐直接权重初始化。**

理由：特征管线、张量形状、类别数、后端（Keras vs `numpy_p0`）均与 P0 冻结契约不一致；即使用作 transfer learning 也需 **全新 adapter + 特征对齐 + 5 类头**，等价于结构迁移而非权重热启动。

**建议 Phase 4 用法：** 参考论文 CNN 深度与 SCSC 训练策略；在 **P0 Feature Baseline** 上 **从头训练** 或设计 **独立 `tone_cnn_p1` adapter**（新服务实例规则仍适用 Phase 2 Freeze）。

---

## ② Mandarin-Tone-Classification

### Project

Deep learning using CNN for Mandarin Chinese tone classification（Tone Perfect 数据集上的 Keras CNN 实验）

### License

**未提供 LICENSE 文件**（仓库仅 README + notebook）。使用前需自行确认版权与商用条款。

### Paper

**无**正式发表论文或作者主页论文链接。  
README 描述为个人/课程项目（2019），最高报告准确率 99.8%。

**Download Status:** 无独立论文可下载。

### GitHub

- **URL:** https://github.com/alicex2020/Mandarin-Tone-Classification  
- **最后 push:** 2019-04-05  
- **Download Status:** **已 clone**

### Official Pretrained Weight

| 渠道 | 结果 |
|------|------|
| GitHub Releases | **无** |
| 仓库内 `.h5` / `.hdf5` / `.pt` | **无** |
| Google Drive | **无**（notebook 引用个人 Colab Drive 路径，非公开发布） |
| HuggingFace | **无** |
| 论文补充材料 | **不适用** |

**判定:** **No official pretrained weights available.**

### Dataset

- **Tone Perfect**（Michigan State University）：https://tone.lib.msu.edu/  
- 9,860 条单音节音频；男/女/混合划分  
- 数据 **不在** GitHub 仓库内；需单独申请/下载

### Network Structure

Keras CNN（`Mandarin_Tone_Classification.ipynb` · `get_cnn_model`）：

```text
Input (MFCC 2D 张量, channels=1)
→ Conv2D 32 (2×2) → BN → Conv2D 48 (2×2) → BN → Conv2D 120 (2×2) → BN
→ MaxPool → Dropout → Flatten
→ Dense 128 → Dropout → Dense 64 → Dropout → Dense(num_classes) → Softmax
```

- 优化器：Adadelta  
- 训练：15 epochs，batch 20

### Input Feature

主训练路径为 **MFCC**（`mp3tomfcc(..., 60)`），**非**主路径 mel-spectrogram：

| 参数 | Notebook（mel 可视化分支） | P0 `contract.py` | 主训练 MFCC |
|------|---------------------------|------------------|-------------|
| `n_mels` | 80 | 80 | N/A（MFCC） |
| `sr` | **22050**（librosa 默认） | **16000** | 22050 |
| `n_fft` / `hop` | 1024 / 512 | 512 / 160 | MFCC 参数独立 |
| `fmin` / `fmax` | 75 / 3700 | 50 / 7600 | — |

Notebook 中 `classes = 5`，README 文案写「四类声调」——文档与实现 **不一致**。

### Output Definition

- Softmax 分类（notebook 配置 **5 类**）  
- **未**导出为 `{t1..t5}` posterior 向量  
- **无** `model.save` / 权重文件产出逻辑

### 是否适合当前 Tone V2 Runtime

| 维度 | 评估 |
|------|------|
| 任务类型 | ✓ Tone Classification 方向正确 |
| 输入 | ✗ MFCC 2D 图，非 P0 mel 向量 |
| 采样率 | ✗ 22050 vs 16 kHz |
| 输出 | △ 5 类 softmax 数量接近，但无官方权重、无 posterior 契约 |
| 工程成熟度 | ✗ Colab notebook；无训练脚本、无 artifact 管线 |

**结论:** **不适合**当前 Runtime；且无官方权重。

### 是否推荐作为 `tone_cnn_p1` 初始化

**不推荐。**

理由：无官方预训练权重；特征为 MFCC 非 P0 mel；无与 `validate_artifact` / `infer_batch` 兼容的 artifact 产出；许可证不明确。

**建议 Phase 4 用法：** 仅作 Tone Perfect 数据入口与简单 CNN 基线 **思路参考**；实际训练应走 Phase 3 冻结的 `train_tone_cnn` + `contract.py` 管线。

---

## 与 P0 Feature Baseline 对照总表

| 项目 | 官方预训练 | Mel 输入 | 16 kHz | 5 类 Posterior | 适配 `numpy_p0` | 推荐 p1 初始化 |
|------|-----------|----------|--------|----------------|-----------------|----------------|
| **ToneNet** | **Yes**（仓库内 hdf5） | △（mel→图像） | △ | **否**（4 类） | **否** | **否**（参考架构） |
| **Mandarin-Tone-Classification** | **No** | ✗（MFCC 主路径） | **否** | △（5 类无权重） | **否** | **否** |
| **当前 P0 `tone_cnn_p0`** | 项目内 npz | ✓ | ✓ | ✓ | ✓ | **基线延续** |

---

## 官方预训练检索记录

### ToneNet（saber5433）

1. GitHub Releases — 空  
2. 仓库树 — **`Model/ToneNet.hdf5`** ✓  
3. README — 无外链权重  
4. Google Drive — 无  
5. HuggingFace `saber5433` — 无 ToneNet 模型仓库  
6. Interspeech 2019 论文页 — 无补充权重链接  

### Mandarin-Tone-Classification（alicex2020）

1. GitHub Releases — 空  
2. 仓库树 — 仅 `.ipynb` + `README.md`  
3. README — 无权重链接  
4. Google Drive — 仅 notebook 内个人 Colab 路径（非官方发布）  
5. HuggingFace — 无  
6. 作者其他仓库 — 无关联 tone 权重  

---

## 最终结论

### 1. 是否存在官方预训练模型？

| 项目 | 结论 |
|------|------|
| **ToneNet** | **是** — 作者官方 GitHub 仓库内 `Model/ToneNet.hdf5`（已随 clone 落盘） |
| **Mandarin-Tone-Classification** | **否** — **No official pretrained weights available.** |

### 2. 若不存在，是否建议直接使用源码作为训练基础？

| 项目 | 建议 |
|------|------|
| **ToneNet** | **有条件建议** — 可参考 **网络设计** 与 **SCSC 训练流程**；但须 **重写特征提取** 对齐 `contract.py`，**不可**直接使用其 JPG 图像管线或 4 类头 |
| **Mandarin-Tone-Classification** | **不建议** — 无权重、MFCC 路径、Colab 碎片代码、许可证缺失；不如扩展 Phase 3 `train_tone_cnn.py` |

### 3. 是否适合作为 Tone V2 Phase 4 Fine-tune 起点？

**综合推荐：**

| 优先级 | 方案 | 说明 |
|--------|------|------|
| **1（推荐）** | **延续 P0 `tone_cnn_p0` + Phase 3 训练管线** | 已对齐 Feature / Loader / `infer_batch`；Phase 4 做 **质量提升与结构升级**（更深 CNN 等） |
| **2（参考）** | **ToneNet 论文 + 源码** | 学术验证的 mel-CNN 思路；权重 **不直接迁移** |
| **3（不推荐）** | **Mandarin-Tone-Classification** | 无官方权重；特征与契约偏离大 |

**Phase 4 明确路径（不触碰冻结 Runtime）：**

```text
Audio Slice (FW timestamp)
→ extract_mel_features (contract.py, 不变)
→ 新训练脚本 / 更深 CNN (Phase 4 新增)
→ npz Artifact
→ validate_artifact → infer_batch (新 adapter 文件, 新服务实例若结构变更)
→ 既有 Runtime Hop (不变)
```

### 4. 本轮交付物

| 交付 | 状态 |
|------|------|
| ToneNet 源码 | ✓ `models/opensource/ToneNet/` |
| Mandarin-Tone-Classification 源码 | ✓ `models/opensource/Mandarin-Tone-Classification/` |
| ToneNet 论文 PDF | ✓ `models/papers/gao19c_interspeech_2019_ToneNet.pdf` |
| ToneNet 官方预训练 | ✓ 已在仓库内（未下载第三方权重） |
| Mandarin 官方预训练 | ✗ 不存在 |
| 冻结代码修改 | **无**（符合约束） |

---

**签署:** 开源调研完成；Phase 4 应以 **P0 训练 Foundation + 自研结构升级** 为主路径，ToneNet 作学术参考，Mandarin-Tone-Classification 不纳入初始化候选。
