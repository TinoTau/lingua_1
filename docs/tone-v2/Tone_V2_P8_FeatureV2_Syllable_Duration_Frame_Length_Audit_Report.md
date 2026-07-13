# Tone V2 P8 — Feature V2 Syllable Duration / Frame Length Audit Report

**Date:** 2026-07-02  
**Phase:** P8 Feature V2 前置阶段  
**Audit Type:** Level 2 Dataset Analysis / Feature Contract Pre-Audit（**只读** · **非功能开发** · **非训练**）  
**Evidence JSON:** `electron_node/services/faster_whisper_vad/tone_module/_data_cache/datasets/openslr_aishell3/v1/p8_duration_audit.json`  
**Audit Script（一次性 · 非冻结层）:** `tone_module/_data_cache/p8_duration_audit_run.py`

**依据 SSOT：**

- [TONE_V2_CONTRACT_FREEZE.md](./TONE_V2_CONTRACT_FREEZE.md)
- [TONE_V2_DATASET_FOUNDATION_FREEZE.md](./TONE_V2_DATASET_FOUNDATION_FREEZE.md)
- [TONE_V2_TRAINING_ENGINEERING_FREEZE.md](./TONE_V2_TRAINING_ENGINEERING_FREEZE.md)
- [TONE_V2_TERMINOLOGY.md](./TONE_V2_TERMINOLOGY.md)
- [Tone_V2_Phase7A_AISHELL3_Full_Dataset_Acceptance_Report.md](./Tone_V2_Phase7A_AISHELL3_Full_Dataset_Acceptance_Report.md)
- [Tone_V2_Mean_Mel_Feature_Baseline_Root_Cause_Audit_Report.md](./Tone_V2_Mean_Mel_Feature_Baseline_Root_Cause_Audit_Report.md)

**禁止项（本轮）：** 修改 Runtime · Loader · Contract · Feature Baseline (p0-v1) · Dataset Foundation · Training Engineering · Validation · Artifact · Node E2E · Adapter · AlignmentProvider · Feature Shard · Shard Reader · 任何模型代码 · 训练 · 新权重

---

## Executive Summary

| 项 | 结论 |
|----|------|
| 审计样本量 | **997,992** 音节 · **218** 说话人 · **88,035** utterance |
| 数据链路 | `OpenSlrAishell3DatasetAdapter` → `TextGridPinyinAlignmentProvider` → `SyllableSample.start/end` |
| 音节时长 P50 | **230 ms**（mean **240.7 ms** · std **82.9 ms**） |
| 候选 frame P50（25 ms / 10 ms hop） | **21 frames**（P90 **33** · P95 **38** · P99 **47**） |
| 固定 64 frames 无裁剪覆盖率 | **99.97%**（仅 **306** 音节需 crop，占 **0.03%**） |
| 固定 48 frames 无裁剪覆盖率 | **99.27%**（**7,268** 音节需 crop，占 **0.73%**） |
| 固定 32 frames | **不推荐** — **11.2%** 需 crop，快语速偏置显著 |
| 异常样本占比 | 极端时长合计 **< 0.2%**；结构异常（start≥end / wav 缺失）**0** |
| TextGrid 是否足够支撑 Frame Contract | **是**（分布稳定 · join 100% · 异常可过滤） |
| FW Timestamp 对比是否必须 | **否**（本轮 Frame Length 决策不阻塞） |
| **推荐 fixedFrames** | **64**（主方案）；**48** 为存储敏感备选 |
| **推荐对齐策略** | **duration-normalized interpolation → fixed frames** + 尾部零 pad（非 center crop） |
| 是否可进入 Feature V2 Contract 设计 | **是**（须新 `featureVersion` + Foundation Phase，本轮不冻结） |

### Final Verdict: **CONDITIONAL PASS**

全量 AISHELL-3 TextGrid 对齐数据已为 Feature V2 固定帧长提供充分统计证据；**推荐 `fixedFrames=64` + duration-normalized interpolation**。进入 Contract 设计前须单独立项（新 `featureVersion`、Training Engineering schema v2、Runtime 适配），**本轮不修改任何冻结层**。

---

## Data Source

| 组件 | 值 |
|------|-----|
| `dataset_id` | `openslr_aishell3` |
| `version` | `v1` |
| `dataset_version` | `openslr_slr93_full` |
| `alignment_provider` | `textgrid_pinyin_v1` |
| `alignment_source` | `lars76_aishell3_textgrid` |
| Materialized Root | `tone_module/_data_cache/datasets/openslr_aishell3/v1/materialized/` |
| 音频 | OpenSLR SLR93 · 88,035 wav |
| 对齐 | lars76 MFA TextGrid · 88,035 `.TextGrid` |
| Join Rate | **100%**（P7-A 验收一致） |
| SyllableSample 契约 | `wav_path` · `start` · `end` · `label` (0..4) |

**与 P7-A 一致性：** provider 音节数 **997,992**，与 manifest / Phase 7-A acceptance **完全一致**。

---

## Methodology

### 1. 数据加载（只读）

```text
aishell3_pipeline(cache_dir, skip_download=True)
  → OpenSlrAishell3DatasetAdapter.materialize()
  → TextGridPinyinAlignmentProvider.collect_samples()
  → List[SyllableSample]  (997,992)
```

与 Canonical Training 上游链路相同；**未**修改 Adapter / Provider / Contract。

### 2. Duration 定义

```text
duration_sec = SyllableSample.end - SyllableSample.start
duration_ms  = duration_sec × 1000
```

Provider 已过滤 `duration < P0_MIN_SLICE_SEC (20 ms)` 及无效 pinyin+tone token。

### 3. Frame Count 候选配置（审计专用 · 非冻结）

| 参数 | 值 | 说明 |
|------|-----|------|
| `sampleRate` | 16000 | 与 P0 一致 |
| `frameLengthMs` | 25 | Feature V2 候选 STFT 窗长 |
| `hopLengthMs` | 10 | Feature V2 候选 hop |
| `n_fft` | 400 | `16000 × 25 / 1000` |
| `hop` | 160 | `16000 × 10 / 1000`（与 P0 hop 数值相同） |

**Frame count 公式（与 scipy STFT 段数一致）：**

```text
n_samples = round(duration_sec × sampleRate)
if n_samples < n_fft: frame_count = 1
else: frame_count = 1 + (n_samples - n_fft) // hop
```

**P0 参考列：** `n_fft=512` · `hop=160`（`contract.P0_N_FFT` / `P0_HOP_LENGTH`），供与冻结 baseline 对照；**Feature V2 Contract 设计应以候选 25 ms/10 ms 为准**。

### 4. Fixed Frame 矩阵指标

对每个 `fixedFrames ∈ {32, 48, 64, 80}`：

| 指标 | 定义 |
|------|------|
| 无裁剪覆盖率 | `raw_frame_count ≤ fixedFrames` |
| 需 upsample | `raw_frame_count < fixedFrames` |
| 需 downsample/crop | `raw_frame_count > fixedFrames` |
| 插值时间比（upsample） | `fixedFrames / raw_frame_count` |
| 压缩比（downsample） | `raw_frame_count / fixedFrames` |

快/慢语速：按 utterance 级 `syllables_per_sec` 排序，P10 以下为慢语速，P90 以上为快语速。

### 5. 异常扫描

- 已收集音节级异常（duration 阈值 · start≥end · wav 缺失）
- 额外遍历 TextGrid 原始 interval（invalid token · textgrid 解析失败 · wav 配对缺失）

**审计耗时：** 655.8 s（全量加载 + 统计 + TextGrid 二次扫描）

---

## Duration Distribution

### 全量（997,992 音节）

| 统计量 | 值 (ms) |
|--------|---------|
| count | 997,992 |
| min | **20.0** |
| max | **1,110.0** |
| mean | **240.714** |
| std | **82.911** |
| P1 | 90.0 |
| P5 | 130.0 |
| P10 | 150.0 |
| P25 | 190.0 |
| **P50** | **230.0** |
| P75 | 280.0 |
| P90 | 350.0 |
| P95 | 400.0 |
| **P99** | **490.0** |

**解读：** 典型中文音节在 TextGrid 对齐下约 **200–280 ms**；尾部至 P99 约 **490 ms**，极端最长 **1.11 s**（个别拖音 / 对齐边界）。

---

## Tone-wise Duration Distribution

| 调类 | label | count | mean (ms) | P50 (ms) | P90 (ms) | P99 (ms) | max (ms) |
|------|-------|-------|-----------|----------|----------|----------|----------|
| t1 | 0 | 210,316 | 256.2 | 240 | 380 | 520 | 1,010 |
| t2 | 1 | 235,097 | 244.0 | 230 | 360 | 500 | 1,060 |
| t3 | 2 | 160,857 | 229.1 | 220 | 330 | 450 | 1,030 |
| t4 | 3 | 330,934 | 241.3 | 230 | 360 | 480 | 1,110 |
| t5 | 4 | 60,788 | **202.2** | **180** | 330 | 420 | 640 |

**观察：**

- **t5（轻声）系统性最短**：mean 202 ms，P50 180 ms — 与语言学预期一致。
- **t1 略长**（mean 256 ms）— 可能含更多韵母拖尾。
- 各调 P99 均在 **420–520 ms**，无单一调类主导极端长尾。
- 调类间差异 **不足以**单独为 t1–t5 设定不同 `fixedFrames`；统一帧长即可。

---

## Speaker-wise Duration Distribution

| 指标 | 值 |
|------|-----|
| 说话人数 | 218 |
| 全局 mean | 240.7 ms |
| 全局 std | 82.9 ms |
| 异常说话人（>2σ mean 或 P90 极端） | **0** |

### 语速最慢说话人（mean 最低）

| Speaker | count | mean (ms) | P50 (ms) | P90 (ms) |
|---------|-------|-----------|----------|----------|
| SSB0686 | 5,189 | 179.1 | 160 | 280 |
| SSB0565 | 4,799 | 186.8 | 170 | 280 |
| SSB0851 | 2,854 | 189.4 | 180 | 270 |

### 语速最慢说话人（mean 最高）

| Speaker | count | mean (ms) | P50 (ms) | P90 (ms) |
|---------|-------|-----------|----------|----------|
| SSB1050 | 3,093 | 284.1 | 270 | 410 |
| SSB1846 | 1,701 | **363.1** | 350 | 480 |
| SSB0005 | 5,934 | 323.9 | 310 | 450 |

**结论：** 说话人语速跨度约 **179–363 ms mean**（约 2×），属正常朗读风格差异；**无离群说话人**需单独剔除。慢说话人（如 SSB1846）会推高 crop 需求 — 这也是 **64 > 48** 的主要论据之一。

---

## Utterance-wise Duration Distribution

### 每 utterance 音节数

| 统计量 | 音节数 |
|--------|--------|
| count | 88,035 |
| min | 1 |
| max | 39 |
| mean | 11.34 |
| P50 | 11 |
| P90 | 18 |
| P99 | 23 |

### 每 utterance 平均音节时长

| 统计量 | 值 (ms) |
|--------|---------|
| mean | 243.7 |
| P50 | 239.0 |
| P90 | 295.8 |
| P99 | 373.3 |
| min | 128.6 |
| max | 750.0 |

### 异常 utterance 模式

- **极慢 utterance** 多集中于 **SSB1782**（8 音节句 · mean 550–637 ms/音节）— 朗读风格极慢，非 TextGrid 损坏。
- **单音节极慢**（如 SSB03950012 · 750 ms）— 多为孤立词 / 句末拖音。
- **无**大规模 TextGrid 结构损坏；异常为 **内容/风格** 而非 **对齐文件缺失**。

---

## Frame Count Analysis

### 候选配置（25 ms / 10 ms hop · n_fft=400）

| 统计量 | frames |
|--------|--------|
| min | 1 |
| max | 109 |
| mean | **22.07** |
| std | 8.29 |
| P1 | 7 |
| P5 | 11 |
| P10 | 13 |
| P25 | 17 |
| **P50** | **21** |
| P75 | 26 |
| **P90** | **33** |
| **P95** | **38** |
| **P99** | **47** |

### P0 参考（n_fft=512 · hop=160）

| P50 | P90 | P95 | P99 | max |
|-----|-----|-----|-----|-----|
| 20 | 32 | 37 | 46 | 108 |

P0 与候选配置 frame 分布 **高度接近**（P99 差 1 frame），因 hop 相同、窗长差异在短音节上影响有限。

---

## Fixed Frame Candidate Matrix

| fixedFrames | 无裁剪覆盖 | 需 upsample | 需 crop | 精确匹配 | 平均插值比 |
|-------------|-----------|-------------|---------|----------|-----------|
| **32** | 88.80% | 87.35% | **11.20%** | 1.45% | 1.69× |
| **48** | 99.27% | 99.10% | 0.73% | 0.18% | 2.54× |
| **64** | **99.97%** | 99.96% | **0.03%** | 0.005% | 3.39× |
| **80** | 99.996% | 99.995% | 0.004% | 0.0005% | 4.24× |

### 关键发现

1. **几乎所有音节都短于任一候选 fixedFrames** — 主操作是 **时间拉伸（upsample/interpolation）**，而非裁剪。
2. **32 frames 不可接受** — **11.2%**（≈111,775 音节）遭 crop，快语速子集 crop 虽少但绝对量大。
3. **48 frames** 覆盖 P99（47）仅 **+1 frame 余量** — 0.73% 仍被 crop；慢语速子集 crop **4.96%**。
4. **64 frames** 在 P99 之上留 **~36% 时长余量**（47→64），crop 仅 **306** 条（0.03%）。
5. **80 frames** 相对 64 几乎无 crop 收益（6 vs 306 条），但插值比从 3.39× 升至 4.24×，**存储与算力成本更高**。

### 调类偏置（fixedFrames=64 · 插值比）

| 调类 | upsample % | crop % | mean frames | mean 插值比 |
|------|-----------|--------|-------------|------------|
| t1 | 99.94% | 0.05% | 23.6 | 3.08× |
| t2 | 99.96% | 0.04% | 22.4 | 3.32× |
| t3 | 99.97% | 0.02% | 20.9 | 3.54× |
| t4 | 99.97% | 0.02% | 22.1 | 3.36× |
| t5 | **100%** | **0%** | **18.2** | **4.48×** |

- **t5 插值拉伸最大**（最短音节）— 训练时须关注轻声 contour 是否被过度插值平滑；可通过 **F0 通道** 或 **轻量 SpecAugment** 缓解，属 Contract 设计议题。
- **crop 在各调类均 < 0.05%**（64 frames）— 无系统性调类裁剪偏置。

### 快/慢语速偏置（fixedFrames=64）

| 子集 | 样本数 | upsample % | crop % | mean frames |
|------|--------|-----------|--------|-------------|
| 快语速（P90+ · ≥5.10 syl/s） | 101,645 | 100% | 0% | 16.3 |
| 慢语速（P10− · ≤3.38 syl/s） | 75,606 | 99.62% | **0.32%** | 30.3 |

- **快语速不被 crop**（64 frames）— 风险在 **插值放大噪声**，非信息截断。
- **慢语速** 是 crop 的主要来源（0.32% of slow subset ≈ 242 条）— **64 frames 显著优于 48**（慢语速 crop 4.96%）。

---

## Interpolation / Padding / Cropping Risk Analysis

| 策略 | 信息保留 | 训练稳定性 | Runtime 简化 | Artifact 简化 | CNN 适配 | 快语速风险 | 慢语速风险 | 新 featureVersion | 影响 Runtime | 影响 Shard schema |
|------|---------|-----------|-------------|--------------|---------|-----------|-----------|------------------|-------------|------------------|
| **A. fixed 32** | 差（11% crop） | 中 | 高 | 高 | 可 | 低 crop | **高 crop** | 是 | 是 | 是 |
| **B. fixed 48** | 良（99.3%） | 良 | 高 | 高 | 可 | 低 | 中（慢 5% crop） | 是 | 是 | 是 |
| **C. fixed 64** | **优（99.97%）** | **优** | **高** | **高** | **可** | 插值噪声 | **极低 crop** | 是 | 是 | 是 |
| **D. fixed 80** | 优+ | 良（过度插值） | 高 | 中（更大 tensor） | 可 | 插值平滑 | 极低 | 是 | 是 | 是 |
| **E. dynamic + mask** | 最优 | 中（变长 batch） | **低** | **低** | 需 padding/mask | 低 | 低 | 是 | **高** | **高** |
| **F. duration-norm interp** | 优 | 优 | 高 | 高 | **最佳** | 中 | 低 | 是 | 是 | 是 |
| **G. center crop/pad** | 中（crop 损 contour） | 中 | 高 | 高 | 可 | crop 损尾 | crop 损头尾 | 是 | 是 | 是 |

**裁决：**

- **主策略 = C + F**：`fixedFrames=64` + **沿时间轴线性插值到 64 帧**（mel + f0 同步重采样）；对 `raw_frame_count > 64` 的极少数样本 **center crop 或 truncate 至 64**（0.03%）。
- **不推荐 E（dynamic mask）为 P8 首版** — 与冻结 Runtime 固定维 MLP/CNN batch 哲学冲突，Training Engineering schema 复杂度高。
- **不推荐 G 单独使用** — 在 32/48 下 crop 比例过高；64 下 crop 极少，可仅作极端 fallback。

---

## Abnormal Sample Analysis

| 类别 | 数量 | 占比 | 判定 |
|------|------|------|------|
| duration < 40 ms | 411 | 0.041% | 边界偏短 · 多为 30 ms 步进对齐 |
| duration < 60 ms | 1,332 | 0.133% | 短音节 · 快语速 / t5 |
| duration > 600 ms | 886 | 0.089% | 拖音 / 慢朗读 |
| duration > 1000 ms | 6 | 0.0006% | 极端个例 |
| start ≥ end（已收集样本） | 0 | 0% | **PASS** |
| wav missing | 0 | 0% | **PASS** |
| TextGrid 解析失败 | 0 | 0% | **PASS** |
| wav/TextGrid 配对缺失 | 0 | 0% | **PASS** |
| 非 pinyin+tone token（原始 tier） | 3,456,456 intervals | — | **预期**（MFA 音素层 · P7-A 已说明） |

**结论：** **不存在大量**过短/过长异常；极端样本合计 **< 0.2%**，可在 Feature Shard 构建时按 Contract 阈值过滤或保留并加权，**不构成 Frame Length 决策阻塞**。

### 样例（每类 ≥20 条 · 详见 Evidence JSON）

**duration < 40 ms（411 条 · 展示 20 条）：** 多为 **30 ms** 固定步进（TextGrid xmin/xmax 精度），speaker 集中 SSB0693 / SSB0702 / SSB0717 等；`frame_count=1`。

**duration < 60 ms（1,332 条）：** 含上述 + 40–59 ms 短音节；t5 / 快语速占比偏高。

**duration > 600 ms（886 条）：** 集中于慢说话人 **SSB1782**、**SSB0393** 等；最长单音节 **SSB05780202 · 660 ms**。

**duration > 1000 ms（6 条 · 全部）：**

| utterance | speaker | duration (ms) | label |
|-----------|---------|---------------|-------|
| SSB17820180 | SSB1782 | 1,110 | t4 |
| SSB17820246 | SSB1782 | 1,060 | t4 |
| SSB17820067 | SSB1782 | 1,030 | t2 |
| SSB17820162 | SSB1782 | 1,010 | t1 |
| SSB17820346 | SSB1782 | 1,010 | t1 |
| SSB17820428 | SSB1782 | 1,010 | t1 |

**token invalid（原始 TextGrid 音素 token · 25 条样例）：** 如 `sp`、`sil`、`n`、`ai4` 等 — **已被 Provider 正确跳过**，不计入 SyllableSample。

---

## TextGrid Timestamp Suitability

| 评估维度 | 结论 | 证据 |
|----------|------|------|
| 边界精度 | **足够 Frame Contract** | P50=230 ms 远大于 STFT hop (10 ms)；P99=490 ms |
| 全量覆盖 | **PASS** | 997,992 音节 · join 100% |
| 分布稳定性 | **PASS** | 218 说话人无离群；调类分布符合预期 |
| 极端样本 | **可管理** | <0.2% · 可 Contract 级过滤 |
| 时间量化 | **30 ms 步进可见** | 短音节（20–40 ms）存在量化台阶 — 对 64 frames 影响有限 |
| 与 P0 minSlice 一致性 | **PASS** | Provider 20 ms 下限已生效 |

**裁决：TextGrid timestamp 足够用于 Feature V2 固定帧长与插值策略设计。** 无需为 Frame Length 决策先行引入 FW Timestamp。

---

## FW Timestamp Comparison Need Assessment

| 项 | 评估 |
|----|------|
| **本轮是否必须** | **否** |
| **原因** | Frame Length 由 duration 分布统计决定；TextGrid 已覆盖 99.97%@64f；FW 边界差异不改变 P50/P99 量级结论 |
| **未来可选对比目的** | 验证 **音节边界偏移** 对 contour 分类的上限；评估是否替换 AlignmentProvider（**非本轮**） |
| **建议抽样量** | 2,000–5,000 音节（分层：t1–t5 × 快/慢语速 × 10 说话人） |
| **所需字段** | `wav_path` · TextGrid `(start,end)` · FW `AcousticToneSlice(start,end)` · 可选 `confidence` |
| **比较方法** | `Δduration = |FW_end-FW_start| - |TG_end-TG_start|`；P50/P90 偏移；符号化边界 shift 直方图 |
| **避免第二 Pipeline** | 只读调用既有 FW `run_tone_inference` 输出 · 与同一 `SyllableSample.wav_path` 切片对照 · **不**新增 AlignmentProvider |

**本轮裁决：不执行 FW 对比；不阻塞 Feature V2 Contract 设计。**

---

## Feature V2 Frame Length Recommendation

### 主方案（建议 · 本轮不冻结）

```text
featureVersion   = p1-frame-mel-f0-v1   （建议名 · 须下阶段正式冻结）
featureShape     = (fixedFrames, channels)
fixedFrames      = 64
channels         = 80 (mel) + 1 (f0) = 81   （或分离存储 · Contract 设计项）
sampleRate       = 16000
frameLengthMs    = 25
hopLengthMs      = 10
alignment        = TextGridPinyinAlignmentProvider（不变）
resamplePolicy   = duration_normalized_linear_interp_to_64
overflowPolicy   = center_crop_if_raw_frames_gt_64   （0.03% 样本）
```

### 证据链

| 证据 | 支撑 |
|------|------|
| P99 frame = 47 | 64 提供 **≥36%** 余量 |
| crop@64 = 0.03% | 信息截断可忽略 |
| crop@48 = 0.73% | 慢语速 4.96% crop — 不达标 |
| crop@32 = 11.2% | 否决 |
| mean frame ≈ 22 | 固定 64 需 ~3.4× 插值 — CNN 可学习；优于 mean-pool 坍缩 |
| t5 最短 | 插值比 4.48× — 须保留 F0 通道（7-D 审计建议） |
| P0 hop=160 一致 | 与 Runtime 音频链采样节奏兼容 |

### 备选方案

| 场景 | 建议 |
|------|------|
| 存储/算力敏感 | `fixedFrames=48` + 同上插值（接受 0.73% crop） |
| 研究上限 | `fixedFrames=80` — 边际收益极小 |
| 未来迭代 | dynamic mask（**须** Training Engineering + Runtime 再冻结） |

### 与冻结层关系

| 层 | 本轮 | 下阶段 |
|----|------|--------|
| `p0-v1` mean-mel | **KEEP** 不变 | 并行新 version |
| `contract.py` | 不修改 | 新增 `P1_*` 常量 |
| `mel.py` | 不修改 | 新 `extract_frame_mel_f0()` |
| Feature Shard v1 | **KEEP** | 新 `training_feature_shard_v2` |
| Runtime loader | 不修改 | 新 artifact schema 适配 |

---

## Frozen Architecture Verification

| 检查项 | 结果 |
|--------|------|
| 审计类型 | Level 2 Dataset Analysis / Feature Contract Pre-Audit |
| Runtime / Loader / Contract | **未修改** |
| Dataset Foundation（Adapter / Provider / pipeline） | **未修改** |
| Training Engineering（Shard / Reader / train） | **未修改** |
| Feature Baseline p0-v1 / mel.py | **未修改** |
| Validation / Artifact / Node E2E | **未修改** |
| 训练 / 新权重 | **未执行** |
| 数据路径 | 只读 `aishell3_pipeline` + cache |

**确认：本轮仅为冻结架构之上的数据分析，不触碰任何冻结组件。**

---

## Architecture Drift Audit

| 项 | Expected | Actual | 判定 |
|----|----------|--------|------|
| 使用 Canonical 数据集 | AISHELL-3 v1 | 997,992 音节 | **PASS** |
| 对齐链路 | textgrid_pinyin_v1 | 一致 | **PASS** |
| 音节数与 P7-A | 997,992 | 997,992 | **PASS** |
| 引入第二 Dataset Pipeline | 禁止 | 未引入 | **PASS** |
| 静默修改 featureVersion | 禁止 | 未修改 | **PASS** |
| 审计脚本位置 | 非冻结层 | `_data_cache/p8_duration_audit_run.py` | **KEEP**（证据） |

---

## KEEP / MODIFY / RESTORE / DELETE

| 动作 | 对象 | 说明 |
|------|------|------|
| **KEEP** | `p0-v1` · Canonical Shard v1 · TextGrid Provider | 生产/训练基线不变 |
| **KEEP** | P7-A join · manifest · 997,992 计数 | 与本轮审计一致 |
| **MODIFY** | （下阶段）新增 `p1-frame-mel-f0-v1` Contract | 须 Foundation Phase + 再冻结 |
| **MODIFY** | （下阶段）`training_feature_shard_v2` schema | Training Engineering 再冻结 |
| **MODIFY** | （下阶段）`mel.py` 帧级提取 + f0 | 非本轮 |
| **RESTORE** | — | 无 |
| **DELETE** | — | 无 |

---

## Final Verdict

### **CONDITIONAL PASS**

**条件：** 进入 Feature V2 Contract 设计阶段时，须：

1. 正式冻结新 `featureVersion`（建议 `p1-frame-mel-f0-v1`）及 `fixedFrames=64`；
2. 单独立项 Training Engineering schema v2 + Runtime artifact 适配；
3. 明确插值策略（duration-normalized linear）与 0.03% overflow crop 策略；
4. FW Timestamp 对比列为 **可选增强**，非门禁。

---

## 终局问题回答

| # | 问题 | 回答 |
|---|------|------|
| 1 | AISHELL-3 syllable duration 分布是什么？ | P50 **230 ms** · mean **240.7 ms** · P99 **490 ms** · 范围 **20–1110 ms**（997,992 音节） |
| 2 | 32 / 48 / 64 / 80 frames 哪个最合理？ | **64** 最合理（99.97% 无裁剪 · P99+余量）；48 为备选；32 否决；80 边际收益不足 |
| 3 | 是否应该使用 duration-normalized interpolation？ | **是** — ~100% 样本短于 fixedFrames，插值是保留 contour 的标准做法 |
| 4 | 是否需要 dynamic mask？ | **P8 首版不需要** — 固定 64 + 插值即可；mask 留作未来变长实验 |
| 5 | 是否存在大量过短或过长异常样本？ | **否** — 极端时长合计 **< 0.2%**；结构异常 **0** |
| 6 | TextGrid timestamp 是否足够用于 Feature V2 设计？ | **是** |
| 7 | 是否需要额外 FW Timestamp 对比？ | **否**（本轮不阻塞；可选 2k–5k 分层抽样未来做边界精度上限评估） |
| 8 | 推荐的 Feature V2 固定 frame length 是多少？ | **64 frames**（25 ms 窗 · 10 ms hop · n_fft=400） |
| 9 | 是否可以进入 Feature V2 Contract 设计阶段？ | **是** — 数据证据充分；须新 Foundation Phase，**不得**在 p0-v1 上静默升级 |

---

*Evidence: `p8_duration_audit.json` · Generated 2026-07-02T19:05:14Z · Elapsed 655.8s*
