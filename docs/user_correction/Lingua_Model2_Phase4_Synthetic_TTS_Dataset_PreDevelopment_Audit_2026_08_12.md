# Lingua Model2 Phase 4 — Synthetic / TTS Training Dataset Pipeline Pre-Development Audit

| Field | Value |
|-------|-------|
| Date | 2026-08-12 |
| Nature | **READ-ONLY PRE-DEVELOPMENT AUDIT** |
| Scope | TTS / ASR / Tone / Pinyin / Lexicon / Corpus / Training infra / TrainingSample V1 |
| Based on | Phase 1–3 User Correction + Model2 contracts (2026-08-11) |
| Verdict | **READY_WITH_GAPS** |

本轮未修改代码、配置、数据库、模型、训练集或既有 SSOT 设计文档。本文件为审计交付物。

---

## 1. Executive Summary

仓库**已具备**构建 Synthetic Dataset V1 主干链路的真实组件：

```text
Ground Truth text
  → Piper TTS (已用于 dialog_200)
  → optional acoustic perturbation (需 ADD)
  → REAL faster-whisper-vad ASR (生产同款)
  → Alignment → TrainingSample
```

关键结论：

| 问题 | 答案 |
|------|------|
| TTS 能否**直接**制造 n/l、前后鼻音、翘舌、tone confusion？ | **不能**（公开 API 无音素/发音错误控制） |
| 最小可行路径？ | **正常 TTS + 声学扰动 + 真实 ASR 误差**；RULE_SYNTHETIC 单独 provenance |
| Tone 进 V1？ | **OPTIONAL → 建议 V1.1**；勿阻塞首批 ASR-error dataset |
| CJK pinyin SSOT？ | **复用 Node `pinyin-pro` 工具链**；勿再造第二套；Scheduler FeatureExtractor 仍缺 CJK |
| Offline 目录？ | **独立** `training/model2/`（或 `tools/model2_dataset/`）；禁入 runtime |

**Verdict rationale**：可立刻开工 Probe/Baseline dataset；pronunciation-controlled TTS 与 Tone-on-synthetic 属增量。TrainingSample V1 需**最小 metadata / source_type 扩展**（开发阶段，非本审计）。

---

## 2. Current TTS Architecture

### Primary production TTS

| 项 | 证据 |
|----|------|
| 位置 | `electron_node/services/piper_tts/` |
| 入口 | `piper_http_server.py` → `POST /tts` |
| Runtime | Piper ONNX（`piper-tts` Python API）+ 可选 CLI 回退 |
| Device | `PIPER_USE_GPU`（默认 true）/ onnxruntime |
| Request | `models.py::TtsRequest`：`text`, `voice`, `language?` |
| Response | WAV bytes（`synthesis.create_wav_header`） |
| 中文 voice | `zh_CN-huayan-medium`（`download_piper_chinese.py`）；dialog_200 已用 |
| VITS 中文 | `vits-zh-aishell3` + `chinese_phonemizer.py`（lexicon→音素） |
| 预加载 | startup 预热多 voice |

### Secondary TTS

| 服务 | 路径 | 能力 |
|------|------|------|
| YourTTS | `electron_node/services/your_tts/` | Zero-shot / speaker clone（`/synthesize`, `/register_speaker`） |
| speaker_embedding | `electron_node/services/speaker_embedding/` | 说话人向量，非 TTS |

### Proven batch use

`test wav/dialog_200/cases.manifest.json`：

* `audioSource = piper_tts_http_5009`
* `voice=zh_CN-huayan-medium` → **16 kHz mono WAV**
* 200 条中文对话已闭环证明：**TTS 批量生成训练/回归音频可行**
* Piper 权威端口：`service.json` **5009**（部分旧文档/Rust 默认仍写 5006，开发时以 service.json 为准）

---

## 3. TTS Batch Suitability

| 维度 | 判定 |
|------|------|
| 批量生成训练语音 | **适合（REUSE）** — dialog_200 已验证 |
| 模型加载成本 | 启动预加载；适合长跑 worker |
| 并发 | HTTP 单服务；需 ADD 外部 job queue / multi-worker |
| 中英混合 | 中文主路径可用；混合依赖模型覆盖，需 probe |
| 多 speaker | Piper 多 voice 文件；VITS `num_speakers` 存在但 **HTTP 未暴露 speaker_id** |
| rate/pitch | 内部 `SynthesisConfig.length_scale/noise_scale`（`synthesis.py`）对 VITS 有默认值；**公开 TtsRequest 无这些字段** |

**A. 现有 TTS 适合批量生成训练语音：YES（Piper）。**

---

## 4. TTS Pronunciation Control Capability

| 控制项 | 公开 API | 代码内部 | 可否制造 phonetic confusion |
|--------|----------|----------|------------------------------|
| text | YES | YES | 改文本 ≠ 发音错误 |
| voice | YES | YES | 音色变化，非音素混淆 |
| language | optional | — | 否 |
| speed / length_scale | **NO** | VITS 默认 config | 近似语速，非 n/l |
| pitch / prosody | **NO** | noise_scale 默认 | 近似，非 tone confusion |
| SSML / phoneme override | **NO** | ChinesePhonemizer 走**正确** lexicon | **不能**注入错误音素 |
| pronunciation lexicon 覆盖 | **NO** | 仅正确合成路径 | **不能** |

**严禁等价**：修改正确文本 ≠ 制造真实发音错误。

---

## 5. Current ASR Architecture

| 项 | 证据 |
|----|------|
| 生产中文 ASR | `electron_node/services/faster_whisper_vad/`（`service.json` id=`faster-whisper-vad`） |
| 模型 | Faster Whisper；`service.json` 默认 env `ASR_MODEL=medium`；`config.py`/`README` 亦出现 `faster-whisper-large-v3` — **Synthetic 必须钉死并写入 manifest 的实际加载版本** |
| Device | GPU；`ASR_COMPUTE_TYPE=int8_float16` |
| Port | **6007** |
| 队列 | `QUEUE_MAX=1` 倾向串行 HTTP 批跑（非真 GPU batch） |
| 输入 | 16 kHz PCM（`api_models.py` sample_rate 默认 16000） |
| VAD / chunk | VAD 预处理 + utterance ASR worker 队列 |
| 输出 | text + segments；含 **word timestamps**（Tone 依赖） |
| confidence | segment `avg_logprob` 等 |
| n-best | beam 可配；service 默认 `ASR_BEAM_SIZE=1`（非稳定 n-best 训练源） |
| 备选 | `asr_sherpa_lm`（Sherpa CTC）— **Synthetic 必须锁定与生产一致的 ASR**，勿换“更方便”模型 |

---

## 6. Offline ASR Reuse Path

| 方案 | 判定 |
|------|------|
| 直接 HTTP 调生产同款 `faster-whisper-vad` `/utterance`（或等价） | **REUSE — 推荐** |
| 另起独立 Whisper 脚本 | **禁止作为主路径**（error distribution 漂移） |
| 经完整 Node Agent Job | 可复用但过重；offline adapter 更简 |

需 **ADD**：`training/model2/asr_adapter.py` 封装同一服务契约（audio base64、sr、language=zh、返回 text+words）。

**Q4**：可 offline batch 复用生产 ASR；需独立 inference adapter，但**模型/服务必须同源**。

---

## 7. Tone Offline Reuse Analysis

| 项 | 证据 |
|----|------|
| 模块 | `faster_whisper_vad/tone_module/` |
| 输入 | `processed_audio` + **FW WordInfo timestamps**（`inference.py`） |
| 依赖 | ASR 必须产出非空 `segments.words` |
| 离线 | 已有 `scripts/tone_p10_batch_inference_audit.py`、dataset/training_io |
| Batch | feature shard / mini-batch reader 存在于 Tone 训练栈 |
| Synthetic 是否自然有 timestamp | **YES** — 若走同一 ASR 且开启 word timestamps |

### MUST / OPTIONAL / DEFER

| 判定 | 说明 |
|------|------|
| **MUST（长期）** | Model2 若消费 acoustic tone，必须用真实 Tone 推理，禁止字典假造 |
| **OPTIONAL（Dataset V1）** | 首批以 ASR 文本误差为主；Tone 列可空 |
| **DEFER → V1.1** | Tone 进 synthetic pipeline 的稳定批处理与 manifest 字段 |

**Q6**：Tone 进 Synthetic Dataset **V1.1**，不阻塞 V1。

---

## 8. Pinyin / Phonetic Utility Inventory

| 实现 | 路径 | 角色 |
|------|------|------|
| **Node lexicon pinyin** | `electron_node/.../lexicon/phonetic/pinyin.ts`（`pinyin-pro`） | CJK→syllable；Lexicon scoring |
| tone-pinyin | `lexicon/phonetic/tone-pinyin.ts` | 带调拼音 |
| fuzzy-pinyin keys | `lexicon-v2/fuzzy-pinyin-key-builder.ts` | 召回变体，非 confusion schema |
| Piper ChinesePhonemizer | `piper_tts/chinese_phonemizer.py` | TTS 正确音素化（**另一套**） |
| Scheduler FeatureExtractor | Phase 3：仅 ASCII syllable；CJK = unsupported | 训练特征缺口 |
| UserFeatureSchema V1 | Scheduler `feature_schema.rs` | 固定 n_l / zh_z / … |

**唯一可复用的 CJK phonetic（面向 Model2/Dataset）**：Node **`pinyin-pro` + `textToSyllables` 语义**。  
Piper lexicon 音素是 TTS 声学前端，**不要**当作 Model2 FeatureSchema SSOT。

---

## 9. Recommended Phonetic SSOT

| Action | Item |
|--------|------|
| **KEEP** | UserFeatureSchema V1 keys（Phase 3） |
| **REUSE** | Node `pinyin.ts` / `pinyin-pro` 算法语义 |
| **MOVE_TO_SHARED** | 抽纯函数（TS shared 或 Python `pypinyin` **对齐同一规范**）供 Dataset + 未来 Scheduler |
| **DELETE_DUPLICATE** | 禁止 Dataset 再写第三套拼音规则 |
| **ADD** | Dataset 侧 confusion labeler：syllable pair → schema key |
| **DEFER** | Piper phoneme 注入式 corruption |

**Q5**：复用 Node `pinyin-pro` 路径；建议提取 shared pure utility；Dataset 阶段可用对齐的 Python 实现，但必须单规范单测对齐。

---

## 10. Lexicon Corpus Reuse

| 资产 | 路径 |
|------|------|
| Domain SSOT CSV | `electron_node/docs/lexicon-assets/full_rebuild_v1/`（含 `term_domain_tags_corrected.csv`） |
| Industry packs | `lexicon-assets/industry_pack_v1/v2` |
| Runtime bundle | `node_runtime/lexicon/v3/`（**生产 FW 词库 SSOT**）+ `current/`（**LEGACY_RECOVER_ONLY，禁止作 Phase4 目标**） |
| Runtime API | `lexicon-runtime.ts` / `lexicon-bundle-path.ts` |

**适合作为 Synthetic Target Term Corpus：YES**（优先 `domain_lexicon` + `term_domain_tags`；base 作干扰；idiom 慎用）。  
**保持现有词库 domain SSOT：MUST。** 勿为 Model2 新建第二套 vocabulary SSOT。

另可 **REUSE**：`electron_node/.../data/lexicon/zh_asr_confusions_seed_high_quality.jsonl`（错词扰动/hard-negative 种子）。

覆盖：base/domain、2–5 字专名、中英混排（取决于入库）；personal-like 专名可从 domain tags 抽样。

---

## 11. General Text Corpus Inventory

| 语料 | 路径 | 用途 |
|------|------|------|
| **dialog_200** | `test wav/dialog_200/` + `cases.manifest.json` | **最佳 carrier 模板源**（口语、已对齐 Piper） |
| Tone dialog scan | `electron_node/.../tone-module-p1-dialog-fw-scan.json` | 文本源 |
| KenLM corpus v1 | `kenLM/corpus/v1/` | 通用中文句；需过滤后作 carrier，勿直接当 ASR GT |
| AISHELL3 adapters | `tone_module/dataset/adapter_openslr_aishell3.py` | 真人语音；可作对照，非 TTS synthetic 主路径 |
| Golden labels | `lexicon-assets/**/dialog_200_golden_labels.jsonl` | 评测对齐 |

Carrier 句式：仓库**没有**现成 `{TERM}` 槽位模板库。dialog_200 可作口语挖槽种子与 TTS 先例，但须 **ADD** 独立 `carrier_templates_v1`，且 **勿污染** dialog_200 回归黄金集。kenLM 不作对话主载体。

---

## 12. Existing Training Infrastructure

可复用（**治理模式**，非 Tone feature schema）：

| 组件 | 位置 |
|------|------|
| Dataset contract / pipeline | `tone_module/dataset/` |
| Manifest + feature shards | `tone_module/training_io/` |
| GPU trainer / export / metrics | `tone_module/training/gpu/` |
| Speaker holdout split | `training_io/speaker_holdout.py` |
| Engineering freeze docs | `docs/tone-v2/TONE_V2_TRAINING_*`（历史/冻结范式） |

**REUSE**：manifest、version、seed、train/val/test 切分治理、probe/validate/export/report 流程。  
**禁止 REUSE**：Tone mel/CNN feature 合同作为 Model2 输入。

---

## 13. TrainingSample V1 Compatibility

现状（`central_server/scheduler/.../training_sample.rs`）：

* `TrainingSampleKind`：Positive / Negative / HardNegative — **足够表示**
* `TrainingSourceType`：**仅** `RealUserCorrection` — **不足**
* `condition.profile_version_ref`：适合 pseudo profile 引用
* `user_group_key`：适合 pseudo-user disjoint（勿用真实 user_id）
* `available_tone_info`：可空 — 符合 Tone V1.1

**最小 Contract 变更（未来开发，非本轮）**：

1. 扩展 `TrainingSourceType`：`TTS_ASR_SYNTHETIC` / `RULE_SYNTHETIC` / `PUBLIC_CORPUS` / `HUMAN_ANNOTATED`
2. Synthetic metadata 块（见 §14）
3. `correction_event_id` 对 synthetic 改为 optional 或 `source_event_id` 泛化

---

## 14. Required Synthetic Metadata

建议在 TrainingSample metadata（或并列 `synthetic:`）增加：

```text
tts_model_version / voice_id
asr_model_version / asr_service_id
tone_model_version?          # V1.1
corruption_strategy          # none | acoustic_* | rule_text | (future) phoneme_*
pseudo_user_profile_id
pseudo_user_profile_version
source_text_corpus           # dialog_200 | lexicon | kenlm_v1 | ...
generator_version
random_seed
audio_manifest_id            # 可再生引用，非必存 WAV path
```

---

## 15. Synthetic UserProfile Feasibility

UserProfile V1（`phonetic_bias` / `tone_bias` / `personal_terms` / `domain_bias` / ≤32KiB / Top-K）**足以**表达 PseudoUser conditioning。

缺口：

| 缺口 | 说明 |
|------|------|
| 真实纠错难填满 CJK phonetic keys | Synthetic 可直接按 FeatureSchema 采样 bias |
| 模板塌缩 | 见 Q7：组合采样 + holdout |
| 与真实 user_id 隔离 | 强制 `pseudo_*` id；永不进模型 feature |

---

## 16. Pronunciation Corruption Capability Matrix

| Level | 手段 | 当前可行性 | 备注 |
|-------|------|------------|------|
| **A** Text/phonetic controlled | 文本替换 n/l… | **近似 ONLY** | 属 **RULE_SYNTHETIC**；非真实 ASR 误差 |
| **B** TTS pronunciation control | phoneme/SSML/lexicon override | **不支持（公开 API）** | VITS 内部有 phonemizer，但只走正确音 |
| **C** Acoustic perturbation | speed/pitch/noise/reverb/volume | **ADD 可行** | 后处理 WAV；促发真实 ASR 错 |
| **D** Tone corruption | TTS tone / 声学 | **弱** | TTS 无 tone 控制；可用真人语料或 DEFER Tone 路径 |

---

## 17. TTS-ASR Error Generation Architecture

**推荐主路径（V1）**：

```text
GT (+ Lexicon TERM in carrier)
  → PseudoUserProfile (condition metadata only at gen time)
  → Piper TTS (canonical pronunciation)
  → Acoustic perturbation bank (seeded)
  → faster-whisper-vad (PRODUCTION)
  → hyp text (+ words)
  → Align GT↔hyp → spans
  → if error: POSITIVE sample (target=GT span)
  → if no error: NEGATIVE / NO_CHANGE
  → Hard negatives: inject wrong profile terms not in utterance
```

**禁止混同**：

* `RULE_SYNTHETIC`（文本直接替换冒充 ASR）≠ `TTS_ASR_SYNTHETIC`

---

## 18. Positive Sample Strategy

* ASR hyp ≠ GT（span 级）
* target = GT term/span
* condition = PseudoUserProfile ref（可含与错误一致的 phonetic bias，作 conditioning，非标签泄漏到 input feature）
* provenance = `TTS_ASR_SYNTHETIC`

---

## 19. Negative Sample Strategy

* ASR 已正确（hyp≈GT）
* sample_kind = Negative
* 验证 Model2 **不**扩大召回
* 比例建议：与 positive 同量级或更高（防过度召回）

---

## 20. Hard Negative Strategy

* PseudoUserProfile 含高 bias term / phonetic confusion
* 当前 carrier **不含**该 term
* 期望 Model2 **不**召回该 term
* 与 Phase 3 `HardNegative` kind 对齐

---

## 21. Split Strategy

**禁止** sample-level random 8:1:1。

建议 split unit：

| Unit | 用途 |
|------|------|
| `pseudo_user_id` | user-disjoint |
| `target_term` | term-disjoint |
| `(pseudo_user_id × target_term)` | 组合 holdout |
| `domain_tag` | optional domain-disjoint |
| `corruption_strategy` | optional corruption-disjoint |

生成前分配 ID 到 train/val/test buckets（seeded）。可参考 Tone `speaker_holdout` 模式。

---

## 22. Anti-Demo / Generalization Test Strategy

必须能切出：

| Slice | 含义 |
|-------|------|
| Seen profile / Seen term | 上限 |
| Unseen profile / Seen term | profile 泛化 |
| Unseen profile / Unseen term | 最难 |
| Unseen corruption combo | 声学扰动泛化 |
| No-profile baseline | 无条件召回 |
| Wrong-profile stress | 错误 conditioning 不应胡召回 |

---

## 23. Audio Storage Strategy

粗算（16 kHz mono PCM 16-bit ≈ **115 MB/hour**；WAV 略同）：

| 规模 | PCM/WAV | FLAC（估 ~0.5×） |
|------|---------|------------------|
| 1 h | ~0.12 GB | ~0.06 GB |
| 1k h | ~115 GB | ~60 GB |
| 10k h | ~1.2 TB | ~0.6 TB |

**策略**：

* Manifest-driven + `generator_version` + `seed` → **可再生**
* 默认：**临时 WAV → ASR → 删除**；仅保留失败/抽样探针音频
* 长期：FLAC 或仅存 ASR 结果 JSONL
* **禁止**无上限永久存全量 WAV

---

## 24. Dataset Size Proposal（家用 GPU / 节点现实）

| 阶段 | Sentences | Pseudo users | Audio（有效） | Pos:Neg | Term 覆盖 | Corruption |
|------|-----------|--------------|---------------|---------|-----------|------------|
| **Probe** | 200–500 | 10–20 | 0.5–2 h | 1:1 | 50 terms | none + 1 noise |
| **Baseline V1** | 5k–20k | 100–300 | 20–80 h | 1:1–1:2 | 500–2k lexicon | 3–5 acoustic |
| **Full V1** | 50k–200k | 1k–3k | 200–800 h | 1:2 | 5k+ lexicon | 全 bank |

不要首轮冲百万小时。

---

## 25. Batch / Pipeline Performance Strategy

**禁止**默认逐句串行 TTS→ASR→Tone。

建议最简流水线：

```text
Stage1: expand manifests (CPU)
Stage2: TTS workers (GPU/CPU ONNX) → wav queue
Stage3: acoustic perturb workers (CPU)
Stage4: ASR workers → same faster-whisper-vad pool
Stage5: optional Tone batch (V1.1)
Stage6: align + sample emit (CPU)
```

队列可用本地目录/Redis streams；与 Scheduler runtime **隔离**。

---

## 26. Offline Directory / Module Ownership

推荐：

```text
training/model2/
  dataset/          # manifests, generators
  adapters/         # tts_client, asr_client, tone_client
  corruption/       # acoustic only in V1
  export/           # TrainingSample JSONL
  docs/             # generator version notes
```

备选：`tools/model2_dataset/`。  
**不得**放入 `central_server/scheduler` hot path 或 Node production ASR 后处理。

---

## 27. Runtime Non-Impact Verification

审计确认：Synthetic pipeline **设计上**独立于：

* Scheduler runtime / Correction API hot path
* Node Fine Span / Lexicon Exact / Domain Vote / KenLM
* JobResult
* Gateway UserProfile SSOT（仅复用 **schema**，不写生产库）

开发阶段必须保持该隔离。

---

## 28. KEEP / REUSE / MOVE_TO_SHARED / ADD / MODIFY / DELETE_DUPLICATE / DEFER

| 组件 | Action |
|------|---------|
| Piper TTS | **REUSE** batch；**MODIFY**（未来可选）暴露 length_scale — DEFER |
| YourTTS | **DEFER**（speaker diversity 可选） |
| faster-whisper-vad | **REUSE** as ASR SSOT for synthetic |
| asr-sherpa-lm | **KEEP** 生产备选；Synthetic **勿混用** |
| Tone module | **REUSE** offline；**DEFER** Dataset V1 |
| Node pinyin-pro | **REUSE** / **MOVE_TO_SHARED** |
| Piper ChinesePhonemizer | **KEEP** for TTS only；**非** Model2 phonetic SSOT |
| Lexicon domain SSOT | **KEEP** / **REUSE** target terms |
| dialog_200 | **REUSE** carriers + pipeline smoke |
| Tone training_io | **REUSE** governance patterns |
| TrainingSample V1 kinds | **KEEP** |
| TrainingSourceType | **MODIFY**（扩展枚举）— 开发阶段 |
| Acoustic corruption | **ADD** |
| Phoneme-controlled TTS | **DEFER** |
| RULE_SYNTHETIC generator | **ADD** 可选旁路，严格 provenance |
| Runtime Model2 | **DEFER** |
| Duplicate pinyin impl | **DELETE_DUPLICATE** 若出现 |

---

## 29. Target File / Module List（未来开发，非本轮）

```text
training/model2/
  adapters/piper_tts_client.py
  adapters/faster_whisper_client.py
  adapters/tone_client.py          # V1.1
  corruption/acoustic.py
  generate_manifest.py
  expand_carriers.py
  run_pipeline.py
  export_training_samples.py
  splits/holdout.py
central_server/.../training_sample.rs   # source_type + synthetic metadata (later)
shared phonetic utility               # later extract
```

---

## 30. Risks

1. **TTS 过干净** → ASR 错误率偏低 → positive 不足（靠 perturbation / 难词 term）
2. **RULE_SYNTHETIC 污染** 若 provenance 混乱
3. **Profile 模板记忆**（见 Q7）
4. **WAV 存储爆炸**
5. **CJK phonetic 双实现漂移**（Node vs Python）
6. **换 ASR 模型**导致与线上分布不一致
7. Tone 时间戳缺失导致 V1.1 失败（需 word timestamps 门禁）

---

## 31. Development Preconditions

1. 锁定 ASR service id + model version 写入 manifest  
2. 锁定 Piper voice + generator_version  
3. Lexicon export 只读视图（terms + domain tags）  
4. TrainingSample Contract 最小扩展设计评审  
5. Probe 200 条端到端（dialog_200 风格）通过后再 Baseline  
6. 明确不触碰冻结 Node ASR 后处理主链  

---

## 32. Recommended Phase 4 Development Sequence

1. **Contract**：扩展 TrainingSourceType + synthetic metadata  
2. **Probe pipeline**：Piper → ASR → align → JSONL（无 Tone）  
3. **Acoustic corruption bank** + seed  
4. **PseudoUser + split holdout**  
5. **Baseline dataset** + anti-demo slices  
6. **V1.1 Tone** optional stage  
7. **（远期）** pronunciation-controlled TTS 研究 — 不阻塞 V1  

---

## 33. Acceptance Checklist（本审计）

| 项 | 状态 |
|----|------|
| TTS/ASR/Tone/Pinyin/Lexicon/Corpus/Training 已定位 | **PASS** |
| Q1–Q8 明确回答 | **PASS**（见下） |
| 不假设 TTS 能造音素错误 | **PASS** |
| 强调 REAL ASR 路径 | **PASS** |
| Tone MUST/OPTIONAL/DEFER | **PASS** |
| Runtime 隔离建议 | **PASS** |
| 未改代码/配置/模型/训练集/既有 SSOT | **PASS** |

---

## Special Questions (Q1–Q8)

### Q1 — TTS 能否真正制造 n/l、前后鼻音、翘舌和 tone confusion？

**不能。** 公开 `TtsRequest` 仅 text/voice/language；ChinesePhonemizer 只服务**正确**合成。内部 `length_scale/noise_scale` 未对训练暴露为发音错误控制。

### Q2 — 最小可行替代？

1. **主路径**：正常 TTS + **acoustic perturbation** + **生产 ASR** → 真实 hyp 误差  
2. **旁路**：`RULE_SYNTHETIC` 文本替换（严格分 provenance）  
3. **远期**：研究 VITS phoneme override（独立实验，非 V1 门槛）

### Q3 — 是否应先正常 TTS + perturbation + 真实 ASR，再加 pronunciation-controlled？

**是。** 与 dialog_200 既有成功路径一致；pronunciation-controlled 为增量。

### Q4 — 真实 ASR offline batch？

**可复用生产 `faster-whisper-vad`**；建议独立 HTTP adapter，**禁止**换另一 ASR 做主数据集。

### Q5 — CJK pinyin 复用谁？

**Node `lexicon/phonetic/pinyin.ts` + `pinyin-pro`。** 建议 MOVE_TO_SHARED；Dataset 可用对齐的 Python，单测对齐。不要用 Piper phonemizer 当 FeatureSchema。

### Q6 — Tone 进 V1 还是 V1.1？

**V1.1（OPTIONAL）**。V1 以 ASR 文本误差为主；有 word timestamps 后再挂 Tone。

### Q7 — Synthetic UserProfile 如何避免模板记忆？

* 大笛卡尔积中 **稀疏随机采样** bias 组合（seeded）  
* personal_terms 从 lexicon **holdout 池**抽取  
* 强制 **unseen profile / unseen term** 评测切片  
* 限制单模板重复次数；记录 `pseudo_user_profile_version`  
* 模型输入禁止 raw user/pseudo id  

### Q8 — 如何保证 unseen user + unseen term + unseen profile combination 可评估？

生成前按 `pseudo_user_id` 与 `target_term` **预分配** train/val/test；维护 `(user×term)` 组合矩阵；导出 anti-demo manifests；评测只跑对应 slice — **禁止**事后随机打乱掩盖泄漏。

---

## Final Verdict

**READY_WITH_GAPS**

可进入 Phase 4 开发的最小闭环已存在（Piper + dialog_200 经验 + faster-whisper-vad + Lexicon SSOT + Tone 训练治理范式）。  
必须承认的缺口：TTS 无音素级发音错误控制、TrainingSample source_type/synthetic metadata 待扩展、CJK phonetic shared utility 待抽取、Tone 宜 V1.1。
