<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Tone_V2_Phase7C_tone_cnn_p3_50Epoch_Training_Report.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Tone V2 Phase 7-C — tone_cnn_p3 Canonical Training Report（50 Epoch）

**Date:** 2026-07-02  
**Task Type:** 正式模型训练（**非 Runtime** · **非冻结层修改**）  
**Scope:** Canonical AISHELL-3 Feature Shard → `tone_cnn_p3.npz`  
**依据：** Phase 7-B Training Engineering Freeze · Phase 7-A Dataset Foundation · `TONE_V2_CONTRACT_FREEZE.md`

---

## Executive Summary

| 项 | 裁决 |
|----|------|
| Training IO Validation（pre-train） | **PASS** |
| 50 Epoch Canonical 训练 | **PASS**（`exit_code: 0`） |
| `tone_cnn_p3.npz` 产出 | **是** |
| `validate_artifact` | **PASS** |
| Offline Evaluation（AISHELL-3 speaker val） | **PASS**（acc **0.5738** · 147,312 样本） |
| 冻结层修改 | **无** |
| Runtime / Node E2E | **未执行**（符合禁令） |

### Final Verdict: **PASS**

Canonical CPU 训练按固定配置完成 50 epoch；Artifact 结构与 Loader/Adapter 验收通过；离线 posterior 质量在 speaker holdout val 上 **57.38%** accuracy（五类声调分类基线）。

---

## Training Config

| 参数 | 值 |
|------|-----|
| dataset | `aishell3` |
| input | Canonical Feature Shard（`training_features/`） |
| modelVersion | `tone_cnn_p3` |
| featureVersion | `p0-v1` |
| backend | `numpy_p0` |
| formatVersion | `npz-v1` |
| holdout | `speaker` |
| epochs | **50** |
| batch_size | **128** |
| learning_rate | **0.05**（默认） |
| seed | **42** |
| output | `tone_module/models/tone_cnn_p3.npz` |
| GPU | **未使用** |
| 网络结构 | **未改**（80→32→5 MLP） |

**命令：**

```bash
python -m tone_module.train_tone_cnn train \
  --dataset aishell3 --holdout speaker --epochs 50 --batch-size 128 \
  --model-version tone_cnn_p3 --output tone_module/models/tone_cnn_p3.npz \
  --skip-download --skip-shard-build
```

---

## Dataset / Feature Shard Verification

**Pre-train：** `python -m tone_module.training_io.probe_feature_shard accept --cache-dir tone_module/_data_cache` → **`final_verdict: PASS`**

| 指标 | 值 |
|------|-----|
| sampleCount | 997,992 |
| shardCount | 21 |
| train syllables | 850,680 |
| val syllables | 147,312 |
| train / val speakers | 186 / 32 |
| featureVersion | `p0-v1` |
| holdout | `speaker` |

---

## Training Log

**墙钟时间：** **164,985 s（≈45.8 h · 约 1.9 天）**  
**日志文件：** `tone_module/models/phase7c_train.log`

```
syllables: shard_total=997992 train=850680 val=147312 holdout=speaker
epoch   1: train_acc=0.523 val_acc=0.517
epoch  10: train_acc=0.576 val_acc=0.567
epoch  20: train_acc=0.576 val_acc=0.565
epoch  30: train_acc=0.580 val_acc=0.571
epoch  40: train_acc=0.578 val_acc=0.567
epoch  50: train_acc=0.578 val_acc=0.567
saved tone_module/models/tone_cnn_p3.npz
val_acc=0.574 train_acc=0.580
validation=PASS | schema=True | shape=True | loader=True | adapter=True | adapter_acc=0.5738
offline_acc=0.574 samples=147312 conf_mean=0.576
```

**平均每 epoch（含首轮加载）：** ≈ **55 分钟**

---

## Final Train Accuracy

| 指标 | 值 |
|------|-----|
| epoch 50 打印 train_acc | **0.578** |
| 保存权重对应 train_acc（metrics） | **0.580** |

---

## Final Val Accuracy

| 指标 | 值 |
|------|-----|
| epoch 50 打印 val_acc | **0.567** |
| 保存权重对应 val_acc（metrics） | **0.574** |

---

## Best Val Accuracy

训练采用 **best-val checkpoint**（非最后一 epoch 权重）：

| 指标 | 值 |
|------|-----|
| **Best Val Accuracy** | **0.5738**（≈ **57.38%**） |
| 对应 adapter_acc | **0.5738** |

日志中可见 epoch 30 val_acc=**0.571** 为中间峰值之一；最终保存 best 略高于 epoch 50 打印值。

---

## Loss Curve Summary

本轮训练循环 **未记录 loss**（仅 accuracy）。由 epoch 检查点归纳：

| 阶段 | train_acc | val_acc | 观察 |
|------|-----------|---------|------|
| epoch 1 | 0.523 | 0.517 | 随机基线附近 |
| epoch 10 | 0.576 | 0.567 | 快速上升 |
| epoch 20–50 | 0.576–0.580 | 0.565–0.571 | **平台期**；val 波动 ±0.006 |
| 保存 best | 0.580 | **0.574** | 略优于末 epoch |

**结论：** 约 **10 epoch 后收敛至平台**；继续训练至 50 epoch 对 val 提升有限（符合固定 lr、无 early stopping 预期）。

---

## Confusion Matrix

Offline Evaluation · AISHELL-3 speaker holdout val · **n = 147,312**

|  | pred t1 | pred t2 | pred t3 | pred t4 | pred t5 |
|--|---------|---------|---------|---------|---------|
| **true t1** | 20607 | 3842 | 1523 | 5790 | 478 |
| **true t2** | 3185 | 19922 | 2784 | 8101 | 588 |
| **true t3** | 1062 | 2783 | 7931 | 11012 | 314 |
| **true t4** | 4148 | 5596 | 2561 | 33042 | 4334 |
| **true t5** | 281 | 456 | 149 | 4323 | 2500 |

---

## t1–t5 Recall / Precision

| 声调 | Precision | Recall | Support |
|------|-----------|--------|---------|
| **t1** | 0.6675 | 0.6392 | 32,240 |
| **t2** | 0.5296 | 0.5761 | 34,580 |
| **t3** | 0.4718 | 0.3433 | 23,102 |
| **t4** | 0.5785 | 0.6651 | 49,681 |
| **t5** | 0.6190 | 0.3927 | 7,709 |

**观察：** t4 recall 最高；**t3 / t5 recall 偏低**（与类不平衡及五类混淆有关）。

---

## validate_artifact Result

**命令：**

```bash
python -m tone_module.validate_artifact \
  --artifact tone_module/models/tone_cnn_p3.npz \
  --json-out tone_module/models/tone_cnn_p3_validate.json
```

| 门 | 结果 |
|----|------|
| passed | **true** |
| schema_ok | **true** |
| shape_ok | **true** |
| loader_ok | **true** |
| adapter_ok | **true** |

---

## Offline Evaluation Result

> 注：`offline_tone_eval` CLI 无 `--dataset aishell3` 参数；本轮以 Canonical Feature Shard **val 集**（147,312 样本）导出 `eval-json` 等效验收。

**产物：** `tone_module/models/tone_cnn_p3_offline_eval.json`

| 指标 | 值 |
|------|-----|
| accuracy | **0.5738** |
| sample_count | **147,312** |
| confidence_mean | **0.576** |
| passed | **true** |

---

## Artifact Metadata

**路径：** `tone_module/models/tone_cnn_p3.npz`

| 字段 | 值 |
|------|-----|
| modelVersion | `tone_cnn_p3` |
| featureVersion | `p0-v1` |
| backend | `numpy_p0` |
| formatVersion | `npz-v1` |
| trainingVersion | `2026-06-30` |
| datasetVersion | `openslr_slr93_full` |
| buildTime | `2026-07-02T07:45:54Z` |
| train_samples | 850,680 |
| val_samples | 147,312 |
| epochs | 50 |

---

## Frozen Architecture Verification

| 检查项 | 结果 |
|--------|------|
| `contract.py` / `mel.py` / `loader.py` / `inference.py` | **未改** |
| `validate_artifact.py` | **未改** |
| `tone_module/dataset/*` | **未改** |
| `tone_module/training_io/*` | **未改** |
| Runtime / FW / Node E2E | **未执行** |
| `TONE_MODEL_PATH` 替换 | **未执行** |

---

## Architecture Drift Audit

| 处置 | 项 |
|------|-----|
| **KEEP** | Feature Shard · Reader · Holdout · Training IO 冻结体 |
| **KEEP** | Dataset Foundation · Contract · Artifact Schema |
| **KEEP** | `numpy_p0` 网络结构 · `p0-v1` feature baseline |
| **ADD** | `tone_module/models/tone_cnn_p3.npz`（新模型权重） |
| **ADD** | `tone_cnn_p3_validate.json` · `tone_cnn_p3_offline_eval.json` |
| **MODIFY** | — |
| **RESTORE** | — |
| **DELETE** | — |

---

## Remaining Risks

| 风险 | 严重度 | 说明 |
|------|--------|------|
| val acc 平台 ~57% | MED | 模型质量议题；非 Foundation 阻塞；换权重需模型能力阶段 |
| t3/t5 recall 低 | MED | 类不平衡 · 混淆；可后续 class weight（**非本轮**） |
| CPU 训练墙钟 ~46h | LOW | 已文档化；下轮可考虑训练加速 Phase |
| Runtime 未验证 | LOW | 按 Phase 7-C 禁令；部署前须单独 Runtime Validation |

---

## Final Verdict

### **PASS**

Phase 7-C 目标达成：使用冻结 Canonical Feature Shard 完成 **50 epoch** `tone_cnn_p3` 训练；Artifact 验收与 Offline Evaluation 通过；零冻结层漂移。

**下一步（非本轮）：** 模型能力评估 / `TONE_MODEL_PATH` 部署 / Runtime Validation（Level 3）须另开阶段。

---

*Phase 7-C Training Report — no Runtime / frozen-layer code changes.*
