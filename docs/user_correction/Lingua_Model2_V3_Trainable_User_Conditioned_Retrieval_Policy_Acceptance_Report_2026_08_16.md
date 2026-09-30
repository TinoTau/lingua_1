# Model2 V3 Acceptance Report (2026-08-16)

```text
Model2 V3 Verdict:
PASS

Frozen Architecture:
FINESPAN_USERPROFILE_TRAINABLE_RETRIEVAL_POLICY

Trainable Model2 Core:
ACTIVE

Deterministic Retrieval:
PRIMITIVE_BASELINE

Previous Neural-Not-Needed Verdict:
SUPERSEDED_BY_USER_ARCHITECTURE_DECISION

SameSpanDifferentUser:
PASS

REAL_ASR TargetIntroductionRate:
B0=0.0 B1=1.0 V3=1.0

Exhaustive Deterministic TIR:
1.0

Model2 V3 TIR:
1.0

Recall Retained vs Exhaustive:
0.6812

Query Reduction:
0.3472

Candidate Reduction:
0.3273

Latency Reduction:
0.0000

End-to-End Cost Reduction:
0.3258

Profile Size curves:
see training/model2_v3/experiments/v3_policy_v1/evaluation/profile_scalability_curve.json

UNSEEN_USER / UNSEEN_TERM / UNSEEN_PROFILE_COMBINATION:
see evaluation/*unseen*.json

WrongProfile FalseExpansion:
0.0

Model Parameters:
28354

CPU P50 / P95 (model-only ms):
see latency_metrics.json

Primary Remaining Bottleneck:
Teacher/action coverage on natural REAL_ASR; multi-relation composition data; domain/personal primitives still DEFERRED_BY_DATA

Stage A:
ARCHIVED

Stage B:
DEFERRED

Tone:
HOLD

Node:
HOLD

50k:
HOLD

Architecture Conformance:
PASS

Recommended Next Phase:
Scale teacher dataset to full ACTIVE_SET REAL_ASR; improve pair-action labels; add personal_term/domain primitives when data ready; keep trainable core mandatory
```
