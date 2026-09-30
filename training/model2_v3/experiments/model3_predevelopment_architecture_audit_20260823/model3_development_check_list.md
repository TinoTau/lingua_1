# Model3 Development Check List (post-audit)

## Gap closure before training

- [ ] Implement `Model3AnchorAdapter` (DOMAIN + MODEL2 from existing fields)
- [ ] Extend internal span view before `SpanReplacementPick` strip
- [ ] Define `MODEL3_RETRY_TRACE_V1` contract
- [ ] Deterministic trigger gate (document thresholds in contract phase)
- [ ] One-shot flags: `model3Invoked`, `retryCycleDone`
- [ ] Partial recall hook via `recallSpanTopKV2` / cache
- [ ] Re-run assembly + single KenLM pass; global cap 16
- [ ] Offline label generator on dialog_200 (PARTIAL → YES)

## Must not do

- [ ] Modify Single-Char Repair V1 / bundle 14
- [ ] Modify Model2 P/D training or outputs to KEEP/RETRY
- [ ] Add second lexicon pipeline
- [ ] Expand JobResult schema
- [ ] Per-span Model3 calls
- [ ] Recursive retry
- [ ] Model3 text generation or lexicon lookup
- [ ] Local n-gram suspicion scoring

## Tests required (future)

- Anchor mask: anchors never RETRY
- One inference max per utterance
- One retry cycle max
- Candidate pool ≤16 after retry
- length1 fail-closed preserved
- Trace reconstructs full loop
