# Lingua FW Repair V4 — Single-Char Repair Lexicon V1 Implementation + Rebuild Report

**Date:** 2026-08-23  
**Stage:** `SINGLE_CHAR_REPAIR_V1_IMPLEMENT_REBUILD`  
**Verdict:** **PASS**

Artifacts: `training/model2_v3/experiments/v3_stage_j_live_dialog200/single_char_repair_v1_implement_rebuild_20260823_0207/`

---

## Summary

Replaced FW Repair `base_lexicon` length-1 from IME 2510 mirror → **STRICT 1125** via frozen contract:

- **CREATE** `docs/user_correction/single_char/single_char_repair_lexicon_v1.tsv` (1125 rows)
- **MODIFY** `DEFAULT_SINGLE_CHAR_TSV` → V1 path; manifest metadata; export `length>=2` filter
- **Full Rebuild** → promote to `node_runtime/lexicon/v3` (**bundleVersion 14**)

IME TSV unchanged. Collector/query/Model2/Model3 untouched.

---

## Build

| Item | Value |
|------|-------|
| Full Rebuild reused | YES |
| New pipeline | NO |
| New table | NO |
| IME fallback | NO |
| bundleVersion | **14** |
| checksum | `sha256:59de38904560ee239582b4a9c863f312accaab1751f18678ecf0d2b215527e19` |
| manifest singleCharSource | `single_char_repair_lexicon_v1.tsv`, recordCount **1125** |

---

## Length-1

| | Before | After |
|--|--------|-------|
| enabled length-1 | 2510 | **1125** |
| Net delta | | **−1385** |
| Runtime == SSOT | | **YES** (runtime_only=0, source_only=0) |

Examples: 毫/涡/皿 **ABSENT**; 的/吗/我 **PRESENT**

Prior: all **0.9**; IME weight leakage **0**  
Source: all `single-char-repair-v1-strict`

---

## Preservation

| Area | Status |
|------|--------|
| length≥2 business content | **UNCHANGED** (fingerprint match) |
| domain_lexicon count | **655** (unchanged) |
| term_domain_tags | **655** (unchanged) |
| idiom | **22192** (unchanged) |

---

## Gate note

`lexicon:gate:v3-runtime` reports domain/routing thresholds `<900` — **pre-existing** (bundle 13 already had 655 domain rows). Not introduced by this rebuild.

---

## License

Development validation: **ALLOWED**  
Production license: **PENDING**

---

## Next phase

`SINGLE_CHAR_REPAIR_V1_FINAL_ACCEPTANCE_FREEZE` — dialog_200 measurement only; no membership tuning.

---

IMPLEMENTATION STOP.
