# SUPERSEDED — Capture V2 Decision Required

**STATUS: SUPERSEDED by `LINGUA_FROZEN_EVIDENCE_CAPTURE_CONTRACT_V2.md` (FROZEN).**

| ID | Resolution |
|----|------------|
| D1 Float | FLOAT_EXACT_DISCRETE / FLOAT_TIME (0.001s, ALIGNMENT_TIME_TOLERANCE_SEC) / FLOAT_MODEL_SCORE (KenLM 1e-6 SCORE_ABS_TOLERANCE; else NOT_EVALUABLE) |
| D2 Base comparator | SET primary; MULTISET secondary; ordered not default |
| D3 SQL depth | HASH_PLUS_SUMMARY |
| D4 Model3 | FULL anchors + inference_input_trace + decisions; packed HASH |
| D5 Hook authority | `FROZEN_EVIDENCE_CAPTURE_V2=1` + OBSERVABILITY_ONLY_CHANGE authorized |

Do not use this file as implementation authority.
