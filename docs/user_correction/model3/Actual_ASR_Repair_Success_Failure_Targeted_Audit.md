# Actual ASR Repair Success / Failure Targeted Audit

Generated: 2026-09-10  
Phase: `ACTUAL_ASR_REPAIR_SUCCESS_FAILURE_TARGETED_AUDIT`  
Mode: READ_ONLY / TARGETED / EXISTING-TRACE-ONLY  
RUN_ID: `dialog200_full_pipeline_20260909_001141`

## Verdict

`ACTUAL_ASR_REPAIR_AUDIT_PASS_DOMINANT_BREAKPOINT_FOUND`

```text
DOMINANT_BREAKPOINT = NO_USEFUL_RECALL_CANDIDATE (14/15)
ONE_NEXT_AUDIT = RECALL_USEFUL_CANDIDATE_TARGETED_AUDIT
PRODUCTION_CODE_CHANGE = NONE
MODEL3_REOPEN_REQUIRED = NO
RETRY_ARCHITECTURE_REOPEN_REQUIRED = NO
ARCHITECTURE_CHANGE_REQUIRED = NO
```

## Scope

| Group | Count | Selection |
|-------|------:|-----------|
| SUCCESS (`ASR_REPAIR_PARTIAL_IMPROVEMENT`) | 2 | all from normalized baseline CSV |
| FAILURE (`ASR_REPAIR_UNCHANGED` + content error) | 15 | caseId-sorted equal-interval from 167 |
| Total analyzed | 17 | stop — dominant pattern proven |

Failure IDs: d006, d020, d032, d046, d060, d074, d089, d101, d114, d130, d141, d155, d168, d182, d194  
Success IDs: d084, d184

## Measurement gap (not production change)

This RUN_ID compact dump has:

- `fine_span_surfaces` always `[]`
- `windowText` / `spanSurface` / retry `query`/`window`/`start`/`end` null

FineSpan coverage uses **OBSERVATIONAL** proxy: `model3.decisions[].surface` (spanId `fine:…`).  
Recorded as `MEASUREMENT_GAP` only — no instrumentation this phase.

## First pass (text only)

All 15 failures: `RAW ERROR EXISTS = YES`.  
Final content change: **15/15 = NONE** (normalized RAW==FINAL).

## Success cases — what actually improved

### d084

- Actual content change: **扫马 → 扫码** (CER/distance 4→3)
- Residual errors remain (打爆麻 / 结一下张 …)
- Path: FineSpan exposed `扫马` → Recall `base_candidates` already contained **扫码** → assembly/KenLM pool had both sentences → **KenLM SELECTED** 扫码 sentence

### d184

- Actual content change: **乘客互 → 客户** (plus engine-interface variant cleanup); distance 11→10
- Many residuals remain
- Path: Recall/Retry already had **客户** → full-sentence variants in KenLM input → **KenLM SELECTED** 客户 sentence

**Contrast vs failures:** successes are cases where a useful lexical candidate was **already present upstream of KenLM** and selected. Failures almost never show that candidate for the local probe.

## Failure breakpoint distribution

| earliest_proven_breakpoint | count |
|----------------------------|------:|
| NO_USEFUL_RECALL_CANDIDATE | 14 |
| TRACE_INSUFFICIENT | 1 |

Dominant threshold `>= 8/15`: **YES** (`NO_USEFUL_RECALL_CANDIDATE` = 14/15).

## Required answers

| # | Answer |
|---|--------|
| A | d084: 扫马→扫码 via existing Recall cand + KenLM select. d184: 乘客互→客户 via Recall/Retry cand + KenLM select. Both partial only. |
| B | Useful opportunity reached **KenLM selection** (furthest stage). |
| C | Most common earliest breakpoint: **NO_USEFUL_RECALL_CANDIDATE** (14/15). |
| D | FineSpan usually **observationally exposes** the probe error surface (14/15 YES; dump lacks native span list). |
| E | Recall **usually does not** show a useful fix candidate for the probe (15/15 NO_USEFUL). |
| F | Model2 **not** observed as introducing useful expansions for these probes. |
| G | Domain/SameDomain survival **NOT_OBSERVABLE** in this dump (no per-candidate post-domain list). |
| H | Model3/Retry **not** the earliest dominant block; most paths already RETRY but still no useful cand for probe. `MODEL3_REOPEN_REQUIRED=NO`. |
| I | Assembly rarely reached because useful lexical cand absent; not dominant owner. |
| J | Some cases have secondary closer KenLM sentences, but **not** earliest breakpoint vs missing probe lexical cand. Cap16 still `NOT_CURRENT_ISSUE`. |
| K | **YES** — 14/15 `NO_USEFUL_RECALL_CANDIDATE`. |
| L | **YES** — next owner audit: `RECALL_USEFUL_CANDIDATE_TARGETED_AUDIT` (does **not** mean Recall algorithm rewrite; next must split lexicon/query/pinyin/cap). |
| M | **NO** production code change this phase. |

## Freeze

```text
MODEL3 = KEEP FROZEN
RETRY_ARCHITECTURE = KEEP FROZEN
FULL_MAINLINE = KEEP FROZEN
LINGUA_DIALOG200_BASELINE_V1 = KEEP FROZEN
LINGUA_ASR_REPAIR_NORMALIZED_BASELINE_V1 = KEEP
```
