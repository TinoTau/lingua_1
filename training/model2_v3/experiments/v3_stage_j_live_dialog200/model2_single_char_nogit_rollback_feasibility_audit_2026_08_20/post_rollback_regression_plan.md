# Post-rollback regression plan

Do not use git. After filesystem backup + edits:

1. Frozen checkpoint still on disk; sha256 match expA.
2. `RetrievalPolicyV3(with_domain_head=True)` param_count == 47210.
3. `load_state_dict(expA, strict=True)` empty missing/unexpected.
4. Host `cmd=load` + `cmd=infer` smoke (existing Stage J Node tests).
5. Stage P relevant: `model2-runtime.test.ts` / final-closure P cases as already used for Stage J.
6. Stage D: domain executor parity scripts from runtime-swap experiment if still present.
7. Node Recall: `recall-span-topk-v2-length1-collector-observability.sqlite.integration.test.ts` (KEEP).
8. Single-char no-Model2: grep must find zero `disambiguate` / `with_ambiguity_head` / `AmbiguityHead` / `singleCharAmbiguousSet` in production TS/PY (docs retired separately).
9. Second-model check: still one sidecar script, one RetrievalPolicyV3 load.
10. Shadow-path: no leftover `cmd=disambiguate`, no `materializeSelectedSingleCharCandidate`.
11. dialog_200: optional / HOLD if infra still incomplete (Stage J live report NOT COMPLETE); do not treat as a new gate invented this audit.
12. Confirm `expand-active-candidates` still only `infer`.
