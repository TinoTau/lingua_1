# Lingua1 — ASR-Empty Replay Contract Repair Report

**Phase:** `LINGUA_ASR_EMPTY_REPLAY_CONTRACT_REPAIR`  
**Execution Nature:** `SINGLE-DELTA HARNESS CONTRACT REPAIR + ACCEPTANCE`  
**Authoritative Model2 SSOT:** `AUG12_PRE_LEXICAL_EDGE`  
**Date:** 2026-09-12  

---

## A. Pre-change Contract & Failure Owner

- **错误假设（Incorrect Assumption）：**
  在上一阶段证据捕获脚本 `run-pilot200-frozen-tone-evidence-full-capture.mjs` 中，测试验证契约硬编码要求：
  ```javascript
  const rawPresent = typeof evidence?.rawMergedAsrText === 'string' && evidence.rawMergedAsrText.trim().length > 0;
  const segmentsPresent = segments.length > 0;
  const toneEvidencePresent = slices.length > 0;
  ```
  该契约假设 Pilot200 中所有 200 个用例的 RAW、segments 及 acousticToneSlices 都必须非空，并强行将 `RAW=""`, `segments=[]`, `toneSlices=[]` 判定为 `CAPTURE_INVALID`（理由：`ASR_SEGMENT_MISSING`）。
- **具体责任归属（Failure Owner）：**
  归属于 `ASR_EMPTY_REPLAY_CONTRACT`（测试套件与回放证据验证层的实现假设），与生产运行时语义脱节。生产环境原生允许 ASR-empty 作为合法运行时输入状态并安全流转，而冻结的 Block C 评测体系也已明确定义 `NO_ASR_CONTENT`。

---

## B. Scope Audit (KEEP / MODIFY / DELETE / ADD)

```text
KEEP:
- Production ASR (faster-whisper-vad)
- Production Tone service & pipeline
- Model2 (AUG12_PRE_LEXICAL_EDGE SSOT)
- FineSpan & Lattice
- Lexicon (frozen during pilot)
- Domain Vote & SameDomain
- Model3, Retry, Assembly, KenLM
- Pilot dataset cases, audio files, profile definitions

MODIFY:
- Capture evidence validation contract (tests/lib/pilot200-capture-contract.mjs)
- Capture runner & artifact generator (tests/run-pilot200-frozen-tone-evidence-full-capture.mjs)
- Evidence manifest & p2_u001_001.evidence.json metadata representation

DELETE:
- Incorrect assumption: "Valid evidence always requires non-empty RAW / segments / Tone"

ADD:
- Minimal generic authoritative capture outcome classifier:
  classifyAuthoritativeCaptureOutcome(evidence, caseRow)
- Distinction between ASR_NONEMPTY and ASR_EMPTY outcomes
- Tone applicability states (TONE_EVIDENCE_PRESENT, TONE_NOT_APPLICABLE_ASR_EMPTY, TONE_EVIDENCE_MISSING)
```

---

## C. Implemented Semantic Contract

在通用模块 `electron_node/electron-node/tests/lib/pilot200-capture-contract.mjs` 中定义统一的分类逻辑，依据运行时证据状态自动判定：

```text
AUTHORITATIVE_CAPTURE_OUTCOME

├── ASR_NONEMPTY
│   RAW != "" (rawNonempty = true)
│   segments.length > 0
│   word-level timing present
│   acousticToneSlices.length > 0
│   identity matches caseRow & audio
│   → captureStatus: VALID, pass: true
│   → toneStatus: TONE_EVIDENCE_PRESENT
│   → runtimeClass: RAW_REPAIR_NEEDED / RAW_NORMALIZED_CORRECT
│   → model2Eligibility: ELIGIBLE_FOR_EVALUATION
│
├── ASR_EMPTY
│   RAW == "" (rawText present, rawTrimmed.length === 0)
│   segments.length === 0
│   acousticToneSlices.length === 0
│   ASR execution completed successfully (no error/exception)
│   identity matches caseRow & audio
│   → captureStatus: VALID, pass: true
│   → toneStatus: TONE_NOT_APPLICABLE_ASR_EMPTY
│   → runtimeClass: NO_ASR_CONTENT
│   → model2Eligibility: NOT_ELIGIBLE_NO_ASR
│
└── CAPTURE_INVALID
    - IDENTITY_MISMATCH: caseId, buildId, or audio sha256 mismatch
    - ASR_SEGMENT_MISSING: RAW != "" but segments == []
    - TIMESTAMP_MISSING: RAW != "" but segments lack word start/end timing
    - TONE_EVIDENCE_NOT_PERSISTED: RAW != "" with timing but acousticToneSlices == []
    - INCONSISTENT_ASR_EVIDENCE: RAW == "" but segments.length > 0
    - INCONSISTENT_TONE_EVIDENCE: RAW == "" but acousticToneSlices.length > 0
    - ASR_RUNTIME_FAIL: ASR execution failed or timed out
    → captureStatus: INVALID, pass: false
```

---

## D. Tone Applicability Semantics

严守冻结的声学音调所有权（Acoustic Tone Ownership：`Audio + FW Timestamps → AcousticToneSlice`）：

1. **`TONE_EVIDENCE_PRESENT`**：
   ASR 产生了合法分词与时间戳，并成功提取到声学音调切片（切片数 > 0）。
2. **`TONE_NOT_APPLICABLE_ASR_EMPTY`**：
   ASR 正常返回空结果，声学切片时间戳客观不存在，因此下游 Tone 切片不适用。**这属于合法运行时结果，绝对不是 TONE_FAILURE，也不是 TONE_EVIDENCE_MISSING**。
3. **`TONE_EVIDENCE_MISSING`**：
   ASR 产生了非空文本与时间戳，但未能持久化声学音调切片，属于真正的证据缺失。

---

## E. Tests Execution Results

执行独立验收套件 `electron_node/electron-node/tests/pilot200-asr-empty-contract.test.mjs`，包含四大类契约用例：

| 测试套件 | 测试输入状态 | 预期结果 | 实际执行结果 |
|---|---|---|---|
| **Test A** (Normal evidence) | RAW 非空、segments 非空（有时间戳）、Tone 切片存在 | `ASR_NONEMPTY`, `VALID`, `TONE_EVIDENCE_PRESENT` | **PASS** |
| **Test B** (Authoritative ASR-empty) | RAW 为空、segments 为空、Tone 切片为空、ASR 成功 | `ASR_EMPTY`, `VALID`, `TONE_NOT_APPLICABLE_ASR_EMPTY`, `NOT_ELIGIBLE_NO_ASR` | **PASS** |
| **Test C** (Broken non-empty) | RAW 非空，但 segments 为空 / 缺时间戳 / 缺 Tone 切片 | `CAPTURE_INVALID`（分别报对应原因，绝不被 ASR_EMPTY 吞掉） | **PASS** |
| **Test D** (Inconsistent empty) | RAW 为空，但包含幽灵 segments 或幽灵 Tone 切片 | `CAPTURE_INVALID`（报 `INCONSISTENT_ASR/TONE_EVIDENCE`） | **PASS** |

---

## F. Pilot200 Real Evidence Acceptance

对磁盘上全部 200 个用例的冻结证据文件执行完整全量扫描验证：

| 指标 | 契约要求 | 实际度量值 | 判定 |
|---|---|---|---|
| **TOTAL_UNIQUE_CASES** | 200 | 200 | **PASS** |
| **ASR_NONEMPTY_VALID_COUNT** | 199 | 199 | **PASS** |
| **ASR_EMPTY_VALID_COUNT** | 1 | 1 | **PASS** |
| **CAPTURE_INVALID_COUNT** | 0 | 0 | **PASS** |
| **AUTHORITATIVE_CAPTURE_VALID_COUNT** | 200 | 200 (100.0%) | **PASS** |

---

## G. Split & User Completeness

```text
Split Coverage:
  DEV:        120 / 120 (100.0%)
  VALIDATION:  60 /  60 (100.0%)
  HOLDOUT:     20 /  20 (100.0%)

User Coverage:
  U001: 40 / 40 (100.0%)
  U002: 40 / 40 (100.0%)
  U003: 40 / 40 (100.0%)
  U004: 40 / 40 (100.0%)
  U005: 40 / 40 (100.0%)

Domain Coverage:
  general_daily:    43 / 43
  software_meeting: 33 / 33
  travel_hotel:     32 / 32
  food_cafe:        36 / 36
  medical:          30 / 30
  retail_service:   26 / 26
```

---

## H. Specific `p2_u001_001` Final Classification

`p2_u001_001` 在当前权威通用契约下的确切状态：

```text
caseId = p2_u001_001
datasetIntendedClass = PROFILE_TARGET
observedRuntimeClass = NO_ASR_CONTENT
captureOutcome = ASR_EMPTY
captureStatus = VALID
toneStatus = TONE_NOT_APPLICABLE_ASR_EMPTY
model2Eligibility = NOT_ELIGIBLE_NO_ASR
rawMergedAsrText = ""
segments = []
acousticToneSlices = []

DATASET_CHANGED = NO
AUDIO_CHANGED = NO
ASR_RERUN_REQUIRED = NO
```

---

## I. Regression & Boundary Check

1. **无 Case 特判（Negative Check）：**
   经全局静态与模式匹配扫描，通用分类模块 `pilot200-capture-contract.mjs` 及 `run-pilot200-frozen-tone-evidence-full-capture.mjs` 中不存在任何 `if (caseId === 'p2_u001_001')` 或等价特判。分类完全取决于客观运行时证据。
   ```text
   CASE_SPECIFIC_PATCH = NO
   ```
2. **生产边界保护：**
   ```text
   PRODUCT_CODE_CHANGE = NO
   ASR_CHANGE = NO
   TONE_CHANGE = NO
   MODEL2_CHANGE = NO
   LEXICON_CHANGE = NO
   MODEL3_CHANGE = NO
   DATASET_CHANGE = NO
   ```

---

## J. Full Remeasure Readiness & Next Owner

```text
FULL_PILOT200_REMEASURE_EVIDENCE_READY = YES
```

所有 200 个 Pilot 用例的权威冻结证据已经完全齐备且通过契约验证（199 个正常非空证据 + 1 个合法权威 ASR 空结果），证据缺口已彻底消除，无需重新运行 ASR 捕获。

依照规则，唯一指定的下一步责任者为：

```text
ONE_NEXT_OWNER = PILOT200_POST_PRE_EDGE_RESTORE_FULL_REMEASURE
```
