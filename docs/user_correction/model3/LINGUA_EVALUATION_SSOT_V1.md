# EVALUATION_SSOT_V1

**Authority:** Evaluation / measurement layer only.  
**Rule:** Evaluator output is evidence, not production specification.

## Concepts

| Concept | Definition | May drive FAIL? |
|---------|------------|-----------------|
| REFERENCE_SENTENCE | Dataset reference final sentence | Final correctness only |
| REFERENCE_DIFF_REGION | ASR↔reference alignment/diff hunk | **No** — diagnostics only |
| LEXICAL_TARGET | Unit independently recallable under production lexical contract; requires **authoritative annotation** | Only with authority |
| EXPECTED_FINAL_SENTENCE | Same as reference for final output compare | Final correctness |

**Frozen:** `REFERENCE_DIFF_REGION != LEXICAL_TARGET`

## Measurement status

| Status | Meaning |
|--------|---------|
| PASS | Contract applicable, evidence sufficient, behavior matches |
| FAIL | Contract applicable, evidence sufficient, behavior violates Frozen contract |
| UNKNOWN | Evidence insufficient |
| NOT_APPLICABLE | Contract does not apply to case |
| NOT_EVALUABLE | Current replay/environment cannot measure the contract |

**Forbidden:** missing evidence → FAIL

## Replay capability (LEXICON_MOCK_REPLAY)

| Stage | Capability |
|-------|------------|
| REFERENCE_DIFF | EVALUABLE |
| LEXICAL_TARGET | ONLY_IF_AUTHORITATIVE_ANNOTATION |
| BASE_TONE_EXACT_QUERY | NOT_EVALUABLE without acoustic tone |
| MODEL2_P_ACTION | NOT_EVALUABLE without P evidence |
| FINAL_OUTPUT | EVALUABLE |

## Machine module

`electron_node/electron-node/tests/lib/evaluation-ssot-v1.mjs`
