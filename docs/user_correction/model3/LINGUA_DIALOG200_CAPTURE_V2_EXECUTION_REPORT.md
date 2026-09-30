# Lingua1 — Dialog200 Capture V2 Execution Report

RESULT_ENUM = A — CANDIDATE_CAPTURE_V2_READY

NEXT_OWNER = FROZEN_EVIDENCE_REPLAY_V2_DEVELOPMENT

PHASE_A_LIVE_PARITY = PASS

PREFLIGHT_CASE_COUNT = 8

PREFLIGHT_FINAL_PARITY = PASS

PREFLIGHT_DECISION_PARITY = PASS

OBSERVER_EFFECT_DETECTED = NO

PHASE_B_CAPTURE_EXECUTED = YES

CAPTURE_SCHEMA = DIALOG200_FROZEN_EVIDENCE_CAPTURE_V2

ARTIFACT_ROLE = CANDIDATE_CAPTURE_V2

TOTAL_CASES = 200

EXECUTED_CASES = 200

COMPLETE_CASES = 200

CAPTURE_INCOMPLETE_CASES = 0

MANDATORY_BOUNDARY_MISSING_CASES = 0

AUTHORITATIVE_TRUNCATION_PRESENT = NO

IDENTITY_GUARDS_VALID = YES

PRODUCTION_ALGORITHM_CHANGED = NO

CURRENT_BASELINE_REPLACED = NO

REPLAY_V2_EXECUTED = NO

REPLAY_EQUIVALENCE_CERTIFIED = NO

TRUSTED_DIALOG200_FUNNEL_V2 = BLOCKED

---

## 1. Result Header

| Field | Value |
|-------|--------|
| RESULT_ENUM | A — CANDIDATE_CAPTURE_V2_READY |
| NEXT_OWNER | FROZEN_EVIDENCE_REPLAY_V2_DEVELOPMENT |
| run_id | dialog200_capture_v2_20260925100532 |
| git_commit | 63b253769cab6f4b11d1ded4f9c89c4a610555b3 |
| git_dirty | true |

## 2. Phase A — Live OFF/ON Parity

- Cases: 8
- PHASE_A_LIVE_PARITY: **PASS**
- Final parity: PASS
- Decision parity: PASS
- Observer effect: NO

Capability selection (not accuracy-driven):

- `d002` — single-batch capability — caps: A_single_batch, E_base_recall, F_model2, G_kenlm, H_model3 — status=PASS — wav=4eb472261d03…
- `d001` — multi-batch capability — caps: B_multi_batch, D_multipath, E_base_recall, F_model2, G_kenlm, H_model3 — status=PASS — wav=002acced5ba2…
- `d010` — Traditional ASR script capability — caps: A_single_batch, C_script_normalized, G_kenlm, H_model3 — status=PASS — wav=e3f7aa04bebc…
- `d003` — multi-path capability — caps: B_multi_batch, D_multipath, E_base_recall, F_model2, G_kenlm, H_model3 — status=PASS — wav=22e7d9a20eea…
- `d004` — Base Recall active multi-batch — caps: B_multi_batch, E_base_recall, F_model2, G_kenlm, H_model3 — status=PASS — wav=a2223b8aad6e…
- `d149` — script-normalized + multi-batch (capability category C) — caps: B_multi_batch, C_script_normalized, D_multipath, E_base_recall, F_model2, G_kenlm, H_model3 — status=PASS — wav=cd48db09a5b3…
- `d006` — single-path / sparse lattice — caps: A_single_batch, G_kenlm, H_model3 — status=PASS — wav=f050903363a0…
- `d005` — multi-batch multipath heavy — caps: B_multi_batch, D_multipath, E_base_recall, F_model2, G_kenlm, H_model3 — status=PASS — wav=a95be8cc42ed…

## 3. Phase B — Capture Execution

- Executed: YES
- Entry: `POST /run-pipeline-with-audio` (full-audio; ASR+Tone rerun)
- Gate: `FROZEN_EVIDENCE_CAPTURE_V2=1`
- Artifact: `DIALOG200_FROZEN_EVIDENCE_CAPTURE_V2.jsonl` role=CANDIDATE_CAPTURE_V2

## 4. Phase C — Completeness Validation

- TOTAL_CASES=200
- EXECUTED_CASES=200
- COMPLETE_CASES=200
- CAPTURE_INCOMPLETE_CASES=0
- SILENTLY_SKIPPED=0
- DUPLICATE_CASE_IDS=0
- AUTHORITATIVE_TRUNCATION_PRESENT=NO

## 5. Corpus Identity

- Expected Dialog200 count: 200
- Manifest: `test wav/dialog_200/cases.manifest.json`
- Corpus inventory hash: 13337cb0b53d404a93a995a5f1f1307789e8bf44b5f1c9e51f8e8007a6e8eb37
- WAV identities: COMPLETE

## 6. Runtime / Model / Lexicon Identity

See `LINGUA_DIALOG200_CAPTURE_V2_IDENTITY_MANIFEST.json`.

- ASR: IDENTITY_RECONSTRUCTABLE
- Tone: IDENTITY_RECONSTRUCTABLE
- Model2: PINNED
- KenLM: PINNED
- Model3: MODEL3_V2_S3_RANDOM_INIT_V1
- Lexicon: PINNED
- Profile: NO_PROFILE

## 7. B1–B18 Completeness Matrix

- B1: complete=200 incomplete=0 missing=0
- B2: complete=200 incomplete=0 missing=0
- B3: complete=200 incomplete=0 missing=0
- B4: complete=200 incomplete=0 missing=0
- B5: complete=200 incomplete=0 missing=0
- B6: complete=200 incomplete=0 missing=0
- B7: complete=200 incomplete=0 missing=0
- B8: complete=200 incomplete=0 missing=0
- B9: complete=200 incomplete=0 missing=0
- B10: complete=200 incomplete=0 missing=0
- B11: complete=200 incomplete=0 missing=0
- B12: complete=200 incomplete=0 missing=0
- B13: complete=200 incomplete=0 missing=0
- B14: complete=200 incomplete=0 missing=0
- B15: complete=200 incomplete=0 missing=0
- B16: complete=200 incomplete=0 missing=0
- B17: complete=200 incomplete=0 missing=0
- B18: complete=200 incomplete=0 missing=0

## 8. Conditional/Unavailable Boundary Summary

Incomplete case details are listed in completeness JSON (`incomplete_cases`). Distinctions EXECUTED_AND_CAPTURED / LEGITIMATELY_NOT_APPLICABLE / CAPABILITY_UNAVAILABLE / REQUIRED_BUT_MISSING are enforced by collector + structural validator (empty array never auto-PASS mandatory).

## 9. Authoritative Truncation Audit

AUTHORITATIVE_TRUNCATION_PRESENT = NO

Scanned for `authoritative_truncated` / `_truncated` markers in Capture V2 boundary payloads.

## 10. Production Change Audit

- PRODUCTION_ALGORITHM_CHANGED = NO
- CURRENT_BASELINE_REPLACED = NO (V1 remains authoritative)
- No Replay V2
- No funnel / accuracy / d149 optimization

## 11. Artifact Integrity

| Artifact | Path |
|----------|------|
| Candidate Capture V2 | `DIALOG200_FROZEN_EVIDENCE_CAPTURE_V2.jsonl` sha256=ae4b569473cbaa01fe905efa6368b58d7f295468451195eeb9d4cd8b4fdca13a |
| Completeness | `LINGUA_DIALOG200_CAPTURE_V2_COMPLETENESS.json` |
| Identity | `LINGUA_DIALOG200_CAPTURE_V2_IDENTITY_MANIFEST.json` |
| Live parity preflight | `LINGUA_DIALOG200_CAPTURE_V2_LIVE_PARITY_PREFLIGHT.json` |

## 12. Remaining Gaps

- Replay V2 not executed (by contract)
- Replay equivalence not certified
- Trusted Dialog200 Funnel V2 blocked
- Candidate Capture V2 is NOT baseline

## 13. Result / Next Owner

**A — CANDIDATE_CAPTURE_V2_READY** → **FROZEN_EVIDENCE_REPLAY_V2_DEVELOPMENT**
