# Current Model2 invocation lifecycle

## Granularity

| Layer | Granularity | Owner |
|---|---|---|
| Orchestrator expand hook | PER_PATH | `span-assembly-v4-orchestrator.ts` loop `pathFineSpanViews` |
| Infer IPC | PER_FINESPAN | `expand-active-candidates.ts` `for (const span of pathFineSpans)` |
| Python `model.forward` | PER_FINESPAN (batch size 1) | `model2_inference_host.py` `infer` |
| P head | same forward | `action_logits` |
| D head | same forward | `domain_action_logits` |
| P lexicon execute | only if P actions selected | Node `executeProfileLexiconQueries` |
| D lexicon execute | only if not `domain_none` | Python `execute_domain_action` |

## dialog_200 (existing retrieval trace, no ASR rerun)

4181 `infer` rows / 200 dialogs.

- Total inferences/IPC per utterance: P50 **20**, P95 **31**, MAX **37**
- P retrieval EXECUTED: **0** (empty UserProfile phonetic_bias)
- D retrieval EXECUTED: P50 **5**, P95 **9**, MAX **10** (still one forward per span)

Calls scale **linearly with FineSpan count × path count**. Path distribution (lattice freeze): 170×1 path, 21×2, 9×4.

## Batch support

`pack_batch_inputs` has a batch dimension. Production `infer` always passes a single span. Classification: **PARTIAL**.

## Profile

Loaded per job onto `JobContext`. Re-serialized into **every** span `infer` JSON. Sidecar does not keep session profile.
