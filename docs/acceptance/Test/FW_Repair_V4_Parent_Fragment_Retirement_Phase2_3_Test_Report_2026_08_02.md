<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Test/FW_Repair_V4_Parent_Fragment_Retirement_Phase2_3_Test_Report_2026_08_02.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Parent Fragment Retirement Phase 2/3 Test Report

**Date:** 2026-08-02  
**Companion:** `FW_Repair_V4_Parent_Fragment_Retirement_Phase2_3_Development_Report_2026_08_02.md`  
**Artifacts:** `docs/tone-v2/_audit_scratch/parent_fragment_phase23/`

---

## 1. Typecheck / Build

| Check | Result |
|-------|--------|
| `npm run build:main` | **PASS** |

---

## 2. Unit / Freeze / Integration (Electron ABI)

```text
ELECTRON_RUN_AS_NODE=1 electron jest --testPathPattern=
  freeze-contract|phase1-utterance-cache|b1-recall-full-traversal|
  domain-presence-vote|candidate-span-assembly-eligibility|
  enumerate-complete-segmentation|classify-overlap|recall-span-topk-v2
```

| Metric | Value |
|--------|------:|
| Suites | **13 passed** |
| Tests | **204 passed** |

Includes: freeze PF-absence gates, vote/eligibility rewritten to exact_term, V2 length-1 sqlite integrations, cache v2 key.

---

## 3. Schema / Manifest / Checksum / Gate

| Check | Result |
|-------|--------|
| `npm run lexicon:gate:v3-runtime` | **PASS** |
| schemaVersion | `lexicon-v3-runtime-v3` |
| bundleVersion | 11 |
| checksum match | **YES** |
| `term_pinyin_ngrams` table | **0** |
| `idx_term_ngram_*` | **0** |
| tables.ngrams in manifest | **absent** |

Runtime identity recorded in probe `summary.json.runtimeIdentity`.

---

## 4. Static Residual Grep (production)

| Symbol | Production callable path |
|--------|--------------------------|
| `lookupParentFragments*` | **0** |
| `stmtNgram` | **0** |
| `ParentTermNgramRow` | **0** |
| `recallSpanTopKV3` | **0** (deleted) |
| `parentFragmentTopK` (config) | **0** |
| `term_pinyin_ngrams` CREATE/prepare | **0** |
| `hasParent` / `parentEdgeCount` | **0** |

Remaining mentions: freeze negative asserts, JOBRESULT always-0 debt, retirement scripts asserting absence.

---

## 5. Exact Recall Probes

| Surface | found | hitKind | termId (sample) | domains | score |
|---------|-------|---------|-----------------|---------|------:|
| 候选 | YES | exact_term | exp-v1_1-alias-houxuan | tech_ai | 2.42 |
| 计划 | YES | exact_term | base-rebuild-exp-v1_1-alias-jihua | [] | 2.42 |
| 蓝莓 | YES | exact_term | base-rebuild-term-… | [] | 2.35 |
| 马芬 | YES | exact_term | term-e9a9ace88aac7c6d | bakery | 2.35 |
| 蓝莓马芬 | YES | exact_term | term-e8939de88e93e9a9 | bakery,food_order | 2.40 |
| 医师 | YES | exact_term | term-e58cbbe5b8887c79 | medical | 2.35 |
| 登机 | YES | exact_term | base-rebuild-term-… | [] | 2.36 |

All `termId` non-`ngram:*`. Source: formal term exact recall.

---

## 6. Fragment Zero Probes

| Probe | PF hits | ban as PF | Notes |
|-------|--------:|-----------|-------|
| 可以→科医 | 0 | false | empty hits |
| 衣室→议室 | 0 | false | exact **医师** allowed |
| 地址→低脂 | 0 | false | empty hits |

---

## 7. dialog_200 Production Chain

Probe: `parent-fragment-phase23-dialog200-probe.mjs`

| Metric | Value |
|--------|------:|
| totalCases | 200 |
| completedCases | **200** |
| failedCases | 0 |
| parentFragmentCandidateCount | **0** |
| ngramTermIdCount | **0** |
| ngramApiAbsent | **true** |
| ngramTableCount / Index | **0 / 0** |
| latticeUncoveredCount | **0** |
| kenlmInputCount | 200 |
| kenlmIntroducedNoiseVsRaw | **0** |
| Pre-KenLM p50 / p95 / max | **39.27 / 69.25 / 108.69** ms |
| wall total | **8.37 s** |

Note: `formalExactCandidateCount` path-walk counter may read 0 when candidates live only on edges; exact probes + lattice coverage are the authoritative proofs.

---

## 8. Candidate / Domain Vote / Assembly

| Check | Result |
|-------|--------|
| PF candidates | 0 |
| fragment-only domain evidence | 0 (no PF inputs) |
| Vote formula / retention ratio | unchanged |
| Budget / Assembly / CrossPath | unchanged |
| KenLM input export | 200 texts |

---

## 9. Performance Before / After

| Metric | Phase 1 | Phase 2/3 |
|--------|--------:|----------:|
| Pre-KenLM p50 | 58.08 | **39.27** |
| Pre-KenLM p95 | 101.65 | **69.25** |
| max | 128.03 | **108.69** |
| wall | ~12.0 s | **8.37 s** |
| SQLite size | 85.9 MB | **10.8 MB** |

No `exactTopK` / cap retuning. Improvement attributed to removed PF SQL + smaller DB.

---

## 10. Non-Goals Verified

- dialog_200 data unmodified  
- JobResult field names unmodified  
- Formal compounds（上线计划 / 接口文档） unmodified  
- KenLM / Vote / Budget / Assembly / CrossPath algorithms unmodified  

---

## 11. Final Test Verdict

```text
FULL_RETIREMENT_PASS — all Phase 2/3 test gates met
```
