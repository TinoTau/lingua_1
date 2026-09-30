# Minimum-change recommendation

**Recommended:** Option B — collect `singleCharAmbiguousSet` (already produced in `recallSpanTopKV2`) after Recall/lattice materialization, still **inside Lexicon Recall / lattice**, before Domain Vote.

One sidecar cmd, e.g. `disambiguate` with `requests: SingleCharDisambiguationRequestV1[]` (transport only). SELECT/ABSTAIN semantics unchanged.

**Additional Model2 IPC per utterance: ≤ 1** (0 if no N>1).

Do not:

- call Model2 per N>1 FineSpan
- add a SingleCharService / second pipeline / worker queue
- merge into `cmd=infer` (Stage 1 infer JSON frozen; head not production)
- unfreeze trunk or train this round
- import production repair lexicon / change minPrior

Ideal internal flow (unchanged from outside Recall):

```
Recall
  ├─ normal candidate work
  ├─ collect N>1 single-char requests
  ├─ optional 1× Model2 disambiguateBatch
  └─ unified candidate set
→ Domain Vote → Assembly → KenLM
```

Context slices (`rawText` left/right) already exist at FineSpan/window time. Do not add a context encoder here.

**Next phase (not this audit):** shared-representation audit (HEAD_ONLY_INSUFFICIENT). Implement batching only when a head is allowed to ship. Spec the performance contract now so a future implementer cannot choose Option A.
