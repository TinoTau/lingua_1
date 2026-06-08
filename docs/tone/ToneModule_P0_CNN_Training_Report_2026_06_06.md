# ToneModule P0 — Tone CNN 训练报告

**日期**：2026-06-06  
**模型路径**：`electron_node/services/faster_whisper_vad/tone_module/models/tone_cnn_p0.npz`  
**关联报告**：[ToneModule P0 开发报告](./ToneModule_P0_Development_Report_2026_06_06.md)

---

## 1. 背景

P0 冻结方案要求 FW Worker 内运行小型 CPU Tone 分类器：

- 输入：80 维 Mel 特征（16 kHz，与 `processed_audio` 对齐）
- 输出：5 类 posterior（一声～四声 + 轻声）
- 约束：CPU、离线、模型 <5 MB、batch 推理

公开仓库中**不存在**与当前架构（80→32→5 npz 权重）完全匹配的预训练包，因此采用 **AISHELL-3 音节对齐数据本地训练**。

---

## 2. 数据集

| 项 | 内容 |
|----|------|
| 来源 | HuggingFace [CS5647Team3/data_mini](https://huggingface.co/datasets/CS5647Team3/data_mini) |
| 内容 | AISHELL-3 单说话人 wav + Praat TextGrid 音节对齐 |
| 原始规模 | 476 utterances，466 对 wav/TextGrid |
| 音节样本 | **11,820** 条（带 pinyin+tone 标注的有效 interval） |
| 标注格式 | TextGrid `words` tier，如 `guang3`、`zhou1`、`nv3` |
| 采样率 | 原始 44.1 kHz → 特征提取时重采样至 16 kHz |

### 2.1 标签映射

| Pinyin 尾数字 | 类别 | posterior 键 |
|---------------|------|--------------|
| 1 | 一声 | t1 |
| 2 | 二声 | t2 |
| 3 | 三声 | t3 |
| 4 | 四声 | t4 |
| 5 | 轻声 | t5 |

无效 interval（空文本、时长 <20ms、无法解析 pinyin）丢弃。

### 2.2 划分方式

- **按 utterance 划分**（非随机音节），避免同句泄漏
- train：**10,012** 音节（约 85% utterances）
- val：**1,808** 音节（约 15% utterances）
- 随机种子：`42`

---

## 3. 模型结构

与运行时 `tone_module/classifier.py` **完全一致**：

```text
Input:  mel (80,)     # mean-pooled log-Mel
Hidden: ReLU(x @ W1 + b1)   W1: (80, 32)
Output: softmax(h @ W2 + b2)   W2: (32, 5)
```

推理时对 Mel 做训练集统计归一化：

```text
x_norm = (x - mel_mean) / mel_std
```

---

## 4. 特征提取

| 参数 | 值 |
|------|-----|
| 采样率 | 16000 Hz |
| n_fft | 512 |
| hop | 160（10 ms） |
| n_mels | 80 |
| fmin / fmax | 50 / 7600 Hz |
| 池化 | 时间维 mean → 80 维向量 |

实现：`tone_module/mel.py`（与推理共用，保证 train/serve 一致）。

短音节（<512 samples）右侧 zero-pad 至 512，避免 STFT 频 bin 维度不一致。

---

## 5. 训练配置

| 超参数 | 值 |
|--------|-----|
| Optimizer | 手写 mini-batch SGD |
| Epochs | 80 |
| Batch size | 128 |
| Learning rate | 0.05 |
| Loss | Cross-entropy（softmax） |
| 初始化 | 正态 N(0, 0.05)，seed=42 |
| Early best | 按 val_acc 保存最优权重 |

训练命令：

```powershell
cd D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad
python tone_module\train_tone_cnn.py
```

可选：`--epochs`、`--batch-size`、`--lr`、`--output`、`--val-ratio`

数据缓存：`tone_module/_data_cache/`（gitignore，首次自动从 HuggingFace 下载 `data_mini.zip`）

---

## 6. 训练结果

### 6.1 指标摘要

| 指标 | 值 |
|------|-----|
| **验证准确率（val_acc）** | **73.23%** |
| 训练准确率（train_acc） | 78.02% |
| 随机基线（5 类） | 20% |
| 最优 epoch | 80（val_acc 峰值出现在训练中后期） |

### 6.2 训练曲线（节选）

| Epoch | train_acc | val_acc |
|-------|-----------|---------|
| 1 | 0.457 | 0.455 |
| 10 | 0.648 | 0.634 |
| 20 | 0.699 | 0.691 |
| 40 | 0.741 | 0.707 |
| 60 | 0.767 | 0.717 |
| 80 | 0.780 | **0.732** |

### 6.3 产物

| 文件 | 大小 | 内容 |
|------|------|------|
| `tone_cnn_p0.npz` | **13.6 KB** | w1, b1, w2, b2, mel_mean, mel_std, metrics |

`metrics` 内嵌字段：

```json
{
  "train_acc": 0.780163803435877,
  "val_acc": 0.7323008849557522,
  "train_samples": 10012,
  "val_samples": 1808,
  "epochs": 80,
  "dataset": "CS5647Team3/data_mini"
}
```

---

## 7. 部署与加载

| 项 | 说明 |
|----|------|
| 默认路径 | `tone_module/models/tone_cnn_p0.npz` |
| 配置 | `config.py` → `TONE_MODEL_PATH`（环境变量可覆盖） |
| 加载日志 | `ToneModule loaded weights from ... (val_acc=0.732)` |
| fallback | 若 npz 不存在，使用 bootstrap 随机权重（**不应在生产使用**） |

验证命令：

```powershell
cd electron_node\services\faster_whisper_vad
python -c "from tone_module.classifier import get_tone_classifier; c=get_tone_classifier(); print(c.ready, c._mel_mean is not None)"
# 期望: True True
```

---

## 8. 局限与改进方向

### 8.1 当前局限

| 局限 | 影响 |
|------|------|
| 数据规模小（单说话人 mini 集） | 对多说话人、噪声、连读泛化有限 |
| 模型为浅层 MLP | 未使用卷积时序建模；复杂调型可能混淆 |
| 训练域为朗读语料 | 与 FW 实时 ASR 口语文本存在 domain gap |
| 未做 per-class 混淆矩阵导出 | 暂不知哪类声调最易混淆 |

### 8.2 建议改进（按优先级）

1. **扩大数据**：完整 AISHELL-3 或 MagicData 多说话人 + TextGrid/强制对齐
2. **增强模型**：1D-CNN / 2 层 MLP + dropout；仍保持 <5 MB
3. **数据增强**：语速扰动、轻量噪声、音量缩放
4. **导出混淆矩阵 & per-tone F1**：写入训练报告与 npz metadata
5. **FW 在线压测**：统计 `diagnostics.toneModule.tone_inference_ms` 是否满足整句 ≤20 ms CPU 目标

---

## 9. 与 P0 验收的关系

| 验收项 | 训练报告结论 |
|--------|--------------|
| toneTokens / tonePosterior 存在 | ✅ 模型可产出合法 5 类 posterior |
| toneMatchScore 有区分度 | ✅ Node 单测已验证排序逻辑；声学区分度依赖 posterior 质量 |
| 端到端 少冰/烧饼/哨兵 Apply | ⚠️ 需联调 + 词库覆盖；非训练指标 alone 可保证 |
| 整句 ≤20ms | ⚠️ 待 FW 服务实测（11k 音节训练规模下 batch 推理预计远小于 ASR） |

---

## 10. 结论

已在本地完成 Tone CNN 训练，权重落盘至 `tone_module/models/tone_cnn_p0.npz`，验证准确率 **73.2%**（5 类），模型体积 **13.6 KB**，满足 P0 体积与架构约束。运行时与训练共用 Mel 提取与归一化逻辑，避免 train/serve skew。建议后续扩大训练集并重训以提升多说话人场景下的声学排序信号质量。
