<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Development/FW_Repair_V4_Parent_Fragment_Retirement_Phase2_3_Development_Report_2026_08_02.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Parent Fragment Retirement Phase 2/3 Development Report

**Date:** 2026-08-02  
**Scope:** PHASE 2 + PHASE 3 — remove internal residuals + delete `term_pinyin_ngrams` materialization + clean schema rebuild  
**Verdict:** **FULL_RETIREMENT_PASS**

---

## 1. Executive Summary

```text
FULL_RETIREMENT_PASS

parent_fragment / term_pinyin_ngrams
已从生产代码、内部类型、配置、数据库 schema、
build/rebuild/patch、测试和 CURRENT 文档中彻底移除。

唯一 exact Recall 主链正常，
正式词召回、Lattice、Vote、Assembly、CrossPath 未受破坏。

新词库已 clean rebuild，
Node 已加载新 schema/hash，
生产不存在 fragment fallback、shadow 或兼容残留。
```

| Gate | Result |
|------|--------|
| schemaVersion | **lexicon-v3-runtime-v3** |
| bundleVersion | **11** |
| term_pinyin_ngrams table | **absent** |
| ngram API on Runtime | **absent** |
| dialog_200 | **200/200** |
| parent_fragment / ngram:* | **0 / 0** |
| Lattice uncovered | **0** |
| Exact probes | **PASS** |
| Pre-KenLM p50/p95 | **39.3 / 69.3 ms** (Phase1: 58.1 / 101.7) |
| SQLite size | **85.9 MB → 10.8 MB** |

---

## 2. Phase 1 Baseline

Phase 1 already achieved production PF Recall = 0, ngram SQL = 0, dialog_200 200/200. Residuals remaining (API/types/schema/build) are removed in this phase.

---

## 3. Exact Recall Entry Final Consolidation

| Item | Result |
|------|--------|
| SSOT Owner | **`recallSpanTopKV2`** |
| Production call-site | `recall-topk-for-windows.ts` → **direct V2** |
| `recallSpanTopKV3` | **DELETED** (file + tests) |
| Alias / deprecated wrapper | **none** |

---

## 4. Internal Type Cleanup

Deleted / narrowed:

- `WindowCandidateHitKind` → `'exact_term'` only  
- `parentTerm*` / `matchedTerm*` / `fragmentTonePinyinKey` on WindowCandidate  
- `ParentTermNgramRow`  
- `parent_fragment` from cache / vote / diagnostics unions  
- `parent-term-slice.ts` (dead)

**JOBRESULT_ADAPTER_DEBT (kept):**

- `SpanAssemblyV4Metrics.parentFragmentHitCount` / `parentTermVoteCount` — always emit **0**

---

## 5. Lattice Residual Cleanup

Deleted:

- `LexicalEdgeRecallEvidence.hasParent`
- `structuralEvidence.parentEdgeCount`
- path sort key `parentEdgeCount ASC`

Other sort dimensions / weights unchanged.

---

## 6. Compatibility Cleanup

Deleted:

- `sameParentTermOverlapCompatible`
- `parentTermCompletenessScore` + PF branch in `classifyOverlapRelation`
- diagnostics mapper parentTermId compatibility branches

Retained: range overlap / coverage / replacement containment / general compatibility.

---

## 7. Domain Vote Residual Cleanup

Deleted:

- ``parent:${parentTermId}`` structural key
- `parentTermVoteCount` internal increment loop

Kept field on vote/metrics result as **0** (JobResult contract).  
Retention ratio / multi-domain rules **unchanged**.

---

## 8. Configuration and Cache Cleanup

Deleted:

- `V4_LIMITS.parentFragmentTopK` / `perParentTermPerWindow`
- `CoarseAssemblyLimits` PF fields

Utterance cache remains **v2** namespace (Phase 1); no further algorithm change; no old-key fallback.

---

## 9. Repository and SQL Removal

Deleted from `LexiconRuntimeV2`:

- `stmtNgram`
- `lookupParentFragmentsByNgramKey`
- ngram query counters / `getNgramQueryStats*`
- load-time prepare of `term_pinyin_ngrams`

`getPhysicalStatementStats` is tier-only.

---

## 10. Schema Removal

New SQLite schema **never creates** `term_pinyin_ngrams` or `idx_term_ngram_*`.

Gate asserts:

```sql
SELECT COUNT(*) FROM sqlite_master
WHERE type='table' AND name='term_pinyin_ngrams'
→ 0
```

---

## 11. Build / Patch Pipeline Cleanup

| Artifact | Action |
|----------|--------|
| `materialize-term-ngrams.mjs` | **DELETED** |
| `build-v2-shadow-bundle.mjs` | no CREATE/INSERT ngrams |
| `term-materialize.mjs` | ngram rematerialize removed |
| `run-homophone-variant-cleanup.mjs` | ngram DELETE branches removed |
| `manifest-writer` / `sqlite-table-stats` / patch thresholds | ngrams removed |
| `run-patch-e2e-runner.mjs` | no ngramCount>0 assert |

**HISTORICAL_ONLY:** `alias-homophone-legality-audit.mjs` still optionally reports ngram count if a legacy DB happens to contain the table (defensive audit tool, not production path).

---

## 12. Manifest and Version Changes

| Field | Before | After |
|-------|--------|-------|
| schemaVersion | `lexicon-v3-five-table-v2` | **`lexicon-v3-runtime-v3`** |
| bundleVersion | 10 | **11** |
| tables.ngrams | 4200 | **removed** |
| Constants | `V3_SCHEMA_VERSION_V2` / `LEXICON_V3_FIVE_TABLE_V2_*` | **`V3_SCHEMA_VERSION_V3` / `LEXICON_V3_RUNTIME_V3_*`** |

Gate thresholds updated to Full Rebuild SSOT scale (`base≈term`, not legacy 50k seed).

---

## 13. Clean Rebuild

**Note on build chain:**

- `npm run lexicon:build:v2-shadow` now emits **ngram-free** shadow schema (verified). Seed-only shadow does **not** equal current production Full Rebuild term content (domain/term counts differ).
- To satisfy “不得修改正式 term 内容” + “新建库从未创建 ngram 表”, production used:

```text
npm run lexicon:retire:parent-fragment-schema
  → retire-parent-fragment-schema-rebuild.mjs
  → NEW sqlite copy of SSOT tables (no ngrams)
  → schema lexicon-v3-runtime-v3 / bundleVersion 11 / new checksum
npm run lexicon:gate:v3-runtime  → PASS
```

Backup of prior bundle: `node_runtime/lexicon/v3/_backup_pf_retirement_2026-08-01T13-33-49-242Z`

Forbidden path avoided: in-place DROP on old handle.

---

## 14. New Runtime Bundle Identity

| Field | Value |
|-------|-------|
| path | `D:\Programs\github\lingua_1\node_runtime\lexicon\v3\lexicon.sqlite` |
| schemaVersion | `lexicon-v3-runtime-v3` |
| bundleVersion | 11 |
| checksum | `sha256:d6e77ce9139a489cf17ad0bec83814aa7685d02037bc3870187a80bf47abf34a` |
| loadedManifestVersion | `lexicon-v3-runtime-v3` |
| file size | 10,817,536 bytes |
| term / base / idiom / domain | 10061 / 10061 / 22192 / 1033 |

---

## 15. Static Residual Search

Production `main/src` hits for PF symbols are limited to:

- freeze / negative tests asserting **absence**
- `JOBRESULT_ADAPTER_DEBT` always-0 fields/comments
- cache comment “parentFragmentTopK removed”

No production callable ngram / PF path remains.

---

## 16–20. Regressions / Comparisons

See **Test Report**. Highlights:

- Exact: 候选/计划/蓝莓/马芬/蓝莓马芬/医师/登机 all `exact_term`
- Fragment zero: 科医/议室/低脂 as PF = 0 (衣室 may exact-hit 医师 — allowed)
- dialog_200: 200/200, uncovered 0, KenLM inputs 200, introduced noise 0
- Performance improved (no PF SQL branch + smaller DB)
- Vote / Assembly / CrossPath algorithms untouched

---

## 21. JobResult Contract Boundary

```text
JOBRESULT_ADAPTER_DEBT
extra.fw_detector.spanAssemblyV4.parentFragmentHitCount → 0
extra.fw_detector.spanAssemblyV4.parentTermVoteCount → 0
```

Field names retained pending independent consumer audit. Internal PF types/mechanism removed.

---

## 22. Remaining Independent Tasks

1. JobResult consumer audit → then delete diagnostic 0 fields  
2. Formal compound atomicity（上线计划 / 接口文档）  
3. KenLM optimization  
4. Optional: archive HISTORICAL experiment scripts still mentioning five-table-v2  

---

## 23. Target List Result

| ID | Result |
|----|--------|
| T1–T10 | **PASS** |
| T11 | **PASS** (JobResult fields kept as 0) |
| T12–T19 | **PASS** |
| T20–T26 | **PASS** |
| T27 | **PASS** (TONE_FIRST CURRENT banner + README) |
| T28–T29 | **PASS** |
| T30 | **PASS** |

---

## 24. Check List Result

```text
[x] 唯一 exact Recall 入口 / 删除 V3 包装
[x] 删除 repository API / stmtNgram / ParentTermNgramRow
[x] 删除 parent_fragment hitKind / parentTerm fields / hasParent / parentEdgeCount
[x] 删除 PF Compatibility / Vote key / 配置 / cache 维
[x] JobResult 合同未改字段名
[x] 删除 schema + indexes + materialization + patch rematerialize + manifest ngram stats
[x] 升级 schemaVersion / bundleVersion；clean rebuild；新 checksum；加载新 hash
[x] exact / PF=0 / Lattice / dialog_200 200/200 / 性能未退化
[x] 静态 grep 无生产残留；CURRENT 文档已更新
[x] 未处理正式组合 term / KenLM
[x] 已生成开发与测试报告
```

---

## 25. Final Verdict

```text
FULL_RETIREMENT_PASS

parent_fragment / term_pinyin_ngrams
已从生产代码、内部类型、配置、数据库 schema、
build/rebuild/patch、测试和 CURRENT 文档中彻底移除。

唯一 exact Recall 主链正常，
正式词召回、Lattice、Vote、Assembly、CrossPath 未受破坏。

新词库已 clean rebuild，
Node 已加载新 schema/hash，
生产不存在 fragment fallback、shadow 或兼容残留。
```
