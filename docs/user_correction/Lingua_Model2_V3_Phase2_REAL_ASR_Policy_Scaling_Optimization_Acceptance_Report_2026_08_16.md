# Model2 V3 Phase2 Acceptance Report (2026-08-16)

```text
Model2 V3 Phase2 Verdict:
HOLD

Architecture:
FINESPAN_USERPROFILE_TRAINABLE_RETRIEVAL_POLICY

Architecture Conformance:
PASS

Phase1 Reproduction:
PASS

REAL_ASR Samples:
3987

Policy Training Rows:
39870

Natural Recovery Yield:
0.2122

Primary Yield Loss:
PROFILE_NOT_APPLICABLE

Hard Multi-Relation Samples:
699

High-Cardinality Samples:
2544

B1 Exhaustive TIR:
0.9599427753934192

V3 TIR:
0.9699570815450643

Recall Retained:
1.0104

Previous Recall Retained:
~0.71

Recall Improvement:
0.3004

Query Reduction:
0.0242

Candidate Reduction:
0.0204

E2E Cost Reduction:
0.0189

Dynamic Budget:
BETTER

Best Operating Point:
{"query_budget": 2, "RecallRetained": 0.9985096870342771, "QueryReduction": 0.07676767676767675, "CandidateReduction": 0.048747276688453064, "E2ECostReduction": 0.05687075401618736}

Profile Size curves:
see profile_scalability_curve.json

UNSEEN_USER / UNSEEN_TERM / UNSEEN_USER_TERM / UNSEEN_PROFILE_COMBINATION / UNSEEN_MULTI_RELATION:
see evaluation/*unseen*.json

Primary V3 Failure Class:
LEXICON_RESULT_PRUNED

Teacher Bottleneck:
True

Model Learning Bottleneck:
False

Feature Bottleneck:
False

Action Space Bottleneck:
False

Model Parameters:
45533

CPU P50:
1.561200013384223

CPU P95:
1.9829999946523458

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

Trainable Model2 Core:
REQUIRED / ACTIVE

Deterministic-only Replacement:
NOT_ALLOWED_WITHOUT_USER_APPROVAL

Recommended Next Phase:
If STRONG_PASS: prepare Node wiring proposal (still HOLD until approved). If PASS_WITH_SCALE_REQUIRED: more hard-multi data + continue budget learning. If HOLD: fix primary failure class without architecture drift.
```
