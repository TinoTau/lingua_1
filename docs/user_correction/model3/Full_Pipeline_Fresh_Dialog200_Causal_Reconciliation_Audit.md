# Full Pipeline Fresh Dialog200 Causal Reconciliation Audit
Generated: 2026-09-08T12:45:17Z
Phase: `FULL_PIPELINE_FRESH_DIALOG200_CAUSAL_RECONCILIATION_AUDIT`
RUN_ID: `dialog200_full_pipeline_20260909_001141`

## Verdict

`FULL_PIPELINE_FRESH_DIALOG200_CAUSAL_AUDIT_PASS`

## Fresh Quality Summary

- TOTAL_CASES = 200
- RAW_CORRECT = 25
- FINAL_CORRECT = 31
- RAW_ACCURACY = 0.125
- FINAL_ACCURACY = 0.155
- NET_CORRECT_GAIN = 6
- PARTIAL_IMPROVEMENT = 60
- UNCHANGED = 109
- REGRESSION = 0
- CORRECT_BROKEN = 0
- RAW_CER = 0.2303
- FINAL_CER = 0.167
- Baseline vs 24→30: **MINOR_RUNTIME_VARIANCE** (fresh 25→31)

## Causal Summary

- VALID_MINIMAL_LEXICAL_TARGET_COUNT = 116
- INVALID_CONTEXT_FRAGMENT_COUNT = 37
- QUERY_NOT_REPAIR_CAPABLE_COUNT = 100
- VALID_LEXICON_COVERAGE_MISSING_COUNT = 0
- RECALL_MATCHING_FAILED_COUNT = 14
- MODEL3_FIRST_BREAKPOINT_COUNT = 0
- KENLM_FIRST_BREAKPOINT_COUNT = 0
- UNKNOWN_NOT_ISOLATED_COUNT = 0

## Previous Audit Reconciliation

| Claim | Value |
|---|---:|
| Previous LEXICON_COVERAGE_MISSING | 143 |
| Fresh VALID LEXICON_COVERAGE_MISSING | 0 |
| RECLASSIFIED_FROM_LEXICON | 143 |

Old 143 = `STALE_CAUSAL_ATTRIBUTION` (reference diff window ≠ lexical target). Authoritative minimality SSOT: `Lingua_Model3_V2_S3_Lexical_Target_Minimality_Audit_2026_09_03.md`.

## First Breakpoint Distribution

| First breakpoint | Count | % raw wrong | % final failures |
|---|---:|---:|---:|
| ASR_INFORMATION_LOSS | 0 | 0.0 | 0.0 |
| NO_LOCAL_LEXICAL_TARGET | 59 | 33.71 | 34.91 |
| FINE_SPAN_TARGET_NOT_EXPOSED | 0 | 0.0 | 0.0 |
| QUERY_NOT_REPAIR_CAPABLE | 100 | 57.14 | 59.17 |
| LEXICON_COVERAGE_MISSING | 0 | 0.0 | 0.0 |
| RECALL_MATCHING_FAILED | 14 | 8.0 | 8.28 |
| DOMAIN_BUCKET_FILTER_LOSS | 0 | 0.0 | 0.0 |
| MODEL2_FAILURE | 0 | 0.0 | 0.0 |
| MODEL3_FALSE_KEEP | 0 | 0.0 | 0.0 |
| MODEL3_FALSE_RETRY | 0 | 0.0 | 0.0 |
| RETRY_RECALL_FAILED | 0 | 0.0 | 0.0 |
| ASSEMBLY_CANDIDATE_LOSS | 2 | 1.14 | 1.18 |
| CANDIDATE_CAP_LOSS | 0 | 0.0 | 0.0 |
| KENLM_WRONG_SELECTION | 0 | 0.0 | 0.0 |
| FINAL_APPLY_MISMATCH | 0 | 0.0 | 0.0 |
| UNKNOWN_NOT_ISOLATED | 0 | 0.0 | 0.0 |

## Owner Ranking

- TOP_FIRST_BREAKPOINT = `QUERY_NOT_REPAIR_CAPABLE`
- TOP_ACTIONABLE_BREAKPOINT = `QUERY_NOT_REPAIR_CAPABLE`
- TOP_REGRESSION_OWNER = `NONE`
- Single next Delta = `LOCAL_REPAIR_QUERY_EFFECTIVENESS_PREDEVELOPMENT_AUDIT`

## Model3 / Retry Protection

- MODEL3_OWNED_FIRST_BREAKPOINT_COUNT = 0
- MODEL3_REOPEN_REQUIRED = NO
- RETRY_ARCHITECTURE_VIOLATION_COUNT = 0
- RETRY_EFFECTIVENESS_GAP_COUNT = 100
- RETRY_REOPEN_REQUIRED = NO

## Environment

- NODE_RUNTIME_STARTED = YES
- DIALOG200_EXECUTED_FRESH = YES
- DIALOG200_CASES_EXECUTED = 200
- LEXICON_RUNTIME_READY = YES
- MODEL3_RUNTIME_IDENTITY_VALID = YES
- BUILD_MAIN_PASS = YES
- ORACLE_LEAK = NO
- PRODUCTION_SEMANTIC_DIFF = NO

## Decision Matrix

| Question | Answer |
|---|---|
| Fresh dialog_200 genuinely executed? | YES |
| Production-equivalent Node path used? | YES |
| Lexicon runtime healthy? | YES |
| S3 runtime identity correct? | YES |
| Quality still net-positive? | YES |
| Correct ASR regression count? | 0 |
| Old Lexicon=143 claim valid? | NO (STALE) |
| Valid Lexicon gap count? | 0 |
| Query-not-repair-capable count? | 100 |
| Recall matching failure count? | 14 |
| Model3 still closed? | YES |
| Retry still frozen? | YES |
| #1 actionable owner? | QUERY_NOT_REPAIR_CAPABLE |
| Single next Delta? | LOCAL_REPAIR_QUERY_EFFECTIVENESS_PREDEVELOPMENT_AUDIT |

## Candidate Cap

{"max": 8, "p50": 1, "p95": 4, "over16": 0, "correctCandidateLostByCap": 0}

## Performance baseline

```json
{
  "pipeline": {
    "p50": 7146,
    "p95": 15530,
    "max": 25112
  },
  "fw": {
    "p50": 2414,
    "p95": 7561,
    "max": 17915
  },
  "kenlm": {
    "p50": 512,
    "p95": 655,
    "max": 4605
  },
  "wall": {
    "p50": 7162,
    "p95": 15551,
    "max": 25277
  },
  "model3": {
    "p50": 19,
    "p95": 86,
    "max": 193
  },
  "retry": {
    "p50": 42,
    "p95": 257,
    "max": 588
  }
}
```

## Execution path

```text
CORPUS_PATH = D:\Programs\github\lingua_1\test wav\dialog_200
NODE_ENTRYPOINT = electron_node/electron-node (production)
DIALOG200_RUNNER = tests/run-fresh-dialog200-causal-reconciliation.mjs
SERVICE_STARTUP_METHOD = tests/repro/start-node-detached.mjs
ASR_ENDPOINT = http://127.0.0.1:6007
MODEL3 = {"runtime_default": "MODEL3_V2_S3_RANDOM_INIT_V1", "selected_model": "MODEL3_V2_S3_RANDOM_INIT_V1", "weights_sha": "f1e4196933a66bbea73fdd8f17fa460f52696656208ff05c41f2dc9ff81cbbb1", "config_sha": "8c181cb95ab159f5c35c47dc417e527946bf5d0f9614cb83b37a62ab7f01f221", "identity_valid": true}
```
