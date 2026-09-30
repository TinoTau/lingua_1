# Lingua1 — Capture V2 Phase A Controlled-Parity Harness Repair Report

```text
RESULT_ENUM = A — PHASE_A_CONTROLLED_PARITY_VALIDATED
NEXT_OWNER = CAPTURE_V2_OFFICIAL_RECAPTURE_EXECUTION

FAILURE_CLASS_RESTORED = TEST / EVALUATOR DEFECT
PRODUCTION_ALGORITHM_CHANGED = NO
CAPTURE_CONTRACT_CHANGED = NO
CAPTURE_IMPLEMENTATION_CHANGED = NO
REPLAY_V2_TOUCHED = NO

PHASE_A_CASE_COUNT = 8

UPSTREAM_MATERIALIZATION_MODE = LIVE_WAV_ASR_TONE_ONCE_PER_CASE
UPSTREAM_MATERIALIZATION_COUNT_PER_CASE = 1

CONTROLLED_BOUNDARY = post-ASR JobContext pin → FW Capture OFF/ON fork
CONTROLLED_FIELDS = rawAsrText, segments, segmentTimeOffsetsSec, asrSegmentNodeBatchIndices, segmentCharOffsets, acousticToneSlices

DEEP_CLONE_CONFIRMED = YES
AUTHORITATIVE_SNAPSHOT_IMMUTABLE = YES

OFF_INPUT_EQUALS_AUTHORITATIVE = YES
ON_INPUT_EQUALS_AUTHORITATIVE = YES
CAPTURE_GATE_ONLY_VARIABLE = YES

MAPPED_TONE_RECOMPUTED = YES
FINESPAN_RECOMPUTED = YES
BASE_RECALL_RECOMPUTED = YES
MODEL2_RECOMPUTED = YES
PATHS_RECOMPUTED = YES
DOMAIN_RECOMPUTED = YES
KENLM_RECOMPUTED = YES
MODEL3_RECOMPUTED = YES

CAPTURE_OFF_ARTIFACT_ABSENT = YES
CAPTURE_ON_ARTIFACT_PRESENT = YES
CAPTURE_ON_REAL_ACOUSTIC_TONE_SLICES_PRESENT = YES

CONTROLLED_INPUT_VALID = PASS

PHASE_A_LIVE_PARITY = PASS
PREFLIGHT_FINAL_PARITY = PASS
PREFLIGHT_DECISION_PARITY = PASS
OBSERVER_EFFECT_DETECTED = NO

PHASE_B_CAPTURE_EXECUTED = NO

CURRENT_BASELINE_REPLACED = NO
REPLAY_V2_EXECUTED = NO
REPLAY_EQUIVALENCE_CERTIFIED = NO
TRUSTED_DIALOG200_FUNNEL_V2 = BLOCKED
```

## Repair summary

- **Defect fixed:** Phase A no longer re-runs WAV→VAD→ASR→Tone independently for Capture OFF and ON.
- **New structure:** LIVE full-audio materialization once per case → authoritative post-ASR snapshot → deep-clone OFF/ON → `/run-lexicon-mock` inject → Production FW recomputed with Capture gate as sole intentional variable.
- **TEST_ONLY pin export:** `LINGUA_TEST_EXPORT_POST_ASR_PIN=1` → `extra.test_only_post_asr_pin` (result-builder). Default OFF; Production API unchanged.
- **Old dual-full-audio Phase A path:** retired as authoritative parity implementation (no legacy selector).

## Case results (8/8 PASS)

| caseId | controlled | status | diffs | pin_slices | on_B4_slices |
|--------|------------|--------|-------|------------|--------------|
| d002 | PASS | PASS | 0 | 16 | 16 |
| d001 | PASS | PASS | 0 | 19 | 19 |
| d010 | PASS | PASS | 0 | 20 | 20 |
| d003 | PASS | PASS | 0 | 17 | 17 |
| d004 | PASS | PASS | 0 | 31 | 31 |
| d149 | PASS | PASS | 0 | 20 | 20 |
| d006 | PASS | PASS | 0 | 26 | 26 |
| d005 | PASS | PASS | 0 | 29 | 29 |

## Config difference audit

```json
{
  "OFF_CONFIG": {
    "NODE_ENV": "production",
    "TONE_P10_VAD_CPU": "1",
    "MODEL2_DIALOG200_TRACE": "1",
    "MODEL3_CANDIDATE_PROVENANCE_TRACE": "1",
    "MODEL3_CHECKPOINT_IDENTITY": "MODEL3_V2_S3_RANDOM_INIT_V1",
    "PROFILE_MODE": "NO_PROFILE",
    "use_lexicon": true,
    "is_manual_cut": true,
    "lexicon_v2_intent_enabled": false,
    "entry_after_fork": "/run-lexicon-mock (post-ASR inject)",
    "FROZEN_EVIDENCE_CAPTURE_V2": "0"
  },
  "ON_CONFIG": {
    "NODE_ENV": "production",
    "TONE_P10_VAD_CPU": "1",
    "MODEL2_DIALOG200_TRACE": "1",
    "MODEL3_CANDIDATE_PROVENANCE_TRACE": "1",
    "MODEL3_CHECKPOINT_IDENTITY": "MODEL3_V2_S3_RANDOM_INIT_V1",
    "PROFILE_MODE": "NO_PROFILE",
    "use_lexicon": true,
    "is_manual_cut": true,
    "lexicon_v2_intent_enabled": false,
    "entry_after_fork": "/run-lexicon-mock (post-ASR inject)",
    "FROZEN_EVIDENCE_CAPTURE_V2": "1"
  },
  "DIFF": [
    "FROZEN_EVIDENCE_CAPTURE_V2"
  ],
  "CAPTURE_GATE_ONLY": "YES"
}
```

## Field provenance

```json
[
  {
    "FIELD": "rawAsrText",
    "PRODUCER": "asr-step (Production ASR)",
    "DOWNSTREAM_CONSUMER": "FW normalize / WTS baseline",
    "WHY_REQUIRED": "MINIMUM_CONTROLLED_BOUNDARY — ASR text must be identical across Capture OFF/ON"
  },
  {
    "FIELD": "segments (+ words + timestamps)",
    "PRODUCER": "asr-step",
    "DOWNSTREAM_CONSUMER": "WTS / FineSpan / Capture B1",
    "WHY_REQUIRED": "MINIMUM_CONTROLLED_BOUNDARY — segmentation identity"
  },
  {
    "FIELD": "segmentTimeOffsetsSec",
    "PRODUCER": "asr-step multi-batch alignment",
    "DOWNSTREAM_CONSUMER": "buildWordTimeSpans / Capture B2",
    "WHY_REQUIRED": "MINIMUM_CONTROLLED_BOUNDARY — absolute time mapping"
  },
  {
    "FIELD": "asrSegmentNodeBatchIndices",
    "PRODUCER": "asr-step",
    "DOWNSTREAM_CONSUMER": "buildWordTimeSpans / Capture B2",
    "WHY_REQUIRED": "MINIMUM_CONTROLLED_BOUNDARY — batch index mapping"
  },
  {
    "FIELD": "segmentCharOffsets",
    "PRODUCER": "asr-step",
    "DOWNSTREAM_CONSUMER": "buildWordTimeSpans / Capture B2",
    "WHY_REQUIRED": "MINIMUM_CONTROLLED_BOUNDARY — char offset mapping"
  },
  {
    "FIELD": "acousticToneSlices",
    "PRODUCER": "asr-step Tone merge (Production Tone)",
    "DOWNSTREAM_CONSUMER": "mapped Tone / Capture B4",
    "WHY_REQUIRED": "MINIMUM_CONTROLLED_BOUNDARY — real Tone SSOT; must not be reconstructed"
  }
]
```

## Identity

- run_id: dialog200_capture_v2_20260925100532
- git: 63b253769cab6f4b11d1ded4f9c89c4a610555b3
- port: 5300

## Artifacts

- `LINGUA_CAPTURE_V2_PHASE_A_HARNESS_REPAIR_REPORT.md`
- `LINGUA_CAPTURE_V2_PHASE_A_CONTROLLED_PARITY_RESULT.json`
- `LINGUA_DIALOG200_CAPTURE_V2_LIVE_PARITY_PREFLIGHT.json`
