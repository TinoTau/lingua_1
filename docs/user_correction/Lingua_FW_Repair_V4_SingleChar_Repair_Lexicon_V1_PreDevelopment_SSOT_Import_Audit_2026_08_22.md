# Lingua FW Repair V4 — Single-Char Repair Lexicon V1 Pre-Development SSOT + Import Audit

**Date:** 2026-08-22  
**Stage:** `FW_REPAIR_V4_SINGLE_CHAR_REPAIR_LEXICON_V1_PREDEVELOPMENT_SSOT_IMPORT_AUDIT`  
**Mode:** AUDIT ONLY  
**Verdict:** **CONTRACT_GAP**

Artifacts: `training/model2_v3/experiments/v3_stage_j_live_dialog200/single_char_repair_lexicon_v1_predev_ssot_import_audit_2026_08_22/`

---

## 1. Frozen target

| Layer | Source |
|-------|--------|
| IME | `single_char_dictionary.tsv` only |
| FW Repair length-1 | STRICT 1125 via `base_lexicon` |
| Storage | existing `base_lexicon` (no new table) |
| Pipeline | existing Full Rebuild (no second pipeline) |

---

## 2. SSOT

**Proposed ONE Repair build SSOT:**  
`docs/user_correction/single_char/single_char_repair_lexicon_v1.csv`  
(= approved STRICT 1125 content; build-ready column contract)

After cutover, do not maintain STRICT CSV + patch list + sqlite edits as parallel authorities.

IME TSV remains separate (not Repair).

---

## 3. Build injection point

Unique entry: `full-rebuild-from-csv.mjs` → `loadSingleCharRows` ← `DEFAULT_SINGLE_CHAR_TSV` / `opts.singleCharTsvPath`.

**Recommended strategy:** OPTION 1 — Full Rebuild, swap singleCharSource. Reject length-1 patch tool.

**Not a pure path swap today:** STRICT file is comma CSV with `word`/`tone`; loader expects TAB + `surface`/`tone_pinyin`/`weight`. Minimum change = freeze loader-shaped SSOT **or** minimal field-map in the same loader (still one pipeline).

---

## 4. STRICT validation

| Check | Result |
|-------|--------|
| Rows / unique | 1125 / 1125 |
| Dup / non-Han / multi | 0 / 0 / 0 |
| Missing pinyin/tone | 0 / 0 |
| Case overrides | 0 |

---

## 5. Prior — primary CONTRACT_GAP

Consumers:

- Collector: `prior > 0` eligibility + SQL order
- Bind: `prior >= minPrior` (**0.5**, no length bypass)

IME weights 0.08–0.30 **must not** be reused. Complex freq→prior mapping forbidden.

**Simplest proposal (not frozen):** constant **0.9** (multi-char rebuild default), must be `>= 0.5`.

Per audit rule: prior value still undecided → **CONTRACT_GAP** (do not invent a number to force PASS). Do not change minPrior in this workstream’s import ACP without its own decision.

---

## 6. Schema / collector / polyphony

- Schema reusable; no schema change
- Collector / `lookupBaseByPinyinAndToneKey` reusable
- Polyphonic PARTIAL = KNOWN_DATA_LIMITATION; does **not** block V1
- Term ids regenerate; do not keep IME ids
- `source` label: `single-char-repair-v1-strict`
- `enabled=1` default

---

## 7. Tooling / safety

- IME **runtime**: unaffected if TSV kept
- IME **export**: affected (dumps all base_lexicon) → recommend `length>=2` filter; do not keep 2510 mirror for compatibility
- Expected length-1: 1125; net Δ −1385; length≥2 / domains: preserve via unchanged multi-char sources, **TO_VERIFY** after rebuild
- bundleVersion bump + checksum required

---

## 8. Decision

| Item | Value |
|------|-------|
| Safe To Proceed To Development | **YES** (narrow scope) |
| Remaining gaps | (1) freeze prior constant (2) freeze build SSOT file shape / loader field-map |
| Dev scope | Materialize one SSOT → wire Full Rebuild singleCharSource → constant prior per freeze → promote → acceptance; no Model2/collector/table/IME TSV edits |
| Next phase | **Prior + SSOT file freeze ACP**, then implementation |

---

AUDIT STOP. No sqlite write, rebuild, import, or production code change.
