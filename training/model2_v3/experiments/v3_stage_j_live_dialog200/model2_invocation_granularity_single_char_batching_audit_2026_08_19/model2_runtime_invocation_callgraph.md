# Model2 runtime invocation call graph (production)

AUDIT ONLY. Source: Node + Python as of 2026-08-19. No code change.

```
Job (inference-service.ts)
  ctx.userProfileV1 = options.userProfile   // PER_UTTERANCE
        │
        ▼
fw-detector-v4-path.ts
  runSpanAssemblyV4Orchestrator({ userProfile })
        │
        ▼
lattice-fine-span-runtime.ts
  Window → recallSpanTopKV2 / recallTopKForWindows
  (length-1 may attach singleCharAmbiguousSet; hits still 0|1)
  → PathFineSpanView[]
        │
        ▼
span-assembly-v4-orchestrator.ts
  for each path in lattice.pathFineSpanViews:          // PER_PATH
      compatibility → activeCandidates
      expandActiveCandidatesWithModel2(pathFineSpans)  // AFTER recall, BEFORE vote/assembly
        │
        ▼
    expand-active-candidates.ts
      for each PathFineSpan:                           // PER_SPAN
          buildModel2PolicyInput (copies profile)
          host.infer({ cmd: infer, one span })         // 1 JSONL IPC
                │
                ▼
          model2_inference_host.py Host.infer
            pack_batch_inputs(batch=1)
            model.forward()  → P logits + D logits     // ONE inference
            decode P singles (query_budget_op=1)
            if not domain_none: execute_domain_action  // lexicon, not 2nd model
            return JSON
          Node: P lexicon queries (if actions) + materialize D hits
      mergeProfileIntoActiveCandidates
        │
        ▼
      runDomainAwareAssembly (Domain Vote + buckets)
        │
        ▼
cross-path merge → KenLM → JobResult
```

Sidecar: ONE process, stdin/stdout JSONL, FIFO queue (`inference-host.ts` `_request`). `disambiguate` exists; always ABSTAIN / HEAD_NOT_AVAILABLE; **not** called from production recall.

P and D share one `forward`. Do not count P+D as two inferences.
