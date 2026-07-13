# Tone V2 Phase 6-C — Training Data Expansion 开发前审计报告

**Date:** 2026-06-29  
**Audit Type:** Read-only Pre-Development Audit（**非训练** · **非 Runtime 开发**）  
**Scope:** 评估当前 Tone 训练数据是否已成为模型质量瓶颈；审计是否可从 AISHELL-3 全量或更大子集扩展数据，以支撑后续 `tone_cnn_p3` 训练  
**禁止项（本轮）：** 训练 `tone_cnn_p3` · 生成新权重 · 修改 Runtime / Loader / Contract / Feature Baseline / Recall / Ranking / Assembly / KenLM / Apply / Service Boundary / Backend Adapter

**依据 SSOT：**

- [Tone_V2_Phase1_Freeze_Report.md](./Tone_V2_Phase1_Freeze_Report.md)
- [Tone_V2_Phase2_Foundation_Freeze_Audit_Report_2026_06_29.md](./Tone_V2_Phase2_Foundation_Freeze_Audit_Report_2026_06_29.md)
- [Tone_V2_Phase3_Model_Capability_Foundation_Freeze_Audit_Report_2026_06_29.md](./Tone_V2_Phase3_Model_Capability_Foundation_Freeze_Audit_Report_2026_06_29.md)
- [Tone_V2_P4_Training_Report.md](./Tone_V2_P4_Training_Report.md) · [Tone_V2_P4_Offline_Quality_Evaluation_Report.md](./Tone_V2_P4_Offline_Quality_Evaluation_Report.md)
- [Tone_V2_Phase6B_tone_cnn_p2_Mainline_Replacement_Report.md](./Tone_V2_Phase6B_tone_cnn_p2_Mainline_Replacement_Report.md)
- [Tone_OpenSource_Model_Investigation_Report.md](./Tone_OpenSource_Model_Investigation_Report.md)
- 代码：`train_tone_cnn.py` · `contract.py` · `mel.py` · `validate_artifact.py` · `offline_tone_eval.py` · `tone-v2-dialog200-batch.js`
- **实测探测（2026-06-29）：** 本地 `tone_module/_data_cache` 已解压 `data_mini`

---

## Executive Summary

| 审计问题 | 结论 |
|----------|------|
| 当前训练数据是否已成为质量瓶颈？ | **是（高置信）** — 单/双说话人 mini 子集 · 仅 ~11.8k 音节 · t5 严重欠采样 · p1/p2 离线指标完全一致 |
| 是否应扩展数据？ | **是** — 在保持 `p0-v1` + P0 MLP 前提下，扩展数据是 `tone_cnn_p3` 最优先、最低风险的质量杠杆 |
| 首选数据源？ | **AISHELL-3 全量（或 ≥multi-speaker 大子集）+ 音节级 TextGrid（拼音+调号）** |
| 是否需要 forced alignment / TextGrid？ | **是** — 当前训练管线**硬依赖** `.TextGrid` 音节时间边界；官方 AISHELL-3 **不自带** syllable TextGrid |
| 扩展是否改变 Runtime？ | **否** — 仅训练侧数据与 artifact `datasetVersion` 元数据变化；`featureVersion` / `numpy_p0` / 5 类 posterior 不变 |
| 能否进入 `tone_cnn_p3` 训练？ | **可以，但须先完成 Phase 6-C 开发**（数据集打包、对齐资源接入、划分策略、许可文档） |

### Final Verdict: **CONDITIONAL PASS**

**通过项：** 数据瓶颈诊断明确；AISHELL-3 全量扩展在许可与特征契约上**可行**；现有工具链（`train_tone_cnn` → `validate_artifact` → `offline_tone_eval` → `TONE_MODEL_PATH` → E2E）**无需改 Runtime** 即可承接 p3。

**条件项：** 全量 AISHELL-3 **不能**直接替换 `data_mini` zip 而不引入 **TextGrid 对齐资源**；训练脚本需 **MODIFY** 数据集布局/缓存/划分（非 Contract）；Tone Perfect / SCSC / 网络音频 **不得**作为主训练集。

---

## Current Dataset Analysis

### 数据源与缓存现状

| 项 | 实测 / 文档值 |
|----|----------------|
| HF 仓库 | `CS5647Team3/data_mini` |
| 官方描述 | 自更大语料抽取的**单说话人** Mandarin 子集（HF 卡片：~476 rows · ~173 MB） |
| 本地 zip | `tone_module/_data_cache/data_mini.zip` |
| 解压布局 | `extracted/dataset/AISHELL-3/{train,test}/wav/SSB*/` + `extracted/dataset/aishell3_alignment_tone/SSB*/` |
| 音频采样率 | **44.1 kHz**（AISHELL-3 原生；`mel.py` 线性插值重采样至 16 kHz） |
| 对齐格式 | Praat **TextGrid**，interval `text` = 带调号拼音（如 `guang3`、`zhou1`） |
| 说话人（缓存实测） | **2** 个 speaker id（`SSB0005` 主导 + `SSB0009` 少量 test） |
| 语句数（TextGrid 文件） | **466** |
| 音节样本数 | **11,820** |
| 训练 / 验证音节 | **10,012 / 1,808**（utterance 级 15% holdout，`seed=42`） |
| 平均每句音节 | **~25.4** |
| 平均语句时长（抽样 20 条） | **~4.93 s** |

### 训练管线数据契约（`train_tone_cnn.py`）

```text
_ensure_dataset() → 解压 zip → dataset_root
_index_wavs()     → 递归收集全部 .wav
_collect_samples()→ 递归收集 .TextGrid → 解析 intervals → PINYIN_TONE_RE → label 0..4 (t1..t5)
                  → 丢弃 duration < P0_MIN_SLICE_SEC (0.02s) 或无法解析的 token
_build_feature_matrix() → soundfile 读 wav → extract_mel_features() → 80-d mel 向量
```

**关键依赖：**

- **必须有** 与 wav **同名** 的 `.TextGrid`（可在不同子目录，靠 basename 匹配）
- **必须有** 音节级 `pinyin+tone` 字符串（`^([a-z]+)([1-5])$`）
- **不读取** AISHELL-3 官方 `content.txt` / `prosody_label_train-set.txt`（utterance 级文本未接入）

### p1 / p2 训练结果对照（质量平台观测）

| 指标 | `tone_cnn_p1` | `tone_cnn_p2` | 解读 |
|------|---------------|---------------|------|
| 数据集 | `data_mini` | `data_mini`（相同） | 同源 |
| `seed` / `val_ratio` | 42 / 0.15 | 42 / 0.15 | 相同 holdout |
| `val_acc` / `offline_acc` | **0.732** | **0.732** | **完全一致** |
| 网络结构 / 特征 | P0 MLP · `p0-v1` | 同左 | 仅 `modelVersion` 不同 |
| E2E `model_error` | 0 | 0 | 部署链路正常 |
| E2E mean CER（重叠 67 条观测） | 0.216 | 0.227 | 非 A/B；未见离线提升传导 |

**结论：** p1→p2 **未改变任何训练数据或超参**，离线准确率钉死在 **0.732**，强烈表明当前瓶颈在**数据规模/分布/多样性**，而非 artifact 命名或部署流程。

---

## Class Distribution Matrix

### 全量 / 训练 / 验证音节分布（实测 2026-06-29）

| 声调 | Total (n=11820) | % | Train (n=10012) | % | Val (n=1808) | % |
|------|-----------------|---|-----------------|---|--------------|---|
| **t1** | 2,570 | 21.7% | 2,138 | 21.4% | 432 | 23.9% |
| **t2** | 2,702 | 22.9% | 2,306 | 23.0% | 396 | 21.9% |
| **t3** | 1,716 | 14.5% | 1,458 | 14.6% | 258 | 14.3% |
| **t4** | 4,314 | 36.5% | 3,672 | 36.7% | 642 | 35.5% |
| **t5** | 518 | **4.4%** | 438 | **4.4%** | 80 | **4.4%** |

### 与离线 per-class recall 对照（p1 holdout · [P4 Offline Report](./Tone_V2_P4_Offline_Quality_Evaluation_Report.md)）

| 声调 | Val Support | Offline Recall | 与分布关系 |
|------|-------------|----------------|------------|
| t1 | 432 | 77.8% | 样本充足 · 表现正常 |
| t2 | 396 | 75.0% | 样本充足 · 表现正常 |
| t3 | 258 | **60.9%** | 占比偏低 + 音系混淆（↔t2/t4） |
| t4 | 642 | 75.9% | **最多类** · 表现正常 |
| t5 | 80 | **58.8%** | **极少类**（val 仅 80 条）· 轻声本身难 |

**分布特征：**

- **t4 主导**（36.5%）— 与普通话去声在语料统计中偏多一致，但加剧类别不平衡
- **t5 严重不足** — 全集仅 518 音节（4.4%），val 仅 **80** 条，任何 5-class 分类器都难学好轻声
- **t3 次少** — 14.5% support + 与 t2/t4 声学混淆 → recall 最低档之一

---

## Weak Class Analysis

### t3 偏弱

| 因素 | 证据 | 影响 |
|------|------|------|
| 样本占比 | 14.5%（低于 t1/t2/t4） | 梯度信号弱 |
| 音系混淆 | CM：t3→t2 (39)、t3→t4 (55) 为最大 off-diagonal | 非单纯数据量；但更多**多样说话人/语境**可缓解 |
| 标注质量 | TextGrid 来自 MFA 社区对齐（`aishell3_alignment_tone`） | 边界误差会伤害短音节 mel 池化 |
| 特征 | 80-d time-avg mel · 无显式时长/上下文 | 三声变调与语境相关，单音节切片信息不足 |

### t5 偏弱

| 因素 | 证据 | 影响 |
|------|------|------|
| **样本极少** | 518 / 11820 = **4.4%**；val **80** 条 | 统计不稳定；recall 58.8% 置信区间宽 |
| 轻声标注 | 依赖拼音尾调 `5` | 语料中轻声出现本就少；mini 子集进一步稀释 |
| 与 t3/t4 混淆 | CM：t5→t3 (8)、t5→t4 (11) | 类间边界模糊 |

### 数据规模 / 多样性

| 因素 | 证据 | 影响 |
|------|------|------|
| 说话人 | 实测 **2** 人（几乎单说话人） | 无法覆盖口音、音高范围、语速 |
| 语句数 | **466** vs AISHELL-3 全量 **88,035** | 约 **189×** 语句差距 |
| 音节数 | **11,820** vs 粗估全量 **~200万+** 音节 | 模型容量未饱和但**分布覆盖不足** |
| p1=p2 同 acc | 0.732 完全一致 | 换 `modelVersion` 不提升 → **数据/任务上限信号** |

**裁决：** t3/t5 偏弱 = **样本不足（t5）+ 类别不平衡 + 单说话人 mini 子集 + 对齐/切片噪声** 的叠加；**优先通过 AISHELL-3 全量扩量**，辅以训练侧 class weight / focal loss（仅训练脚本，**不改 Runtime**）作为可选 MODIFY。

---

## AISHELL-3 Expansion Feasibility

### `data_mini` 与 AISHELL-3 全量关系

| 维度 | `CS5647Team3/data_mini` | AISHELL-3 全量（OpenSLR SLR93） |
|------|-------------------------|----------------------------------|
| 来源 | HF 课程/项目子集 | 北京希尔贝壳科技官方发布 |
| 说话人 | **1–2**（实测 2） | **218**（43 男 / 175 女） |
| 语句数 | **~466–476** | **88,035** |
| 时长 | **~0.6 h**（466×4.9s 粗估） | **~85 h** |
| 采样率 | 44.1 kHz | 44.1 kHz |
| 文本 | TextGrid 音节拼音+调 | **字级 + 拼音级** transcript（语句级） |
| 音节 TextGrid | **有**（`aishell3_alignment_tone/`） | **官方包无**；需 MFA 或第三方预对齐 |
| 许可 | HF 子集（须核对卡片）；底层 AISHELL-3 | **Apache License 2.0** |

**关系：** `data_mini` = AISHELL-3 上的**极小 curated 子集**（wav + 预生成 alignment_tone TextGrid 打包进 zip），**不是**独立录音语料。

### 是否可下载 / 接入全量

| 渠道 | URL | 可行性 |
|------|-----|--------|
| OpenSLR 官方 | https://www.openslr.org/93 | **可** — `data_aishell3.tgz` ~19 GB |
| AISHELL 官网 | http://www.aishelltech.com/aishell_3 | **可** — 同官方源 |
| HuggingFace 镜像 | https://huggingface.co/datasets/AISHELL/AISHELL-3 | **可** — ~3.42 GB（可能为处理版，须核对文件完整性） |
| 预生成 TextGrid | https://github.com/lars76/forced-alignment-chinese/releases | **可** — `aishell3_textgrid_files.zip` |

### 当前脚本能否消费全量

| 能力 | 现状 | 全量扩展 |
|------|------|----------|
| `--dataset-repo` / `--dataset-zip` | **已有**（Phase 6-A） | 可指向新 HF 包或本地 tgz 解压目录 |
| 递归 wav + TextGrid 匹配 | **已有** `_collect_samples` | **可复用**，只要目录内 wav/TextGrid basename 对齐 |
| `_ensure_dataset` marker | 检查 `AISHELL-3/` 目录 | 全量解压后**满足**；或 MODIFY marker 逻辑 |
| 44.1→16 kHz | `mel.py` 线性 `np.interp` | **可跑**；质量建议后续审计（**不改 contract 前提下**可选更好的离线重采样） |
| 训练时长 / 内存 | 11.8k 音节 ~31 s | 全量 **百万级** 音节 → 须 MODIFY 流式/分块特征缓存、epoch 采样策略 |
| val holdout | utterance 级 15% | 全量下建议 **speaker-stratified** utterance holdout（训练脚本 MODIFY） |

**结论：** **技术上可行**；瓶颈在 **TextGrid 获取** 与 **训练工程化**（缓存、划分、体量），不在 Runtime。

---

## Alignment / TextGrid Requirement

### 是否必须有 TextGrid？

**是。** 当前 `train_tone_cnn._collect_samples()` **仅**解析 Praat TextGrid interval tier 中的 `pinyin+tone` token，**无** utterance 级文本 → 音节切分的 fallback。

### AISHELL-3 官方是否提供可用声调 transcript？

| 资源 | 内容 | 能否直接用于当前管线 |
|------|------|----------------------|
| `content.txt` | 汉字转写 | **否** — 无时间戳 |
| `prosody_label_train-set.txt` | 韵律/拼音相关标注 | **否** — 非 syllable-level TextGrid |
| 拼音级 transcript（官方说明） | 语句级拼音+调 | **否** — 缺音节起止时间 |
| MFA TextGrid（社区） | 音节/词级边界 + 拼音 | **是** — 与 `data_mini` 同格式 |

### 是否已有对齐工具 / 可复用资产

| 资产 | 说明 | 复用性 |
|------|------|--------|
| `data_mini` 内 `aishell3_alignment_tone/` | 已为 mini 子集生成 | **仅覆盖 mini** |
| [lars76/forced-alignment-chinese](https://github.com/lars76/forced-alignment-chinese) | Montreal Forced Aligner + 预发布 AISHELL-3 TextGrid | **推荐** — 下载即用或自建 MFA |
| PaddleSpeech CDN（同仓库 README 引用） | 备选 TextGrid 镜像 | 需核验格式与许可 |
| 项目内其他对齐 | **未发现** Tone 专用 MFA 流水线 | Phase 6-C 需新建 Runbook |

### forced alignment 是否必需？

- **若使用社区预生成 TextGrid：** 不必自建 MFA，但仍属 **forced alignment 产物**。
- **若官方仅给语句拼音：** **必须** MFA（或其它 forced aligner）生成 syllable TextGrid，否则无法接入当前管线。

---

## Dataset License / Usage Risk

| 数据集 | 许可 / 使用条款 | 商用 | 再分发 | 审计要求 |
|--------|-----------------|------|--------|----------|
| **AISHELL-3** | Apache License 2.0（OpenSLR SLR93） | 允许（遵循 Apache） | 允许 | 保留 LICENSE / 引用论文 |
| **CS5647Team3/data_mini** | HF 数据集卡片；底层 AISHELL-3 | 须遵循上游 | 子集再发布须注明 | 训练 `datasetVersion` 元数据记录 |
| **lars76 TextGrid** | 开源仓库（须读 LICENSE） | 对齐产物独立于音频许可 | 可缓存本地 | 与 AISHELL-3 音频配套使用 |
| **Tone Perfect** | In Copyright — **Educational / Non-commercial**；批量下载须申请 | **受限** | **受限** | 仅补充；须 MSU 审批 |
| **SCSC** | 随 ToneNet 仓库分发 mono 样本；学术语料 | 须核对原始 SCSC 声明 | 谨慎 | 仅补充 / 参考 |
| **网络公开音频** | 通常 **版权不明** | **风险高** | **风险高** | **禁止作为主训练集** |

**项目合规建议（Phase 6-C 开发须写入 Runbook）：**

1. 主训练集锁定 **Apache 2.0 的 AISHELL-3 官方音频**。
2. Tone Perfect 用于 **t3/t5 针对性增广** 前须完成 **非商用/教育用途** 审批留档。
3. 禁止将未授权网络爬取音频写入 `tone_module/_data_cache` 生产路径。

---

## Candidate Dataset Matrix

### 1. CS5647Team3/data_mini（当前生产训练集）

| 字段 | 值 |
|------|-----|
| **Dataset Name** | CS5647Team3/data_mini |
| **Source URL** | https://huggingface.co/datasets/CS5647Team3/data_mini |
| **License / Usage Note** | HF 子集；底层 AISHELL-3（Apache 2.0）；卡片注明 single-speaker subset |
| **Audio Hours / Utterances** | ~0.6 h · **466** utt（实测） |
| **Speaker Count** | **1–2** |
| **Transcript Type** | TextGrid 音节 `pinyin+tone` |
| **Tone Label Availability** | **有**（调号 1–5） |
| **Alignment Availability** | **有**（包内 `aishell3_alignment_tone`） |
| **Fit for Current Training Pipeline** | **完全匹配** |
| **Required Conversion Work** | 无 |
| **Risk** | **规模过小** · 单说话人 · t5 稀缺 · 质量上限 0.732 平台 |
| **Verdict** | **KEEP** 为默认/回归基线；**不宜**作为 p3 唯一数据源 |

### 2. AISHELL-3 全量（OpenSLR SLR93）

| 字段 | 值 |
|------|-----|
| **Dataset Name** | AISHELL-3 |
| **Source URL** | https://www.openslr.org/93 · https://www.aishelltech.com/aishell_3 |
| **License / Usage Note** | **Apache License 2.0** |
| **Audio Hours / Utterances** | **~85 h** · **88,035** utt |
| **Speaker Count** | **218** |
| **Transcript Type** | 字级 + **语句级拼音**（非 syllable TextGrid） |
| **Tone Label Availability** | 拼音中带调，但**无官方音节时间边界** |
| **Alignment Availability** | **需外接** MFA TextGrid（见 #3） |
| **Fit for Current Training Pipeline** | **条件匹配** — wav 可读 · 须配 TextGrid |
| **Required Conversion Work** | 下载 19 GB tgz · 解压 · 挂载 TextGrid · 44.1→16k（已有）· 特征缓存 |
| **Risk** | 存储/下载成本 · 对齐误差 · 训练时间激增 |
| **Verdict** | **首选主训练集**（p3） |

### 3. lars76 AISHELL-3 MFA TextGrid（对齐产物）

| 字段 | 值 |
|------|-----|
| **Dataset Name** | aishell3_textgrid_files（forced-alignment-chinese） |
| **Source URL** | https://github.com/lars76/forced-alignment-chinese/releases |
| **License / Usage Note** | 开源仓库 LICENSE；对齐基于 AISHELL-3 音频 |
| **Audio Hours / Utterances** | 覆盖 AISHELL-3 全量（须与 #2 音频对齐） |
| **Speaker Count** | 同 AISHELL-3 |
| **Transcript Type** | Praat TextGrid · pinyin intervals |
| **Tone Label Availability** | **有**（与 mini 相同格式） |
| **Alignment Availability** | **有**（预计算 MFA） |
| **Fit for Current Training Pipeline** | **完全匹配**（与 `data_mini` 同解析逻辑） |
| **Required Conversion Work** | 下载 zip · 目录对齐 wav basename · 校验抽样 |
| **Risk** | 第三方对齐质量 · 版本漂移 |
| **Verdict** | **推荐与 #2 配对使用** |

### 4. HuggingFace AISHELL/AISHELL-3

| 字段 | 值 |
|------|-----|
| **Dataset Name** | AISHELL/AISHELL-3 |
| **Source URL** | https://huggingface.co/datasets/AISHELL/AISHELL-3 |
| **License / Usage Note** | Apache 2.0（同官方） |
| **Audio Hours / Utterances** | ~85 h · 88k utt（卡片描述） |
| **Speaker Count** | 218 |
| **Transcript Type** | 语句级文本/拼音 |
| **Tone Label Availability** | 语句级 |
| **Alignment Availability** | **无内置 syllable TextGrid** |
| **Fit for Current Training Pipeline** | 须 + #3 或自建 MFA |
| **Required Conversion Work** | HF 下载适配 · 与 OpenSLR 完整性对账 |
| **Risk** | 镜像不完整 / 版本差异 |
| **Verdict** | **可选下载通道**；优先 OpenSLR 或 HF 二选一 + TextGrid |

### 5. Tone Perfect

| 字段 | 值 |
|------|-----|
| **Dataset Name** | Tone Perfect |
| **Source URL** | https://tone.lib.msu.edu/ |
| **License / Usage Note** | **Educational / Non-commercial**；全量须申请表 |
| **Audio Hours / Utterances** | ~9,860 **单音节** MP3 |
| **Speaker Count** | 6（3 女 3 男） |
| **Transcript Type** | 元数据 + 单音节标签 |
| **Tone Label Availability** | **有**（四声为主；轻声覆盖需核对） |
| **Alignment Availability** | **整段即单音节** — 可不强制 TextGrid |
| **Fit for Current Training Pipeline** | **需转换脚本**（MP3→wav · 16k · 适配 `_collect_samples` 或旁路 loader） |
| **Required Conversion Work** | 许可审批 · 格式转换 · 与 AISHELL 混训策略 |
| **Risk** | **商用限制** · 域偏移（孤立音节 vs 连续语句切片） |
| **Verdict** | **仅作补充**（尤其 t3/t5 增广） |

### 6. SCSC（Syllable Corpus of Standard Chinese）

| 字段 | 值 |
|------|-----|
| **Dataset Name** | SCSC |
| **Source URL** | 随 ToneNet 仓库 `mono/` · 论文 Interspeech 2019 |
| **License / Usage Note** | 学术语料；须核对原始声明（ToneNet MIT ≠ 数据许可） |
| **Audio Hours / Utterances** | 单音节为主（规模小于 AISHELL-3） |
| **Speaker Count** | 有限 |
| **Transcript Type** | 单音节 wav |
| **Tone Label Availability** | **有**（ToneNet 4 类为主） |
| **Alignment Availability** | 天然单音节 |
| **Fit for Current Training Pipeline** | **需标签映射到 5 类** + 切片逻辑特例 |
| **Required Conversion Work** | 许可核对 · 5-class 标签 · 特征已对齐 P0 方可混训 |
| **Risk** | 许可不清 · 4/5 类差异 · 域偏移 |
| **Verdict** | **仅作补充 / 架构参考**（见 [开源调研报告](./Tone_OpenSource_Model_Investigation_Report.md)） |

### 7. 网络公开音频（通用）

| 字段 | 值 |
|------|-----|
| **Dataset Name** | 未策展公开网络音频 |
| **Source URL** | 各平台 UGC / 播客 / 视频抽取 |
| **License / Usage Note** | **通常不明** |
| **Audio Hours / Utterances** | 不定 |
| **Speaker Count** | 不定 |
| **Transcript Type** | 大多无可靠拼音声调 |
| **Tone Label Availability** | **无**或需 ASR 伪标 |
| **Alignment Availability** | **无** |
| **Fit for Current Training Pipeline** | **不适合** |
| **Required Conversion Work** | ASR + 强制对齐 + 质量过滤（超出 Phase 6-C 范围） |
| **Risk** | **版权** · 标签噪声 · 域漂移 · 合规 |
| **Verdict** | **禁止作为主训练集** |

### 8. Data Baker biaobei（对齐仓库提及）

| 字段 | 值 |
|------|-----|
| **Dataset Name** | biaobei / 标贝 |
| **Source URL** | https://en.data-baker.com/datasets/freeDatasets/ · [forced-alignment-chinese](https://github.com/lars76/forced-alignment-chinese) |
| **License / Usage Note** | 标贝开源 TTS 数据条款（须读官网） |
| **Audio Hours / Utterances** | 多说话人 TTS 规模 |
| **Speaker Count** | 多 |
| **Transcript Type** | 语句 + 可选 MFA TextGrid |
| **Tone Label Availability** | 拼音级 |
| **Alignment Availability** | 社区 MFA 可下载 |
| **Fit for Current Training Pipeline** | 条件匹配（同 AISHELL 路径） |
| **Required Conversion Work** | 许可核对 · 与 AISHELL 混训比例设计 |
| **Risk** | TTS 腔 vs 自然对话 ASR 域偏移 |
| **Verdict** | **可选次要补充**；**不替代** AISHELL-3 主集 |

---

## Network Data Risk Assessment

| 风险维度 | 等级 | 说明 |
|----------|------|------|
| 版权 / 许可 | **CRITICAL** | 未授权音频不得进入生产训练缓存 |
| 标签质量 | **HIGH** | 无拼音+调+时间的网络音频无法产生可靠 syllable label |
| 域匹配 | **HIGH** | FW Tone 作用于 **ASR 词级时间戳切片**；孤立音节/TTS/广播域与对话 ASR 不一致 |
| 合规审计 | **HIGH** | 无法通过 `datasetVersion` 追溯许可 → 阻塞 Model Freeze |
| 工程成本 | **MED** | 自建伪标链路等同新项目，违反 Phase 6-C「扩展而非新管线」 |

**规则：** 网络公开音频 **禁止直接进入主训练集**；若未来引入，须单独立项、许可审查、与 AISHELL 主集隔离实验，**不在 Phase 6-C 默认范围**。

---

## Required Development Matrix

| ID | 开发项 | 目的 | 触达模块 | 改 Runtime？ | 处置 |
|----|--------|------|----------|--------------|------|
| RD-01 | AISHELL-3 全量下载与缓存 Runbook | 可重复获取 ~85h 数据 | 文档 + `_data_cache` 子目录 | **否** | **MODIFY** |
| RD-02 | 接入 `aishell3_textgrid_files` 并与 wav 对账 | 满足 `_collect_samples` 硬依赖 | 数据集布局脚本 | **否** | **MODIFY** |
| RD-03 | `train_tone_cnn` 大数据集工程化 | 百万音节可训练（分块特征缓存 / 采样） | `train_tone_cnn.py` | **否** | **MODIFY** |
| RD-04 | Speaker-stratified holdout | 避免同一 speaker 泄漏 val | `split_val_holdout_samples` | **否** | **MODIFY** |
| RD-05 | `datasetVersion` 元数据规范 | p3 追溯（如 `openslr/SLR93+mfa_v1`） | 训练 metadata | **否** | **MODIFY** |
| RD-06 | 可选 class weight / 重采样 | 缓解 t5/t3 不平衡 | 训练损失（仅训练） | **否** | **MODIFY**（可选） |
| RD-07 | `offline_tone_eval` per-class 报告 | 验收 t3/t5 是否改善 | `offline_tone_eval.py` 或 JSON 后处理 | **否** | **MODIFY** |
| RD-08 | 44.1→16k 重采样质量抽检 | 与 Runtime 16k 输入一致 | 审计 `mel.py`（**不改 contract**） | **否** | **KEEP** 默认；必要时 **MODIFY** 离线预处理 |
| RD-09 | 许可与引用文档 | Apache 2.0 / Tone Perfect 审批留档 | `docs/tone-v2/` | **否** | **MODIFY** |
| RD-10 | p3 训练后部署链 | 单主链不变 | 既有 Runbook + E2E | **否** | **KEEP** |

### 扩展后主链（须保持不变）

```text
Dataset → train_tone_cnn → Artifact (npz)
       → validate_artifact → TONE_MODEL_PATH → FW 重启 → Node E2E
```

- **不变：** `featureVersion=p0-v1` · `backend=numpy_p0` · P0 MLP schema · Runtime Hop · Recall 决策权
- **仅变：** 训练数据规模 · `datasetVersion` · 可选 `metrics` / offline per-class 报告

---

## KEEP / MODIFY / RESTORE / DELETE

| 处置 | 项 |
|------|-----|
| **KEEP** | `contract.py` P0 Feature Baseline · `mel.extract_mel_features` 契约 |
| **KEEP** | `validate_artifact` / `offline_tone_eval` / Node E2E 门禁顺序 |
| **KEEP** | TextGrid + `pinyin+tone` 音节标签解析逻辑（`PINYIN_TONE_RE`） |
| **KEEP** | `data_mini` 作为regression 小数据集 |
| **KEEP** | 单 `TONE_MODEL_PATH` + FW 重启部署；禁止 Registry / 双链路 |
| **MODIFY** | 训练数据集布局、缓存、划分、大数据工程化 |
| **MODIFY** | Phase 6-C Runbook：AISHELL-3 + MFA TextGrid 获取与校验 |
| **MODIFY** | `offline_tone_eval` 输出 per-class recall（验收 t3/t5） |
| **MODIFY** | （可选）class-balanced sampling / loss |
| **RESTORE** | — |
| **DELETE** | 任何「网络爬取作主集」计划；任何「离线 eval 替代 E2E」作为 p3 验收 |

---

## 最终问题答复

| # | 问题 | 答案 |
|---|------|------|
| 1 | **是否应该扩展数据？** | **应该。** 当前 mini 子集已解释 p1/p2 0.732 平台与 t3/t5 弱势。 |
| 2 | **首选数据源是否应为 AISHELL-3 全量或更大子集？** | **是。** Apache 2.0 · 与现有 TextGrid 生态一致 · 规模/说话人覆盖最优。 |
| 3 | **是否需要 forced alignment / TextGrid？** | **是。** 当前管线硬依赖 syllable TextGrid；可用社区 MFA 预生成或自建 MFA。 |
| 4 | **Tone Perfect / SCSC 是否只作为补充？** | **是。** 许可/域/格式决定其不能替代 AISHELL-3 主集。 |
| 5 | **网络公开音频是否禁止直接进入训练集？** | **是（作为主集）。** 版权与标签不可控；不得作为 p3 默认数据源。 |
| 6 | **扩展数据是否会改变 Runtime？** | **不会。** 仅训练与 artifact 元数据变化；`p0-v1` + `numpy_p0` 冻结。 |
| 7 | **扩展数据后是否可以进入 tone_cnn_p3 训练？** | **可以。** 完成 RD-01–RD-05 后，沿既有 **Dataset → Train → validate → 部署 → E2E** 单主链执行。 |

---

## Final Verdict

# **CONDITIONAL PASS**

**理由（通过侧）：**

1. **数据瓶颈成立** — 11,820 音节 · 单/双说话人 · t5 4.4% · p1/p2 同 val_acc=0.732。  
2. **AISHELL-3 全量扩展可行** — Apache 2.0 · 语句级拼音完备 · 社区 TextGrid 可复用现有解析器。  
3. **Runtime / Contract 无需变更** — 扩展纯属 Training Foundation 范畴，符合 Phase 1–3 冻结。  
4. **工具链可承接 p3** — Phase 6-A 已具备 `--dataset-repo`；门禁链完整。

**理由（条件侧）：**

1. 全量音频 **不自带** syllable TextGrid — 必须先完成 **对齐资源接入（RD-02）**。  
2. 训练工程须适配 **~100×+** 数据量（RD-03/04），否则 p3 训练不可实操。  
3. Tone Perfect / 网络音频 **不得**作为默认主集 — 须许可与域审查。  
4. p3 质量验收仍须 **offline per-class + Node E2E**；不得仅用 offline 替代主链。

**下一步（Phase 6-C 开发，非本轮）：** 实施 RD-01–RD-09 → 再开 `tone_cnn_p3` 训练（**不在本审计轮执行**）。

---

## 附件 / 复现探测

```powershell
cd D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad
.\.venv\Scripts\python.exe -c "
from collections import Counter
from tone_module.train_tone_cnn import _ensure_dataset, _collect_samples, CACHE_DIR, split_val_holdout_samples
samples = _collect_samples(_ensure_dataset(CACHE_DIR))
train, val = split_val_holdout_samples(samples)
print('syllables', len(samples), 'utterances', len({s.wav_path for s in samples}))
print('class_dist', dict(Counter(s.label for s in samples)))
"
```

**参考报告：**

- `Tone_V2_P4_Offline_Quality_Evaluation_Report.md` — t3/t5 per-class recall  
- `Tone_V2_Phase6B_tone_cnn_p2_Mainline_Replacement_Report.md` — p2 主链 PASS · 同数据 0.732  
- `Tone_OpenSource_Model_Investigation_Report.md` — SCSC / Tone Perfect 边界
