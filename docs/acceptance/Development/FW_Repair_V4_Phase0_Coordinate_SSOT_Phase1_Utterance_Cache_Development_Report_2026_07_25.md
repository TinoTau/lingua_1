<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Development/FW_Repair_V4_Phase0_Coordinate_SSOT_Phase1_Utterance_Cache_Development_Report_2026_07_25.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

> **HISTORICAL / SUPERSEDED (Fine Span architecture)** — 2026-07-26  
> LTR-only / unique FormalFineSpan / cursor-commit / windows 2..5-as-SSOT claims in this document are **not** current Architecture SSOT.  
> Current authority: `FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md`  
> Original text retained as historical evidence. Do not treat as active freeze.
# FW Repair V4 — Phase 0 Coordinate SSOT + Phase 1 Utterance Cache Development Report

| Field | Value |
|-------|-------|
| Date | 2026-07-25 |
| Scope | Phase 0 + Phase 1 only |
| Probe | `docs/tone-v2/phase0_phase1_utterance_cache_probe.json` |
| Plan | `FW_Repair_V4_Utterance_Recall_Cache_Local_SQLite_Batch_Development_Plan_2026_07_25.md` |

---

## 1. Executive Summary

本轮完成 **FineSpan 音节坐标 SSOT（Phase 0）** 与 **句内 Utterance Recall Cache（Phase 1）**。

| Gate | Verdict |
|------|---------|
| Phase 0 | **PASS** |
| Phase 1 | **PASS WITH LOW CACHE HIT RATE** |
| Semantic Equivalence | **100% EQUIVALENT** |
| Next Step | **READY FOR PHASE 2 SQL PROTOTYPE** |

关键实测（dialog_200 offline GT text，Electron ABI，每 case 冷 Global LRU）：

- **200 / 200** success（原 197/200 的 d009/d099/d189 已修复）
- 语义 A/B：**200/200** 指纹一致
- 句内 cache hit：**22 / 5551**（≈ **0.40%**）
- `physicalSqlStatementCount`：Before **11034** = After **11034**（未增加）
- P95 assembly：75 → 74 ms；P99：84 → 84 ms（无异常尾延迟）

---

## 2. Changed Files

| Area | Files |
|------|-------|
| Phase 0 SSOT | `pinyin-ime-v2-pinyin-stream.ts`, `pinyin-ime-v2-boundary-compatible-topk-diff.ts`, `ltr-fine-span-generator.ts`, `coarse-boundary-import.ts`, `span-assembly-v4-orchestrator.ts` |
| Phase 1 Cache | `utterance-recall-cache.ts` (new), `recall-topk-for-windows.ts`, `v4-types.ts`, `lexicon-runtime-v2.ts` |
| Tests | `phase0-coordinate-ssot.test.ts`, `phase1-utterance-cache.test.ts` |
| Probe / Report | `_audit_scratch/phase0-phase1-utterance-cache-probe.mjs`, `phase0_phase1_utterance_cache_probe.json`, 本报告 |

---

## 3. Phase 0 Root Cause

生产可达错误（d009 / d099 / d189，均含 `SOHO`）：

```text
textToPinyinStream → Latin 进入 global syllable stream (s|o|h|o)
buildCharSyllableRanges / CoarseSpan → 仅映射 CJK
→ FineSpan index 与 Coarse 覆盖分裂
→ 尾部 syllable 无 Coarse 覆盖
→ [LTR_FINE_SPAN] unable to build fallback option
→ 整句 FW 后处理终止
```

分类：**BLOCKING CORRECTNESS BUG**（Latin+CJK 混排 ASR 文本生产可达）。

---

## 4. Coordinate SSOT Contract

唯一入口：

```ts
buildUtteranceSyllableCoordinate(rawText) → UtteranceSyllableCoordinate
```

合同：

| 字段 | 含义 |
|------|------|
| `syllables` | 仅 CJK 可召回音节（FineSpan coordinate） |
| `ranges` | 每个 CJK run 的 raw↔syllable 映射 |
| `coverage.coverageOk` | 每个 FineSpan syllable 恰有合法 raw range |

消费方：`textToPinyinStream`、`buildCharSyllableRanges`、CoarseSpan import、LTR window build、`syllableRangeToRawCharRange`、fallback。

**禁止**再分别解析 rawText 生成平行音节流。

---

## 5. Raw vs FineSpan Coordinate Example

`rawText = 去望京SOHO测试`

| Coordinate | Tokens / Indices |
|------------|------------------|
| Raw Character | `去望京 S O H O 测试` → 0..8 |
| FineSpan Syllable | `qu wang jing ce shi` → 0..4 |

Ranges：

| Syllable | Raw |
|----------|-----|
| qu | [0,1) |
| wang | [1,2) |
| jing | [2,3) |
| ce | [7,8) |
| shi | [8,9) |

Latin `SOHO` 保留在 raw，**不进入** FineSpan syllables。

---

## 6. Latin Gap Blocking

跨 raw gap `[3,7)` 的 window（如 `jing`+`ce`）经既有 `blockedFilter` 阻断，reason ∈ `{non_cjk_syllable, raw_gap_between_spans}`，**不进入 Recall**。

探针：`crossLatinGapRecallWindowCount = 0`。

未新增第二套 gap 判定。

---

## 7. Phase 0 Implementation

1. `buildUtteranceSyllableCoordinate`：CJK-run only 音节流 + ranges + coverage
2. Orchestrator：utterance 入口构建一次，注入 LTR；`coverageOk === false` fail-fast
3. CoarseSpan：同一 FineSpan index
4. LTR：接受注入的 `charSyllableRanges`，不再每 cursor 重建
5. `syllableRangeToRawCharRange`：多 CJK-run union，使 Latin gap 出现在 raw slice 供 blockedFilter 消费

---

## 8. Phase 0 Tests

| Suite | Result |
|-------|--------|
| `phase0-coordinate-ssot.test.ts` | PASS（含 SOHO / 混排 / LTR 单调） |
| latin mixed cases（探针） | **8 / 8** |
| dialog_200 offline | **200 / 200** |
| coverageInvariantFailures | **0** |

覆盖：d009、d099、d189（同文）、`去望京SOHO测试`、`去A酒店`、`USB接口坏了`、`WiFi密码是多少`、`去OK便利店`、`机场T2航站楼`。

---

## 9. RecallQueryKey Contract

序列化：

```text
v1|{kind}|{pinyinKey}|{toneNorm}|{sortedDomainScope}|{exactTopK}|{parentFragmentTopK}|{lexiconVersion}|{surfaceText}
```

| 规则 | 状态 |
|------|------|
| windowId / rawText / Prior 不进 key | ✅ |
| domainScope 排序；`undefined`≡`[]` | ✅ |
| tone 缺失 ≡ `''`（plain） | ✅ |
| 禁止 `JSON.stringify` 任意对象作 key | ✅ |
| topK 进 key（本轮不做 maxTopK reuse） | ✅ |

**surfaceText 进入 key 的原因**：见 §10 — V2/V3 `candidateScore` 依赖 `windowText`（WINDOW scoring），同 pinyin 不同 surface 不得共享 Fact。

---

## 10. windowText Dependency Audit

| 文件 | 函数 | 字段 | 使用阶段 | 是否影响 key | 结论 |
|------|------|------|----------|--------------|------|
| `recall-span-topk-v2.ts` | `scoreHotword` / `computeCandidateScore*` | `windowText` | WINDOW_BINDING_OR_SCORING | **YES** | 长度 bonus / edit distance → 进 Canonical key（`surfaceText`） |
| `recall-span-topk-v2.ts` | `alignVariantWindowText` | `windowText` | WINDOW_BINDING_OR_SCORING | **YES** | fuzzy 变体对齐 surface → 同上 |
| `recall-span-topk-v2.ts` | domain/base lookup | `termLength` / `pinyinKey` | FACT_LOOKUP_INPUT | via pinyin+topK | SQL Fact 不读 surface |
| `recall-span-topkv3.ts` | parent fragment score | `windowText` | WINDOW_BINDING_OR_SCORING | **YES** | 传入评分 → surface 进 key |
| `tone-first-tier-collector.ts` | tone tier | `acousticTonePattern` | FACT_LOOKUP_INPUT | **YES**（`toneNorm`） | 影响 tone 路径查询 |
| `lexicon-runtime-v2.ts` | `lookup*ByPinyinKey*` | key / termLength / domains | FACT_LOOKUP_INPUT | via pinyin/domains/topK | **无 windowText** |
| parent fragment SQL | `lookupParentNgrams` | pinyin ngram | FACT_LOOKUP_INPUT | via pinyin/domains | **无 windowText** |

结论：SQL Fact 本身不依赖 surface；但本轮缓存的是 **V3 打分后的 hits**（含 candidateScore），故 **surfaceText 必须进 key** 才能保证语义等价。

---

## 11. Fact / Window Separation

- Cache 存 `readonly LexiconFactHit[]`（`Object.freeze`）；含冻结的 V3 hit 快照以无损 rebind
- **不缓存** `WindowCandidate[]`（无 windowId / raw range / span score mutation 共享）
- `bindLexiconHitsToWindow`：每次命中后新建候选对象
- 测试验证：mutation rebound 候选 **不污染** Fact cache

调用序：

```text
Utterance Cache → miss → V2/V3 / Global LRU / SQLite → Fact → 写回 Utterance Cache → bind per window
```

---

## 12. Utterance Cache Lifecycle

| 规则 | 实现 |
|------|------|
| 单句 span assembly 开始创建 | `createUtteranceRecallContext` in orchestrator |
| 单句 LTR recall 结束后释放 | `releaseUtteranceRecallContext`（Vote/Sentence/KenLM 之前） |
| 不跨 utterance / 不进 Job/Scheduler/Web | ✅ |
| harness Baseline A | `enableUtteranceRecallCache: false`（仅测试；生产默认 true） |

---

## 13. Global LRU Relationship

| Cache | 职责 |
|-------|------|
| Global LRU 512 | 跨 utterance DB 结果 |
| Utterance Cache | 同句 Canonical key 去重 |

保留 Global LRU；不复制实现。Harness 用 `clearLookupCaches()` 做公平冷测（生产主链不调用）。

---

## 14. Metrics

Level 1（`SpanAssemblyV4Metrics`）：

`recallRequestCount`, `uniqueRecallKeyCount`, `duplicateRecallKeyCount`, `utteranceCacheHitCount`, `utteranceCacheMissCount`, `cacheHitRatio`, `logicalQueryCount`, `physicalSqlStatementCount`, `exactQueryCount`, `parentQueryCount`, 以及 build/lookup/bind/total ms。

SQL budget gate（`maxSqlPerUtterance = 150` 按 window attempt）**KEEP**；未加第二 gate。  
budget skip / SQL throw：**不写** utterance cache。

---

## 15. Semantic Diff

Counterfactual（仅 harness）：

- **A**：Phase 0 + 无 utterance cache  
- **B**：Phase 0 + utterance cache（生产）

比较 Formal FineSpan / Vote domain / retained / sentence texts / 候选字段指纹。

结果：**200/200 · semanticEquivalenceRate = 1.0** → **100% EQUIVALENT**。

---

## 16. dialog_200 Results

| Metric | Value |
|--------|-------|
| Success | **200 / 200** |
| Errors | **0** |
| Latin mixed (probe) | **8 / 8** |
| Cross-Latin gap recalled | **0** |

---

## 17. Performance Before / After

条件：每 case `clearLookupCaches()`；Pass A（无句内 cache）与 Pass B（有句内 cache）分趟。

| Metric | Before (A) | After (B) |
|--------|------------|-----------|
| assembly P50 | 40 ms | 40 ms |
| assembly P95 | 75 ms | 74 ms |
| assembly P99 | 84 ms | 84 ms |
| assembly Max | 118 ms | 95 ms |
| assembly Mean | 43.3 ms | 43.3 ms |
| physicalSql total | 11034 | 11034 |
| recallRequestCount | — | 5551 |
| uniqueRecallKeyCount | — | 5529 |
| duplicateRecallKeyCount | — | 22 |
| utteranceCacheHitCount | — | 22 |

验收：

- physicalSql **未增加** ✅  
- P95 未退化 >5% ✅  
- P99 无新增异常尾 ✅  
- duplicateKeyRatio ≈ **0.40%** → **如实报告低命中**（LTR 同句内相同 Canonical key 极少）

---

## 18. KEEP / MODIFY / DELETE

### KEEP

LTR loop · soft boundary · 2..5 + 1 fallback · shorter_exact_tiebreak · blockedFilter · Global LRU · Parent P1 · SQLite indexes · SQL budget gate

### MODIFY

FineSpan coordinate construction · Coarse/LTR ranges · Canonical RecallQueryKey · UtteranceRecallContext · Fact/Window bind · Recall metrics

### DELETE

无大规模死代码清理；仅统一 SSOT 后去掉 LTR 对已删除 `buildCharSyllableRanges` 的类型引用。

---

## 19. Risks

1. **低句内命中率**：当前 corpus 下 duplicate≈0.4%，句内 cache 对吞吐收益有限；主要价值在可观测性 + 为 Phase 2 batch 提供 key/metrics 基础。  
2. **surfaceText 进 key**：若未来 SQL-only Fact 投影剥离评分，可收紧 key、提高命中；本轮为保等价刻意保守。  
3. **physicalSql 依赖 tier 计数**：Global LRU hit 不计 SQL；探针必须冷 LRU 才可对比。  
4. harness `enableUtteranceRecallCache`：仅测试；不得演化为长期双链 flag。

---

## 20. Remaining Phase 2 Boundary

本轮**未**实现（且明确禁止）：

- Local SQLite Batch / `WITH requested` / ROW_NUMBER batch  
- Promise.all 并发 SQLite · Worker · 多连接 · Redis  
- parent short-circuit · Tone range cache · Sentence late-cap  

进入 Phase 2 的前置已满足：坐标正确 + 200/200 + 100% 语义等价 + Canonical key/metrics 就绪。

---

## 21. Final Verdict

| Item | Verdict |
|------|---------|
| Phase 0 | **PASS** |
| Phase 1 | **PASS WITH LOW CACHE HIT RATE** |
| Semantic Equivalence | **100% EQUIVALENT** |
| Next Step | **READY FOR PHASE 2 SQL PROTOTYPE** |

---

*Artifacts: `docs/tone-v2/phase0_phase1_utterance_cache_probe.json` · harness `docs/tone-v2/_audit_scratch/phase0-phase1-utterance-cache-probe.mjs`*
