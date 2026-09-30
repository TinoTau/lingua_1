# Lingua Model3 V2 Gate0 Evidence Independence Correction

**Phase:** `MODEL3_V2_GATE0_EVIDENCE_INDEPENDENCE_CORRECTION`  
**Date:** 2026-08-30  
**Mode:** CONTROLLED CORRECTION — no Gate0 acceptance · no dataset · no training · no architecture reopen  

Prior audit: `MODEL3_V2_ACOUSTIC_TRAINING_STATE_ANTI_TEST_OVERFITTING_AUDIT` → **SELF_FULFILLING_GATE_FOUND**

================================
MAIN VERDICT
============

Correction verdict: **GATE0_EVIDENCE_INDEPENDENCE_CORRECTION_PASS**

Gate0 self-fulfilling behavior removed: **YES**

Formal runtime architecture changed: **NO**

Ready for actual Gate0 acceptance: **YES** (checker corrected; acceptance run **not** executed)

================================
SELF-FULFILLING GATE FIXES
==========================

previous:
- `semantic_exclude_distinguished = True` / `hard_reject_distinguished = True` hardcoded
- empty batch soft-PASS for multipath / EXECUTED
- WIRED validated by searching own flag string `MODEL2_ANCHOR_OWNER_WIRED`
- Gate0 trusted injectable `ownerExecution` from fixture lattice
- serializer `or 0` made missing candidate look like cand=0
- harness `readiness.state || "ready"` fail-open

corrected:
- accounting derived from dispositions / manifest ledger → PASS | NOT_EXERCISED | FAIL
- empty formal batch → `INSUFFICIENT_EVIDENCE` (cannot acceptance PASS)
- WIRED = import + call-site of `expandActiveCandidatesWithModel2` / Domain vote owners
- `evidenceSource` trust boundary; injected lattice forced `TEST_FIXTURE`; Gate0 rejects non-formal
- missing cand → `RECALL_STATE_INVALID` HARD_REJECT; true 0 remains valid
- missing Tone readiness → `RECALL_STATE_INVALID` (no default ready)

================================
EVIDENCE TRUST BOUNDARY
=======================

formal evidence:
- `evidenceSource = FORMAL_FRESH_MATERIALIZATION` from formal harness / non-injected materialization

fixture evidence:
- `materialize_utterance_from_parts(..., lattice=...)` → `TEST_FIXTURE` (even if forged formal)
- Gate0 acceptance input → `NON_FORMAL_GATE0_EVIDENCE`

legacy/probe evidence:
- origins `LEGACY` / `PROBE_ONLY` / `HISTORICAL_NON_PARITY_INPUT` rejected for Gate0 acceptance
- historical artifacts retained on disk; not deleted

================================
MODEL2 STATUS SEMANTICS
=======================

WIRED:
- formal harness contains production `expandActiveCandidatesWithModel2` import + call-site

ATTEMPTED:
- formal run reached and invoked expand (`MODEL2_OWNER_ATTEMPTED`)

COMPLETED:
- owner await returned normally (`MODEL2_OWNER_COMPLETED`); throw → attempted, not completed

HOST_AVAILABLE:
- diagnostics without `load_failed` (`MODEL2_HOST_AVAILABLE`)

HIT_OBSERVED:
- coverage from serialized `anchorSource` ∈ {MODEL2, DOMAIN_AND_MODEL2}

If host never available in formal batch → `MODEL2_ANCHOR_PATH_NOT_VALIDATED` / BLOCKED (not PASS)

================================
DOMAIN STATUS SEMANTICS
=======================

WIRED / ATTEMPTED / COMPLETED / HIT_OBSERVED mirrored via `voteUtteranceDomainFromPool` + serialized DOMAIN anchors.  
Injected `DOMAIN_ANCHOR_OWNER_EXECUTED=true` alone cannot prove formal acceptance.

================================
CANDIDATE FAIL-CLOSED
=====================

missing candidate:
- `extract_first_pass_candidate_count` / serializer → `RECALL_STATE_INVALID` HARD_REJECT

true zero candidate:
- field present and `== 0` → valid cand=0

Owner remains `model3FirstPassCandidateCount` / packed `firstPassCandidateCount` (no second owner).

================================
TONE / RECALL READINESS
=======================

Formal harness rejects missing/empty readiness.state with `RECALL_STATE_INVALID`.  
No `|| "ready"` fallback. Mandatory Tone Recall path unchanged.

================================
MULTIPATH EVIDENCE
==================

`MULTIPATH_CODEPATH_PRESENT` vs `MULTIPATH_EXERCISED_IN_BATCH`.  
Acceptance signal requires observed pathCount/paths > 1 on formal rows; absent → NOT_EXERCISED (not PASS).

================================
ACCOUNTING
==========

HARD_REJECT:
- derived from disposition / reject codes / manifest reasons; unexercised → NOT_EXERCISED

SEMANTIC_EXCLUDE:
- `NO_REPAIRABLE_TARGET` counted in semanticExcluded, not hardRejected; unexercised → NOT_EXERCISED

NOT_EXERCISED behavior:
- never reported as PASS for accounting / multipath / cand when no observations

================================
GATE0 DERIVED SIGNALS
=====================

| signal | raw evidence source | calculation | fixture injectable | verdict |
|--------|---------------------|-------------|--------------------|---------|
| MODEL2_WIRED | harness source call-site | import+await/call | no | independent |
| MODEL2_ATTEMPTED/COMPLETED/HOST | ownerDiagnostics from formal run | counts | fixture rejected | independent |
| DOMAIN_* | ownerDiagnostics + Domain call-site | counts | fixture rejected | independent |
| cand0/gt0/retry+cand | labeled span recall/packed counts | span tallies | booleans ignored | independent |
| multipath | formal path records | pathCount>1 | fixture rejected | independent |
| anchors | serialized anchorSource | histogram | HIT flag alone insufficient | independent |
| semantic/hard exclude | dispositions/manifest | exercised vs not | hardcoded removed | independent |

================================
SEMANTIC FAMILY / NEAR DUP
==========================

When source supplies `near_dup_key` / `nearDupKey`, `semantic_family_id` / orchestrator consume it.  
Focused test proves shared key → shared family; ignored key no longer silent when supplied.

================================
TESTS
=====

passed: 37 (gate0 evidence independence + acoustic training state)

failed: 0

negative tests:
- hardcoded accounting removed; NOT_EXERCISED; empty batch; fixture reject; injected owner flags; Model2 host unavailable BLOCKED; cand missing; readiness fallback absent; multipath absent; cand forced-zero; primary-path collapse; owner-call tautology removed; near_dup; packer handcraft reject

real-path focused test:
- bounded formal harness with `MODEL2_RUNTIME_DISABLED=1` → formal evidenceSource + truthful ATTEMPTED/COMPLETED/host-unavailable; Gate0 does not soft-PASS

================================
MUTATION SENSITIVITY
====================

candidate forced zero detected: YES (retry+cand>0 flips)

primary-path collapse detected: YES (multipath → NOT_EXERCISED)

owner call removal detected: YES (WIRED requires production call-site; tautology removed)

readiness default ready detected: YES (harness regression asserts no `|| "ready"`)

fixture execution flags rejected: YES (`NON_FORMAL_GATE0_EVIDENCE`)

================================
CODE CHANGES
============

reuse:
- production owners: expandActiveCandidatesWithModel2, voteUtteranceDomainFromPool, materializeModel3Anchors, packModel3SpanInferFields, normalizeForFwRepairInput, FineSpan/Tone/Recall chain

modify:
- `acoustic_training/gate0.py` — independent evidence + statuses
- `acoustic_training/serializer.py` — cand fail-closed
- `acoustic_training/orchestrator.py` — TEST_FIXTURE isolation + near_dup
- `acoustic_training/provenance.py` — ATTEMPTED via diagnostics
- `offline_harness/acoustic_b2_formal_materialize.cjs` — ownerDiagnostics + readiness fail-closed + evidenceSource
- focused tests

new:
- `tests/test_gate0_evidence_independence.py`

remove:
- hardcoded Gate PASS booleans; readiness `|| "ready"`; cand `or 0` soft default; WIRED flag-string tautology

================================
GOVERNANCE
==========

Model3 changed: NO  
feature changed: NO  
threshold changed: NO  
Tone semantics changed: NO  
Recall semantics changed: NO  
FineSpan changed: NO  
Model2 responsibility changed: NO  
Domain responsibility changed: NO  
Anchor ownership changed: NO  
Retry changed: NO  
JobResult changed: NO  
formal dataset: NO  
training: NO  

================================
NEXT PHASE
==========

Exactly one: **MODEL3_V2_ACOUSTIC_TRAINING_STATE_GATE0_ACCEPTANCE**

Do not execute.
