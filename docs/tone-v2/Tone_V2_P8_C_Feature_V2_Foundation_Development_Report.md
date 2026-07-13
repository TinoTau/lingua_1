# Tone V2 P8-C — Feature V2 Foundation 开发报告

**Date:** 2026-07-04  
**Phase:** P8-C Feature V2 Foundation（开发轮次）  
**依据 SSOT：**

- [Tone V2 P8-C Feature V2 Foundation Development Specification.md](./Tone%20V2%20P8-C%20Feature%20V2%20Foundation%20Development%20Specification.md)
- [Tone V2 P8-C — Feature V2 Foundation Implementation Addendum.md](./Tone%20V2%20P8-C%20%E2%80%94%20Feature%20V2%20Foundation%20Implementation%20Addendum.md)
- [Tone V2 P8-C — Feature Contract Specification.md](./Tone%20V2%20P8-C%20%E2%80%94%20Feature%20Contract%20Specification.md)
- [Tone_V2_P8_FeatureV2_Syllable_Duration_Frame_Length_Audit_Report.md](./Tone_V2_P8_FeatureV2_Syllable_Duration_Frame_Length_Audit_Report.md)
- [Tone_V2_P8_B_Feature_V2_Contract_Foundation_PreDev_Audit_Report.md](./Tone_V2_P8_B_Feature_V2_Contract_Foundation_PreDev_Audit_Report.md)

---

## Executive Summary

| 项 | 结果 |
|----|------|
| Feature V2 Foundation 实现 | **完成** — 单 `extract_feature` · Adapter · Shard V2 · P1 Contract 常量 |
| p0 Runtime 主链 | **KEEP 冻结** — `inference.py` / `mel.py` / `loader` / `numpy_p0` 未改行为 |
| Training 主链 R-01 | **RESTORE** — V2 构建经 `SyllableSample → Adapter → WordInfo → extract_feature` |
| Boundary Consistency Gate | **RESTORE** — `require_boundary_consistency_pass` 先于 Shard V2 构建 |
| Regression Gates §8 | **PASS** — `test_phase8_*` 18 项全绿；Phase 2/3/7B 回归全绿 |
| Runtime V2 推理 / V2 模型 | **未在本轮** — 待 Model Capability 阶段；Semantic Acceptance 仍走 p0 Posterior→Recall |
| **Final Verdict** | **CONDITIONAL PASS** — Foundation 可冻结；V2 模型接入 Runtime 为后续阶段 |

---

## 1. 开发前架构漂移核对

| Expected（冻结设计） | Actual（开发前） | Impact | 处理 |
|---------------------|------------------|--------|------|
| 单 `extract_feature(audio, sr, wordInfo)` | 切片三处 + `extract_mel_features(audio)` | Training/Runtime 分叉风险 | **MODIFY** — 新增 `feature_v2.extract_feature` |
| Training 经 WordInfo Adapter | `feature_shard.py` 直连 `SyllableSample` | 违反 R-01 | **MODIFY** — 新增 `feature_shard_v2.py` + Adapter |
| `training_feature_shard_v2` (64,83) | 仅 v1 `(N,80)` | V2 不可用 | **MODIFY** — 新 schema / reader |
| Boundary Gate 先于 Canonical V2 | 无 | RG-04 缺失 | **RESTORE** — `boundary_consistency.py` |
| p0 冻结 | p0 完整 | — | **KEEP** |
| Posterior→Recall 主链 | 已接线（p0） | — | **KEEP** |

---

## 2. 实现清单

### 2.1 Feature Foundation

| 文件 | 职责 |
|------|------|
| `tone_module/contract.py` | 新增 `P1_*` / `ToneFeatureBaselineV1` / `P1_FEATURE_SHAPE` |
| `tone_module/feature_v2.py` | **唯一** `extract_feature`；DSP · F0 · 插值 · crop · `(64,83)` 组装 |
| `tone_module/training_io/syllable_to_wordinfo.py` | Adapter：仅字段转换 |
| `tone_module/training_io/boundary_consistency.py` | M-10 Boundary Gate |
| `tone_module/training_io/feature_shard_v2.py` | Shard V2 构建（`training_features_v2/`） |
| `tone_module/training_io/shard_reader_v2.py` | 只读 Feature Tensor |

### 2.2 Training Engineering

| 入口 | 说明 |
|------|------|
| `python -m tone_module.train_tone_cnn build-feature-shards-v2 ...` | Canonical V2 Shard 构建 CLI |
| `build_feature_shards_v2_for_dataset()` | 与 v1 并行；不替换 v1 |

### 2.3 验收测试

| 文件 | Addendum §8 映射 |
|------|------------------|
| `test_phase8_feature_contract.py` | DSP / Tensor / Version / Extractor Contract |
| `test_phase8_feature_equality.py` | Feature Equality · FP-23 |
| `test_phase8_boundary_consistency.py` | Boundary Consistency Gate |
| `test_phase8_shard_contract.py` | Feature Shard Contract |
| `test_phase8_runtime_mainline.py` | Runtime Mainline 未改 · 无双 Pipeline |

---

## 3. 冻结数值契约（`contract.py` P1_*）

| 契约项 | 冻结值 | 来源 |
|--------|--------|------|
| `featureVersion` | `p1-frame-mel-f0-v1` | P8-C §13.1 |
| `featureShape` | `(64, 83)` | Feature Contract Spec §4–5 |
| `sampleRate` | 16000 | P8 时长审计 |
| STFT | `n_fft=400` · `hop=160` · 25ms/10ms | P8 时长审计 |
| Mel | 80 · fmin 50 · fmax 7600 · log10 | P8-B + p0 对齐 |
| Interpolation | `duration_normalized_linear_interp` | P8 时长 + Addendum M-03 |
| Overflow | `center_crop_if_raw_frames_gt_fixed` | P8 时长 §Recommendation |
| F0 | `frame_lag_autocorrelation_v1` · voiced corr ≥ 0.3 | Contract Spec §9–11 类目落地于 `P1_F0_*` |
| Equality 容差 | `max_abs_diff ≤ 1e-5` | Feature Contract Spec §16 |
| Shard schema | `training_feature_shard_v2` | P8-C §22 |

**说明：** Feature Contract Spec §9–11 仅列类目名；本轮将 F0/ΔF0/Voiced **具体算法与常量** 冻结于 `contract.P1_F0_*`，由 `feature_v2.py` 实现（FP-21：Extractor 实现 Contract）。

---

## 4. KEEP / MODIFY / RESTORE / DELETE

| 动作 | 对象 | 说明 |
|------|------|------|
| **KEEP** | `mel.py` · `inference.py` · `loader.py` · `numpy_p0` · `feature_shard.py` v1 | p0 生产主链 |
| **KEEP** | dedup 前 Tone · `AcousticToneSlice`→Recall | Runtime 决策链 |
| **KEEP** | `SyllableSample` 停留 Dataset Foundation | FC-06 |
| **MODIFY** | 新增 V2 Foundation 模块（上表） | 并行于 p0 |
| **RESTORE** | R-01 训练路径（V2 builder） | Adapter→Extractor |
| **RESTORE** | R-04 Boundary 先于 Shard V2 | `require_boundary_consistency_pass` |
| **DELETE** | V2 路径中直连 SyllableSample→Feature | v2 builder 禁止 `extract_mel_features` |
| **未 DELETE** | v1 `_build_feature_matrix` / `feature_shard` v1 | p0 fixture；显式保留至 p0 退役 |

---

## 5. Frozen Architecture Verification

| 检查项 | 结果 |
|--------|------|
| Runtime Mainline 未改（p0 `run_tone_inference`） | **PASS** — `test_phase8_runtime_mainline` |
| WordInfo 仍为唯一 Timestamp SSOT | **PASS** |
| 单 Feature Extractor（V2 域） | **PASS** — 仅 `feature_v2.extract_feature` |
| 单 Feature Contract（V2 域） | **PASS** — `P1_*` SSOT |
| Dataset 未进入 Feature Foundation | **PASS** — Extractor 不读 TextGrid |
| Feature Foundation 未进入 Decision Layer | **PASS** — 无 Recall/Ranking 引用 |
| Training/Runtime 共享 Extractor（V2 域） | **PASS** — 同函数；Runtime 接入待模型阶段 |
| 无双 Pipeline / Registry / Switch | **PASS** — Phase 2/8 源扫描 |
| p0 回归 | **PASS** — Phase 2/3/7B |

---

## 6. Semantic Acceptance 状态

| 路径段 | 状态 |
|--------|------|
| WordInfo → Feature Tensor（V2） | **已实现** — `extract_feature` |
| Feature Tensor → Tone Posterior（V2） | **未实现** — 无 V2 模型/backend |
| Posterior → Recall（p0） | **有效** — 生产仍 p0；`TONE-PRE-V2-3` 不变 |

**本轮不宣称 V2 Semantic Acceptance 完成**；须 V2 模型 + backend 接入后再验 counterfactual。

---

## 7. 测试记录

```text
python -m unittest discover -s tone_module -p "test_phase8*.py"     → 18 OK
python -m unittest tone_module.test_phase2_contracts \
                   tone_module.test_phase3_contracts               → 23 OK
python -m unittest tone_module.test_phase7b1_training_io \
                   tone_module.test_phase7b2_canonical_feature_shard → 19 OK
```

---

## 8. 后续阶段（非本轮）

1. V2 CNN/backend + `loader` 形状门控（`featureVersion=p1-frame-mel-f0-v1`）
2. `inference.py` 在 V2 模型就绪后改调 `extract_feature`（单次切换，禁止双 Pipeline）
3. Canonical AISHELL-3 全量 `build-feature-shards-v2`（997,992 音节）
4. Semantic Acceptance：置乱 V2 Tensor → Posterior 变 → Recall 分变

---

*Generated as P8-C Foundation development deliverable.*
