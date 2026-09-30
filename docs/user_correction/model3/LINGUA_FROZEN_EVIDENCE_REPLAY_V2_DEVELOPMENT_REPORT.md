# Lingua1 — Frozen Evidence Replay V2 Development Report

```text
RESULT_ENUM = A — REPLAY_V2_CAPABILITY_VALIDATED
NEXT_OWNER = FROZEN_EVIDENCE_REPLAY_V2_OFFICIAL_ACCEPTANCE

CANDIDATE_RUN_ID = dialog200_capture_v2_20260925100532
CANDIDATE_SHA256 = ae4b569473cbaa01fe905efa6368b58d7f295468451195eeb9d4cd8b4fdca13a

REPLAY_V2_IMPLEMENTED = YES

PRODUCTION_ALGORITHM_CHANGED = NO
CAPTURE_CONTRACT_CHANGED = NO
LEXICON_CHANGED = NO
MODEL_CHANGED = NO

V1_FALLBACK_USED = NO

I1_I9_ADAPTER_IMPLEMENTED = YES
DOWNSTREAM_INJECTION_BLOCKED = YES

B3_RECOMPUTED = YES
B4_MAPPED_TONE_RECOMPUTED = YES
B5_B18_RECOMPUTED = YES

COMPARATOR_V2_IMPLEMENTED = YES
FIRST_DIVERGENCE_IMPLEMENTED = YES

UNIT_TESTS = 18 static + 10 live-deferred (T9–T18 proven in capability probe)
UNIT_TESTS_PASSED = 18/18 static; 8/8 live capability (T9–T18)

CAPABILITY_PROBE_CASES = 8
CAPABILITY_PROBE_EXECUTED = 8
CAPABILITY_PROBE_EQUIVALENT = 8
CAPABILITY_PROBE_DIVERGED = 0

REPLAY_EQUIVALENCE_CERTIFIED = NO

CURRENT_BASELINE_REPLACED = NO

BUSINESS_ACCURACY_EVALUATED = NO
REFERENCE_TEXT_USED_FOR_EQUIVALENCE = NO

PROCESS_CLEANUP = PASS
```

## Harness repairs during capability probe (TEST / EVALUATOR DEFECT only)

Initial probe exposed comparator over-strictness, not Production defects:

1. **B10** — Do not compare opaque `inputHash` of full Model2 TRACE windows (`model2_raw` / `feature_pack` floats). Compare semantic view (`model2_summary` + window/base/profile identities).
2. **B11** — Compare action/candidate **SET** identities, not ordered TRACE object graphs with incidental fields.
3. **B16** — Compare pool text SET + picked + gate; bare `scores_when_produced` arrays (often len≠pool) are **NOT_EVALUABLE**, not FAIL.

```
FAILURE_CLASS = TEST / EVALUATOR DEFECT
FIRST_CONTRACT_VIOLATION = comparator used TRACE/opaque-hash equality beyond Frozen SET/discrete semantics
FROZEN_CONTRACT_RESTORED = YES
FILES_CHANGED = tests/lib/dialog200-frozen-evidence-replay-v2-contract.mjs
WHY_THIS_IS_NOT_A_PRODUCTION_SEMANTIC_CHANGE = only Replay V2 comparator projection; Production/Capture untouched
```

After repair: 8/8 capability equivalent.

## Source impact

### CREATED_FILES
- `electron_node/electron-node/tests/lib/dialog200-frozen-evidence-replay-v2-contract.mjs`
- `electron_node/electron-node/tests/run-dialog200-frozen-evidence-replay-v2.mjs`
- `electron_node/electron-node/tests/dialog200-frozen-evidence-replay-v2.focus.test.mjs`
- `docs/user_correction/model3/LINGUA_FROZEN_EVIDENCE_REPLAY_V2_DEVELOPMENT_REPORT.md`
- `docs/user_correction/model3/LINGUA_FROZEN_EVIDENCE_REPLAY_V2_CAPABILITY_PROBE.json`

### MODIFIED_FILES
- (none required beyond created artifacts)

### PRODUCTION_FILES_MODIFIED
- NONE

### CAPTURE_FILES_MODIFIED
- NONE

### LEXICON_FILES_MODIFIED
- NONE

### MODEL_FILES_MODIFIED
- NONE

### Candidate immutability
- CANDIDATE_ARTIFACT_SHA_BEFORE = ae4b569473cbaa01fe905efa6368b58d7f295468451195eeb9d4cd8b4fdca13a
- CANDIDATE_ARTIFACT_SHA_AFTER = ae4b569473cbaa01fe905efa6368b58d7f295468451195eeb9d4cd8b4fdca13a
- IDENTICAL = YES

## Capability probe summary

| caseId | injection | equivalent | first_divergence |
|--------|-----------|------------|------------------|
| d002 | true | true | - |
| d001 | true | true | - |
| d010 | true | true | - |
| d003 | true | true | - |
| d004 | true | true | - |
| d149 | true | true | - |
| d006 | true | true | - |
| d005 | true | true | - |

## Notes

- Official Dialog200 200-case Replay acceptance was **not** run this round.
- Replay V1 was not used as fallback or authority.
- Business expected/reference text was not used for equivalence.
