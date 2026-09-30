# Dialog2000 V2 Dataset Design Audit

Generated: 2026-09-11  
Phase: `LINGUA_DIALOG2000_V2_DATASET_DESIGN_AUDIT`  
Mode: READ_ONLY / PRE-DESIGN  

## Verdict

`DIALOG2000_V2_AUDIT_PASS_MINIMAL_GAPS_FOUND`

```text
PILOT_200_FEASIBILITY = PILOT_200_FEASIBLE_WITH_MINIMAL_COMPONENTS
ONE_NEXT_PHASE = LINGUA_DIALOG2000_V2_PILOT200_DESIGN
ARCHITECTURE_CHANGE_REQUIRED = NO
PRODUCTION_CODE_CHANGE = NONE
```

## Executive answers (Q1–Q10)

| Q | Answer |
|---|--------|
| Q1 Dataset infra | dialog_200 manifest+wavs+many runners; context_prior subset; normalized evaluator; Model2 traces |
| Q2 TTS/audio | Piper (primary); YourTTS (clone); acoustic bank; restore scripts |
| Q3 Pronunciation perturb | Training-side PronunciationCorruptor/PhonemeRealizer/ACTIVE_SET transforms; **not** on dialog_200 golden |
| Q4 Profile gen/inject | fixtures + correction→ProfileDelta **SUPPORTED**; dialog harness **unwired** |
| Q5 Per-case profile | **NOT_SUPPORTED** in dialog runners (SessionBootstrap path exists in prod) |
| Q6 Real ASR | **REAL_ASR_SUPPORTED** Faster-Whisper via `/run-pipeline-with-audio` |
| Q7 Normalized evaluator | **REUSABLE** (extend IO) |
| Q8 Seed/manifest/split | Partial version/wavBytes; **no** seed/hash/holdout on dialog_200 |
| Q9 Leak | dialog_200 golden treated EVAL_ONLY; Model2 expand scans dialog surfaces → contamination labels exist; no production caseId branch found |
| Q10 Minimal new | Injector + scenario generator + pronunciation eval wrapper + manifest builder + profile-aware eval (+ optional A/B replay) |

## dialog_200 facts

| Field | Value |
|-------|-------|
| Cases | 200 (d001–d200) |
| Audio | Piper TTS 16k mono; voice `zh_CN-huayan-medium` |
| Text | curated experiment JSON (not live LLM pipeline) |
| Profile | **200/200 NO_PROFILE** (fixture/runner default; not per-case map) |
| ASR | Real Faster-Whisper |
| Runner | test-server `runPipelineWithAudio` — **no userProfile body field** |
| Provenance | `restored_full_v1` / README; **GENERATION_PROVENANCE_INCOMPLETE** for original utterance authoring prompts |

## Capability highlights

### Reuse as-is / high reuse
- Real audio→ASR→Lingua runners
- Piper restore path
- ACTIVE_SET_V1 relation SSOT (**pattern-level** → `GENERALIZATION_CAPABLE`)
- profile_delta correction-derived profiles
- SessionBootstrap consumption path
- Normalized baseline evaluator
- `MODEL2_DIALOG200_TRACE`

### Minimal gaps (Pilot blockers)
1. **PER_CASE_PROFILE_INJECTOR** — wire SessionBootstrap / session profile into dialog harness  
2. **PROFILE_SCENARIO_GENERATOR** — P0–P3 + correct/wrong/empty; enforce profile-build terms ≠ eval terms  
3. **PRONUNCIATION_AUDIO_EVAL_GENERATOR_WRAPPER** — reuse Corruptor/PhonemeRealizer for eval corpus (not text-only injection)  
4. **DATASET_MANIFEST_BUILDER** — userId, profileStage, mechanism, split, seed, generator version  
5. **PROFILE_AWARE_EVALUATOR** — PROFILE_GAIN / false expansion / useful addition  
6. **PROFILE_A_B_REPLAY_RUNNER** — preferred same-ASR×profile compare (optional if Pilot accepts 3× full ASR)

### Explicit non-reuse for V2 main path
- `training/model3_error_text` as primary generator → `REJECT_FOR_DIALOG2000_V2` (`TEXT_ERROR_INJECTION_ONLY`)
- dialog_200 golden as Model2 P effectiveness corpus → keep as **P0/regression only**

## TTS / perturbation matrix (summary)

| Mechanism | Status |
|-----------|--------|
| n/l, zh/z, ch/c, sh/s, eng/en, in/ing, h/f | DIRECTLY_SUPPORTED (ACTIVE_SET + corruptor/realizer) |
| an/ang etc. deferred relations | INDIRECTLY_POSSIBLE (schema) / not ACTIVE Stage-J |
| Tone shift for Model2 | **NOT_SUPPORTED** under active contract (`TONE_GENERALIZATION_NOT_TESTABLE_UNDER_CURRENT_ACTIVE_PROFILE_CONTRACT`) |
| Elision / connected speech | **NOT_SUPPORTED** |
| Speech rate | INDIRECTLY_POSSIBLE (acoustic bank) |
| Multi-engine | PARTIAL (Piper+YourTTS) → `SINGLE_TTS_BIAS_RISK` if Pilot stays Piper-only |

## Profile path

```text
A direct fixture → Model2 e2e     = SUPPORTED (unit)
B correction → ProfileDelta → UP = SUPPORTED (gateway)
dialog harness per-case inject   = NOT_SUPPORTED today
P0–P3 by content maturity        = EXPRESSIBLE (no named stages)
WRONG_PROFILE controls           = OFFLINE_ONLY (Phase7e); not dialog harness
```

## Risks (observed → future constraint)

| Risk | Observed | Future constraint |
|------|----------|-------------------|
| OVERFIT | dialog_200 NO_PROFILE cannot train/eval Model2 P | Profile eval must use non-empty profiles |
| TEST LEAK | No production caseId branch found | Forbid reference-driven candidate injection |
| TTS BIAS | Single Piper voice on golden | Multi-voice later; declare bias in Pilot |
| PROFILE LEAK | Hand-written bias fixtures possible | Prefer correction-derived; separate build vs eval terms |
| LEXICAL MEMORIZATION | Relation SSOT is pattern-level (good) | Enforce PROFILE BUILD TERMS ≠ EVAL TARGET TERMS |
| DOMAIN CONFOUND | scenarios bound in dialog texts | Cross-combine domain×relation in Pilot design |
| SPEAKER CONFOUND | No speaker field; one voice | Decouple speaker×profile×mechanism |

## Required report answers

| # | Answer |
|---|--------|
| A | Runners, Piper restore, NO_PROFILE golden as P0 control, evaluators, traces, relation SSOT |
| B | **YES** real audio→Faster-Whisper→postprocess |
| C | **NO** in current dialog harness; prod SessionBootstrap **YES** |
| D | **NO** cached-ASR profile A/B today; offline Phase7e only |
| E | **YES** via profile_delta |
| F | ACTIVE_SET_V1 seven families (n/l, retroflex/affricate, nasal finals, h/f) |
| G | **NO** (tone_bias inactive) |
| H | Phoneme/family **PARTIAL via training tools**; tone/elision **NO**; rate **PARTIAL** |
| I | Eval pronunciation wrapper + profile injector + scenario/manifest/eval |
| J | **YES** normalized evaluator reusable |
| K | **PARTIAL** traces; no PROFILE_GAIN aggregator |
| L | Holdout **PARTIAL/MISSING** on eval manifests |
| M | No known dialog_200 train leak; expand scripts label contamination |
| N | **YES** single-TTS bias risk |
| O | Pilot 200 **feasible with minimal components** |
| P | See MINIMAL_MISSING_COMPONENTS |
| Q | Runners, Piper, corruptor/realizer, profile_delta, bootstrap path, ACTIVE_SET, norm eval, Model2 trace |
| R | Manifest schema, harness inject, evaluator metrics |
| S | Text-only error injection as main path; dialog_200 as Model2 P yardstick |
| T | `LINGUA_DIALOG2000_V2_PILOT200_DESIGN` |

## Freeze / non-goals

```text
PRODUCTION_CODE_CHANGE = NONE
MODEL2/MODEL3/LEXICON = UNCHANGED
DATASET_GENERATION = NONE this phase
```
