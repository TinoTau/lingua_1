<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/Tone_V2_P10_Feature_Contract_SSOT_Runtime_Readiness_Audit_2026_07_11.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# Tone V2 P10 — Feature Contract SSOT & Runtime Replacement Readonly Audit

**Date:** 2026-07-11  
**Audit Type:** Readonly（代码 · 配置 · artifact · 测试 · 只读探针）  
**Scope:** Feature Contract SSOT、Training/Cache/Probe/Runtime 等价性、Direct Replacement 就绪度  
**禁止项遵守:** 未修改任何代码 / 配置 / 测试 / 模型 / 训练数据；未接入 Runtime；未新增兼容层或 Shadow/Switch/Registry/Fallback

**依据:** P8-C Feature Contract、P9 训练报告、上一份 P10 PreDev Audit（**本轮全部重新验证，未直接继承结论**）、当前仓库源码与磁盘 artifact

---

## 16.1 Executive Summary

| 问题 | 结论 |
|------|------|
| Feature Contract 是否只有一个 SSOT？ | **V2 语义 SSOT = `feature_v2.extract_feature`（唯一 (64,83) 实现）**；**生产 Runtime 仍存在第二套 p0 路径 `mel.extract_mel_features`（待 P10 删除）** |
| Training / Cache / Probe / Runtime 是否同一 extractor？ | **Training / Cache / Probe：是**；**Current Runtime：否（p0 mel）**；**Target Runtime：可改为是** |
| Training 与 Runtime 音频输入域是否一致？ | **否** — 见 §4；冻结文档 §14 要求同 Audio 同 Tensor，但代码未统一 |
| WordInfo 类型是否同构？ | **是** — `shared_types.WordInfo` |
| WordInfo provider 差异？ | **是且显著** — TextGrid 音节 vs FW 字级 token |
| Feature Cache 是否仅 Training？ | **是** — Runtime 无 cache 读取/import |
| Runtime Direct Replacement 条件？ | **接线条件具备**；**验收条件未满足**（输入域、counterfactual fixture） |
| 可否删除 p0 Runtime？ | **是** — 无生产理由保留；Training legacy 单独保留 |
| 必须保留 p0 的生产理由？ | **无** |
| Node 是否无需修改？ | **是** — `AcousticToneSlice` / `TonePosterior` schema 已对齐 |
| 阻塞项？ | **开发前：无 BLOCKER**；**验收前：HIGH（输入域、边界 provider、E2E counterfactual）** |

### Final Verdict: **CONDITIONAL PASS**

- **可立即进入 P10 Direct Replacement Development**（接线与删除 p0 Runtime）。  
- **开发前必须解决：无 BLOCKER。**  
- **验收前必须解决：** Training/Runtime 音频输入域评估与决策、真实 tone-sensitive E2E fixture、Runtime 门禁测试迁移、（建议）cache extractor 指纹。

---

## 一、审计背景与冻结原则核对

拟执行主链与 12 条冻结原则与当前代码对照：

| 原则 | 当前状态 |
|------|----------|
| 单 Tone 主链 | ❌ p0 Runtime 仍在 |
| Direct Replacement | ⏳ 待开发 |
| 禁止双 Runtime / Shadow / Registry / Switch / p0 fallback | ✅ 无 switch/registry；p0 为**待删旧链**非并行 V2 |
| Fail closed only | ✅ `inference.py` / `loader.py` |
| Runtime 无 torch | ✅ 生产文件无 torch import |
| Node schema 不变 | ✅ |
| Feature 单 SSOT | ✅ V2 仅 `extract_feature`；(64,83) |
| WordInfo 唯一时间边界 | ✅ V2 extractor 内聚；⚠️ p0 外置 slice |

---

## 二、Feature Contract SSOT 审计

### 3.1 全部 Feature 生成入口矩阵

| 文件 | 函数/类 | 调用方 | 输入 | 输出 shape | 生产可达 | 与 SSOT 重复 | 处置建议 |
|------|---------|--------|------|------------|----------|--------------|----------|
| `feature_v2.py` | `extract_feature` | `v2_training_path`, `feature_shard_v2`, `feature_cache_v2_parallel`, `train_tone_v2_model`, tests, probe | full audio + `WordInfo` | (64, 83) | **Target Runtime** | **SSOT** | **KEEP** |
| `feature_v2.py` | `slice_audio` | `extract_feature` 内部 | audio + start/end | waveform | 间接 | 内聚 helper | **KEEP** |
| `mel.py` | `extract_mel_features` | **`inference.py`（生产）**, `feature_shard.py`, `train_tone_cnn.py`, tests | **已切 slice** | (80,) | **是（p0 Runtime）** | **第二套 Mel** | Runtime **DELETE**；Training legacy **KEEP** |
| `feature_shard.py` | `_slice_audio` + mel | p0 shard builder | SyllableSample | (80,) mel | Training only | p0 legacy | **TRAINING-ONLY KEEP** |
| `inference.py` | `_slice_audio` | `run_tone_inference` | processed_audio + word times | slice | **是** | 外置切片 | Runtime **DELETE** |
| `train_tone_cnn.py` | `_slice_audio` + mel | p0 训练 CLI | AISHELL wav | (80,) | Training only | p0 legacy | **TRAINING-ONLY KEEP** |
| `models/cnn_p1.py` | `forward_logits` / `predict_posteriors` | `numpy_p1`, training | (N,64,83) | (N,5) | 推理后端 | 非 Feature | **KEEP** |
| `numpy_p1.py` | `infer_batch` | probe, validate, **target classifier** | (N,64,83) | (N,5) | Target Runtime | 模型非 Feature | **KEEP** |
| `numpy_p0.py` | `infer_batch` | **`classifier.py`（生产）** | (N,80) | (N,5) | **是** | p0 模型路径 | Runtime **DELETE** |
| `feature_shard_v2.py` | shard build | cache CLI | wav + WordInfo → `extract_feature` | (64,83) cache | Training only | 复用 SSOT | **KEEP** |
| `feature_cache_v2_parallel.py` | worker extract | parallel cache | 同上 | (64,83) cache | Training only | 复用 SSOT | **KEEP** |
| `cache_parity_v2.py` | parity verify | tests / verify script | online vs cache | — | Offline | 验证工具 | **KEEP** |
| `probe_v2_inference.py` | `run_inference_probe` | CLI | `extract_v2_features_via_wordinfo` | (N,64,83) | Offline | 复用 SSOT | **KEEP** |
| `validate_artifact_v1.py` | adapter check | CLI | 随机/探针 tensor | — | Offline | 非 Feature | **KEEP** |
| `test_phase8_feature_equality.py` | sine tests | unittest | synthetic | (64,83) | Test | 验证 SSOT 确定性 | **KEEP** |
| `test_phase6e_aishell3.py` | mel spot check | unittest | mini wav | (80,) | Test | p0 legacy 测试 | **KEEP** |

**librosa：** 仓库 `tone_module` **无** librosa 调用。  
**生产 import 测试辅助 Feature：** **未发现** — `inference`/`classifier`/`api_routes` 未 import training_io 或 cache builder。

### 3.2 唯一 SSOT 内聚性核对

`feature_v2.extract_feature` 内聚步骤（均已实现于 `feature_v2.py` + `contract.P1_*`）：

| 步骤 | 位置 | 状态 |
|------|------|------|
| WordInfo start/end 读取 | L206–213 | ✅ |
| audio slice + clamp | `slice_audio` L25–30 | ✅ |
| min duration | L212–213 raise | ✅ |
| resample → 16k | `_resample_to_contract_sr` | ✅ |
| STFT / log-mel | `_compute_log_mel_frames` | ✅ |
| F0 / voiced / delta | `_estimate_f0_frame`, `_compute_f0_tracks`, `_delta_log_f0` | ✅ |
| pad / crop / interp → 64 frames | `_normalize_frame_count` | ✅ |
| shape (64,83) / float32 | L222–224 | ✅ |
| NaN/Inf 显式处理 | **无** — 依赖 `log10(max(mel,1e-10))` | ⚠️ MEDIUM |

**当前 Runtime（p0）** 在调用 Feature 前执行：外置 `_slice_audio` → `extract_mel_features`（**非** `extract_feature`）。

**P10 开发 BLOCKER（防回归）：** 不得出现：

```text
Runtime 外置 slice → 将局部 clip 传入 extract_feature(clip, sr, 原始 WordInfo)
→ extract_feature 按 WordInfo 二次 slice
```

**当前 p0 无此问题**（mel 不吃 WordInfo）。**V2 接线必须：** `extract_feature(processed_audio, sample_rate, word_info)` **仅此一种**。

### 3.3 四路径调用等价性

#### A. Training

```text
AISHELL wav (sf.read, mono mean)
→ syllable_sample_to_wordinfo
→ feature_v2.extract_feature(audio, sr, wordInfo)
→ (64,83) batch
→ train_tone_v2_model / numpy_p1 or torch
```

证据：`training_io/v2_training_path.py` L80–87

#### B. Feature Cache

```text
sf.read(wav_path) → WordInfo adapter → extract_feature → shard npz
```

证据：`feature_cache_v2_parallel.py` L77–105；`feature_shard_v2.py` L209–215

磁盘 manifest（`training_features_v2/shard_manifest.json`）实测：

- `schemaVersion`: `training_feature_shard_v2`
- `featureVersion`: `p1-frame-mel-f0-v1`
- `featureShape`: `[64, 83]`
- `boundaryProvider`: `textgrid_pinyin_v1`
- `sampleCount`: 997992
- **无** `extractorHash` / `sampleRate` 字段

#### C. Probe

```text
load_samples_and_manifest → extract_v2_features_via_wordinfo
→ build_v2_training_batch → extract_feature
→ ToneModelLoaderV1 → numpy_p1
```

证据：`probe_v2_inference.py` L73–86

#### D. Runtime 目标

```text
processed_audio + segments.words
→ extract_feature (目标)
→ ToneModelLoaderV1 → numpy_p1 → AcousticToneSlice
```

**当前 Runtime：** 路径 D 仍为 p0 mel 链。

#### 十问核对

| # | 问题 | 答案 |
|---|------|------|
| 1 | 同一 `extract_feature`？ | Training/Cache/Probe **是**；Runtime **否（当前）** |
| 2 | 同一 `contract.py`？ | **是** |
| 3 | 相同 sample rate？ | **是**（16k；extract 内防御重采样） |
| 4 | 相同 shape？ | V2 **(64,83)**；p0 Runtime **(80,)** |
| 5 | 相同 dtype？ | **float32** |
| 6 | 相同 normalization 语义？ | Feature：**无** extractor 内 norm；模型：**feature_mean/std 在 numpy_p1** |
| 7 | 缓存绕过 extractor？ | 训练 **可** cache-only；**Runtime 不读 cache** |
| 8 | 缓存版本验证？ | `manifest_is_valid_v2`: schemaVersion + featureVersion + shard 文件存在 |
| 9 | 旧版 extractor 混入？ | **可能**（无 extractor hash）；P9-C3 报告 256 样本 parity maxAbsDiff=0.0 |
| 10 | featureVersion 不一致仍能训？ | **否** — `manifest_is_valid_v2` + `train_tone_v2_model` 检查 |

**Cache 元数据缺口（MEDIUM）：** 缺少 `extractorHash`、`sampleRate`、`dtype` 显式字段；有 `buildBackend: parallel_v2_cpu_extract`（并行 builder 标识，非 extractor 代码 hash）。

---

## 三、Training 与 Runtime 音频输入域审计

### 4.1 Runtime 预处理完整链

```text
HTTP audio_b64
→ audio_decoder.decode_audio (mono float)
→ truncate_audio_if_needed
→ scipy.signal.resample (若 sr ≠ 请求 sample_rate，默认 16000)
→ 可选尾部 zero padding (padding_ms)
→ audio_preprocess.preprocess_pcm_f32:
    · mono mean (若多维)
    · float32
    · peak_normalize (TARGET_PEAK_DBFS = -3.0, clip ±1.0)
    · _trim_leading_trailing_silence (threshold -40dBFS, min run 80ms)
→ prepare_audio_with_context:
    · 可选 context buffer 拼接
    · Silero VAD detect_speech + refine_vad_segments
    · 拼接 VAD 有效段 → processed_audio
→ perform_asr(processed_audio) → WordInfo timestamps
→ run_tone_inference(processed_audio, sr, segments)  [pre-dedup]
```

**未检出：** denoise、DC offset 去除、额外 gain（除 peak normalize）。

**VAD 影响：** `processed_audio` 为 VAD 段拼接，**非** trim 后整段原始缓冲；ASR word `start/end` 相对于该 `processed_audio`（P8-0 审计与 `api_routes` 顺序一致）。

### 4.2 Training / Cache 预处理

```text
sf.read(wav_path, dtype=float32)
→ 多声道 → mean(axis=1)
→ 直接 extract_feature(audio, sr, wordInfo)
```

**无：** peak normalize、silence trim、VAD、FW context。

### 4.3 正式输入域结论（三选一）

### **结论：C — 合同本身不明确；实现上为 B 偏离**

| 证据 | 说明 |
|------|------|
| P8-C Feature Contract §14 | 要求 Training 与 Runtime 对 **同一 Audio + WordInfo** 生成一致 Tensor |
| P8-C §13 Extractor | 仅定义 `extract_feature(audio, sampleRate, wordInfo)`，**未定义 audio 是否必须经过 FW 预处理** |
| 代码事实 | Training/Cache：**原始 AISHELL wav**；Runtime：**FW processed_audio** |
| 冻结意图 | Runtime 主链明确使用 `processed_audio`（`inference.py` 参数名与 `api_routes`） |

**不得**将“部分兼容”作为 SSOT：正式 **Audio 输入域在文档与实现间冲突**；Runtime 侧语义为 FW 处理后波形，Training 侧为数据集原始波形。

### 4.4 只读探针：raw vs FW `preprocess_pcm_f32`

> **说明：** 仓库 **无** 纳入 git 的真实 speech wav fixture（`electron_node` 下 0 个 `.wav`）；下列为 **合成 AM/FM 语音类信号** 探针，**不能替代**真实语料验收，但可证明预处理 **会** 改变 Feature 与 posterior。

**单窗口（谐波，0.05–0.35s）：**

| 指标 | raw | FW processed |
|------|-----|--------------|
| tensor max abs diff | — | **0.519** |
| mel channels max diff | — | **0.519** |
| f0 channels max diff | — | 0.0 |
| posterior max diff | — | **0.0083** |
| argmax | 3 | 3（本窗口未变） |

**200 窗口扫描（2s AM/FM 合成，窗长 0.25s）：**

| 指标 | 值 |
|------|-----|
| argmax 变化次数 | **35 / 200（17.5%）** |
| 示例 tensor MAD | **2.30** |
| 示例 posterior MAD | **0.49** |

**结论（问题 11–12）：** 输入域不一致 **足以** 改变 posterior；在约 **17.5%** 合成窗口上改变 argmax。**真实语料上影响待验收** — 标为 **验收缺口（HIGH）**。

---

## 四、WordInfo Contract 与 Provider 审计

### 类型定义（`shared_types.py` L21–26）

```python
word: str
start: Optional[float]  # 秒
end: Optional[float]
probability: Optional[float]
```

Training adapter（`syllable_to_wordinfo.py`）填充同型字段；`probability=1.0`；`word` 为占位 `syllable:{index}`。

### Provider 对比

| 维度 | Training (TextGrid) | Runtime (Faster-Whisper) |
|------|---------------------|---------------------------|
| 粒度 | **音节级** SyllableSample | **字级** token（中文通常一字） |
| start/end 精度 | TextGrid 浮点秒 | ASR word 浮点秒 |
| 空 token | adapter 校验 end>start | `_iter_words` 跳过空 `word` |
| 相对时间轴 | wav 文件起点 | **processed_audio** 起点 |
| dedup 影响 | 不适用 | tone **pre-dedup**；Node `buildWordTimeSpans` 用 ASR segments + rawText 对齐 |
| min duration | extract_feature raise | inference 跳过 `<0.02s` |

### 二十问相关（13–15）

| # | 答案 |
|---|------|
| 13 | **是**，同一 `WordInfo` 类型 |
| 14 | **是**，Runtime tone 与 ASR 同 `processed_audio` 时间轴（pre-dedup） |
| 15 | **是，验收风险 HIGH** — 音节 vs 字级边界；P8-0 已记录 |

### BLOCKER 扫描

| 条件 | 状态 |
|------|------|
| Runtime audio 与 WordInfo 不同时间轴 | **未发现**（同 `processed_audio`） |
| dedup 后文本重生成 tone 边界 | **否**（tone pre-dedup） |
| 文本字符位置代替 FW timestamp 做 Feature | **否**（Feature 仅用 WordInfo 时间） |
| extractor 多边界源 fallback | **否** |
| 无 timestamp 伪边界 | **否** — fail-closed `no_timestamps` |

`buildWordTimeSpans` 用 `rawText.indexOf(token)` 做**字符对齐**，用于 Recall 时间重叠，**不**回写 Feature 切片 — **非 BLOCKER**，但增加 pattern 对齐复杂度。

**alignmentText / toneToken：** 当前 HTTP `UtteranceAcousticTonePayload` **无** 这些字段（`task-router/types.ts` L46 注释：timestamp-only）。旧实验脚本 `tone-module-p1-dialog-fw-scan.py` 引用历史字段 — **非生产路径**。

---

## 五、Runtime Direct Replacement 接线审计

### Current p0 Runtime 调用图

```text
api_routes.process_utterance
  → run_tone_inference(processed_audio, sr, segments_info, ...)
      → get_tone_classifier()
          → get_tone_loader() → ToneModelLoader.load(None) → tone_cnn_p0.npz
          → numpy_p0.infer_batch(mel_batch)
      → _iter_words → _slice_audio → extract_mel_features(slice)
      → AcousticToneSlice / UtteranceAcousticTonePayload
```

### Target P1 Runtime 调用图

```text
api_routes.process_utterance
  → run_tone_inference(processed_audio, sr, segments_info, ...)
      → get_tone_classifier()  [MODIFY]
          → get_tone_loader_v1() → ToneModelLoaderV1.load(path) → tone_cnn_p1_v1_full.npz
          → numpy_p1.infer_batch(feature_batch)
      → _iter_words → extract_feature(processed_audio, sr, word)  [无 _slice_audio]
      → AcousticToneSlice (schema 不变)
```

### 文件级 DELETE / KEEP / MODIFY / ARCHIVE

| 对象 | 分类 | 说明 |
|------|------|------|
| `inference._slice_audio` | **DELETE** (Runtime) | V2 内聚切片 |
| `inference` mel import | **DELETE** (Runtime) | |
| `classifier` numpy_p0 / ToneModelLoader | **DELETE** (Runtime) | 改 V1 |
| `get_tone_loader` Runtime 引用 | **DELETE** | |
| `config._DEFAULT_TONE_MODEL` p0 路径 | **MODIFY** | → P1 full 或稳定别名 |
| `loader_v1.get_tone_loader_v1()` | **MODIFY（新增）** | 本轮不实现；责任：进程单例、fail-closed |
| `mel.py` | **TRAINING-ONLY KEEP** | |
| `numpy_p0.py`, `loader.py` | **TRAINING-ONLY KEEP** | |
| `train_tone_cnn.py`, `feature_shard.py` | **TRAINING-ONLY KEEP** | p0 shard |
| `tone_cnn_p0.npz` 部署件 | **ARCHIVE** | 替换后移出生产路径 |
| `api_routes.py` tone 顺序 | **KEEP** | pre-dedup |
| `tone_types.py` | **KEEP** | schema 冻结 |

---

## 六、模型路径与版本策略审计

| # | 事实 |
|---|------|
| 1 | Runtime 默认：`config.py` L194–199 → `tone_module/models/tone_cnn_p0.npz` |
| 2 | 覆盖：**仅** `TONE_MODEL_PATH` 环境变量 |
| 3 | 第二模型 env | **无** |
| 4 | registry / backend selector | **无** |
| 5 | 硬编码文件名 | `loader.py` p0 默认；`train_tone_cnn.py` p0 默认；**无** `tone_cnn_p1_v1_full` Runtime 引用 |
| 6 | loader 靠文件名判版本 | **否** — 靠 npz metadata |
| 7 | loader 靠 metadata 判 contract | **是** — `loader_v1` 校验 formatVersion/featureVersion/backend/shape |
| 8 | 升级模型是否改源码 | 当前 **是**（默认路径写死 p0）；P10 后可用 `TONE_MODEL_PATH` 避免 |
| 9 | 稳定别名 | **未使用** |

### 方案建议（只读，不修改）

| 方案 | 适用性 |
|------|--------|
| **A — 版本化文件名** `tone_cnn_p1_v1_full.npz` | 与当前训练产出一致；测试/probe 已用此名；适合 dev/CI |
| **B — 稳定别名** `tone_model.npz` + metadata | 适合生产部署替换 artifact **不改代码**；依赖 `TONE_MODEL_PATH` 或部署脚本 symlink/copy |

**结合当前方式（单 env `TONE_MODEL_PATH`、无 registry、metadata 驱动 backend）：**  
**推荐 B 为生产部署惯例，A 为仓库内 canonical 训练产物名**；二者不冲突：`TONE_MODEL_PATH` 指向 B，仓库保留 A 作为 build 输出。

**冻结约束满足：** loader 已 metadata 校验；**禁止**文件名决定 backend。

---

## 七、Loader 与 artifact 合同审计

### `ToneModelLoaderV1`（`loader_v1.py`）

| 项 | 状态 |
|----|------|
| 拒绝 p0 keys (`w1`, `mel_mean`, …) | ✅ |
| 校验 formatVersion `npz-p1-v1` | ✅ |
| featureVersion `p1-frame-mel-f0-v1` | ✅ |
| inputShape [64,83] / output [5] | ✅ |
| backend `numpy_p1` | ✅ |
| 不读 metrics（避免 torch pickle） | ✅ 加载路径不访问 metrics |
| 无 torch import | ✅ |
| fail-closed | ✅ `unload()` on failure |
| 无 p0 回落 / 第二 loader | ✅ |
| 单例 | **未实现** `get_tone_loader_v1` — P10 MODIFY |
| 并发安全 | 与 p0 相同模式（进程内单例）；**未验证**多线程 — MEDIUM |
| diagnostics | `ToneModelMetadata.as_diagnostics_dict()` |

### 生产 artifact 实测

`tone_module/models/tone_cnn_p1_v1_full.npz`：存在；`ToneModelLoaderV1.load` → `ready=True`；权重形状与 `validate_artifact_v1` / `probe_v2` JSON **PASS** 一致。

---

## 八、Feature Cache 审计

| # | 答案 |
|---|------|
| 1 | Runtime 读 Feature Cache？ | **否** |
| 2 | Runtime 句内 Feature 缓存？ | **否** |
| 3 | 跨请求 Feature 缓存？ | **否** |
| 4 | Cache 仅训练？ | **是**（模块注释 + 无 Runtime import） |
| 5 | Cache 含路径/时间/featureVersion？ | shard 含 timestamp_start/end；manifest 含 featureVersion |
| 6 | 可追溯唯一 extractor？ | **部分** — 代码路径明确；**无 hash** |
| 7 | 旧 Feature 混入？ | 仅靠 schemaVersion + featureVersion |
| 8 | rebuild 条件 | featureVersion 变 / manifest 无效 / 显式 rebuild CLI |
| 9 | 训练验证 cache contract？ | `manifest_is_valid_v2` + parity tests |
| 10 | Runtime 误 import cache builder？ | **否**（`test_phase9c3_no_runtime_training_import` 覆盖 inference/loader/feature_v2） |

**冻结期望满足：** Feature Cache = Training-only optimization ✅

---

## 九、Node 消费与最终决策审计

### 追踪链

```text
FW HTTP tone.acousticToneSlices
→ asr-step.ts: normalizeAcousticSlices + offsetAcousticSlices → ctx.acousticToneSlices
→ fw-detector-v4-path.ts: acousticSlices: ctx.acousticToneSlices
→ span-assembly-v4-orchestrator → recallTopKForWindows
→ extractAcousticTonePatternForRecall → tone-time-align (时间重叠)
→ argmaxToneFromPosterior (tone-match-score.ts)
→ recallSpanTopKV3 → computeToneScoreResult → candidateScore *= tonePenalty
→ WindowCandidate → 后续 KenLM rerank / Apply
```

### 十一问

| # | 答案 | 证据 |
|---|------|------|
| 1 | posterior 完整传输？ | **是** — HTTP JSON `t1..t5` |
| 2 | Node 用向量还是 argmax？ | **argmax** → pattern `[1..5]` |
| 3 | time overlap | `tone-time-align.extractAcousticTonePatternByTime` |
| 4 | 均匀 posterior | argmax 仍确定；可能错误 pattern → mismatch penalty |
| 5 | confidence 参与打分？ | **否** — 仅 diagnostics |
| 6 | mismatch penalty 乘入 score？ | **是** — `recall-span-topkv3.ts` L196 |
| 7 | plain_fallback 绕过 tone？ | **否** — 扩候选；penalty 仍适用 |
| 8 | no_pattern = tone disabled？ | **否** — penalty=1.0，不惩罚 |
| 9 | `toneTimestampOnlyEnabled` | 默认 **true**（`fw-config.ts` L69,94；`node-config-defaults`） |
| 10 | 其他绕过配置？ | `toneTimestampOnlyEnabled=false` → 整链 effective off |
| 11 | KenLM 使 Tone 对 final 完全无效？ | **可能削弱** — Tone 影响 Recall 排序入口分数；KenLM 可重排但 **不撤销** 已乘 penalty |
| 12 | 最终可观测证据 | `recall-topk-for-windows` diagnostics + `candidateScore`/`tonePenalty` trace |

**结论：** schema 同构 **且** 主链代码真实乘入 `tonePenalty` — Node **无需为 V2 改 schema**。

---

## 十、Counterfactual 验收可行性审计

### 现有测试

| 层次 | 现有 | 足够？ |
|------|------|--------|
| Python posterior | `test_phase8_feature_equality`（合成音频） | ❌ 非真实 FW 路径 |
| Node Recall | `tone-recall-counterfactual.test.ts` | ⚠️ 单元级；**无** ranked top-1 变化 |
| Node lexicon | `recall-span-topk-v2.test.ts` tone_exact 用例 | ⚠️ 非 V2 posterior 驱动 |
| E2E FW→Node→Final | dialog_200 实验 JSON 存在 | ❌ **无** 固定 golden + V2 tone counterfactual |
| 离线 probe | `tone_cnn_p1_v1_full_probe.json` PASS | ❌ 不能证明 Runtime 生效 |

### 不足以作为“真实生效”证明

- HTTP 200 / `toneEnabled=true` / loader ready / shape=(5,) / probe PASS / dialog_200 不崩溃

### 需新增 fixture 规范（验收缺口）

```yaml
fixture_id: tone-sensitive-001
audio: <pcm16 16k or b64>
raw_asr_text: "..."
fw_word_info: [{word, start, end, probability}, ...]
expected_v2_posterior_or_argmax: [...]
lexicon_profile: <snapshot id>
expected_ranked_candidates_with_tone: [...]
expected_final_candidate: "..."
counterfactuals:
  - name: uniform_posterior
  - name: tone_timestamp_disabled
  - name: model_error_skipped
pass: final_candidate or top1_rank changes explainably
```

---

## 十一、静态禁止项扫描（生产 Runtime 文件）

扫描文件：`api_routes.py`, `inference.py`, `classifier.py`, `loader.py`, `config.py`, `tone_module/__init__.py`

| Token | 生产 Runtime | Training legacy | 测试 | 文档/注释 |
|-------|--------------|-----------------|------|-----------|
| `numpy_p0` | **命中** `classifier.py` | `numpy_p0.py`, tests | 多处 | — |
| `ToneModelLoader` | **命中** `classifier.py` | `loader.py` | tests | — |
| `get_tone_loader` | **命中** `classifier.py` | `loader.py` | tests | — |
| `extract_mel_features` | **命中** `inference.py` | `mel.py`, train | tests | — |
| `tone_cnn_p0` | **命中** `config.py`, `loader.py` | train_tone_cnn | audit | — |
| `feature_version_switch` | 无 | — | 门禁禁止 token | — |
| `model_registry` / `backend_registry` | 无 | — | 门禁 | — |
| `shadow` | 无 | — | — | — |
| `fallback` | 无（tone 语义） | SQL plain_fallback 在 Node | — | — |
| `try p1 except p0` | 无 | — | — | — |
| `torch` | 无 | training/gpu | tests | — |
| `training` import | 无 | training/* | — | — |
| Feature Cache import | 无 | cache modules | — | — |
| 第二 V2 extractor | 无 | — | — | — |
| `alignmentText` / `toneToken` | 无 | — | 实验脚本 | — |

**生产可达命中 = P10 待删除项，非“禁止开发”BLOCKER。**

---

## 十二、性能审计（只读探针）

合成 5s 音频，chirp 类，**非随机白噪声**：

| WordInfo 数 | extract 总 ms | infer batch ms | 合计 ms | ms/word |
|-------------|---------------|----------------|---------|---------|
| 10 | 17.8 | 10.1 | 27.9 | 2.79 |
| 20 | 31.0 | 9.3 | 40.4 | 2.02 |
| 40 | 49.8 | 12.4 | 62.2 | 1.55 |

此前单批 8 词：~4.4 ms/word extract + ~1.8 ms/word infer（与 batch 摊销一致）。

| 检查项 | 状态 |
|--------|------|
| Feature 每词一次 extract | ✅ 目标设计 |
| batch 一次 infer | ✅ 推荐 |
| 每词加载模型 | ❌ 不应出现 |
| torch / GPU Runtime | ❌ 不需要 |
| 第二套快速 Feature 路径 | ❌ 禁止 |

artifact 内存 ~84 KB；load ~5 ms。

---

## 十三、测试与门禁审计

| 测试 | 当前保护对象 | P10 后 | 原因 |
|------|--------------|--------|------|
| `test_phase8_runtime_mainline.py` | **强制 p0 mel** | **MODIFY** | 反转为 V2 extract_feature |
| `test_phase2_contracts.py` | p0 loader 单例、mel baseline | **SPLIT** | Runtime 改 V1；p0 归 training |
| `test_phase3_contracts.py` | inference 含 mel | **MODIFY** | V2 主链 |
| `test_loader.py` | ToneModelLoader p0 | **SPLIT** | + `test_loader_v1_runtime.py` |
| `test_classifier_fail_closed.py` | p0 classifier | **MODIFY** | P1 artifact |
| `test_phase9a_v2_cnn_training.py` | 训练无 p0 fallback | **KEEP** | Training |
| `test_phase9c3_no_p0_fallback.py` | GPU 训练路径 | **KEEP** | Training |
| `test_phase8_feature_equality.py` | extract 确定性 | **KEEP** + **ADD** raw vs FW 对比 |
| `audit_runtime_acceptance.py` | p0 默认路径 | **MODIFY** | full P1 artifact |
| `tone-recall-counterfactual.test.ts` | Node 单元 | **KEEP** + **ADD** E2E |
| dialog_200 | 整体质量 | **KEEP** | 验收回归 |

**风险：** `test_phase8_runtime_mainline` **主动阻挡** P10 — MODIFY 前开发无法绿 CI。

---

## 十四、Hidden Gate Matrix

| Gate | Expected | Actual | Impact | Severity | Required Action |
|------|----------|--------|--------|----------|-----------------|
| 唯一 V2 extractor | 仅 `extract_feature` | Training ✅；Runtime p0 mel | 双 Feature 生产路径 | **HIGH**（待删） | P10 DELETE p0 Runtime |
| 外置 slice + extract_feature | 禁止二次切片 | p0 外置 slice；V2 目标无 | 开发误接则 BLOCKER | **HIGH** | 开发规范 + 测试 |
| Audio 输入域 | 同 Audio 同 Tensor (§14) | raw wav vs FW processed | posterior/argmax 漂移 | **HIGH** | 验收：真实语料对比 + 架构决策 |
| WordInfo provider | SSOT 类型 | 音节 vs 字级 | Recall pattern 对齐 | **HIGH** | tone-sensitive golden |
| Cache extractor hash | 可追溯 | 缺失 | 旧 cache 风险 | **MEDIUM** | 可选 manifest 字段 |
| Runtime 门禁 | 保护 V2 | 保护 p0 mel | 阻挡替换 | **HIGH** | MODIFY tests |
| NaN/Inf 显式处理 | 稳定 | 仅 mel floor | 极端输入 | **LOW** | 文档/可选断言 |
| `metrics.npy` torch pickle | 不影响 loader | 全量 `np.load` 失败 | 运维工具 | **LOW** | 工具层 skip metrics |

---

## 十五、严重度汇总

### BLOCKER（进入 P10 Development）

**无。** 当前 p0 第二生产路径为 **待替换对象**，不构成“无法开工”的技术阻塞。

### HIGH（可开发，不可验收）

1. Training raw wav vs Runtime `processed_audio` — 探针显示 **17.5%** 合成窗 argmax 变化  
2. TextGrid 音节 vs FW 字级 WordInfo  
3. 无真实 tone-sensitive E2E counterfactual fixture  
4. Runtime 测试仍强制 p0  

### MEDIUM

1. Cache 无 extractor hash  
2. `get_tone_loader_v1` 单例责任待实现  
3. 测试分组 p0/V1 待 SPLIT  

### LOW

1. metrics pickle / NaN 文档  
2. 历史实验脚本 alignmentText 引用  

---

## 十六、Required Before Development / Acceptance

### Required Before Development

| 项 | 状态 |
|----|------|
| P1 artifact + validate/probe | ✅ |
| 单一 V2 extractor 实现存在 | ✅ |
| Node schema 就绪 | ✅ |
| 明确禁止双链/Registry | ✅ 代码无 switch |

**清单为空 — 可开工。**

### Required Before Acceptance

1. Runtime V2 唯一主链（`extract_feature` + `loader_v1` + `numpy_p1`）  
2. 生产文件无 p0 import（静态扫描 + 测试）  
3. Runtime 无 torch  
4. Feature equality：同 `processed_audio`+`WordInfo` 重复 bit-equal  
5. **真实音频** raw vs FW processed 输入域对比（非仅合成）  
6. WordInfo 边界评估（字级 vs 音节）  
7. FW HTTP → Node counterfactual（tone-sensitive final candidate 变化）  
8. dialog_200 回归  
9. 性能回归（<~3 ms/word 量级可接受）  

---

## 十七、二十问直接回答

| # | 问题 | 答案 |
|---|------|------|
| 1 | 只有一个生产可达 V2 Feature 实现？ | **V2 实现唯一**；**生产另有 p0 mel（待删）** |
| 2 | Training 直接调 `extract_feature`？ | **是**（`v2_training_path`） |
| 3 | Feature Cache 同一 extractor？ | **是** |
| 4 | Probe 同一 Feature？ | **是**（经 `extract_v2_features_via_wordinfo`） |
| 5 | Runtime 目标能直接调同一 extractor？ | **是**（接线即可） |
| 6 | 外置切片二次切片风险？ | **当前 p0 无**；**V2 开发若误接则为 BLOCKER** |
| 7 | 第二套 Mel/F0/Padding/norm？ | **p0 `mel.py` 为第二套 Mel（Runtime）**；V2 内聚无第二套 |
| 8 | Cache 版本信息足够？ | **部分** — featureVersion+schema；**无 extractor hash** |
| 9 | full model 证明同版 Feature 训练？ | **强** — P9-C3 cache parity 256 样本 maxAbsDiff=0；manifest 997992 样本 `p1-frame-mel-f0-v1` |
| 10 | Feature 正式输入 raw 还是 FW processed？ | **合同未写明；Runtime 事实为 FW processed_audio** |
| 11 | Training 与 Runtime 输入域一致？ | **否** |
| 12 | 不一致是否改变 posterior/argmax？ | **是**（合成探针 17.5% argmax 变化）；真实语料 **未确认** |
| 13 | 共享同一 WordInfo 类型？ | **是** |
| 14 | Runtime audio 与 WordInfo 同时间轴？ | **是**（同 `processed_audio`） |
| 15 | 音节 vs 字级边界验收风险？ | **是，HIGH** |
| 16 | 可删 p0 Runtime 不影响 Training legacy？ | **是** |
| 17 | 版本化文件名 vs 稳定别名？ | **建议：仓库 A + 部署 B（`TONE_MODEL_PATH`）** |
| 18 | Node 确实无需修改？ | **是** |
| 19 | 已有真实 counterfactual fixture？ | **否** |
| 20 | 允许进入 P10 Development？ | **是（CONDITIONAL PASS）** |

---

## 十八、与上一份 P10 PreDev Audit 的差异（重新验证）

| 项 | 上一份 | 本轮 |
|----|--------|------|
| 裁决 | CONDITIONAL PASS | **CONDITIONAL PASS**（依据更细） |
| 输入域 | “部分兼容” | **明确为 C（合同不清）+ 实现 B 偏离**；附 **量化探针** |
| 二次切片 | 提及风险 | **升格为开发 BLOCKER 场景**（若误接） |
| Cache metadata | 简略 | **逐项核对 manifest 实测字段** |
| Counterfactual | 设计 | **审计现有测试不足 + fixture 规范** |
| 二十问 | 十四问 | **完整二十问** |

---

## 十六.2 Current Call Graph（简图）

见上文 §五、§九；Training/Cache/Probe 均汇于 `feature_v2.extract_feature`；Current Runtime 汇于 `mel.extract_mel_features`；Target Runtime 与 Training 对齐。

---

## 十六.10 Final Verdict

# **CONDITIONAL PASS**

```text
是否可以立即进入 P10 Direct Replacement Development？
→ 是
```

```text
开发前必须解决？
→ 无 BLOCKER（须遵守：禁止外置 slice + extract_feature 误接）
```

```text
验收前必须解决？
→ Training/Runtime 音频输入域（真实语料）
→ WordInfo provider 差异评估
→ Runtime 测试迁移 off p0
→ E2E tone-sensitive counterfactual fixture
→ dialog_200 + 性能回归
```

---

*审计版本：P10 Feature Contract SSOT v1.0.0 · 2026-07-11 · 只读 · 含合成音频探针（非真实语料验收）*
