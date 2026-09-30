# Lingua1 — Dialog200 Frozen Acoustic Evidence Capture V1 Report

**Mode:** EVIDENCE_CAPTURE_ONLY  
**run_id:** `dialog200_frozen_acoustic_v1_20260922_2305`  
**schema:** `DIALOG200_FROZEN_ACOUSTIC_EVIDENCE_V1`  
**evaluation_ssot:** EVALUATION_SSOT_V1  
**replay_implemented:** false  
**production_behavior_changed:** false  

## 1. Executive Verdict

| Field | Value |
|-------|--------|
| CAPTURE_SUCCESS | 200 |
| CAPTURE_RUNTIME_FAILURE | 0 |
| Tone AVAILABLE | 200 |
| Tone VALID_EMPTY | 0 |
| Tone CAPTURE_MISSING | 0 |
| Word timestamps AVAILABLE | 200 |
| Completeness allPass | true |
| REPLAY_READINESS | **READY** |

New baseline created. Old baseline `dialog200_full_pipeline_20260909_001141` **untouched**.

## 2. Changed Files

- `electron_node/electron-node/tests/run-dialog200-frozen-acoustic-evidence-capture-v1.mjs` (new)
- `electron_node/electron-node/tests/lib/dialog200-frozen-acoustic-capture-contract.mjs` (new)
- `electron_node/electron-node/tests/validate-dialog200-frozen-acoustic-evidence-v1.mjs` (new)
- Artifacts under `docs/user_correction/model3/`

## 3. Production Files Touched

**NONE.**

## 4. Reused Existing Harness

- `run-fresh-dialog200-causal-reconciliation.mjs` (server start / Model3 pin / path compact)
- `run-pilot200-frozen-tone-evidence-full-capture.mjs` (segments + utterance_tone persist pattern)
- `POST /run-pipeline-with-audio` (test-server already returns segments + extra.utterance_tone + asr_diagnostics)

## 5. Capture Contract

Observe production JobResult. Persist production field structures. Distinguish AVAILABLE / VALID_EMPTY / CAPTURE_MISSING / RUNTIME_ERROR. No post-hoc timestamp reconstruction.

## 6. Corpus Identity

- Path: `test wav/dialog_200`
- Cases: 200
- WAV SHA frozen per case in jsonl `sourceAudio.sha256`

## 7. ASR Evidence

- `rawMergedAsrText` + production `segments` (incl. `words[]`) persisted when present.
- Separate normalized ASR field: NOT_APPLICABLE (not exposed).

## 8. Timestamp Evidence

- Source: FW `segments.words[].start/end` from JobResult (production).
- Cases with AVAILABLE timing: 200

## 9. Audio Coordinate Evidence

- Primary: `acousticToneSlices` (production-aligned times).
- `processedAudioSha256` / full VAD map: **CAPTURE_MISSING** — not exposed on JobResult without production API change (documented gap; not invented).
- Partial: `asr_diagnostics.audio_segmentation.fw_vad_segment_count` / `audio_ms`.

## 10. Tone Evidence

- `utterance_tone` + `acousticToneSlices` persisted.
- Tone model identity from `asr_diagnostics.toneModule` (artifactPath / artifactHash).

## 11. Model2 Profile Evidence

- Dialog200 capture session unbound → `PROFILE_MODE=NO_PROFILE` explicit VALID_EMPTY (not "absent").

## 12. Model / DB Identity

See provenance JSON: ASR / Tone / Model2 / Lexicon / KenLM / Model3.

## 13. Runtime Provenance

- git: `63b25376` dirty=true
- node: `v24.15.0`
- python: `Python 3.10.11`
- cuda probe: {"available":false,"cuda":null,"gpu":null,"error":null}

## 14. Completeness Validation

```json
{
  "C1_case_rows_200": {
    "pass": true,
    "detail": {
      "captured": 200,
      "expected": 200,
      "missingCases": []
    }
  },
  "C2_wav_sha_present": {
    "pass": true,
    "detail": {
      "wavHashOk": 200,
      "expected": 200
    }
  },
  "C3_asr_text_present": {
    "pass": true,
    "detail": {
      "asrTextOk": 200,
      "expected": 200
    }
  },
  "C4_segments_captured": {
    "pass": true,
    "detail": {
      "segmentsOk": 200,
      "captureMissingSeg": 0
    }
  },
  "C5_word_timestamp_status": {
    "pass": true,
    "detail": {
      "wordTsStatusOk": 200
    }
  },
  "C6_tone_status_present": {
    "pass": true,
    "detail": {
      "toneStatusOk": 200
    }
  },
  "C7_tone_slices_or_valid_empty": {
    "pass": true,
    "detail": {
      "captureMissingTone": 0
    }
  },
  "C8_profile_status_present": {
    "pass": true,
    "detail": {
      "profileStatusOk": 200
    }
  },
  "C9_final_present": {
    "pass": true,
    "detail": {
      "finalOk": 200
    }
  },
  "C10_caseIds_unique": {
    "pass": true,
    "detail": {
      "dupes": []
    }
  },
  "C11_wav_hashes_match_corpus": {
    "pass": true,
    "detail": {
      "wavHashMismatch": []
    }
  },
  "C12_run_provenance_complete": {
    "pass": true,
    "detail": {
      "hasRunId": true
    }
  },
  "C13_tone_identity_pinned": {
    "pass": true,
    "detail": {
      "identity_status": "AVAILABLE",
      "from_smoke_diagnostics": {
        "status": "AVAILABLE",
        "reason": "toneModule_from_asr_diagnostics",
        "selected": {
          "artifactPath": "D:\\Programs\\github\\lingua_1\\electron_node\\services\\faster_whisper_vad\\tone_module\\models\\candidate\\tone_cnn_production_v2_candidate_20260712.npz",
          "artifactHash": "aade7b531049204fd7e8601944b3a3429bd3ec16015c550e2c6b3fd27b368723",
          "backend": "numpy_p1",
          "featureVersion": "p1-frame-mel-f0-v1",
          "modelVersion": "tone_cnn_production_v2",
          "formatVersion": "npz-p1-v1",
          "trainingVersion": "production_cnn_v2_candidate_20260712",
          "runtimeVersion": "p10-p1-direct-replacement-v1",
          "loaderVersion": "ToneModelLoaderV1",
          "toneSliceCount": 12,
          "toneEnabled": true,
          "skippedReason": null,
          "tone_inference_ms": 65,
          "loadError": null
        }
      },
      "artifact_file": {
        "path": "D:\\Programs\\github\\lingua_1\\electron_node\\services\\faster_whisper_vad\\tone_module\\models\\candidate\\tone_cnn_production_v2_candidate_20260712.npz",
        "relative": "electron_node/services/faster_whisper_vad/tone_module/models/candidate/tone_cnn_production_v2_candidate_20260712.npz",
        "exists": true,
        "sha256": "aade7b531049204fd7e8601944b3a3429bd3ec16015c550e2c6b3fd27b368723",
        "bytes": 1274461
      },
      "env_override": null,
      "selection_reason": "asr_diagnostics.toneModule.artifactPath"
    }
  },
  "C14_model2_identity_pinned": {
    "pass": true,
    "detail": {
      "identity_status": "AVAILABLE",
      "checkpoint_path": "training/model2_v3/experiments/v3_stage_j_p_preservation/training/expA_frozen_trunk.pt",
      "checkpoint_sha256": "d66847be010f0953382243c7cc664a683e37bf6d112f33b463b68eb7fbeabeda",
      "bytes": 195677,
      "env_selection": "DEFAULT_resolveStageJCheckpoint",
      "label": "STAGE_J_RUNTIME_CHECKPOINT_SWAP",
      "profile_mode_at_capture": "NO_PROFILE"
    }
  },
  "C15_lexicon_identity_pinned": {
    "pass": true,
    "detail": {
      "identity_status": "AVAILABLE",
      "path": "node_runtime/lexicon/v3/lexicon.sqlite",
      "sha256_before": "59de38904560ee239582b4a9c863f312accaab1751f18678ecf0d2b215527e19",
      "bytes": 10510336,
      "sha256_after": "59de38904560ee239582b4a9c863f312accaab1751f18678ecf0d2b215527e19",
      "drift": "NONE"
    }
  },
  "C16_kenlm_identity_pinned": {
    "pass": true,
    "detail": {
      "identity_status": "AVAILABLE",
      "path": "electron_node/services/asr_sherpa_lm/models/kenLM/zh_char_3gram.trie.bin",
      "sha256": "532a335a09a006d1ba674f808814ee1d40c5b1d8f3527ca980e96723e7a62a4c",
      "bytes": 34995949
    }
  },
  "C17_model3_identity_pinned": {
    "pass": true,
    "detail": {
      "identity_status": "AVAILABLE",
      "selected_model": "MODEL3_V2_S3_RANDOM_INIT_V1",
      "weights_sha256": "f1e4196933a66bbea73fdd8f17fa460f52696656208ff05c41f2dc9ff81cbbb1",
      "config_sha256": "8c181cb95ab159f5c35c47dc417e527946bf5d0f9614cb83b37a62ab7f01f221",
      "identity_valid": true
    }
  }
}
```

## 15. Old vs New ASR Drift

```json
{
  "IDENTICAL": 113,
  "TEXT_DRIFT": 87,
  "sample_drift_caseIds": [
    "d003",
    "d004",
    "d005",
    "d007",
    "d008",
    "d011",
    "d014",
    "d018",
    "d019",
    "d022",
    "d024",
    "d025",
    "d029",
    "d030",
    "d032",
    "d036",
    "d037",
    "d038",
    "d040",
    "d043"
  ]
}
```

TEXT_DRIFT ≠ FAIL.

## 16. Old vs New Final Drift

```json
{
  "IDENTICAL": 97,
  "FINAL_DRIFT": 103,
  "sample_drift_caseIds": [
    "d002",
    "d003",
    "d004",
    "d005",
    "d007",
    "d008",
    "d009",
    "d011",
    "d012",
    "d014",
    "d018",
    "d019",
    "d022",
    "d024",
    "d025",
    "d029",
    "d030",
    "d031",
    "d032",
    "d033"
  ]
}
```

## 17. Runtime Failures

CAPTURE_RUNTIME_FAILURE count = 0

## 18. Remaining Evidence Gaps

- processed_audio SHA / sample count not on JobResult (OBSERVABILITY_NOT_EXPOSED)
- vad_segments spans not mapped into JobResult (count only via diagnostics)
- normalized ASR text field N/A

## 19. G1–G24

| Gate | Result |
|------|--------|
| G1 | PASS |
| G2 | PASS_OLD_UNTOUCHED |
| G3 | PASS |
| G4 | PASS |
| G5 | PASS |
| G6 | PASS_NO_POSTHOC_RECONSTRUCTION |
| G7 | PASS |
| G8 | PASS_PARTIAL_DOCUMENTED_GAP |
| G9 | PASS |
| G10 | PASS |
| G11 | PASS |
| G12 | PASS |
| G13 | PASS |
| G14 | PASS |
| G15 | PASS |
| G16 | PASS_STATUS_ENUM_ENFORCED |
| G17 | PASS |
| G18 | PASS_FALSE |
| G19 | PASS_NONE |
| G20 | PASS_NO_REPLAY |
| G21 | PASS_NO_LEXICON_CHANGE |
| G22 | PASS_NO_TRAINING |
| G23 | PASS_NO_THRESHOLD_CHANGE |
| G24 | PASS_NO_CASE_PATCH |
| REPLAY_READINESS | READY |
| ASR_DRIFT_NOTE | [object Object] |

## 20. Replay Readiness

**READY**

(Capture sufficiency only — replay not implemented this round.)

## 21. Recommended Next Owner

**BUILD_MINIMAL_REAL_AUDIO_REPLAY** adapter that injects Frozen ASR segments + acousticToneSlices (Pilot200 pattern) without re-running ASR. Do not patch old baseline.
