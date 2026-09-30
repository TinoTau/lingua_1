# Lingua — Retry Region Recall / Lexicon Coverage Audit

**Phase:** `RETRY_REGION_RECALL_LEXICON_COVERAGE_AUDIT`  
**Date:** 2026-08-28  
**Mode:** Strict read-only  
**Verdict:** **PASS_EXPECTED_COVERAGE_GAPS**

---

## Executive summary

All 8 `REFERENCE_NOT_REACHABLE` controlled Retry cases were traced through Retry region → selected lattice path → FineSpan windows → pinyin/tone → Recall → Lexicon lookup. Failures decompose into **expected coverage gaps** (missing Lexicon terms, frozen window boundaries, tone/homophone recall limits, unrepairable references). **No systemic Recall contract defect** was found across cases.

---

## Controlled set

| Metric | Value |
|--------|------:|
| Controlled Retry | 13 |
| Reference Reachable | 5 |
| Reference Not Reachable | 8 |
| Audited Not-Reachable | 8 / 8 |

Structural chain (from prior validation, unchanged): Lattice 13/13, tone evidence 13/13, 2-char lexical edges 6/13, >1 path 6/13, segmentation changed 3/13.

---

## First-missing-point ownership

### By repair unit (26 units)

| Classification | Count |
|----------------|------:|
| LEXICON_MISSING | 9 |
| WINDOW_BOUNDARY | 13 |
| EXPECTED_UNREPAIRABLE | 3 |
| PHONETIC_RECALL_MISS | 1 |
| TONE_MISMATCH | 1 |
| DOMAIN_SCOPE | 0 |
| CANDIDATE_BUDGET_LOSS | 0 |
| STRUCTURAL_REVIEW_REQUIRED | 0 |
| OTHER | 2 |

### By case (8 cases)

| Classification | Count |
|----------------|------:|
| LEXICON_MISSING | 3 |
| WINDOW_BOUNDARY | 1 |
| EXPECTED_UNREPAIRABLE | 2 |
| PHONETIC_RECALL_MISS | 1 |
| TONE_MISMATCH | 1 |

---

## Case verdicts

### d099 — EXPECTED_UNREPAIRABLE

- **Region:** 苏和步 → reference SOHO  
- **First miss:** Latin transliteration SOHO is outside Lexicon phonetic contract.  
- **Secondary:** Reference 不 belongs to separate region (赌不堵), not recoverable from 苏和步 phonetics.  
- Recall on 苏|和|步 produces 苏/和/步 homophones only.

### d131 — LEXICON_MISSING

- **Region:** 意识规则要是 → reference 更衣室柜子钥匙  
- **Required units:** 更衣室 ❌, 柜子 ❌, 衣室 ❌, 钥匙 ✅, 规则 ✅, 意识 ✅  
- **First miss:** 更衣室 absent from authoritative Lexicon (earliest blocking unit).  
- **Secondary:** Even where terms exist (钥匙), selected path windows (意识|规|则|要是) never expose a 钥匙 span. Recall on 意识 returns ASR-homophone 意识.

### d160 — WINDOW_BOUNDARY

- **Region:** 顺便向木李 → reference 项目里  
- **项目** ✅ in Lexicon (`xiang|mu`, tone 44).  
- **Selected path:** 顺|便|向|木|李 (all single-char FineSpans).  
- **First miss:** No 2-char window covers 向+木, so Recall never queries the phonetic span that could retrieve 项目. Self-surface probe on 项目 succeeds; per-window probes on 向 and 木 return only 向/木.  
- Valid consequence of frozen single-char segmentation path, not a Recall implementation bug.

### d176 — LEXICON_MISSING

- Same structure as d131 (更衣室/柜子/衣室 missing).

### d049 — EXPECTED_UNREPAIRABLE

- **Region:** 理 (from 理工科…) → reference utterance-start **李工**  
- **李工** ❌ in Lexicon; **李** ✅ but Retry window is 理 not 李.  
- **First miss:** Insertion repair at utterance start is outside bounded Retry region semantics.

### d002 — TONE_MISMATCH

- **Region:** 背 → reference 杯  
- **杯** ✅ (`bei1`); window 背 (`bei4`).  
- **Recall from 背:** returns 背 only.  
- **First miss:** Authoritative acoustic tone bei4 prevents bei1 candidate under existing tone-aware Recall contract.

### d003 — LEXICON_MISSING

- **Region:** 烟 → proxy 燕; full reference 燕麦  
- **燕** ❌; **烟** ❌; **燕麦** ✅  
- **Recall from 烟:** 0 hits.  
- **First miss:** Proxy target 燕 absent. **燕麦** would need 烟麦 2-char window (WINDOW_BOUNDARY secondary).

### d019 — PHONETIC_RECALL_MISS

- **Region:** 成 → reference 城  
- **城** ✅ (`cheng2`); **成** ✅ (`cheng2`).  
- **Recall from 成:** returns 成 only (exact-surface homophone contract).  
- **First miss:** Homophone 城 not emitted by existing single-char Recall behavior.

---

## Systemic defect check

| Check | Result | Evidence |
|-------|--------|----------|
| Systemic Recall contract defect | **NO** | Failures use different mechanisms (Lexicon gap, window span, tone, homophone exact-surface). No shared valid candidate class blocked by one implementation path. |
| Systemic FineSpan/Lattice defect | **NO** | Lattice/tone pass 13/13; d160 window limit is expected for all-single-char path. |
| Lexicon coverage gap | **YES** | 更衣室, 柜子, 衣室, 李工, 燕 absent; affects d131/d176/d003/d049 secondarily. |

---

## Module ownership

| Module | Verdict |
|--------|---------|
| Model3 | KEEP |
| Retry Region | KEEP |
| FineSpan | KEEP |
| Lattice | KEEP |
| Recall | KEEP |
| Lexicon | COVERAGE_GAP |
| Domain Vote | KEEP |
| Assembly | KEEP |

Candidate budget: all 8 cases show `survivedLocalCap=true`, `survivedGlobalBudget=true`; loss at Recall/reference match, not cap.

---

## Dialog_200

**Status:** DIALOG_200_ENV_BLOCKED  

**Command:**
```
ELECTRON_RUN_AS_NODE=1 electron.exe tests/run-dialog200-model3-acceptance.mjs --skip-start --anchored-only --max-minutes 0.5
```

**Error:** Preflight passed (53 anchored cases filtered) then hung waiting for test server with `--skip-start` (no ASR node on port). No pipeline cases executed. Process killed after ~378s.

**Production code modified to run:** NO

---

## Training gate

**MODEL3 TRAINING GATE: OPEN**

Retry structural chain is sound. Remaining failures are explainable as Lexicon coverage, frozen window boundaries, tone/homophone recall limits, and expected-unrepairable references. Model3 trigger quality remains separable from repairability.

**Next phase:** `MODEL3_V1_TRAINING_COVERAGE_FOR_RETRYABLE_LOCAL_REGIONS`

**Lexicon follow-up (decision only):** `LEXICON_COVERAGE_DECISION_REQUIRED` for missing terms — do not auto-add in this phase.

---

## Governance

| Item | Value |
|------|-------|
| Production code modified | NO |
| Report artifact count | 5 |
| ≤10 artifacts | YES |

**Artifacts:**
1. `Lingua_Retry_Region_Recall_Lexicon_Coverage_Audit_2026_08_28.md` (this file)
2. `retry_region_recall_coverage_cases.csv`
3. `retry_region_recall_coverage_units.csv`
4. `retry_region_recall_coverage_summary.json`
5. `retry_region_recall_coverage_governance.json`

---

## Evidence probes (read-only)

Authoritative Lexicon bundle: `node_runtime/lexicon/v3`  
Environment: `ELECTRON_RUN_AS_NODE=1` + `electron.exe`

Key probe results:
- `recall(背)` → 背 (not 杯) — tone bei4 vs bei1  
- `recall(成)` → 成 (not 城) — homophone exact-surface  
- `recall(烟)` → ∅ — 烟/燕 absent  
- `lookup(项目)` → exists; `recall(向)` → 向, `recall(木)` → 木  
- Missing: 更衣室, 柜子, 衣室, 李工, 燕
