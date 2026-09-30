# Single-Char Repair Lexicon V1 — Freeze Contract

**Status:** FROZEN  
**Effective:** 2026-08-23  
**Stage:** `SINGLE_CHAR_REPAIR_V1_FINAL_ACCEPTANCE_FREEZE`

---

## Purpose

FW Repair `base_lexicon` length=1 must contain only **standalone repair-eligible single characters**, not the IME 2510 common-character universe. V1 replaces the accidental IME mirror (2510 rows) with a curated **STRICT 1125** set at uniform prior **0.9**.

IME input and Repair recall remain **separate ownership domains**.

---

## Eligibility

Membership follows **SingleCharRepairEligibilityV1** (frozen in pre-development contract audits). A character enters V1 only when it satisfies standalone repair eligibility rules — not per dialog/test-case patching.

Historical STRICT/BALANCED selection reports are **audit evidence only**; they do not compete with this active contract.

---

## Data SSOT (ACTIVE)

| Item | Value |
|------|-------|
| Path | `docs/user_correction/single_char/single_char_repair_lexicon_v1.tsv` |
| Format | TAB: `surface`, `canonical`, `pinyin`, `tone_pinyin`, `weight`, `source` |
| Rows | **1125** unique one-character surfaces |
| Prior (`weight`) | **0.9** constant |
| Source label | `single-char-repair-v1-strict` |

**Contract SSOT (ACTIVE):** this document.

---

## Storage

| Domain | Owner | Storage |
|--------|-------|---------|
| FW Repair length=1 | Repair V1 | `base_lexicon` where `length(word)=1` |
| IME single-char | IME only | `docs/pinyin-v2/import/single_char_dictionary.tsv` |

No new table. No parallel V2 inventory. No IME2510 Repair mirror.

---

## Build Source

Full Rebuild loader reads V1 TSV via `DEFAULT_SINGLE_CHAR_TSV()` in `full-rebuild-from-csv.mjs`. Missing file **throws** — no IME fallback.

Export to IME sqlite uses `length(word) >= 2` filter so Repair length=1 rows are not exported into IME universe.

---

## Bundle Identity (Frozen Runtime)

| Item | Value |
|------|-------|
| Active bundle | `node_runtime/lexicon/v3` |
| bundleVersion | **14** |
| checksum | `sha256:59de38904560ee239582b4a9c863f312accaab1751f18678ecf0d2b215527e19` |
| manifest `singleCharSource` | `docs/user_correction/single_char/single_char_repair_lexicon_v1.tsv` |
| manifest `recordCount` | **1125** |

---

## Runtime Ownership

| Component | Single-char role |
|-----------|------------------|
| Recall collector | `collectBaseOnlySingleCharCandidate` → `lookupBaseByPinyinAndToneKey` on `base_lexicon` only |
| Model2 | **P/D ONLY** — no length=1 disambiguation path |
| Model3 | **NOT CREATED** for this path |
| minPrior | **0.5** (unchanged) |

Ambiguous same pinyin+tone → existing **fail-closed / unique-only** behavior preserved.

---

## Operations Ownership

Post-freeze daily operations on membership:

- **ADD** — must satisfy eligibility + operations reason/provenance
- **DISABLE**
- **CORRECT PRONUNCIATION**
- **CORRECT METADATA**

Must **not**:

- revert to IME2510 Repair mirror
- create a second single-char repair table
- patch membership from a single dialog/test case
- change eligibility principles without Architecture/Data Change Proposal + user approval

Coverage gaps discovered in measurement are recorded as **COVERAGE_GAP** — not auto-patched in V1.

---

## Known Limitations

| Item | Status |
|------|--------|
| Polyphonic data | **PARTIAL** (`POLYPHONIC_DATA_PARTIAL`) — does not block V1 freeze |
| Production license (CLD-derived lineage) | **PENDING** — development validation approved |
| Domain gate 655 < 900 | **PRE_EXISTING_DEFERRED** — predates V1 rebuild |

---

## Future Change Rules

1. Data changes go through existing Lexicon operations process on the **same SSOT TSV**.
2. Architecture changes require explicit proposal + user approval.
3. Do not fork a shadow V2 list or re-open STRICT/BALANCED selection without approval.

---

## Workstream Closure

Closed / frozen items:

- IME2510 Repair mirror issue
- Single-Char lexical-validity selection (STRICT/BALANCED)
- Single-Char storage strategy
- Single-Char V1 rebuild
- Single-Char Repair Lexicon V1 (this workstream)

Deferred separately: polyphonic completeness, domain 655/900, Model3, general retry architecture.
