# Tone V2 P10 — Raw WAV vs Node Runtime Processed Audio Impact Audit

**Date:** 2026-07-11  
**Audit Type:** 只读审计 + 一次性调试探针 + 真实语料离线链路重放（HTTP E2E 受服务可用性限制）  
**Artifact:** `tone_cnn_p1_v1_full.npz` + `numpy_p1` + `feature_v2.extract_feature`  
**禁止项遵守:** 未修改正式 Runtime 业务逻辑 / 模型 / Feature Cache / Node↔FW 正式接口；未新增 raw/runtime 切换、Shadow、p0 fallback、双 Feature 主链  

**探针输出:** `tmp/tone_p10_audio_domain_audit/`（`audit_report.json` + 每 fixture `summary.json`）  
**一次性脚本:** `electron_node/services/faster_whisper_vad/scripts/tone_p10_audio_domain_audit.py`（独立路径，非 Runtime import）

---

## 1. Executive Summary

本轮在 **25 条真实 dialog_200 Piper TTS 中文 wav** 上重放 FW 生产预处理函数（`preprocess_pcm_f32` + VAD 拼接语义），并用 **P1 full 模型** 对比 raw 连续域 vs runtime processed 域的 Feature / posterior。因本机 **FW `:6007` 与 Node 测试服 `:5020` 均未启动**，HTTP 主路径 E2E 与 Recall 变体实验 **未能在线完成**；词级对比仅 **d001** 具备历史 Node E2E trace 中的 FW WordInfo（19 词）。

| 维度 | 结论 |
|------|------|
| VAD 语义 | **模式 B** — Silero VAD 检出段 **直接拼接**，段间停顿删除；ASR 与 Tone **同用** `processed_audio` |
| 时间轴 | WordInfo / acousticToneSlices **相对 processed_audio**；Node 多 batch 时对 slice 做 `offsetAcousticSlices`；**未发现 BLOCKER 级双缓冲/重复 offset** |
| 主要音频差异来源（TTS 干净语料） | **peak normalize（≈ -3 dBFS）+ 首尾 silence trim**；离线能量 VAD 代理在 25/25 条上 **VAD 删除 ≈ 0**（TTS 连续语音） |
| Feature 差异 | 全体词级 mel MAE ≈ **0.26**（主要来自幅度归一化）；`norm_vs_trim` **bit-equal**（d001 首词） |
| posterior / argmax（d001, 19 词） | **argmax 变化率 10.5%（2/19）**；变化词：**貝**（t3→t4）、**少**（t4→t5），均为 **低 margin 区** |
| Recall / Final Candidate | **本轮未在线重放**；历史 d001 显示 ASR 已误识「杯→貝」，Tone 差异叠加在错误 token 上，**不能据此单独判定 Recall 退化** |
| 是否需要重训 | **Verdict B** — 建议按 Runtime 预处理域重建 Feature Cache 并重训；**不阻塞 P10 接线开发** |
| Node 是否必须作验收入口 | **是（主验收）** — Node 引入 **WAV→Opus→PCM16** 往返与 aggregator 切分；不可仅用 FW-direct 替代 |

### Final Verdict: **CONDITIONAL PASS**

| 分项 | 裁决 |
|------|------|
| P10 接线开发是否可以继续？ | **是** |
| 现有 full artifact 是否可用于结构验收？ | **是** |
| 现有 full artifact 是否可用于生产质量验收？ | **否**（输入域不一致 + 真实 E2E 词级样本不足） |
| 是否需要按 Node/FW Runtime 音频域重建 Feature Cache 并重训？ | **是（建议，验收前）** |
| 以后 Tone E2E 是否必须从 Node 接收端口开始？ | **是** |

---

## 2. Node 真实接收调用链

### 2.1 生产主入口 vs 批测/审计入口

| 场景 | 入口 | 文件 / 符号 | 协议 |
|------|------|-------------|------|
| **生产** | Scheduler → Node Agent | `node-agent-job-processor.ts` → `inferenceService.processJob` | WebSocket `job_assign` |
| **批测 / P10 审计主入口** | 本地测试 HTTP | `test-server.ts` → `POST /run-pipeline-with-audio` | HTTP JSON |
| **IPC（Electron UI）** | Preload | `run-pipeline-with-audio` IPC | IPC |

审计认定 **批测主入口** `POST http://127.0.0.1:5020/run-pipeline-with-audio` 与生产 **同走 `processJob`**，仅 job 构造方式不同（见 `inference-service.ts` `runPipelineWithAudio`）。

### 2.2 `runPipelineWithAudio` 链路（WAV 文件 → 完整 pipeline）

```text
本地 WAV
  → parseWavFile（sample_rate）
  → convertWavToOpus（有损编码）
  → job_assign { audio_format: 'opus', audio: base64, sample_rate, is_manual_cut: true }
  → processJob
      → AudioAggregator.decodeAudioChunk（decodeOpusToPcm16）
      → [可选] 能量切分 / stream batch / context buffer
      → runAsrStep → TaskRouter → FW POST /utterance（pcm16）
      → acousticToneSlices + offsetAcousticSlices（多 batch）
      → FW Detector / Recall / Ranking / NMT / TTS
```

关键文件：

- `electron_node/electron-node/main/src/inference/inference-service.ts` — `runPipelineWithAudio`
- `electron_node/electron-node/main/src/pipeline-orchestrator/audio-aggregator-decoder.ts` — Opus→PCM16
- `electron_node/electron-node/main/src/pipeline/steps/asr-step.ts` — FW 调用与 tone slice offset
- `electron_node/electron-node/main/src/test-server.ts` — `:5020` 测试服

### 2.3 生产入口记录表

| 项目 | 实际值 |
|------|--------|
| Node 音频接收入口（生产） | WS `job_assign` → `processJob` |
| Node 音频接收入口（审计/批测） | `POST :5020/run-pipeline-with-audio` |
| handler / route | `test-server.ts` / `inference-service.runPipelineWithAudio` |
| 协议 | 生产：WebSocket；审计：HTTP JSON |
| payload 格式 | `{ wavPath, srcLang?, tgtLang?, useLexicon?, is_manual_cut?, enableKenLMGate? }` |
| 音频编码（审计路径） | 磁盘 WAV → **Opus base64** → Node 解码 **PCM16** → FW |
| sample rate | WAV 头解析值（dialog_200：**16000 Hz**） |
| channel | mono（Piper TTS） |
| chunk size | 单 utterance 测试通常为 **整段 WAV 一包**；流式场景由 `AudioAggregator` 切分 |
| utterance 结束条件 | `is_manual_cut: true` 时手动截止；否则 timeout/能量 finalize |
| Node → FW 调用位置 | `asr-step.ts` → ASR TaskRouter → `faster-whisper-vad` |
| FW endpoint | `POST http://127.0.0.1:6007/utterance` |
| 是否携带 context | 可配置 `use_context_buffer` / `context_text`（审计脚本与 d001 trace 均为 **false/空**） |
| 是否携带 padding_ms | job 级 `padding_ms`（可选） |
| 是否执行 offset | **是** — 多 ASR batch 时 `offsetAcousticSlices(segmentOffsetSec)` |

---

## 3. Node → FW Payload Contract

Node 发往 FW 的 ASR 任务（`asr-step.ts`）典型字段：

| 字段 | 值 |
|------|-----|
| `audio` | PCM16 base64（由 Opus 解码后） |
| `audio_format` | `pcm16` |
| `sample_rate` | job.sample_rate（默认 16000） |
| `src_lang` | `zh` 等 |
| `padding_ms` | job.padding_ms（可选） |
| `context_text` | 会话上下文（可选） |

FW `api_routes.py` `/utterance` 接收后：

1. `decode_and_preprocess_audio` — decode → resample → optional padding → **`preprocess_pcm_f32`（peak -3 dBFS + trim）**
2. `prepare_audio_with_context` — Silero VAD → **段拼接** → `processed_audio`
3. Faster-Whisper ASR on `processed_audio`
4. **`run_tone_inference(processed_audio, segments)`** — Tone **在 dedup 之前**，与 ASR 同缓冲

---

## 4. Audio Stage Pipeline

### 4.1 阶段映射表

| Stage | Buffer owner | 输入来源 | 处理操作 | 典型时长变化（25 fixtures 均值） | 改变时间轴 | 下游消费者 |
|-------|--------------|----------|----------|----------------------------------|------------|------------|
| A0 original_input | 磁盘 / 客户端 | raw wav | 无 | 基准 | 否 | Node 读文件 |
| A1 node_decoded_audio | Node | Opus decode | **有损 Opus 往返** | ≈ A0（样本数级） | 否 | AudioAggregator |
| A2 node_assembled | Node | chunk/context | 拼接 / 能量切分 | 视会话 | **可能** | ASR batch |
| A3 fw_decoded | FW | pcm16 b64 | decode → mono f32 | ≈ A1 | 否 | preprocess |
| A4 resampled | FW | A3 | resample→16k | 通常不变 | 否 | preprocess |
| A5 peak_normalized | FW | A4 | peak → **-3 dBFS** | 不变 | 否 | trim |
| A6 silence_trimmed | FW | A5 | 首尾 -40 dBFS 静音裁剪 | **-0.147 s 均值** | **是（leading 时）** | VAD 输入 |
| A7 vad_segments | FW Silero | A6 | 段检测 + refine | metadata | — | concat |
| A8 vad_concatenated | FW | A7 | **段直接拼接** | 离线代理：0；生产：视停顿 | **是（拼接）** | ASR + Tone |
| A9/A10 asr/tone input | FW | A8 | 同一缓冲 | = A8 | — | Whisper + extract_feature |

**代码事实：** `A9_asr_input` 与 `A10_tone_input` 在 `api_routes.py` 为 **同一 `processed_audio`**（非模式 C）。

### 4.2 25 fixtures 阶段统计（离线重放 `preprocess_pcm_f32` + 能量 VAD 代理）

| 指标 | mean | min | max |
|------|------|-----|-----|
| peak normalize gain (dB) | **-2.93** | -3.0 | -2.7 |
| leading trim (ms) | **9.6** | 0 | 160 |
| trailing trim (ms) | **137.6** | 80 | 240 |
| duration removed (s) | **0.147** | — | 0.32 |
| VAD removed (s) | **0.0** | 0 | 0 |

> **注意：** 离线 VAD 使用能量阈值代理（避免 Silero GPU 依赖）。TTS 干净连续语音下与「VAD 无段 → fallback 全音频」一致；**带真实停顿/噪声的语料必须用 Silero 复验**。

### 4.3 d001 样例（cafe tone-sensitive）

| 指标 | raw (A0) | processed (A8) |
|------|----------|----------------|
| duration | 6.095 s | 6.015 s |
| peak dBFS | -0.05 | -3.0 |
| leading trim | 0 ms | 0 ms |
| trailing trim | — | 80 ms |
| VAD segments | — | 0（fallback 全音频） |
| main difference | — | **peak norm + trailing trim** |

---

## 5. Raw / Normalized / Trimmed / VAD-concatenated 差异分解

### 5.1 三个概念区分

| 概念 | d001 本轮表现 |
|------|----------------|
| **Raw WAV** | 磁盘 Piper 16k mono，peak ≈ -0.05 dBFS |
| **Preprocessed continuous** | peak -3 dBFS + trim 后 6.015 s 连续音频 |
| **VAD-concatenated** | 与 continuous **相同**（无检出段 / fallback） |

### 5.2 控制变量实验（d001 首词「你好」）

| 实验 | maxAbsDiff | mel MAE | 结论 |
|------|------------|---------|------|
| B: raw vs norm only | 0.295 | 0.260 | **幅度归一化主导** |
| C: raw vs trim | 0.295 | 0.260 | d001 无 leading trim，与 norm 相同 |
| norm vs trim | **0.0** | **0.0** | trim 仅裁尾部，首词窗口不变 |

### 5.3 差异来源排序（当前语料）

1. **peak normalization（HIGH 贡献）** — 全体 mel 偏移 ≈ 0.26 MAE  
2. **trailing silence trim（MEDIUM）** — 均值 ~138 ms；仅影响尾部词边界  
3. **leading trim（MEDIUM，条件性）** — 最大 160 ms；**若存在则 raw 域 WordInfo 需加 offset**  
4. **VAD 拼接（LOW on TTS；潜在 HIGH on 真实停顿语料）** — 本轮未触发  
5. **Node Opus 往返（未量化，HIGH 风险）** — 需 Node E2E 在线对比  

---

## 6. 时间轴映射

### 6.1 VAD 拼接语义（代码事实）

**模式 B** — `utterance_audio.py` L159-179：`processed_audio = concatenate(segment_audio for each vad_segment)`，**不保留段间静音**，无额外 padding。

回答审计清单：

| # | 问题 | 答案 |
|---|------|------|
| 1 | `processed_audio` 是否由多 VAD 段拼接？ | **是**（有段时）；无段则 fallback 全音频 |
| 2 | 拼接是否保留段间静音？ | **否** |
| 3 | 是否增加 padding？ | VAD 路径无；`padding_ms` 在 **VAD 之前** 追加尾部零填充 |
| 4 | ASR timestamp 相对谁？ | **`processed_audio` 时间轴** |
| 5 | Tone WordInfo 与 Tone 输入是否同轴？ | **是** |
| 6 | Node 是否对 FW timestamp 加 offset？ | **多 batch 时对 acousticToneSlices 加 segment offset**；WordInfo 经 `buildWordTimeSpans` 映射到 raw 文本轴 |
| 7 | offset 类型 | **utterance 内 ASR batch 累计时间 offset** |
| 8 | Recall 用哪个时间轴？ | **全局化后的 slice + 文本对齐**（`tone-time-align.ts`） |
| 9 | VAD segment metadata 是否保留？ | FW diagnostics `fw_vad_segment_count`；段边界在拼接后 **不映射回 raw** |
| 10 | 拼接时间戳套回 raw 风险？ | **存在理论风险**；本轮 d001 无拼接；leading trim 时 naive raw 对比会错位 |

### 6.2 processed_time ↔ original_time

当仅 **trailing trim**（d001）：`processed_t ≈ raw_t`（对 0..trim 前内容）。  
当 **leading trim 或 VAD 拼接**：必须按段表重建映射；**禁止**逐采样 index 直接对比 raw vs processed。

---

## 7. WordInfo Provider 对比

| Group | 对比 | 本轮状态 |
|-------|------|----------|
| G1 | TextGrid vs FW WordInfo @ raw 轴 | **未执行**（无 TextGrid fixture） |
| G2 | FW WordInfo vs 人工边界 @ processed 轴 | **未执行** |

**可用数据：** d001 历史 trace（2026-06-28 Node E2E）— FW WordInfo @ processed 轴，19 词。

**边界 vs 音频域：** d001 首词分解显示 **音频域（peak norm）>> 边界**（norm vs trim 零差异）；argmax 翻转出现在 **低 margin** 词（貝、少），非极端切分错误。

---

## 8. Feature 差异

**Extractor：** `feature_v2.extract_feature`（SSOT）  
**Model：** `ToneModelLoaderV1` → `numpy_p1`

### 8.1 d001 聚合

| 指标 | 值 |
|------|-----|
| 词数 | 19 |
| maxFeatureAbsDiff（跨词 max） | 0.295 |
| 典型 mel MAE | ~0.26 |
| f0 MAE | 0.0（本轮窗口内 F0 通道无差） |
| bit-equal | **否**（全体） |

### 8.2 变化是否仅为幅度平移？

**否。** mel 通道系统性偏移（meanAbsDiff ≈ 0.25），与 peak normalize 一致；非简单标量乘法（maxAbsDiff 因 mel 对数域非线性）。

---

## 9. Posterior / Argmax 差异

### 9.1 d001 词级表（raw 连续域 vs runtime processed 域；同一 FW WordInfo）

| Word | Audio variant | Argmax raw | Argmax runtime | Changed | Margin raw | Margin rt |
|------|---------------|------------|----------------|---------|------------|-----------|
| 貝 | raw vs processed | 3 | 4 | **是** | 0.196 | 0.101 |
| 少 | raw vs processed | 4 | 5 | **是** | 0.071 | 0.280 |
| 其余 17 词 | — | — | — | 否 | — | — |

- **overallArgmaxChangeRate = 10.5%（2/19）**
- 变化类型：**posterior 漂移 + argmax 翻转**（非仅 confidence 变化）
- **貝**：ASR 已误识为「貝」非「杯」；声调 ground truth 不可直接按「杯 t1」评判
- **少**：参考文本 **少糖 → 上声（t3）**；raw argmax=4 / runtime argmax=5 **均不等于参考** → 属 **两者都错**，runtime **未纠正**

### 9.2 与历史 p0 trace 的关系

`d001-timestamp-tone-probe-trace.json` 中 acousticToneSlices 来自 **生产 p0 Runtime**（mel80 + numpy_p0），与本轮 **P1 full** posterior **数值不可直接对比**；时间边界仍有效。

---

## 10. Ground-Truth Tone Quality

dialog_200 有 `expectedText`，但 **无逐字声调标注**；仅能对少数字做语言学参考：

| 评估项 | 结果 |
|--------|------|
| 可靠准确率 | **不可声称** |
| raw vs runtime argmax 一致率 | **89.5%（17/19 一致）** |
| 改善 / 退化（有参考的「少」） | raw **错** / runtime **错** — 无改善 |
| 混淆矩阵 | **未标注，标为 unlabelled** |

---

## 11. Recall / Ranking / Final Candidate

### 11.1 本轮执行状态

| Variant | 状态 |
|---------|------|
| V1 Node Runtime Tone posterior | **未在线执行**（Node/FW down） |
| V2 raw-domain posterior | 离线仅 d001 词级 |
| V3 Tone disabled | 未执行 |
| V4 Uniform posterior | 未执行 |

### 11.2 历史旁证（d001 trace）

- ASR raw：`…中貝少糖…`（「杯」误识）
- FW Detector 已触发；最终文本修复依赖 lexicon / rerank，**非本轮重放**
- **推断：** 音频域 argmax 变化发生在 **已误识 token** 上；Recall 是否改变 final candidate **需要 Node E2E + lexicon mock 四变体** — **验收前必补**

### 11.3 若 posterior 变而 candidate 不变的可能原因（待验）

- tone margin 小但 lexicon 无同调候选  
- KenLM 覆盖 tone penalty  
- pattern 对齐失败  
- 候选本身无歧义  

---

## 12. Node E2E vs FW-Direct

| 路径 | 本轮 | 差异点 |
|------|------|--------|
| **Production-path** | Node `:5020` → FW | Opus 编解码、aggregator、offset、Recall 全链 |
| **FW-direct isolation** | 脚本 `post_fw_utterance` pcm16 | 绕过 Node；仍走 FW 内全预处理 |

**结果：** 两者均 **HTTP 失败**（服务未启动）。  
**代码结论：** 即使 FW-direct 与离线预处理一致，**仍不能替代 Node E2E**（Opus + batch offset + Recall）。

---

## 13. Runtime Input Contract 建议（冻结草案）

```text
Training / Feature Cache（未来）
  → 应对齐：Node Opus 往返后 PCM16 → FW decode_and_preprocess → VAD concat → processed_audio
  → WordInfo：FW ASR @ processed_audio 时间轴
  → extract_feature(processed_audio, sr, WordInfo)
  → numpy_p1 → TonePosterior → AcousticToneSlice

禁止：
  → raw AISHELL wav 直接训练却期望 Runtime processed 域零漂移
  → raw 轴 WordInfo 与 processed 音频混用
  → p0 fallback / 双主链
```

---

## 14. 是否需要重训

### Verdict **B — 建议重训，不阻塞 P10 接线开发**

依据：

- Training 当前：**raw AISHELL wav + TextGrid/音节边界**  
- Runtime：**FW processed_audio + FW 字级 WordInfo**  
- 实测：**~10% argmax 变化（d001）**，mel MAE ~0.26 系统性偏移  
- TTS 语料上 VAD 影响未显现；**真实停顿语料风险未关闭**  
- **无 BLOCKER** 级时间轴错误  

正确后续：

```text
冻结 Runtime 输入合同 → 重建 Feature Cache（processed 域）→ 重训 P1/P2 artifact → 再跑 Node E2E golden
```

---

## 15. 严重度分级

### BLOCKER

**无**（代码审计 + 离线探针未发现）

### HIGH

| ID | 描述 |
|----|------|
| H1 | **FW/Node HTTP E2E 未完成** — 无法确认 Opus 往返与 Recall 传播 |
| H2 | **词级样本覆盖不足** — 25 fixtures 中仅 1 条有 WordInfo |
| H3 | **训练 raw 域 vs Runtime processed 域不一致** — 系统性 mel 偏移 |
| H4 | **Silero VAD 真实拼接未在本轮验证** — 仅能量代理 |

### MEDIUM

| ID | 描述 |
|----|------|
| M1 | peak normalize 导致全词 mel MAE ~0.26 |
| M2 | d001 低 margin 词 argmax 翻转（10.5%） |
| M3 | leading trim 存在时 raw/runtime naive 对比可能错位 |

### LOW

| ID | 描述 |
|----|------|
| L1 | 探针目录 / 脚本命名与清理 |
| L2 | 控制台 Unicode 显示 |

---

## 16. Required Before P10 Development

- [x] 确认 VAD 模式 B 与 ASR/Tone 同缓冲  
- [x] 确认 Node 测试入口 `run-pipeline-with-audio` 与 `processJob` 等价  
- [x] 离线预处理重放脚本就绪  
- [ ] **无强制阻塞项**

---

## 17. Required Before P10 Acceptance

- [ ] 启动 FW `:6007` + Node `:5020`，完成 **≥20 fixtures** Node E2E 重放  
- [ ] Silero VAD 真实拼接语料（停顿 / 噪声 / 低音量）  
- [ ] Opus 往返 vs FW-direct 波形相关性与 posterior 对比  
- [ ] Recall 四变体（Runtime / raw-domain / disabled / uniform）  
- [ ] tone-sensitive golden：`d001`、lexicon_homophone 块、历史失败样本  
- [ ] 按 Runtime 合同重建 Feature Cache + 重训后复验  

---

## 18. 二十五个必答问题

| # | 问题 | 答案 |
|---|------|------|
| 1 | raw wav 到 Node 接收后是否被修改？ | **是** — Opus 编解码；可能 aggregator 切分/拼接 |
| 2 | Node 是否拼接 chunk/context/utterance？ | **可能** — 流式/会话场景；单 WAV 测试通常整段 |
| 3 | Node 发给 FW 的音频与原始 wav 是否相同？ | **否** — Opus 有损 + PCM16 量化 |
| 4 | FW decode 后是否改变 dtype/scale/channel？ | **是** → mono float32；随后 peak normalize |
| 5 | peak normalization 增益？ | **目标 -3 dBFS**；d001 peak -0.05→-3 dB |
| 6 | silence trim 删除多少？ | **均值 ~147 ms**（lead+trail）；d001 trail 80 ms |
| 7 | VAD 删除多少？ | **TTS 离线代理：0**；生产 Silero 待复验 |
| 8 | VAD 是否拼接不连续段？ | **是（模式 B）** |
| 9 | ASR 与 Tone 是否同 processed_audio？ | **是** |
| 10 | FW WordInfo 是否相对 processed_audio？ | **是** |
| 11 | Node 是否对 timestamp 加 offset？ | **多 batch 时对 acoustic slices 加 offset** |
| 12 | Recall timestamp 属哪条轴？ | **对齐后全局文本/时间轴** |
| 13 | raw vs normalized Feature 差异？ | mel MAE **~0.26**（d001 级） |
| 14 | raw vs trimmed Feature 差异？ | d001 无 leading trim 时 **≈ normalized** |
| 15 | continuous vs VAD-concat Feature 差异？ | **本轮 TTS：0**；真实停顿 **未知** |
| 16 | raw vs Runtime posterior 差异？ | d001：**L1 均值显著**；maxAbs 最高 ~0.18（少） |
| 17 | argmax 变化率？ | **10.5%**（2/19，仅 d001） |
| 18 | 变化中改善/退化？ | **无可靠标注**；「少」两者皆错 |
| 19 | 主要影响音频还是边界？ | **音频预处理（peak norm）>> 边界** |
| 20 | Tone 差异是否改变 Recall 排名？ | **本轮未验证** |
| 21 | 是否改变 Final Candidate？ | **本轮未验证** |
| 22 | 直接 FW vs Node 是否一致？ | **本轮未验证**；代码上 **不应假设一致** |
| 23 | 正式验收是否必须从 Node 入口？ | **是** |
| 24 | full model 是否需按 Runtime 域重训？ | **建议是（Verdict B）** |
| 25 | P10 Runtime Direct Replacement 是否可继续？ | **是（接线）；质量验收待重训+E2E** |

---

## 19. 临时改动清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `electron_node/services/faster_whisper_vad/scripts/tone_p10_audio_domain_audit.py` | 一次性审计脚本 | 默认关闭 HTTP；不改变 Runtime |
| `tmp/tone_p10_audio_domain_audit/**` | 探针输出 | 可整体删除 |

**未修改：** 正式 Runtime、`api_routes.py` 业务逻辑、模型权重、Feature Cache、Node/FW 接口。

---

## 20. 附录：探针复现

```bash
# 离线阶段 + Feature/posterior（无需服务）
cd electron_node/services/faster_whisper_vad
python scripts/tone_p10_audio_domain_audit.py --limit 25 --no-http

# 在线 Node + FW E2E（需 :6007 + :5020）
python scripts/tone_p10_audio_domain_audit.py --limit 25
```

环境变量：`TONE_P10_FW_URL`、`TONE_P10_NODE_URL`

---

## 21. 与前轮审计关系

- **P10 PreDev / SSOT 审计：** CONDITIONAL PASS — 本轮用真实 TTS 语料 **印证** 输入域不一致与 peak norm 主导差异，**未推翻** 接线可行性结论。  
- **合成信号探针（SSOT 审计）：** 200 窗扫描 argmax 变化 ~17.5% — **仅作上限参考**，本轮 **不以合成信号作生产质量结论**。

---

*审计执行：2026-07-11 | 探针 aggregate 见 `tmp/tone_p10_audio_domain_audit/audit_report.json`*
