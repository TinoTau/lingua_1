<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Tone_V2_P9_B_FW_WordInfo_V2_CNN_1k_Pilot_Training_Report.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Tone V2 P9-B — FW-WordInfo V2 CNN 1k Pilot Training Report

**Date:** 2026-07-04  
**Phase:** P9-B FW-WordInfo V2 CNN 1k Pilot Training  
**Type:** Pilot 训练 + 验收（非 Runtime 接入 · 非全量训练）

**训练主链（唯一）：**

```text
TextGrid → SyllableSample → WordInfo Adapter → WordInfo
→ extract_feature(audio, sampleRate, wordInfo)
→ Feature Tensor (64, 83) → CNN → TonePosterior (5) → V2 artifact
```

**Artifact 路径：** `tone_module/models/tone_cnn_p1_v1_1k.npz`

---

## Executive Summary

| 项 | 结果 |
|----|------|
| 1k AISHELL-3 pilot 训练 | ✅ 成功完成（~23 min） |
| WordInfo online training path | ✅ 全程使用，无 Shard |
| V2 artifact 生成 | ✅ `npz-p1-v1` |
| `validate_artifact_v1` | ✅ PASS |
| V2 inference probe（32 samples） | ✅ PASS |
| Anti-fallback gate | ✅ 9/9 PASS |
| p0 / Runtime 修改 | ✅ 无 |

### Final Verdict: **PASS**

1k pilot 证明 FW WordInfo 一致训练链路可产出可加载、可验证、可推理的 V2 模型 artifact，具备后续 Runtime 对接前提；**尚未**接入生产 Runtime。

---

## Training Config

| 参数 | 值 |
|------|-----|
| 入口 | `python -m tone_module.train_tone_v2_model train` |
| dataset | `aishell3` |
| max_syllables | **1000** |
| epochs | 20 |
| batch_size | 64 |
| learning_rate | 0.01（V2 trainer 默认） |
| holdout | speaker（aishell3 默认） |
| output | `tone_module/models/tone_cnn_p1_v1_1k.npz` |
| 特征路径 | **online WordInfo** — `build_v2_training_batch` |
| Feature Shard V2 | **未使用** |
| skip_download | true（本地 cache） |

---

## Dataset Sample Count

| 分区 | 数量 |
|------|------|
| 总 syllables（truncate 后） | **1000** |
| train | **966** |
| val | **34** |
| holdout 策略 | speaker |

**Dataset ID：** `openslr_aishell3` · version metadata: `openslr_slr93_full`

---

## Training Path Verification

| 检查项 | 结果 |
|--------|------|
| SyllableSample → WordInfo Adapter | ✅ |
| WordInfo → `extract_feature` | ✅ 在线逐样本 |
| 输出 `(N, 64, 83)` + label `(N,)` | ✅ |
| 不经 Feature Shard V2 | ✅ |
| 不经 `extract_mel_features` | ✅ |
| 不经 p0 `_build_feature_matrix` | ✅ |
| metrics.trainingPath | `SyllableSample→WordInfo→extract_feature` |

---

## WordInfo Contract Verification

| 项 | 状态 |
|----|------|
| Runtime 同构 `WordInfo` | ✅ `shared_types.WordInfo` |
| Adapter 直拷 start/end | ✅ |
| label 为 sidecar | ✅ |
| probability 不进 Feature | ✅（P8 冻结） |

---

## Feature Tensor Verification

| 契约项 | 值 | 状态 |
|--------|-----|------|
| featureVersion | `p1-frame-mel-f0-v1` | ✅ |
| inputShape | `[64, 83]` | ✅ |
| per-sample shape | `(64, 83)` float32 | ✅ |
| 归一化 | per-channel `feature_mean/std` `(83,)` | ✅ 写入 artifact |

---

## CNN Training Log

```
v2 syllables: total=1000 train=966 val=34 holdout=speaker
epoch   1: loss=2.3442 train_acc=0.277 val_acc=0.500
epoch   5: loss=2.0331 train_acc=0.276 val_acc=0.441
epoch  10: loss=1.8133 train_acc=0.288 val_acc=0.441
epoch  15: loss=1.7556 train_acc=0.302 val_acc=0.412
epoch  20: loss=1.6749 train_acc=0.302 val_acc=0.382
saved tone_module/models/tone_cnn_p1_v1_1k.npz
validation=PASS | adapter_acc=0.5000
```

**说明：** trainer 按 **best val checkpoint** 保存权重；epoch 1 val_acc=0.500 为 best，故 artifact metrics 中 val_acc=0.500，而 epoch 20 即时 val_acc=0.382。属 pilot 小 val 集（34 样本）波动，非链路错误。

**训练耗时：** ~23 分钟（在线 extract_feature × 1000）

---

## Final Train Accuracy

| 指标 | 值 |
|------|-----|
| train_acc（best checkpoint 上） | **0.277** |
| train_samples | 966 |

---

## Final Val Accuracy

| 指标 | 值 |
|------|-----|
| val_acc（best checkpoint） | **0.500** |
| val_samples | 34 |
| 训练结束 inline validate adapter_acc | 0.5000 |

---

## Artifact Validation Result

**命令：**

```bash
python -m tone_module.validate_artifact_v1 \
  --artifact tone_module/models/tone_cnn_p1_v1_1k.npz \
  --json-out tone_module/models/tone_cnn_p1_v1_1k_validate.json
```

**结果：** `validation=PASS | schema=True | shape=True | loader=True | adapter=True`

| 字段 | 值 |
|------|-----|
| formatVersion | `npz-p1-v1` |
| featureVersion | `p1-frame-mel-f0-v1` |
| modelVersion | `tone_cnn_p1_v1` |
| modelArchitecture | `conv1d_global_pool_v1` |
| backend | `numpy_p1` |
| inputShape | `[64, 83]` |
| outputShape | `[5]` |
| p0 keys (w1/b1/w2/b2) | **不存在** |

---

## V2 Inference Probe Result

**命令：**

```bash
python -m tone_module.probe_v2_inference \
  --artifact tone_module/models/tone_cnn_p1_v1_1k.npz \
  --probe-samples 32 --skip-download \
  --json-out tone_module/models/tone_cnn_p1_v1_1k_probe.json
```

| 检查项 | 结果 |
|--------|------|
| ToneModelLoaderV1 加载 | ✅ |
| 32 条 WordInfo online features | ✅ |
| posterior shape | `(32, 5)` ✅ |
| softmax sum | `[0.9999999, 1.0000001]` ✅ |
| used_p0_loader | **false** ✅ |
| numpy_p0 调用 | **无** ✅ |

---

## Anti-fallback Gate Result

| Gate | 结果 |
|------|------|
| `test_phase9a_v2_cnn_training` | **9/9 PASS** |
| train_v2 源码无 p0/Shard 令牌 | ✅ |
| p0 loader 拒绝 V1 artifact | ✅ |
| V1 loader 拒绝 p0 keys | ✅ |
| numpy_p1 拒绝 `(N,80)` | ✅ |
| Feature Shard V2 非主链 | ✅ 训练日志无 shard 引用 |

---

## Production Readiness Assessment

| 维度 | 评估 |
|------|------|
| V2 artifact 可加载/可验证 | ✅ 就绪 |
| V2 backend 可推理 | ✅ 就绪 |
| FW WordInfo Runtime 对接 | ⚠️ **前提已满足**，但 `inference.py` 仍 p0 — 需后续独立 Runtime 接入阶段 |
| 生产部署 | ❌ **本轮禁止** |
| 全量 AISHELL-3 训练 | ⚠️ 链路已验证，可进入下一阶段；在线全量耗时会显著增加 |
| 模型质量（pilot） | val_acc best=0.50 / train≈0.28 — pilot 基线，非最终精度目标 |

---

## KEEP / MODIFY / RESTORE / DELETE / RECLASSIFY

| 动作 | 项 |
|------|-----|
| **KEEP** | `train_tone_v2_model.py` · WordInfo path · `cnn_p1` · `numpy_p1` · `loader_v1` · p0 Runtime |
| **KEEP** | `tone_cnn_p1_v1_1k.npz` pilot artifact |
| **新增 KEEP** | `validate_artifact_v1` CLI · `probe_v2_inference.py` |
| **RECLASSIFY** | Feature Shard V2 — 仍仅为 optional cache，未参与本次训练 |
| **DELETE** | 无 |
| **MODIFY** | 无（本轮仅 pilot 执行 + 探测工具） |

---

## 八问终答

| # | 问题 | 答案 |
|---|------|------|
| 1 | 1k 训练是否成功完成？ | **是** — exit 0，artifact 已保存 |
| 2 | 是否真正通过 WordInfo path 训练？ | **是** — online `extract_feature` + metrics 记录 |
| 3 | 是否生成合法 V2 artifact？ | **是** — `npz-p1-v1` 全字段合规 |
| 4 | 是否通过 validate_artifact_v1？ | **是** |
| 5 | V2 backend 是否输出合法 TonePosterior？ | **是** — `(N,5)` softmax 合法 |
| 6 | 是否存在 p0 fallback？ | **否** |
| 7 | 是否证明未来可对接 FW WordInfo Runtime？ | **是（前提层面）** — 同 WordInfo + `(64,83)` + `numpy_p1`；Runtime 切换属后续阶段 |
| 8 | 是否可以进入 AISHELL-3 full training？ | **是（条件性）** — 1k pilot PASS；建议评估在线提取耗时或 optional cache 加速（cache 不得替代主链验收） |

---

## Final Verdict

### **PASS**

P9-B 1k pilot 完整验证 FW WordInfo → extract_feature → CNN → TonePosterior → V2 artifact 链路可训练、可验收、可离线推理；无 p0 fallback；无 Runtime 改动。

---

## 附录：产出文件

| 文件 | 说明 |
|------|------|
| `tone_module/models/tone_cnn_p1_v1_1k.npz` | Pilot 模型 artifact |
| `tone_module/models/tone_cnn_p1_v1_1k_validate.json` | validate_artifact_v1 报告 |
| `tone_module/models/tone_cnn_p1_v1_1k_probe.json` | inference probe 报告 |
| `tone_module/models/p9b_1k_train.log` | 训练日志 |
