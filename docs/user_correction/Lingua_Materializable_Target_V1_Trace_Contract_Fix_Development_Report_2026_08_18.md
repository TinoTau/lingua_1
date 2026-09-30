# Lingua MATERIALIZABLE_TARGET_V1 Trace Contract Fix — Development Report

**Date:** 2026-08-18  
**Stage:** MATERIALIZABLE_TARGET_V1_TRACE_FIX + DIALOG200_AUTHORITATIVE_REANALYSIS  
**Nature:** DIAGNOSTIC FIX only — no FineSpan / Assembly / Model2 / training / dialog_200 changes

---

## 1. What was wrong

Stage-J funnel used one `hasTarget` predicate at every layer:

- Budget: candidate **surface** substring of expected (counts unchanged ngrams such as 「今天」)
- Assembly: same predicate on **whole sentence** (misses partial repairs such as 「蓝莓」)

That produced INVALID **142 → 26** and a 126-wide `ASSEMBLY_DROP` bucket.

Old Stage-J artifacts are retained under `LEGACY_TARGET_ATTRIBUTION`. They must not drive go/no-go.

---

## 2. What changed (diagnostics only)

| File | Role |
|------|------|
| `tests/lib/materializable-target-v1.mjs` | NEW contract |
| `tests/lib/materializable-target-v1.test.mjs` | 12/12 PASS |
| `tests/lib/dialog200-path-trace-analyze.mjs` | `flattenFunnel` / `firstDivergence` / `attributeFailure` now V1; `legacy_*` fields kept |
| `docs/user_correction/scripts/reanalyze_materializable_target_v1.mjs` | offline reanalysis of existing 200 Stage-J traces |

**Production business code modified: 0**  
**Runtime behavior changed: NO** (no ASR rerun; traces reused)  
**dialog_200 modified: NO**  
**Training: NO**

---

## 3. Contract tests

Synthetic cases cover: unchanged ngram, single/multi substitute, insert, delete, overlapping span, wrong span, eligible span, partial vs full assembly. `node --test` → 12/12 PASS.

---

## 4. Authoritative funnel (existing Stage-J traces)

See `training/model2_v3/experiments/v3_stage_j_live_dialog200/materializable_target_v1_2026_08_18/`.

Dialog-level flags require **all** required correction units.

| | Count |
|--|--:|
| Dialogs | 200 |
| Correction units | 601 |
| Dialogs requiring correction | 175 |
| Lexical recoverable (all units) | 6 |
| Path recoverable | 1 |
| Sentence recoverable | 1 |
| Actually assembled | 1 |
| KenLM available | 1 |
| Final correct | 25 |

Partial (any unit): lexical 30 / path 25 / assembled 22 dialogs.  
Unit-level: lexical 36 / path 33 / assembled 28 of 601.

Of 552 lexical-miss units, 325 are length ≤1 (includes traditional/simplified 點→点 etc.). Contract does **not** fold script variants.

---

## 5. First divergence V2 (175 failures)

| Class | N | % |
|-------|--:|--:|
| LEXICAL_RECALL_MISS | 169 | 96.6% |
| FINESPAN_NO_COVERAGE | 5 | 2.9% |
| KENLM_RANK_ERROR | 1 | 0.6% |

`ASSEMBLY_DROP` is gone.

V1 true assembly materialization failure: **0** (previous 24 do not survive the strict path+sentence+not-assembled test).

---

## 6. Previous 97→59

**Not authoritative after the contract fix.** That gap mixed unchanged ngrams into “lexical”. Recomputed eligibility gap is **10 units / 5 dialogs** (see FineSpan audit).

---

## 7. Decision

- Trace contract: **FREEZE** MATERIALIZABLE_TARGET_V1
- Next phase by largest class: **RECALL_AUDIT**
- Assembly: **KEEP FROZEN**
- FineSpan: **MORE_AUDIT_REQUIRED** only for the 10-unit binding gap — not a license to change frozen eligibility this round
