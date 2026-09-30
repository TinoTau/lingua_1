# Model2 current runtime callgraph

**Audit:** `MODEL2_SINGLE_CHAR_CONTEXT_DISAMBIGUATION_PRE_DEVELOPMENT_AUDIT`  
**Date:** 2026-08-19  
**Source of truth:** code + frozen docs (not prior chat).

```
ASR (asr-step)
  → FW_SPAN_DETECTOR (fw-detector-v4-path)
  → runSpanAssemblyV4Orchestrator
       → runLatticeFineSpanGeneration → PathFineSpan[]
       → recallTopKForWindows / recallSpanTopKV2 → WindowCandidate[]
       → materialize PathFineSpan.candidates
       → resolveCompatibilityRelations → activeCandidates
       → expandActiveCandidatesWithModel2          ★ CURRENT MODEL2 ENTRY
            → buildModel2PolicyInput (finespan-adapter.ts)
            → Model2InferenceHost.infer (inference-host.ts)
                 → sidecar model2_inference_host.py  cmd=infer
                      → RetrievalPolicyV3.forward
                           action_logits (Stage P)
                           domain_action_logits (Stage D)
                      → decode: top-1 query-budget of SINGLE relations
                      → decode: argmax domain action
                      → if not domain_none:
                           execute_domain_action (Python FuzzyPool, max_cands=8)
            → executeProfileLexiconQueries (relation-lexicon-adapter.ts)
            → materializeProfileHits / materializeDomainHits
            → mergeProfileIntoActiveCandidates
       → runDomainAwareAssembly (sameDomain / vote / per-span budget)
       → sentence pool ≤ maxSentenceCandidates=16
       → KenLM rerank/gate
       → apply replacements
  → JobResult (text_asr / extra) → NMT
```

## Entry / caller

| Item | Evidence |
|------|----------|
| Runtime entry | `electron_node/services/model2_runtime/model2_inference_host.py` `Model2HostState.infer` |
| Node caller | `expand-active-candidates.ts` `expandActiveCandidatesWithModel2` |
| Orchestrator hook | `span-assembly-v4-orchestrator.ts` after `activeCandidatesBase`, before `runDomainAwareAssembly` (~L332–353) |
| Input construction | `finespan-adapter.ts` `buildModel2PolicyInput` |
| Feature pack | `pack_batch_inputs(..., feature_hash="v1")` `MODEL2_FEATURE_HASH_V1` |
| Action decode | host: sigmoid `action_logits`, keep `kind==single` with phonetic_bias>0, `STAGE_P_QUERY_BUDGET_OP=1` |
| Domain decode | argmax `domain_action_logits`; `domain_none` skips executor |
| Candidate application | Node materialize + merge into `activeCandidates` |
| Downstream | DomainAwareAssembly → KenLM → JobResult |

## Invocation policy

- ONE inference per PathFineSpan that yields a policy input (non-empty span syllables).
- Empty UserProfile still runs the model (no external skip gate). Load/infer failure: graceful no-op, base continues.
- No length==1 skip. Length-1 FineSpans are inferred with the same P/D heads.

## Not in this graph

- Model2 does not write JobResult fields for internal state (`model2-runtime/types.ts`: internal only).
- Model2 does not assemble sentences or score KenLM.
- Model2 does not query the full lexicon as open search; P uses selected relation primitives; D uses selected domain slot FuzzyPool.
