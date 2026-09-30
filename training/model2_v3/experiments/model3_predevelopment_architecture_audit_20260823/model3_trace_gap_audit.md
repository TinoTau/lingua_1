# Model3 Trace Gap Audit

## Known observability evidence (from Single-Char V1 final acceptance)

- bundle14 dialog_200: **26/200** changed cases with same ASR but different final — **could not attribute** because length1 collector not in default export
- `length1Collector` only under `MODEL2_DIALOG200_TRACE=1` in `model2PathTrace`

## Current trace contracts

| Contract | Coverage |
|----------|----------|
| `SINGLE_CHAR_COLLECTOR_TRACE_V1` | length=1 recall only |
| `spanAssemblyV4` diagnostics | coarse/recall/pool/combination summaries |
| `MODEL2_DIALOG200_TRACE=1` | paths, kenlm_input, model2 inference |
| `LEXICON_RECALL_V2_DIAGNOSTICS=1` | recall timing |

## Missing for Model3 loop

| Field / event | Status |
|---------------|--------|
| anchor_mask per span | MISSING |
| anchorSource DOMAIN/MODEL2 | MISSING |
| model3_trigger_gate reason | MISSING |
| model3_input snapshot | MISSING |
| model3_output KEEP/RETRY per spanId | MISSING |
| retry_pass_id (0 vs 1) | MISSING |
| re-recall candidates per retried span | MISSING |
| assembly candidates post-retry | PARTIAL in v4 trace |
| KenLM ranking post-retry | PARTIAL |

## Verdict

**PARTIAL** — insufficient for training/debug without new internal trace contract.
