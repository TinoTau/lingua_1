# Lingua Model2 V2 — Acceptance Report (2026-08-16)

## Architecture Conformance

| Check | Value |
|-------|-------|
| FineSpan authoritative | YES |
| Profile affects retrieval | YES |
| Target absent before primary retrieval | YES |
| Lexicon introduces lexical candidate | YES |
| Model predicts relation/query rather than term identity | YES |
| Whole utterance retrieval | NO |
| Legacy Stage A active | NO |
| Legacy Stage B active | NO |
| Shadow fallback | NO |

## Gates

- Dataset: PASS
- Retrieval: {'Correct_gt_Empty': True, 'Correct_gt_Wrong': True, 'Correct_gt_Swapped': True, 'ProfileOnlyRecovery_gt_0': True}
- Generalization UNSEEN_TERM TIR=0.25, UNSEEN_USER TIR=0.17391304347826086
- Safety NO_CHANGE FalseExpansion=0.0000
- Architecture: PASS

## Final Verdict

```text
Model2 V2 Verdict:
PASS

Architecture:
FINESPAN_PROFILE_RECALL_V2

Legacy Model2 V1:
SUPERSEDED

Dataset Contract:
PASS

Training Contract:
PASS

FineSpan Runtime-Conforming Evaluation:
PASS

REAL_ASR TargetIntroductionRate:
0.1750 (B1 deterministic; primary acceptance)

REAL_ASR ProfileOnlyTargetRecovery:
0.1750

Correct Profile TIR:
0.1750

Empty Profile TIR:
0.0000

Wrong Profile TIR:
0.0000

Swapped Profile TIR:
0.0000

UNSEEN_TERM:
0.25

UNSEEN_USER:
0.17391304347826086

NO_CHANGE FalseExpansion:
0.0000

Deterministic Baseline:
0.1750

Model2 V2 Neural:
0.0000

Does Trained Model Add Value Over Deterministic Retrieval:
NO

Stage A:
ARCHIVED
Reason: closed-set ranking is not Model2 recall; removed from authoritative V2 path

Stage B:
DEFERRED

Any Legacy Checkpoint Loaded:
NO

Any Compatibility Fallback:
NO

Any Whole-Utterance Retrieval:
NO

Architecture Conformance:
PASS

Tone:
HOLD

Node:
HOLD

50k:
HOLD

Neural component:
MODEL2_NEURAL_COMPONENT_NOT_NEEDED

Recommended Next Phase:
Freeze FineSpan+UserProfile+deterministic lexicon expansion as Model2 V2 core; optional neural only if later multi-relation gating proves value; Stage B V2 only after recall freeze if post-merge binding needed
```

Artifacts: `training/model2_v2/experiments/v2_recall_v1/go_summary.json`
