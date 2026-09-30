# HISTORICAL_NON_PARITY_INPUT

`model3_v1_feature_contract_dialog200_anchored.jsonl` is a **historical** V1-era
dialog_200 FineSpan / margin dump.

It MUST NOT be used as production-equivalent RealDist evaluation input:

- FineSpans are frozen historical inventories (not current PathFineSpan)
- `firstPassCandidateCount` / packed features are not present
- Offline probes that defaulted `cand=0` and `pinyin=True` are **invalid** for parity

Authoritative evaluation SSOT (after MODEL3_V2_OFFLINE_EVAL_PIPELINE_CORRECTION):

`docs/user_correction/model3/model3_v2_live_input_trace.jsonl`
