# FW_REPAIR_V4_POST_TRACE_FREEZE_V1

**Date:** 2026-08-18  
**Stage:** POST_MATERIALIZABLE_TARGET_V1_GOVERNANCE  
**dialog_200:** 200/200 `NO_PROFILE`

This freeze records what is already proven correct and what this round may touch.

---

## Frozen (no design change, no training, no expansion)

| Item | Status | Implementation repair this round |
|------|--------|----------------------------------|
| MATERIALIZABLE_TARGET_V1 | FROZEN | diagnostics only |
| RetrievalPolicyV3 | FROZEN | NO |
| Stage-J checkpoint `expA_frozen_trunk.pt` sha256 `d66847be010f0953382243c7cc664a683e37bf6d112f33b463b68eb7fbeabeda` | FROZEN | NO TRAINING |
| MODEL2_FEATURE_HASH_V1 | FROZEN | NO |
| StageDProfileContractV1 | FROZEN | NO |
| StageDRetrievalTargetIdentityV1 | FROZEN | NO |
| Stage D domain-conditioned fuzzy executor | FROZEN | NO |
| domain action IDs / `domain_none` | FROZEN | NO |
| ONE Model2 / ONE checkpoint | FROZEN | NO |
| DomainAwareAssembly / sameDomain / base+domain mix / subset DFS / overlap / sentence budget / KenLM handoff | FROZEN | NO |
| Streaming FineSpan architecture (coarse soft, overlap, backtracking, exact eligibility) | FROZEN | NO |
| Candidate budget | FROZEN | NO |
| sameDomain vote / domain buckets | FROZEN | NO |
| KenLM scoring/ranking contract | FROZEN | NO |
| Lexicon content | FROZEN | NO expansion |
| Recall algorithm / fuzzy gates | FROZEN | NO |

TRUE_ASSEMBLY_MATERIALIZATION_FAILURE = 0. Do not reopen Assembly from the legacy 142→26 funnel.

FineSpan architecture conformance remains PASS. The 10-unit lexical→path gap is **not** a license to change PathFineSpan or relax exact-align eligibility.

---

## Allowed this round (implementation / observation only)

| Item | Allowed | Forbidden adjacent |
|------|---------|--------------------|
| Model2 D candidate origin-span binding | YES — bind to the FineSpan that triggered retrieval **and** matches hit pinyin syllable length | no first/iterator/nearest/fallback rebind; no eligibility relaxation; no PathFineSpan change |
| Observation-only trace fields | YES — pass-through if present; add diagnostics fields if missing | must not change identity, ranking, selection, budget, runtime decisions |
| Regression on known wrong-binding cases | YES — binding correctness only | no training, hard-mine, or special-case |

If a 2-char term still cannot legally apply to a 1-char PathFineSpan after the binding fix: **EXPECTED CONTRACT REJECTION**.

---

## Explicitly forbidden this round

- Model2 train / retrain / tune
- Assembly development
- FineSpan design change
- Candidate budget / Domain Vote / KenLM change
- Lexicon import / single-char vocabulary expansion
- New OpenCC / normalization module
- Recall algorithm / fuzzy query change
- Turning Model2 into a general corrector under NO_PROFILE

---

## Legacy attribution

See `legacy_trace_retirement_manifest.json`.

`AfterBudget 142 → Assembly 26` / `ASSEMBLY_DROP=126` = `HISTORICAL_ONLY`.
