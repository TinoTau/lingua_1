# Lingua Model2 Phase 4 — Synthetic / TTS Probe Pipeline Development Report

| Field | Value |
|-------|-------|
| Date | 2026-08-12 |
| Nature | **Probe Pipeline Development** (offline) |
| Dataset | `model2-synth-probe-v1` |
| Generator | `model2-synth-generator-v1` |
| Based on | `Lingua_Model2_Phase4_Synthetic_TTS_Dataset_PreDevelopment_Audit_2026_08_12.md` |
| Verdict | **PASS** |

本轮未训练 Model2，未改 Node Runtime ASR/纠错链，未导出 ONNX。

---

## 1. Executive Summary

已建立并真实跑通最小闭环：

```text
probe_plan.jsonl (split 已分配)
  → Piper TTS (zh_CN-huayan-medium @5009)
  → resample 22.05k→16k
  → AcousticCorruption (NONE/SPEED/VOLUME/NOISE/REVERB)
  → faster-whisper-vad (medium / int8_float16 @6007)
  → GT↔Hyp align (Phase3 codepoint 语义)
  → TrainingSample V1 (TTS_ASR_SYNTHETIC)
```

**320/320** planned utterances：TTS/ASR/align 成功率 **100%**；POSITIVE **327**（真实 ASR error）；NEGATIVE **118**；HARD_NEGATIVE **320**；positive yield gate **OK**。

---

## 2. Audit Preconditions Verification

| 审计项 | 状态 |
|--------|------|
| Piper 生产服务可复用 | VERIFIED（port 5009） |
| ASR 必须锁定生产 faster-whisper-vad | VERIFIED（health `asr_model_path`） |
| 无 pronunciation-controlled TTS | 遵守 |
| Tone DEFER | `tone_stage=NOT_RUN` |
| Offline `training/model2/` | 已建 |
| TrainingSample 需扩展 source_type | 已扩展 |
| 词库 v3 domain SSOT | 只读 export |
| 独立 carrier templates | ADD `carrier_templates_v1` |

---

## 3. Offline Architecture

```text
training/model2/
  adapters/     piper_tts_client.py, faster_whisper_client.py
  corruption/   bank.py
  phonetic/     syllables.py + Node pinyin-pro bridge
  alignment/    align.py
  corpus/       carrier_templates_v1.jsonl, lexicon_export.py
  splits/       assign.py
  export/       training_sample.py, sample_builder.py
  pseudo_user/  factory.py
  scripts/      build_probe_plan.py, run_probe_pipeline.py
  tests/        test_probe_pipeline.py
  dataset/probe_v1/   plans / results / samples / metrics
```

禁止路径：Scheduler hot path、Gateway、Node Fine Span / JobResult。

---

## 4. TrainingSample Contract Changes

Scheduler `TrainingSourceType` 扩展（`SCREAMING_SNAKE_CASE`）：

* `REAL_USER_CORRECTION`（既有）
* `TTS_ASR_SYNTHETIC`
* `RULE_SYNTHETIC`
* `PUBLIC_CORPUS`
* `HUMAN_ANNOTATED`

Python mirror：`training/model2/export/training_sample.py`。  
本轮实际产出以 `TTS_ASR_SYNTHETIC` 为主，另含 1 条隔离 `RULE_SYNTHETIC` smoke。

---

## 5. Synthetic Metadata V1

字段覆盖：generator/source_type/corpus、TTS/ASR id+model+hash/compute、corruption、seed、audio_manifest_id、pseudo_user_group_id、target_term、domain_tags、`tone_stage=NOT_RUN`、`phonetic_profile_not_acoustically_realized=true`。

禁止伪造 `tone_model_version`。

---

## 6. Actual TTS Configuration

| Key | Locked value |
|-----|----------------|
| service_id | `piper-tts` |
| version | `1.0.0` |
| port | **5009** |
| voice | `zh_CN-huayan-medium` |
| model path | `.../zh_CN-huayan-medium.onnx` |
| model sha256 | `9929917bf8cabb26fd528ea44d3a6699c11e87317a14765312420be230be0f3d` |
| native SR | **22050**（合成后重采样至 16k） |

无 YourTTS fallback。

---

## 7. Actual ASR Configuration

从 `/health` **实测锁定**（非文档臆测）：

| Key | Locked value |
|-----|----------------|
| service_id | `faster-whisper-vad` |
| version | `2.0.0` |
| port | **6007** |
| model | `faster-whisper-medium` |
| path | `.../models/faster-whisper-medium` |
| compute_type | `int8_float16` |
| device | `cuda` |
| language | `zh` |
| beam (service.json) | `1` |

**环境备注：** 本机 Silero VAD CUDA EP 因 `cudnnGetLibConfig` 崩溃；启动使用既有测试开关 `TONE_P10_VAD_CPU=1`（仅 VAD 走 CPU）。**Whisper ASR 仍为生产 medium @ CUDA**，未换 Sherpa/云 ASR。

---

## 8. Model / Artifact Version Lock

写入 `dataset/probe_v1/service_lock.json` + `probe_metrics.json`：TTS onnx hash、ASR path/compute、generator/phonetic/corruption 版本。

---

## 9. Phonetic SSOT Implementation

方案：**B + Node bridge**

* 优先 lexicon `pinyin_key`
* 否则调用 `phonetic/node_syllables_cli.mjs`（`pinyin-pro`，与 Node `lexicon/phonetic` 同源）
* pypinyin 仅 fallback，不宣称为 runtime SSOT

Golden：`golden_fixtures.json`；Node bridge 下 agreement **100%**（18 unit tests OK）。

---

## 10. Carrier Corpus V1

`training/model2/corpus/carrier_templates_v1.jsonl` — **20** 模板（含主语/宾语位与 1 条无 `{TERM}` 背景句）。  
**未修改** dialog_200 golden。

---

## 11. Lexicon Target Export

只读 `node_runtime/lexicon/v3/lexicon.sqlite`：

* `lexicon_domain_terms.jsonl`（50 terms for probe）
* `lexicon_base_background.jsonl`
* manifest bundleVersion **12** / checksum 已记入 plan meta

未新建 Model2 vocabulary SSOT。

---

## 12. Acoustic Corruption Bank

`acoustic-corruption-v1`：NONE / SPEED / VOLUME / NOISE / REVERB（+可选 PITCH）。  
Seeded、分档、可复现。Metadata 明确：**不可解释为 n/l、zh/z、tone 等发音习惯。**

---

## 13. Manifest Format

* `probe_plan.jsonl` — 生成前 SSOT（含 split）
* `probe_results.jsonl` — GT/hyp/align/status
* `training_samples.jsonl` — TrainingSample V1
* `probe_plan_meta.json` / `probe_metrics.json` / `service_lock.json`

---

## 14. Deterministic Sample Identity

`sample_plan_id = sha256(sorted plan fields)[:20]`；`sample_id` 同理哈希，**非随机 UUID**。

---

## 15. Pseudo User Semantics

16 groups：`personal_terms` + `domain_bias`；`phonetic_bias/tone_bias` 空；`phonetic_profile_not_acoustically_realized=true`。  
用于 split / hard-negative，**不**声称 TTS 声学实现了口音 bias。

---

## 16. Split Strategy

生成前：

* **user-disjoint**（硬门禁）
* **term-disjoint pairing**（仅 user_split==term_split 才组句）
* **user×term combo holdout** 审计

Probe meta：`user_leaks=[]`，`term_overlap_train_*=[]`。  
比例偏 train（16 users × 8:1:1 → val/test 各 5 plans）— Probe 验证逻辑即可；Baseline 再调用户数/比例。

---

## 17–19. Sample Builders

| Kind | 规则 |
|------|------|
| POSITIVE | hyp≠GT 且 align 得有效 span；source_type=`TTS_ASR_SYNTHETIC` |
| NEGATIVE | exact 或核心 term 正确 → `NO_CHANGE` |
| HARD_NEGATIVE | utterance 不含 personal term → `NO_MATCH` |

禁止把正确样本改成 TTS_ASR positive。

---

## 20. RULE_SYNTHETIC Boundary

1 条 smoke（兰宁→南宁）独立 `source_type=RULE_SYNTHETIC`，不计入 TTS_ASR 统计混同。

---

## 21. Tone Deferred Verification

全样本 `available_tone_info=null`，`tone_stage=NOT_RUN`。未跑 Tone pipeline。

---

## 22. Audio Lifecycle

成功：删 `tmp_audio`（跑后目录空）。  
保留：`qa_audio` 每 40 条 1 个（本轮 8）；失败可留 `failed_audio`（本轮 0）。

---

## 23–27. Probe Statistics

| Metric | Value |
|--------|-------|
| planned | 320 |
| TTS success | 100% |
| ASR success | 100% |
| align success | 100% |
| ASR exact-match | 21.6% |
| ASR error rate | 78.4% |
| POSITIVE | 327 |
| NEGATIVE | 118 |
| HARD_NEGATIVE | 320 |
| positive yield | **OK**（>5% / 绝对量充足） |
| wall time | ~366 s |
| TTS latency avg | ~302 ms |
| ASR latency avg | ~692 ms |
| tmp peak | ~216 KB |

Corruption error rates（utterance-level）：NOISE 0.86 / SPEED 0.85 / REVERB 0.78 / VOLUME 0.76 / NONE 0.65。

---

## 28. Term Coverage

50 domain terms；错误 top：中杯、机场、一日游、半日游、忌口、收银、无烟房、碱水包等。

---

## 29. Split Leakage Audit

`user_leaks=[]`；train∩val / train∩test **term overlap 空**；combo overlap 空。

---

## 30. Phonetic Agreement Test

Node bridge vs golden fixtures：**PASS (100%)**。

---

## 31. Runtime Non-Impact Verification

| Area | Change? |
|------|---------|
| Node Fine Span / Lexicon Recall / Domain Vote / KenLM / JobResult | **No** |
| Gateway UserProfile runtime | **No** |
| Scheduler Correction hot path / Normalizer | **No**（仅 enum 扩展） |
| dialog_200 | **No** |

---

## 32. Modified File Inventory

* `central_server/scheduler/src/services/correction/training_sample.rs` — `TrainingSourceType` 扩展 + 序列化测试

---

## 33. Added File Inventory

* `training/model2/**`（adapters / corruption / phonetic / alignment / corpus / splits / export / scripts / tests / dataset outputs）
* 本报告

---

## 34–35. Tests

`python -m unittest training.model2.tests.test_probe_pipeline` → **18 OK**  
`cargo test --lib services::correction::training_sample` → **4 OK**

覆盖：contract、manifest、TTS/ASR adapter 失败路径、corruption 确定性、alignment、sample kinds、split leakage、phonetic golden、tmp cleanup。

---

## 36. Real Probe E2E Results

**PASS** — 非 mock。产物：

* `training/model2/dataset/probe_v1/probe_plan.jsonl`
* `probe_results.jsonl`
* `training_samples.jsonl`
* `probe_metrics.json`
* `service_lock.json`

---

## 37–38. Performance / Disk

见 §23；临时 WAV 峰值低；QA 仅 8 个文件。

---

## 39. KEEP / MODIFY / ADD / DELETE / DEFER

| Action | Item |
|--------|------|
| KEEP | Piper/FW 生产服务；lexicon v3；TrainingSample 四段结构 |
| MODIFY | `TrainingSourceType` enum |
| ADD | `training/model2/` 全套 Probe 管线 |
| DELETE | （无） |
| DEFER | Tone enrichment；phoneme TTS；Baseline 大规模；Model2 train；发音条件化 conditioning |

---

## 40. Known Deferred Items

1. Tone V1.1（word timestamps → offline Tone）
2. Pronunciation-controlled / user-conditioned acoustic realization
3. Baseline Dataset 扩容与 8:1:1 统计稳定 split
4. CJK phonetic 抽到真正 shared package（现已 Node bridge）
5. 本机 VAD CUDA EP cuDNN 符号问题（环境）

---

## 41. Risks

* Piper 22.05k 与 ASR 16k 必须 resample（已修）
* 高 ASR error rate 含标点/口语变体 → 后续可加规范化再计 exact
* POS:NEG ≠ 1:1（真实 error 驱动）；Baseline 可调 corruption/词难度
* 伪用户 phonetic_bias 若误用为监督信号会污染 conditioning

---

## 42. Baseline Dataset Preconditions

进入 Baseline 扩容前确认：

1. Probe PASS（本轮满足）
2. service_lock 可复现
3. positive yield 可持续（本轮 OK）
4. user/term leakage 门禁保持
5. 解决或固化记录 VAD CUDA 环境问题
6. 仍禁止 Node runtime 接入与 Model2 训练直至独立 Phase

---

## 43. Acceptance Checklist

| Criterion | Result |
|-----------|--------|
| production Piper used | ✅ |
| TTS model/voice recorded | ✅ |
| production faster-whisper-vad used | ✅ |
| ASR model/config recorded from health | ✅ |
| no ASR fallback | ✅ |
| TTS_ASR_SYNTHETIC provenance | ✅ |
| RULE_SYNTHETIC isolated | ✅ |
| no fake pronunciation claim | ✅ |
| no fake tone | ✅ |
| CJK phonetic aligned to Node | ✅ |
| manifest deterministic | ✅ |
| sample identity deterministic | ✅ |
| split before generation | ✅ |
| user / term leakage tests | ✅ |
| positives from real ASR errors | ✅ |
| negatives retained | ✅ |
| hard-negative contract | ✅ |
| temp WAV cleanup | ✅ |
| real Probe E2E | ✅ |
| Node runtime unchanged | ✅ |
| no Model2 training | ✅ |

**Final verdict: PASS**
