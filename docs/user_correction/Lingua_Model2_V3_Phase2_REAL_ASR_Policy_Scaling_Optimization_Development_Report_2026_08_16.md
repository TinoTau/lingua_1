# Model2 V3 Phase2 Development Report (2026-08-16)

Markers: `MODEL2_V3_PHASE2_POLICY_SCALE_AND_OPTIMIZATION`

## Scope

Architecture frozen. This phase scales REAL_ASR teacher data and optimizes multi-relation **RecallRetained** under cost constraints.

## Phase1 reproduction

PASS (see `phase2_reproduction_check.json`). Baseline RecallRetained≈0.71 retained as PHASE2_BASELINE.

## Dataset

- ACTIVE_SET REAL_ASR pool: 3987
- Policy rows: 39870
- Natural recovery yield: 0.2122
- Hard multi: 699
- High card: 2544
- Yield attribution: `{"OTHER": 695, "TARGET_ALREADY_IN_BASE": 738, "PROFILE_NOT_APPLICABLE": 1339, "DISTANCE_REJECT": 369}`

## Optimizations

- Teacher `recall_prefer` labels (all recovering singles) for PARALLEL selection
- COMPOSED_PAIR distinct from PARALLEL
- Utility cost calibration (lower query cost)
- Attention profile pooling; MAX items 64
- Dynamic budget head (1/2/3/4/6/8)
- Hard-multi weighted sampling

## Results (HARD_MULTI dynamic)

| Metric | Phase1 | Phase2 |
|--------|--------|--------|
| RecallRetained | 0.71 | 1.0104 |
| QueryReduction | 0.32 | 0.0242 |
| CandidateReduction | 0.30 | 0.0204 |
| E2ECostReduction | 0.31 | 0.0189 |

Verdict: **HOLD**

## HOLD

Tone / Node / 50k / Stage B remain HOLD. Stage A ARCHIVED.
