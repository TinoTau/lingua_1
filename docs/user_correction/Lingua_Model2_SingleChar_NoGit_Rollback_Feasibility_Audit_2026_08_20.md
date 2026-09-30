# Lingua Model2 — Single-Char No-Git Rollback Feasibility Audit

**Date:** 2026-08-20  
**Stage:** `MODEL2_SINGLE_CHAR_FEATURE_NO_GIT_ROLLBACK_FEASIBILITY_AUDIT`  
**Mode:** AUDIT ONLY. No delete, restore, train, or production edit.  
**Git:** not used as rollback source (no checkout / restore / reset / revert).  
**Verdict:** **SAFE_TO_ROLLBACK**  
**Scope:** **LEVEL_2_ALL_MODEL2_SINGLE_CHAR** (not whole Lexicon Recall)

Artifacts: `training/model2_v3/experiments/v3_stage_j_live_dialog200/model2_single_char_nogit_rollback_feasibility_audit_2026_08_20/`

---

## 0. User decision (recorded)

Single-char candidate decision will not stay on Model2. Combinatorics exceed user-habit coverage. Extending context encoder / ambiguity head inflates Model2 without payoff.

This audit answers only: can that **Model2 capability** be removed without git, while keeping Lexicon Recall’s pre-existing length-1 collector.

---

## 1. PRE_SINGLE_CHAR_MODEL2_BASELINE

Last accepted freeze **before** Candidate-Set Interface V1 (2026-08-19):

| Document | Why it is the baseline |
|---|---|
| `Lingua_Model2_V3_StageJ_Model_Freeze_Report_2026_08_18.md` | MODEL_FREEZE YES; params 47210; architecture UNCHANGED |
| `Lingua_Model2_V3_StageJ_Restored_Joint_P_Preservation_Report_2026_08_18.md` | P/D coexistence on frozen trunk |
| `Lingua_Model2_V3_StageJ_Runtime_Checkpoint_Swap_Development_Report_2026_08_18.md` | Sidecar: `RetrievalPolicyV3(with_domain_head=True)`, ONE `infer` |
| Stage J `modified_file_inventory.csv` | `model.py` KEEP at freeze |

**Identity anchor (verified on disk 2026-08-20):**  
`expA_frozen_trunk.pt` sha256 `d66847be010f0953382243c7cc664a683e37bf6d112f33b463b68eb7fbeabeda` params **47210**.

Constructor documented: `RetrievalPolicyV3(with_domain_head=True)`.  
`forward` keys: `action_logits`, `query_budget_logits`, `cand_budget_logits`, `domain_action_logits`.  
Host cmds: ping/stats/load/load_index/infer/shutdown.  
Node product API: `infer` only.

ACP / Candidate-Set / V1 / V2 are **after** this freeze.

---

## 2. Change classes (summary)

| Class | What |
|---|---|
| DELETE | New contract files, heads, encoder, train scripts |
| RESTORE | `model.py`, host py/ts, `recall-span-topk-v2.ts` (Model2 field only), `candidate-materialize.ts` (SELECT helper) |
| KEEP | Collector trace, length-1 tests, P/D expand path, expA, IME/minPrior/lexicon experiments |
| EXPERIMENT_ONLY / ARTIFACT_RETIRE | V1/V2 experiment dirs + checkpoints |
| DOC_RETIRE | ACP, single-char reports, batching audit |
| TEST_RETIRE | disambiguation jest + ambiguity python tests |

Batching audit: **documentation-only** (`disambiguateBatch` never implemented).

---

## 3. Model / host / Node / Recall

**model.py:** additive optional `with_ambiguity_head` (default False) and `ambiguity_version`. `encode`/`forward` not rewritten. Production host never sets the flag. **P/D heads and trunk weights not changed** (hash gates in V1/V2 reports).

**Host:** still `RetrievalPolicyV3(with_domain_head=True)` + `EXPECTED_PARAMS = 47210`. Additive: `cmd=disambiguate` always ABSTAIN/`HEAD_NOT_AVAILABLE`; extra load/stats keys. `infer` remains independent.

**Node:** `disambiguate()` on the TS host has **zero product callers**. `expand-active-candidates.ts` only `infer`. `materializeSelectedSingleCharCandidate` is test-only.

**Recall (critical split):**

- **KEEP:** `collectBaseOnlySingleCharCandidate` unique-only / surface-exact / fail-closed; `length1Collector`; tests in `recall-span-topk-v2-length1-collector-observability.sqlite.integration.test.ts`.
- **REMOVE:** `buildSingleCharCandidateSetV1` + `singleCharAmbiguousSet` (Candidate-Set report: hits still 0 or 1; set unused by Assembly).

After rollback, length-1 Recall returns to that **fail-closed unique-only** behavior. No new scheme designed this round.

Lexicon / 2510 IME / minPrior / collector foundation: **out of scope** (KEEP).

---

## 4. Checkpoints

| Artifact | Role |
|---|---|
| expA | KEEP — only authoritative Model2 after rollback |
| `retrieval_policy_v3_single_char_ambiguity_v1.pt` sha256 `076390ab…70fc` | EXPERIMENT_FAILED, NOT_PRODUCTION, RETIRE/ARCHIVE |
| `retrieval_policy_v3_single_char_ambiguity_v2.pt` sha256 `d844ab48…d497` | EXPERIMENT_FAILED, NOT_PRODUCTION, RETIRE/ARCHIVE |

Do not retrain an “old model”.

---

## 5. Dependencies

Later independent features depending on the single-char Model2 API: **NO**.

P/D depending on head/encoder/disambiguate: **NO** (host load + `infer` + param gate).

Phase5C `training/model2/tests/test_phase5c_ambiguity.py`: unrelated historical Model2 — **KEEP**.

---

## 6. Restore without git

All RESTORE files are **ADDITIVE** reverse-deletes (source class **E**). Stage J freeze copy of `model.py` is not stored as a separate blob; confidence remains **HIGH** because freeze inventory marked KEEP and later inventories describe only optional flags.

MEDIUM/LOW restore files: **none**.

Backup next round: copy listed files into `rollback_backup_YYYYMMDD_HHMM` (filesystem, not git). Checksums: `pre_rollback_file_checksums.csv` already hashed current key files.

---

## 7. Execution order (next round only)

1. Filesystem backup of RESTORE/DELETE paths  
2. Retire experiment checkpoints/dirs (or move aside)  
3. Restore `model.py`  
4. Restore host py + ts  
5. Restore Recall hooks + candidate-materialize; delete contract files  
6. Delete feature-only tests  
7. Banner/retire docs; restore SSOT to Stage J freeze reports  
8. Static grep: no production symbols  
9. P/D + host infer regression  
10. Recall collector tests + no-Model2 single-char check  

No compatibility shims.

---

## 8. SSOT

Active SSOT is currently **polluted** by ACP and Candidate-Set freeze docs still sitting in `docs/user_correction/` without RETIRED banners. After rollback, active pointer returns to Stage J freeze + runtime swap reports.

---

## 9. Risk

**LOW.** Production never loaded the head. Product path never called `disambiguate`. Main risk is accidentally deleting the **collector** while removing `singleCharAmbiguousSet`. Plan isolates that.

---

This round stopped after the audit. No rollback executed.
