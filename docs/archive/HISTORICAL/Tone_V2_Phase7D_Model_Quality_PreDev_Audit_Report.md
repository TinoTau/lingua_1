<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/Tone_V2_Phase7D_Model_Quality_PreDev_Audit_Report.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# Tone V2 Phase 7-D — Model Quality Improvement 开发前代码审计报告

**Date:** 2026-07-02  
**Audit Type:** Read-only Pre-Development Code Audit（**非功能开发** · **非训练** · **非 Runtime 开发**）  
**Scope:** 分析 `tone_cnn_p3`（50 Epoch · Canonical AISHELL-3）模型质量未达预期的根本原因；制定 **Model Capability Layer** 下一阶段提升方案  
**禁止项（本轮）：** 修改 Runtime · Loader · Contract · Dataset Foundation · Training Engineering · Feature Shard · Shard Reader · Validation Pipeline · Artifact Contract · Node E2E

**依据 SSOT：**

- [TONE_V2_CONTRACT_FREEZE.md](./TONE_V2_CONTRACT_FREEZE.md)
- [TONE_V2_DATASET_FOUNDATION_FREEZE.md](./TONE_V2_DATASET_FOUNDATION_FREEZE.md)
- [TONE_V2_TRAINING_ENGINEERING_FREEZE.md](./TONE_V2_TRAINING_ENGINEERING_FREEZE.md)
- [Tone_V2_Phase7C_tone_cnn_p3_50Epoch_Training_Report.md](./Tone_V2_Phase7C_tone_cnn_p3_50Epoch_Training_Report.md)
- [Tone_V2_P4_Offline_Quality_Evaluation_Report.md](./Tone_V2_P4_Offline_Quality_Evaluation_Report.md)
- [Tone_V2_Phase6C_Training_Data_Expansion_PreDev_Audit_Report.md](./Tone_V2_Phase6C_Training_Data_Expansion_PreDev_Audit_Report.md)
- [Tone_V2_Phase6_Model_Improvement_PreDev_Code_Audit_Report.md](./Tone_V2_Phase6_Model_Improvement_PreDev_Code_Audit_Report.md)
- **代码锚点：** `train_tone_cnn.py` · `mel.py` · `contract.py` · `backends/numpy_p0.py` · `offline_tone_eval.py`

**证据产物：**

- `tone_module/models/phase7c_train.log`
- `tone_module/models/tone_cnn_p3_offline_eval.json`
- `tone_module/models/tone_cnn_p3_validate.json`

---

## Executive Summary

| 审计问题 | 结论 |
|----------|------|
| `tone_cnn_p3` 训练 / Artifact / 冻结层是否合规？ | **是** — Phase 7-C **PASS**；零 Foundation 漂移 |
| 57.38% 是否等于「模型训练失败」？ | **否** — Artifact 验收通过；指标为 **Canonical + speaker holdout** 下的真实难度 |
| 与 p1 的 73.2% 是否可直接对比？ | **否** — p1 为 **data_mini · utterance holdout · n=1,808**；p3 为 **AISHELL-3 · speaker holdout · n=147,312** |
| 主要瓶颈归属 | **模型表达能力 + Feature 表征（时序坍缩）为主**；训练策略次之；数据层 / 评估协议为混淆因子 |
| 是否过拟合？ | **否** — train 58.0% vs val 57.4%（Δ≈0.6%） |
| 是否欠拟合 / 已达当前结构平台？ | **是** — epoch 10 后 val 平台；train 亦仅 ~58% |
| 继续 100 Epoch 是否有意义？ | **否**（证据充分） |
| 7-D 应改冻结层吗？ | **禁止** — 所有改进须在 **Model Capability Layer** |

### Final Verdict: **CONDITIONAL PASS**

**含义：** Phase 7-D **可以且应当启动**，但须满足：

1. **仅**修改 Model Capability（训练循环 / 损失 / 同 `p0-v1` 下 MLP 容量 / 新 `modelVersion` 权重）。
2. **不得**将 p1 的 73.2% 作为 p3 的单一直接对标；7-D 首轮须建立 **AISHELL speaker-holdout 可比基线**（见 Required Improvement Matrix）。
3. **优先**低成本训练策略实验，再评估更深 MLP；**真正 CNN/CRNN** 须新 `featureVersion` 或帧级特征路径 + **Contract 再冻结**（非 7-D 默认首选项）。

---

## Training Curve Analysis

### 证据（`phase7c_train.log`）

| Epoch | train_acc | val_acc | Δ(train−val) |
|-------|-----------|---------|--------------|
| 1 | 0.523 | 0.517 | 0.006 |
| 10 | 0.576 | 0.567 | 0.009 |
| 20 | 0.576 | 0.565 | 0.011 |
| 30 | 0.580 | **0.571** | 0.009 |
| 40 | 0.578 | 0.567 | 0.011 |
| 50 | 0.578 | 0.567 | 0.011 |
| **Best checkpoint** | **0.580** | **0.574** | **0.006** |

**墙钟：** 164,985 s（≈45.8 h）· 50 epoch · ≈55 min/epoch

### 审计结论

| 问题 | Expected | Actual | 裁决 | Evidence |
|------|----------|--------|------|----------|
| 提前收敛？ | epoch 10 后增益趋零 | epoch 10 val=0.567 → epoch 50 val=0.567 | **是** | 日志 6 个检查点 |
| 欠拟合？ | train >> val 才为过拟合 | train≈val，train 仅 58% | **是（欠拟合/容量顶）** | best train 0.580 vs val 0.574 |
| 过拟合？ | train−val 显著拉大 | Δ≤0.011 | **否** | 同上 |
| 继续增 Epoch？ | 平台后无显著提升 | epoch 30 峰值 0.571 ≈ best 0.574 | **无意义** | 40–50 epoch 无改善 |
| Loss 曲线？ | 应记录 loss 辅助判断 | **未记录** | **评估缺口** | `train_tone_cnn.py` 仅 `_accuracy` |

### 处置（Training Strategy · 观测）

| 项 | Action | 说明 |
|----|--------|------|
| 50→100 Epoch | **DELETE**（不建议） | 平台已现；浪费 ~45h+ |
| 记录 Loss | **MODIFY** | 7-D 训练可观测性 |
| Early Stopping | **MODIFY** | 可在 ~epoch 15 停止（节省算力，不提升 best） |
| Best Checkpoint | **KEEP** | 已实现 `_train_mlp_from_reader` best-val 保存 |

---

## Confusion Matrix Analysis

### 证据（`tone_cnn_p3_offline_eval.json` · n=147,312）

|  | pred t1 | pred t2 | pred t3 | pred t4 | pred t5 |
|--|---------|---------|---------|---------|---------|
| **true t1** | 20,608 | 4,414 | 346 | 6,594 | 278 |
| **true t2** | 3,146 | 19,923 | 3,560 | 7,303 | 648 |
| **true t3** | 988 | 5,333 | **7,930** | **8,454** | 397 |
| **true t4** | 5,528 | 6,428 | 4,143 | **33,042** | 540 |
| **true t5** | 603 | 1,522 | 830 | 1,727 | **3,027** |

### Per-Class 指标

| 声调 | Precision | Recall | Support | Val 占比 |
|------|-----------|--------|---------|----------|
| t1 | 0.6675 | 0.6392 | 32,240 | 21.9% |
| t2 | 0.5296 | 0.5761 | 34,580 | 23.5% |
| t3 | 0.4718 | **0.3433** | 23,102 | 15.7% |
| t4 | 0.5785 | 0.6651 | 49,681 | **33.7%** |
| t5 | 0.6190 | **0.3927** | 7,709 | **5.2%** |

### 与 p1（data_mini · 同结构）对照

| 声调 | p1 Recall（n=1,808） | p3 Recall（n=147,312） | Δ |
|------|----------------------|------------------------|---|
| t1 | 77.8% | 63.9% | −13.9pp |
| t2 | 75.0% | 57.6% | −17.4pp |
| t3 | 60.9% | **34.3%** | **−26.6pp** |
| t4 | 75.9% | 66.5% | −9.4pp |
| t5 | 58.8% | **39.3%** | −19.5pp |

> **注：** 两列 **评估协议不同**（utterance vs speaker · mini vs full），不可归因于单一因素；但 **t3/t5 弱势在两种协议下均存在**，指向模型/特征瓶颈而非纯评估差异。

### t3 / t5 低 Recall 根因分解

| 假设 | Expected | Actual | Impact | 裁决 |
|------|----------|--------|--------|------|
| **类别不平衡** | t5 极少 → recall 崩 | t5 占 5.2%（全量 AISHELL t5≈6.1%）；t3 占 15.7% 非极少 | 中等 | **部分成立**（t5）；**不足以单独解释 t3** |
| **t3↔t2/t4 音系混淆** | CM 非对角 mass 高 | t3→t4 **8,454** + t3→t2 **5,333** vs 正确 7,930 | **高** | **成立** |
| **t5↔t4 混淆** | 轻声被判去声 | t5→t4 1,727 + t5→t2 1,522 | **高** | **成立** |
| **模型容量不足** | 欠拟合 + 混淆广泛 | train 仅 58%；全类 recall 普降 | **高** | **成立** |
| **Feature 时序丢失** | 均值 mel 无法分声调轮廓 | `mel.py` 仅 `mel.mean(axis=1)` → 80 维 | **高** | **成立**（见 §Feature） |
| **数据标注错误** | join/对齐失败 | P7-A join 100%；无 7-C 数据门失败 | 低 | **非主因** |
| **评估统计错误** | offline 与 train 不一致 | offline 0.5738 = adapter_acc 0.5738 | 无 | **否** |

### 置信度分布（p3）

| 指标 | p3 | p1（对照） |
|------|-----|------------|
| confidence_mean | **0.576** | **0.763** |
| 0.3–0.5 区间样本 | 56,404（38.3%） | 极少 |

**解读：** p3 整体 **更不确定**；非 posterior collapse（`posterior_mean` 五类均有质量），而是 **判别边界模糊** — 与欠拟合/特征不足一致。

---

## Model Capacity Analysis

### 当前结构（代码事实）

```375:378:electron_node/services/faster_whisper_vad/tone_module/train_tone_cnn.py
    w1 = rng.normal(0, 0.05, size=(contract.P0_N_MELS, contract.P0_HIDDEN)).astype(np.float32)
    ...
    w2 = rng.normal(0, 0.05, size=(contract.P0_HIDDEN, contract.P0_N_CLASSES)).astype(np.float32)
```

| 项 | 值 |
|----|-----|
| 架构 | **80 → 32 → 5** ReLU MLP |
| 参数量 | **≈2,757**（含 bias） |
| 名称 | `tone_cnn` / `train_tone_cnn` |
| 实际 | **无卷积、无循环** — 命名与实现不符 |
| Runtime 路径 | `numpy_p0.infer_batch` — 与训练同式 |

### 是否适合 Canonical Tone Model？

| 维度 | 裁决 | Evidence |
|------|------|----------|
| 作为 **P0 权重容器 / 部署探针** | **KEEP** | validate_artifact PASS；Runtime adapter 一致 |
| 作为 **长期 Canonical 质量上限** | **否** | speaker holdout 57.4%；t3 recall 34%；train 平台 58% |
| 是否已达 **当前 MLP 能力上限** | **是（近似）** | epoch 10 后无结构内突破；欠拟合非过拟合 |
| 更深 MLP（同 80 维输入） | **MODIFY** — 7-D 可试 | 不改 `featureVersion` / adapter 形状契约 |
| 真正 CNN | **MODIFY** — 需帧级特征 | 80 维均值向量 **无时间轴**，无法做 meaningful conv |
| CRNN | **MODIFY** — 新阶段 | 需 `train_tone_crnn` + 新 backend；[Phase 6 审计](./Tone_V2_Phase6_Model_Improvement_PreDev_Code_Audit_Report.md) 已预判 |

---

## Feature Analysis

### p0-v1 Feature 定义（冻结）

```54:80:electron_node/services/faster_whisper_vad/tone_module/mel.py
def extract_mel_features(audio: np.ndarray, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    """Return (N_MELS,) mean-pooled log-mel vector for one word slice."""
    ...
    return mel.mean(axis=1).astype(np.float32)
```

| 检查 | Expected | Actual | Impact |
|------|----------|--------|--------|
| 维度 | 80-dim log-mel | `P0_N_MELS=80` | 符合契约 |
| 时序 | 声调依赖 F0 轮廓 | **时间轴被 mean 池化销毁** | **声调判别信息丢失** |
| Train / Runtime 一致 | 同源 `extract_mel_features` | Feature Shard 与 `inference.py` 同函数 | **KEEP** |
| 修改 Feature Baseline | 须再冻结 | 无证据表明标注错误是主因 | **KEEP p0-v1**（7-D 默认）；帧级特征 = **新 featureVersion 子阶段** |

### Feature 是否「不足」？

**是 — 对五类声调细粒度判别而言，均值池化 80 维向量是结构性上限。**  
但这属于 **Feature Baseline 设计边界**，不是 Phase 7-C 训练 bug。7-D 在 **不修改 p0-v1** 前提下，只能做 MLP 容量与训练策略优化；要突破须 **p1-v2（帧级 mel）+ Contract 再冻结**（非 7-D 默认路径）。

---

## Training Strategy Analysis

| 策略 | 代码现状 | 建议 | Action | Expected | Actual | Impact |
|------|----------|------|--------|----------|--------|--------|
| **Early Stopping** | 无；固定 50 epoch | epoch ~15 后可停 | **MODIFY** | 省 ~30h | 平台 epoch 10 | 算力；不升 accuracy |
| **Best Checkpoint** | `best_val_acc` 追踪保存 | 保持 | **KEEP** | 避免末 epoch 退化 | best 0.574 > ep50 0.567 | 已实现 |
| **记录 Loss** | 仅 `_accuracy` | 增加 CE loss 日志 | **MODIFY** | 可观测收敛 | 无 loss 数据 | 审计盲区 |
| **LR Schedule** | 固定 `lr=0.05` | step/cosine decay | **MODIFY** | 平台后微调 | 无 decay | 可能 +1–3pp（待验） |
| **Class Weight** | 无 | `1/freq` 或 effective number | **MODIFY** | 提升 t5/t3 recall | t5 recall 39% | **中–高** |
| **Focal Loss** | 无 | γ=2 可选 | **MODIFY**（次选） | 难例聚焦 | 高混淆 t3 | 中 |
| **Data Augmentation** | 无 | spec augment / noise | **MODIFY**（低优先） | 泛化 | 未验证 | 低（均值 mel 上收益有限） |
| **Speaker holdout** | Canonical 默认 | 保持 | **KEEP** | 真实泛化 | 57% vs mini 73% | 难度正确 |

---

## Root Cause Matrix

| # | 根因 | 层级 | Severity | Evidence | 7-D 可触达？ |
|---|------|------|----------|----------|--------------|
| RC-01 | **均值 mel 丢失时序** — 声调轮廓不可分 | Feature / Model | **CRITICAL** | `mel.py` mean pool；t3↔t2/t4 混淆 | 仅换 MLP：**部分**；根治需新 featureVersion |
| RC-02 | **MLP 容量过小 + 欠拟合** | Model | **HIGH** | 2.7k params；train 58%≈val | **是** — 加深加宽 |
| RC-03 | **训练策略未针对不平衡/难例** | Training Strategy | **MED** | 无 class weight；固定 lr | **是** |
| RC-04 | **评估协议升级导致指标不可与 p1 直比** | Evaluation | **MED** | mini utterance 73% vs AISHELL speaker 57% | **是** — 建立可比基线 |
| RC-05 | **epoch 超训无收益** | Training Strategy | **LOW** | epoch 10≈50 | **是** — early stop |
| RC-06 | **数据对齐/规模** | Data | **LOW** | P7-A PASS；997k 已用 | **KEEP** Dataset Foundation |
| RC-07 | **指标/Artifact 错误** | Evaluation | **NONE** | offline=adapter_acc；validate PASS | **排除** |

**主瓶颈排序（证据加权）：**

1. **Feature 表征（p0-v1 时序坍缩）+ 小 MLP 表达能力** — 模型/特征层  
2. **训练策略（无 class weight · 固定 lr · 无 loss 观测）** — 廉价下一跳  
3. **评估可比性混淆** — 非模型坏，而是 **预期锚点错误**  
4. **数据层** — **非主因**（已冻结验收）

---

## Required Improvement Matrix（Phase 7-D 建议路线）

| 优先级 | 代号 | 内容 | Action | 触达文件（预期） | 冻结层？ | 预期收益 |
|--------|------|------|--------|------------------|----------|----------|
| **P0** | 7-D0 | **AISHELL speaker-holdout 可比基线** — 同协议记录 p1 结构在 mini 与 AISHELL 上的差距 | **MODIFY**（评估脚本/报告） | `offline_tone_eval` 接线 · 文档 | 否 | 消除错误预期 |
| **P1** | 7-D1 | **训练策略包**：class weight + LR decay + loss 日志 + early stopping | **MODIFY** | `train_tone_cnn.py`（Model Capability） | 否 | +2–5pp val（待验） |
| **P2** | 7-D2 | **加深 MLP**（80→128→64→5 等）· 新 `modelVersion` `tone_cnn_p4` | **MODIFY** | `train_tone_cnn.py` · 新 npz | 否（同 p0-v1） | +2–5pp（待验） |
| **P3** | 7-D3 | **7-D1+7-D2 组合** · Canonical 50 epoch（或 early stop） | **MODIFY** | 同上 | 否 | 累计待验 |
| **P4** | 7-D4 | **帧级 mel + 真 CNN** · 新 `featureVersion` | **MODIFY** + **Contract 再冻结** | `mel.py` · `contract.py` · 新 backend | **是（须再冻结）** | 潜在大；非 7-D 首跳 |
| **P5** | 7-D5 | **CRNN** | **MODIFY** | `train_tone_crnn.py` 等 | 新实例 + 再冻结 | 长期 |
| — | — | 100 Epoch 续训 | **DELETE** | — | — | 无证据支持 |
| — | — | 修改 Dataset / Shard / Runtime | **禁止** | — | 冻结 | — |

---

## Frozen Architecture Verification

| 冻结域 | 7-D 方案是否触碰 | 结果 |
|--------|------------------|------|
| Runtime / FW / Node E2E | 否 | **合规** |
| `contract.py` Required Schema | 7-D 默认不修改 | **合规** |
| `mel.py` p0-v1 语义 | 7-D1–3 不修改；7-D4 例外须再冻结 | **合规（分阶段）** |
| `loader.py` / `numpy_p0` | 同 shape 权重不改 adapter | **合规** |
| Dataset Foundation | 不修改 | **合规** |
| Training Engineering | 复用 Shard Reader 链；不改 schema | **合规** |
| `validate_artifact` 语义 | 不修改门禁逻辑 | **合规** |
| Artifact Contract | 同 `npz-v1` + `p0-v1` + `numpy_p0` | **合规** |

---

## Architecture Drift Audit

| 处置 | 项 |
|------|-----|
| **KEEP** | Feature Shard → Reader → Training IO 链 |
| **KEEP** | `p0-v1` Feature Baseline（7-D 默认阶段） |
| **KEEP** | `numpy_p0` Runtime adapter（同结构权重） |
| **KEEP** | Best-val checkpoint 逻辑 |
| **KEEP** | Speaker holdout Canonical 评估 |
| **MODIFY** | `train_tone_cnn.py` 训练策略 / MLP 深度（Model Capability） |
| **MODIFY** | 离线评估可比基线 / 报告指标 |
| **MODIFY**（后续子阶段） | 帧级特征 · 真 CNN · CRNN · 新 backend |
| **DELETE** | 100 epoch 续训方案 |
| **RESTORE** | 文档中「tone_cnn = CNN」命名 → 明确 **P0 MLP**（术语） |

**Material Drift（本轮审计）：无代码修改**

---

## Remaining Risks

| 风险 | 严重度 | 缓解 |
|------|--------|------|
| 7-D 仅调策略仍卡在 ~60% | HIGH | 接受后进入 7-D4 特征/架构子阶段 |
| 与 p1 73% 错误对标导致错误 RESTORE | MED | 7-D0 可比基线 |
| 加深 MLP 仍无法分 t3 | MED | CM 驱动；准备 featureVersion 路线 |
| 改 `mel.py` 误触 Contract | HIGH | 7-D4 单独再冻结；默认不做 |
| Runtime 未验证 p3 | MED | 质量达标后再 `TONE_MODEL_PATH` 阶段 |

---

## 终局问答

### 1. 57.38% Accuracy 的主要瓶颈是什么？

**主瓶颈：p0-v1 均值池化 mel（时序信息丢失）+ 80→32→5 极小 MLP 的表达能力不足，表现为欠拟合（train≈58%）及 t3/t5 对 t2/t4 的系统性混淆。**  
次要：无 class weight / 固定 lr。  
**非主因：** 数据对齐（P7-A PASS）、Artifact/指标错误、纯类别不平衡（t3 样本充足仍 recall 34%）。

### 2. 继续训练到 100 Epoch 是否有意义？

**否。** epoch 10 val 0.567 与 epoch 50 val 0.567 相同；best val 0.574 出现在中间 checkpoint。继续训练仅浪费算力（约 +45h），无证据支持提升。

### 3. 当前 MLP 是否已经达到能力上限？

**是（在 p0-v1 80 维均值特征前提下，近似已达上限）。** train/val 双平台 ~57–58%，且非过拟合，说明结构内可学信息已榨取殆尽。

### 4. 是否应该升级为真正 CNN？

**长期：是；Phase 7-D 默认首跳：否。**  
当前输入是 **(80,)** 向量而非 **(T, mel)** 谱图，`train_tone_cnn` **无卷积层**。真 CNN 需 **帧级 mel** → 新 `featureVersion` + Contract 再冻结 + 新训练/adapter 路径。

### 5. 是否应该升级为 CRNN？

**长期：是（声调时序建模自然方向）；7-D 立即上 CRNN：否。**  
[Phase 6 审计](./Tone_V2_Phase6_Model_Improvement_PreDev_Code_Audit_Report.md) 已裁定 CRNN 须新训练入口与新 backend；应在 **p0-v1 MLP 策略/容量耗尽后** 且 **帧级特征就绪后** 启动子阶段。

### 6. 是否应该先优化训练策略再改模型？

**是 — 推荐顺序：7-D0 可比基线 → 7-D1 训练策略（class weight · lr · loss · early stop）→ 7-D2 加深 MLP → 再评估是否进入 7-D4/7-D5。**  
理由：成本低、不改冻结 Feature/Contract、可快速验证是否仍有同特征下的增益空间。

### 7. 下一阶段模型能力提升的优先级应该是什么？

```text
P0  建立 AISHELL speaker-holdout 可比评估（避免错误锚点）
P1  训练策略包（class weight · LR schedule · loss 日志 · early stopping）
P2  同 p0-v1 下加深 MLP → tone_cnn_p4
P3  组合实验 + Offline Eval 回归
P4  帧级 mel + 真 CNN（新 featureVersion · Contract 再冻结）
P5  CRNN + 新 backend
```

**禁止：** 修改 Dataset Foundation · Training Engineering IO · Runtime · 盲目 100 epoch。

---

## Final Verdict

### **CONDITIONAL PASS**

Phase 7-D **开发前审计通过**：根因已用训练日志、离线 CM、代码锚点交叉定位；能力提升路线明确归属 **Model Capability Layer**，不触碰冻结 Foundation。

**生效条件：**

1. 7-D 实施须遵守 Frozen Architecture Verification（上表）。  
2. 不得以 p1@data_mini 73% 直接否定 p3@AISHELL 57% — 须完成 **7-D0 可比基线**。  
3. **禁止** 100 epoch 续训作为默认方案。  
4. 真 CNN / CRNN / Feature Baseline 变更 **不属于** 7-D 默认范围，须单独立项 + 再冻结。

---

*Phase 7-D Pre-Development Audit — read-only · no code / training / Runtime executed.*
