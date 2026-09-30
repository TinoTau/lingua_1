# Lingua1 — `p2_u001_001` ASR-Empty Contract Audit Report

**Audit Phase:** `LINGUA_P2_U001_001_ASR_EMPTY_CONTRACT_AUDIT`  
**Execution Mode:** `READ-ONLY CONTRACT / EVIDENCE AUDIT` (NO code, config, model, dataset, lexicon, or ASR/VAD change)  
**Subject Case:** `p2_u001_001`  
**Date:** 2026-09-12  

---

## 0. 本轮性质与审计原则

本轮审计严格执行只读契约与证据核查，遵循以下底线：
- **禁止事项：** 无代码修改、无配置修改、无模型修改、无数据集修改、无词典修改、无 ASR/VAD 参数调整、无音调算法修改、无 Replay 契约修改、无 Pilot SSOT 修改、无重新训练、无音频重新生成、无样本替换、无人工制造假 segment / timestamp / tone slice。
- **唯一核心问题：** 当冻结的 ASR/VAD 链路产出空 segment 时，`p2_u001_001` 的权威语义状态（Authoritative Semantic Status）到底是什么？

---

## 1. Audit A — Case Identity & Research Purpose

### 1.1 核心元数据（Authoritative Pilot Metadata）

- **caseId:** `p2_u001_001`
- **userId:** `U001`
- **split:** `DEV`
- **domain:** `general_daily`
- **difficulty:** `short`
- **referenceText:** `请帮我看看纪念性。`
- **ttsInputText:** `请帮我看看纪戀性。`
- **perturbation / relation target:**
  - `relationFamily`: `n_l`
  - `relationDirection`: `n_l`
  - `perturbationApplied`: `true`
  - `perturbationSeverity`: `MODERATE`
  - `evaluationTargetSurface`: `纪念性`
  - `evaluationTargetTermIds`: `["base-rebuild-term-e7baaae5bfb5e680"]`
  - `targetInLexicon`: `true`
  - `isModel2TargetCase`: `true`
  - `model2LexiconEligible`: `true`
- **profile condition:**
  - `profileRef`: `prof_u001_p2`
  - `profileStage`: `P2`
  - `profileBuildSetId`: `pbs_u001_p2`
  - `profileBuildTermIds`: 8 项画像构建词（`base-rebuild-term-e794b5e884917c64` 等）
- **expected research purpose:**
  - `expectedBehaviorClass`: `PROFILE_TARGET`
  - 预期目的：在 DEV split 的日常场景短句中，通过发音扰动（念 `nian` → 恋 `lian`，声母 `n_l` 混淆）测试未见目标词“纪念性”（在 Lexicon 中存在）在用户 `U001` 的 P2 阶段画像偏置（包含 `n_l` 混淆键）辅助下，能否被 Model2 召回并由下游链路完成最终修复。
- **audio file identity / hash:**
  - `audioId`: `aud_p2_u001_001`
  - `audioPath`: `audio/p2_u001_001.wav`
  - `byte_size`: `60972`
  - `sha256`: `6ebb032cb8de43058366733d473793b4afbea7bfcada788da8c4bc933c09f8e2`
  - `sample_rate`: `16000`
  - `channels`: `1`
  - `duration`: `1.904`
- **Block B identity:**
  - Batch: `blockb_2026-09-11T1021` (Build: `build_20260911_091806`)
  - Run IDs:
    - WRONG: `blockb_2026-09-11T1021_p2_u001_001_WRONG_PROFILE`
    - CORRECT: `blockb_2026-09-11T1021_p2_u001_001_CORRECT_PROFILE`
    - NO: `blockb_2026-09-11T1021_p2_u001_001_NO_PROFILE`
- **Current capture identity:**
  - Batch: `tonecap_pilot200_full_20260912T0437`
  - Artifact: `test wav/LINGUA_DIALOG2000_V2_PILOT200/tone_evidence_captures/tonecap_pilot200_full_20260912T0437/p2_u001_001.evidence.json`

### 1.2 专项问题审计结果

#### A1: 原本是否为了测试具体 pronunciation relation → unseen lexical target？
- **答：YES。**
  - `expected relation`: `n_l`
  - `expected target term`: `纪念性`
  - `expected perturbed pronunciation/text`: `请帮我看看纪戀性。` (念 `nian` → 恋 `lian`)

#### A2: Pilot SSOT 是否明确要求 every case must produce non-empty ASR RAW / segment？
- **答：PILOT_REQUIRES_NONEMPTY_ASR = NO**
- **实际契约与代码引用：**
  1. `docs/user_correction/model3/LINGUA_DIALOG2000_V2_PILOT200_SSOT.md` 第 13 节《Freeze gates before baseline run》仅列出 7 项门禁（`MANIFEST_VALID`, `PROFILE_LEXICAL_ISOLATION_PASS`, `RELATION_DISTRIBUTION_PASS`, `DOMAIN_DECONFOUND_PASS`, `NO_KNOWN_TEST_LEAK`, `AUDIO_IDENTITY_COMPLETE`, `REFERENCE_FROZEN`），**没有任何一条门禁要求“所有用例 ASR 必须非空”**。
  2. SSOT 第 10 节《Replay》明文规定：“Authoritative RAW policy: `NO_PROFILE` `rawMergedAsrText` from frozen Block B batch `blockb_2026-09-11T1021`”。
  3. `docs/user_correction/model3/LINGUA_DIALOG2000_V2_PILOT200_Profile_AB_Replay_Development_Report.md` 第 71 行明确批准并记录：“One empty RAW (`p2_u001_001`, hash of empty string) is still authoritative and replayed exactly”；第 163 行记录：“Empty RAW case (`p2_u001_001`): classified `MODEL2_NOT_INVOKED`, not `TRACE_MISSING`”。
  4. `docs/user_correction/model3/LINGUA_DIALOG2000_V2_PILOT200_Block_C_Profile_Aware_Evaluation_Report.md` 第 44 行正式设立专门统计桶：“`| NO_ASR_CONTENT | 1 (p2_u001_001) |`”，并在评测代码 `run_pilot200_block_c_evaluator.mjs` 中定义 `if (row.rawClass === 'NO_ASR_CONTENT') return 'NOT_ELIGIBLE_NO_ASR'`，将其作为 200 个用例之一合法纳入总分母。
  5. `docs/user_correction/model3/LINGUA_DIALOG2000_V2_PILOT200_Schema.json` 中 `rawMergedAsrText` 定义为 `{ "type": "string" }`，未定义 `minLength: 1`。

---

## 2. Audit B — Frozen Audio Validity

通过只读方式对现存物理文件 `test wav/LINGUA_DIALOG2000_V2_PILOT200/audio/p2_u001_001.wav` 进行结构、格式与 PCM 信号审计：

- **file exists:** YES
- **file size:** `60972` 字节
- **duration:** `1.904` 秒（数据长度 60,928 字节 / (16000 × 1 × 2) = 1.904s）
- **sample rate:** `16000` Hz
- **channels:** `1` (单声道)
- **PCM / codec format:** 16-bit Signed Integer PCM (`fmt.audioFormat = 1, fmt.bitsPerSample = 16, fmt.blockAlign = 2`)
- **audio hash (SHA256):** `6ebb032cb8de43058366733d473793b4afbea7bfcada788da8c4bc933c09f8e2`（与 `cases.jsonl` 中冻结的 `audioIdentity.sha256` 逐比特一致）
- **异常排查：**
  - zero-length: 否
  - near-zero duration: 否 (1.904s)
  - decode failure: 否 (RIFF/WAVE 头格式标准无错)
  - all-zero PCM: 否
  - extreme silence: 否
  - truncated file: 否
  - invalid WAV structure: 否
  - unexpected sample rate/channel: 否
- **PCM 信号能量与可听度分析：**
  - 采样点总数: `30464`
  - 非零采样点数: `30448`（**非零样本占比 99.95%**）
  - 振幅极值: `min = -32542, max = 16318`
  - RMS 振幅: `5390.65`（对应 **RMS = -15.68 dBFS**）
- **判定结论：**
  - `FROZEN_AUDIO_FILE_VALID = YES`
  - `AUDIBLE_OR_NONZERO_SPEECH_EVIDENCE = YES`

---

## 3. Audit C — Historical Consistency

对比历史各阶段执行记录：

| 执行阶段 / 批次 | 运行条件 | HTTP状态 | 管道状态 | ASR 文本 (RAW) | segments 计数 | 耗时 |
|-----------------|----------|----------|----------|----------------|---------------|------|
| Block B (`blockb_2026-09-11T1021`) | WRONG_PROFILE | 200 | `OK` | `""` | 0 | 3867ms |
| Block B (`blockb_2026-09-11T1021`) | CORRECT_PROFILE | 200 | `OK` | `""` | 0 | 3775ms |
| Block B (`blockb_2026-09-11T1021`) | NO_PROFILE | 200 | `OK` | `""` | 0 | 3567ms |
| Replay V1 (`replay_2026-09-11T1347`) | 3 条件回放 | 200 | `OK` | `""` (mock) | 0 | - |
| Tone Capture (`tonecap_2026-09-12T0437`) | NO_PROFILE | 200 | `OK` (服务层) | `""` | 0 | - |
| Capture 额外重试 (3次) | NO_PROFILE | 200 | `OK` (服务层) | `""` | 0 | - |

- **ASR 后端与设置：** `faster-whisper-vad`，使用既有生产参数与 VAD 默认切分。
- **错误区分：**
  - 服务端未抛出异常，未发生超时，未发生崩溃；
  - 属于明确的 **`ASR_EXECUTION_SUCCESS_WITH_EMPTY_RESULT`**，绝对不是 `ASR_EXECUTION_ERROR`。
- **判定结论：**
  - `ASR_EXECUTION_STATUS = SUCCESS_EMPTY`
  - `EMPTY_RESULT_REPRODUCIBLE = YES`

---

## 4. Audit D — Capture Harness Correctness

审计 `electron_node/electron-node/tests/run-pilot200-frozen-tone-evidence-full-capture.mjs` 中的执行链条：

1. **音频读取与标识：** `audioAbs = path.join(DATASET_DIR, caseRow.audioPath)` 正确解析绝对路径，计算 SHA256 为 `6ebb032cb8...`，与元数据一致。(`HARNESS_INPUT_IDENTITY = PASS`)
2. **ASR 调用与参数：** 严格通过 `POST /session-bootstrap` (Profile P0) 和 `POST /run-pipeline-with-audio` 发送请求，参数包含 `wavPath`, `srcLang: 'zh'`, `tgtLang: 'en'`, `is_manual_cut: true`，与其他 199 个用例完全一致。(`HARNESS_ASR_INVOCATION = PASS`)
3. **特判分支排查：** harness 中不存在任何针对 `caseId === 'p2_u001_001'` 或相关属性的条件过滤分支。(`CASE_SPECIFIC_BRANCH = NO`)
4. **音频截断/预过滤排查：** harness 直接向后端服务传递文件绝对路径，无前端处理截断。
5. **响应接收与保存：** 服务端响应 `pipe.data.text_asr = ""` 及 `pipe.data.segments = []`，harness 如实保存，无字段丢失或序列化错误。(`HARNESS_RESPONSE_PRESERVATION = PASS`)
6. **对照相邻用例：** 在同脚本、同批次、同用户（U001）的相邻 DEV 用例 `p2_u001_003` 中，harness 顺利产出 16 个 word timestamps 及声学音调切片（`acousticToneSlices`），证明调用链路本身完全健康。
7. **判定结论：**
  - `HARNESS_CAPTURE_BUG = NO`

---

## 5. Audit E — Production Semantics of ASR-Empty

审计当前生产管道（`electron_node/electron-node/main/src/`）如何处理 ASR 空输出：

1. **入口与探测器：**
   在 `main/src/fw-detector/fw-detector-orchestrator.ts` 第 80-110 行：
   ```typescript
   const rawAsrText = (ctx.rawAsrText ?? '').trim();
   if (!rawAsrText) {
     return {
       enabled: true,
       triggered: false,
       reason: 'empty_raw',
       pipelinePath: 'v4',
       ...
       spans: [],
     };
   }
   ```
2. **下游行为事实：**
   - 生产系统**显式、原生支持** ASR-empty 作为合法运行时输入状态；
   - 当 `rawAsrText` 为空时，返回 `reason: 'empty_raw'`，`spans = []`；
   - 不生成任何词汇窗口（windows），不触发 Model2 召回，不进行 Tone 绑定，KenLM 候选池为空，安全直通并最终产出 `finalText: ""`；
   - 整个过程不抛出未捕获异常，运行状态为 `OK`。
3. **判定结论：**
  - `PRODUCTION_ASR_EMPTY_ALLOWED = YES`

---

## 6. Audit F — Replay / Frozen Evidence Contract

审计证据捕获脚本为何对 `p2_u001_001` 报出 `ASR_SEGMENT_MISSING` / `CAPTURE_INVALID`：

1. **断言来源：**
   在 `tests/run-pilot200-frozen-tone-evidence-full-capture.mjs` 的 `validateEvidenceRow` 中：
   ```javascript
   const rawPresent = typeof evidence?.rawMergedAsrText === 'string' && evidence.rawMergedAsrText.trim().length > 0;
   const segmentsPresent = segments.length > 0;
   const toneEvidencePresent = evidence?.toneEvidencePresent === true && slices.length > 0;
   ...
   if (!rawPresent) failureReason = 'ASR_SEGMENT_MISSING';
   else if (!segmentsPresent) failureReason = 'ASR_SEGMENT_MISSING';
   ```
2. **所有权归属判断：**
   这属于 **`B. capture harness implementation assumption`**。
   - 当开发该证据捕获工具时，测试套件依据首批 8 个样本的非空事实，做出了“所有 200 个用例的 RAW、segments 与 slices 都必须 > 0”的硬编码假设；
   - 它没有将生产环境和 Block B 中已被证明合法存在的“空 ASR 运行结果”纳入验证分支；
   - 因而将合法的 `rawMergedAsrText: ""` 误报成了 `ASR_SEGMENT_MISSING`，进而导致后续 Full Remeasure 认为存在 `EVIDENCE_GAP`。
3. **当前契约状态：**
   - 在 Replay V1（仅限文本）契约下，允许 empty RAW；
   - 在当前包含 Tone Evidence 的 Replay 验收契约代码下，**尚未定义合法空 ASR 证据格式**（缺少诸如 `status: 'OK_EMPTY_ASR'` 的白名单规则）。
4. **判定结论：**
  - `CAN_AUTHORITATIVE_CAPTURE_OUTCOME_BE_ASR_EMPTY_UNDER_CURRENT_CONTRACT = NO`（语义规范层为 `NOT_DEFINED`，代码验证层硬编码拒绝）。

---

## 7. Audit G — First-Owner Adjudication

### 7.1 核心事实与矛盾辨析

1. **运行时物理层面（完全满足 Case 1）：**
   - 音频有效 (`FROZEN_AUDIO_FILE_VALID = YES`)；
   - ASR 正常执行无崩溃 (`ASR_EXECUTION_STATUS = SUCCESS_EMPTY`)；
   - 空结果 100% 可复现 (`EMPTY_RESULT_REPRODUCIBLE = YES`)；
   - Harness 无截断与分支 bug (`HARNESS_CAPTURE_BUG = NO`)；
   - 生产环境原生允许空 ASR (`PRODUCTION_ASR_EMPTY_ALLOWED = YES`)；
   - Pilot 评估体系未要求 ASR 非空，且 Block C 正式定义了 `NO_ASR_CONTENT` 类别。
2. **科研意图层面（表现出 Case 2 特征）：**
   - `p2_u001_001` 原本被标注为 `expectedBehaviorClass: PROFILE_TARGET`，意在测试 `n_l` 偏置对“纪念性”的召回；
   - 但因 ASR 稳定输出空，Model2 根本不被调用，因此**无法在 Model2 评估层行使其作为 PROFILE_TARGET 的科研目的**；
   - 然而，在既有冻结的 Pilot200 体系中，它已经被正式归入 `NO_ASR_CONTENT`，作为端到端 Level 1 声学失败案例合法保留在 200 个用例分母中，未被当作废弃数据处理。
3. **证据契约层面（第一阻断者 First Failure Owner）：**
   - 阻止 Full Remeasure 运行的直接原因，是 Tone 捕获工具未定义合法的 ASR-empty 证据结构，将空结果标为 `CAPTURE_INVALID`。

---

## 8. Required Decision Table

| Evidence | Result |
|---|---|
| Pilot requires non-empty ASR | **NO** |
| Frozen audio file valid | **YES** |
| Nonzero/speech evidence | **YES** |
| ASR execution | **SUCCESS_EMPTY** |
| Empty reproducible | **YES** |
| Historical Block B also empty | **YES** |
| Harness input identity | **PASS** |
| Harness invocation | **PASS** |
| Harness response preservation | **PASS** |
| Production permits ASR-empty | **YES** |
| Current Replay contract permits authoritative ASR-empty evidence | **NO** |
| Case can exercise declared Pilot research purpose | **NO** |

---

## 9. Final Verdict

```text
P2_U001_001_ASR_EMPTY_STATUS = VALID_PILOT_RUNTIME_OUTCOME
```

```text
FIRST_FAILURE_OWNER = ASR_EMPTY_REPLAY_CONTRACT
```

```text
TONE_FAILURE = NO
```

```text
CAPTURE_SYSTEMIC_FAILURE = NO
```

```text
DATASET_CHANGE_REQUIRED = NO
```

```text
CONTRACT_CHANGE_REQUIRED = YES
```

```text
FULL_PILOT200_REMEASURE_READY = NO
```

---

## 10. ONE_NEXT_OWNER

```text
ONE_NEXT_OWNER = ASR_EMPTY_REPLAY_CONTRACT
```

**责任说明：**  
该 case 的空 ASR 是真实声学模型与 VAD 的合法运行时输出（`VALID_PILOT_RUNTIME_OUTCOME`）。它之所以阻断了 Pilot200 重测，是因为当前的 Tone Evidence 捕获与回放契约（`run-pilot200-frozen-tone-evidence-full-capture.mjs` 及 Replay 门禁）做出了“非空 RAW / segments / tone slices”的过度硬编码假设，尚未定义权威的空 ASR 证据规范（例如允许 `status: "OK_EMPTY_ASR"`，`segments: []`，`acousticToneSlices: []`）。  
在下一阶段由 `ASR_EMPTY_REPLAY_CONTRACT` 所有者补齐这一契约前，不得修改生产代码、数据集或重新生成样本。
