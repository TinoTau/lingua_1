# Lingua FW Repair V4 — Recall Foundation dialog_200 Acceptance Report

**Date:** 2026-08-18  
**Stage:** RECALL_FOUNDATION_COMPLETION_V1 (Phase F/G)  
**Profile:** NO_PROFILE  
**Artifacts:** `training/model2_v3/experiments/v3_stage_j_live_dialog200/recall_foundation_completion_2026_08_18/`

---

## 1. Round result

| Gate | Result |
|------|--------|
| Recall Foundation Round | **PASS** |
| ACCOUNTING_GATE | PASS (Phase A, 405 units conserved) |
| dialog_200 | **200/200**, `m2=INVOKED`, valid Model2 measurement |
| same-raw false intervention | **0** |
| dialog_200 used as vocabulary source | **NO** |
| Model2 / FineSpan / Assembly / Budget / KenLM / training | **UNCHANGED** |

This round completed the frozen product foundation (OpenCC restore + authoritative 2510 single-char import + sqlite rebuild + real Node regression). It did **not** convert dialog_200 into a sentence-level accuracy lift. Remaining bottlenecks are query generation and candidate materialization, not missing single-char inventory.

---

## 2. Real Node run

| Field | Value |
|-------|-------|
| Runner | `tests/run-dialog200-stagej-full-path-trace.mjs --arm stagej` |
| Out dir | `recall_foundation_completion_2026_08_18/dialog200_after/` |
| n | 200/200 |
| wall clock | 731 s |
| Model2 checkpoint | `expA_frozen_trunk.pt` sha256 `d66847be010f0953382243c7cc664a683e37bf6d112f33b463b68eb7fbeabeda` (match) |
| liveness | live_utterances=200, disabled_or_load_failed=0, errors=0 |

ASR is non-deterministic across runs. Sentence-level 25→24 is **not** a lexicon regression; the same-raw subset is the regression authority.

---

## 3. MATERIALIZABLE_TARGET_V1 funnel (dialog)

| Dialog funnel | Before | After |
|---------------|-------:|------:|
| requiring_correction | 175 | 176 |
| lexical_recoverable | 6 | 4 |
| path_recoverable | 1 | 0 |
| sentence_recoverable | 1 | 0 |
| actually_assembled | 1 | 0 |
| kenlm_available | 1 | 0 |
| **final_correct** | **25** | **24** |

Correction units: 601 → 603. Unit-level `lexical_recoverable` 36 → 41; `assembled` 28 → 34. Dialog-strict all-units flags did not rise.

First divergence (dialogs): LEXICAL_RECALL_MISS 169→172, FINESPAN_NO_COVERAGE 5→4, KENLM_RANK_ERROR 1→0.

---

## 4. True-recall waterfall (AFTER this ASR run)

AFTER true-recall units = **402** (not the Phase-A 405; unit set follows this ASR surface).

| Terminal state | Before (405) | After (402) |
|----------------|-------------:|------------:|
| LEXICON_COVERAGE_GAP | 345 | 160 |
| QUERY_GENERATION_GAP | 34 | 59 |
| EXPECTED_NON_CANDIDATE_RECOVERY | 22 | 20 |
| SUCCESS_POST_BUDGET | 4 | 8 |
| CANDIDATE_MATERIALIZATION_GAP | (not a before-primary class) | 155 |

Coverage gap dropped because 2510 single-char rows now exist in sqlite. Those units mostly moved into **CANDIDATE_MATERIALIZATION_GAP** (in lexicon, FineSpan/query did not materialize the expected surface into union) or **QUERY_GENERATION_GAP**. FineSpan was not changed this round.

---

## 5. Normalization effect

| Metric | Before | After |
|--------|-------:|------:|
| SCRIPT_NORMALIZATION units (V1 raw vs expected) | 145 | 153 |

FW Repair entry now canonicalizes with existing OpenCC `t2cn` + NFKC. `ctx.rawAsrText` is preserved. MATERIALIZABLE_TARGET_V1 still derives script units from **raw ASR vs expected**, so remaining count is an ASR-surface traditional/simplified mismatch, **not** a recall-success class, and is not expected to fall because of the repair-path restore.

This AFTER run emitted more traditional raw ASR (see `false_intervention_analysis.json` samples d034/d035/d080). That increases V1 script units; it does not mean OpenCC is missing on the repair path.

---

## 6. Single-char effect

Sqlite length-1 enabled: **0 → 2510** (authoritative TSV, not expectedText).

True-recall length-1 units on AFTER run:

| | n | in_lexicon | raw_hit | union materialized |
|--|--:|-----------:|--------:|-------------------:|
| AFTER | 224 | 206 | 206 | 0 |

Target coverage **0 → 206/224**. Remaining 18 are outside the frozen 通用规范一级 inventory; they were **not** backfilled from dialog_200.

Zero union materialization with 206 raw lexicon hits is a **query/materialization** fact under frozen FineSpan 1-char exact, not an inventory miss.

---

## 7. Multi-char effect (no import this round)

Audit-time valid missing (coverage classification only; `general_source_supported=false`):

| Length | Valid missing (audit) | Imported |
|--------|----------------------:|---------:|
| 2-char | 60 | 0 |
| 3-char | 29 | 0 |
| 4+ | 0 (not auto-import) | 0 |

AFTER true-recall:

| Length | n | in_lex | coverage_gap | materialized |
|--------|--:|-------:|-------------:|-------------:|
| 2 | 93 | 34 | 59 | 8 |
| 3 | 31 | — | 31 | — |
| 4+ | 54 | — | 54 | — |

---

## 8. Regression

same-raw subset: **104** dialogs (`raw` string equal).

| Transition | n |
|------------|--:|
| correct→correct | 15 |
| correct→wrong | **0** |
| wrong→correct | 0 |
| wrong→wrong | 89 |

Overall correct→wrong = 3, all `ASR_CHANGED` (traditional raw this run). **False intervention on same-raw = 0.**

Candidate volume:

| | mean | P50 | P95 | max |
|--|-----:|----:|----:|----:|
| Before | 18.065 | 19 | 24 | 24 |
| After | 18.075 | 19 | 24 | 24 |

---

## 9. Lexicon quality (promoted v3)

| Check | Value |
|-------|-------|
| Duplicate `(pinyin_key, word)` | 0 |
| Missing pinyin | 0 |
| Missing tone | 0 |
| Invalid / empty domain tags | 0 |
| term_domain_tags | 655 (unchanged) |
| multi-domain terms | 44 (not collapsed) |
| Runtime SSOT | `node_runtime/lexicon/v3/lexicon.sqlite` only |
| bundleVersion | 13 |
| checksum | `sha256:eb7f6e32955c559fc2ce9faf8b46be5071bbf226beb7cb8a0713434f7ac725b7` |

---

## 10. Decision rationale

- **Normalization FREEZE:** owner restored; remaining script units are V1 raw-surface accounting, excluded from recall success.
- **Single-char FREEZE:** frozen 2000–3000 design filled from authoritative source (2510). Do not add the leftover 18 from expectedText.
- **Multi-char MORE_WORK:** no authoritative general vocabulary source; import forbidden.
- **FineSpan NEXT_SECONDARY_AUDIT:** QUERY_GENERATION_GAP 34→59 and new CANDIDATE_MATERIALIZATION_GAP=155. Do not patch FineSpan in this round.
- **Primary remaining bottleneck:** candidate materialization of in-lexicon targets (esp. length-1) plus FineSpan query generation; residual multi-char coverage gap without a general source.

Recommended next phase: FineSpan 1-char fallback vs multi-char lexical replacement audit (spec §66). No training.
