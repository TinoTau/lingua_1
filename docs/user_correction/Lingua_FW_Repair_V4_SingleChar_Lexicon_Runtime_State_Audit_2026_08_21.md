# Lingua FW Repair V4 — Single-Char Lexicon Runtime State Audit

**Date:** 2026-08-21  
**Stage:** `FW_REPAIR_V4_SINGLE_CHAR_LEXICON_RUNTIME_STATE_AUDIT`  
**Mode:** AUDIT ONLY (no sqlite write, no import, no code change, no training)  
**Verdict:** **FILTER_NOT_IMPLEMENTED**

Artifacts: `training/model2_v3/experiments/v3_stage_j_live_dialog200/single_char_lexicon_runtime_state_audit_2026_08_21/`

---

## 1. Questions answered

| Q | Answer |
|---|---|
| A. Collector data source | `LexiconRuntimeV2.lookupBaseByPinyinAndToneKey` → SQLite `base_lexicon` |
| B. How many singles | **2510** enabled rows / **2510** unique characters |
| C. Provenance | **IME 2510** `single_char_dictionary.tsv` (Full Rebuild 2026-08-18) |
| D. CLD/Strict/Balanced imported? | **NO** — GENERATED_ONLY / HOLD_NO_IMPORT |
| E. Only wordhood-validated singles? | **NO** — still common-character IME universe |

---

## 2. Runtime path (post Model2 rollback)

Length-1 remains Lexicon Recall only:

`collectBaseOnlySingleCharCandidate` → tone-exact SQL on `base_lexicon` (`enabled=1 AND length(word)=1`) → eligibility (enabled, length 1, not alias, prior>0) → unique-only / surface-exact / fail-closed.

Model2 single-char symbols absent from production TS/host. Rollback preserved.

Active identity: `node_runtime/lexicon/v3` **bundleVersion 13**, checksum MATCH `sha256:eb7f6e32955c559fc2ce9faf8b46be5071bbf226beb7cb8a0713434f7ac725b7`.

Manifest explicitly records:

```text
singleCharSource.path = docs/pinyin-v2/import/single_char_dictionary.tsv
singleCharSource.recordCount = 2510
```

---

## 3. Inventory facts (read-only export)

| Metric | Value |
|---|---:|
| Enabled length-1 rows | 2510 |
| Unique characters | 2510 |
| Unique pinyin+tone keys | 982 |
| Disabled length-1 | 0 |
| Domain length-1 enabled | 0 |
| Idiom length-1 enabled | 0 |
| Source | `common-standard-level-1+pinyin-data` (2500) + `-extra-function` (10) |

Priors are IME role weights (0.08…0.30), not CLD frequencies. No wordhood/POS/CLD columns on `base_lexicon` → **NO_WORDHOOD_EVIDENCE_IN_RUNTIME**.

---

## 4. Comparisons (character set equality)

| Set | Overlap | Runtime only | Set only | Exact equal |
|---|---:|---:|---:|---|
| IME 2510 TSV | 2510 | 0 | 0 | **YES** |
| CLD STRICT (1125) | 927 | 1583 | 198 | NO |
| CLD BALANCED (1420) | 1149 | 1361 | 271 | NO |
| CLD FULL (3913) | 2348 | 162 | 1565 | NO |

Count coincidence with STRICT (1125) does **not** apply: runtime is 2510 and is **not** the Strict set.

---

## 5. Filtering status

| Mechanism | Status |
|---|---|
| Content cleaned to curated repair lexicon | **NOT_IMPLEMENTED** |
| Runtime logic filters by wordhood/CLD membership | **NOT_IMPLEMENTED** |
| Runtime query filters (tone, unique-only, prior>0, base-only) | Implemented, but do **not** exclude “common but non-standalone” characters |

**Conclusion:** “排除无独立成词意义的常用单字” **没有落地**。落地的是 2026-08-18 Recall Foundation 把 IME 2510 填进 `base_lexicon`（0→2510）。CLD lexical-validity / grouping 审计停留在 CSV + reports（HOLD_NO_IMPORT）。

Candidate universe classification: **IME_COMMON_CHARACTER_INVENTORY** (mirrored into generic length-1 base_lexicon rows).

---

## 6. Example characters (comparison only)

| Char | Runtime | Source | Strict | Notes |
|---|---|---|---|---|
| 毫 | PRESENT | IME TSV prior 0.08 | absent | Classic homophone risk case still eligible |
| 涡 | PRESENT | IME TSV prior 0.08 | absent | Same |
| 皿 | PRESENT | IME TSV prior 0.12 | absent | Not in CLD full either |
| 酯 | ABSENT | — | absent | In CLD full only; never imported |

---

## 7. Historical dataset classes

| Dataset | Class |
|---|---|
| IME 2510 TSV | **ACTIVE_RUNTIME_SOURCE** |
| CLD Full / Strict / Balanced CSVs | **GENERATED_ONLY / AUDIT_ONLY** |
| Pre-2026-08-18 empty length-1 | SUPERSEDED |

---

## 8. Decision

Previous filtering work (CLD wordhood separation) **did not reach runtime**.  
Current runtime single-char lexicon is **not** production-ready as a repair lexicon (known from lexical-validity audit; reconfirmed by set equality with IME 2510).

Primary gap: active length-1 universe is still the IME common-character inventory, not an independent lexical repair inventory.

Recommended next phase (audit only — do not execute here): product decision on whether to introduce a **separate** curated single-char repair table/import under LICENSE_REVIEW, while keeping IME 2510 for IME; no Model2 reintroduction.

---

AUDIT STOP. No import / rebuild / delete / training performed.
