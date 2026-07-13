# Tone V2 — Mean-Mel Feature Baseline Root Cause Audit Report

**Date:** 2026-07-02  
**Audit Type:** Read-only Root Cause Audit（**非功能开发** · **非代码修改**）  
**Scope:** `mel.extract_mel_features(...).mean(axis=1)` 历史来源 · 设计依据 · 实现影响 · 当前适用性  
**禁止项（本轮）：** 修改 Runtime · Loader · Contract · Dataset Foundation · Training Engineering · Feature Shard · Validation · Artifact · Node E2E · 任何训练或权重

**依据：**

- `tone_module/mel.py` · `tone_module/contract.py`
- [TONE_V2_CONTRACT_FREEZE.md](./TONE_V2_CONTRACT_FREEZE.md)
- [TONE_V2_DATASET_FOUNDATION_FREEZE.md](./TONE_V2_DATASET_FOUNDATION_FREEZE.md)
- [TONE_V2_TRAINING_ENGINEERING_FREEZE.md](./TONE_V2_TRAINING_ENGINEERING_FREEZE.md)
- [Tone_V2_Phase7C_tone_cnn_p3_50Epoch_Training_Report.md](./Tone_V2_Phase7C_tone_cnn_p3_50Epoch_Training_Report.md)
- [Tone_V2_Phase7D_Model_Quality_PreDev_Audit_Report.md](./Tone_V2_Phase7D_Model_Quality_PreDev_Audit_Report.md)
- Git：`8ac73547`（`mel.py` 全文件首现）· 历史 Phase 1–7 报告

---

## Executive Summary

| 审计问题 | 结论 |
|----------|------|
| `mean(axis=1)` 最早何时出现？ | **2026-06-08** commit `8ac73547`（仓库可见唯一祖先）；**首版即含** `mean(axis=1)` 与 docstring「mean-pooled」 |
| 当时是否有单一书面设计依据？ | **无独立设计备忘录**；**间接证据充分**：P0 固定 80 维 · `mel_mean_80_v1` 别名 · Phase 1 明确 **非 CRNN/非训练** · MLP/`numpy_p0` 简化 |
| 当时是否合理？ | **是** — 作为 **Phase 0/1 Foundation 工程取舍**（契约冻结 · 单 slice 固定维 · CPU NumPy 延迟） |
| 现在是否成为质量瓶颈？ | **是（在 Canonical speaker-holdout 目标下）** — 与 7-D 审计一致；**不等于** p0-v1 实现错误 |
| 能否在 p0-v1 内恢复时序？ | **不能**（真时序）；仅能在同一 80 维均值上继续调 MLP/损失 |
| 改 frame-level mel 是否须新 Foundation Phase？ | **是** — 新 `featureVersion` + 多冻结层再冻结 |

### Final Verdict: **CONDITIONAL PASS**

审计结论成立、证据链闭合；**frame-level 升级须单独立项**（Feature Contract / Foundation Phase），不在普通 `tone_cnn_p*` 权重训练范围内。

---

## Historical Origin

### Git / 文件起源

| 项 | Evidence |
|----|----------|
| **最早 commit** | `8ac73547c19530ff7001534091b1f1bafe95bcc9` |
| **作者 / 时间** | Zhiqi-Tao-1160573-new2 · **2026-06-08 12:08:47 +1200** |
| **提交说明** | `temp version`（仓库 squash 后无更早 diff） |
| **首现文件** | `electron_node/services/faster_whisper_vad/tone_module/mel.py` |
| **`mean(axis=1)` 首现** | **同一 commit 第 80 行** — `git blame` 全段归属 `8ac73547` |

```54:80:electron_node/services/faster_whisper_vad/tone_module/mel.py
def extract_mel_features(audio: np.ndarray, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    """Return (N_MELS,) mean-pooled log-mel vector for one word slice."""
    ...
    mel = np.log10(np.maximum(mel, 1e-10))
    return mel.mean(axis=1).astype(np.float32)
```

| 字段 | Expected | Actual | Evidence | Impact | Action |
|------|----------|--------|----------|--------|--------|
| 可追溯最早 commit | 有 | `8ac73547` | `git blame` · `git log --follow` | 无更早替代实现 | **KEEP** 记录 |
| 曾为 frame-level 后改 mean | 若有应见于 history | **无** | 单 commit 即 mean-pool | 非后期退化 | **KEEP** 设计 |

### 同期系统锚点

| 资产 | 时间线 | 与 mean-mel 关系 |
|------|--------|------------------|
| `tone_cnn_p0.npz` | Pre-Phase1 探针已引用 | 权重 `w1: (80, 32)` — **假定 80 维输入自始** |
| Phase 1 Contract Freeze | 2026-06-29 关闭 | 冻结 `nMels=80`，**未写** pooling 公式，但 **legacy 名已暴露语义** |
| `mel_mean_80_v1` | Phase 1 Runtime 恢复前后 | **字面即 mean-80** |

---

## Design Rationale Evidence

> **裁决：** 无「会议纪要式」单句依据；以下为 **代码 + 冻结文档 + 别名 + 架构边界** 的 **多源间接证据**。

### 设计动机矩阵

| 假设动机 | Expected | Actual | Evidence | Impact | Action |
|----------|----------|--------|----------|--------|--------|
| **CPU / NumPy 运行约束** | P0 无 GPU/Torch | `numpy_p0` · `stft`+矩阵乘 · 单向量推理 | `backends/numpy_p0.py` · Phase 2 Freeze | 支持 | **KEEP** |
| **Artifact schema 简化** | 固定 `w1∈R^{80×H}` | `loader._validate_shapes` 强制 `(80,32)` | `loader.py` L92–103 | **绑定** | **KEEP** p0-v1 |
| **Runtime latency** | 每 slice 一次轻量特征 | 单 `(80,)` · 无序列 | `inference.py` stack → `infer_batch` | 支持 | **KEEP** |
| **单 slice 固定维度** | 可变长禁入 P0 contract | 任意时长音频 → **固定 80 维** | `mean(axis=1)` 时域坍缩 | **核心机制** | **KEEP** p0-v1 |
| **numpy_p0 adapter 简化** | `mel_batch[N,80]` | `infer_batch` 仅矩阵乘 MLP | `numpy_p0.py` L21–26 | **绑定** | **KEEP** |
| **P0 Feature Baseline** | `featureVersion=p0-v1` | `contract.P0_N_MELS=80` | `TONE_V2_CONTRACT_FREEZE.md` §3 | **SSOT** | **KEEP** |
| **data_mini 训练便利** | 小数据可跑通 | 11.8k 音节 + 80 维 MLP 可训 | P4 报告 73.2% | 支持但非唯一原因 | **KEEP** |
| **临时占位待 CNN** | 文档称 placeholder | **否** — Phase 1 **书面禁止 CRNN**；且首版 docstring 称 **mean-pooled 正式语义** | Phase 1 Supplement L39–44 · mel docstring | 非临时 | **RESTORE** 术语（见 Naming） |
| **明确设计备忘录** | 应有 | **未发现** | 全库检索无「为何 mean pool」专章 | 追溯缺口 | **MODIFY** 文档（下阶段） |

### 历史是否讨论过 frame-level / CNN / CRNN / F0

| 主题 | Expected | Actual | Evidence | Action |
|------|----------|--------|----------|--------|
| **CRNN** | Phase 1 禁止 | **明确禁止** | Phase 1 Contract Plan L19 · Supplement L42 | **KEEP** 边界 |
| **Training / 模型选型** | Phase 1 禁止 | **明确禁止** | 同上 L17–18 | **KEEP** |
| **真 CNN（ToneNet 等）** | Phase 4 调研 | **不兼容 80 维 time-avg** | [Tone_OpenSource_Model_Investigation_Report.md](./Tone_OpenSource_Model_Investigation_Report.md) L103 | **KEEP** P0 路线 |
| **F0 / pitch contour** | 若讨论应见于方案 | **无 P0 实现**；P6-C 指出 time-avg **无显式时长/上下文** | Phase 6-C L129 | **MODIFY**（未来特征） |
| **frame-level mel** | 未纳入 P0 freeze | **未实现**；开源 CNN 用 2D 表示 | OpenSource Report | 未来 Phase |

### `mel_mean_80_v1` 别名（强语义证据）

```8:9:electron_node/services/faster_whisper_vad/tone_module/contract.py
# Shipped P0 npz artifact uses mel_mean_80_v1; semantically equivalent baseline.
P0_COMPATIBLE_FEATURE_VERSIONS = frozenset({P0_FEATURE_VERSION, "mel_mean_80_v1"})
```

| 字段 | Expected | Actual | Impact | Action |
|------|----------|--------|--------|--------|
| legacy 名含 `mel_mean` | 暗示均值池化 | **是** | **mean pooling 为生产语义的一部分** | **KEEP** 兼容集 |

---

## Code Path Analysis

### 信号处理链（`mel.py`）

```text
audio slice
  → STFT (n_fft=512, hop=160) → power spectrogram
  → mel filterbank → log10 mel  shape: (n_mels=80, T_frames)
  → mean(axis=1)               shape: (80,)   ← 时间轴 T 被消除
```

| 步骤 | Expected | Actual | Evidence |
|------|----------|--------|----------|
| 帧级 mel | `(80, T)` 可供 CNN/RNN | 仅内部变量，**不导出** | L78–79 |
| 导出特征 | Contract 定义 | **`(N_MELS,)`** | L80 return |

### 消费方一致链

| 模块 | 输入期望 | 实际 | Evidence |
|------|----------|------|----------|
| `inference.py` | `(80,)` per slice | `extract_mel_features` → `stack` → `(N,80)` | L99 |
| `train_tone_cnn.py` | `(80,)` | 同源函数 | L270 |
| `training_io/feature_shard.py` | `(80,)` per row | `np.stack` → shard `mel[N,80]` | L73–76 |
| `numpy_p0.infer_batch` | `mel_batch[..., 80]` | `x @ w1` | `w1: (80,32)` |
| `offline_tone_eval` | 同 Runtime | `infer_batch` | 7-C JSON |

**Train / Runtime / Shard 三者同源** — mean-mel 为 **端到端一致** 设计，非训练侧单独漂移。

---

## Feature Contract Impact

### 是否写入 Feature Baseline SSOT？

| 项 | Expected | Actual | Evidence | Action |
|----|----------|--------|----------|--------|
| pooling 公式明文 | 理想应写 `mean(time)` | **未写** | `TONE_V2_CONTRACT_FREEZE.md` §3 仅列 `nMels=80` | **MODIFY** 文档（下阶段） |
| 80 维语义 | 固定维输入 | **隐含** mean-pool | `mel.py` docstring · `mel_mean_80_v1` | **KEEP** |
| `featureVersion=p0-v1` 绑定 `(80,)` | 是 | **是** | `loader._validate_shapes` · `P0_N_MELS` | **KEEP** |

### `p0-v1` 与输入形状绑定

| 组件 | 约束 | Evidence |
|------|------|----------|
| `w1` | `(80, 32)` | `loader.py` L92–93 |
| `mel_mean` / `mel_std` | `(80,)` | `loader.py` L100–103 |
| Feature Shard `nMels` | `80` | `shard_manifest.json` schema |
| `validate_artifact` probe | `(2, 80)` 默认 | `validate_artifact.py` L82 |

**结论：** `mean(axis=1)` 不是实现细节，而是 **`p0-v1` 语义组成部分** — 将帧级 mel **定义为** 80 维时间平均向量。

---

## Runtime Impact

| 项 | Expected | Actual | Evidence | Impact | Action |
|----|----------|--------|----------|--------|--------|
| 每 slice 特征成本 | 低延迟 | 单次 STFT + mean | `inference.py` | 有利 | **KEEP** |
| 时序建模 | 无（P0） | 无 | 无 RNN/CNN in runtime | 质量受限 | **KEEP** p0 路径 |
| 变长 slice | 归一到 80 维 | mean 池化吸收时长差异 | 同函数 | 有利部署 · 损声调轮廓 | **KEEP** p0 |

---

## Training Impact

| 项 | Expected | Actual | Evidence | Impact | Action |
|----|----------|--------|----------|--------|--------|
| `train_tone_cnn` 输入 | `(N,80)` | `extract_mel_features` | `train_tone_cnn.py` | MLP 非 CNN | **RESTORE** 命名 |
| Feature Shard | 物化 80 维 | `mel` 数组 `[rows,80]` | `feature_shard.py` | 7-B 冻结 | **KEEP** |
| 全量 Canonical 训练 | 可复现 | 997,992 × 80 | 7-C 报告 | IO 成功 · 质量平台 | **KEEP** IO |
| 训练策略 vs 特征 | 策略不改特征语义 | 50 epoch 平台 @57% | 7-C 曲线 | 特征上限信号 | 见 Model Quality |

---

## Artifact / Validation Impact

| 门 | Expected | Actual | Evidence | Action |
|----|----------|--------|----------|--------|
| Schema | `w1,b1,w2,b2` | PASS | `tone_cnn_p3_validate.json` | **KEEP** |
| Shape | `(80,32)` MLP | PASS | `validate_artifact._shape_validation` | **KEEP** |
| Adapter | `infer_batch` on `(N,80)` | PASS · acc 0.5738 | 7-C | **KEEP** |
| 验收 mel | 与训练同分布 | val shard 80 维 | 7-C offline | **KEEP** |

**validate_artifact 不校验「是否应有时间维」** — 只校验 **p0-v1 形状契约**。

---

## Model Quality Impact

### 与 Phase 7-C / 7-D 的交叉证据

| 指标 | Expected（若 mean-mel 足够） | Actual（p3 · AISHELL speaker val） | Evidence |
|------|---------------------------|-------------------------------------|----------|
| Offline accuracy | 接近 p1 量级（误预期） | **57.38%** | `tone_cnn_p3_offline_eval.json` |
| p1 对照 | 73.2% | **同结构** · **不同协议**（mini · utterance · n=1808） | P4 Offline Report |
| Train vs val | — | 58.0% vs 57.4% | 7-C 报告 · **欠拟合** |
| t3 recall | — | **34.3%** | offline JSON |
| t5 recall | — | **39.3%** | offline JSON |
| t3 混淆 | — | →t4 **8,454** · →t2 **5,333** | confusion matrix |
| confidence_mean | — | **0.576**（p1: 0.763） | offline JSON |

### 「mean-mel 丢失时间信息」是否被支持？

| 论据 | Evidence | 裁决 |
|------|----------|------|
| **代码** | `mean(axis=1)` 消除 `T_frames` | **直接证明** |
| **音系** | 声调靠 F0 轮廓 · 三声 vs 二声/四声 | 领域知识 + t3 混淆模式 |
| **同特征不同难度** | p1 同 mean-mel 在 mini 上 73% | 特征 **可工作** · **非硬 bug** |
| **同难度提升有限** | p3 全量 50 epoch 仍 57% · train≈val | **特征+MLP 平台上限** |
| **开源 SOTA 用 2D/序列** | ToneNet 图像 mel · 非 80 维均值 | 对照证明 P0 简化 |

| 字段 | Expected | Actual | Impact | Action |
|------|----------|--------|--------|--------|
| mean-mel 是质量瓶颈之一 | 在 Canonical 目标下成立 | **成立** | 阻断 70%+ 期望 | **MODIFY**（新 feature 子阶段） |
| mean-mel 是训练 bug | 否 | Train/Runtime/Shard 一致 | 无 | **KEEP** 实现 |

---

## Temporal Information Loss Analysis

### 信息论 / 形状层

| 表示 | 维度 | 时序 |
|------|------|------|
| Frame-level log-mel | `(80, T)` | **保留** |
| **p0-v1 mean-mel** | `(80,)` | **丢失 T** |
| 可能「同维」替代 | std/max per band 等 | **改变语义** ≠ 恢复轨迹 |

### 能否在 **不修改 Feature Baseline** 下恢复时序？

| 方案 | 可行性 | 原因 | Action |
|------|--------|------|--------|
| 从现有 80 维反演 F0 | **否** | 不可逆压缩 | **DELETE** |
| 80 维改存 max/std 仍叫 p0-v1 | **否** | 违背已训练权重语义 | **DELETE** |
| 160 维 mean∥std 仍用 p0-v1 | **否** | 破坏 `w1` shape 契约 | **DELETE** |
| 同 80 维上更大 MLP / class weight | **是** | 不恢复时序 · 仅更好映射 | **KEEP** 7-D 策略线 |

**结论：** **真时序恢复必须 bump `featureVersion`**。

---

## Current Applicability Assessment

| 维度 | 当时（P0 Foundation） | 现在（Canonical 质量目标） | 裁决 |
|------|----------------------|---------------------------|------|
| Contract 冻结 | **适用** | **适用** | **KEEP** |
| Runtime 部署 | **适用** | **适用** | **KEEP** |
| Regression / CI | **适用** | **适用** | **KEEP** data_mini 路径 |
| Canonical speaker-holdout SOTA | 非目标 | **不适用** | **停止作为主质量投入** |
| 生产 canonical 权重 | p1@73% mini | p3@57% AISHELL | **CONDITIONAL** — 未 Runtime 验收 |

### 区分两个命题（审计强制）

| 命题 | 裁决 |
|------|------|
| A. 当时选择 mean-mel 作为 **P0 工程取舍** 是否合理？ | **是（KEEP）** |
| B. 该取舍是否 **仍足以支撑 Canonical 声调分类质量目标**？ | **否（已成为瓶颈）** |

---

## Required Change Matrix（若迁移 frame-level mel）

| 组件 | 须改？ | 原因 | Phase 类型 |
|------|--------|------|------------|
| `contract.py` | **是** | 新 `featureVersion` · 维度假设 | **Feature Foundation** |
| `mel.py` | **是** | 导出 `(T,80)` 或契约化固定 T | 同上 |
| Artifact schema (`w1` shape) | **是** | 非 `(80,32)` | Model Capability + Contract |
| `validate_artifact` | **是** | shape 门 · probe 维 | 同上 |
| `numpy_p0` 或新 backend | **是** | 卷积/序列推理 | Model Capability |
| `loader.py` | **是** | `_validate_shapes` | Contract |
| `train_tone_cnn` 或新 trainer | **是** | 新头/损失 | Model Capability |
| Feature Shard schema | **是** | `mel` 张量秩变化 | **Training Engineering 再冻结** |
| `inference.py` | **是** | 批特征维变化 | Runtime **不变 hop** · 改特征维 |
| Dataset Foundation | **否** | 仍输出 `SyllableSample` | **KEEP** |

### 建议 `featureVersion` 命名

| 候选 | 说明 | 推荐 |
|------|------|------|
| `p1-frame-mel-v1` | 明确帧级 · 与 p0 区分 | **推荐** |
| `p0-v2` | 易与「仅权重升级」混淆 | **DELETE** |
| `mel_seq_80_v1` | 可读 | 备选 |

须写入 `TONE_V2_CONTRACT_FREEZE.md` §Feature Baseline **再冻结**。

---

## Frozen Architecture Impact Matrix

| 冻结域 | mean-mel 审计结论 | 7-D 策略训练 | Frame-mel 迁移 |
|--------|-------------------|--------------|----------------|
| Runtime hop | **KEEP** | **KEEP** | **KEEP** hop · MODIFY 特征维 |
| `p0-v1` Contract | **KEEP** | **KEEP** | **KEEP** 路径并存 |
| Dataset Foundation | **KEEP** | **KEEP** | **KEEP** |
| Training Engineering IO | **KEEP** schema | **KEEP** | **再冻结** shard |
| Artifact Contract (p0) | **KEEP** | **KEEP** | **KEEP** legacy |
| Node E2E | 未改 | 未改 | 新实例验收 |

---

## Naming Drift Audit

| 位置 | 声称 | 实际 | Evidence | Action |
|------|------|------|----------|--------|
| `train_tone_cnn.py` L2 | 「**P0 CNN**」 | **MLP** `80→32→5` | 文件头注释 | **RESTORE** 文档术语 |
| 模型文件 `tone_cnn_*.npz` | CNN | MLP weights | 全链路 `numpy_p0` | **RESTORE** / 保留文件名 **KEEP** |
| `tone_crnn` 路线图 | CRNN 未来 | 未实现 | Phase 6 审计 | **KEEP** 规划 |
| Phase 7 文档 | time-avg mel | 与代码一致 | P7 PreDev L160 | **KEEP** |
| OpenSource Report | 80 维 time-avg | 与代码一致 | L103 | **KEEP** |

**结论：** 存在 **「CNN 文件名/注释 vs MLP 实现」** 漂移；**mean-mel 语义在 docstring/`mel_mean_80_v1` 中无漂移**。

---

## KEEP / MODIFY / RESTORE / DELETE

| Action | 项 |
|--------|-----|
| **KEEP** | `mel.mean(axis=1)` 作为 **`p0-v1` 冻结语义** |
| **KEEP** | `featureVersion=p0-v1` · `mel_mean_80_v1` 兼容 |
| **KEEP** | Train/Runtime/Shard 同源 `extract_mel_features` |
| **KEEP** | `numpy_p0` + `(80,)` MLP 回归与部署路径 |
| **KEEP** | data_mini 回归 · p1/p2 历史 artifact |
| **MODIFY** | 文档：在 Contract SSOT **明示** mean-pool 公式 |
| **MODIFY** | 质量主线：7-D 训练策略 + 加深 MLP（仍 p0-v1） |
| **MODIFY** | 新 Phase：frame-level `featureVersion` + shard v2 |
| **RESTORE** | 术语：`tone_cnn` → 正文称 **P0 MLP**；CNN 仅作历史模型名 |
| **DELETE** | 在 p0-v1 上期望 70%+ AISHELL speaker-holdout **而不改特征** |
| **DELETE** | 100 epoch 续训作为质量方案 |
| **DELETE** | 不 bump featureVersion 的「伪 CNN」（80 维上的卷积名不副实） |

---

## Remaining Risks

| 风险 | 严重度 | 缓解 |
|------|--------|------|
| 单 commit 历史 · 无设计备忘录 | MED | 本报告 + Contract 文档补全 |
| p1 73% vs p3 57% 误读 | HIGH | 7-D0 同协议基线 |
| Frame-mel 误触 Training IO 冻结 | HIGH | 独立 Phase + shard schema 再冻结 |
| 保留 mean-mel 路径双轨维护 | MED | p0 legacy 明确 sunset 策略 |

---

## 终局问答

### 1. 当初选择 `mean(axis=1)` 的明确依据是什么？

**无单一书面决策句。** 多源证据表明 intentional **P0 工程取舍**：

- 首版代码 docstring：**mean-pooled log-mel vector**（`8ac73547`）
- 生产 legacy 名：**`mel_mean_80_v1`**
- Phase 1 范围：**Contract/Loader only · 非 CRNN · 非训练**
- 固定 **`(80,)`** 适配 **`numpy_p0` MLP** 与 **低延迟 Runtime**
- 开源 CNN 调研结论：**与 80 维 time-avg **不兼容**** — P0 有意走简化路线

### 2. 它当时是否是合理的 P0 工程取舍？

**是。** 在「冻结 Runtime 契约 · CPU NumPy · 固定维 artifact · 快速贯通 Recall 链」目标下，mean-mel 是 **一致且可验证** 的选择。

### 3. 它现在是否已经成为声调模型质量瓶颈？

**是（在 Canonical AISHELL-3 speaker-holdout 质量目标下）。**  
证据：p3 欠拟合平台 ~57% · t3/t5 recall 低 · t3↔t2/t4 混淆 · 与「无 F0 轮廓」一致；**非**实现不一致或数据层失败。

### 4. 当前 `tone_cnn_*` 是否存在命名漂移？

**是。** 实现为 **MLP**；**CNN** 出现在 `train_tone_cnn` 注释与模型命名中。Feature 侧 **mean-mel 命名无漂移**。

### 5. 是否还能在 p0-v1 下继续优化，还是应该停止投入？

**可继续有限优化（7-D 训练策略 + 加深 MLP），但应停止将 p0-v1 mean-mel 作为 Canonical 质量 **主投资**。**  
保留为：**legacy · regression baseline · 已部署 p1 路径** — **非**删除实现。

### 6. 如果改为 frame-level mel，是否必须进入新的 Feature Contract / Foundation Phase？

**是。** 须新 `featureVersion`（建议 `p1-frame-mel-v1`）· 修改 `mel.py` / contract / loader / adapter / shard schema / 训练器 · **Training Engineering 再冻结** · **不得**在普通 p3/p4 权重训练中静默修改。

### 7. 下一步应该是什么？

```text
短期（7-D · Model Capability · 仍 p0-v1）
  → 可比评估基线 + class weight / LR / loss 日志 + 加深 MLP

中期（独立 Phase · Feature V2）
  → Frame-level Mel 方案审计 + Contract 再冻结 + 新 shard + 真 CNN/CRNN 训练

非首选
  → 继续堆 epoch · 在 80 维均值上假「CNN」· 修改 Dataset/Runtime
```

---

## Final Verdict

### **CONDITIONAL PASS**

- **PASS 部分：** 历史来源、设计意图、实现影响、质量关联 **证据链完整**；区分「当时合理」与「现今瓶颈」**成立**。
- **CONDITIONAL 部分：** Frame-level 升级 **必须** 新 Feature Foundation Phase；p0-v1 质量投入 **应有上限**；命名与 SSOT 文档 **待补全**。

**不得**在本审计轮修改任何代码或冻结层。

---

*Mean-Mel Feature Baseline Root Cause Audit — read-only · no code / config / weights / frozen-layer changes.*
