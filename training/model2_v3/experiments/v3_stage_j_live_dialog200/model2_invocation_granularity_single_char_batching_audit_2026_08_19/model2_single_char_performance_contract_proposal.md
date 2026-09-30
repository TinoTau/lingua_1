# Proposed performance contract (not implemented)

1. Per-single-char-span Model2 IPC: **FORBIDDEN**.
2. Batch all N>1 ambiguities for the utterance (or path, then still ≤ pathCount, prefer utterance): **YES**.
3. Merge into existing P/D `infer`: **NOT_WORTH_COMPLEXITY**.
4. Additional single-char Model2 IPC per utterance: **≤ 1**.
5. Do not require total Model2 inferences ≤ 1; P/D remains per-FineSpan until a separate ACP.
6. Failed ambiguity checkpoint must not be loaded in production.
7. Suggested traces (future, do not add now):
   - `model2_total_calls`
   - `model2_p_calls` (forwards; note P+D share forward)
   - `model2_d_retrieval_executed`
   - `single_char_ambiguity_count`
   - `single_char_model2_calls`
   - `model2_total_latency_ms`
