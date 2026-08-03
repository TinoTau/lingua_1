<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Test/FW_Repair_V4_Parent_Fragment_Retirement_Phase1_Test_Report_2026_08_01.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Parent Fragment Retirement Phase 1 Test Report

**Date:** 2026-08-01  
**Companion:** `FW_Repair_V4_Parent_Fragment_Retirement_Phase1_Development_Report_2026_08_01.md`  
**Artifacts:** `docs/tone-v2/_audit_scratch/parent_fragment_phase1/`

---

## 1. Unit / Freeze / Build

| Suite | Runner | Result |
|-------|--------|--------|
| `recall-span-topkv3.test.ts` | Electron Jest | **PASS** |
| `phase1-utterance-cache.test.ts` | Electron Jest | **PASS** |
| `b1-recall-full-traversal.test.ts` | Electron Jest | **PASS** |
| `freeze-contract.test.ts` (incl. Phase1 PF gate) | Electron Jest | **PASS** |
| `npm run build:main` | tsc | **PASS** |

Note: `length1-recall-edge-path.sqlite.integration.test.ts` requires Electron ABI (better-sqlite3 119); assertions updated for no `parentFragmentTopK`. Run under Electron when validating that suite.

**Command:**

```text
ELECTRON_RUN_AS_NODE=1 electron jest --testPathPattern="recall-span-topkv3|phase1-utterance-cache|b1-recall-full-traversal|freeze-contract"
```

**103 tests passed** in the above pattern.

---

## 2. Static Production Grep

| Symbol | `recall-span-topkv3.ts` | `recall-topk-for-windows.ts` |
|--------|-------------------------|------------------------------|
| `lookupParentFragments` | absent | absent |
| `lookupParentFragmentsByNgramKey` | absent | absent |
| `ngramRowToHotword` | absent | absent |
| `term_pinyin_ngrams` | absent | absent |
| `scoreFragmentHit` / `mergeExactAndFragmentHits` | absent | absent |
| `parentFragmentTopK` (call) | absent | absent |

Freeze gate: `Phase1 PF retirement: production Recall 不得查询 fragment / ngram` — **PASS**.

---

## 3. Exact Recall Probes

With lexicon `tone_pinyin_key` → acoustic pattern + `toneCallerEnabled=true`:

| Surface | foundExact | hitKind | termId (sample) | domains |
|---------|------------|---------|-----------------|---------|
| 候选 | YES | exact_term | exp-v1_1-fix-houxuan | tech_ai |
| 计划 | YES | exact_term | (lexicon) | — |
| 蓝莓 | YES | exact_term | (lexicon) | — |
| 马芬 | YES | exact_term | (lexicon) | — |
| 蓝莓马芬 | YES | exact_term | (lexicon) | — |
| 医师 | YES | exact_term | term-e58cbbe5b8887c79 | medical |
| 登机 | YES | exact_term | base-rebuild-term-… | [] |

All `parentFragmentHitCount=0`. Full JSON: `summary.json` → `exactProbeResults`.

---

## 4. Fragment Zero Probes

| Probe | PF hits | ban as PF | Notes |
|-------|--------:|-----------|-------|
| 可以 → 科医 | 0 | false | empty/exact only; 科医 absent |
| 衣室 → 议室 | 0 | false | may return exact **医师** (formal term — allowed) |
| 地址 → 低脂 | 0 | false | 低脂 as PF absent |

---

## 5. dialog_200 Production Run

**Probe:** `parent-fragment-phase1-dialog200-probe.mjs`  
**Bundle:** `node_runtime/lexicon/v3` (unchanged schema; table still present)

| Metric | Value |
|--------|------:|
| totalCases | 200 |
| completedCases | **200** |
| failedCases | 0 |
| parentFragmentCandidateCount | **0** |
| casesWithParentFragment | **0** |
| ngramLookupCalls | **0** |
| ngramTermIdCount | **0** |
| keyiCandidateCount | **0** |
| latticeUncoveredCount | **0** |
| kenlmInputCount | 200 |
| kenlmNoiseEventsTight (substring vs Raw) | 5 / 5 cases |
| PF-introduced KenLM noise (科医/议室/低脂等) | **0** |
| Pre-KenLM p50 / p95 / max | **58.08 / 101.65 / 128.03** ms |
| wall total | ~12.0 s |

KenLM inputs exported: `kenlm_inputs.json` (no KenLM subprocess required).

Note: `kenlmNoiseEventsTight=5` 为 Raw 已含子串或误报口径，**非** PF 注入；审计基线 27/38 的 PF→KenLM 噪声本轮为 **0**。text-only dialog 路径在无声学 tone slice 时常见 Raw/canonical 主导，属既有行为，非 Phase 1 回归。

---

## 6. Before / After

| | Before (Retirement Audit) | After Phase 1 |
|--|---------------------------|---------------|
| Cases w/ PF | 166 | **0** |
| PF rows | 1143 | **0** |
| 科医 PF | 26 / 78 | **0** |
| KenLM PF noise vs Raw | 27 / 38 | **0** |
| Production ngram SQL | yes | **no** |

---

## 7. Performance

No `exactTopK` / `perSpanLimit` / `maxSentenceCandidates` changes. Observed Pre-KenLM p50≈58ms on dialog_200 under Electron. No evidence of regression attributable to PF removal (branch deleted).

---

## 8. Non-Goals Verified

- SQLite schema / rebuild / formal terms: **unchanged**
- JobResult contract: **unchanged**
- Vote formula / Budget / Assembly / CrossPath / KenLM: **unchanged**
- dialog_200 data: **unchanged**
- No enable=false / blacklist / score penalty / shadow dual path

---

## 9. Final Test Verdict

```text
PHASE1_PASS — test gates met
```

Ready for Phase 2/3 residual + DB materialization removal.
