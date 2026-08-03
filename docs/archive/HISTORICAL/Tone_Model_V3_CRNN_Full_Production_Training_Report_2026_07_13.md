<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Tone_Model_V3_CRNN_Full_Production_Training_Report_2026_07_13.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Tone Model V3 CRNN Full Production Training Report

**Date:** 2026-07-13  
**Verdict:** B — CRNN Full Candidate Improved but Below Target  
**Git:** `262b3d32717db97807fa48103aa44f1ea518361a`

## 1. Executive Summary

CRNN V3 full training complete. NumPy full-val acc 0.8356 vs CNN V2 0.8248 (Δ +0.0108). Parity=PASS, latency=PASS. Verdict: B — CRNN Full Candidate Improved but Below Target.

## 2. Frozen Scope

Feature `(64,83)` · `p1-frame-mel-f0-v1` · CPU NumPy inference · AISHELL-3 997,992 cache unchanged.

## 3. Optimized NumPy Backend Promotion

`crnn_v3.py` 现为唯一正式 `numpy_crnn_v1` 推理路径；慢实现保留于 `crnn_v3_baseline.py`（测试参考）。

## 4. Torch Lazy Import Cleanup

`loader_v1` 对 `config.TONE_MODEL_PATH` 做 lazy-import；inference-only 子进程经 `numpy_crnn_v1` 不 import torch。

## 5. Dataset / Cache Verification

```json
{
  "verified": true,
  "sampleCount": 997992,
  "trainCount": 850680,
  "valCount": 147312,
  "featureVersion": "p1-frame-mel-f0-v1",
  "datasetId": "openslr_aishell3",
  "cacheSchemaVersion": "training_feature_shard_v2",
  "seed": 42,
  "valRatio": 0.15,
  "splitChecksum": null
}
```

## 6. CRNN Architecture

`conv1d_bigru_v1` · 227,013 params · BiGRU(128→96) bidirectional

## 7. Training Configuration

AdamW lr=3e-4 · wd=1e-2 · batch=128 · Cosine · AMP · grad_clip=1 · max_epochs=60 · patience=10 · CE loss

## 8. GPU Training Results

- best_epoch: **27**
- best_val_acc (train metric): **0.8357**
- total_epochs_run: 37
- total_duration_sec: 4063.626

## 9. Epoch History

见 `training_metrics_crnn_full_20260713.json` 中 `epoch_history`。

## 10. Full Validation (147,312)

- val_acc: **0.8356**
- macro_f1: **0.8219**

## 11. Per-class Metrics

- t1: 0.8619
- t2: 0.8531
- t3: 0.7686
- t4: 0.8508
- t5: 0.7504

## 12. Confusion Matrix

```
[27789, 2086, 567, 1710, 88]
[1641, 29501, 2195, 943, 300]
[328, 1640, 17757, 3112, 265]
[2317, 1265, 3408, 42267, 424]
[147, 489, 561, 727, 5785]
```

## 13. CNN V2 vs CRNN V3

| Metric | CNN V2 | CRNN V3 | Δ |
|--------|-------:|--------:|--:|
| val_acc | 0.8248 | 0.8356 | +0.0108 |
| macro F1 | 0.8097 | 0.8219 | +0.0122 |
| t1 | 0.8520 | 0.8619 | +0.0099 |
| t2 | 0.8360 | 0.8531 | +0.0171 |
| t3 | 0.7380 | 0.7686 | +0.0306 |
| t4 | 0.8510 | 0.8508 | -0.0002 |
| t5 | 0.7510 | 0.7504 | -0.0006 |
| t3→t4 | 3562 | 3112 | -450 |
| t4→t3 | 3226 | 3408 | +182 |

## 14. Artifact Metadata

- Path: `D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad\tone_module\models\candidate\tone_crnn_v3_full_candidate_20260713.npz`
- trainingVersion: `crnn_v3_full_candidate_20260713`

## 15. Torch→NumPy Parity

**PASS:** True

## 16. CPU NumPy Benchmark

```json
{
  "batches": {
    "1": {
      "p50Ms": 20.18185000633821,
      "p95Ms": 21.259185005328618,
      "meanMs": 19.256676999211777,
      "peakMemoryBytes": 286882,
      "torchImported": false,
      "ctranslate2Imported": false
    },
    "8": {
      "p50Ms": 25.849099998595193,
      "p95Ms": 28.58596001751721,
      "meanMs": 26.09410499833757,
      "peakMemoryBytes": 2044077,
      "torchImported": false,
      "ctranslate2Imported": false
    },
    "16": {
      "p50Ms": 36.17099999974016,
      "p95Ms": 40.91112999885809,
      "meanMs": 36.76147099962691,
      "peakMemoryBytes": 4052431,
      "torchImported": false,
      "ctranslate2Imported": false
    },
    "20": {
      "p50Ms": 41.218400016077794,
      "p95Ms": 50.363555001968045,
      "meanMs": 42.04768699913984,
      "peakMemoryBytes": 5055921,
      "torchImported": false,
      "ctranslate2Imported": false
    },
    "32": {
      "p50Ms": 56.80265001137741,
      "p95Ms": 69.98527999530779,
      "meanMs": 60.45953099965118,
      "peakMemoryBytes": 8078721,
      "torchImported": false,
      "ctranslate2Imported": false
    },
    "40": {
      "p50Ms": 69.0457000018796,
      "p95Ms": 83.43157499912195,
      "meanMs": 72.55236400087597,
      "peakMemoryBytes": 10075889,
      "torchImported": false,
      "ctranslate2Imported": false
    }
  },
  "latencyPass": true,
  "isolationPass": true
}
```

## 17. GPU Isolation

Subprocess isolation pass: **True**

## 18. Compatibility Matrix

```json
{
  "cnnV2Loads": true,
  "crnnLoads": true,
  "noFallback": true
}
```

## 19. Remaining Risks

- Full-val NumPy 验收与训练期 torch val_acc 可能有微小数值差。
- loader 在 `load()` 时仍经 config 路径（lazy 仅模块 import 级）。

## 20. Business Validation Recommendation

CRNN 全量优于 CNN V2（overall +1.08pp，t3 +3.06pp，t3→t4 混淆 -450），工程验收全部 PASS，但未达 0.89 Promotion 线。建议：**可进入有限 Business Validation 对比**（验证实际 tone 收益），但**不得 Promotion**，且需接受 t5 基本持平、未达 90% 目标。

## 21. Audit Q&A（18 项）

| # | 问题 | 结论 |
|---|------|------|
| 1 | 优化版 numpy_crnn_v1 正式唯一？ | **是** — `crnn_v3.py` 为正式路径 |
| 2 | inference-only 不 import torch？ | **是** — 子进程验证通过 |
| 3 | 全量训练完成？ | **是** — 850,680 train / 147,312 val |
| 4 | 实际 Epoch 数？ | **37**（early stop） |
| 5 | Best Epoch？ | **27** |
| 6 | Best val_acc？ | **0.8357**（训练）/ **0.8356**（NumPy 全量验收） |
| 7 | 达到 ≥0.89？ | **否** |
| 8 | 相比 CNN V2？ | **+1.08 pp** overall |
| 9 | t3 提升？ | **是** — +3.06 pp（0.7686 vs 0.738） |
| 10 | t5 提升？ | **基本持平** — 0.7504 vs 0.751（-0.06 pp） |
| 11 | t3↔t4 混淆下降？ | **t3→t4 下降 450**；t4→t3 略升 182 |
| 12 | Macro F1 提升？ | **是** — +1.22 pp（0.8219 vs 0.8097） |
| 13 | Parity PASS？ | **是** |
| 14 | CPU 性能 PASS？ | **是** — batch20 p95 50.4ms，batch40 p95 83.4ms |
| 15 | GPU delta=0？ | **是** |
| 16 | Artifact 独立保存？ | **是** — `tone_crnn_v3_full_candidate_20260713.npz` |
| 17 | 值得 Business Validation？ | **有条件可以** — 工程可行且整体优于 V2，但未达 Promotion |
| 18 | Promotion Candidate？ | **否** — val_acc < 0.89 |

## 22. Final Verdict

### B — CRNN Full Candidate Improved but Below Target

