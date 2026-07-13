# Tone V2 P8-B — Feature V2 Contract Foundation Pre-Development Audit Report

**Date:** 2026-07-04  
**Phase:** P8-B（Feature V2 Contract Foundation · Pre-Dev Audit）  
**Audit Type:** Read-only Pre-Development Code Audit（**非开发** · **非训练** · **非冻结修改**）  
**Direction SSOT:** Runtime **`WordInfo`** 为 Timestamp Contract 唯一 SSOT；Training 仅负责 **SyllableSample → WordInfo**；**禁止** `FeatureTimestampRecord` · Training-only Feature Pipeline

**依据：**

- [TONE_V2_CONTRACT_FREEZE.md](./TONE_V2_CONTRACT_FREEZE.md)
- [TONE_V2_DATASET_FOUNDATION_FREEZE.md](./TONE_V2_DATASET_FOUNDATION_FREEZE.md)
- [TONE_V2_TRAINING_ENGINEERING_FREEZE.md](./TONE_V2_TRAINING_ENGINEERING_FREEZE.md)
- [TONE_V2_TERMINOLOGY.md](./TONE_V2_TERMINOLOGY.md)
- [Tone_V2_Mean_Mel_Feature_Baseline_Root_Cause_Audit_Report.md](./Tone_V2_Mean_Mel_Feature_Baseline_Root_Cause_Audit_Report.md)
- [Tone_V2_P8_FeatureV2_Syllable_Duration_Frame_Length_Audit_Report.md](./Tone_V2_P8_FeatureV2_Syllable_Duration_Frame_Length_Audit_Report.md)
- [Tone_V2_P8_0_Training_Runtime_Timestamp_Consistency_Audit_Report.md](./Tone_V2_P8_0_Training_Runtime_Timestamp_Consistency_Audit_Report.md)
- [Tone_V2_P8_A_Runtime_Timestamp_Contract_SSOT_Audit_Report.md](./Tone_V2_P8_A_Runtime_Timestamp_Contract_SSOT_Audit_Report.md)

**禁止项（本轮）：** 修改任何代码 · 配置 · 模型 · 数据 · 冻结层

---

## Executive Summary

| 项 | 结论 |
|----|------|
| **WordInfo 作唯一 Timestamp SSOT** | **可以** — `start`/`end`（秒）足够驱动 Feature V2；**禁止**新增 `FeatureTimestampRecord` |
| **禁止 FeatureTimestampRecord** | **是** — P8-A 建议名为 **架构漂移**；P8-B 以 `WordInfo` 收口 |
| **Training 须经 Adapter** | **是** — 当前 **未实现**；`feature_shard.py` 仍直连 `SyllableSample` |
| **TextGrid / SyllableSample 退出 Feature Contract** | **是（目标）** — 停留 Dataset Foundation |
| **Extractor 只认 WordInfo** | **是（V2 目标）** — 当前 `extract_mel_features(audio)` **无** WordInfo 参数 |
| **推荐 featureVersion** | `p1-frame-mel-f0-v1` |
| **推荐 featureShape** | `(64, 83)` — 80 mel + logF0 + ΔlogF0 + voiced + energy（见 §Feature V2 Contract） |
| **Shard V2** | `training_feature_shard_v2` · 存 tensor + labels · 可选 start/end 诊断 · `boundaryProvider` 仅 manifest |
| **共享 Extractor** | 架构支持；p0 已共享 `mel.py`（mean-mel）；V2 须 **单** `feature_v2.extract` |
| **Boundary Audit 门禁** | **V2 Canonical Shard 全量构建前必须**（只读 · 非第二 Pipeline） |
| **可否进入 P8-C 开发方案** | **CONDITIONAL PASS** |

### Final Verdict: **CONDITIONAL PASS**

冻结主链 **可支撑** Feature V2 Foundation 方向；**当前代码存在可修复的 p0 双轨漂移**（训练直连 `SyllableSample`、Extractor 外置切片、Loader 绑定 `(80,)`）。进入 P8-C 须以 **WordInfo SSOT + 单 Extractor + Shard V2** 为不可谈判约束，且 **不得**引入 `FeatureTimestampRecord` 或 Training/Runtime 分叉管线。

---

## WordInfo SSOT Audit

### 类型定义（代码锚点）

```20:26:electron_node/services/faster_whisper_vad/shared_types.py
@dataclass
class WordInfo:
    """Word-level ASR metadata (requires word_timestamps=True)."""
    word: str
    start: Optional[float] = None
    end: Optional[float] = None
    probability: Optional[float] = None
```

Node 侧镜像：`electron-node/main/src/task-router/types.ts` → `AsrWordInfo`（字段一致）。

### 字段语义与 Feature 消费

| 字段 | 单位 | Tone Runtime 消费 | 进入 Feature Tensor | 裁决 |
|------|------|-------------------|---------------------|------|
| `start` | **秒 · float** | `_slice_audio` 起点 | **间接**（决定切片） | **SSOT 核心** |
| `end` | **秒 · float** | `_slice_audio` 终点 | **间接** | **SSOT 核心** |
| `word` | str | 非空门控（L32） | **否** | Metadata / 门控 |
| `probability` | float | **未使用** | **否** | ASR Metadata |

| Expected | Actual | Evidence | Impact | Severity | Action |
|----------|--------|----------|--------|----------|--------|
| start/end 为秒级 float | 是 | `shared_types` 注释 · P8-0 | Contract 对齐 | — | **KEEP** |
| Tone 以 WordInfo 切音 | 是 | `inference.py` L88–93 | Runtime SSOT 成立 | — | **KEEP** |
| probability 进特征 | 否 | 无引用 | 无泄漏 | — | **KEEP** |
| WordInfo 够作 V2 Timestamp Contract | 是 | 仅需 start/end + 切片策略 | 无需新类型 | — | **KEEP** |

### FeatureTimestampRecord 冗余审计

| Expected（P8-B） | Actual | Evidence | Impact | Severity | Action |
|------------------|--------|----------|--------|----------|--------|
| 禁止 FeatureTimestampRecord | P8-A 文档建议该名 | `Tone_V2_P8_A_*.md` L39–58 | 术语/抽象漂移 | **MEDIUM** | **DELETE**（设计层 · 不实现） |
| 代码库无 FeatureTimestampRecord | 无匹配 `.py` | `grep` 仅命中文档 | 无运行态漂移 | — | **KEEP** |

**裁决：** `WordInfo` **即** Feature V2 Timestamp Contract SSOT；不得再包装为平行 Record 类型。

### 隐藏门控：训练 Adapter 须注意

```28:33:electron_node/services/faster_whisper_vad/tone_module/inference.py
def _iter_words(segments: Sequence[SegmentInfo]) -> Iterable[WordInfo]:
    ...
        if w.word and w.start is not None and w.end is not None:
            yield w
```

| Expected | Actual | Evidence | Impact | Severity | Action |
|----------|--------|----------|--------|----------|--------|
| Adapter 输出可进 Extractor | `word` 非空才过 Runtime 门控 | `_iter_words` | TextGrid 适配须填占位 `word` 或 V2 Extractor 以 start/end 为准、word 可选 | **HIGH** | **MODIFY**（Foundation） |

---

## Runtime Timestamp Contract Audit

| 契约项 | 冻结值（p0） | V2 建议 |
|--------|-------------|---------|
| Timestamp 类型 | `WordInfo` | **同** |
| 时间单位 | 秒 | **同** |
| 音频基准（Runtime） | `processed_audio` @ 16kHz | **同**（VAD 后） |
| minSliceSec | `P0_MIN_SLICE_SEC = 0.02` | **沿用**（Contract 常量） |
| 切片取整 | `int(start * sr)` | **写入 V2 Contract** |
| padding/margin | 无 | **默认 0**；jitter 仅训练增强 |

---

## Training Adapter Audit

### 当前实际路径（p0-v1 · 漂移）

```100:107:electron_node/services/faster_whisper_vad/tone_module/training_io/feature_shard.py
        for sample in utterance_samples:
            clip = _slice_audio(audio, sr, sample.start, sample.end)
            mel_buf.append(extract_mel_features(clip, sr))
            label_buf.append(sample.label)
```

```88:93:electron_node/services/faster_whisper_vad/tone_module/inference.py
    for w in words:
        ...
        slices_audio.append(_slice_audio(processed_audio, sample_rate, float(w.start), float(w.end)))
```

| Expected（P8-B） | Actual | Evidence | Impact | Severity | Action |
|------------------|--------|----------|--------|----------|--------|
| 训练经 WordInfo Adapter | **否** | `feature_shard` 用 `SyllableSample` | 双轨 Timestamp Contract | **HIGH** | **MODIFY** |
| SyllableSample 不进 Extractor | **否** | 间接用 start/end | 同形不同型 | **HIGH** | **MODIFY** |
| label 并行于 WordInfo | 是 | Shard `labels` 数组 | 正确 | — | **KEEP** |
| wav_path 不进 WordInfo | 是 | 加载层 `sf.read(wav_path)` | 正确 | — | **KEEP** |

### 目标路径（P8-C 设计 · 本轮不实现）

```text
TextGrid → SyllableSample (Dataset Foundation · 冻结)
    → syllable_sample_to_word_info()   [Training Engineering · 新]
    → WordInfo
    → extract_feature_v2(audio, sr, word_info)
    → Feature Shard V2 row + label
```

### Adapter 归属

| 候选层 | 裁决 | 原因 |
|--------|------|------|
| Dataset Foundation | **禁止** | 不得改 `AlignmentProvider` / `SyllableSample` 语义 |
| Training Engineering | **是** | `training_io/syllable_to_wordinfo.py`（建议路径） |
| Feature Foundation (`tone_module/feature_v2.py`) | 仅 **消费** WordInfo | Adapter **不**做特征提取 |

### Adapter 字段映射（建议）

| SyllableSample | WordInfo | 说明 |
|----------------|----------|------|
| `start` | `start` | 秒 |
| `end` | `end` | 秒 |
| `label` | **不映射** | Shard `labels` |
| `wav_path` | **不映射** | 音频 I/O |
| — | `word` | 非空占位或可选 pinyin（**仅**过门控/诊断） |
| — | `probability` | `None` |

| Expected | Actual | Evidence | Impact | Severity | Action |
|----------|--------|----------|--------|----------|--------|
| Adapter 只做字段转换 | N/A | 未存在 | Foundation 新模块 | — | **MODIFY** |
| TextGrid 仅 GT Boundary | 是 | `alignment_textgrid.py` | Dataset 角色正确 | — | **KEEP** |

---

## Dataset Boundary Ownership Audit

```1:15:electron_node/services/faster_whisper_vad/tone_module/dataset/dataset_contract.py
"""Training Foundation — dataset contract (not Runtime SSOT)."""
...
class SyllableSample:
    wav_path: str
    start: float
    end: float
    label: int  # 0..4 => t1..t5
```

| 对象 | 层 | Feature Contract | V2 裁决 |
|------|-----|------------------|---------|
| `SyllableSample` | Dataset Foundation | **现状**间接参与 · **目标**退出 | **KEEP** 在 Dataset · **MODIFY** 训练入口 |
| `WordInfo` | Runtime SSOT | **目标**唯一边界 | **KEEP** |
| TextGrid | Alignment 源 | **否** | **KEEP** |
| `label` | 监督 | 并行通道 | **KEEP** |

---

## Feature V2 Contract Audit

### 推荐冻结包（P8-B 审计建议 · 本轮不冻结）

```text
featureVersion     = p1-frame-mel-f0-v1
sampleRate         = 16000
fixedFrames        = 64
frameLengthMs      = 25
hopLengthMs        = 10
nFft               = 400          # 16000 * 25 / 1000
hopLength          = 160          # 16000 * 10 / 1000
nMels              = 80
fMin               = 50.0
fMax               = 7600.0
minSliceSec        = 0.02         # 沿用 P0_MIN_SLICE_SEC
featureShape       = (64, 83)     # 见 channels 表
resamplePolicy     = duration_normalized_linear_interp
overflowPolicy     = center_crop_if_raw_frames_gt_fixed
overflowThreshold  = 0.03%         # P8 数据证据 @ 64f
```

> **注：** V2 STFT 窗长 **25 ms / hop 10 ms** 与 p0-v1（`n_fft=512`）**不同** — 这正是新 `featureVersion` 的必要性（P8 时长审计 · Mean-Mel 根因审计）。

### Channels 建议

| 通道 | 维度 | 进入 Contract | 说明 |
|------|------|---------------|------|
| frame-level log-mel | 80 | **是** | 核心 |
| log-F0 | 1 | **是** | 声调轮廓 |
| Δlog-F0 | 1 | **是** | 一阶差分 |
| voiced flag | 1 | **是** | 清浊 |
| log-energy | 1 | **建议首版纳入** | 轻量；可 ablation 于模型阶段非 Contract |
| **合计** | **83** | `channels=83` | `featureShape=(64,83)` |

### Policy 归属

| 项 | Contract | 训练增强 | 后续实验 |
|----|----------|----------|----------|
| duration-normalized interp | **是** | — | — |
| center crop overflow | **是** | — | — |
| boundary ±10–20ms jitter | **否** | **可选** SpecAugment | 可评估 |
| symmetric margin | **否** | 可选 | P8-C 实验项 |

### p0-v1 定位

| Expected | Actual | Evidence | Impact | Severity | Action |
|----------|--------|----------|--------|----------|--------|
| p0 作 legacy/regression | 应 | Mean-Mel 根因审计 | 非主质量路线 | — | **KEEP** |
| p0 与 V2 并行 | 须 | `P0_COMPATIBLE_FEATURE_VERSIONS` 模式 | 不得静默替换 | — | **KEEP** |

---

## Feature Extractor Mainline Audit

### 当前（冻结 p0）

```54:80:electron_node/services/faster_whisper_vad/tone_module/mel.py
def extract_mel_features(audio: np.ndarray, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    """Return (N_MELS,) mean-pooled log-mel vector for one word slice."""
    ...
    return mel.mean(axis=1).astype(np.float32)
```

- Timestamp **在函数外** 切片 — **不符合** P8-B 目标签名。
- `test_phase3_contracts.test_train_uses_runtime_mel_extractor` 强制训练引用 **同一** `extract_mel_features` — **良好先例**。

### V2 目标唯一入口（设计 · 禁止分叉）

```python
# tone_module/feature_v2.py （Foundation 新文件 · 建议）
def extract_feature_v2(
    audio: np.ndarray,
    sample_rate: int,
    word_info: WordInfo,
    *,
    baseline: ToneFeatureBaselineV1,  # 冻结后命名
) -> np.ndarray:
    """Return (fixedFrames, channels) from audio + WordInfo boundary."""
```

### 禁止项扫描

| 禁止模式 | 代码库 | Severity | Action |
|----------|--------|----------|--------|
| `extractFeatureFromTextGrid` | **无** | — | **KEEP** |
| `extractFeatureForTraining` / `Runtime` | **无** | — | **KEEP** |
| `training_mel.py` / `runtime_mel.py` | **无** | — | **KEEP** |
| `FeatureTimestampRecord` extractor | **无** | — | **DELETE**（若提议） |
| 第二 mel 模块 | **无** | — | **KEEP** |

### 主链对照

```text
Training (V2 目标):
  SyllableSample → WordInfo Adapter → WordInfo
  → extract_feature_v2 (shared)
  → Feature Shard V2

Runtime (V2 目标):
  FW WordInfo → extract_feature_v2 (shared)
  → backend → TonePosterior
```

| Expected | Actual | Evidence | Impact | Severity | Action |
|----------|--------|----------|--------|----------|--------|
| 单 Extractor | p0 单 `mel.py` | test_phase3 | V2 延续 | — | **KEEP** 模式 |
| Extractor 接受 WordInfo | 否 | 外置 `_slice_audio` ×2 | 重复实现 | **MEDIUM** | **MODIFY** |

---

## Feature Shard V2 Audit

### v1 现状（冻结 `training_feature_shard_v1`）

| 字段 | 形状 | 说明 |
|------|------|------|
| `mel` | `(N, 80)` | mean-pooled p0 |
| `labels` | `(N,)` | tone class |
| `global_index` | `(N,)` | 索引 |
| Timestamp | **无** | — |
| `featureVersion` | `p0-v1` | manifest |

`ShardReader.get_row` → `(mel_80, label)` — 无 WordInfo。

### V2 建议 schema（Foundation · 不冻结）

```text
schemaVersion: training_feature_shard_v2
featureVersion: p1-frame-mel-f0-v1
features: (N, fixedFrames, channels) float32
labels: (N,) int64
global_index: (N,) int64
# 可选诊断列（不进训练张量决策）:
timestamp_start: (N,) float32
timestamp_end: (N,) float32
manifest.boundaryProvider: "textgrid_pinyin_v1"   # diagnostics only
manifest.fixedFrames / channels / resamplePolicy / ...
```

| Expected | Actual | Evidence | Impact | Severity | Action |
|----------|--------|----------|--------|----------|--------|
| 不存 SyllableSample | v1 未存 | 仅 mel+label | — | — | **KEEP** |
| 不直接读 TextGrid | v1 否 | build 时读 wav+sample | V2 须经 Adapter | — | **MODIFY** |
| boundaryProvider 不进 tensor | v1 无字段 | — | V2 manifest only | — | **MODIFY** |
| 保存 WordInfo start/end 诊断 | v1 无 | — | 建议 V2 可选 | **LOW** | **MODIFY** |
| word/probability 保存 | 不建议 | 体积/无训练价值 | 可选 manifest 统计 | **LOW** | **KEEP** 省略 |

**防 Training-only Pipeline：** Shard 物化脚本 **调用与 Runtime 相同的** `extract_feature_v2`；差异仅在 **Adapter 来源** 与 **音频来源**（文件 vs 流），**非**不同 Extractor。

---

## Runtime / Loader / Artifact / Backend Impact Audit

| 组件 | p0 现状 | V2 影响 | Foundation Phase? | Action |
|------|---------|---------|-------------------|--------|
| `contract.py` | `P0_*` only | 新增 `P1_*` / `ToneFeatureBaselineV1` | **是** | **MODIFY** |
| `mel.py` | mean-mel | **KEEP 冻结**；V2 用新 `feature_v2.py` | p0 否 · V2 是 | **KEEP** p0 / **MODIFY** 新增 |
| `feature_v2.py` | 不存在 | 单 Extractor | **是** | **MODIFY** 新增 |
| `inference.py` | mel + WordInfo 外置切片 | 改调 `extract_feature_v2` | **是** | **MODIFY** |
| `loader.py` | `w1: (80,32)` 硬编码 | 新 backend 形状 | **是** | **MODIFY** |
| `validate_artifact.py` | `(80,)` probe | 新 shape / backend | **是** | **MODIFY** |
| `backends/numpy_p0.py` | `mel_batch[N,80]` | 新 `numpy_p1` 或扩展 | **是** | **MODIFY** 新 adapter 文件 |
| `classifier.py` | MLP on 80-d | CNN/CRNN 输入 `(64,C)` | **是** | **MODIFY** |
| `training_io/feature_shard.py` | v1 + SyllableSample | v2 builder + Adapter | **是** TE 再冻结 | **MODIFY** |
| `training_io/shard_reader.py` | `mel[N,80]` | `features[N,T,C]` | **是** | **MODIFY** |
| `train_tone_cnn.py` | p0 训练 | 新训练入口或 `--feature-version` | 模型阶段可扩展 | **MODIFY** |
| `dataset/*` | SyllableSample | **不修改** Adapter 在外 | **否** | **KEEP** |
| Node E2E / FW HTTP | `WordInfo` 已存在 | 无 schema 变 | **否** | **KEEP** |
| Recall / Ranking | `AcousticToneSlice` | 仍用 posterior · 非特征张量 | **否** | **KEEP** |

**不得在普通 `tone_cnn_p*` 权重训练中静默修改：** `loader` 形状 · `mel.py` 语义 · v1 shard schema。

---

## Boundary Consistency Dependency Audit

| 项 | 结论 |
|----|------|
| TextGrid 音节 vs FW 字级 | **语义差**（P8-0 · P8-A） |
| V2 Shard 全量构建前 | **必须** Boundary Consistency Audit |
| 审计性质 | 只读 · 同 wav 对比 start/end/IoU |
| 禁止 | 第二 Dataset Pipeline · 第二 Runtime · 训练特征生成 |
| 不替代 | Runtime Validation |

| Expected | Actual | Evidence | Impact | Severity | Action |
|----------|--------|----------|--------|----------|--------|
| 帧长决策不依赖 FW 对比 | 已完成 P8 时长 | P8 报告 | — | — | **KEEP** |
| Shard V2 前边界审计 | 未执行 | — | 域偏移风险 | **MEDIUM** | **MODIFY**（排期） |

---

## Frozen Architecture Verification

| 检查项 | 结果 |
|--------|------|
| Single Runtime Mainline | **PASS** — `api_routes` → `run_tone_inference` |
| Single Model per Service | **PASS** — Contract Freeze §4 |
| Runtime Fail-Closed | **PASS** — `skippedReason` 四值 |
| Dataset ↔ Feature 解耦 | **PARTIAL** — 训练仍直连 SyllableSample |
| Training Engineering ↔ Runtime 解耦 | **PASS** — 无 training import inference 决策 |
| Extractor 共享（p0） | **PASS** — 同一 `mel.extract_mel_features` |
| Tone Decision @ Recall/Ranking | **PASS** — Assembly tone-free |
| 无 Registry/Switching/Shadow Tone | **PASS** — `test_phase2_contracts` |
| 本轮未改冻结层 | **PASS** |

---

## Architecture Drift Audit

| 漂移项 | Expected | Actual | Severity | Action |
|--------|----------|--------|----------|--------|
| Timestamp SSOT = WordInfo only | 是 | 训练用 SyllableSample 直连 | **HIGH** | **MODIFY** |
| FeatureTimestampRecord | 禁止 | P8-A 文档建议 | **MEDIUM** | **DELETE** 设计 |
| 重复 `_slice_audio` | 单处 | `inference.py` + `feature_shard.py` + `train_tone_cnn.py` | **MEDIUM** | **MODIFY** 统一到 `feature_v2` / `slice_audio` |
| Extractor 无 WordInfo 参数 | 应有 | `extract_mel_features(audio)` only | **HIGH** | **MODIFY** |
| mean-mel 作主路线 | 否 | p0 仍生产主链 | **已知** | **KEEP** legacy |
| `offline_tone_eval` | 隔离 | 无 runtime import | — | **KEEP** |
| FW `shadowBeamSpanSets` | tone-free | `span-assembly-v4` | — | **KEEP**（非 Tone Shadow） |
| dedup 丢 words | FW Detector skip dedup | 主链已缓解 | **LOW** | **KEEP** |
| P0 loader `(80,32)` 绑定 | V2 需新 backend | 预期 | — | **MODIFY** Foundation |

**术语：** 活跃 SSOT 无 “Training Feature Pipeline” / “Streaming Feature”；实验 JSON 历史 “smoke” 仅文件名语境（TERMINOLOGY）。

---

## Drift Matrix

| ID | 领域 | Expected | Actual | Severity | Action |
|----|------|----------|--------|----------|--------|
| D1 | Timestamp | WordInfo only | SyllableSample in shard | HIGH | MODIFY |
| D2 | Extractor API | `extract(audio, sr, WordInfo)` | slice outside | HIGH | MODIFY |
| D3 | Abstract | No FeatureTimestampRecord | P8-A doc | MED | DELETE |
| D4 | STFT | V2 25/10 ms | p0 512/160 | — | MODIFY new version |
| D5 | Shard | v2 frame tensor | v1 mean 80 | — | MODIFY |
| D6 | Adapter | syllable→WordInfo | missing | HIGH | MODIFY |
| D7 | word gate | training needs word | empty fails `_iter_words` | MED | MODIFY |

---

## Ownership Matrix

| 概念 | Owner | 进入 Feature | 进入 Shard Tensor | 进入 manifest diagnostics |
|------|-------|--------------|-------------------|---------------------------|
| `WordInfo.start/end` | **Runtime SSOT** | 是（via slice） | 可选 start/end 列 | 否 |
| `WordInfo.word` | Runtime metadata | 否 | 否 | 否 |
| `WordInfo.probability` | ASR metadata | 否 | 否 | 否 |
| `SyllableSample` | Dataset Foundation | **否（目标）** | 否 | 否 |
| `label` | Training supervision | 否 | **是** (`labels`) | 否 |
| `boundaryProvider` | Diagnostics | 否 | 否 | **是** |
| `wav_path` | Dataset / I/O | 否 | 否 | 否 |

---

## Decision Path Matrix

| 决策 | 选项 | 审计裁决 |
|------|------|----------|
| Timestamp SSOT | WordInfo vs FeatureTimestampRecord | **WordInfo** |
| 训练入口 | SyllableSample 直连 vs Adapter | **Adapter → WordInfo** |
| Extractor 数量 | 1 vs 2 | **1** (`feature_v2.py`) |
| featureVersion | p0-v1 vs p1-frame-mel-f0-v1 | **新 version 并行** |
| fixedFrames | 32/48/64/80 | **64**（P8 数据） |
| Shard schema | v1 vs v2 | **v2 新 schema** |
| p0 mean-mel | 退役 vs legacy | **legacy baseline** |
| Boundary audit 时机 | 前 vs 后 Shard | **Shard V2 全量前** |

---

## Dead Feature Matrix

| 项 | 状态 | 说明 | Action |
|----|------|------|--------|
| `WordInfo.probability` in Tone | 未消费 | 可保留 ASR 字段 | KEEP |
| `mel_mean`/`mel_std` in npz | p0 可选归一化 | V2 可能 frame-norm | MODIFY |
| Segment-level tone slice | 未用于特征 | 仅 words | KEEP |
| `FeatureTimestampRecord` | 仅文档 | 未实现 | DELETE |
| Registry/Switching | 禁止 | 测试门禁 | KEEP |

---

## Required Repair Matrix（Foundation Phase 工作包）

| 优先级 | 项 | 依赖 |
|--------|-----|------|
| P0 | 冻结 `p1-frame-mel-f0-v1` Contract 文档 + `P1_*` 常量 | P8-C |
| P0 | `syllable_sample_to_word_info` Adapter（Training Engineering） | Contract |
| P0 | `feature_v2.extract_feature_v2(audio, sr, WordInfo)` | Contract |
| P0 | `training_feature_shard_v2` + Reader | Extractor |
| P1 | `inference.py` 切到 V2（新 model path only） | Loader/backend |
| P1 | 新 backend + loader 形状 | Artifact schema |
| P1 | Boundary Consistency Audit | 数据证据 |
| P2 | 训练增强 jitter | 可选 |

---

## KEEP / MODIFY / RESTORE / DELETE

| Action | 对象 |
|--------|------|
| **KEEP** | `WordInfo` 为唯一 Timestamp SSOT |
| **KEEP** | `SyllableSample` 在 Dataset Foundation |
| **KEEP** | `p0-v1` / `mel.py` / v1 shard / `numpy_p0` 冻结至 V2 投产 |
| **KEEP** | Single Runtime · Fail-closed · Recall ownership |
| **KEEP** | `extract_mel_features` 共享先例（V2 单 `extract_feature_v2`） |
| **MODIFY** | 新增 `feature_v2.py` · `P1_*` contract · Adapter · Shard v2 · loader/backend |
| **MODIFY** | `inference.py` · `feature_shard` 构建路径 |
| **RESTORE** | — |
| **DELETE** | `FeatureTimestampRecord` 及平行 Timestamp 类型（设计层） |
| **DELETE** | 任何 `extractFeatureFromTextGrid` / Training-Runtime 分叉 API（若提议） |

---

## Final Verdict

### **CONDITIONAL PASS**

**条件：**

1. P8-C 开发方案 **必须** 以 `WordInfo` 为唯一 Timestamp Contract，**禁止** `FeatureTimestampRecord`；
2. Feature Shard V2 构建 **必须** 经 `SyllableSample → WordInfo` Adapter，**禁止** Extractor 接受 `SyllableSample`/TextGrid；
3. **单** `extract_feature_v2(audio, sample_rate, word_info)` — 训练与 Runtime 共用；
4. 所有 Contract/Loader/Shard/Backend 变更走 **Feature V2 Foundation Phase + Training Engineering 再冻结**，不在 p3/p4 权重训练中夹带；
5. Canonical Shard V2 全量物化前完成 **Boundary Consistency Audit**。

---

## 终局问题回答

| # | 问题 | 回答 |
|---|------|------|
| 1 | WordInfo 可否作 Feature V2 Timestamp 唯一 SSOT？ | **可以** — `start`/`end` 秒级 float 足够 |
| 2 | 是否禁止 FeatureTimestampRecord？ | **是** — 冗余抽象；P8-A 建议应 **DELETE** |
| 3 | Training 是否必须先 Adapter 再 Extractor？ | **是** — 当前 **未满足** · Foundation 必补 |
| 4 | TextGrid/SyllableSample 是否退出 Feature Contract？ | **是** — 留 Dataset · 仅经 Adapter 转 WordInfo |
| 5 | Feature V2 Extractor 是否只认 WordInfo？ | **是** — 禁止 SyllableSample/TextGrid 入参 |
| 6 | 推荐 featureVersion/shape/policy？ | `p1-frame-mel-f0-v1` · `(64,83)` · 25ms/10ms · duration-linear interp · center crop overflow · minSlice 0.02s |
| 7 | Feature Shard V2 如何免 Training-only Pipeline？ | 同 Extractor 物化 · Adapter 仅上游 · `boundaryProvider` 仅 manifest |
| 8 | 影响哪些冻结层？ | **Foundation：** contract/feature_v2/inference/loader/validate/backend/shard/reader；**KEEP：** dataset/p0-v1/Node HTTP/Recall |
| 9 | V2 Shard 前是否必须 Boundary Audit？ | **是** — 只读 · 非第二 Pipeline |
| 10 | 可否进入 P8-C 开发方案？ | **是（CONDITIONAL PASS）** |

---

*Audit: read-only · 2026-07-04 · No code or frozen layer modified*
