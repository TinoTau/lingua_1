# Model3 Performance Contract V1

**Status:** Engineering target (not a PASS threshold)

## Inference

| Item | Contract |
|------|----------|
| Granularity | One inference per eligible utterance (path view) — not per-span loops |
| Initial model budget | **5–15 ms** CPU p50 **engineering target** |
| Trigger rate | **TO_MEASURE** — never invent percentages |

## Cost reality

True incremental cost is often:

```text
re-recall + re-assembly
```

not Model3 itself — KenLM still runs **once** (pre-KenLM insertion).

## Future measured metrics (Stage7)

- Eligible utterance rate  
- Model3 invoked rate  
- RETRY rate  
- Avg retry spans / utterance  
- Avg added latency (p50/p95)  
