<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/Tone_Model_V3_Recognition_Ceiling_Audit_2026_07_13.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# Tone Model V3 Recognition Ceiling Audit

**Date:** 2026-07-13  
**Audit Type:** Tone Recognition Ceiling Audit（识别能力上限审计 · 只读）  
**Evidence JSON:** `electron_node/services/faster_whisper_vad/tone_module/models/candidate/ceiling_audit_analysis_20260713.json`  
**Frozen Scope:** FW · Node · Runtime · Feature `(64,83)` · `p1-frame-mel-f0-v1` · Dataset Split · Artifact Contract · WordInfo · AcousticToneSlice · Recall · Lexicon · KenLM · CRNN Architecture

---

## Executive Summary

| 模型 | val_acc | Δ vs 前一阶段 |
|------|--------:|--------------:|
| Tiny CNN（P9-A） | **71.44%** | — |
| CNN V2（P9-B） | **82.48%** | **+11.04 pp** |
| CRNN V3 Full | **83.56%** | **+1.08 pp** |

**裁决：** CRNN 在冻结 Feature / Label / Dataset 条件下已接近当前管线的**可辨识上限**。收益递减的主因不是模型容量，而是 **Label 与声学现实不一致（变调未入标注）**、**t3/t5 类内高混淆**、以及 **Feature 对 Neutral Tone / 低 F0 覆盖不足**。继续扩大 CRNN hidden size **预计 <1 pp**，不值得作为主投入方向。

**下一阶段唯一建议：** **A — 改善 Label**（变调感知标注或标注一致性审计），而非继续堆叠 CRNN 或修改 Runtime。

---

## 一、冻结范围确认

本轮未修改、未讨论重新设计：

- FW / Node / Runtime
- Feature Shape `(64, 83)` · Feature Version `p1-frame-mel-f0-v1`
- Dataset Split（speaker holdout · seed=42 · val_ratio=0.15）
- Artifact Contract · WordInfo · AcousticToneSlice
- Recall · Lexicon · KenLM
- CRNN Architecture `conv1d_bigru_v1`（227,013 params）

---

## 二、核心问题：为何收益递减？

```
Tiny CNN  71.44%
    ↓  +11.04 pp   ← 架构升级（14K→~200K）+ 更深 CNN + 同 Feature 下首次吃满帧级 mel+F0
CNN V2    82.48%
    ↓  +1.08 pp    ← 时序建模（BiGRU）在已饱和 Feature/Label 上边际收益极小
CRNN      83.56%
```

| 阶段 | 主要增益来源 | 为何有效 |
|------|-------------|---------|
| Tiny → V2 | 模型容量 + 深度 + 训练配方（AdamW/Cosine/AMP） | 71% 段模型严重 under-capacity；帧级 83 通道 Feature 首次被足够深的 CNN 利用 |
| V2 → CRNN | BiGRU 时序聚合 | Pilot 同子集 +3.49 pp，但全量仅 +1.08 pp — **全量 val 已进入平台期** |

**Pilot vs Full 对比（同架构 CRNN）：**

| 设置 | CNN V2 | CRNN | Δ |
|------|-------:|-----:|--:|
| Pilot 80k/15k 前缀子集 | 60.41% | 63.89% | **+3.49 pp** |
| Full 850k/147k | 82.48% | 83.56% | **+1.08 pp** |

说明：时序建模在**低精度区间**帮助大，在 **83%+ 平台**帮助有限 — 瓶颈已转移至数据/标注/特征信息上限，而非缺 BiGRU。

---

## 三、Label Ceiling（标注上限）

### 3.1 标注来源

标签来自 lars76 MFA TextGrid 拼音 token，经 `tone_label_from_pinyin()` 解析：

```27:34:electron_node/services/faster_whisper_vad/tone_module/dataset/alignment_textgrid.py
def tone_label_from_pinyin(token: str) -> Optional[int]:
    match = PINYIN_TONE_RE.match(token.strip().lower())
    if not match:
        return None
    tone_num = int(match.group(2))
    if tone_num < 1 or tone_num > 5:
        return None
    return tone_num - 1
```

**关键事实：** Label = TextGrid 中的**词典调值**（citation tone），**不处理**：

| 变调类型 | 是否反映在 Label | 影响 |
|---------|-----------------|------|
| 第三声变调（半三声、三三变调） | ❌ | 声学呈 t2/t4，标注仍为 t3 |
| 「一」「不」变调 | ❌ | 声学调型与词典调号不一致 |
| 连读变调 | ❌ | 边界音节调型受上下文影响 |
| Neutral Tone（轻声） | ⚠️ 部分 | 依赖 TextGrid 是否标为 `*5`；质量参差 |

### 3.2 可量化 Label Noise 代理

**不得直接测量「人工标注错误率」**（无独立金标准），但可用 **混淆模式 + 错误审计** 估计下界：

| 证据 | 数值 | 解读 |
|------|------|------|
| t3↔t4 双向混淆（CRNN 全量 val） | **6,520** 条（t3→t4: 3,112 · t4→t3: 3,408） | 占 val 错误 **26.9%**；与三声变调/半三声高度一致 |
| 20k 错误样本中「Sandhi_Like_Confusion」 | **33.48%** | 声学调型更像邻调，标注仍为原调 |
| t1→t4（CRNN） | **1,710**（5.3% of t1） | 一声连读变调 / 边界 F0 平坦 |
| t5→其他（CRNN） | **1,924**（24.9% of t5 全错） | 轻声本身无固定 F0 轮廓，词典标 5 与声学不对齐 |
| TextGrid 非拼音 token（P7-A） | **3,456,456** intervals 已跳过 | 说明原始 tier 含大量 MFA 音素噪声；拼音层仍可能有边界量化误差 |

**P8 边界量化（间接 Label 噪声）：**

- duration < 40 ms：**411** 条（0.041%）— TextGrid 30 ms 步进
- duration < 60 ms：**1,332** 条（0.133%）

来源：`Tone_V2_P8_FeatureV2_Syllable_Duration_Frame_Length_Audit_Report.md`

### 3.3 Label Noise 估计（有依据的下界）

| 错误类别 | 占 val 错误比例（20k 审计） | 更像 Label 还是 Model |
|---------|---------------------------|----------------------|
| Sandhi_Like_Confusion | 33.5% | **Label**（变调未编码） |
| Neutral_Tone | 11.5% | **Label + Feature** |
| F0_Missing | 2.9% | Feature（非 Label） |
| Feature_Ambiguous | 6.2% | Feature |
| Genuine_Model_Error | 45.9% | Model（但在 sandhi 存在时部分实为 Label） |

**保守估计：** 当前 val 错误率 **16.44%**（147,312 × (1−0.8356) ≈ **24,218** 条）中，**≥30%**（~7,300 条，**≈5.0 pp acc**）与变调/轻声标注不一致直接相关。  
**Label 噪声下界：~5 pp accuracy**（在不变 Feature / 不重训的前提下，仅靠「修正标注定义」即可释放的上限空间）。

---

## 四、Feature Ceiling（特征信息上限）

### 4.1 当前 64×83 通道构成

```149:165:electron_node/services/faster_whisper_vad/tone_module/feature_v2.py
def _assemble_raw_tensor(audio: np.ndarray) -> np.ndarray:
    mel_frames = _compute_log_mel_frames(audio)
    n_frames = mel_frames.shape[0]
    log_f0, voiced = _compute_f0_tracks(audio, n_frames)
    delta = _delta_log_f0(log_f0, voiced)
    channels = np.concatenate(
        [
            mel_frames,
            log_f0[:, None],
            delta[:, None],
            voiced[:, None],
        ],
        axis=1,
    )
```

| 通道 | 索引 | 内容 | 时间分辨率 |
|------|------|------|-----------|
| Mel | 0–79 | log10 mel · 80 bins | hop=160 @ 16kHz → **10 ms/帧** |
| log F0 | 80 | 帧级自相关 F0 | 同上 |
| Δlog F0 | 81 | 相邻有声帧差分 | 同上 |
| voiced | 82 | 有声标志 | 同上 |

**固定 64 帧 ≈ 640 ms 窗口**（含 duration-normalized 线性插值）。

### 4.2 信息丢失与不足

| 项目 | 状态 | 证据 |
|------|------|------|
| F0（log_f0） | ✅ 有 | ch_std=**0.710**（4096 val 样本） |
| ΔF0 | ⚠️ 弱 | ch_std=**0.043** — 远低于 mel（1.079）；大量 unvoiced 帧 delta=0 |
| ΔΔF0 | ❌ 无 | 未实现 |
| F0 平滑 | ⚠️ 无显式平滑，但 unvoiced 置零造成不连续 | `P1_F0_DELTA_UNVOICED = zero` |
| Neutral Tone 信息 | ❌ 不足 | t5 依赖短促/弱能量，当前 F0 通道对轻声区分力弱 |
| 时间过短 | ⚠️ 边缘 | <60 ms 占 0.13%；插值到 64 帧放大噪声 |
| F0 截断 | ⚠️ | `P1_F0_MAX_HZ=500`；男声高音区可能截断 |

### 4.3 训练中的通道贡献（只读 Ablation）

对 `conv1_w (96, 83, 5)` 按输入通道 L2 范数分解（CRNN 与 CNN V2 一致）：

| 通道组 | 权重占比 | Feature std（4096 样本） | 结论 |
|--------|---------|-------------------------|------|
| Mel（80ch） | **~89.9%** | mean std **1.079** | 主导判别 |
| log F0 | **~2.0%** | std **0.710** | 有信息，但权重低 |
| Δlog F0 | **~5.7%** | std **0.043** | **输入极弱**；模型虽提高权重，信号本身近乎常数 |
| voiced | **~2.4%** | std **0.308** | 辅助 |

**低方差通道：** 10/83 通道 std < 0.05（主要为插值后平坦帧的 mel 子带）。

**结论：** Feature 对 **t1/t2/t4 高调型轮廓** 信息足够；对 **t3 曲拱**、**t5 轻声** 信息不足。瓶颈不在「64 帧太短」（99.97% 样本无 crop），而在 **F0 导数弱 + 无 ΔΔ + 轻声无稳定 F0**。

---

## 五、Dataset Ceiling（数据集上限）

### 5.1 规模与划分

| 指标 | 值 | 来源 |
|------|-----|------|
| 总样本 | **997,992** | cache manifest |
| Train / Val | **850,680 / 147,312** | split_meta |
| Speaker 总数 | **218**（43 男 / 175 女） | P7-A / P6E |
| Train / Val speakers | **186 / 32** | ceiling_audit_analysis |
| Holdout | **speaker** | split_meta |

### 5.2 五类分布（cache 实测 · 与 P7-A 一致）

**全量：**

| 类 | 计数 | 占比 |
|----|-----:|-----:|
| t1 | 210,316 | 21.07% |
| t2 | 235,097 | 23.56% |
| t3 | 160,857 | 16.12% |
| t4 | 330,934 | 33.16% |
| t5 | 60,788 | **6.09%** |
| **合计** | **997,992** | 100% |

**Val 集（speaker holdout · 实测）：**

| 类 | 计数 | 占比 |
|----|-----:|-----:|
| t1 | 32,240 | 21.89% |
| t2 | 34,580 | 23.47% |
| t3 | 23,102 | 15.68% |
| t4 | 49,681 | 33.73% |
| t5 | 7,709 | **5.23%** |

### 5.3 类别不平衡影响

| 问题 | 严重度 | 证据 |
|------|--------|------|
| t4 过多（33%） | 中 | 模型略偏 t4；t3→t4 混淆 1,710+3,112 |
| t3 最少（除 t5） | 中 | t3 recall **76.86%** — 全类最低之一 |
| t5 严重不足（~5%） | **高** | t5 recall **75.04%**；7,709 val 样本 vs t4 的 49,681 |
| Speaker holdout | **高** | 32 未见说话人 — 泛化难度下限 |

**不存在**「样本量不足」问题（百万级）；存在 **t5 长尾** 与 **speaker 域偏移** 问题。

---

## 六、Confusion Analysis（CRNN 全量 val · 147,312）

### 6.1 Confusion Matrix（row=true · col=pred）

```
           t1      t2      t3      t4     t5
t1      27789    2086     567    1710     88
t2       1641   29501    2195     943    300
t3        328    1640   17757    3112    265
t4       2317    1265    3408   42267    424
t5        147     489     561     727   5785
```

**val_acc = 123,099 / 147,312 = 83.56%**

### 6.2 Per-class Recall

| 类 | CRNN | CNN V2 | Δ |
|----|-----:|-------:|--:|
| t1 | 86.19% | 85.20% | +0.99 pp |
| t2 | 85.31% | 83.60% | +1.71 pp |
| t3 | **76.86%** | **73.80%** | +3.06 pp |
| t4 | 85.08% | 85.10% | −0.02 pp |
| t5 | **75.04%** | **75.10%** | −0.06 pp |

### 6.3 重点混淆对

| 混淆 | 数量 | 占该类错误 | 更像 Label 还是 Model |
|------|-----:|-----------:|----------------------|
| **t3→t4** | 3,112 | 13.5% | **Label**（三声变调呈降调） |
| **t4→t3** | 3,408 | 6.9% | **混合**（CRNN 比 V2 恶化 +182） |
| **t2→t3** | 2,195 | 6.4% | Model + 连读 |
| **t1→t4** | 1,710 | 5.3% | **Label**（一声变调） |
| **t4→t1** | 2,317 | 4.7% | Model |
| **t5→t4** | 727 | 9.4% of t5 | **Label+Feature**（轻声→降调） |
| **t5→t3** | 561 | 7.3% of t5 | **Label+Feature** |

**CRNN 改善：** t3→t4 **−450**（时序对曲拱略有帮助）  
**CRNN 未改善：** t4→t3 **+182** · t5 持平 — 平台期标志

---

## 七、Error Case Audit（120 条明细 + 20k 统计）

**方法：** seed=42 随机抽 20,000 val 样本 · NumPy CRNN 推理 · 启发式分类（只读）

### 7.1 错误类型分布（n=3,268 错误 / 20k）

| 类别 | 数量 | 占比 |
|------|-----:|-----:|
| Genuine_Model_Error | 1,501 | 45.93% |
| Sandhi_Like_Confusion | 1,094 | **33.48%** |
| Neutral_Tone | 375 | 11.47% |
| Feature_Ambiguous | 204 | 6.24% |
| F0_Missing | 94 | 2.88% |

### 7.2 正确 vs 错误样本 Feature 对比

| 指标 | 正确 | 错误 | Δ |
|------|-----:|-----:|--:|
| voiced_frac mean | 0.8748 | 0.8616 | −0.013 |
| unvoiced_frac mean | 0.1252 | 0.1384 | +0.013 |

错误样本有声比例略低，但差距不大 — **F0 缺失不是主因**。

### 7.3 典型错误样例（节选）

| global_index | true | pred | voiced_frac | 分类 |
|-------------:|------|------|------------:|------|
| 893319 | t3 | t4 | 1.00 | Sandhi_Like — F0 完整仍判 t4 |
| 855563 | t1 | t4 | 1.00 | Sandhi_Like — 低调型 |
| 944847 | t5 | t2 | 1.00 | Neutral — f0_range=0.0055 极平 |
| 965340 | t5 | t4 | 0.91 | Neutral — 轻声被判降调 |
| 898220 | t3 | t4 | 0.44 | F0_Missing — 56% unvoiced |

完整 120 条见 Evidence JSON `error_samples`。

---

## 八、Upper Bound Estimation（理论上界）

**方法：** 基于错误分解 + 学习曲线平台 + Pilot/Full CRNN 边际，**非猜测**。

| 上限场景 | 估计 acc | 依据 |
|---------|---------:|------|
| **当前冻结管线实际上界** | **~85–86%** | best val 83.56% + train/val gap 中可泛化部分 ≤1.5 pp；val loss epoch 19–27 平台 |
| **修正变调 Label（A）** | **~88–89%** | Sandhi 类错误占 ~33.5% × 16.44% err ≈ **+5.5 pp** 理论上限（部分不可分） |
| **Label + Feature（A+B）** | **~89–90%** | 再加 t5 F0/能量特征 +1–2 pp |
| **Label + Feature + 数据（A+B+C）** | **~90–92%** | 更多轻声/变调标注数据 · 仍受 speaker holdout 限制 |
| **95%** | **不可达** | 无 sandhi 一致标注 + 单音节切片 + 218 speaker 条件下，未见证据支持 |

**区间总结：**

```
83%  ← 当前 CRNN（实测）
85%  ← 同管线调参/略扩模型（边际 <1 pp）
87%  ← 仅 Label 修正（变调一致）
90%  ← Label + Feature 协同（需新 featureVersion · 本轮冻结外）
95%  ← 当前 Dataset/Label 定义下不支持
```

---

## 九、Feature Ablation（只读 · 训练后权重）

| 特征 | 参与训练 | 有效贡献 | 原因 |
|------|---------|---------|------|
| Mel 80ch | ✅ | **高（~90% conv1 权重）** | 谱形携带调型主信息 |
| log F0 | ✅ | 中低（~2% 权重 · std 0.71） | 有声段有区分力 |
| Δlog F0 | ✅ | **名义有、实际弱** | std=0.043 · unvoiced 帧归零 |
| voiced flag | ✅ | 低（~2.4%） | 辅助掩码 |
| ΔΔF0 | ❌ 未实现 | — | — |
| 能量/时长 | ❌ 未入 Feature | — | t5 区分受损 |

CNN V2 与 CRNN conv1 通道权重分布几乎相同 — **CRNN 增益来自 GRU 时序，而非重新学习 Feature 权重**。

---

## 十、Learning Curve Analysis

来源：`training_metrics_crnn_full_20260713.json`

| Epoch | train_acc | val_acc | val_loss |
|------:|----------:|--------:|---------:|
| 1 | 74.43% | 78.39% | 0.585 |
| 7 | 85.45% | 82.58% | 0.491 |
| 19 | 88.52% | **83.42%** | **0.472** |
| 27（best） | 89.34% | **83.57%** | 0.474 |
| 37（stop） | **90.42%** | 83.35% | 0.489 |

| 指标 | 值 |
|------|-----|
| best_epoch | 27 |
| train−val gap（best） | **5.78 pp** |
| train−val gap（last） | **7.08 pp** |

**判定：Dataset Ceiling + Mild Overfitting（非 Underfitting）**

- train_acc 持续升至 90.4%，val_acc epoch 19 后 **±0.2 pp 振荡** — 典型 **数据/标注平台上限**
- 非严重过拟合（gap 7 pp 在 million-scale + speaker holdout 下合理）
- 非 underfitting（train 已达 90%+）

---

## 十一、是否继续扩大 CRNN？

| 方案 | 预计 Δ val_acc | 依据 | 是否值得 |
|------|---------------:|------|---------|
| hidden 96→128 | **+0.3–0.6 pp** | Full 仅 +1.08 pp over V2；Pilot +3.49 pp 在低平台 | ❌ |
| hidden 96→256 | **+0.5–0.8 pp** | val 已平台 · train 余量无法转化 | ❌ |
| 更深 GRU / 更多 epoch | **<0.3 pp** | epoch 27 后 val 下降 | ❌ |

**对照：** Tiny→V2 架构升级 +11 pp；V2→CRNN +1 pp — **边际效益递减已确认**。

---

## 十二、限制因素排序（按影响）

| 排名 | 因素 | 影响 | 关键证据 |
|------|------|------|---------|
| **1** | **Label Quality（变调未编码）** | ★★★★★ | 33.5% 错误为 Sandhi_Like；t3↔t4 占错误 26.9% |
| **2** | **Dataset Ceiling（t5 长尾 + speaker holdout）** | ★★★★☆ | t5 5.23%；32 val speakers；t5 recall 75% |
| **3** | **Feature Information（F0 导数弱 · 轻声不足）** | ★★★☆☆ | ΔF0 std=0.043；无 ΔΔ；t5 混淆 |
| **4** | **Training Objective（CE 无 sandhi 容忍）** | ★★☆☆☆ | 硬标签 CE；非主瓶颈 |
| **5** | **Model Capacity** | ★☆☆☆☆ | train 90% vs val 83.6%；扩 hidden 预计 <1 pp |

---

## 十三、下一阶段建议（唯一方向）

### 选择：**A — 改善 Label**

**理由：**

1. 最大可释放空间（~5 pp）来自 **变调一致标注** — 无需改 Runtime
2. CRNN 已证明时序建模在平台上仅 +1 pp；继续改模型 ROI 最低
3. t3/t5 混淆主因是 **标注调号 ≠ 声学调型**，非 FW/Node 问题

**具体方向（本轮不实施）：**

- 变调规则标注（三声变调 · 「一」「不」· 连读）或上下文感知 label
- TextGrid 与声学一致性审计（t3/t5 子集人工抽检）
- 轻声标注质量专项（t5 占错误 11.5%）

**不选：**

- B Feature — 需新 featureVersion（本轮冻结外）；在 Label 未修前收益次优
- C Dataset — 百万级已够；瓶颈非数量
- D Training Objective — 无法解决 label≠acoustics 根本矛盾

---

## 十四、Final Verdict

### 1. 为什么 CRNN 只有 83.56%？

因为在 **冻结的 citation-tone Label + p1-frame-mel-f0-v1 Feature + AISHELL-3 speaker holdout** 条件下，模型已将可分信息接近吃尽：train_acc **90.4%** 但 val_acc **83.6%** 平台，主要错误来自 **t3↔t4 变调不一致**（6,520 条）与 **t5 轻声**（1,924 条错分），而非 CRNN 未收敛。

### 2. 真正限制模型能力的是什么？

**Label Quality（变调标注与声学脱节）** 为首要瓶颈；其次为 **t5 数据长尾 + Feature 对轻声/F0 导数信息不足**；Model Capacity 已非主因。

### 3. 继续扩大网络是否还有意义？

**否。** 预计 hidden 128/256 仅 **<1 pp**；Pilot +3.5 pp → Full +1.1 pp 已证明收益递减。

### 4. 达到约 90% 最值得投入的方向？

**改善 Label（变调一致标注）** — 理论可释放 ~5 pp，是唯一有望从 83% 逼近 88–90% 的单点投入。若 90% 为硬目标，需 **Label + 新 Feature** 组合，但 Label 优先。

### 5. 是否建议继续开发 CRNN？

**否 — 建议进入下一阶段研究（Label / 标注一致性），而非继续迭代 CRNN。**

CRNN V3 Full Candidate 作为 **当前冻结管线下最优模型** 保留；工程上 Runtime 已 PASS，质量上已触顶。继续 CRNN 训练/扩参 **ROI 低于 Label 审计与修正**。

---

## 附录：证据索引

| 证据 | 路径 |
|------|------|
| CRNN 全量指标 | `tone_module/models/candidate/training_metrics_crnn_full_20260713.json` |
| 本轮审计分析 | `tone_module/models/candidate/ceiling_audit_analysis_20260713.json` |
| 审计脚本 | `tone_module/benchmarks/ceiling_audit_analysis.py` |
| CNN V2 基线 | `docs/tone-v2/Tone_Model_V2_CNN_Freeze.md` |
| CRNN 全量报告 | `docs/tone-v2/Tone_Model_V3_CRNN_Full_Production_Training_Report_2026_07_13.md` |
| 数据集分布 | `docs/tone-v2/Tone_V2_Phase7A_AISHELL3_Full_Dataset_Acceptance_Report.md` |
| Feature 规格 | `tone_module/feature_v2.py` · `tone_module/contract.py` |
| Label 管线 | `tone_module/dataset/alignment_textgrid.py` |

---

**Audit Verdict:** CRNN **83.56%** 为当前冻结管线的 **Recognition Ceiling**；下一阶段 **Label-first**，**停止 CRNN 扩参**。
