# MATERIALIZABLE_TARGET_V1_FREEZE_V1

**Date:** 2026-08-18  
**Status:** FROZEN  
**Contract id:** `MATERIALIZABLE_TARGET_V1`  
**Library:** `electron_node/electron-node/tests/lib/materializable-target-v1.mjs`

---

## 1. What is frozen

`MATERIALIZABLE_TARGET_V1` is the **only** authoritative target / recoverability contract for dialog_200 and postprocess diagnostics.

Correction units come from unified character alignment of `norm(raw ASR)` vs `norm(expectedText)`.

- `norm` = strip punctuation/whitespace + lowercase
- **No** traditional/simplified folding
- **No** per-dialog or domain-conditioned targets
- UNCHANGED ngrams are never recall success
- Dialog-level flags require **all** required units

Layer flags (strict, all required units):

| Flag | Meaning |
|------|---------|
| `lexical_recoverable` | every required unit has a matching candidate surface |
| `path_recoverable` | every required unit is eligible on a PathFineSpan that covers its source range |
| `sentence_recoverable` | a full covering sentence exists |
| `actually_assembled` | that sentence was emitted |
| `kenlm_available` | KenLM saw a covering candidate |

---

## 2. Retired (must not be reused)

| Alias | Status |
|-------|--------|
| `hasTarget` (legacy surface-substring / whole-sentence) | `LEGACY_TARGET_ATTRIBUTION` / `HISTORICAL_ONLY` |
| Cross-layer funnel `After Budget 142 → Assembly 26` | `HISTORICAL_ONLY` / `NOT_GO_NO_GO` / `NOT_ROOT_CAUSE_AUTHORITY` |
| `ASSEMBLY_DROP` | retired |
| `candidate substring = sentence recoverable` | forbidden |

Old Stage-J artifacts may remain on disk. They must not be cited as Assembly evidence.

---

## 3. Authoritative 200-dialog snapshot (Stage-J traces, 2026-08-18)

| Metric | Value |
|--------|------:|
| Dialogs | 200 |
| Correction units | 601 |
| Dialogs requiring correction | 175 |
| First divergence LEXICAL_RECALL_MISS | 169 / 175 |
| First divergence FINESPAN_NO_COVERAGE | 5 / 175 |
| First divergence KENLM_RANK_ERROR | 1 / 175 |
| TRUE_ASSEMBLY_MATERIALIZATION_FAILURE | 0 |

`LEXICAL_RECALL_MISS` is **not** `LEXICON_MISSING`.

---

## 4. Change control

Allowed: observation-only trace fields; Model2 D origin-span binding metadata (implementation drift fix).

Forbidden: redesign of this contract; restoring legacy `hasTarget` as authority.
