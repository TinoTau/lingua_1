# Lingua Model2 — Single-Char Clean No-Git Rollback

**Date:** 2026-08-20  
**Stage:** `MODEL2_SINGLE_CHAR_FEATURE_CLEAN_NO_GIT_ROLLBACK`  
**Git:** not used  
**Training:** none  
**expA:** unmodified  
**Verdict:** **PASS**

Artifacts: `training/model2_v3/experiments/v3_stage_j_live_dialog200/model2_single_char_clean_rollback_2026_08_20/`  
Backup: `training/model2_v3/experiments/v3_stage_j_live_dialog200/rollback_backup_20260820_0708/`

---

## Decision executed

Model2 single-char candidate decision is **RETIRED**. Model2 is **P/D ONLY**.  
Governance: `docs/user_correction/model2_single_char_capability_retirement_decision.md`

## Backup then identity

Filesystem copy of all DELETE/RESTORE/DOC/TEST files **before** edits. expA sha256 `d66847be…beda` MATCH. Params after restore **47210**. Strict load empty missing/unexpected. `forward` keys: action / query_budget / cand_budget / domain_action only.

## What was removed

Optional `with_ambiguity_head` / `ambiguity_version`; AmbiguityHead V1/V2 files; MinimalContextEncoderV1; `cmd=disambiguate` (now `unknown_cmd`, not ABSTAIN); Node `disambiguate()`; contract types; `singleCharAmbiguousSet` / `buildSingleCharCandidateSetV1`; test-only SELECT materializer; feature-only tests and train scripts.

Failed experiment dirs moved to `training/model2_v3/retired_experiments/` (not production load path).

## What was kept

`collectBaseOnlySingleCharCandidate`, `length1Collector`, unique-only / fail-closed tests (file unchanged), P/D `infer`, FineSpan/Assembly/KenLM/Lexicon/Domain Vote/JobResult/Budget untouched. Phase5C historical test kept.

Post-rollback length-1: unique legal candidate → existing collector; ambiguous → fail-closed; **Model2 not involved**.

## Regression

| Gate | Result |
|---|---|
| P RR n=699 | **0.9538002980625931** identical to frozen `stage_j_p_hard.json` |
| D val Correct TIR | 0.304 > Empty 0.0 |
| Host cmds | ping/load/stats/infer/shutdown; disambiguate = unknown_cmd |
| Unexpected production symbols | 0 |
| Shadow / compat / flags | NONE |
| length-1 jest | ENVIRONMENT_BLOCKED (better-sqlite3 ABI 119 vs host 137); source+assertions preserved |
| dialog_200 | ENVIRONMENT_BLOCKED (not started; no fixture edits) |

encode()/forward() P/D math was not refactored; only constructor optional branch deleted.

## SSOT

Active: Stage J Model Freeze + P Preservation + Runtime Checkpoint Swap.  
ACP / Candidate-Set freeze / V1 / V2 / batching plan: RETIRED banners. Historical docs cannot re-enable the feature.

## Stop

No new single-char design. Known limitation: remaining length-1 ambiguity stays fail-closed in Lexicon Recall.
