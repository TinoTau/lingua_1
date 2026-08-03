<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_ASR_PostProcessing_MainChain_Development_Plan_2026_07_29.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT

# FW Repair V4 — ASR Post-Processing Main Chain Development Plan

**Date:** 2026-07-29  
**Nature:** 开发准备审计 + 限域开发方案（本文件不实施代码）  
**Project Goal:** 跑通整个 ASR 后处理主链  
**Tone Stage Goal:** **Tone Information Always Participates**（允许不准；禁止为空）  
**Accuracy Optimization:** **OUT OF SCOPE / DEFERRED**

**Authority / Evidence:**
- PreDev blockers audit: `FW_Repair_V4_ASR_PostProcessing_Tone_Blockers_PreDev_Audit_2026_07_29.md`
- Code: `config.py` / `loader_v1.py` / `api_routes.py` / `text_processing.py` / `faster-whisper-asr-strategy.ts` / `tone-time-align.ts` / `tone-recall.ts` / `recall-topk-for-windows.ts` / `tone-recall-readiness.ts` / `recall-span-topk-v2.ts` / `tone-first-tier-collector.ts` / `tone-pinyin.ts`
- Frozen artifact: `tone_module/models/candidate/tone_cnn_production_v2_candidate_20260712.npz`  
  SHA256=`AADE7B531049204FD7E8601944B3A3429BD3EC16015C550E2C6B3FD27B368723`

---

## 1. Executive Summary

当前主链代码骨架已存在，但 **Tone 尚未稳定参与 Recall**：

| 环节 | 现状 |
| ---- | ---- |
| Span Sliding Window | 代码存在（V4 Fine Span / windows） |
| Tone Inference | OPERATIONAL（给定模型） |
| Tone → Pattern | **常失败**：长度门 `overlapSlices.length !== rawEnd-rawStart` → `pattern=null` |
| Pattern → Recall | **Mandatory Tone Fail Closed**：`no_pattern` → **不跑 Tone SQL** → Empty |
| WordTimeSpan | 生产 Node 路径通常 `skip_text_dedup=true`；非该路径仍可 `words=[]` |
| Default Model | **Tiny V1**；需 env 才到 Frozen V2 |

**本轮只开发三批，目标不是 Tone Accuracy，而是主链参与：**

```text
Batch A  Frozen Production V2 Default Binding
Batch B  WordTimeSpan Integrity（生产路径固化；删无意义丢 words 路径）
Batch C  Tone Participation（每个 Fine Span 必有 Pattern；Recall 必用 Tone）
```

**禁止：** 重训、改 CNN/Feature Contract、改 Recall/Domain/Assembly/KenLM/Lexicon/Span Window 规则、Perfect Alignment、双链路、新中间态。

**开发后：** 可进入 dialog_200 **全链**测试（Electron→ASR→Tone→Span→Recall→…→KenLM）。  
**开发前：** **不可**声称主链已通。

---

## 2. Development Scope

### 2.1 In Scope

```text
A. 唯一生产默认 = Frozen Production V2；Fail Closed；model identity 日志
B. Tone 所用 Word Timestamp 可追踪且进入 Recall；消灭无解释 ToneSlice>0∧WordTimeSpan=0
C. 每个 Fine Span 在 Tone 通道开启时必有 acousticTonePattern；Recall 必走 Tone SQL
```

### 2.2 Explicit Non-Goals（延期）

```text
Tone Accuracy Optimization
Alignment Perfection / Syllable Reconstruction / Character-level Tone
New Pattern Contract 文档体系 / 新 Alignment Framework
修改 Recall 候选规则、Domain Vote、Sentence Assembly、KenLM、Lexicon、Span Sliding Window
重训 / Feature Tensor / Feature Contract / 第二管道 / Shadow / Plain 恢复
```

### 2.3 Frozen Principles

```text
Keep Architecture Frozen
Keep Single Pipeline
Keep Feature Contract
Keep Model Artifact
No Retraining
No Second Pipeline
No New Intermediate State
```

### 2.4 Current Tone→Recall Chain（代码事实）

```text
Fine Span / Window
  → extractAcousticTonePatternForRecall
      → extractAcousticTonePatternByTime
         ※ 若 overlapSlices.length !== (rawEnd-rawStart) → pattern=null
  → acousticTonePattern?: number[] | undefined
  → recallSpanTopKV3 / recallSpanTopKV2
      → resolveToneRecallReadiness
         ※ !pattern?.length → state='no_pattern'
         ※ → Empty（toneSqlCount=0，不查 Tone）
  → 仅 ready 时 buildTonePinyinKey(syllables, pattern) → Tone SQL
```

**结论（当前）：**

```text
Tone 并非始终参与 Recall。
Pattern Missing → no_pattern → 跳过 Tone Recall（Fail Closed Empty）。
```

这正是本轮 Batch C 要改的 **参与性** 缺口（不是准确率缺口）。

---

## 3. Batch A — Frozen Production V2 Default Binding

### Purpose

生产启动 **无需 env** 即加载唯一 Frozen Production V2；禁止 Tiny 生产默认。

### Current Root Cause

| Owner | 行为 |
| ----- | ---- |
| `services/faster_whisper_vad/config.py` | `_DEFAULT_TONE_MODEL` → `tone_cnn_p1_v1_full.npz`（Tiny） |
| `tone_module/loader_v1.py` `_resolve_model_path` | env/`TONE_MODEL_PATH` → 否则 Tiny 路径 |
| Electron `python-service-config` | **不注入** `TONE_MODEL_PATH` |

### Responsibility Owner

`tone_module` 配置 + loader（唯一生产默认 SSOT）。

### Input / Output

| | |
| -- | -- |
| Input | 无 env；可选测试 `TONE_MODEL_PATH` override |
| Output | Frozen V2 ready；完整 identity 日志；缺失则 Fail Closed |

### Decision Location

`config.TONE_MODEL_PATH` 默认值；`loader_v1._resolve_model_path`；启动 `logger.info` identity。

### Files / Functions

| File | Change |
| ---- | ------ |
| `faster_whisper_vad/config.py` | 默认路径 → `models/candidate/tone_cnn_production_v2_candidate_20260712.npz` |
| `tone_module/loader_v1.py` | 默认解析与启动日志：path / sha256 / architecture / featureVersion / inputShape / outputShape / trainingVersion / backend |
| `tone_module/contract.py`（仅常量名若仍指向 Tiny 作为 runtime default） | 生产 runtime 默认名与路径对齐 V2；**不改 Feature Contract 数值** |
| 测试/probe | 显式 env 仅用于故意测旧模型；生产测试不依赖 env |

### Data Contract

```json
{
  "toneModel": {
    "path": ".../tone_cnn_production_v2_candidate_20260712.npz",
    "sha256": "AADE7B531049204FD7E8601944B3A3429BD3EC16015C550E2C6B3FD27B368723",
    "architecture": "conv1d_production_v2",
    "featureVersion": "p1-frame-mel-f0-v1",
    "inputShape": [64, 83],
    "outputShape": [5],
    "backend": "numpy_p1"
  }
}
```

### Code Logic

```text
1. 默认 artifact = Frozen V2 绝对/相对稳定路径
2. resolve: explicit path > TONE_MODEL_PATH(test) > production default
3. 文件不存在 → ready=false（Fail Closed）；禁止切 Tiny
4. 加载成功强制打完整 identity（禁止只打 “model ready”）
```

### Delete List

- Tiny 作为 **生产默认**
- 任何「缺 V2 则 Tiny」fallback（当前无完整 auto-fallback，禁止新增）
- 文档/注释中「需 TONE_MODEL_PATH 才能用 V2」的生产叙述

### Acceptance

- [ ] 无 env → V2
- [ ] 默认不再 Tiny
- [ ] identity 日志完整
- [ ] 缺失 Fail Closed
- [ ] 无自动 fallback

---

## 4. Batch B — WordTimeSpan Integrity

### Purpose

Tone 使用的 Word Timestamp **最终能参与 Recall**；禁止无解释的 `ToneSlice>0 ∧ WordTimeSpan=0 ∧ words=[]`。

### Current Root Cause

| 事实 | 证据 |
| ---- | ---- |
| Tone 在 dedup **前**推理 | `api_routes.py` `run_tone_inference` 在 Step 9 dedup 之前 |
| dedup 改写文本时 `words=None` | `text_processing.update_segments_after_deduplication` |
| 响应可 `words=[]` 而 `tone.slices` 仍在 | d002 类现象 |

### Production Path Confirmation（关键）

| 项 | 结论 |
| -- | ---- |
| Node 默认 `asr.engine` | `fw_detector_v1`（`node-config-defaults.ts`） |
| `FasterWhisperASRStrategy` | `isFwDetectorEngineEnabled()` → **`skip_text_dedup: true`** |
| FW Detector feature | `features.fwDetector.enabled: true`（默认） |

**判定：真正生产主链（Node FW Detector）已固定 `skip_text_dedup=true`。**

因此 Batch B **不增加兼容层**；应：

```text
固化生产行为 + 删除无意义旧丢 words 路径
```

### Responsibility Owner

FW `/utterance` 响应完整性 + Node 请求契约。

### Input / Output

| | |
| -- | -- |
| Input | ASR `segments[].words[]`（SSOT） |
| Output | 同批 words 进入响应；Node `buildWordTimeSpans` >0（当 ToneSlice>0） |

### Decision Location

- Node：已固定 skip（KEEP）
- FW：删除/停用「dedup 后丢弃 words」对生产可达路径的影响；缺 words 且 Tone 已跑 → Fail Closed 或拒绝静默空 words

### Files / Functions

| File | Change |
| ---- | ------ |
| `api_models.py` | 生产语义：`skip_text_dedup` 默认与主链一致（建议默认 `True`），去掉「靠调用方记得传」的脆弱性 |
| `api_routes.py` | Tone 已产出 slices 时，响应 `segments.words` 不得无解释为空；诊断标记 |
| `text_processing.py` | **删除或永不执行** `words=None` 重建分支（生产不可达则删；若留测试专用须 TEST_ONLY 且不可被生产调用） |
| `faster-whisper-asr-strategy.ts` | KEEP `skip_text_dedup: true`；可加断言/注释标明 SSOT |
| Node `buildWordTimeSpans` | KEEP；不新建第二套时间戳 |

### Data Contract

```text
Word Timestamp SSOT = FW segments[].words[] (WordInfo.start/end)
ToneSlice.start/end = 派生自上述 words
WordTimeSpan = Node 派生（char + 同一 ms）
禁止 Tone/Node/Archive 各猜一套
```

### Code Logic

```text
IF production path:
  never drop words after tone inference
IF tone.slice_count > 0 AND response.words empty:
  Fail Closed / hard error（禁止无解释）
DELETE silent words=None rebuild used by production
```

### Delete List

- 生产可达的 `update_segments_after_deduplication → words=None`
- 「内部 Tone 成功、外部 words 空」的静默路径
- 为旧 dedup 保留的兼容双路径

### Acceptance

- [ ] Tone 用过的 words 可在 trace/archive 追踪
- [ ] 无无解释 ToneSlice>0 ∧ WordTimeSpan=0
- [ ] 生产链 words 序列化一致
- [ ] 不新增 fallback；旧丢弃路径已删或不可达

---

## 5. Batch C — Tone Participation（非 Perfect Alignment）

### Purpose

**Tone Information Always Participates.**

对每个 Fine Span（在 utterance Tone 通道开启时）：

```text
必须有 acousticTonePattern
→ resolveToneRecallReadiness = ready
→ Recall 执行 Tone SQL
→ Candidate 带 Tone 信息进入后续链
```

允许 Pattern **不准**（约 80% 准确率可接受）。  
**禁止** Pattern 为空导致整个 Span 放弃 Tone Recall。

### Current Root Cause（精确）

| 位置 | 行为 |
| ---- | ---- |
| `tone-time-align.ts` `extractAcousticTonePatternByTime` | `syllableCount = rawEnd - rawStart`；`overlapSlices.length !== syllableCount` → **`pattern=null`** |
| `recall-topk-for-windows.ts` | miss → `acousticTonePattern` 不设置 |
| `tone-recall-readiness.ts` | `!pattern?.length` → **`no_pattern`** |
| `tone-first-tier-collector` / `recall-span-topk-v2` | readiness≠ready → **Empty，Tone SQL=0** |

**这不是「Recall 规则要改」，而是上游 Pattern 生成把门关死，触发了已冻结的 Mandatory Tone Fail Closed。**

本轮 **不修改** `resolveToneRecallReadiness` 的 Fail Closed 语义；改为 **保证 Pattern 存在且长度可构建 tonePinyinKey**。

### Participation Contract（本轮唯一新增行为契约）

```text
Tone Module → AcousticToneSlices
  → (Batch C) Span Tone Pattern Generator
  → acousticTonePattern.length === window.syllables.length
  → resolveToneRecallReadiness.ready
  → Tone SQL Recall
  → Candidate Score → … → KenLM
```

约束：

- 不改 SQL 规则 / Domain / Assembly / KenLM
- 不新增第二条 Recall 链
- 不恢复 Plain
- 不宣称 Accuracy ≥95%

### Responsibility Owner

**唯一：** `extractAcousticTonePatternByTime`（经 `extractAcousticTonePatternForRecall`）  
禁止平行第二套 pattern 提取器。

### Input / Output

| | |
| -- | -- |
| Input | window raw/syllable range + AcousticToneSlices + WordTimeSpans |
| Output | `pattern: number[]` 长度 = `syllableEnd - syllableStart`（= recall syllables.length）；tones ∈ {1..5} |

### Decision Location

`tone-time-align.ts` — 删除「长度不等即 null」门；改为 **Participation Fill**。

### Recommended Minimal Logic（Participation Fill，非 Accuracy 优化）

```text
1. windowTimeRange = charRangeToWindowTime(...)
   - 若无 covering WordTimeSpan → 仍无法定位时间：记诊断；
     （Batch B 保证生产不会大面积发生）
2. overlapSlices = selectSlicesByTimeOverlap(...)
3. targetLen = syllableEnd - syllableStart   // 与 Recall syllables 对齐
4. IF overlapSlices.length >= 1 AND targetLen >= 1:
     pattern[j] = argmax(overlapSlices[map(j)].posterior)
     map: 按索引比例把 targetLen 映射到 overlapSlices
        （slice 少→重复使用邻近 slice；slice 多→抽样/分段）
     → ALWAYS return pattern.length === targetLen
5. DELETE: if (overlapSlices.length !== rawEnd-rawStart) return null
```

说明：

- 这是 **保证 Tone 键可构造**，不是音节重建框架，不是新 Feature Contract。
- `buildTonePinyinKeyFromSyllablesAndPattern` 要求 `pattern.length === syllables.length` 且 tone∈[1,5] — Fill 必须满足，否则仍 `invalid_pattern`。
- **禁止** 为凑长度填 `0` / 非法 tone。
- **禁止** Plain fallback。

### When utterance Tone channel is off

```text
no acoustic slices / toneTimestampOnlyEnabled=false
→ toneCallerEnabled=false 或 no slices
→ 既有 Fail Closed（caller_disabled / no_acoustic）
≠ “有 Tone 却 no_pattern”
```

Batch C 只消灭：**有 slices + 有 WordTimeSpan，却因长度门丢 Pattern**。

### Files / Functions

| File | Change |
| ---- | ------ |
| `tone-time-align.ts` | Participation Fill；删 char-length 硬门 |
| `tone-recall.ts` | 仍唯一包装；不另开路径 |
| `tone-time-align.test.ts` | 多字 token / L2–L5：必有 pattern；长度=音节数 |
| `recall-topk` 诊断 | miss 原因收窄；`ngramTonePatternHitCount` 应接近 attempt（生产有 Tone 时） |

### Data Contract

```text
acousticTonePattern: number[syllableCount]
syllableCount = window.syllableEnd - window.syllableStart
each ∈ {1,2,3,4,5}
toneNorm = join digits（既有 normalizeToneNorm）
tonePinyinKey = buildTonePinyinKeyFromSyllablesAndPattern(syllables, pattern)
```

### Code Logic（Recall 侧 — KEEP）

```text
KEEP resolveToneRecallReadiness Fail Closed
KEEP Mandatory Tone SQL
KEEP no Plain
MODIFY only upstream pattern emission so ready is reachable per span
```

### Delete List

- `overlapSlices.length !== (rawEnd-rawStart) → null` 分支
- 任何「无 pattern 则走 Plain」冲动（禁止）
- 并行第二 alignment / shadow pattern 路径

### Acceptance

- [ ] Tone 通道开启时，每个 Fine Span **一定有** Pattern（可诊断的时间定位失败除外，且 Batch B 后应≈0）
- [ ] Recall **真正使用** Tone（ready → Tone SQL >0 当库有键）
- [ ] 不再因长度门大规模 `no_pattern` 跳过 Tone
- [ ] **不**要求 Accuracy≥95%；不改模型/Feature

---

## 6. Files

| Batch | Files |
| ----- | ----- |
| A | `config.py`, `loader_v1.py`,（必要时）`contract.py` 默认名常量 |
| B | `api_models.py`, `api_routes.py`, `text_processing.py`, `faster-whisper-asr-strategy.ts`（断言/注释） |
| C | `tone-time-align.ts`, `tone-recall.ts`（薄包装）, 相关 unit tests |
| Diag（最小） | loader identity log；tone diagnostics hit/miss；words/tone 一致性标志 |

**不改：** Recall SQL 规则文件的业务逻辑、Domain Vote、Assembly、KenLM、Lexicon、Span Window 生成器。

---

## 7. Functions

| Function | Batch | Action |
| -------- | ----- | ------ |
| `_resolve_model_path` / `ToneClassifierV1.load` | A | MODIFY default + identity log |
| `update_segments_after_deduplication` | B | DELETE words-drop 生产语义 |
| `executeFasterWhisperASR` request body | B | KEEP skip_text_dedup |
| `extractAcousticTonePatternByTime` | C | MODIFY Participation Fill；DELETE null gate |
| `extractAcousticTonePatternForRecall` | C | KEEP 唯一入口 |
| `resolveToneRecallReadiness` | C | **KEEP**（不放宽 no_pattern 语义；靠上游保证 pattern） |
| `collectTierCandidatesToneFirst` / `recallSpanTopKV2` | — | KEEP |
| `buildTonePinyinKeyFromSyllablesAndPattern` | — | KEEP |

---

## 8. Data Contract

| 字段 | 合同 |
| ---- | ---- |
| Production model | Frozen V2 npz + SHA256 上表 |
| `segments[].words[]` | Word Timestamp SSOT |
| `AcousticToneSlice` | 每 ASR WordInfo 一片（KEEP 粒度；本轮不改推理） |
| `WordTimeSpan` | 由 words 派生 |
| `acousticTonePattern` | 每 window 必有；长度=音节数；∈1..5 |
| `tonePinyinKey` | syllables ⊕ pattern |
| Diagnostics | model identity + pattern hit/miss + wordsUsedByTone（非 Decision） |

---

## 9. Code Logic（端到端目标流）

```text
Electron
 → Node (asr.engine=fw_detector_v1, skip_text_dedup=true)
 → FW ASR + Tone(V2 default)
 → segments.words 完整 + tone.slices
 → Span Sliding Window（KEEP）
 → 每 window: Participation Pattern（必有）
 → Mandatory Tone Recall（真正 Tone SQL）
 → Domain Vote（KEEP）
 → Sentence Assembly（KEEP）
 → KenLM（KEEP）
 → NMT
```

---

## 10. Delete List

| Item | Batch |
| ---- | ----- |
| Tiny 生产默认 | A |
| 生产模型 fallback 到旧 artifact | A |
| dedup 后静默 `words=None`（生产可达） | B |
| `rawEnd-rawStart` 硬相等 → `pattern=null` | C |
| Plain / 双 alignment / shadow / 准确率向架构翻修 | 全轮禁止 |

---

## 11. Regression Scope

**功能回归（Participation / Integrity，非 Accuracy 金标）：**

- 单字 / 双字 / 多字 token（你好、我们、订单、预订、前台、上线计划）
- L1–L5 windows：Pattern 非空率 ≈ 100%（Tone 通道开且有 WordTimeSpan）
- `no_pattern` 计数在有 Tone+words 时 → 趋近 0
- Tone SQL 被调用（非 Empty skip）
- words 与 ToneSlice 同现
- 无 env 启动 identity = V2
- 短/长音频；多 segment
- **不改词库**；非词库样例只测 Pattern/words 参与性

**明确不测为本轮门禁：** Tone 标注准确率 ≥95%。

---

## 12. Acceptance Criteria

### Batch A
- [ ] 无 env → Frozen V2
- [ ] 非 Tiny 默认
- [ ] identity 日志完整
- [ ] 缺失 Fail Closed

### Batch B
- [ ] 生产链 words 完整可追踪
- [ ] 无无解释 ToneSlice>0 ∧ WordTimeSpan=0
- [ ] 旧丢 words 路径已删/不可达

### Batch C
- [ ] 每个 Fine Span（Tone 开）必有 Pattern
- [ ] Recall 真正使用 Tone（ready + Tone SQL）
- [ ] 不再因长度门大规模 no_pattern 跳过 Tone
- [ ] 未改 Recall/Domain/Assembly/KenLM/Lexicon/Span 规则
- [ ] 未改模型 / Feature Contract

### Full Chain（A+B+C 后）
- [ ] Electron→ASR→Tone→Span→Recall→Domain→Assembly→KenLM 可完整跑
- [ ] 可进入 dialog_200 全链测试
- [ ] 不是只跑 Node harness 就算通

---

## 13. Final Development Order

```text
1) Batch A — Model Binding
2) Batch B — WordTimeSpan Integrity
3) Batch C — Tone Participation Fill
4) Smoke: 单句 Electron/Node→FW→Tone→一个 window Tone SQL
5) dialog_200 全链测试（Acceptance）
```

**不可并行无序合并：** C 依赖 B（无 WordTimeSpan 则无法时间定位）；A 应先于全链验收（避免 Tiny 污染结果）。

**A/B/C 可同轮规划，必须按序落地。**

---

## 14. Final Must-Answer（Current vs Target）

| # | 问题 | **当前（开发前）** | **本轮目标（A+B+C 后）** |
| - | ---- | ------------------ | ----------------------- |
| 1 | Production 默认模型是否已唯一？ | **NO**（默认 Tiny） | **YES** = Frozen V2 |
| 2 | WordTimeSpan 是否完整？ | **PARTIAL**（生产 skip_dedup 通常有；旧 dedup 路径可丢） | **YES**（生产固化；丢弃路径删除） |
| 3 | 每个 Span 是否一定拥有 Tone Pattern？ | **NO** | **YES**（Tone 通道开启时） |
| 4 | Recall 是否真正使用 Tone？ | **仅当 pattern 存在**；否则跳过 | **YES**（每 Span ready） |
| 5 | 是否仍存在 no_pattern 导致跳过 Recall？ | **YES（主因）** | **NO**（参与性门禁下应消除；仅无 Tone 通道时 Fail Closed） |
| 6 | 是否完成 Span Sliding Window 主链？ | **代码有；全链未验收** | **跑通**（A+B+C 后验收） |
| 7 | 是否可以进入 dialog_200 全链测试？ | **NO** | **YES（A+B+C 完成后）** |

### One-line verdicts

```text
CURRENT TONE PARTICIPATION: FAIL（no_pattern → skip Tone SQL）
CURRENT DEFAULT MODEL: Tiny V1（NOT Frozen V2）
PRODUCTION skip_text_dedup: YES（fw_detector_v1 主链已固定）
READY TO IMPLEMENT A/B/C: YES
READY FOR dialog_200 FULL CHAIN: AFTER A+B+C ONLY
TONE ACCURACY WORK: DEFERRED
```

---

## 15. KEEP / MODIFY / DELETE / DEFER

### KEEP
- Frozen V2 artifact & Feature Contract  
- Mandatory Tone Recall Fail Closed（readiness SSOT）  
- Span Sliding Window / Domain / Assembly / KenLM 规则  
- 生产 `skip_text_dedup: true`（Node）  
- 单管道  

### MODIFY
- 默认模型绑定  
- words 完整性（删丢弃）  
- Pattern 生成：Participation Fill  

### DELETE
- Tiny 生产默认  
- 生产丢 words 路径  
- char-length → null pattern 门  

### DEFER
- Tone Accuracy / Perfect Alignment / 音节重建  
- feature_v2 provenance  
- 训练链恢复  
- 非生产 artifact 全量清理  

---

**文档状态：** DEVELOPMENT PLAN READY  
**下一动作：** 按 §13 顺序实施 Batch A → B → C；本文件授权范围为参与性与绑定修复，不授权 Accuracy 架构翻修。
