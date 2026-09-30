# Model3 Error-Text Pilot Plan

## Goal

Validate generator quality (explainability, lexicon replacement, validation, split) — **not** train final Model3.

## Size

| Item | Value |
|------|-------|
| Target samples | **~3000** |
| Base sentences | **~800** from `baseline_v1` gt (stratify domains) |
| Mix | ~30% clean (0), ~50% single, ~20% double |
| Contrast groups | ≥50 groups |
| Non-repairable / NON_PHONETIC tagged | ≥10% of wrong samples |
| dialog_200 | **0 train** — hold for eval harness |

## Success criteria

1. ≥95% phonetic corruptions pass validation  
2. 0 random-replacement samples  
3. All samples reproducible by seed + generatorVersion  
4. Split leakage checklist green  
5. QA report: family histogram, corruptionCount, easy-negative rate  

## Explicitly out of pilot

- TTS / audio  
- Full 100k  
- Model3 training  
- Runtime wiring  
