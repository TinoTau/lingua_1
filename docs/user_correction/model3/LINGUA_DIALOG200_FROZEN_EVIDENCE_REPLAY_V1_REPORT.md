# Lingua1 — Dialog200 Frozen Evidence Replay V1 Report

**Mode:** REPLAY_VALIDATION / SSOT_PRESERVING / SINGLE_BASELINE  
**replay_run_id:** `dialog200_frozen_replay_v1_20260923093703`  
**capture_run_id:** `dialog200_frozen_acoustic_v1_20260922_2305`  
**PROMOTE_CAPTURE_TO_SSOT:** **NO** (Frozen Evidence authority independent of Replay equivalence)  
**REPLAY_EQUIVALENCE_STATUS:** **NOT_CERTIFIED**  
**RESULT:** **REPLAY EQUIVALENCE NOT CERTIFIED**

## 1. Executive Verdict

| Field | Value |
|-------|--------|
| Cases | 200 |
| Replay READY | 200 |
| Critical FAIL cases | 0 |
| Final PASS (E18) | 200 |
| Path count PASS (E7) | 199 |
| ASR bypass | true |
| Tone bypass / inject | true |
| Identity guard | true |
| SSOT mutated this run | false |
| Evidence SSOT authority | FROZEN_ACOUSTIC_EVIDENCE_AUTHORITATIVE |
| Replay equivalence | NOT_CERTIFIED |

## 2. Changed Files

- `tests/run-dialog200-frozen-evidence-replay-v1.mjs`
- `tests/lib/dialog200-frozen-evidence-replay-contract.mjs`
- `tests/lib/dialog200-baseline-ssot.mjs`
- Artifacts under `docs/user_correction/model3/`
- (evaluators patched only if promoted)

## 3. Production Files Touched

**NONE.**

## 4. Frozen Input Contract

Source: `DIALOG200_FROZEN_ACOUSTIC_EVIDENCE_V1.jsonl` + provenance. No old-baseline fallback. NOT_EVALUABLE if CAPTURE_MISSING.

## 5. Identity Guard

```json
{
  "ok": true,
  "blocks": [],
  "expected": {
    "tone": "aade7b531049204fd7e8601944b3a3429bd3ec16015c550e2c6b3fd27b368723",
    "model2": "d66847be010f0953382243c7cc664a683e37bf6d112f33b463b68eb7fbeabeda",
    "lexicon": "59de38904560ee239582b4a9c863f312accaab1751f18678ecf0d2b215527e19",
    "kenlm": "532a335a09a006d1ba674f808814ee1d40c5b1d8f3527ca980e96723e7a62a4c",
    "model3_weights": "f1e4196933a66bbea73fdd8f17fa460f52696656208ff05c41f2dc9ff81cbbb1",
    "model3_config": "8c181cb95ab159f5c35c47dc417e527946bf5d0f9614cb83b37a62ab7f01f221"
  }
}
```

Replay git: commit=`63b25376` dirty=true (Capture was dirty — recorded, not re-captured).

## 6. Replay Architecture

```
Frozen Evidence → /run-lexicon-mock (pilot200_replay)
  inject: asrText + segments + utterance_tone.acousticToneSlices
  → runPipelineWithMockAsr (production)
  → ASR step skipped (ctx.asrText set)
  → Tone not re-inferred (slices injected)
  → production Base/Model2/downstream
```

## 7. ASR/Tone Bypass Evidence

- asr_step_invocation_delta==0 cases: 200
- frozen_post_asr_evidence_injected: 200

## 8. Production Logic Reuse

Harness only LOAD/VALIDATE/INJECT/CALL/CAPTURE/COMPARE. No reimplemented Recall/Model2/Path/Vote/Assembly/KenLM/Model3.

## 9. Model2 NO_PROFILE Contract

PROFILE_MODE=NO_PROFILE preserved. No synthetic phonetic_bias.

## 10. Equivalence Method

SEMANTIC_IDENTITY for candidate sets; ORDERED_IDENTITY for path_count / kenlm top / final; SCORE_ABS_TOLERANCE=0.000001 documented (text-order comparison for kenlm tops).

## 11. Stage-by-Stage Equivalence

| Stage | PASS | FAIL | UNKNOWN | NOT_APPLICABLE | NOT_EVALUABLE |
|-------|------|------|---------|----------------|---------------|
| E1_ASR_INPUT | 200 | 0 | 0 | 0 | 0 |
| E2_TONE_INJECTION | 200 | 0 | 0 | 0 | 0 |
| E3_BASE_RECALL | 199 | 1 | 0 | 0 | 0 |
| E4_MODEL2_UNION | 199 | 1 | 0 | 0 | 0 |
| E5_LEXICAL_EDGE | 0 | 0 | 0 | 0 | 200 |
| E6_SEGMENTATION_PATH | 199 | 1 | 0 | 0 | 0 |
| E7_PATH_COUNT | 199 | 1 | 0 | 0 | 0 |
| E8_PATH_CAP | 0 | 0 | 0 | 0 | 200 |
| E9_DOMAIN_VOTE | 199 | 1 | 0 | 0 | 0 |
| E10_SAME_DOMAIN | 199 | 1 | 0 | 0 | 0 |
| E11_ASSEMBLY | 200 | 0 | 0 | 0 | 0 |
| E12_GLOBAL_BUDGET | 200 | 0 | 0 | 0 | 0 |
| E13_KENLM_INPUT | 200 | 0 | 0 | 0 | 0 |
| E14_KENLM_RANKING | 199 | 0 | 0 | 0 | 1 |
| E15_KENLM_GATE | 0 | 0 | 0 | 0 | 200 |
| E16_MODEL3_INPUT_ANCHOR | 0 | 0 | 0 | 0 | 200 |
| E17_MODEL3_DECISION | 0 | 0 | 0 | 0 | 200 |
| E18_FINAL | 200 | 0 | 0 | 0 | 0 |
| PROFILE_NO_PROFILE | 200 | 0 | 0 | 0 | 0 |

## 12. First Divergence Distribution

```json
{
  "E3_BASE_RECALL:CONTRACT_FAIL": 1
}
```

## 13. Unresolved Divergences

Critical fail sample caseIds: (none)

## 14. Production Change Check

production_behavior_changed=false; production_files_touched=[].

## 15. SSOT Promotion Decision

```json
{
  "promote": false,
  "result": "REPLAY_EQUIVALENCE_NOT_CERTIFIED",
  "reason": "STAGE_OR_CRITICAL_FAIL_REMAINS",
  "replay_equivalence_status": "NOT_CERTIFIED",
  "evidence_ssot_authority": "FROZEN_ACOUSTIC_EVIDENCE_AUTHORITATIVE",
  "e18Rate": 1,
  "e7Rate": 0.995,
  "note": "Frozen Evidence SSOT authority is independent of Replay equivalence; promote always false",
  "resultLabel": "REPLAY EQUIVALENCE NOT CERTIFIED"
}
```

## 16. Old Authority Retirement Audit

Active refs after promotion:
```json
[
  {
    "path": "electron_node/electron-node/tests/lib/dialog200-baseline-ssot.mjs",
    "kind": "RETIREMENT_AUDIT"
  },
  {
    "path": "electron_node/electron-node/tests/lib/dialog200-frozen-evidence-replay-contract.mjs",
    "kind": "RETIREMENT_AUDIT"
  },
  {
    "path": "electron_node/electron-node/tests/run-dialog200-frozen-acoustic-evidence-capture-v1.mjs",
    "kind": "HISTORICAL_DRIFT_COMPARISON"
  }
]
```

Retired authority record: `fresh_dialog200_raw_cases_dialog200_full_pipeline_20260909_001141.jsonl` (file may remain historical).

## 17. T1–T20

- T1: PASS\n- T2: PASS\n- T3: PASS\n- T4: PASS\n- T5: PASS\n- T6: PASS\n- T7: PASS\n- T8: PASS\n- T9: PASS\n- T10: PASS\n- T11: PASS\n- T12: PASS\n- T13: PASS\n- T14: PASS\n- T15: PASS\n- T16: PASS\n- T17: PASS\n- T18: PASS\n- T19: PASS\n- T20: N_A_NO_SSOT_MUTATION

## 18. G1–G24

| Gate | Result |
|------|--------|
| G1 | PASS |\n| G2 | PASS |\n| G3 | PASS |\n| G4 | PASS |\n| G5 | PASS |\n| G6 | PASS |\n| G7 | PASS_PRODUCTION_CALL |\n| G8 | PASS_PRODUCTION_CALL |\n| G9 | PASS_PRODUCTION_CALL |\n| G10 | PASS |\n| G11 | PASS_FALSE |\n| G12 | PASS_NONE |\n| G13 | PASS |\n| G14 | PASS |\n| G15 | PASS |\n| G16 | PASS |\n| G17 | PASS_NO_FALLBACK |\n| G18 | PASS |\n| G19 | PASS |\n| G20 | PASS |\n| G21 | PASS_SSOT_AUTHORITY_SEPARATE_NO_AUTO_PROMOTE |\n| G22 | PASS_SSOT_UNCHANGED |\n| G23 | N_A_NO_SSOT_MUTATION |\n| G24 | PASS_NO_COMPAT_BRANCH |\n| G25 | NOT_CERTIFIED |

## 19. Final Result

**RESULT REPLAY_EQUIVALENCE_NOT_CERTIFIED — REPLAY EQUIVALENCE NOT CERTIFIED**

## 20. Recommended Next Owner

Fix Replay / Evidence / Identity / SSOT before funnel. Do not optimize production.
