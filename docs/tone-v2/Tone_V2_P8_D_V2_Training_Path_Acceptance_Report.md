# Tone V2 P8-D — V2 Training Path Acceptance & TextGrid→WordInfo Adaptation Repair Report

**Date:** 2026-07-04  
**Phase:** P8-D V2 Training Path Acceptance & TextGrid→WordInfo Adaptation Repair  
**Type:** Development + Acceptance（非 Runtime 接入 · 非 p0 训练链路修改）

**架构 SSOT 主链：**

```text
TextGrid → SyllableSample → WordInfo Adapter → WordInfo
→ extract_feature(audio, sampleRate, wordInfo) → Feature Tensor
→ label sidecar → V2 Training Input Batch → (后续) CNN/CRNN
```

**Feature Shard V2 定位：** Training cache / materialized feature artifact（可选，非架构目标）

**依据：**

- [Tone V2 P8-C Feature V2 Foundation Development Specification.md](./Tone%20V2%20P8-C%20Feature%20V2%20Foundation%20Development%20Specification.md)
- [Tone V2 P8-C — Feature V2 Foundation Implementation Addendum.md](./Tone%20V2%20P8-C%20%E2%80%94%20Feature%20V2%20Foundation%20Implementation%20Addendum.md)
- [Tone V2 P8-C — Feature Contract Specification.md](./Tone%20V2%20P8-C%20%E2%80%94%20Feature%20Contract%20Specification.md)
- [Tone_V2_P8_C_Feature_V2_Foundation_Development_Report.md](./Tone_V2_P8_C_Feature_V2_Foundation_Development_Report.md)
- [Tone_V2_P8_C_Feature_V2_Foundation_Freeze_Audit_Report.md](./Tone_V2_P8_C_Feature_V2_Foundation_Freeze_Audit_Report.md)
- [Tone_V2_P8_C_Scope_Drift_Audit_Report.md](./Tone_V2_P8_C_Scope_Drift_Audit_Report.md)
- 当前仓库实际代码与 P8-D 回归测试

---

## Executive Summary

P8-D 将方向从「Feature Shard V2 工程验收」恢复为 **V2 Training Path 架构验收**。

| 交付项 | 结果 |
|--------|------|
| TextGrid→WordInfo Adapter | **KEEP** — 已满足冻结边界，无需修改 Dataset Foundation |
| V2 Training Path（在线） | **新增** — `v2_training_path.py` + `build-v2-training-batch` CLI |
| Feature Shard V2 | **RECLASSIFY** — 文档/注释/CLI 统一为 training cache |
| p0 训练入口 `train_and_save` | **KEEP** — 仍仅 p0；V2 通过独立 batch 路径接入 |
| 回归测试 | **31** Phase 8 测试 + **23** Phase 2/3 测试 **全部 PASS** |

### Final Verdict: **PASS**

V2 Training Path 已成立；不依赖 Feature Shard V2 即可生成 `(N, 64, 83)` + `(N,)` 训练 batch；Shard V2 已重新定位为可选缓存；Runtime / p0 / Dataset Foundation 未改动；Scope Drift 叙事已在代码层修正。

---

## TextGrid→WordInfo Adaptation Result

### 审计结论

| 检查项 | 状态 | 证据 |
|--------|------|------|
| TextGrid 仅属 Dataset Foundation | **PASS** | `alignment_textgrid.py` 未改；TextGrid 不进入 Feature |
| SyllableSample 仅属 Dataset Foundation | **PASS** | `SyllableSample` 不传入 `extract_feature` |
| Adapter 输出与 Runtime WordInfo 同构 | **PASS** | 返回 `shared_types.WordInfo` |
| Adapter 不修改 start/end | **PASS** | `start=float(sample.start)`, `end=float(sample.end)` 直拷 |
| Adapter 不重新估计 boundary | **PASS** | 无 DSP / 对齐逻辑 |
| Adapter 不生成 Feature | **PASS** | 源码无 `extract_feature` 引用 |
| Adapter 不处理 label | **PASS** | label 保留在 `SyllableSample` |
| wav_path 留在 audio loading 层 | **PASS** | Adapter 不读 wav；`v2_training_path` / shard builder 读 wav |
| WordInfo.word 非空 | **PASS** | `syllable:{idx}` 占位 |
| WordInfo.probability 不进入 Feature | **PASS** | `extract_feature` 仅用 start/end；概率变化不影响 tensor |
| 无 FeatureTimestampRecord / TrainingTimestampRecord | **PASS** | 全模块静态扫描无此类 |

### 分类

| 组件 | 动作 |
|------|------|
| `syllable_to_wordinfo.py` | **KEEP** |
| `boundary_consistency.py` | **KEEP** |
| Dataset Foundation（TextGrid / SyllableSample） | **KEEP**（未改） |

---

## Training Path Result

### 新增 V2 Training Path 模块

**文件：** `tone_module/training_io/v2_training_path.py`

```text
SyllableSample
  → syllable_sample_to_word_info(sample, syllable_index)
  → WordInfo
  → extract_feature(audio, sr, wordInfo)
  → (64, 83) float32 tensor + label sidecar
  → V2TrainingInputBatch(features: (N,64,83), labels: (N,))
```

**关键类型：**

- `V2TrainingInputBatch` — batch shape 校验、`feature_version == p1-frame-mel-f0-v1`
- `extract_v2_training_row` — 单行路径 + `WordInfoAdapterTrace` 边界诊断
- `build_v2_training_batch` — 在线 batch 构建，**零 Shard 依赖**

### CLI 验收入口

```bash
python -m tone_module.train_tone_cnn build-v2-training-batch --dataset data_mini --max-syllables 4
```

**实测输出：**

```json
{
  "featureVersion": "p1-frame-mel-f0-v1",
  "featureShape": [4, 64, 83],
  "labelShape": [4],
  "sampleCount": 4,
  "path": "SyllableSample → WordInfo Adapter → extract_feature (online, no Shard required)"
}
```

### 分类

| 组件 | 动作 |
|------|------|
| `v2_training_path.py` | **新增 · KEEP** |
| `build_v2_training_batch_for_dataset()` in `train_tone_cnn.py` | **新增 · KEEP** |
| `build-v2-training-batch` CLI | **新增 · KEEP** |

---

## Online Feature Path Result

| 断言 | 结果 |
|------|------|
| 唯一 Extractor 入口 | `feature_v2.extract_feature(audio, sampleRate, wordInfo)` |
| 输入 | Audio PCM + WordInfo（非 SyllableSample / TextGrid） |
| 输出 | `(64, 83)` float32 · `p1-frame-mel-f0-v1` |
| 不经过 p0 `extract_mel_features` | **PASS** |
| 不经过 SyllableSample 直连 Feature | **PASS** |
| batch shape `(N, 64, 83)` | **PASS** |
| label shape `(N,)` | **PASS** |
| label 与 tensor 一一对应 | **PASS**（`test_full_online_path_without_shard`） |
| WordInfo.start/end == SyllableSample.start/end | **PASS**（`WordInfoAdapterTrace.start_matches/end_matches`） |

---

## Optional Cache / Shard Result

| 断言 | 结果 |
|------|------|
| Shard V2 调用同一 `extract_feature` | **PASS**（`test_v2_build_uses_extract_feature_not_mel`） |
| 在线 tensor == 缓存 tensor（容差内） | **PASS**（max abs diff ≤ `1e-5`） |
| label 一致 | **PASS** |
| Shard 非 Training Path 必需 | **PASS**（`v2_training_path` 无 shard import） |

### 分类

| 组件 | 动作 |
|------|------|
| `feature_shard_v2.py` | **RECLASSIFY · KEEP** |
| `shard_reader_v2.py` | **RECLASSIFY · KEEP** |
| `build-feature-shards-v2` CLI | **RECLASSIFY · KEEP** |
| `test_phase8_shard_contract.py` | **RECLASSIFY · KEEP**（regression only） |

---

## Feature Shard V2 Reclassification Result

### 文案修正（P8-D 本轮）

| 位置 | 修正前倾向 | 修正后 |
|------|-----------|--------|
| `feature_shard_v2.py` module docstring | Training Engineering only | **training cache / materialized feature artifact** |
| `shard_reader_v2.py` module docstring | Feature Tensor rows | **read-only training cache rows** |
| `training_io/__init__.py` | — | 明确 Shard V2 非架构目标 |
| `train_tone_cnn build-feature-shards-v2` help | Build Feature Shard V2 | **Materialize training cache (optional)** |
| `test_phase8_shard_contract.py` | contract gates | **training cache contract gates (regression only)** |

### 禁止称谓（代码层扫描）

以下称谓 **未出现在** V2 训练模块 docstring/CLI 中作为架构定义：

- Feature Foundation 核心
- 架构目标
- Canonical Architecture
- 训练前唯一必需阶段

**注：** `shard_reader_v2.py` 仍含 “not a Feature Contract SSOT” 用于否定性澄清——属 **RECLASSIFY** 辅助说明，非正向架构宣称。

---

## Training Entry Result

### p0 入口（冻结 · 未改）

| 路径 | 状态 |
|------|------|
| `train_and_save` + `data_mini` | 仍 `_build_feature_matrix` → `extract_mel_features` → `(80,)` |
| `train_and_save` + `aishell3` | 仍 p0 v1 shard + `ShardReader` |
| p0 artifact | `P0_FEATURE_VERSION` / `numpy_p0` |

### V2 入口（P8-D 新增）

| 路径 | 状态 |
|------|------|
| `build-v2-training-batch` | **在线 V2 batch** — `(N,64,83)` + `(N,)` |
| `build-feature-shards-v2` | **可选缓存** — 同一 tensor 物化 |
| CNN/CRNN 正式训练 | **未开始**（P8-D 范围外，符合预期） |

### 分类

| 组件 | 动作 |
|------|------|
| `train_and_save` p0 逻辑 | **KEEP** |
| V2 batch CLI / API | **新增 · KEEP** |

---

## Regression Test Result

### Phase 8 测试套件（31 tests · PASS）

| 测试文件 | 覆盖 |
|----------|------|
| `test_phase8d_v2_training_path.py` | **P8-D 主验收** — Adapter / Training Path / Online vs Cache / No Shard / Scope Drift / Frozen Arch |
| `test_phase8_boundary_consistency.py` | Boundary Gate |
| `test_phase8_feature_contract.py` | P1 Contract |
| `test_phase8_feature_equality.py` | Extractor 确定性 |
| `test_phase8_runtime_mainline.py` | p0 Runtime 冻结 |
| `test_phase8_shard_contract.py` | Shard V2 cache regression |

### P8-D 专项测试矩阵

| # | 测试类 | 断言 | 结果 |
|---|--------|------|------|
| 1 | TextGridWordInfoAdapterTest | start/end 一致 · word 非空 · label 不在 WordInfo · probability 不影响 Feature | **PASS** |
| 2 | V2TrainingPathTest | 完整在线路径 · batch shape · label 对齐 | **PASS** |
| 3 | OnlineVsCacheEqualityTest | online == cached tensor | **PASS** |
| 4 | NoShardDependencyTest | v2_training_path 无 shard import | **PASS** |
| 5 | NoScopeDriftTest | reclassification markers · 无 forbidden record types | **PASS** |

### Phase 2 / Phase 3 回归（23 tests · PASS）

p0 Runtime、loader、mel、train CLI 契约未回归。

---

## Frozen Architecture Verification

| 检查项 | 结果 |
|--------|------|
| Runtime Mainline 未改 | **PASS** — `inference.py` 仍 `extract_mel_features` |
| p0 Runtime 未改 | **PASS** — `mel.py` mean-mel `(80,)` 不变 |
| Dataset Foundation 未改 | **PASS** — TextGrid / SyllableSample 契约未动 |
| WordInfo = 唯一 Timestamp Contract | **PASS** |
| Feature Extractor = 唯一 V2 Extractor | **PASS** — 仅 `feature_v2.extract_feature` |
| Training Path 经 Adapter 接入 WordInfo | **PASS** |
| Shard V2 仅是缓存 | **PASS** — RECLASSIFY 完成 |
| 无第二 Feature Pipeline | **PASS** |
| 无 FeatureTimestampRecord | **PASS** |
| 无 Runtime / Training 双 Extractor | **PASS** — Runtime p0 mel · Training V2 extract_feature（分阶段，非双轨并行） |

---

## Scope Drift Verification

| 维度 | P8-C 审计结论 | P8-D 修正后 |
|------|--------------|-------------|
| 文档/报告过度强调 Shard 全量 | CONDITIONAL PASS（叙事漂移） | **已修正** — 代码 docstring/CLI 以 Training Path 为主 |
| Shard 反向定义 Contract | 代码层未发生 | **仍 PASS** — manifest 读 `contract.P1_*` |
| 架构主链叙事 | 易被误读为 Shard-centric | **已恢复** — `v2_training_path` 为 SSOT |
| 下一步导向 | Canonical Shard Build | **已改为** V2 CNN/CRNN training predev |

**Scope Drift 残余：** P8-C 历史报告（Development Report / Freeze Audit）中仍有 Shard-centric 表述——属 **文档历史记录**，不影响代码架构；可在 P8-E 文档 sweep 中 **RECLASSIFY**，非 BLOCKER。

---

## KEEP / MODIFY / RESTORE / DELETE / RECLASSIFY

| 路径 | 动作 | 说明 |
|------|------|------|
| `training_io/syllable_to_wordinfo.py` | **KEEP** | Adapter 边界正确 |
| `training_io/boundary_consistency.py` | **KEEP** | Gate 不变 |
| `feature_v2.py` | **KEEP** | 唯一 Extractor |
| `contract.py` P1_* | **KEEP** | Feature Contract SSOT |
| `training_io/v2_training_path.py` | **新增 KEEP** | V2 Training Path SSOT |
| `train_tone_cnn.py` V2 batch API/CLI | **新增 KEEP** | 验收入口 |
| `training_io/feature_shard_v2.py` | **RECLASSIFY KEEP** | training cache |
| `training_io/shard_reader_v2.py` | **RECLASSIFY KEEP** | cache reader |
| `test_phase8d_v2_training_path.py` | **新增 KEEP** | P8-D acceptance |
| `test_phase8_shard_contract.py` | **RECLASSIFY KEEP** | regression only |
| `inference.py` / `mel.py` / loader / numpy_p0 | **KEEP** | p0 冻结 |
| Dataset Foundation | **KEEP** | 未改 |
| FeatureTimestampRecord 概念 | **不存在** | 无需 DELETE |
| 任何 V2 代码 | **无 DELETE** | 均需保留 |

---

## Remaining Risks

1. **Semantic 未验：** Adapter 使用 `syllable:{idx}` 占位 word，非真实拼音/汉字；对 Feature 无影响（Extractor 不用 word 文本），但未来 Semantic Repair 集成需单独审计。
2. **V2 模型训练未开始：** P8-D 仅验收 Training Input Batch；CNN/CRNN 权重训练、V2 artifact 校验、offline eval 均属下一阶段。
3. **Runtime 仍 p0：** Training 与 Runtime Extractor 尚未共享；属计划内分阶段，非 P8-D 范围。
4. **历史文档 Scope 叙事：** P8-C 报告仍可能被误读；建议 P8-E 做文档 sweep。
5. **大规模 Shard 全量构建：** 仍为可选性能优化，非架构阻塞项。

---

## 十问终答

| # | 问题 | 答案 |
|---|------|------|
| 1 | TextGrid 是否已经正确适配为 WordInfo？ | **是** — 经 SyllableSample + Adapter；boundary 直拷，label sidecar 保留 |
| 2 | SyllableSample 是否仍然被限制在 Dataset Foundation？ | **是** — 不进入 Extractor |
| 3 | Adapter 是否只是字段转换？ | **是** — start/end/word/probability 映射，无 Feature/label 处理 |
| 4 | Feature Extractor 是否只接受 Audio + WordInfo？ | **是** — `extract_feature(audio, sampleRate, wordInfo)` |
| 5 | V2 Training Path 是否已经成立？ | **是** — 在线 batch `(N,64,83)` + `(N,)` 已验证 |
| 6 | 是否必须依赖 Feature Shard V2 才能训练？ | **否** — 在线路径独立成立；Shard 仅缓存 |
| 7 | Feature Shard V2 是否已经重新定位为训练缓存？ | **是** — docstring/CLI/测试已 RECLASSIFY |
| 8 | 是否仍存在 Scope Drift？ | **代码层：否**；历史 P8-C 文档：轻微残余（非 BLOCKER） |
| 9 | 是否可以进入 V2 CNN/CRNN training predev audit？ | **是** — Training Path PASS 为前置条件已满足 |
| 10 | 是否需要删除当前任何 V2 代码？ | **否** — RECLASSIFY + KEEP |

---

## Final Verdict

### **PASS**

P8-D 完成 V2 Training Path 架构验收与 TextGrid→WordInfo Adaptation 确认；方向已从 Feature Shard 工程验收恢复为冻结主链；Runtime / p0 / Dataset Foundation 未触碰；可进入 V2 CNN/CRNN training predev audit 阶段。
