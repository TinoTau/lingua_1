# Lingua FW Repair V4 — Single-Char Repair Lexicon V1 Final Pre-Development Contract Audit

**Date:** 2026-08-23  
**Stage:** `FW_REPAIR_V4_SINGLE_CHAR_REPAIR_LEXICON_V1_FINAL_PREDEVELOPMENT_CONTRACT_AUDIT`  
**Mode:** AUDIT ONLY  
**Verdict:** **PASS**

Artifacts: `training/model2_v3/experiments/v3_stage_j_live_dialog200/single_char_repair_lexicon_v1_final_predev_contract_audit_2026_08_23/`

---

Closure audit — contracts frozen for implementation. No architecture reopening.

## Frozen contracts

| Contract | Frozen value |
|----------|----------------|
| Repair build SSOT | `docs/user_correction/single_char/single_char_repair_lexicon_v1.tsv` (CREATE) |
| Audit artifact | `Lingua_single_char_repair_lexicon_strict_v1.csv` — not build authority |
| Prior | `SINGLE_CHAR_REPAIR_V1_PRIOR = 0.9` |
| SQLite `source` | `single-char-repair-v1-strict` |
| Build strategy | Full Rebuild, swap `DEFAULT_SINGLE_CHAR_TSV` |
| IME | `single_char_dictionary.tsv` only |

## Code-verified prior chain

`weight` → `loadSingleCharRows` → `prior_score` → collector `>0` → bind `>=0.5` → `computeCandidateScore` additive. **0.9 safe.** IME weights forbidden.

## Minimum implementation scope

**CREATE:** V1 TSV (1125, loader TAB shape)  
**MODIFY:** `DEFAULT_SINGLE_CHAR_TSV` + manifest metadata string; **recommended** export `length>=2` filter  
**KEEP:** collector, query, IME TSV, all recall architecture  
**DO_NOT_TOUCH:** Model2, Model3, minPrior (this change-set)

## Expected post-rebuild

1125 enabled length-1; set equality; −1385 net; length≥2 unchanged; 毫/涡/皿 absent; 的/吗/我 present.

## Next phase

`SINGLE_CHAR_REPAIR_V1_IMPLEMENT_REBUILD` — still no import in this audit round.

---

AUDIT STOP.
