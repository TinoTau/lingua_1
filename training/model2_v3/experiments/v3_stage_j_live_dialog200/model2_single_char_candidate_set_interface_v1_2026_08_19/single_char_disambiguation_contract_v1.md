# SingleCharDisambiguationContractV1

**Status:** Stage 1 skeleton (2026-08-19)  
**Scope:** Node + Model2 sidecar internal only. **Not JobResult.**

## Ownership

| Owner | Owns |
|-------|------|
| Lexicon / Operations | membership (future repair lexicon; this round synthetic/test/internal) |
| Recall | bounded candidate set, deterministic order, cap 8 |
| Model2 | SELECT relative index or ABSTAIN when N≥2 |
| Assembly / KenLM | unchanged |

## Routing

| N | Ambiguity invocation | Result |
|---|----------------------|--------|
| 0 | 0 | existing fallback |
| 1 | 0 | existing unique materialization |
| ≥2 | 1 | SELECT candidate_i or ABSTAIN |

Production default without accepted ambiguity weights: **ABSTAIN** (`HEAD_NOT_AVAILABLE`). No Top1, no untrained argmax.

## Candidate-relative

`candidate_index` is request-local 0..N-1. Output classes are `ABSTAIN + C0..C7`, never a closed hanzi inventory.

`surface_hash_aux` is an **auxiliary** feature only.

## Fail closed

Malformed request/decision, OOB index, missing head, infer error → ABSTAIN.

## Same sidecar

New host cmd `disambiguate`. Existing `infer` JSON unchanged. Frozen checkpoint `expA_frozen_trunk.pt` still loads with `with_ambiguity_head=False` (47210 params).
