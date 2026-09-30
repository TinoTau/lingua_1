# Lingua FW Repair V4 — Normalization and Lexicon Foundation Development Report

**Date:** 2026-08-18  
**Stage:** RECALL_FOUNDATION_COMPLETION_V1 (Phase D/E)  
**dialog_200:** not used as vocabulary source

**Artifacts:** `training/model2_v3/experiments/v3_stage_j_live_dialog200/recall_foundation_completion_2026_08_18/`

---

## 1. Gates that authorized development

| Gate | Result |
|------|--------|
| ACCOUNTING_GATE | PASS |
| NORMALIZATION_GATE | PASS (restore existing OpenCC only) |
| LEXICON_COMPLETION_GATE | PASS (authoritative single-char TSV available) |

No Model2 / FineSpan / Assembly / Budget / KenLM / training change.

---

## 2. Accounting (Phase A)

True-recall units **405**, mutually exclusive waterfall:

| Terminal state | N |
|----------------|--:|
| LEXICON_COVERAGE_GAP | 345 |
| QUERY_GENERATION_GAP | 34 |
| EXPECTED_NON_CANDIDATE_RECOVERY | 22 |
| SUCCESS_POST_BUDGET | 4 |
| **Sum** | **405** |

### 367 vs 345

`target_missing = 367` counts lexicon absence.  
`LEXICON_COVERAGE_GAP = 345` is the **failure** class.

Difference **22**: units that are missing from lexicon **but** `MATERIALIZABLE_TARGET_V1 lexical_recoverable=true` via some other trace candidate surface. They are **EXPECTED_NON_CANDIDATE_RECOVERY**, not coverage-gap failures.

Per-unit list: `recall_367_vs_345_reconciliation.json`.

### 26 vs 4

`405 − 379 = 26` non-failures (`lexical_recoverable=true`).

Of those 26:

- **4** have union materialization of the expected surface and survive budget → `SUCCESS_POST_BUDGET`
- **22** recover only at the V1 observation layer (no expected-target union candidate) → `EXPECTED_NON_CANDIDATE_RECOVERY`

Per-unit list: `recall_26_vs_4_reconciliation.json`.

---

## 3. Normalization restore (Phase B/E)

**Frozen owner:** one FW Repair script-normalization owner, applied **before** lexical recall, reusing existing `opencc-js/t2cn`.

**Not redesigned:** IME alignment OpenCC remains alignment-only; `ctx.rawAsrText` is not mutated; `segmentForJobResult` still comes from V4 apply on the **canonical repair surface**.

| Surface | Owner after restore |
|---------|---------------------|
| raw ASR | `ctx.rawAsrText` (trace) |
| FW Repair input | `normalizeForFwRepairInput` at orchestrator |
| IME alignment | existing `normalizeForImeAlignment` (idempotent on already-simplified) |
| JobResult text | replacements applied on canonical repair text |
| semantic_repair OpenCC | still outside FW V4 |

**Idempotence:** `點→点`, `熱→热`, `鐵→铁`; simplified input unchanged; ASCII/digits preserved; NFKC may fold some punctuation. Tests in `normalize-for-fw-repair.test.ts`.

---

## 4. Lexicon completion (Phase C/D/F)

### Single-char

Frozen design (Lattice Contract 1.0.2+): length-1 **base-only exact**, cap=1, no domain/fuzzy/vote, inventory ~2000–3000.

Current sqlite before: **0** enabled length-1 rows → `FROZEN_DESIGN_DATA_MISSING` (not cancelled design).

Authoritative source: `docs/pinyin-v2/import/single_char_dictionary.tsv`  
(`common-standard-level-1+pinyin-data`, **2510** unique surfaces). **Not** dialog_200 expectedText.

Import via production Full Rebuild (`full-rebuild-from-csv.mjs`), then promote `_rebuild_candidate` → `node_runtime/lexicon/v3`.

| Metric | Before | After |
|--------|-------:|------:|
| base length-1 enabled | 0 | 2510 |
| term length-1 enabled | 0 | 2510 |
| base/term total | 9256 | 11766 |
| domain length-1 | 0 | 0 |

Recall routing unchanged: length-1 still **base-only exact**. Domain table has no length-1 rows.

dialog_200 overlap with this inventory is a **measurement** column (`dialog200_seen=73/2510`), not the import set.

### Multi-char

Missing true-recall 2/3/4+ targets were classified for coverage measurement only.

**Not imported:** any term whose only support is dialog_200 `expectedText`.

| Length | Coverage-gap missing (audit) | Imported this round |
|--------|-----------------------------:|--------------------:|
| 2-char | 60 VALID_* candidates | 0 |
| 3-char | 29 VALID_* candidates | 0 |
| 4+ | idiom/fixed-expression candidates (not auto-import) | 0 |

Full rebuild still loads the existing multi-char SSOT (`full_rebuild_v1` + idiom JSONL).

---

## 5. SQLite rebuild validation

- Pipeline: `npm run lexicon:full-rebuild -- --force`
- `sources.manifest.json` hash for `terms_to_remove_or_rebuild.csv` updated to the on-disk SSOT file (stale hash blocked rebuild; content not invented)
- bundleVersion **13**
- checksum matches sqlite
- missing pinyin: 0
- missing tone: 0
- duplicate `(pinyin_key, word)`: 0
- multi-domain tags: unchanged 655 rows (not collapsed to one-term-one-domain)

Runtime SSOT: **only** `node_runtime/lexicon/v3/lexicon.sqlite`. No JSON/config/hard-coded/test/shadow vocabulary added.

---

## 6. Frozen components

| Component | Status |
|-----------|--------|
| Model2 checkpoint | UNCHANGED `d66847be010f0953382243c7cc664a683e37bf6d112f33b463b68eb7fbeabeda` |
| FineSpan architecture | UNCHANGED |
| Assembly | UNCHANGED |
| Candidate budget | UNCHANGED |
| KenLM | UNCHANGED |
| Training | NO |

---

## 7. dialog_200 regression

Real Node completed: **200/200**, `m2=INVOKED`, out-dir `recall_foundation_completion_2026_08_18/dialog200_after/`.

Acceptance numbers, waterfall-after, and decisions are in:

`docs/user_correction/Lingua_FW_Repair_V4_Recall_Foundation_Dialog200_Acceptance_Report_2026_08_18.md`
