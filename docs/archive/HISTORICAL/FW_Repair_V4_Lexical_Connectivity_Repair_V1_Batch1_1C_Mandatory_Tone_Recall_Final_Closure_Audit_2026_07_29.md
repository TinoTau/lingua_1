<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_Lexical_Connectivity_Repair_V1_Batch1_1C_Mandatory_Tone_Recall_Final_Closure_Audit_2026_07_29.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# FW Repair V4 — Lexical Connectivity Repair V1 · Batch 1.1C Mandatory Tone Recall Final Closure Audit

| Field | Value |
|-------|-------|
| Date | 2026-07-29 |
| Stage | **Final Closure Audit + Tone Coverage Acceptance** |
| Nature | **Read-only** — no production/test/Contract code changes |
| Baseline (Dev) | `c1bd267c707b6d103958f2c41dfccd83911c78a7` |
| SSOT | Mandatory Tone Recall · Fail Closed · No Tone → No Candidate · **CR 1.0.8** |

---

## 1. Executive Summary

**代码闭环（Gate A）成立：** Mandatory Tone Recall 生产链 Plain SQL = 0；非 ready → Empty；underfill 不 Plain 补齐；`resolveToneRecallReadiness` 为唯一 readiness Decision Owner；无 shadow / 兼容开关 / 可恢复 Plain 配置。

**运行可用性（Gate B/C/D）无法在本轮完整验收：** dialog_200 语料与现有 Lattice 离线探针 **不具备**「真实 AcousticToneSlice + 配对 ASR Word Timestamp / wordTimeSpans」的可重放包。E2E batch-result 中虽有完整 `tonePosterior` slices（可达 200/200），但 **未持久化 wordTimeSpans**；GT-only Phase1/2 探针不传 Tone → Fail Closed 下绝大多数窗口 Empty。按任务硬性规则：

```text
缺乏真实覆盖率数据 → CLOSURE = CONDITIONAL；READY FOR NEXT BATCH = NO
```

主键瓶颈归类为：**TONE_COVERAGE / 数据落盘缺口**（WordTimeSpan 与 Tone slice 未成对归档），**不是**“应恢复 Plain”。

---

## 2. Final Verdict

```text
BATCH 1.1C MANDATORY TONE RECALL FINAL CLOSURE

SSOT:
ALIGNED

TONE READINESS OWNER:
UNIFIED

TONE → PLAIN PRODUCTION PATHS:
ZERO

UNDERFILL PLAIN PATHS:
ZERO

PLAIN SQL FROM MANDATORY TONE RECALL:
ZERO

DEAD / LEGACY CODE:
CLEAN

REAL TONE DATA:
INCOMPLETE

TONE READINESS RATE:
N/A (no paired Tone+WordTimeSpan dialog_200 replay)

PATTERN LENGTH MATCH RATE:
N/A (same)

TONE CANDIDATE HIT RATE:
N/A (same)

LEXICAL COMPLETE PATH RATE:
N/A post-1.1C (pre-1.1C GT probes not valid for Fail Closed coverage)

PRIMARY BOTTLENECK:
TONE_COVERAGE

BATCH 1.1C CLOSURE:
CONDITIONAL

READY FOR NEXT BATCH:
NO
```

---

## 3. Audit Scope

| In scope | Out of scope |
|----------|--------------|
| 生产调用链 / Readiness SSOT / Plain 残留 | 修改代码或测试 |
| 兼容字段真实消费 | 恢复 Plain / 新 fallback / 开关 |
| Tone window 映射与 timestamp 机制 | Batch 1.1D / Batch 2 / Production Cutover |
| dialog_200 数据可用性判定 | 伪造 coverage 数字 |
| Closure Gate A–D 判定 | 本轮“修齐”数据缺口 |

---

## 4. SSOT Authority

| Document | Role | Status |
|----------|------|--------|
| Implementation Contract **CR 1.0.8** | 实现权威 | **ACTIVE** |
| Mandatory Tone Pre-Dev Audit + Repair Design | 行为 SSOT | **IMPLEMENTED** |
| Development Report 2026-07-28 | 实现记录 | ACTIVE |
| Test Report 2026-07-28 | 单元/回归记录 | ACTIVE（覆盖率 FOLLOW-UP） |
| Tone Unsupported Pre-Dev Audit | 历史 | **SUPERSEDED**（正文仍含旧 KEEP underfill 叙述 → 见 §23） |
| INTERFACE_FREEZE | `plainFallbackHitCount` 已改为 always-0 语义 | ALIGNED |

失效历史定义（不得再当政策）：

```text
Tone unsupported → Plain
No pattern → Plain
Tone underfill → Plain fill
plain_fallback 为合法 Candidate 来源
```

---

## 5. Production Call Graph

| Step | File | Function | Input | Output | Failure | Diagnostics | Decision Owner |
|------|------|----------|-------|--------|---------|-------------|----------------|
| 1 ASR Word Timestamp | FW ASR segments | `WordInfo.start/end` | audio + ASR | word times (sec) | missing timestamps | — | ASR |
| 2 AcousticToneSlice | `tone_module/inference.py` · `run_tone_inference` | audio window per word | `acousticToneSlices[]` + posterior | no_audio / non_zh / model_error / short slice skip | `toneEnabled`, `sliceCount` | **ToneModule (CNN)** |
| 3 Batch offset | `asr-step.ts` | `offsetAcousticSlices` | batch-relative slices + `segmentOffsetSec` | utterance-global sec axis | — | — | Pipeline |
| 4 WordTimeSpan | `tone-time-align.ts` · `buildWordTimeSpans` | rawText + ASR words + offsets | `WordTimeSpan[]` (raw+time) | indexOf miss → skip word | `wordTimeSpanCount` | Tone time-align |
| 5 Feature gate | `tone-recall.ts` · `resolveTimestampToneState` | slices + `toneTimestampOnlyEnabled` | `toneEnabled` / skip reason | disabled / no slices | `toneSkippedReason` | FW config gate |
| 6 Pattern extract | `extractAcousticTonePatternByTime` | window raw/syl + slices + spans | `pattern[] \| null` | no covering span; slice count ≠ char span | `toneOverlap*`, `ngramTonePattern*` | Pattern extractor |
| 7 Readiness | `tone-recall-readiness.ts` · `resolveToneRecallReadiness` | syllables, supportsTone, pattern, callerEnabled | ready \| skip state | non-ready → Empty | `tone_*` skip codes | **Recall SSOT (sole)** |
| 8 Tone SQL | `LexiconRuntimeV2` tone composite APIs | tonePinyinKey + limits | rows only | empty rows | toneSqlCount | Runtime (rows only) |
| 9 Candidate | `recall-span-topk-v2` / binder | Tone hits | `WindowCandidate` | prior filter | toneLookupStage=`tone_exact` | Recall |
| 10 LexicalEdge | `build-lexical-edges.ts` (harness) | candidates | edges + evidence | empty → no edge | hasToneExact | Lattice Edge |
| 11 Path | Phase2 harness / prod LTR | edges | SegmentationPath / FormalFineSpan | no complete path | fallback inject (connectivity) | Path / LTR |

**Tone 来源确认：** 原始音频时间片上的 ToneModule 后验；**不是** ASR 文字推断、词库猜调、拼音规则补调。

**路径分流：** 生产 V4 orchestrator 走 LTR FormalFineSpan；`buildLexicalEdges` / `enumerateCompleteSegmentationPaths` 主要在 Lattice harness。两者共享同一 Recall Tone 入口。

---

## 6. Ownership Matrix

| Decision | Owner | Not Owner |
|----------|-------|-----------|
| Whether Tone channel enabled | FW `toneTimestampOnlyEnabled` + payload | Runtime |
| Whether to attempt pattern extract | `toneActive` (enabled ∧ slices ∧ wordTimeSpans) | Readiness |
| Whether Recall may emit Candidate | **`resolveToneRecallReadiness`** | Orchestrator / Runtime / Edge |
| SQL rows | Runtime | Recall uniqueness/Candidate |
| Edge evidence OR | `buildLexicalEdges` | Must not invent Plain stage |
| Connectivity fallback edges | `injectFallbackEdges` | **≠** Tone→Plain |

---

## 7. Readiness SSOT Audit

### 7.1 Authority

| Item | Evidence |
|------|----------|
| Sole resolver | `lexicon-v2/tone-recall-readiness.ts` · `resolveToneRecallReadiness` |
| length1 | `collectBaseOnlySingleCharCandidate` calls it |
| length2–5 | `collectTierCandidatesToneFirst` calls it |
| Order | caller_disabled → runtime_unsupported → no_pattern → invalid_pattern → ready |

### 7.2 Symbol search

| Symbol | File / Function | Purpose | Duplicate decision? | SSOT | Verdict |
|--------|-----------------|---------|---------------------|------|---------|
| `resolveToneRecallReadiness` | tone-recall-readiness.ts | Sole gate | No | Authority | **KEEP** |
| `supportsToneFirstRecall` | lexicon-runtime-v2.ts | Capability probe → readiness input | No | Input only | **KEEP** |
| `buildTonePinyinKeyFromSyllablesAndPattern` | tone-pinyin.ts | Key build; null → invalid_pattern | No | Helper | **KEEP** |
| `toneActive` | recall-topk-for-windows.ts | Extract gate only | Not readiness | Extract | **KEEP** (doc clarity) |
| `toneCallerEnabled` | recall-topk / readiness | Maps toneEnabled | No | Input | **KEEP** |
| `toneReady` / `toneAvailable` | — | Not present as parallel gates | — | — | N/A |
| skip states | readiness types | Fail Closed taxonomy | No | SSOT | **KEEP** |

**结论：TONE READINESS OWNER = UNIFIED。** Orchestrator/Runtime 不降级 Plain。

---

## 8. Plain Residual Audit

| Symbol | File | Function / Context | Production/Test/History | Current Purpose | SSOT Verdict |
|--------|------|--------------------|-------------------------|-----------------|--------------|
| `lookupPlainTiers` | — | — | **Gone** | — | CLEAN |
| `needPlainFallback` | — | — | **Gone** | — | CLEAN |
| `dedupeByIdPreferToneExact` | — | — | **Gone** | — | CLEAN |
| `plain_only_no_pattern` | — | — | **Gone from src** | — | CLEAN |
| `plain_fallback` (stage assign) | — | production assign | **Gone** | — | CLEAN |
| `lookupBaseByPinyinKey` | lexicon-runtime-v2.ts | Runtime API | Production API + contract/audit tests | Mechanical plain rows | **KEEP** (not Tone Recall chain) |
| `lookupBaseByExactSurfaceAndPinyin` | lexicon-runtime-v2.ts | Runtime API | Same | Mechanical exact rows | **KEEP** |
| Tone Recall → above Plain APIs | collectors | — | Production path | **0 calls** (spies in 1.1C tests) | **PASS** |
| `plainFallbackHitCount` | types / diagnostics / recall-topk aggregate | Aggregate field | Production field always 0 | Compat counter | See §9 |
| `plain_fallback_hits` | recall-v2-diagnostics | Optional diag | Always undefined/0 | Compat | See §9 |
| `hasToneRelaxed` | LexicalEdge evidence | Path score bit | Always false from Tone Recall | Residual evidence bit | See §9 |
| Experiment scripts counting plain stages | tests/experiments/*.mjs | Historical metrics | History | Do not treat as SSOT | History |

**Mandatory Tone Recall 生产链 Plain SQL：ZERO → Gate A Plain SQL PASS。**

---

## 9. Compatibility Field Audit

### 9.1 `plainFallbackHitCount` / `plain_fallback_hits`

| Question | Answer |
|----------|--------|
| Still consumed? | Yes — `createEmptyToneDiagnostics` initializes 0; `recall-topk-for-windows` aggregates `recall.plainFallbackHitCount ?? 0` into utterance tone diagnostics; INTERFACE_FREEZE documents field |
| Always 0 after 1.1C? | **Yes** on Mandatory Tone path (collectors set 0 / undefined) |
| Misleading? | **Yes** — name still implies Plain fallback is a live strategy |
| External break if deleted? | Diagnostics / freeze contract field consumers; no separate public SDK found beyond FW diagnostics |
| Earliest delete batch? | Dedicated **Diagnostics Cleanup** after Dashboard/trace consumers audited — recommend **Batch 1.1C+1** or pre-1.1D cleanup, not 1.1D HB scope |

**Verdict: DELETE IN DEDICATED CLEANUP**（本轮不改代码；保留 = 有真实聚合消费，但命名债务）

### 9.2 `hasToneRelaxed`

| Question | Answer |
|----------|--------|
| Consumed? | Yes — `enumerate-complete-segmentation-paths.ts` counts relaxed tone edges; tests assert `false` |
| Always false from Tone Recall? | **Yes** — `build-lexical-edges` no longer sets from `plain_fallback` |
| Misleading? | **Yes** — implies relaxed/Plain tone path |
| Delete impact? | Path scoring / evidence DTO shape |

**Verdict: DELETE IN DEDICATED CLEANUP**（或先改名为 deprecated evidence；本轮不改）

---

## 10. Tone Window Mapping Audit

```137:155:electron_node/electron-node/main/src/fw-detector/tone-time-align.ts
  const syllableCount = rawEnd - rawStart;
  ...
  if (overlapSlices.length !== syllableCount) {
    return { pattern: null, windowTimeRange };
  }
```

| Side | Code | Real meaning |
|------|------|----------------|
| Left `overlapSlices.length` | time-overlap filtered AcousticToneSlices | ASR-word-grain tone slices intersecting window time |
| Right `syllableCount` | **`rawEnd - rawStart`** | **Character span length** (UTF-16 index delta), **not** `syllableEnd - syllableStart` |

`syllableStart/End` are stored on `WindowTimeRange` but **do not** enter the equality check.

**Risk（已知，Pre-Dev Audit 已记）：** 变量名 `syllableCount` 误导；char≠syllable（英文、合并 token、非线性映射）→ 系统性 `pattern=null` → Fail Closed Empty。修复方向 = 对齐契约，**禁止 Plain**。

---

## 11. Timestamp Basis Audit

| Object | Unit | Axis |
|--------|------|------|
| AcousticToneSlice.start/end | **seconds** | batch-relative → `offsetAcousticSlices(segmentOffsetSec)` → utterance-global |
| WordTimeSpan.start/end | **seconds** | `word.start/end + segmentTimeOffsetsSec[batch]` |
| segmentTimeOffsetsSec | seconds | cumulative from `audioSegmentDurationMs/1000` |

Overlap: half-open style `slice.end > window.start && slice.start < window.end` on **same second axis**.

**Risks to watch in real data (not measured this round):** double offset, missing offset, ms/sec mix, float edge, slice gaps/duplicates — need paired logs.

---

## 12. Character vs Syllable Audit

| Scenario | Expected raw span vs syl span | Slice grain | Pattern likely? |
|----------|-------------------------------|-------------|-----------------|
| 普通中文单字 | 1 char ≈ 1 syl | 1 word slice | Yes if timestamps align |
| 多字中文 window | N chars ≈ N syl (typical) | N slices | Yes if 1:1 ASR words |
| 多音字 | char=syl count still 1:1 | 1 | Tone value may mismatch lexicon — lookup empty, not readiness fail |
| 儿化 | may 1–2 syl / irregular | ASR-dependent | **Mismatch risk** |
| 数字/英文/缩写 | chars ≠ syl (`charsPerSyllable`) | token-dependent | **High no_pattern risk** |
| 中英混合 | mixed | mixed | High |
| 标点/空格/Emoji | may be in raw span | often no slice | no_pattern / blocked |
| ASR 合并/拆分 token | char span vs slice count diverge | **Primary alignment failure mode** | pattern=null |
| Coarse 跨界 window | raw from syllable map | may partial overlap | partial_overlap → null |
| Unicode 组合 | UTF-16 length ≠ grapheme | — | edge cases |

**结论：** 当前完整覆盖判断使用 **字符跨度 vs Tone slice 数**；在 ASR token≠字 时，这是 Fail Closed 后覆盖率的结构性威胁。

---

## 13. dialog_200 Data Availability

| Layer | Status |
|-------|--------|
| `test wav/dialog_200` | wav + GT text only；README：**无** word timestamp / tone label |
| Phase1/2 offline probes | GT text → pinyin；**不传** acousticSlices / wordTimeSpans |
| E2E `*dialog200-batch-result.json` | Often **200/200** full `acousticToneSlices`+`tonePosterior` |
| Paired `wordTimeSpans` in those JSON | **0** occurrences in dialog200 batch-results checked |
| d001 probes | Incomplete pairing (either spans without posterior, or posterior without spans) |

**REAL TONE DATA: INCOMPLETE**

因此本轮 **不得** 输出合法的 dialog_200 `tone_readiness_rate` / `pattern_length_match_rate` / post-1.1C path rates。

---

## 14. Tone Coverage Metrics

| Metric | Value |
|--------|------:|
| utterance_count (paired Tone+WTS replay) | **N/A — data gap** |
| total_window_count | N/A |
| tone_ready_window_count | N/A |
| tone_no_pattern / invalid / disabled / unsupported | N/A |
| tone_lookup_empty / underfill | N/A |
| tone_candidate_window_count | N/A |
| tone_readiness_rate | **N/A** |
| tone_candidate_hit_rate | **N/A** |

单元/SQLite 1.1C 测试证明 **状态机正确**，但 **不能** 替代 Coverage Acceptance（任务 §9）。

---

## 15. Length1–5 Breakdown

### 19.1 Tone Readiness（要求表 — 无真实数据）

| Length | Windows | Ready | No Pattern | Invalid | Disabled | Unsupported | Readiness Rate |
| ------ | ------: | ----: | ---------: | ------: | -------: | ----------: | -------------: |
| 1–5 | — | — | — | — | — | — | **N/A** |

### 19.2 Tone Recall

| Length | Ready Windows | Hit Windows | Empty | Underfill | Candidate Hit Rate |
| ------ | ------------: | ----------: | ----: | --------: | -----------------: |
| 1–5 | — | — | — | — | **N/A** |

---

## 16. Alignment Metrics

| Metric | Value |
|--------|------:|
| word_time_span_build_success_rate | N/A |
| window_time_range_success_rate | N/A |
| tone_slice_overlap_success_rate | N/A |
| pattern_length_match_rate | **N/A** |
| invalid_tone_value_rate | N/A |
| timestamp_missing_rate | N/A |
| partial_overlap_rate | N/A |
| duplicate_slice_rate | N/A |
| gap_slice_rate | N/A |

**机制层已知失败模式（代码证据，非 corpus 计数）：** `overlapSlices.length !== (rawEnd-rawStart)` → pattern null → readiness `no_pattern`.

---

## 17. Candidate Metrics

Post-1.1C Fail Closed on GT-only probes：**未重跑**。预期：无 Tone payload → 几乎全部 `TONE_NO_PATTERN` / `TONE_CALLER_DISABLED`，而非笼统 `NO_LEXICON_HIT`。

---

## 18. Edge Metrics

Pre-1.1C Phase2 node-runtime（**Plain 时代，仅作历史参照，非本轮验收**）：

| Metric | Count |
|--------|------:|
| recallable windows | 15445 |
| candidates | 2692 |
| lexical edges | 1610 |
| fallback edges | 2042 |
| utterances needing fallback | 200/200 |

这些数字 **包含** 旧 Plain Candidate 贡献；**不可**直接当作 Mandatory Tone 后可达性。

---

## 19. Path Metrics

同 §18：pre-1.1C `zeroLexicalOnlyCompletePaths=200`（全靠 fallback 连通）。Fail Closed 后若无 Tone，lexical 侧会更空 → fallback 依赖可能上升；需配对 Tone 数据后重测。

### 19.3 Lattice（要求表）

| Metric | Count | Rate | Main Failure Reason |
| ------ | ----: | ---: | ------------------- |
| post-1.1C lexical complete path | N/A | N/A | **DATA_GAP** (no paired Tone replay) |
| pre-1.1C (historical) fallback required | 200/200 | 100% | NO_LEXICON_HIT + connectivity (Plain-era) |

---

## 20. Failure Samples

无法从真实配对 dialog_200 列出 Top 失败样例（数据缺口）。

**合成机制样例（说明性，非 coverage）：**

| Field | Example |
|-------|---------|
| failure reason | pattern null because `overlapSlices.length !== rawEnd-rawStart` |
| owner | Window coordinate mapping / ASR token grain |
| note | Documented in Pre-Dev Audit § risk; fix alignment, not Plain |

---

## 21. Root Cause Classification

| 问题 | 证据 | Decision Owner | Batch 1.1C? | 后续 | 阻塞 Closure? |
|------|------|-----------------|-------------|------|---------------|
| 无配对 WordTimeSpan 落盘 | dialog_200 README；batch-result 无 wordTimeSpans | Pipeline / test corpus archival | **No** (data) | Tone Coverage data batch | **Yes** (Gate B/C) |
| GT probes 无 Tone | phase1/2 probe.mjs | Test harness | No | Extend probes | Yes for acceptance |
| char span vs slice count | tone-time-align.ts L137–151 | Pattern mapping | Risk owned by alignment | Alignment fix batch | Conditional risk |
| Compat field names | plainFallbackHitCount / hasToneRelaxed | Diagnostics DTO | Residual debt | Dedicated cleanup | **No** (Gate A still PASS) |
| SUPERSEDED audit body still says KEEP underfill | Tone Unsupported audit § KEEP | Docs | Docs hygiene | Banner strengthen | **No** |
| Production Path ≠ Lattice Path enum | orchestrator vs harness | Architecture | Known | Phase cutover later | No for 1.1C Recall |

---

## 22. Before / After Comparison

| Metric | Pre-1.1C (GT Phase2 node, Plain-era) | Post-1.1C expected without Tone payload |
|--------|--------------------------------------|----------------------------------------|
| Plain Candidates | Present | **0 (by design)** |
| Tone Candidates | Partial / optional | Only if pattern ready |
| Total Candidates | 2692 (hist) | Sharp drop without Tone |
| LexicalEdges | 1610 | Drop |
| Fallback Edges | 2042 | May rise for connectivity |
| Complete Path | via fallback | Still possible via fallback edges; lexical-only worse |

**解释：** 删除非法 Plain ≠ 实现错误。是否“足以支撑系统”必须在 **真实 Tone+WTS** 上重测；当前 **无法判定支撑充分性**。

---

## 23. Contract Consistency

| Check | Result |
|-------|--------|
| CR 1.0.8 vs code | **ALIGNED** |
| Dev/Test reports vs Gate A | **ALIGNED** |
| INTERFACE_FREEZE plainFallbackHitCount | **ALIGNED** (always-0) |
| SUPERSEDED Tone Unsupported audit | Header OK；**body still contains “KEEP underfill plain_fallback”** — easy to misread |

**MODIFY-FUTURE (docs only):** 在 SUPERSEDED 文件顶部增加整页失效横幅，并划掉 KEEP-underfill 段落。

---

## 24. KEEP

- `resolveToneRecallReadiness` SSOT
- Tone-only Runtime composite / exact-tone APIs on Recall path
- Plain Runtime APIs for non-Tone / contract uses
- 1.1A / 1.1B semantics
- Acoustic ToneModule as sole pattern source
- `toneActive` as extract gate (≠ readiness)

## 25. MODIFY-FUTURE

- Rename/clarify `syllableCount = rawEnd-rawStart` vs true syllable span
- Persist `wordTimeSpans` alongside `acousticToneSlices` in E2E/dialog archives
- Extend Phase1/2 probes to consume real Tone+WTS
- Strengthen SUPERSEDED doc banners
- Reclassify Candidate-miss reasons: `TONE_NO_PATTERN` etc. (not all `NO_LEXICON_HIT`)

## 26. DELETE-FUTURE

- `plainFallbackHitCount` / `plain_fallback_hits` (dedicated diagnostics cleanup)
- `hasToneRelaxed` production meaning (or entire bit if unused)
- Historical experiment scripts that treat plain stages as live strategy (archive only)

---

## 27. Blocking Issues

1. **INCOMPLETE real Tone replay package** for dialog_200 (slices without wordTimeSpans, or GT without either).
2. Therefore **Gate B/C coverage acceptance cannot PASS**.
3. Per mandate: **CLOSURE = CONDITIONAL；READY FOR NEXT BATCH = NO**.

## 28. Non-Blocking Issues

1. Compat field naming debt.
2. SUPERSEDED audit body leftover wording.
3. Production LTR vs Lattice Path harness divergence (pre-existing architecture).
4. live harness dict path env flake (Test Report).

---

## 29. Target List

```text
[x] 核实生产调用链
[x] 核实 Readiness 唯一 SSOT
[x] 核实 Tone Recall Plain SQL=0
[x] 全仓审计 Plain 残留
[x] 审计兼容诊断字段
[x] 审计字符跨度与音节跨度
[x] 审计 timestamp 时间基准
[x] 审计 Tone slice 完整性（机制层）
[x] 评估真实 Tone payload 可用性 → INCOMPLETE
[x] dialog_200 / 等价语料：确认无法完成 Coverage Acceptance
[x] 输出 Coverage / Alignment / Lattice 表（N/A + 原因）
[x] 分类根因 Owner
[x] 核对 SSOT 文档
[x] 输出 Closure Audit
[ ] 真实配对 Tone+WTS dialog_200 重跑（阻塞项，未完成）
```

---

## 30. Check List

```text
[x] 本轮未修改代码
[x] 本轮未修改测试
[x] 本轮未修改 Contract
[x] 未恢复 Plain
[x] 未新增 fallback / 双链路 / 开关
[x] 未进入 1.1D / Batch 2 / Production Cutover
[x] 未用模拟 Tone 宣称覆盖率通过
[x] 未用单元测试代替运行验收
[x] 未隐瞒缺失数据（明确 INCOMPLETE）
[x] 结论均有代码或归档证据
```

---

## 31. Closure Decision

### Gate A — SSOT / 残留：**PASS**

```text
Tone → Plain 生产路径 = 0
Underfill Plain = 0
Plain SQL from Mandatory Tone Recall = 0
Readiness Decision Owner 唯一
无 shadow / compat / feature flag
无无法解释的旧 helper（生产）
```

### Gate B — Tone Readiness：**FAIL / 不可测 → 阻塞**

无法测 ≥95% / 90% 线。

### Gate C — Timestamp / Pattern：**不可测 → 阻塞**

机制风险已识别（char span vs slices）。

### Gate D — Lattice 可达性：**观察不足**

Pre-1.1C 数据不可直接外推；主瓶颈在 **Tone Coverage 数据**，其次才是 Lexicon / Hard Block / Path。

---

## 19.4 Residual Code（要求表）

| Symbol | Remaining References | Production Reachable | Verdict |
| ------ | -------------------: | -------------------- | ------- |
| lookupPlainTiers / needPlainFallback / dedupe / plain_only_no_pattern | 0 | No | CLEAN |
| plain_fallback stage assign | 0 | No | CLEAN |
| plainFallbackHitCount / plain_fallback_hits | diagnostics aggregate | Yes (always 0) | DELETE-FUTURE |
| hasToneRelaxed | Edge evidence + path count | Yes (always false from Tone Recall) | DELETE-FUTURE |
| lookupBaseByPinyinKey / ExactSurface plain | Runtime + tests | Yes, **not** Tone Recall chain | KEEP |
| Tone Recall → Plain APIs | 0 | No | PASS |

---

## Recommended Next Steps（不在本轮实施）

1. **数据归档契约：** E2E/dialog 持久化 `acousticToneSlices` **与** `wordTimeSpans`（或可重建的 ASR word timestamps）成对落盘。  
2. **Coverage Probe：** 基于配对数据重跑 Lattice windows，输出 §10–12 全表。  
3. **Alignment 专项：** 评估是否应以 `syllableEnd-syllableStart` 或 token-mapped counts 替代 `rawEnd-rawStart`（独立 Contract Change）。  
4. **Diagnostics cleanup：** 删除/重命名 plainFallback* / hasToneRelaxed。  
5. **仅当 Gate B/C PASS 后** 再开 Batch 1.1D。

**禁止建议：** 恢复 Plain、underfill Plain、optional Tone 开关、ASR 文本反推 Tone 等价替代、LLM 猜 Tone。

---

## Final Block（mandatory）

```text
BATCH 1.1C MANDATORY TONE RECALL FINAL CLOSURE

SSOT:
ALIGNED

TONE READINESS OWNER:
UNIFIED

TONE → PLAIN PRODUCTION PATHS:
ZERO

UNDERFILL PLAIN PATHS:
ZERO

PLAIN SQL FROM MANDATORY TONE RECALL:
ZERO

DEAD / LEGACY CODE:
CLEAN

REAL TONE DATA:
INCOMPLETE

TONE READINESS RATE:
N/A

PATTERN LENGTH MATCH RATE:
N/A

TONE CANDIDATE HIT RATE:
N/A

LEXICAL COMPLETE PATH RATE:
N/A

PRIMARY BOTTLENECK:
TONE_COVERAGE

BATCH 1.1C CLOSURE:
CONDITIONAL

READY FOR NEXT BATCH:
NO
```
