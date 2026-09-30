# LINGUA_PILOT200_FROZEN_TONE_EVIDENCE_CAPTURE_REPORT

| Field | Value |
|-------|-------|
| Date | 2026-09-12 |
| Nature | MEASUREMENT / EVIDENCE CAPTURE ONLY |
| PHASE | LINGUA_PILOT200_FROZEN_TONE_EVIDENCE_CAPTURE |

## A. Pilot identity

```text
DATASET = LINGUA_DIALOG2000_V2_PILOT200
BUILD = build_20260911_091806
TOTAL_UNIQUE_CASES = 200
SPLITS = DEV120 / VALIDATION60 / HOLDOUT20
CAPTURE_TARGET_SET_VALID = PASS
```

## B. Initial coverage

```text
INITIAL_VALID_EVIDENCE = 8 / 200
INITIAL_MISSING_EVIDENCE = 192
EXISTING_BATCH = tonecap_2026-09-12T0001
```

## C. Capture execution

```text
NEW_CAPTURE_BATCH = tonecap_pilot200_full_20260912T0437
TARGET_CAPTURE_COUNT = 192
CAPTURE_ATTEMPTED_COUNT = 192
CAPTURE_SUCCESS_COUNT = 192
CAPTURE_FAIL_COUNT = 0
ASR_EXECUTED_FOR_CAPTURE = YES
PROFILE_MATRIX_EXECUTED = NO
```

## D. Final coverage

| Slice | Coverage |
|-------|----------|
| Overall | 200/200 |
| DEV | 120/120 |
| VALIDATION | 60/60 |
| HOLDOUT | 20/20 |

### User

- U001: 40/40
- U002: 40/40
- U003: 40/40
- U004: 40/40
- U005: 40/40

### Domain

- general_daily: 43/43
- software_meeting: 33/33
- travel_hotel: 32/32
- food_cafe: 36/36
- medical: 30/30
- retail_service: 26/26

## E. Contract validation

| Check | Count FAIL |
|-------|-----------:|
| CASE_IDENTITY_MISMATCH | 0 |
| AUDIO_IDENTITY_MISMATCH | 0 |
| SEGMENTS_MISSING | 0 |
| TONE_EVIDENCE_MISSING | 0 |

## F. Capture failures

```json
{}
```

Failed case IDs (if any): (none)

## G. Existing 8 handling

```text
EXISTING_CAPTURE_REUSED_COUNT = 8
EXISTING_CAPTURE_INVALID_COUNT = 0
POLICY = KEEP prior validated captures; do not regenerate unless contract invalid
```

Reused IDs: p2_u001_002, p2_u001_004, p2_u001_016, p2_u002_001, p2_u002_016, p2_u003_001, p2_u003_016, p2_u004_001

## H. Harness changes

```text
HARNESS_ONLY_CHANGE = YES
PRODUCT_CODE_CHANGE = NO
ARCHITECTURE_SCOPE_VIOLATION = NO
AUTHORITATIVE_MODEL2_SSOT = AUG12_PRE_LEXICAL_EDGE
```

Harness-only file:

- `electron_node/electron-node/tests/run-pilot200-frozen-tone-evidence-full-capture.mjs`

## I. Full Pilot readiness

```text
EVIDENCE_COMPLETE = YES
FULL_PILOT200_REMEASURE_EVIDENCE_READY = YES
```

## J. One next owner

```text
ONE_NEXT_OWNER = PILOT200_POST_PRE_EDGE_RESTORE_FULL_REMEASURE
```

**STOP.** No profile matrix. No Model2 quality analysis.
