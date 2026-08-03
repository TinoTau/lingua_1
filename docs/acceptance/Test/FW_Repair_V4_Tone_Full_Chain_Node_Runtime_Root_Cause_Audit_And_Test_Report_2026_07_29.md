<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Test/FW_Repair_V4_Tone_Full_Chain_Node_Runtime_Root_Cause_Audit_And_Test_Report_2026_07_29.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Tone Full-Chain Node Runtime Root Cause Audit And Test Report

| Field | Value |
|-------|-------|
| Date | 2026-07-29 |
| Stage | Node Runtime Audit · Live Replay · Root-Cause Isolation |
| Nature | 代码只读审计 + 真实节点/FW 运行；临时诊断探针；**未改 Decision / Candidate / Recall 业务逻辑** |
| Corpus | dialog_200 真实 wav × 20（含 cafe/meeting 等场景） |
| Evidence dir | `docs/tone-v2/_audit_scratch/tone_full_chain_runtime_2026_07_29/` |

---

## 1. Executive Summary

**Tone 模型本身正常。** 冻结 CNN V2 candidate 在真实音频上 20/20 成功产出 `AcousticToneSlice`（490 slices，posterior 合法，无 model_error）。

**当前 Mandatory Tone Recall 运行可用性不足的主因不是模型坏了，而是对齐层：**

1. **TONE_SLICE_GRAIN（主因）**：Tone 按 **ASR word token** 产出 1 个 slice；Pattern 门控要求 `overlapSlices.length === (rawEnd-rawStart)`（字符跨度）。多字 token（如 `你好,`）→ 1 slice 对 2–3 chars → 系统性 `no_pattern`。
2. **WORD_TIME_SPAN（次因，局部）**：个别句（d002）HTTP `segments.words=[]`，但 Tone 仍有 16 slices → WordTimeSpan=0 → 全窗 `no_window_time_range`。
3. **DATA_ARCHIVAL**：离线 dialog200 batch JSON 只存 Tone 摘要，不存 slices/WordTimeSpans。
4. **CONFIGURATION / 源码缺口**：仓库缺 `loader_v1.py` / `feature_v2.py` 源文件；Electron `servicePreferences.faster-whisper-vad=false` 导致经 Node pipeline 报 “No available ASR service”。本轮经恢复源码 + FW `/utterance` 直连完成实测。

**禁止恢复 Plain。** 修复方向仅限 timestamp / WordTimeSpan / window↔grain / 归档 / 源码完整性。

---

## 2. Final Verdict

```text
TONE FULL-CHAIN NODE RUNTIME INVESTIGATION

NODE STARTUP:
PASS

TONE MODEL LOAD:
PASS

TONE MODEL OUTPUT:
HEALTHY

ASR WORD TIMESTAMPS:
DEGRADED

WORD TIME SPAN MAPPING:
DEGRADED

TONE SLICE / TOKEN GRAIN:
MISMATCHED

WINDOW COORDINATE MAPPING:
HEALTHY

PATTERN EXTRACTION:
DEGRADED

TONE READINESS RATE:
76.76%

TONE SQL EXECUTION:
PASS

TONE CANDIDATE HIT RATE:
(lattice) candidates=171 over ready windows path; see §15–17

LEXICAL COMPLETE PATH RATE:
0% (lexical-only); retained complete paths via fallback = 26/20 utterances have paths

ONLINE RUNTIME DATA:
COMPLETE (FW /utterance direct)

OFFLINE ARCHIVE DATA:
INCOMPLETE

PRIMARY ROOT CAUSE:
MULTIPLE

TONE CODE REPAIR REQUIRED:
NO

ALIGNMENT CODE REPAIR REQUIRED:
YES

DATA ARCHIVE REPAIR REQUIRED:
YES

BATCH 1.1C CLOSURE:
CONDITIONAL

READY FOR NEXT BATCH:
NO
```

---

## 3. Test Environment

| Item | Value |
|------|-------|
| OS | Windows 10 |
| FW | `faster_whisper_vad_service.py` · port **6007** · CUDA ASR · `TONE_P10_VAD_CPU=1` |
| Tone artifact | `tone_module/models/candidate/tone_cnn_production_v2_candidate_20260712.npz` |
| SHA256 | `AADE7B531049204FD7E8601944B3A3429BD3EC16015C550E2C6B3FD27B368723` |
| Size | 1,274,461 bytes |
| Backend | `numpy_p1` · architecture `conv1d_production_v2` · `ToneModelWeightsV2` |
| Electron | `:5020` test server **PASS**；但 `servicePreferences.faster-whisper-vad=false` → pipeline ASR 不可用 |
| 实测入口 | **FW `POST /utterance` 直连**（绕过 Electron ASR preference） |
| Lexicon lattice | Electron ABI + `node_runtime/lexicon/v3` Phase1/2 harness |

---

## 4. Node Startup

| Check | Result |
|-------|--------|
| Electron process + `:5020/health` | **PASS**（`ok`） |
| LexiconRuntimeV2 startup | **PASS**（tables loaded） |
| `toneTimestampOnlyEnabled` default | **true**（fw-config） |
| Electron → ASR | **FAIL** — preference `faster-whisper-vad: false` → `No available ASR service` |
| FW `:6007` 独立启动 | **PASS**（utterance_ready=true） |

结论：节点端可启动；**完整 Electron ASR 链路被配置关闭**。Tone 全链证据改由 FW 直连 + Node 分析/harness 完成。

---

## 5. Models and Runtime Assets

| Asset | Path / Note |
|-------|-------------|
| Freeze model | `.../candidate/tone_cnn_production_v2_candidate_20260712.npz` |
| Default config path | `tone_cnn_p1_v1_full.npz`（本轮用 env 覆盖为 freeze candidate） |
| Loader | `ToneModelLoaderV1` · ready=true · loadMs≈24 |
| 阻塞缺口 | 仓库曾缺 `loader_v1.py`、`feature_v2.py`（仅 `__pycache__`）；本轮为启动恢复源码/shim（**非 Decision 变更**） |

---

## 6. Production Call Graph

| Step | File | Function | Caller | In | Out | Unit / Axis | Fail | Diag | Owner |
|------|------|----------|--------|----|-----|-------------|------|------|-------|
| 1 | audio wav | PCM 16k mono | FW | bytes | processed_audio | samples | no_audio | — | Pipeline |
| 2 | `inference.py` | `run_tone_inference` | `api_routes` | audio+words | AcousticToneSlice[] | **sec, ASR-word-relative** | non_zh / no_timestamps / model_error / short | sliceCount | ToneModule |
| 3 | `asr-step.ts` | `offsetAcousticSlices` | Node pipeline | slices+offset | ctx slices | utterance-global sec | — | — | Node ASR |
| 4 | ASR segments | words[].start/end | FW | — | timestamps | **batch-relative sec** | missing words | — | ASR |
| 5 | `tone-time-align.ts` | `buildWordTimeSpans` | V4 orch | raw+words | WordTimeSpan[] | UTF-16 + sec | indexOf miss | wordTimeSpanCount | Align |
| 6 | same | `charRangeToWindowTime` | pattern | raw range | WindowTimeRange | sec | no covering span | — | Align |
| 7 | same | `selectSlicesByTimeOverlap` | pattern | slices+window | overlap[] | sec overlap | — | — | Align |
| 8 | same | `extractAcousticTonePatternByTime` | recall | … | pattern\|null | **requires len==rawEnd-rawStart** | mismatch | — | Align |
| 9 | `tone-recall-readiness.ts` | `resolveToneRecallReadiness` | collectors | pattern+flags | ready\|skip | — | no_pattern… | tone_* | Recall SSOT |
| 10 | LexiconRuntimeV2 | tone SQL | collectors | tonePinyinKey | rows | — | empty | — | Runtime |
| 11–12 | Edge/Path harness | buildLexicalEdges / enumerate | Phase1/2 | candidates | edges/paths | — | empty→fallback | — | Lattice |

**Tone 来源确认：** 原始音频 + ASR word 时间窗特征；**不是** ASR 文本猜调、词库猜调、拼音补调。

---

## 7. ToneModule Audit

| Q | Answer |
|---|--------|
| 1 输入来自原始音频？ | **Yes** — `processed_audio` + word timestamps |
| 2 采样率/通道？ | 16k PCM；特征 `feature_v2` |
| 3 重复 resample？ | 特征侧 duration-normalized；未见二次业务 resample |
| 4 window 来自 word timestamp？ | **Yes** |
| 5 每音节一个 slice？ | **否 — 每 ASR word token 一个 slice** |
| 6 跳过？ | dur < 0.02s；`extract_feature` ValueError |
| 7 non_zh？ | lang 空/auto 或非 `zh*` |
| 8 short slice 频率 | 本轮 20 句未单独计数；MIN=0.02s |
| 9 异常吞掉？ | 单词 feature 失败 continue；classifier 未 ready → model_error |
| 10 posterior t1–t5？ | **Yes**（实测 invalid_posterior=0） |
| 11 tone0/neutral？ | 无；argmax 1–5 @ Node |
| 12 argmax 越界？ | 否（本轮 invalid_tone=0） |
| 13 模型失败仍跑？ | Tone disabled；ASR 继续 |
| 14 GPU/CPU 同模型？ | 推理 numpy CPU；训练曾 CUDA；artifact 同一 npz |
| 15 是否冻结模型？ | **本轮 env 加载 freeze candidate**（hash 匹配） |

### ToneModule metrics（20 wav）

| Metric | Value |
|--------|------:|
| audio_count | 20 |
| tone_inference_success_count | 20 |
| tone_inference_failure_count | 0 |
| total_tone_slice_count | 490 |
| avg_tone_slices_per_utterance | 24.5 |
| invalid_posterior_count | 0 |
| model_error_count | 0 |

**Tone Model Verdict: HEALTHY**

---

## 8. ASR Timestamp Audit

| Metric | Value |
|--------|------:|
| asr_word_count | 474 |
| asr_word_timestamp_valid_rate | **100%**（有 words 的句） |
| 坐标系 | word.start/end：**segment/batch-relative 秒**；Tone slice 同轴 |

**异常：** d002 `segments.words=[]`，但 `acousticToneSlices.length=16`（推理时有词时间；响应段词表被清空/未返回）。

**Timestamp Verdict: DEGRADED**（多数健康，存在响应 words 丢失）

---

## 9. WordTimeSpan Audit

| Metric | Value |
|--------|------:|
| word_time_span_build_rate | **100%**（相对有效 ASR words） |
| skipped_word_rate | 0% |
| multi_char_token_count | **55 / 474**（11.6%） |
| d002 spans | **0**（words 空） |

`buildWordTimeSpans` 使用顺序 `indexOf`；多字 token 的 `rawEnd-rawStart` = token UTF-16 长度。

**WordTimeSpan Verdict: DEGRADED**

---

## 10. Tone Slice Grain Audit

**证据（d001）：**

| ASR word | raw range | charLen | Tone slice |
|----------|-----------|--------:|------------|
| `你好,` | [0,3] | 3 | 1 slice @ [0,0.44] tone=2 |
| `我想` | [3,5] | 2 | 1 slice |
| `点` | [5,6] | 1 | 1 slice |

**结论：一个多字 ASR token 只产生一个 Tone slice。**  
因此 `overlapSlices.length === rawEnd-rawStart` **结构性失败**（见失败样例 `你好`：overlap=1 ≠ charSpan=2）。

**Grain Verdict: MISMATCHED**

---

## 11. Window Coordinate Audit

使用生产同构 `buildLexicalWindowQueries`（syllableStart/End + rawStart/End）。

| Metric | Value |
|--------|------:|
| char_eq_syl_rate | 89.34% |
| window_time_range_success_rate | **97.13%** |

窗口坐标映射整体健康；失败主要来自 grain / 缺 spans，不是 syllable 坐标本身算错。

**Window Coordinate Verdict: HEALTHY**

---

## 12. Pattern Extraction Audit

| Metric | Value |
|--------|------:|
| pattern_length_match_rate (vs char = code gate) | **76.76%** |
| pattern_length_match_rate (vs syllable) | **84.92%** |
| tone_pattern_valid_rate | 76.76% |

按长度：L1 96.97% → L5 58.26%（多字 token 累积导致越长越差）。

**不得在本轮修改 `rawEnd-rawStart`。** 建议后续 Contract Change：明确 pattern 计数应对齐 **ASR-token 切片数** 或 **syllable 数**，并同步 Tone 切片粒度。

**Pattern Verdict: DEGRADED**

---

## 13. Readiness Audit

| State | Count |
|-------|------:|
| ready | 1873 |
| no_pattern | 567 |
| invalid_pattern | 0 |
| caller_disabled | 0 |
| runtime_unsupported | 0 |
| **tone_readiness_rate** | **76.76%** |

Decision Owner 仍唯一：`resolveToneRecallReadiness`。

Gate B（≥95% / ≥90%）：**FAIL**

---

## 14. Tone SQL Audit

Phase1 harness（`toneTimestampOnlyEnabled=true` + 真实 slices/spans）：

| Metric | Value |
|--------|------:|
| physical SQL statements（合计路径） | 有执行（cacheMiss>0） |
| Plain SQL from Mandatory Tone | **0**（1.1C Fail Closed 保持） |
| candidates（20 句合计） | **171** |

**Tone SQL Verdict: PASS（执行）；命中受 readiness 限制**

---

## 15–17. Candidate / Edge / Path Results

| Metric | Count | Rate |
|--------|------:|-----:|
| candidates | 171 | — |
| lexical_edges | 107 | — |
| fallback_edges | 405 | — |
| retained_complete_paths | 26 | — |
| utterances_requiring_fallback | 20/20 | **100%** |
| utterances_without_complete_path | 0 | 0% |
| lexical_complete_path (no fallback inject) | 0 | **0%** |

主瓶颈分类：**Tone Coverage / Alignment（grain）→ Lexicon 命中不足叠加**，不是“模型无输出”。

---

## 18. Online vs Offline Archive

| Field | Online FW `/utterance` | Offline dialog200 batch JSON |
|-------|------------------------|------------------------------|
| ASR words start/end | **Yes**（多数句） | 通常 **No** |
| AcousticToneSlices + posterior | **Yes 完整** | **No**（仅 `sliceCount` 摘要） |
| WordTimeSpans | Node 侧可重建 | **No** |
| 结论 | 运行时可完整 | **归档缺口** |

→ 先前 Closure 审计的 “INCOMPLETE data” **主要是归档问题**；在线 Tone **可以生成**。

---

## 19. Length1–5 Metrics

| Length | Windows | Ready | No Pattern | Readiness Rate | overlap==char | overlap==syl |
| ------ | ------: | ----: | ---------: | -------------: | ------------: | -----------: |
| 1 | 528 | 512 | 16 | **96.97%** | 96.97% | 96.97% |
| 2 | 508 | 426 | 82 | 83.86% | 83.86% | 89.17% |
| 3 | 488 | 365 | 123 | 74.80% | 74.80% | 83.20% |
| 4 | 468 | 309 | 159 | 66.03% | 66.03% | 78.63% |
| 5 | 448 | 261 | 187 | 58.26% | 58.26% | 74.33% |
| **All** | **2440** | **1873** | **567** | **76.76%** | **76.76%** | **84.92%** |

---

## 20. Failure Samples

### Sample A — Grain mismatch（主因）

| Field | Value |
|-------|-------|
| utterance | d001 |
| window | `你好` |
| rawStart/End | 0/2 |
| sylStart/End | 0/2 |
| overlapSliceCount | **1** |
| covering | word=`你好,` charLen=3，单 slice |
| readiness | no_pattern |
| owner | **Tone slice grain / Pattern gate** |

### Sample B — Response words 丢失

| Field | Value |
|-------|-------|
| utterance | d002 |
| tone slices | 16 |
| segments.words | **[]** |
| WordTimeSpan | 0 |
| readiness | 全窗 no_window_time_range |
| owner | **ASR response / WordTimeSpan** |

---

## 21. Root Cause Isolation

**PRIMARY: MULTIPLE**（并列，按影响排序）

| # | Class | Evidence |
|---|-------|----------|
| 1 | **TONE_SLICE_GRAIN** | 多字 token→1 slice；gate 用 char span；L1 高、L5 低 |
| 2 | **WORD_TIME_SPAN** | d002 words 空导致 70 窗全灭 |
| 3 | **DATA_ARCHIVAL** | 离线包无 slices/spans |
| 4 | **CONFIGURATION** | Electron ASR preference false；缺 loader/feature 源码曾阻启动 |

**不是：** Tone 模型损坏、Runtime unsupported、caller_disabled。

---

## 22. Tone Model Verdict

**HEALTHY** — 冻结 CNN V2 真实加载并产出合法 posterior。

## 23. Timestamp Verdict

**DEGRADED** — 多数 100% 有效；存在响应 words 丢失。

## 24. Alignment Verdict

**BROKEN at Pattern grain contract** — Window 坐标健康；Pattern 字符计数与 token-slice 粒度不一致。

## 25. Lexicon Verdict

Tone SQL 可执行；在 Fail Closed + 76.76% readiness 下仍有 171 candidates / 107 edges；lexical-only 完整 path=0，连通依赖 fallback edges。**非本轮主责。**

## 26. Data Archive Verdict

**INCOMPLETE** — 必须补归档；否则离线 Coverage Acceptance 永远假阴性。

---

## 27. Blocking Issues

1. Pattern gate `rawEnd-rawStart` vs ASR-token slice 粒度不一致 → readiness <90%。  
2. 部分 utterance 响应缺 `words[]` 但有 Tone slices。  
3. 离线归档缺配对字段。  
4. Electron `faster-whisper-vad` preference 关闭 → 无法经 Node pipeline 一键跑。  
5. 仓库 Tone 源码缺口（loader_v1 / feature_v2）— 已临时恢复，需正式入库。

## 28. Non-Blocking Issues

1. VAD 需 `TONE_P10_VAD_CPU=1`（本机 cuDNN EP 不稳定）。  
2. 兼容诊断字段 `plainFallbackHitCount`（恒 0）命名债务。  
3. Phase2 harness 未转发 `toneTimestampOnlyEnabled`（Phase1 已正确传入）。

---

## 29. Proposed Repair Scope（本轮不实施）

| Change | Scope | Note |
|--------|-------|------|
| Contract：Pattern 计数对齐 token-slice 或改为 syllable 并对齐切片粒度 | Alignment | **需正式 Contract Change**；禁止静默改 |
| 保证 `/utterance` 返回与 Tone 推理一致的 words[] | ASR/FW | 修复 d002 类 |
| E2E/dialog 持久化 slices+words+offsets | Archive | 解除离线假阴性 |
| 正式提交 `loader_v1.py` / `feature_v2.py` | Repo integrity | 环境阻塞 |
| 打开 Electron ASR preference 或文档化直连 FW 验收 | Config | 可测性 |

**禁止：** 恢复 Plain、underfill Plain、ASR 文本反推 Tone、LLM 猜调、插值填 Tone。

---

## 30. Target List

```text
[x] 审计 ToneModule 真实模型加载
[x] 审计 Tone 预处理和输出
[x] 审计 ASR word timestamp
[x] 审计 segment offset / 时间轴
[x] 审计 WordTimeSpan
[x] 审计 Tone slice 粒度
[x] 审计 raw/syllable 坐标
[x] 启动真实节点端（Electron :5020）
[x] 使用真实音频运行（FW /utterance ×20）
[x] 保存完整运行证据
[x] 输出 length1–5 覆盖率
[x] 输出 readiness 指标
[x] 输出 Candidate/Edge/Path 指标
[x] 对比在线数据与离线归档
[x] 隔离主要根因
[x] 判断是否需要修 Tone / Alignment / 归档
[x] 输出最终报告
```

---

## 31. Check List

```text
[x] 未恢复 Plain
[x] 未新增 fallback / 双链路
[x] 未修改 Candidate Kind / SQLite / Edge/Path/Vote/Assembly/KenLM
[x] 未用模拟 Tone 得出最终覆盖率结论
[x] 未仅凭单元测试判断 Tone 正常
[x] 已真实启动节点端
[x] 已真实运行音频并保存 Tone+Timestamp 配对
[x] 已区分 Tone 故障与归档缺口
[x] 临时探针：docs/tone-v2/_audit_scratch/tone-full-chain-*.mjs/py — 非正式 Diagnostics Contract，可删
[!] 为启动恢复了缺失的 loader_v1.py / feature_v2.py（环境阻塞，非 Decision）
[!] 修复了 test-tone-fixtures.ts 错误 import 以便 rebuild dist（测试夹具）
```

---

## 32. Final Decision — Answers to §18

1. Tone 模型本身是否正常？→ **是**  
2. 是否加载正确冻结模型？→ **是（env 指定 candidate V2，hash 验证）**  
3. 是否真实产生 AcousticToneSlice？→ **是（490）**  
4. ASR Word Timestamp 是否完整？→ **多数完整；d002 响应 words 空**  
5. Tone 与 ASR 是否同一时间轴？→ **是（秒，同词轴）**  
6. WordTimeSpan 是否正确？→ **有 words 时正确；无 words 时失败**  
7. Pattern 失败主要在哪步？→ **overlap 计数 vs char span（grain）**  
8. raw vs syllable 结构性不一致？→ **部分有（punct 入 raw）；主伤是 token grain**  
9. Tone SQL 是否真实执行？→ **是**  
10. Candidate 缺失主因？→ **Alignment grain + 局部 WTS；不是模型无输出**  
11. 在线正常离线不全？→ **是**  
12. 是否需改 Tone 代码？→ **否（模型/推理）**  
13. 是否需改 Alignment？→ **是（Contract）**  
14. 是否只需补归档？→ **不够；还需 grain/Contract + words 完整性**  
15. Batch 1.1C 可关闭？→ **否（CONDITIONAL）**

---

## Final Block（mandatory）

```text
TONE FULL-CHAIN NODE RUNTIME INVESTIGATION

NODE STARTUP:
PASS

TONE MODEL LOAD:
PASS

TONE MODEL OUTPUT:
HEALTHY

ASR WORD TIMESTAMPS:
DEGRADED

WORD TIME SPAN MAPPING:
DEGRADED

TONE SLICE / TOKEN GRAIN:
MISMATCHED

WINDOW COORDINATE MAPPING:
HEALTHY

PATTERN EXTRACTION:
DEGRADED

TONE READINESS RATE:
76.76%

TONE SQL EXECUTION:
PASS

TONE CANDIDATE HIT RATE:
171 candidates / 20 utterances (harness); limited by readiness

LEXICAL COMPLETE PATH RATE:
0% lexical-only; 20/20 fallback-required; 0 no-complete-path

ONLINE RUNTIME DATA:
COMPLETE

OFFLINE ARCHIVE DATA:
INCOMPLETE

PRIMARY ROOT CAUSE:
MULTIPLE

TONE CODE REPAIR REQUIRED:
NO

ALIGNMENT CODE REPAIR REQUIRED:
YES

DATA ARCHIVE REPAIR REQUIRED:
YES

BATCH 1.1C CLOSURE:
CONDITIONAL

READY FOR NEXT BATCH:
NO
```
