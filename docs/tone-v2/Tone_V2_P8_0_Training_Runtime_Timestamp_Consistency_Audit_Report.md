# Tone V2 P8-0 — Training / Runtime Timestamp Consistency Audit Report

**Date:** 2026-07-03  
**Phase:** P8-0（Training / Runtime Timestamp Consistency）  
**Audit Type:** Read-only Code Audit / Feature Contract Pre-Audit（**非功能开发** · **非训练**）  
**Evidence:** 当前 FW Worker · Node ASR · `tone_module` · `fw-detector` 源码只读追踪

**依据 SSOT：**

- [TONE_V2_CONTRACT_FREEZE.md](./TONE_V2_CONTRACT_FREEZE.md)
- [TONE_V2_DATASET_FOUNDATION_FREEZE.md](./TONE_V2_DATASET_FOUNDATION_FREEZE.md)
- [TONE_V2_TRAINING_ENGINEERING_FREEZE.md](./TONE_V2_TRAINING_ENGINEERING_FREEZE.md)
- [TONE_V2_TERMINOLOGY.md](./TONE_V2_TERMINOLOGY.md)
- [Tone_V2_Mean_Mel_Feature_Baseline_Root_Cause_Audit_Report.md](./Tone_V2_Mean_Mel_Feature_Baseline_Root_Cause_Audit_Report.md)
- [Tone_V2_P8_FeatureV2_Syllable_Duration_Frame_Length_Audit_Report.md](./Tone_V2_P8_FeatureV2_Syllable_Duration_Frame_Length_Audit_Report.md)

**禁止项（本轮）：** 修改 Runtime · Loader · Contract · Feature Baseline · Dataset Foundation · Training Engineering · Validation · Artifact · Node E2E · Adapter · AlignmentProvider · Feature Shard · Shard Reader · 模型代码 · 配置 · 训练 · 新权重

---

## Executive Summary

| 项 | 结论 |
|----|------|
| FW timestamp 来源 | Faster-Whisper **`word_timestamps=True`** → `segments[].words[]` |
| 字段与单位 | `word` / `start` / `end` / `probability`；**秒（float）**；**非** sample index |
| 粒度（中文） | **字级 token**（每 `word` 通常一个汉字）；**非** TextGrid 音节级 |
| Runtime 是否用 FW timestamp 切 audio | **是** — `inference._slice_audio(processed_audio, w.start, w.end)` |
| Tone 推理音频基准 | **VAD 拼接后的 `processed_audio`**（与 ASR 输入同一缓冲） |
| 训练边界提供方 | **TextGrid** → `SyllableSample.start/end`（音节级） |
| 当前特征提取共享 | **p0-v1 已共享** `mel.extract_mel_features`（Runtime + Feature Shard） |
| 第二 Feature / Runtime 链路 | **不存在**（训练物化走 Feature Shard；推理走 `inference.py`） |
| 粒度一致性风险 | **存在** — 训练音节 vs Runtime 字级；须 Boundary Consistency Audit |
| Dedup 与 timestamp 分叉 | **非 FW Detector 路径** dedup 可剥离 `segments.words` 而 tone 仍用 pre-dedup 切片 |
| Feature V2 建议 | **单 Extractor + 单 Contract**；边界 Provider 可不同；须新 Foundation Phase |
| 下一步顺序 | **先 Feature V2 Contract 设计**；**并行/紧随** Boundary Consistency Audit（训练前） |

### Final Verdict: **CONDITIONAL PASS**

冻结架构下 **不存在** Training-only / Runtime-only 双特征主链；p0-v1 已示范「同 extractor、不同 boundary provider」模式。Feature V2 可进入 Contract 设计，但须在 Foundation Phase 中显式统一 slice + frame 语义，并在 Canonical V2 Shard 构建前完成 **TextGrid vs FW Boundary Consistency Audit**（只读对比，非第二 Pipeline）。

---

## FW Timestamp Format Audit

### 1. 输出位置与对象

| 层级 | 对象 | 路径 |
|------|------|------|
| ASR Worker 原始 | `segments_data[].words[]` | `asr_worker_process.py` L246–269 |
| FW HTTP 响应 | `UtteranceResponse.segments[].words[]` | `api_models.py` `SegmentInfoModel` |
| Tone 消费 | `SegmentInfo.words` → `WordInfo` | `shared_types.py` L21–26 |
| Tone 产出 | `UtteranceResponse.tone.acousticToneSlices[]` | `tone_types.py` `AcousticToneSlice` |
| Node 接收 | `ASRResult.segments` + `ASRResult.tone` | `faster-whisper-asr-strategy.ts` L88–91 |
| Recall 消费 | `buildWordTimeSpans` + `ctx.acousticToneSlices` | `tone-time-align.ts` · `asr-step.ts` |

### 2. 启用条件

```python
# asr_worker_process.py L188
"word_timestamps": True,
```

| Expected | Actual | Evidence | Impact | Action |
|----------|--------|----------|--------|--------|
| 中文 ASR 开启 word timestamps | **是** | `transcribe_kwargs` 硬编码 `True` | Tone 依赖此字段 | **KEEP** |
| Worker 内调用 Tone | **否** | `test_asr_worker_readiness.py` 断言 worker 无 `run_tone_inference` | 进程隔离正确 | **KEEP** |

---

## FW Timestamp Field Matrix

| 字段 | 所在对象 | 类型 | 单位 | 语义 | Tone 使用 |
|------|----------|------|------|------|-----------|
| `segments[].start` | Segment | `Optional[float]` | **秒** | Segment 起止 | Tone **不**直接用于切片 |
| `segments[].end` | Segment | `Optional[float]` | **秒** | Segment 止 | 同上 |
| `segments[].words[].word` | Word | `str` | — | ASR token 文本 | 过滤空 token |
| `segments[].words[].start` | Word | `Optional[float]` | **秒** | Word 起点 | **audio slice 起点** |
| `segments[].words[].end` | Word | `Optional[float]` | **秒** | Word 终点 | **audio slice 终点** |
| `segments[].words[].probability` | Word | `Optional[float]` | 0–1 | ASR 置信 | **未**进入 Tone slice |
| `tone.acousticToneSlices[].start` | AcousticToneSlice | `float` | **秒** | 继承 `word.start` | Recall 时间对齐 |
| `tone.acousticToneSlices[].end` | AcousticToneSlice | `float` | **秒** | 继承 `word.end` | 同上 |
| `tone.skippedReason` | Payload | enum string | — | 见下表 | Fail-closed 门控 |
| `vad_segments` | Response | `List[Tuple[int,int]]` | **sample index** | VAD 段 | **非** word timestamp |

### skippedReason 矩阵（Contract 四值）

| 条件 | skippedReason | Evidence |
|------|---------------|----------|
| `processed_audio` 空 | `no_audio` | `inference.py` L68–70 |
| 非中文 | `non_zh` | `inference.py` L72–74 |
| 无有效 words / 全被 `minSliceSec` 滤掉 | `no_timestamps` | `inference.py` L76–79, L95–97 |
| 模型未 ready | `model_error` | `inference.py` L81–84 |

**不存在** `no_syllable_timestamps`（Contract 未定义）；当前粒度为 **word/字**，非音节。

---

## Timestamp Unit / Precision Analysis

| 项 | Expected | Actual | Evidence | Impact | Action |
|----|----------|--------|----------|--------|--------|
| 时间为秒级 float | 是 | **是** | `shared_types.WordInfo` 注释「秒」 | 与 TextGrid 一致 | **KEEP** |
| sample index 用于 word time | 否 | **否**（仅 `vad_segments`） | `api_models.py` | 避免混用 | **KEEP** |
| 切片取整 | 向下截断 | `int(start * sample_rate)` | `inference.py` L37–38；`feature_shard.py` L49–50 | 亚毫秒量化 | **KEEP**（V2 Contract 可文档化） |
| 统一 minSlice | `P0_MIN_SLICE_SEC=0.02` | Runtime + TextGrid Provider 均 20ms | `contract.py` · `inference.py` L89–91 · `alignment_textgrid.py` L69 | 短 token 丢弃 | **KEEP** |
| 边界 padding/margin | 未冻结 | **无** | `inference._slice_audio` 无 pad | 边界紧贴 token | **MODIFY**（V2 Contract 可议 ±10–20ms） |
| end clamp | 是 | `e = min(e, len(audio))` | `inference.py` L39 | 防越界 | **KEEP** |

---

## Timestamp Granularity Analysis

| 问题 | 结论 |
|------|------|
| 中文是否逐字 timestamp？ | **实质上为字级** — `tone-time-align.test.ts` 每字一个 `words[]`；`audit_tone_reliability` 样本为单字 token |
| 是否音节级？ | **否** — Faster-Whisper `word` 不等同 TextGrid pinyin 音节 |
| 多字词？ | 中文 ASR 通常逐字切分；英文为空格分词（非 Tone 目标语言） |
| Tone slice 与 Recall syllable window | Recall 按 **字符索引窗口** 映射到 **word 时间跨度**，再与 **acousticToneSlices** 做数量匹配 |

```typescript
// tone-time-align.ts — Recall 要求 overlap slice 数 === 音节字符数
if (overlapSlices.length !== syllableCount) {
  return { pattern: null, windowTimeRange };
}
```

| Expected | Actual | Evidence | Impact | Action |
|----------|--------|----------|--------|--------|
| Runtime slice 粒度 | 字级 FW word | 代码 + 单测 | 与 TextGrid 音节 **不完全同语义** | **MODIFY**（V2 文档明示 proxy 关系） |
| 训练 slice 粒度 | TextGrid 音节 | `SyllableSample` + P8 审计 | 分布统计基于音节 | **KEEP** Dataset Foundation |

---

## FW → Node → Tone Runtime Path Analysis

```text
[1] FW Worker (faster_whisper_vad)
    audio (pcm16) → decode → VAD → processed_audio
    → perform_asr(processed_audio) → segments[].words[{start,end}]
    → run_tone_inference(processed_audio, segments)  【在 dedup 之前】
    → UtteranceResponse { text, segments, tone, ... }

[2] Node TaskRouter
    faster-whisper-asr-strategy.ts
    → POST /utterance → ASRResult { segments, tone }

[3] Node ASR Step
    asr-step.ts
    → offsetAcousticSlices(tone.acousticToneSlices, segmentOffsetSec)
    → ctx.acousticToneSlices
    → ctx.asrSegments = asrResult.segments

[4] FW Detector V4
    span-assembly-v4-orchestrator.ts
    → buildWordTimeSpans(rawText, asrSegments, ...)
    → recallTopKForWindows({ acousticSlices, wordTimeSpans })
    → extractAcousticTonePatternByTime → tone pattern for Recall
```

### 逐步字段变换

| Step | 输入 | 输出 | 边界是否改变 | Fallback / 门控 |
|------|------|------|-------------|----------------|
| VAD | 原始 audio | `processed_audio`（拼接有效段） | **时间轴压缩**（去静音） | VAD 失败 → 全音频 |
| ASR | `processed_audio` | `words[].start/end` 相对 **processed_audio** | 原生 Whisper 边界 | 无 words → 下游 no_timestamps |
| Tone infer | 同上 + words | `AcousticToneSlice.start/end` = word 时间 | **不变**（复制） | `dur < 0.02s` 跳过 |
| Text dedup | `full_text` | 可能 `segments.words=None` | **可丢失 word 对齐** | FW Detector 路径 `skip_text_dedup:true` |
| Node offset | batch 内相对时间 | 加 `segmentOffsetSec` | 平移 | 单 batch 为 0 |
| Recall | char window + spans | `tonePattern[]` 或 null | 不重切 audio | slice 数 ≠ 音节数 → null |

| Expected | Actual | Evidence | Impact | Action |
|----------|--------|----------|--------|--------|
| Tone 在 dedup 前 | 是 | `api_routes.py` L282–290 在 L324+ dedup 前 | tone 与原始 word 时间一致 | **KEEP** |
| 返回 segments 与 tone 时间一致 | FW Detector 路径一致 | `skip_text_dedup: true` | 主链安全 | **KEEP** |
| 非 FW 路径 segments.words 可空 | 是 | `update_segments_after_deduplication` L176–195 | Recall `wordTimeSpans` 可能为空 | **KEEP**（非主链）/ **MODIFY** 文档 |

---

## Runtime Audio Slice Semantics

当前 Runtime（`tone_module/inference.py`）实际切片逻辑：

```python
for w in words:
    dur = float(w.end) - float(w.start)
    if dur < MIN_SLICE_SEC:  # 0.02s
        continue
    slices_audio.append(_slice_audio(processed_audio, sample_rate, float(w.start), float(w.end)))
```

| 语义项 | 实际行为 |
|--------|----------|
| 时间来源 | **FW `word.start` / `word.end`**（秒） |
| 音频缓冲 | **`processed_audio`**（VAD 后、与 ASR 相同） |
| 粒度 | **每 FW word 一片**（中文≈每字） |
| minSliceSec | **0.02s**（`P0_MIN_SLICE_SEC`） |
| padding / margin | **无** |
| 整 utterance 切片 | **否** |
| 按字数均分 | **否**（仅 Recall 侧 char→time 映射，非 Tone 特征切片） |
| 跨字/跨词 | **否**（每 word 独立） |
| 与 TextGrid 训练 slice | **函数同形**（`_slice_audio`）但 **边界 provider 与粒度不同** |

| Expected | Actual | Evidence | Impact | Action |
|----------|--------|----------|--------|--------|
| 使用 FW timestamp 切音 | 是 | `inference.py` L92 | Runtime 语义明确 | **KEEP** |
| 与 TextGrid slice 语义一致 | 音节级一致 | 字级 vs 音节 | 域偏移风险 | **MODIFY**（V2 文档 + 边界审计） |

---

## Existing Tone Timestamp Failure Modes

| 模式 | 触发 | 后果 | 严重度 |
|------|------|------|--------|
| `no_timestamps` | words 空 / 全 < 20ms | `toneEnabled=false`；Recall `toneSkippedReason` 链 | 预期 fail-closed |
| `non_zh` | 语言非 zh | 不做声学 Tone | 预期 |
| `model_error` | npz 未加载 | fail-closed | 预期 |
| Dedup 剥离 words | 非 FW 路径 dedup 改文本 | `segments.words=None`；Recall 无 `wordTimeSpans` | 中（主链 FW Detector 已缓解） |
| VAD 大幅裁剪 | >30% 音频移除 | word 时间仍相对 processed_audio；与原始墙钟不对齐 | 低（自洽） |
| Context buffer | `use_context_buffer=true` | 时间轴含历史上下文 | 低（FW Detector 默认 false） |
| Recall syllable/slice 计数不等 | 窗口音节数 ≠ overlap slices | `pattern: null` → tone fallback | 预期门控 |
| ASR 错字 | 字 token 错误 | 时间仍对齐错误字 | 模型质量，非 timestamp 格式问题 |

---

## Training Boundary Provider Analysis

```text
OpenSlrAishell3DatasetAdapter
  → TextGridPinyinAlignmentProvider.collect_samples()
  → SyllableSample { wav_path, start, end, label }
```

| 项 | 值 |
|----|-----|
| 单位 | **秒（float）** |
| 粒度 | **MFA TextGrid 音节**（pinyin+tone token） |
| 过滤 | `end-start < P0_MIN_SLICE_SEC` |
| 用途 | Dataset Probe · Feature Shard 构建 · `train_tone_cnn` |

**训练切片（Feature Shard）：**

```python
# feature_shard.py L105-106
clip = _slice_audio(audio, sr, sample.start, sample.end)
mel_buf.append(extract_mel_features(clip, sr))
```

| Expected | Actual | Evidence | Impact | Action |
|----------|--------|----------|--------|--------|
| 训练边界来自 TextGrid | 是 | `feature_shard.py` | 标签监督正确 | **KEEP** |
| 训练单独 Feature Extractor | 否 | 同 `mel.extract_mel_features` | p0 已统一 | **KEEP** 模式延至 V2 |
| TextGrid Feature Pipeline | 禁止 | 无独立 pipeline 名 | 仅 boundary provider | **KEEP** 术语 |

---

## Runtime Boundary Provider Analysis

| 项 | 值 |
|----|-----|
| Provider | Faster-Whisper **word_timestamps** |
| 消费点 | `tone_module/inference.py` |
| 粒度 | 字级 `WordInfo` |
| 音频 | `processed_audio` @ 16kHz |

**不存在** FW AlignmentProvider · 不存在 Runtime 侧 TextGrid。

---

## Training / Runtime Feature Consistency Requirement

### 当前 p0-v1 架构（已验证）

```text
Training:  TextGrid (start,end) → _slice_audio → extract_mel_features → Feature Shard → Model
Runtime:   FW word (start,end)  → _slice_audio → extract_mel_features → classifier → Posterior
```

| 共享 | 分离（允许） |
|------|-------------|
| `extract_mel_features` / `contract.P0_*` | Boundary provider（TextGrid vs FW） |
| `_slice_audio` 算法 | 粒度（音节 vs 字） |
| `featureVersion=p0-v1` | 训练用 wav 文件 vs Runtime 流式 PCM |
| `numpy_p0` 推理 | — |

| 禁止项 | 现状 |
|--------|------|
| Training-only Feature Pipeline | **无** — Shard 物化是 Training Engineering，非第二 Runtime |
| Runtime-only Feature Pipeline | **无** |
| 第二 Tone Runtime path | **无** — 单 `run_tone_inference` |
| Shadow / A/B / Registry | **无**（`span-assembly-v4` 中 `shadowBeam` 为 FW 句子 beam，**tone-free**） |

### Feature V2 必须延续的不变式

```text
boundary_provider_train  = TextGrid SyllableSample.start/end   （Dataset Foundation · 不变）
boundary_provider_runtime = FW WordInfo.start/end               （Runtime · 不变）

feature_extractor_train   = feature_v2.extract(...)              （须与 Runtime 同模块）
feature_extractor_runtime = feature_v2.extract(...)              （同一函数 / 同一 Contract）

featureVersion            = p1-frame-mel-f0-v1（建议 · 本轮不冻结）
fixedFrames               = 64（P8 数据审计建议）
norm / interp / crop      = Contract 常量（两端一致）
```

| Expected | Actual | Evidence | Impact | Action |
|----------|--------|----------|--------|--------|
| 禁止第二 Feature Extractor | 架构要求 | TERMINOLOGY + Freeze | V2 须单模块 | **KEEP** |
| Shard 与 Runtime 同 extractor | p0 已满足 | `test_phase3` `test_train_uses_runtime_mel_extractor` | V2 延续 | **KEEP** |
| 为训练改 Runtime | 禁止 | 未发生 | — | **KEEP** |

---

## Boundary Consistency Audit Need Assessment

| 项 | 评估 |
|----|------|
| **是否必须（本轮）** | **否** — 不阻塞 Feature V2 Contract 设计 |
| **是否在 Canonical V2 Shard 前必须** | **是（建议）** — 量化 TextGrid 音节 vs FW 字级边界偏移 |
| **类型** | **Boundary Consistency Audit**（Level 2 分析扩展） |
| **非** | 训练 · 模型 · 第二 Pipeline · 新 AlignmentProvider |

### 建议方法（只读 · 不形成第二链路）

1. **抽样：** 2,000–5,000 音节（分层：t1–t5 × 快/慢语速 × 10 speaker × AISHELL utterance）
2. **对齐：** 同一 `wav_path` 上比较 TextGrid `(start,end)` 与离线 FW `/utterance` 返回的 `words[]`（**只读 HTTP**，不修改 Worker）
3. **指标：** `Δstart` · `Δend` · `Δduration` · IoU · 按 tone / duration / speaker 分组
4. **字段：** `wav_path` · `syllable_token` · `tg_start/end` · 最近邻 `fw_word` · `fw_start/end`
5. **避免第二 Pipeline：** 一次性审计脚本写在 `_data_cache/` 或 probe 子命令；**不**新增 DatasetAdapter / 不物化 FW Feature Shard

| Expected | Actual | Evidence | Impact | Action |
|----------|--------|----------|--------|--------|
| P8 帧长审计已判 FW 对比非必须 | 同意 | P8 报告 §FW Assessment | 帧长决策已闭合 | **KEEP** |
| 边界语义对齐需量化 | 未做 | 本轮代码审计 | 训练/Runtime 域间隙 | **MODIFY**（排期审计） |

---

## Feature V2 Timestamp Contract Requirements

| 问题 | 建议（本轮不冻结） |
|------|-------------------|
| Runtime 输入语义 | **FW `word.start/end` + `processed_audio`** |
| 训练 proxy | **TextGrid `SyllableSample.start/end`**；Contract 明示为 **boundary proxy**，非同一粒度 |
| 模拟 FW 噪声 | **可选** — 训练数据增强：对 TextGrid 边界 ±10–20ms jitter；**非** P8-0 必须 |
| 统一 margin | **建议在 Extractor 内可选** `slice_margin_ms`（对称或 tail-only）；默认 0 与 p0 兼容 |
| normalize duration | **是** — P8 推荐 duration-normalized interp → `fixedFrames=64` |
| timestamp diagnostics | **建议** — Shard manifest 记录 `boundary_provider=textgrid_v1`；Runtime diagnostics 已有 `toneSliceCount` |
| 缺失 fail-closed | **是** — 延续 `no_timestamps` / `no_audio` / `model_error` |
| `no_syllable_timestamps` | **不建议新增** — 当前无音节级 FW 输出；字级不足已含于 `no_timestamps` |

### Feature V2 Extractor 模块边界（设计约束）

```text
tone_module/feature_v2.py   （建议新文件 · Foundation Phase）
  extract_frame_mel_f0(audio, sample_rate, start, end, baseline) → Tensor[fixedFrames, C]

调用方（仅两处）:
  inference.py          — start/end 来自 WordInfo
  training_io/feature_shard_v2.py — start/end 来自 SyllableSample
```

**禁止：** `training_mel.py` / `runtime_mel.py` 分叉。

---

## Training Adjustment Recommendation

### 目标架构（Feature V2 Foundation Phase）

```text
Training:
  TextGrid timestamp (SyllableSample.start/end)
    → audio slice (_slice_audio 或 Contract 统一 helper)
    → FeatureV2.extract_frame_mel_f0()     # 与 Runtime 同一函数
    → Tensor [64, 81]                       # 示例：80 mel + 1 f0
    → Feature Shard V2 (training_feature_shard_v2)
    → Model (CRNN/CNN — 新 artifact schema)

Runtime:
  FW word timestamp (WordInfo.start/end)
    → processed_audio slice (同一 helper)
    → FeatureV2.extract_frame_mel_f0()     # 同一函数
    → Tensor [64, 81]
    → classifier → TonePosterior
    → AcousticToneSlice (start/end 仍为 FW 时间)
```

### 关键原则

1. **Timestamp provider 可不同** — Dataset Foundation（TextGrid）与 Runtime（FW）职责分离，符合冻结架构。
2. **Feature Extractor / Contract 必须相同** — `featureVersion` · `fixedFrames` · STFT 参数 · interp/crop · 归一化统计。
3. **物化仅训练侧** — Feature Shard V2 是 Training Engineering 物化缓存，**不是** Runtime 第二条路径；Runtime 仍在线 `inference.py` 提取。
4. **不得** 为 V2 训练修改 `p0-v1` Runtime 行为 — 新 `featureVersion` 并行。
5. **Phase 顺序：** Contract 设计 →（可选）Boundary Audit → Shard V2 物化 → 模型训练。

---

## Naming / Terminology Drift Audit

| 术语 | 活跃 SSOT | 漂移实例 | 建议 |
|------|-----------|----------|------|
| TextGrid Feature Pipeline | **禁止** | 未发现 | — |
| FW Feature Pipeline | **禁止** | 未发现 | — |
| Training/Runtime Feature Pipeline | **禁止** | 未发现 | — |
| Streaming Feature | **禁止** | TERMINOLOGY 已正名 Sequential Reader | **KEEP** |
| Shadow | Historical Issue | `shadowBeamSpanSets`（FW beam，tone-free） | **KEEP** 注释已区分 |
| Second pipeline | Historical Issue | P7-B2 报告明示无第二 Feature Pipeline | **KEEP** |
| Deployment Smoke | **禁止**（验收类型） | `tone-v2-phase3-dialog200-batch-result.json` `testScope` 仍含 "smoke" | **MODIFY** 实验 JSON 备注（非阻塞） |
| offline feature | 未定义禁止词 | 无 “offline feature pipeline” | — |
| dual | Historical Issue | 仅历史文档 | **KEEP** |

---

## Frozen Architecture Verification

| 检查项 | 结果 |
|--------|------|
| Runtime / `inference.py` / `mel.py` / `loader.py` | **未修改** |
| Dataset Foundation | **未修改** |
| Training Engineering / Feature Shard v1 | **未修改** |
| Contract `p0-v1` | **未修改** |
| 训练 / 新权重 | **未执行** |
| 审计方式 | 源码只读 + 既有 dialog_200 实验 JSON 引用 |

**确认：** 本轮为 Level 2/4 预审计；Feature V2 任何实现须 **Feature Contract / Foundation Phase**，非普通 `tone_cnn_p*` 权重训练。

---

## Architecture Drift Audit

| 项 | Expected | Actual | 判定 |
|----|----------|--------|------|
| 单 Tone Runtime 入口 | `run_tone_inference` | 仅此 | **PASS** |
| Tone 在 FW Worker 内 | api_routes 同步调用 | 是 | **PASS** |
| p0 训练/推理同 mel | `extract_mel_features` | Feature Shard + inference | **PASS** |
| 训练绕过 Shard 做 Canonical | 禁止 | P7-B 已物化 | **PASS** |
| Registry / 热切换 | 禁止 | 无 | **PASS** |
| 粒度 Train≠Runtime | 文档化风险 | 音节 vs 字 | **CONDITIONAL** |

---

## KEEP / MODIFY / RESTORE / DELETE

| 动作 | 对象 | 说明 |
|------|------|------|
| **KEEP** | FW `word_timestamps=True` | Runtime 边界 SSOT |
| **KEEP** | Tone pre-dedup 推理顺序 | 时间对齐正确 |
| **KEEP** | FW Detector `skip_text_dedup` | 保护 `segments.words` |
| **KEEP** | `_slice_audio` + `P0_MIN_SLICE_SEC` 双端一致 | V2 可升 Contract helper |
| **KEEP** | `extract_mel_features` 共享模式 | V2 延至 frame extractor |
| **KEEP** | TextGrid 作训练 boundary provider | Dataset Foundation 冻结 |
| **MODIFY** | Feature V2 Foundation | 新 `feature_v2.extract` · Shard v2 · Contract |
| **MODIFY** | V2 Contract 文档 | 明示音节/字级 proxy · 可选 margin |
| **MODIFY** | Boundary Consistency Audit | V2 Shard 前执行 |
| **MODIFY** | 实验 JSON `deployment smoke` 措辞 | 术语 hygiene |
| **RESTORE** | — | 无 |
| **DELETE** | — | 无 |

---

## Final Verdict

### **CONDITIONAL PASS**

**条件：**

1. Feature V2 须经 **独立 Foundation Phase** 冻结单 Extractor + `p1-frame-mel-f0-v1`（名称待定）；
2. Canonical Feature Shard V2 构建前完成 **Boundary Consistency Audit**（只读，非第二 Pipeline）；
3. Contract 明示 **训练 TextGrid 音节边界** 与 **Runtime FW 字级边界** 为 proxy 关系，不声称逐点等价。

---

## 终局问题回答

| # | 问题 | 回答 |
|---|------|------|
| 1 | FW 当前 timestamp 的真实格式是什么？ | `UtteranceResponse.segments[].words[]`：`{ word, start, end, probability }`，**秒 · float** |
| 2 | 单位、粒度、字段名？ | **秒**；**字级 word**（中文）；字段 `start`/`end`/`word`/`probability` |
| 3 | Tone Runtime 是否真的用 FW timestamp 切 audio？ | **是**，`processed_audio[w.start:w.end]` |
| 4 | 是否存在粒度不足、估算或隐藏 fallback？ | **无均分估算**；**有** dedup 丢 words（非 FW 路径）；Recall **有** slice 计数不匹配 fallback |
| 5 | Feature V2 训练能否继续用 TextGrid？ | **能**，作为 **boundary + label provider**（Dataset Foundation 冻结） |
| 6 | 训练与 Runtime 如何共享 Extractor/Contract？ | **同一 `feature_v2.extract()` 模块** + 同一 `featureVersion`/frame 策略；Shard 仅物化缓存 |
| 7 | 是否需要 TextGrid vs FW Boundary Consistency Audit？ | **建议需要**（V2 Shard 前）；**不阻塞** Contract 设计 |
| 8 | 如何做且不形成第二链路？ | 只读抽样对比同一 wav 的 TextGrid vs FW HTTP words；输出统计报告；不建 Adapter/不训模型 |
| 9 | Feature V2 是否应进入新 Foundation Phase？ | **是** — 新 featureVersion · extractor · Shard v2 · artifact schema |
| 10 | 下一步：Contract 设计还是先做边界审计？ | **先 Feature V2 Contract 设计**；**边界审计与 Contract 并行或紧随其后**，在 V2 Shard 物化前完成 |

---

*Audit: read-only source trace · 2026-07-03 · No frozen layer modified*
