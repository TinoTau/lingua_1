# Lingua FW Repair V4 — Single-Char Lexicon Storage Strategy Audit

**Date:** 2026-08-21  
**Stage:** `FW_REPAIR_V4_SINGLE_CHAR_LEXICON_STORAGE_STRATEGY_AUDIT`  
**Mode:** AUDIT ONLY  
**Verdict:** **OPTION_B_RECOMMENDED**

Artifacts: `training/model2_v3/experiments/v3_stage_j_live_dialog200/single_char_lexicon_storage_strategy_audit_2026_08_21/`

---

## 1. Inputs

- Runtime state audit 2026-08-21: length-1 = IME 2510 exact; CLD sets GENERATED_ONLY
- Model2 single-char retirement: Model2 = P/D ONLY; length-1 owned by Lexicon Recall
- Recall Foundation 2026-08-18: IME TSV imported to fill empty length-1 (`TEMPORARY_OR_UNJUSTIFIED_DATA_ROLE` as Repair vocab)
- Lexical-validity / grouping audits: curated inventory needed; HOLD_NO_IMPORT on Strict/Balanced as production list; LICENSE_REVIEW_REQUIRED for CLD-derived
- IME contract: `DICTIONARY.md` — IME TSV ≠ Lexicon v3 sqlite

---

## 2. base_lexicon ownership

| Question | Answer |
|----------|--------|
| Purpose | FW Repair base-tier lexical inventory for Recall |
| Allows length-1? | **YES** (Lattice base-only exact design) |
| Current length-1 | 2510 IME mirror |
| Intended as final Repair vocab? | **No** — foundation fill only |

---

## 3. Consumers & IME

Production IME V2 loads **`single_char_dictionary.tsv`**, not sqlite length-1.

Only production path that *needs* sqlite length-1 for product behavior is **FW length-1 Recall**. Secondary: IME export dumps all `base_lexicon` (no length filter) — tooling coupling, not IME SSOT.

Domain Vote / Assembly / KenLM / Model2 P/D do not query `base_lexicon` for length-1 policy.

→ Rule 52 safety for future delete/rebuild of mirrored 2510: **satisfied for IME**; Recall impact is intentional replacement.

---

## 4. Option comparison (summary)

| | A Separate table | B Rebuild length-1 in base |
|--|------------------|----------------------------|
| New table | YES | NO |
| Collector change | YES | NO |
| Schema change | YES | NO |
| Ops | HIGH | MEDIUM |
| Duplicate Repair authority risk | HIGH unless carefully emptied | LOW if single curated source |
| IME isolation | Table-level | Already TSV-level |
| Fits “base lexical term” | Over-separates | Natural |

Polyphonic: PK `(pinyin_key, word)` → different-syllable heteronyms YES; same-syllable multi-tone rows NO (**PARTIAL**, pre-existing). Does not force Option A.

Prior: IME weights must not survive; both options can remap; column reusable.

Rebuild: no length-1-only patch tool; **PARTIAL** scoped via Full Rebuild + swap `singleCharSource`.

---

## 5. Recommendation

**OPTION B.**

Keep IME TSV. Stop mirroring it into Repair. Put curated Repair singles into `base_lexicon` length-1. Reuse collector/query. One Repair SSOT. No Model2 / FineSpan / Assembly / KenLM / Domain Vote / JobResult changes.

Clarify vs 2026-08-19 “two-layer” wording: two **data products** (IME vs Repair), not two **sqlite tables**.

---

## 6. Next (not executed)

1. Final curated word-list selection (Strict/Balanced/other) — still open; grouping HOLD remains for list quality  
2. LICENSE_REVIEW if CLD-derived  
3. Rebuild **planning** ACP: source path swap, prior mapping, export length filter hygiene, test updates  
4. No import/rebuild in this round

---

AUDIT STOP. No sqlite write, no import, no delete, no schema change, no Model2 change.
