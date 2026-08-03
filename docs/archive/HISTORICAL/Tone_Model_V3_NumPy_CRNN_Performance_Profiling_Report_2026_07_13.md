<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Tone_Model_V3_NumPy_CRNN_Performance_Profiling_Report_2026_07_13.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Tone Model V3 NumPy CRNN Performance Profiling Report

**Date:** 2026-07-13  
**Verdict:** A — NumPy CRNN Performance Passed  

## 1. Executive Summary

Dominant stage: **08_gru_forward**. GRU fwd+bwd ≈ 88.3% of staged time (batch=20). Optimized p95: batch20 **38.871ms** (baseline 185.752ms), batch40 **66.155ms** (baseline 316.062ms). Budget PASS: True. Parity PASS: True.

## 2. Baseline Environment

- Artifact: `D:\Programs\github\lingua_1\electron_node\services\faster_whisper_vad\tone_module\models\candidate\tone_crnn_v3_pilot_20260713.npz`
- OMP_NUM_THREADS: 1

## 3. CPU / NumPy / BLAS Info

```json
{
  "numpyVersion": "2.2.6",
  "ompNumThreads": "4",
  "mklNumThreads": "4",
  "openblasNumThreads": "4",
  "blasInfo": "None"
}
```

## 4. Stage Profiling (baseline, batch=20)

| Stage | mean (ms) | p95 (ms) | % |
|-------|----------:|---------:|--:|
| 01_input_norm | 0.1608 | 0.1887 | 0.11% |
| 02_transpose_layout | 0.006 | 0.0071 | 0.0% |
| 03_conv1 | 7.598 | 9.0381 | 5.39% |
| 04_bn1_relu | 0.5095 | 0.6112 | 0.36% |
| 05_conv2 | 7.2444 | 8.7385 | 5.14% |
| 06_bn2_relu | 0.6184 | 0.7295 | 0.44% |
| 07_seq_transpose | 0.0067 | 0.0087 | 0.0% |
| 08_gru_forward | 62.1888 | 66.1803 | 44.14% |
| 09_gru_backward | 62.1499 | 65.8295 | 44.12% |
| 10_bidir_concat | 0.1451 | 0.1875 | 0.1% |
| 11_temporal_pool | 0.1404 | 0.1695 | 0.1% |
| 12_fc1_relu | 0.0513 | 0.0661 | 0.04% |
| 13_fc2_logits | 0.0144 | 0.0253 | 0.01% |
| 14_softmax | 0.0414 | 0.0509 | 0.03% |

## 5. GRU Internal Profiling

```json
{
  "bwd_activations": {
    "meanMs": 4.7676,
    "perStepUs": 74.495
  },
  "bwd_gi_total": {
    "meanMs": 52.6675,
    "perStepUs": 822.929
  },
  "bwd_h_matmul": {
    "meanMs": 3.2203,
    "perStepUs": 50.317
  },
  "bwd_hidden_update": {
    "meanMs": 0.7606,
    "perStepUs": 11.885
  },
  "bwd_loop_overhead": {
    "meanMs": 0.0,
    "perStepUs": 0.0
  },
  "bwd_split": {
    "meanMs": 0.3359,
    "perStepUs": 5.249
  },
  "bwd_x_matmul": {
    "meanMs": 0.0814,
    "perStepUs": 1.272
  },
  "fwd_activations": {
    "meanMs": 4.8863,
    "perStepUs": 76.349
  },
  "fwd_gi_total": {
    "meanMs": 52.5456,
    "perStepUs": 821.026
  },
  "fwd_h_matmul": {
    "meanMs": 3.2076,
    "perStepUs": 50.119
  },
  "fwd_hidden_update": {
    "meanMs": 0.7909,
    "perStepUs": 12.359
  },
  "fwd_loop_overhead": {
    "meanMs": 0.0,
    "perStepUs": 0.0
  },
  "fwd_split": {
    "meanMs": 0.3509,
    "perStepUs": 5.483
  },
  "fwd_x_matmul": {
    "meanMs": 0.0828,
    "perStepUs": 1.294
  }
}
```


## 6. Allocation / Copy Analysis

- Baseline: per-step `x_t @ W_ih.T` (transpose each step in profiled path); pre-alloc `outputs` zeros.
- Baseline: `np.concatenate([fwd,bwd])` allocates full `(N,T,2H)` copy.
- Baseline Conv: Python loop over T with einsum per step.
- Optimized: batched `seq @ W_ih_T` once per direction; fused BN; vectorized conv; in-place bidir write.

## 7. Optimization Changes

1. Pre-transpose GRU weights at prepare time
2. Batched input gate projection `(N,T,C) @ (C,3H)`
3. Fused BN scale/shift
4. Vectorized Conv1d via sliding_window_view
5. Pre-allocated bidirectional GRU output buffer (no concat)
6. In-place ReLU where safe

## 8. Baseline vs Optimized

| Batch | Baseline p50 | Opt p50 | Δ | Baseline p95 | Opt p95 | Δ |
|------:|-------------:|--------:|--:|-------------:|--------:|--:|
| 1 | 43.99 | 13.401 | -30.6 | 56.824 | 15.992 | -40.8 |
| 8 | 92.076 | 20.458 | -71.6 | 111.416 | 24.145 | -87.3 |
| 16 | 139.783 | 30.057 | -109.7 | 161.561 | 32.883 | -128.7 |
| 20 | 160.588 | 34.14 | -126.4 | 185.752 | 38.871 | -146.9 |
| 32 | 235.795 | 48.777 | -187.0 | 267.353 | 55.37 | -212.0 |
| 40 | 286.478 | 60.392 | -226.1 | 316.062 | 66.155 | -249.9 |

## 9. Numerical Parity

```json
{
  "batches": {
    "1": {
      "baselineVsOptimizedMaxAbsLogits": 7.152557373046875e-07,
      "baselineVsOptimizedArgmaxAgreement": 1.0,
      "posteriorMaxAbsDiff": 7.450580596923828e-09,
      "fwdHiddenMaxAbsDiff": 9.5367431640625e-07,
      "bwdHiddenMaxAbsDiff": 5.960464477539062e-07,
      "pooledMaxAbsDiff": 2.086162567138672e-07,
      "pass": true
    },
    "8": {
      "baselineVsOptimizedMaxAbsLogits": 5.364418029785156e-07,
      "baselineVsOptimizedArgmaxAgreement": 1.0,
      "posteriorMaxAbsDiff": 1.1920928955078125e-07,
      "fwdHiddenMaxAbsDiff": 9.229406714439392e-07,
      "bwdHiddenMaxAbsDiff": 1.6689300537109375e-06,
      "pooledMaxAbsDiff": 2.5331974029541016e-07,
      "pass": true
    },
    "20": {
      "baselineVsOptimizedMaxAbsLogits": 1.1920928955078125e-06,
      "baselineVsOptimizedArgmaxAgreement": 1.0,
      "posteriorMaxAbsDiff": 2.384185791015625e-07,
      "fwdHiddenMaxAbsDiff": 9.387731552124023e-07,
      "bwdHiddenMaxAbsDiff": 1.043081283569336e-06,
      "pooledMaxAbsDiff": 3.948807716369629e-07,
      "pass": true
    },
    "40": {
      "baselineVsOptimizedMaxAbsLogits": 1.1920928955078125e-06,
      "baselineVsOptimizedArgmaxAgreement": 1.0,
      "posteriorMaxAbsDiff": 2.980232238769531e-07,
      "fwdHiddenMaxAbsDiff": 7.748603820800781e-07,
      "bwdHiddenMaxAbsDiff": 1.043081283569336e-06,
      "pooledMaxAbsDiff": 3.948807716369629e-07,
      "pass": true
    }
  },
  "parityPass": true
}
```

## 10. Memory

- batch=1: baseline peak 189488 B, optimized 287078 B
- batch=20: baseline peak 3126976 B, optimized 5055842 B
- batch=40: baseline peak 6250176 B, optimized 10076002 B

## 11. Torch/GPU Isolation

```json
{
  "torchImported": false,
  "ctranslate2Imported": false,
  "backend": "numpy_crnn_v1",
  "outputShape": [
    8,
    5
  ],
  "gpuMemoryUsedMb": 5798,
  "gpuMemoryDeltaMb": 0,
  "loaderImportChainNote": "ToneModelLoaderV1 imports config\u2192ctranslate2 (torch appears in sys.modules); inference-only import chain is clean.",
  "pass": true
}
```

## 12. Budget Validation

- batch=20 p95 budget ≤150.0ms: **PASS** (38.871ms)
- batch=40 p95 budget ≤300.0ms: **PASS** (66.155ms)

## 13. Remaining Bottleneck

优化后 GRU 仍占主要时间，但已降至预算内。残余开销来自 **T=64 逐步 recurrent `h @ W_hh.T`**（每方向约 3.2ms）及 activation，已无法在不改架构前提下再降一个数量级。

## 14. Audit Q&A（17 项）

| # | 问题 | 结论 |
|---|------|------|
| 1 | 总耗时最大阶段？ | **GRU forward**（44.1% staged）；GRU fwd+bwd 合计 **88.3%** |
| 2 | Conv 占比？ | **10.5%**（conv1 5.4% + conv2 5.1%） |
| 3 | GRU forward 占比？ | **44.1%** |
| 4 | GRU backward 占比？ | **44.1%** |
| 5 | Python loop overhead？ | 逐步 `gi` 计算占 GRU **~84%**（52.5ms/62ms）；纯 loop 调度开销较小 |
| 6 | input projection 可批量？ | **是** — `seq @ W_ih_T` 一次得到 `(N,T,3H)`，优化后验证有效 |
| 7 | 重复 weight transpose？ | **是** — baseline 每步 `W_ih.T`；优化在 prepare 时缓存 |
| 8 | 重复临时数组？ | **是** — baseline concat、逐步 slice；优化预分配 bidir buffer |
| 9 | flip/concat 大复制？ | baseline **concat** 有 `(N,T,2H)` 复制；backward 用反向索引无 flip |
| 10 | float32 贯穿？ | **是**，全程 float32 |
| 11 | 最优 BLAS 线程？ | baseline batch=20：**OMP=4** p95 170.7ms 优于 OMP=1 的 192.2ms |
| 12 | 优化后 p50/p95？ | batch20 **34.1/38.9ms**；batch40 **60.4/66.2ms**（OMP=1） |
| 13 | 达到 20/40 预算？ | **是**（20≤150ms，40≤300ms；亦达推荐目标 120/240ms） |
| 14 | 数值 parity？ | **PASS**（argmax 100%，maxAbsLogits ≤1.2e-6） |
| 15 | 纯 Runtime 不 import torch？ | **推理链 PASS**；`loader_v1→config→ctranslate2` 会间接引入 torch（需后续 lazy-import） |
| 16 | 值得全量训练？ | **是** — 在推广 optimized backend 后进入全量 CRNN 训练 |
| 17 | 若仍不达标下一步？ | 当前已达标；若未来回退，优先 **hidden 96→64**，而非放弃 CRNN |

### BLAS 线程扫描（baseline, batch=20）

| OMP_THREADS | p50 (ms) | p95 (ms) |
|------------:|---------:|---------:|
| 1 | 164.3 | 192.2 |
| 2 | 163.0 | 177.7 |
| 4 | 161.9 | 170.7 |

## 15. Full Training Recommendation

1. 将 `crnn_v3_optimized.py` / `PreparedCrnnWeightsV3` 推广为 `numpy_crnn_v1` 正式实现（保持 artifact 与架构不变）。
2. `loader_v1` 对 `config` 做 lazy-import，消除 Runtime 中间接 torch 依赖。
3. 在相同超参下启动 **997,992 全量 CRNN 训练**。

## 16. Final Verdict

### A — NumPy CRNN Performance Passed

满足：优化后 batch20 p95 **38.9ms**、batch40 p95 **66.2ms**；parity PASS；纯推理子进程无 torch/CUDA；GPU delta=0。

**说明：** Pilot 报告中的 baseline（20/188ms、40/340ms）与本轮 baseline 测量一致；瓶颈在实现而非模型结构。

