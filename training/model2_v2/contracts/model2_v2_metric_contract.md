# Model2 V2 Metric Contract

## Primary (introduction)

- TargetIntroductionRate
- ProfileOnlyTargetRecovery
- ProfileConditionalRecallGain (= Correct − Empty)
- NewCandidatePrecision (proxy)
- FalseExpansionRate / WrongProfileFalseExpansion

## Not primary

- Stage A Recall@K, ConditionGain, TargetRankDelta (post-recall only if Stage B V2 later)

## Baselines

- B0 Empty Profile
- B1 Deterministic FineSpan profile expansion
- B2 Model2 V2 neural activator (optional if adds value)
