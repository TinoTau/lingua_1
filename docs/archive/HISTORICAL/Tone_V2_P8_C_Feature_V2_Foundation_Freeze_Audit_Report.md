<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/Tone_V2_P8_C_Feature_V2_Foundation_Freeze_Audit_Report.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# Tone V2 P8-C — Feature V2 Foundation 冻结审计报告

**Date:** 2026-07-04  
**Phase:** P8-C Foundation Freeze Audit（**只读** · **非开发** · **非训练**）  
**Audit Type:** Foundation Freeze Verification / Architecture Drift / Contract / Decision / Semantic Audit

**依据 SSOT：**

- [Tone V2 P8-C Feature V2 Foundation Development Specification.md](./Tone%20V2%20P8-C%20Feature%20V2%20Foundation%20Development%20Specification.md)（P8-C）
- [Tone V2 P8-C — Feature V2 Foundation Implementation Addendum.md](./Tone%20V2%20P8-C%20%E2%80%94%20Feature%20V2%20Foundation%20Implementation%20Addendum.md)（Addendum）
- [Tone V2 P8-C — Feature Contract Specification.md](./Tone%20V2%20P8-C%20%E2%80%94%20Feature%20Contract%20Specification.md)（Contract Spec）
- [Tone_V2_P8_C_Feature_V2_Foundation_Development_Report.md](./Tone_V2_P8_C_Feature_V2_Foundation_Development_Report.md)（开发报告）
- [Tone_V2_P8_B_Feature_V2_Contract_Foundation_PreDev_Audit_Report.md](./Tone_V2_P8_B_Feature_V2_Contract_Foundation_PreDev_Audit_Report.md)（P8-B）
- [Tone_V2_P8_A_Runtime_Timestamp_Contract_SSOT_Audit_Report.md](./Tone_V2_P8_A_Runtime_Timestamp_Contract_SSOT_Audit_Report.md)（P8-A）

**代码锚点（实测）：** `electron_node/services/faster_whisper_vad/tone_module/` · `api_routes.py` · `electron-node/main/src/fw-detector/freeze-contract.test.ts`

**测试执行（本轮）：** `test_phase8_*` 18/18 OK · Phase 2/3 23/23 OK

---

## Executive Summary

| 审计域 | 裁决 |
|--------|------|
| **V2 Feature Foundation 层（p1-frame-mel-f0-v1）** | **可冻结** — 单 Extractor · Contract · Shard V2 · Adapter · Boundary Gate 已落地 |
| **全系统 Frozen Architecture（含生产 Runtime）** | **未完全闭合** — 生产仍走 p0 `extract_mel_features`；存在 **p0∥p1 并行** |
| **Training Mainline V2** | **PASS** — `build-feature-shards-v2` 经 Adapter→`extract_feature` |
| **Training Mainline p0（遗留）** | **旁路仍存在** — v1 Shard / `_build_feature_matrix`（p0 冻结保留） |
| **Runtime / Training 共享 V2 Foundation** | **FAIL（全系统）** — Runtime 未调用 `extract_feature` |
| **Semantic / Decision（V2）** | **未验收** — V2 Tensor 未进 Tone Model / Recall |
| **Regression 覆盖** | **部分 PASS** — 缺 F0 黄金回归 · 缺 Training↔Runtime Extractor 等式 |

### Final Verdict: **CONDITIONAL PASS**

**P8-C Feature V2 Foundation 可作为「Foundation 层」正式冻结**（`feature_v2` · `P1_*` · Shard V2 构建链 · Phase 8 门禁），但 **不得**宣称全系统已满足「单 Extractor / Training=Runtime / Semantic Acceptance」——这三项属 **后续 Model Capability + Runtime 切换** 阶段闭合条件。

---

## 一、Frozen Architecture Verification

### 1.1 Runtime Mainline（生产路径 · p0）

**期望主链：**

```text
FW → WordInfo → Feature Extractor → Feature Tensor → Tone Model
→ Tone Posterior → Recall → Candidate Ranking → Final Candidate
```

**实际代码：**

| 环节 | 证据 | 判定 |
|------|------|------|
| FW → WordInfo | `api_routes.py` ASR `segments` → `run_tone_inference` | **PASS** |
| WordInfo 切片 | `inference.py` `_iter_words` + `_slice_audio` | **PASS** |
| Feature Extractor | **`extract_mel_features`**（p0），**非** `extract_feature` | **p0 KEEP** · **V2 未接入** |
| Feature Tensor | `(N, 80)` mean-mel | **p0** |
| Tone Model | `numpy_p0` + `tone_cnn_p0.npz` | **PASS** |
| Posterior → Recall | `freeze-contract.test.ts` `TONE-PRE-V2-3` | **PASS** |
| dedup 前 Tone | `tone_payload, tone_inference_ms = run_tone_inference` 在 `process_text_deduplication` 之前 | **PASS** |

```99:100:electron_node/services/faster_whisper_vad/tone_module/inference.py
    mel_batch = np.stack([extract_mel_features(s, sample_rate) for s in slices_audio], axis=0)
    posteriors = classifier.predict_batch(mel_batch)
```

**禁止项扫描：**

| 项 | 结果 |
|----|------|
| Registry / Switch / 第二 Runtime Mainline | **未发现** — `test_phase2/8` 源扫描 |
| Shadow Runtime | **未发现** |
| `FeatureTimestampRecord` | **代码库无** — P8-A 建议未实现 |

**Runtime Mainline 裁决：** **PASS（p0 冻结态）** — 符合「P8 不修改 p0 Runtime」；**不等于** V2 Extractor 已入主链。

---

### 1.2 Training Mainline V2

**期望主链：**

```text
TextGrid → SyllableSample → WordInfo Adapter → WordInfo
→ Feature Extractor → Feature Tensor → Feature Shard V2 → Model
```

**实际代码（V2 路径）：**

| 环节 | 证据 | 判定 |
|------|------|------|
| SyllableSample | Dataset `alignment_textgrid.py` | **PASS** |
| Adapter | `syllable_to_wordinfo.syllable_sample_to_word_info` | **PASS** |
| Extractor | `feature_shard_v2` → `extract_feature` | **PASS** |
| Boundary Gate | `require_boundary_consistency_pass` 于 `build_feature_shards_v2` 首行 | **PASS** |
| Shard V2 | `training_feature_shard_v2` · `features (N,64,83)` | **PASS** |
| 不经 Adapter 直连 Feature | v2 builder **无** `extract_mel_features` | **PASS** |

```114:116:electron_node/services/faster_whisper_vad/tone_module/training_io/feature_shard_v2.py
            word_info = syllable_sample_to_word_info(sample, syllable_index=next_global)
            tensor = extract_feature(audio, sr, word_info)
            feature_buf.append(tensor)
```

**Training Mainline V2 裁决：** **PASS**

---

### 1.3 Training Mainline p0（遗留并行）

| 旁路 | 证据 | 与设计关系 |
|------|------|------------|
| `feature_shard.py` 直连 `SyllableSample` + `extract_mel_features` | L104–106 | **p0 v1 冻结** · 违反 V2 R-01 但 **未删除**（显式 KEEP） |
| `train_tone_cnn._build_feature_matrix` | `data_mini` 训练路径 | **p0 fixture** |
| `test_phase6e` 直接 `extract_mel_features` | 数据集探针 | **诊断** · 非 Shard 主链 |

**裁决：** **双 Training Pipeline（p0 v1 ∥ p1 v2）** — 属 **有文档的并行冻结**，非 Shadow；V2 Canonical 构建 **必须** 仅用 `build-feature-shards-v2`。

---

## 二、Architecture Drift Audit

| 检查项 | Expected | Actual | Severity | 动作 |
|--------|----------|--------|----------|------|
| 第二 Timestamp Contract | 禁止 | 无 `FeatureTimestampRecord` | — | **KEEP** |
| 第二 Feature Contract（V2 域） | 禁止 | 仅 `P1_*` | — | **KEEP** |
| 第二 Feature Tensor（V2 域） | 禁止 | 仅 `(64,83)` | — | **KEEP** |
| 第二 Feature Extractor（V2 域） | 禁止 | 仅 `feature_v2.extract_feature` | — | **KEEP** |
| 全系统单 Extractor | 唯一 | **p0 mel + p1 extract_feature 并存** | **HIGH** | **KEEP p0** · **MODIFY**（模型阶段 Runtime 切换） |
| Runtime-only Feature | 禁止 V2 分叉 | p0 `mel.py` 为生产 Runtime Feature | **MEDIUM** | **KEEP**（p0） |
| Training-only Feature | 禁止 V2 分叉 | V2 仅训练物化；Runtime 未共享 | **HIGH** | **REQUIRED BEFORE RUNTIME V2** |
| Compatibility / Shadow | 禁止 | `P0_COMPATIBLE_FEATURE_VERSIONS` 含 `mel_mean_80_v1` | **LOW** | **KEEP**（p0 artifact 别名，非 V2 Shadow） |
| Dual Pipeline | 禁止 | p0∥p1 **并行** | **MEDIUM** | **KEEP**（版本隔离）· 禁止混用 |
| Registry / Switch | 禁止 | 未发现 | — | **KEEP** |
| `_slice_audio` 重复 | 单点 | `inference` · `feature_shard` v1 · `train_tone_cnn` **+** `feature_v2.slice_audio` | **MEDIUM** | **KEEP p0 副本** · **RESTORE**（Runtime 切 V2 时删 p0 外置切片） |
| Offline Feature 旁路 | 禁止第二决策链 | `offline_tone_eval` 用 `numpy_p0` | **LOW** | **KEEP**（Phase 3 隔离） |

---

## 三、Responsibility Boundary Audit

| 层 | 期望职责 | 实际 | 交叉污染 |
|----|----------|------|----------|
| **Dataset Foundation** | GT · Boundary · Label | `SyllableSample` 注释「not Runtime SSOT」 | **无** |
| **Runtime** | Audio · WordInfo | `inference` 不定义 Feature Contract | **无** |
| **Feature Foundation** | Audio+WordInfo→Tensor | `feature_v2` 不读 TextGrid/SyllableSample | **PASS** |
| **Training Engineering** | Adapter · Shard · 训练入口 | v2 builder 调 Extractor；v1 仍旁路 | **v1 漂移（p0）** |
| **Model** | 消费 Tensor | `loader`/`numpy_p0` 仅 p0 `(80,)` | **V2 未接** |
| **Loader** | 只读 Shard | `ShardReader`/`ShardReaderV2` 不重算 Feature | **PASS** |
| **Adapter** | 仅字段转换 | 不改 boundary/label | **PASS** |

**Label 并行通道：** `SyllableSample.label` → Shard `labels` 数组，不经 WordInfo — **符合** P8-B 设计。

---

## 四、Contract Verification

### 4.1 WordInfo Contract

| 项 | 状态 |
|----|------|
| SSOT 类型 `WordInfo` | **PASS** — `shared_types.py` |
| Feature 仅用 start/end | **PASS** — `extract_feature` |
| Adapter 输出非空 `word` | **PASS** — `syllable:{index}` |
| Runtime `w.word` 非空门控 | **仍存在** — `inference._iter_words` L32 |

### 4.2 Feature Contract（`p1-frame-mel-f0-v1`）

| Contract 项 | 文档 | `contract.P1_*` | `feature_v2.py` 实现 | 判定 |
|-------------|------|-----------------|----------------------|------|
| featureVersion | P8-C §13.1 | `p1-frame-mel-f0-v1` | 断言 shape | **PASS** |
| Tensor Shape | (64, 83) Frame×Channel | `P1_FEATURE_SHAPE` | L222–223 | **PASS** |
| Channel 0–79 mel | §5 | 80 mels | `_compute_log_mel_frames` | **PASS** |
| Ch 80 log F0 | §5 | `P1_CH_LOG_F0` | `_estimate_f0_frame` | **PASS** |
| Ch 81 ΔlogF0 | §5 | forward/zero boundary | `_delta_log_f0` | **PASS** |
| Ch 82 voiced | §5 | corr threshold 0.3 | `_estimate_f0_frame` | **PASS** |
| DSP 25ms/10ms/n_fft=400 | P8 时长 | `P1_N_FFT=400` | stft | **PASS** |
| Interpolation | duration_normalized_linear | `P1_RESAMPLE_POLICY` | `_duration_normalized_linear_interp` | **PASS** |
| Crop | center_crop overflow | `P1_OVERFLOW_POLICY` | `_center_crop_time` | **PASS** |
| F0 Algorithm | §9 类目 | `frame_lag_autocorrelation_v1` | 实现一致 | **PASS（实现层）** |
| F0 数值（max_hz=500 等） | Contract Spec **未写数值** | `contract.P1_F0_*` | 代码常量 | **文档漂移** · 实现已冻结于 `contract.py` |

**Contract Owner：** `P1_*` 在 `contract.py` 定义，`feature_v2` 消费 — **符合 FP-21**（Extractor 实现 Contract，未反向定义 shape）。

**Training vs Runtime Contract 一致性：** **V2 域内训练一致**；**Runtime 仍 p0 Contract** — **全系统不一致（设计预期至模型阶段）**。

---

## 五、Feature Foundation Verification

| 项 | V2 Foundation 域 | 全系统 |
|----|------------------|--------|
| Extractor 唯一 | **PASS** — 仅 `extract_feature` | **FAIL** — 并存 `extract_mel_features` |
| Tensor 唯一 | **PASS** — `(64,83)` | **FAIL** — 并存 `(80,)` |
| Version 唯一（V2 路径） | **PASS** | p0∥p1 |
| Foundation 唯一 Owner | **PASS（V2 模块）** | 职责清晰 |
| Training/Runtime 共享 | Shard 构建共享 Extractor | **Runtime 未调用** |

---

## 六、Implementation Audit

### 6.1 核心文件

| 文件 | 职责符合设计 | 问题 |
|------|--------------|------|
| `feature_v2.py` | **是** — 单入口 · 切片内聚 | p0 路径未复用 `slice_audio`（待 Runtime 切换） |
| `syllable_to_wordinfo.py` | **是** | — |
| `boundary_consistency.py` | **是** | 仅验证 Adapter 边界，未对比 FW TextGrid |
| `feature_shard_v2.py` | **是** — Gate + Adapter + Extractor | — |
| `shard_reader_v2.py` | **是** — 只读 · shape 校验 | 无 z-score（正确，属 Model Layer） |
| `contract.py` `P1_*` | **是** | F0 数值仅见于代码/constants |
| `loader.py` | p0 only | **KEEP** — 无 V2 形状 |
| `train_tone_cnn.py` | v2 CLI + p0 训练保留 | `data_mini` 仍 `_build_feature_matrix` |

### 6.2 绕过 / 复制检查

| 检查 | 结果 |
|------|------|
| V2 Shard 绕过 Contract | **未发现** |
| V2 复制第二套 Feature 逻辑 | **未发现**（mel filterbank 在 `feature_v2` 内，未改 `mel.py`） |
| Training/Runtime V2 分叉实现 | **Runtime 未实现 V2** — 非分叉而为 **未接入** |
| Loader 重算 Feature | **未发现** |
| `MiniBatchReader` z-score | **存在**（p0 训练）— Model Layer，**KEEP** |

---

## 七、Decision Path Audit

### 7.1 当前生产决策链（p0）

```text
WordInfo → mean-mel (80) → numpy_p0 MLP → Posterior
→ ctx.acousticToneSlices → Recall → Ranking → Final Candidate
```

| 段 | 是否真实参与决策 | 证据 |
|----|------------------|------|
| Posterior → Recall | **是** | `TONE-PRE-V2-3` |
| KenLM prefilled rerank | **否**（Tone 不进入） | `TONE-PRE-V2-2` · 设计 Scope |
| V2 Feature Tensor | **否** | 无 V2 模型/backend |

### 7.2 Semantic Acceptance（V2）

| 项 | 状态 |
|----|------|
| Feature Tensor → Tone Model（V2） | **未实现** |
| Tensor → Posterior 变化 → Recall 变化（V2 counterfactual） | **未验收** |
| 「功能存在但不生效」 | **不适用** — V2 Tensor **未进入**主链（明确未接，非隐藏失效） |

**明确裁决：**

- **Feature Foundation（V2 物化层）可冻结** — Extractor/Shard/Contract 已闭合。
- **Semantic Acceptance 属后续 Model Capability 阶段** — **不得**判 PASS。

---

## 八、Regression Audit

### 8.1 已有覆盖

| 门禁 | 测试 | 状态 |
|------|------|------|
| Runtime Mainline 未改 | `test_phase8_runtime_mainline` | **PASS** |
| Feature Contract | `test_phase8_feature_contract` | **PASS** |
| Feature Version / Shape | 同上 | **PASS** |
| Boundary Gate | `test_phase8_boundary_consistency` | **PASS** |
| Feature Equality（同进程重复） | `test_phase8_feature_equality` | **PASS** |
| Shard V2 Contract | `test_phase8_shard_contract` | **PASS** |
| p0 回归 | Phase 2/3/7B | **PASS** |
| Posterior→Recall | `freeze-contract.test.ts` | **PASS**（p0） |

### 8.2 缺失覆盖（用户 §八）

| 缺失项 | 说明 | 分类 |
|--------|------|------|
| **F0 Contract Regression** | 无固定 Audio→期望 F0 通道黄金向量 / hash | **REQUIRED BEFORE TRAINING**（严格门禁）或 **OPTIONAL**（若仅 Shard 内一致性） |
| **Extractor Equality Training↔Runtime** | 无「同一 `processed_audio`+WordInfo：Shard 构建 vs Runtime `extract_feature`」测试；**因 Runtime 未调 `extract_feature`** | **REQUIRED BEFORE RUNTIME V2** |
| **Feature Hash 跨重建稳定性** | v2 无 `manifest_logical_digest` 门（v1 有 Phase 7B2） | **REQUIRED BEFORE CANONICAL V2 全量** |
| **Semantic Acceptance Test** | 无 V2 counterfactual | **后续阶段** |
| **Canonical 997k V2 Shard 全量** | 未构建 | **REQUIRED BEFORE CANONICAL TRAINING** |

---

## 九、Frozen Architecture Compliance

| 检查项 | 裁决 | 备注 |
|--------|------|------|
| Runtime Timestamp SSOT | **PASS** | WordInfo |
| Single Feature Foundation（V2 域） | **PASS** | |
| Single Feature Foundation（全系统） | **CONDITIONAL** | p0∥p1 |
| Single Feature Contract（V2） | **PASS** | |
| Single Feature Tensor（V2） | **PASS** | |
| Single Feature Extractor（V2） | **PASS** | |
| Single Runtime Mainline | **PASS** | p0 未改拓扑 |
| Shared Runtime/Training Feature Foundation | **FAIL** | Runtime 未共享 V2 Extractor |
| Dataset Independence | **PASS** | |
| Runtime Independence | **PASS** | |
| Training Independence（Contract 定义） | **PASS** | |
| Boundary Provider Independence | **PASS** | manifest `boundaryProvider` 仅诊断 |

---

## 十、Required Repair Matrix

### KEEP

| 对象 | Expected | Actual | Impact | Reason |
|------|----------|--------|--------|--------|
| p0 Runtime `inference.py`→`mel.py` | 冻结主链 | 未改 | 生产稳定 | P8-C FC-01 |
| p0 `loader`/`numpy_p0`/artifact | p0-v1 | 未改 | 生产模型 | 并行版本 |
| v1 Shard + `build-feature-shards` | p0 训练工程 | 仍存在 | Canonical p0 回归 | 显式冻结 |
| `P0_COMPATIBLE_FEATURE_VERSIONS` | p0 别名 | 含 `mel_mean_80_v1` | artifact 兼容 | 非 V2 Shadow |
| Recall 接线 | Posterior 进 Recall | TS 测试 PASS | 决策有效 | TONE-PRE-V2-3 |
| V2 模块全集 | Foundation SSOT | 已实现 | V2 训练基础 | 本轮交付 |

### MODIFY（后续阶段，非本轮冻结审计改代码）

| 对象 | Expected | Actual | Impact | Severity | Reason |
|------|----------|--------|--------|----------|--------|
| `inference.py` | 调 `extract_feature` | 仍 `extract_mel_features` | Runtime 未共享 V2 | **HIGH** | Model Capability 阶段 |
| `loader` + backend | V2 shape/backend | 仅 p0 `(80,)` | 无法加载 V2 模型 | **HIGH** | 模型阶段 |
| Contract Spec 文档 | F0 数值冻结 | 仅类目，数值在 `contract.py` | 文档/实现双 SSOT 风险 | **MEDIUM** | 文档增补 |

### RESTORE（条件触发）

| 对象 | Expected | Actual | Impact | Severity | Reason |
|------|----------|--------|--------|----------|--------|
| 全系统单 `_slice_audio` | Extractor 内 | p0 三处重复 | 边界一致性维护成本 | **MEDIUM** | Runtime 切 V2 时 |
| Training 禁止 v1 生产路径混用 V2 Canonical | 单一 Canonical | 两 CLI 并存 | 误用风险 | **MEDIUM** | 流程/CI 门控 |

### DELETE（V2 全量上线后，非现在）

| 对象 | Expected | Actual | Impact | Reason |
|------|----------|--------|--------|--------|
| p0 训练旁路进 V2 Canonical | 禁止 | v1 仍存在 | 架构漂移 | p0 退役后 |
| 外置 `_slice_audio`（p0 inference） | 迁入 Extractor | 仍存在 | 重复 | V2 Runtime 切换后 |

### REQUIRED BEFORE TRAINING

| 项 | 说明 |
|----|------|
| **Canonical Feature Shard V2 全量构建** | `build-feature-shards-v2 --dataset aishell3` + Boundary PASS |
| **V2 Shard 可重复性门禁** | 建议增 `manifest_logical_digest`（仿 Phase 7B2） |
| **F0 Contract Regression（推荐）** | 黄金音频 → 通道 80–82 期望向量或 hash 冻结 |
| **V2 CNN backend + loader** | 消费 `(64,83)` · `featureVersion=p1-frame-mel-f0-v1` |

### REQUIRED BEFORE RUNTIME V2

| 项 | 说明 |
|----|------|
| **Extractor Equality Training↔Runtime** | 同一 `processed_audio`+WordInfo：`extract_feature` bit-equal |
| **`inference.py` 切换** | 单次切换，禁止 Registry/Switch |
| **Semantic Acceptance** | Tensor 扰动 → Posterior 变 → Recall 分变 |

### OPTIONAL FUTURE WORK

| 项 | 说明 |
|----|------|
| FW vs TextGrid Boundary 对比审计 | P8-0 标为可选 |
| `inference._iter_words` 仅 start/end 门控 | 减少 Adapter 占位依赖 |
| Feature Contract Spec 文档合并 `P1_F0_*` 数值 | 消除文档漂移 |

---

## 十一、Final Verdict — 八问

| # | 问题 | 回答 |
|---|------|------|
| **1** | P8 Foundation 是否可以正式冻结？ | **可以（CONDITIONAL）** — **V2 Foundation 层**（`feature_v2` · `P1_*` · Adapter · Shard V2 · Phase 8 门）可冻结；**全系统**须待 Runtime/Model 阶段闭合 |
| **2** | 是否仍存在 Architecture Drift？ | **是** — p0∥p1 并行、`_slice_audio` 重复、v1 Training 旁路；**已文档化 KEEP**，非无管控漂移 |
| **3** | 是否仍存在 Contract Drift？ | **轻微** — F0 数值在 `contract.py` 已冻结，Feature Contract Spec **markdown 未写全**；实现与 `P1_*` **一致** |
| **4** | 是否仍存在 Decision Drift？ | **V2：是**（Tensor 未进决策）；**p0：否**（Recall 已接线） |
| **5** | 是否仍存在 Semantic Drift？ | **V2：未验** — 属后续阶段；**不得误判 PASS** |
| **6** | 是否可以开始 Canonical Feature Shard V2 全量生成？ | **可以（CONDITIONAL）** — 须先全量 Boundary Gate PASS；建议补 V2 digest 可重复性门 |
| **7** | 是否可以开始 CNN/CRNN 第一轮训练？ | **可以（CONDITIONAL）** — 在 **V2 Shard 物化完成** + **V2 backend/loader** 就绪后；**不得**用 p0 `(80,)` 权重静默训练 V2 |
| **8** | 训练前是否仍须 F0 Regression / Extractor Equality？ | **F0 Regression：建议 REQUIRED BEFORE CANONICAL TRAINING**（严格冻结 F0 通道）；**Extractor Equality（Training↔Runtime）：REQUIRED BEFORE RUNTIME V2**；仅离线 CNN 训练可先用 Shard 内一致性 + 现有 `test_phase8_feature_equality` |

### Final Verdict: **CONDITIONAL PASS**

---

## 附录 A — 代码证据索引

```32:34:electron_node/services/faster_whisper_vad/tone_module/inference.py
            if w.word and w.start is not None and w.end is not None:
                yield w
```

```200:224:electron_node/services/faster_whisper_vad/tone_module/feature_v2.py
def extract_feature(audio: np.ndarray, sample_rate: int, word_info: WordInfo) -> np.ndarray:
    ...
    clip = slice_audio(audio, sample_rate, start, end)
    ...
    return out.astype(np.float32)
```

```104:106:electron_node/services/faster_whisper_vad/tone_module/training_io/feature_shard.py
            clip = _slice_audio(audio, sr, sample.start, sample.end)
            mel_buf.append(extract_mel_features(clip, sr))
            label_buf.append(sample.label)
```

---

## 附录 B — 测试记录

```text
python -m unittest discover -s tone_module -p "test_phase8*.py" -q  → 18 OK
python -m unittest tone_module.test_phase2_contracts \
                   tone_module.test_phase3_contracts -q            → 23 OK
```

---

*本报告为 P8-C Foundation Freeze Audit 产出；未修改任何代码、配置、模型或 Runtime 行为。*
