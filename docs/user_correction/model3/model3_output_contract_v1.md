# Model3 Output Contract V1

**Status:** FROZEN  
**Parent:** `MODEL3_ARCHITECTURE_CONTRACT_V1.md`

---

## Business output (only)

```ts
type Model3SpanDecision = {
  spanId: string;
  action: 'KEEP' | 'RETRY';
};

type Model3UtteranceDecision = {
  decisions: Model3SpanDecision[]; // non-anchor targets only
};
```

---

## Rules

1. **Allowed actions:** `KEEP` | `RETRY` only.
2. **No reason taxonomy** in business logic (`RETRY_TONE`, `RETRY_ACCENT`, … forbidden as runtime branches). Diagnostics may live in trace only.
3. **Scores / logits:** allowed for training and thresholding **inside** the model package; **not** part of the business contract consumed by Assembly/KenLM.
4. **Anchor RETRY:** forbidden. Adapter must rewrite / mask to KEEP. Violation → `CONTRACT_FAIL`.
5. **No** `replaceWith`, `correctedText`, `candidateList`, `predictedWord`, `predictedPinyin`, `predictedDomain`.

---

## Runtime consumer

Retry coordinator (Stage6+): for each `RETRY` with `targetMask==1` and `isAnchor==false`, schedule one-shot subset re-recall. Anchors and KEEP spans unchanged.
