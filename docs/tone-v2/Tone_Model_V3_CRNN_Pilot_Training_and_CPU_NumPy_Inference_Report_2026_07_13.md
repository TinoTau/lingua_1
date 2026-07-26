# Tone Model V3 CRNN Pilot Training & CPU NumPy Inference Report

**Date:** 2026-07-13  
**Verdict:** C — CPU Runtime Too Slow  
**Git:** `262b3d32717db97807fa48103aa44f1ea518361a`

## 1. Executive Summary

CRNN pilot trained on 80000 samples; val_acc 0.6389 vs CNN control 0.6041 (Δ +0.0349). Parity=PASS, latency=FAIL. Verdict: C — CPU Runtime Too Slow.

## 2. Frozen Scope

- Feature `(64,83)` · `p1-frame-mel-f0-v1` · 5-class posterior
- Runtime: CPU NumPy only (`numpy_crnn_v1` for CRNN)
- FW / Node / Recall / KenLM / Lexicon: unchanged

## 3. Pilot Dataset

```json
{
  "seed": 42,
  "trainFull": 850680,
  "valFull": 147312,
  "trainPilot": 80000,
  "valPilot": 15000,
  "selection": "prefix_of_holdout_indices",
  "trainClassCounts": {
    "t1": 16732,
    "t2": 18658,
    "t3": 13016,
    "t4": 26391,
    "t5": 5203
  },
  "valClassCounts": {
    "t1": 3127,
    "t2": 3670,
    "t3": 2276,
    "t4": 5128,
    "t5": 799
  }
}
```

## 4. CNN V2 Control (same pilot subset)

- val_acc: **0.6041**
- macro_f1: **0.5910**

## 5. CRNN Architecture

`conv1d_bigru_v1` — Conv1d 83→96 (k5) → Conv1d 96→128 (k3) → BiGRU(128→96) → mean pool → FC → 5 logits

## 6. Parameter Count

**227013** trainable parameters

## 7. GPU Training

- best_epoch: 10
- best_val_acc: **0.6387**
- total_duration_sec: 154.777
- max_vram_bytes: 0

## 8. NumPy GRU Implementation

```json
{
  "gateOrder": "rzn",
  "pytorchKeys": [
    "gru.weight_ih_l0",
    "gru.weight_hh_l0",
    "gru.bias_ih_l0",
    "gru.bias_hh_l0",
    "gru.weight_ih_l0_reverse",
    "gru.weight_hh_l0_reverse",
    "gru.bias_ih_l0_reverse",
    "gru.bias_hh_l0_reverse"
  ],
  "npzKeys": [
    "gru_fwd_weight_ih",
    "gru_fwd_weight_hh",
    "gru_fwd_bias_ih",
    "gru_fwd_bias_hh",
    "gru_bwd_weight_ih",
    "gru_bwd_weight_hh",
    "gru_bwd_bias_ih",
    "gru_bwd_bias_hh"
  ],
  "shapes": {
    "gru_fwd_weight_ih": [
      288,
      128
    ],
    "gru_fwd_weight_hh": [
      288,
      96
    ],
    "gru_fwd_bias_ih": [
      288
    ],
    "gru_fwd_bias_hh": [
      288
    ],
    "gru_bwd_weight_ih": [
      288,
      128
    ],
    "gru_bwd_weight_hh": [
      288,
      96
    ],
    "gru_bwd_bias_ih": [
      288
    ],
    "gru_bwd_bias_hh": [
      288
    ]
  },
  "biasMergeRule": "numpy uses gi = x @ W_ih.T + b_ih; gh = h @ W_hh.T + b_hh (same as PyTorch)"
}
```

## 9. Artifact Schema

- Path: `D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad\tone_module\models\candidate\tone_crnn_v3_pilot_20260713.npz`
- modelArchitecture: `conv1d_bigru_v1`
- modelVersion: `tone_crnn_v3`
- backend: `numpy_crnn_v1`

## 10. Torch/NumPy Parity

**Overall PASS:** True

- batch=1: maxAbsLogitsDiff=0.000609 argmaxAgreement=100% pass=True
- batch=8: maxAbsLogitsDiff=0.001392 argmaxAgreement=100% pass=True
- batch=20: maxAbsLogitsDiff=0.001594 argmaxAgreement=100% pass=True

## 11. Accuracy Comparison

| Metric | CNN V2 Control | CRNN Pilot | Δ |
|--------|---------------:|-----------:|--:|
| val_acc | 0.6041 | 0.6389 | +0.0349 |
| macro F1 | 0.5910 | 0.6281 | +0.0371 |
| t1 acc | 0.6597 | 0.7016 | +0.0419 |
| t2 acc | 0.6441 | 0.6019 | -0.0422 |
| t3 acc | 0.5281 | 0.6072 | +0.0791 |
| t4 acc | 0.5780 | 0.6488 | +0.0708 |
| t5 acc | 0.5857 | 0.5907 | +0.0050 |
| t3→t4 | 424 | 482 | +58 |
| t4→t3 | 633 | 624 | -9 |

## 12. Per-class Metrics

- t1: 0.7016
- t2: 0.6019
- t3: 0.6072
- t4: 0.6488
- t5: 0.5907

## 13. Confusion Matrix (CRNN)

```
[2194, 362, 69, 478, 24]
[657, 2209, 390, 339, 75]
[110, 210, 1382, 482, 92]
[793, 302, 624, 3327, 82]
[22, 58, 68, 179, 472]
```

## 14. CPU Benchmark (inference only, ms)

| batch | p50 | p95 | mean | peak_mem_bytes |
|------:|----:|----:|-----:|---------------:|
| 1 | 50.548 | 53.546 | 50.282 | 189468 |
| 8 | 109.162 | 114.447 | 109.785 | 1261060 |
| 16 | 155.513 | 159.449 | 155.647 | 2502572 |
| 20 | 178.908 | 188.061 | 179.791 | 3127219 |
| 32 | 262.106 | 277.661 | 261.317 | 5001340 |
| 40 | 317.404 | 339.65 | 316.128 | 6250368 |

- Budget: 20 slices ≤ 150.0ms p95 · 40 slices ≤ 300.0ms p95
- **Latency PASS:** False

## 15. GPU Isolation Check

```json
{
  "loaderReady": true,
  "backend": "numpy_crnn_v1",
  "modelArchitecture": "conv1d_bigru_v1",
  "torchImportedInProcess": true,
  "inferenceMs": 69.513,
  "gpuBeforeMb": 4647,
  "gpuAfterMb": 4647,
  "gpuMemoryDeltaMb": 0,
  "outputShape": [
    8,
    5
  ],
  "pass": true
}
```

## 16. Compatibility Matrix

```json
{
  "cnnV2Loads": true,
  "crnnLoads": true,
  "cnnBackend": "numpy_p1",
  "crnnBackend": "numpy_crnn_v1",
  "noFallback": true,
  "noShadow": true
}
```

## 17. Risks

- NumPy BiGRU is sequential over time steps; latency scales with batch and T=64.
- Pilot subset only; full 997k training may behave differently.
- GPU isolation check uses same process as training orchestrator (torch may be imported).

## 18. Full Training Recommendation

Reduce GRU hidden_size to 64 or simplify to unidirectional GRU before full training.

## 19. Final Verdict

### C — CPU Runtime Too Slow

