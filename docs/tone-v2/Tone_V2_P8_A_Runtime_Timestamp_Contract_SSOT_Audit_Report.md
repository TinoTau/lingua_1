# Tone V2 P8-A — Runtime Timestamp Contract SSOT Audit Report

**Date:** 2026-07-03  
**Phase:** P8-A（Runtime Timestamp Contract SSOT）  
**Audit Type:** Read-only Architecture Audit（**非开发** · **非训练** · **非冻结**）  
**Goal:** 确认 Runtime Timestamp Contract 为 Feature 边界 **唯一 SSOT**，并审计 Training Timestamp Adapter 设计路径，**禁止** Training 专用 Timestamp Contract。

**依据：**

- [TONE_V2_CONTRACT_FREEZE.md](./TONE_V2_CONTRACT_FREEZE.md)
- [TONE_V2_DATASET_FOUNDATION_FREEZE.md](./TONE_V2_DATASET_FOUNDATION_FREEZE.md)
- [TONE_V2_TRAINING_ENGINEERING_FREEZE.md](./TONE_V2_TRAINING_ENGINEERING_FREEZE.md)
- [TONE_V2_TERMINOLOGY.md](./TONE_V2_TERMINOLOGY.md)
- [Tone_V2_P8_0_Training_Runtime_Timestamp_Consistency_Audit_Report.md](./Tone_V2_P8_0_Training_Runtime_Timestamp_Consistency_Audit_Report.md)
- [Tone_V2_P8_FeatureV2_Syllable_Duration_Frame_Length_Audit_Report.md](./Tone_V2_P8_FeatureV2_Syllable_Duration_Frame_Length_Audit_Report.md)

**禁止项（本轮）：** 修改 Runtime · Loader · Contract · Feature Baseline · Dataset Foundation · Training Engineering · Validation · Artifact · Node E2E · 训练 · 新权重

---

## Executive Summary

| 项 | 结论 |
|----|------|
| Runtime 事实上的 Timestamp Contract | `WordInfo`：`word` · `start` · `end` · `probability`（秒 · float） |
| Tone Runtime **实际消费**（特征边界） | **`start` · `end`**；`word` 仅门控过滤；`probability` **未**进入特征 |
| 训练当前消费 | **`SyllableSample`**（`wav_path` · `start` · `end` · `label`）— **直接**进 Feature Shard |
| Contract 是否已统一 | **否（p0-v1 隐式双轨）** — 同形 `start/end` 切片，**不同类型与语义** |
| Runtime Timestamp 是否足够作唯一 SSOT | **是** — 以 `start/end` 为核心；须 **正式化** 为 Feature 层命名类型 |
| 训练是否应先 Adapter 再 Feature | **是** — `SyllableSample` → Runtime Timestamp Record → Extractor |
| TextGrid / `SyllableSample` 是否应退出 Feature Contract | **是** — 保留在 **Dataset Foundation**；不得定义 Feature 边界 SSOT |
| Feature Extractor 是否应只认 Runtime Timestamp | **是（V2 目标）** — 当前 `extract_mel_features(audio)` **无** timestamp 参数 |
| Feature Shard V2 是否应存 Runtime Timestamp | **建议是** — 诊断/复现；`boundaryProvider` 仅 manifest 元数据 |
| 新 Boundary Provider 是否只需 Adapter | **是** — Feature Extractor 不变 |
| 可否进入 Feature V2 Contract Foundation | **是** — 须单独立项正式冻结类型与 Adapter |

### Final Verdict: **CONDITIONAL PASS**

架构方向 **成立**：`WordInfo` 语义已覆盖 Runtime 全部特征边界需求；**当前实现尚未 formalize**，训练仍直连 `SyllableSample`。进入 Feature V2 Foundation 时须：**(1)** 冻结 **单一** `FeatureTimestampRecord`（与 `WordInfo` 同构 + 可选 `boundaryProvider` 诊断字段）；**(2)** 引入 **Training Timestamp Adapter**；**(3)** **不得**新增 Training Timestamp Contract 或第二 Extractor 接口。

---

## Runtime Timestamp Contract

### 定义（审计推导 · 本轮不冻结）

**Runtime Timestamp Contract** = Feature 层认可的 **唯一音频切片边界记录**，与 FW 输出的 `WordInfo` **同构**：

```text
FeatureTimestampRecord  （建议 Foundation 正式名）
├── start: float          # 秒 · REQUIRED · 进入 Feature Contract
├── end: float            # 秒 · REQUIRED · 进入 Feature Contract
├── word: Optional[str]   # OPTIONAL · 门控/追溯 · 不进入特征张量
├── probability: Optional[float]  # OPTIONAL · Metadata · 不进入 Feature Contract
└── boundary_provider: Optional[str]  # OPTIONAL · Diagnostics only · 不得参与训练决策
```

> **说明：** 现有代码类型名为 `WordInfo`（`shared_types.py`）。Foundation Phase 可 **typedef/alias** 为 `FeatureTimestampRecord`，或新增薄包装；**不得**再发明并行的 Training 专用结构。

### WordInfo 字段消费矩阵

| 字段 | 类型 | 单位 | Tone Runtime 消费 | 进入 Feature Contract | 性质 |
|------|------|------|-------------------|----------------------|------|
| `word` | `str` | — | 过滤空 token（L32–33） | **否** | 门控 Metadata |
| `start` | `float` | **秒** | `_slice_audio` 起点（L92） | **是** | **SSOT 核心** |
| `end` | `float` | **秒** | `_slice_audio` 终点（L92） | **是** | **SSOT 核心** |
| `probability` | `float` | 0–1 | **未使用** | **否** | ASR Metadata |

| Expected | Actual | Evidence | Impact | Action |
|----------|--------|----------|--------|--------|
| 特征边界仅 start/end | 是 | `inference.py` L88–93 | Contract 可最小化 | **KEEP** |
| probability 进特征 | 否 | 无引用 | 避免特征泄漏 | **KEEP** |
| segment.start/end 切音 | 否 | 仅用 `words[]` | Segment 非 Timestamp SSOT | **KEEP** |

### 不得进入 Feature Contract 的 Runtime 对象

| 对象 | 原因 |
|------|------|
| `SegmentInfo` | 段级；Tone 迭代 `words[]` |
| `AcousticToneSlice` | **输出**（含 `tonePosterior`），非输入边界 |
| `vad_segments` | sample index · VAD 层 |
| `SyllableSample` | Dataset Foundation · 含 `label`/`wav_path` |
| `processed_audio` | 音频载体，非 timestamp |

---

## Runtime Timestamp Ownership

| 层级 | Owner | 职责 |
|------|-------|------|
| **产生** | FW ASR Worker | `word_timestamps=True` → `segments[].words[]` |
| **传输** | `UtteranceResponse` / `ASRResult` | HTTP + Node TaskRouter |
| **特征边界 SSOT** | **Tone Feature Layer**（拟 Feature V2 Foundation） | 正式 `FeatureTimestampRecord` |
| **切片执行** | `inference._slice_audio` | `int(start*sr)` .. `int(end*sr)` |
| **Recall 对齐** | Node `tone-time-align` | `WordTimeSpan` 自 `segments.words` 构建 |
| **决策** | Recall only | `AcousticToneSlice` 时间重叠 · 非重新切音 |

**Ownership 裁决：** Timestamp **边界语义** 归 **Feature Contract**；FW 是 Runtime **默认 Boundary Provider**，不是 Contract 所有者。

---

## Dataset Timestamp Ownership

| 对象 | 归属 | 字段 | 是否 Feature SSOT |
|------|------|------|-------------------|
| `SyllableSample` | **Dataset Foundation**（冻结） | `wav_path` · `start` · `end` · `label` | **否** |
| TextGrid interval | AlignmentProvider 内部 | pinyin+tone token · xmin/xmax | **否** — Ground Truth Boundary 源 |
| `DatasetManifest.metadata.alignment_provider` | Dataset | `textgrid_pinyin_v1` | 数据集元数据 |

```1:15:electron_node/services/faster_whisper_vad/tone_module/dataset/dataset_contract.py
"""Training Foundation — dataset contract (not Runtime SSOT)."""
...
class SyllableSample:
    """Canonical training sample between Alignment and Feature Extraction."""
    wav_path: str
    start: float
    end: float
    label: int  # 0..4 => t1..t5
```

| Expected | Actual | Evidence | Impact | Action |
|----------|--------|----------|--------|--------|
| SyllableSample 属 Dataset | 是 | 文件头注释 + DATASET_FOUNDATION_FREEZE | 不得进 Runtime HTTP | **KEEP** |
| SyllableSample 定义 Feature Contract | **否（目标）** / **是（现状 p0）** | `feature_shard.py` 直接消费 | V2 须 Adapter | **MODIFY** |
| `label` 属监督信号 | 是 | Shard `labels` 数组 | 与 Timestamp Contract 分离 | **KEEP** |

**TextGrid 角色：** 仅 **Ground Truth Boundary Provider**（音节级）；**退出** Feature Contract 后仍留在 Dataset Foundation，**不修改**冻结 Provider。

---

## Training Timestamp Adapter

### 应存在（V2 Foundation · 本轮仅设计）

```text
TextGrid / SyllableSample  (Dataset Foundation · 冻结)
        ↓
Training Timestamp Adapter   (Training Engineering · 新组件)
        ↓
FeatureTimestampRecord       (与 WordInfo 同构 · Feature SSOT)
        ↓
slice_audio + FeatureV2.extract()
        ↓
Feature Shard V2
```

### 建议映射规则

| SyllableSample 字段 | 映射到 FeatureTimestampRecord | 说明 |
|---------------------|------------------------------|------|
| `start` | `start` | 直接复制（秒） |
| `end` | `end` | 直接复制（秒） |
| `label` | **不映射** | 并行写入 Shard `labels` |
| `wav_path` | **不映射** | 音频加载层使用 |
| （无 text） | `word=None` 或 TextGrid token | 可选；**不参与**特征（P8-0：音节≠字） |
| — | `boundary_provider="textgrid_pinyin_v1"` | Diagnostics only |
| — | `probability=None` | 训练无 ASR 概率 |

### 命名裁决

| 用户提议 | 审计建议 | 原因 |
|----------|----------|------|
| `TrainingTimestampRecord` | **不推荐** 作为 SSOT 名 | 暗示 Training 专用 Contract |
| `TrainingTimestampRecord` | 可作 **Adapter 输出别名** | 若与 `FeatureTimestampRecord` 同构则可接受 |
| 并行 Training Contract | **禁止** | 违反本轮目标 |

| Expected | Actual | Evidence | Impact | Action |
|----------|--------|----------|--------|--------|
| 训练先 Adapter 再 Feature | **未实现** | `feature_shard` 直连 `SyllableSample` | V2 必补 | **MODIFY** |
| Adapter 在 Dataset Foundation | 否 | 应在 Training Engineering | 不污染 Dataset SSOT | **KEEP** 边界 |

---

## Runtime Timestamp Adapter

Runtime 路径 **已存在** 薄适配：

```python
# inference.py — 事实上的 Runtime Timestamp Adapter
def _iter_words(segments) -> Iterable[WordInfo]:
    for w in words:
        if w.word and w.start is not None and w.end is not None:
            yield w
```

| 步骤 | 输入 | 输出 |
|------|------|------|
| FW Worker | `processed_audio` | `segments[].words[]` |
| `_iter_words` | `SegmentInfo[]` | `WordInfo` 流 |
| 门控 | `dur >= P0_MIN_SLICE_SEC` | 有效 `WordInfo` 列表 |
| 切片 | `WordInfo.start/end` | `audio slice` |

**V2 建议：** 显式 `fw_word_to_feature_timestamp(w: WordInfo) -> FeatureTimestampRecord`，`boundary_provider="fw_word_v1"`。

| Expected | Actual | Evidence | Impact | Action |
|----------|--------|----------|--------|--------|
| Runtime 无需第二 Adapter 类型 | 基本成立 | `_iter_words` 已足够 |  formalize 即可 | **KEEP** |
| 新 FW 字段 | 无 | 四字段稳定 | — | **KEEP** |

---

## Feature Extractor Contract

### 当前（p0-v1 · 冻结）

```python
extract_mel_features(audio: np.ndarray, sample_rate: int) -> np.ndarray  # (80,)
```

Timestamp **在 Extractor 外** 由 `_slice_audio` 消费；**隐式** 双处复制（`inference.py` · `feature_shard.py`）。

### V2 目标（本轮设计 · 不实现）

```python
# 单一接口 · 禁止分叉
def extract_feature_v2(
    audio: np.ndarray,
    sample_rate: int,
    timestamp: FeatureTimestampRecord,
    *,
    baseline: ToneFeatureBaseline,
) -> np.ndarray:  # shape (fixedFrames, channels)
    clip = slice_audio_by_timestamp(audio, sample_rate, timestamp.start, timestamp.end)
    ...
```

| 禁止接口 | 裁决 |
|----------|------|
| `extractFeatureFromTextGrid()` | **禁止** |
| `extractFeatureFromTraining()` | **禁止** |
| `extractFeatureRuntime()` | **禁止** |
| `extract_mel_features` 训练/Runtime 各一套 | **禁止**（p0 已共享一套 · V2 延续） |

| Expected | Actual | Evidence | Impact | Action |
|----------|--------|----------|--------|--------|
| Extractor 只认统一 Timestamp | **否（p0）** | 无 timestamp 参数 | V2 Foundation 项 | **MODIFY** |
| 单 Extractor 函数 | **是（p0 mel）** | Shard + inference 同 import | V2 延续 | **KEEP** |

---

## Feature Shard Contract

### 当前 v1（冻结 · `training_feature_shard_v1`）

**每行存储：**

| 字段 | 内容 | Timestamp? |
|------|------|------------|
| `mel` | `(N, 80)` float32 | **无** |
| `labels` | `(N,)` int64 | 监督 · 非 Timestamp |
| `global_index` | `(N,)` int64 | 索引 |

**未保存** `start`/`end`/`word`/`boundary_provider`。

### V2 建议（Foundation Phase · 不冻结）

| 字段 | 建议 | 进入训练张量 |
|------|------|-------------|
| `features` | `(N, fixedFrames, C)` | **是** |
| `labels` | `(N,)` tone class | **是**（监督 · 非 Timestamp Contract） |
| `timestamps_start` | `(N,)` float32 可选 | **否** — 复现/审计 |
| `timestamps_end` | `(N,)` float32 可选 | **否** |
| `boundary_provider` | manifest 级或 per-row 可选 | **否** — Diagnostics |
| `featureVersion` | manifest | Contract 对齐 |

| Expected | Actual | Evidence | Impact | Action |
|----------|--------|----------|--------|--------|
| Shard 存 SyllableSample 对象 | 否 | 仅 mel+label | — | **KEEP** |
| Shard 应存 Runtime Timestamp | **未实现** | v1 无时间字段 | V2 建议补 | **MODIFY** |
| boundaryProvider 影响训练 | 不得 | 无此字段 | V2 保持 diagnostic-only | **KEEP** |

---

## Timestamp Ownership Matrix

| 概念 | Owner 层 | 进入 Feature Contract | 进入 Shard 张量 | 进入 Runtime HTTP |
|------|----------|----------------------|-----------------|-------------------|
| `start` / `end` | **Feature Timestamp SSOT** | **是** | 可选诊断列 | 经 `AcousticToneSlice` 回传 |
| `word` | Feature Metadata | 否 | 可选 | ASR segments |
| `probability` | ASR Metadata | 否 | 否 | ASR segments |
| `boundary_provider` | Diagnostics | 否 | manifest only | 否 |
| `label` (0..4) | Training Supervision | 否 | **是** (`labels`) | 否 |
| `wav_path` | Dataset | 否 | 否 | 否 |
| TextGrid token | Dataset Alignment | 否 | 否 | 否 |

---

## Timestamp Contract Matrix

| Contract 名称 | 存在？ | 字段 | 用于 Feature？ | 裁决 |
|---------------|--------|------|----------------|------|
| **Runtime / `WordInfo`** | **是（de facto SSOT）** | word, start, end, probability | start/end | **KEEP → formalize** |
| **`SyllableSample`** | 是（Dataset） | wav_path, start, end, label | 现状 p0 间接用 start/end | **退出 Feature Contract** |
| Training Timestamp Contract | **不得新增** | — | — | **DELETE（若有人提议）** |
| Runtime-only Timestamp Contract | **不得新增** | — | — | **DELETE（若有人提议）** |
| `AcousticToneSlice` | 输出 Contract | start, end, tonePosterior | 输出非输入 | **KEEP** 分离 |

---

## Boundary Provider Matrix

| Provider | 层级 | 产出 | Adapter → FeatureTimestampRecord | 修改 Extractor？ |
|--------|------|------|----------------------------------|------------------|
| **FW `word_timestamps`** | Runtime | `WordInfo` | `_iter_words`（现）/ 显式函数（V2） | **否** |
| **TextGrid `textgrid_pinyin_v1`** | Dataset Foundation | `SyllableSample` | **Training Timestamp Adapter**（V2 新） | **否** |
| 未来（例：MFA 在线） | 新 Provider | 自定义 | 新 Adapter 同构输出 | **否** |

| Expected | Actual | Evidence | Impact | Action |
|----------|--------|----------|--------|--------|
| Provider 与 Feature 解耦 | 部分（p0 同形不同型） | 双类型 start/end | V2 Adapter 统一 | **MODIFY** |
| 新 Provider 只加 Adapter | 架构允许 | P8-0 + Dataset Freeze 扩展规则 | — | **KEEP** |

---

## Feature Contract Matrix

| 维度 | p0-v1（冻结） | Feature V2（Foundation 目标） |
|------|---------------|------------------------------|
| Timestamp SSOT | 隐式 `WordInfo` / `SyllableSample` 并行 | **`FeatureTimestampRecord` 唯一** |
| Extractor 输入 | `audio` only（timestamp 外置切片） | `audio` + `FeatureTimestampRecord` |
| 训练边界来源 | `SyllableSample` 直连 | **Adapter** ← `SyllableSample` |
| Runtime 边界来源 | `WordInfo` | `WordInfo` → 同构 Record |
| 监督 | `label` 并行 | `label` 并行（**非** Timestamp 字段） |
| featureVersion | `p0-v1` | `p1-frame-mel-f0-v1`（建议 · P8 审计） |
| Shard schema | `training_feature_shard_v1` | `training_feature_shard_v2`（新 Foundation） |

---

## Frozen Architecture Verification

| 检查项 | 结果 |
|--------|------|
| 本轮修改 Runtime / Dataset / Training Engineering | **否** |
| 本轮修改冻结 Contract / Feature Baseline | **否** |
| 审计类型 | Read-only Architecture Audit |
| 设计项归属 | **Feature V2 Contract Foundation Phase**（非普通训练） |
| Dataset Foundation `SyllableSample` | **保持冻结** — Adapter **不**改 Provider |
| 禁止第二 Training Feature Pipeline | 设计合规 |
| 禁止 Training Timestamp Contract | 设计合规 |

---

## Architecture Drift Audit

| 项 | Expected（P8-A 目标） | Actual（当前代码） | 判定 |
|----|------------------------|---------------------|------|
| 单一 Timestamp SSOT 类型 | `FeatureTimestampRecord` | `WordInfo` + `SyllableSample` 双轨 | **DRIFT** |
| 训练经 Adapter | 是 | `feature_shard` 直连 `SyllableSample` | **DRIFT** |
| Extractor 接受 Timestamp 参数 | V2 是 | 否 | **DRIFT（V2 待做）** |
| 共享 mel 提取器 | 是 | `extract_mel_features` 共享 | **PASS** |
| 单 Runtime Tone 路径 | 是 | `run_tone_inference` | **PASS** |
| SyllableSample 在 Dataset 层 | 是 | `dataset_contract.py` | **PASS** |

---

## KEEP / MODIFY / RESTORE / DELETE

| 动作 | 对象 | 说明 |
|------|------|------|
| **KEEP** | `WordInfo` 四字段语义 | Runtime Timestamp 事实标准 |
| **KEEP** | `SyllableSample` 在 Dataset Foundation | Ground Truth + 标签；**不**进 Runtime |
| **KEEP** | `start`/`end` 为唯一特征边界 | `probability`/`word` 不进入 Contract |
| **KEEP** | p0-v1 冻结路径至 V2 上线 | 并行 featureVersion |
| **KEEP** | 单 `extract_mel_features` 共享模式 | V2 升级为 `extract_feature_v2` |
| **MODIFY** | Feature V2 Foundation | 正式 `FeatureTimestampRecord` |
| **MODIFY** | Training Engineering | **Training Timestamp Adapter**（SyllableSample → Record） |
| **MODIFY** | `feature_shard_v2` | 可选存 timestamp 列 + manifest `boundaryProvider` |
| **MODIFY** | `inference.py` | 显式 Record + 统一 `slice_audio_by_timestamp` helper |
| **RESTORE** | — | 无 |
| **DELETE** | Training-only / Runtime-only Timestamp Contract（若提议） | 禁止 |
| **DELETE** | `extractFeatureFromTextGrid` 类第二接口（若提议） | 禁止 |

---

## Final Verdict

### **CONDITIONAL PASS**

**成立：**

1. Runtime Timestamp Contract（`WordInfo` 语义，核心 `start`/`end`）**足够**作为 Feature 输入 **唯一 SSOT**；
2. 训练 **必须** 经 **Training Timestamp Adapter** 再进 Extractor，**不得**直连 `SyllableSample` 定义 Feature Contract；
3. TextGrid / `SyllableSample` **应退出** Feature Contract，保留为 Dataset Ground Truth；
4. 新 Boundary Provider **仅** 增 Adapter，**不**改 Feature Extractor。

**条件（进入 Feature V2 Contract Foundation 前须写入 SSOT）：**

1. 冻结正式类型名（建议 `FeatureTimestampRecord`）及与 `WordInfo` 的映射；
2. 明确 `label` 属 **监督通道**，不属于 Timestamp Contract；
3. P8-0 已识别的 **音节 vs 字级** 粒度差 — Adapter **不**声称等价，Boundary Consistency Audit 在 Shard V2 前完成；
4. **不得**在本轮或 Foundation 中引入 Training Timestamp Contract / 双 Extractor。

---

## 终局问题回答

| # | 问题 | 回答 |
|---|------|------|
| 1 | Runtime Timestamp Contract 是否足够成为唯一 SSOT？ | **是** — 以 `start`/`end`（秒）为核心；`word`/`probability` 为可选 Metadata |
| 2 | Training 是否应先 Adapter 再 Feature？ | **是** — `SyllableSample` → `FeatureTimestampRecord` → Extractor |
| 3 | TextGrid 是否应退出 Feature Contract？ | **是** — 停留 Dataset Foundation；仅经 Adapter 注入 Feature 层 |
| 4 | Feature Extractor 是否只能认识 Runtime Timestamp？ | **是（V2 目标）** — 单一 `extract_feature_v2(audio, record)` |
| 5 | Feature Shard 是否应保存 Runtime Timestamp Contract？ | **建议是**（V2 诊断列 + manifest）；**不**存 `SyllableSample` 原对象 |
| 6 | Boundary Provider 是否应与 Feature 彻底解耦？ | **是** — `boundary_provider` 仅 Diagnostics |
| 7 | 新 Boundary Provider 是否无需改 Extractor？ | **是** — 仅新 Adapter 输出同构 Record |
| 8 | 是否可以进入 Feature V2 Contract Foundation？ | **是（CONDITIONAL PASS）** — 须按上文条件正式冻结 |

---

*Audit: read-only · 2026-07-03 · No frozen layer modified*
