# Model3 Training Label Contract V1

**Status:** FROZEN (design) — **no training this round**  
**Parent:** `MODEL3_ARCHITECTURE_CONTRACT_V1.md`

---

## Critical rule

```text
ASR ≠ reference  ⇏  RETRY
```

Model3 labels only **non-anchor**, **repairable** pronunciation / accent / tone-confusion / phonetic errors under the allowed retry Recall policy.

**Modality note (2026-08-26):** labels describe *why* a span may need RETRY. Model3 **inputs** remain TEXT_ONLY + Anchor — not acoustic Tone/audio tensors.


---

## Positive RETRY (all required)

1. Span is **NON-ANCHOR** (`targetMask` would be 1).
2. First-pass interpretation **differs** from reference on that span (via alignment artifact, not substring heuristic).
3. Error class is compatible with: pronunciation / accent / tone / phonetic confusion / allowed acoustic relaxation.
4. Correct reference candidate is **reachable** under allowed retry Recall (retained domains + base + existing tone/pronunciation capabilities).
5. Retry does **not** require modifying any Anchor.

→ Label: `RETRY`

---

## KEEP / non-retry (include as negatives)

| Class | Description |
|-------|-------------|
| A | Current span already correct |
| B | Incorrect but **not** repairable by Model3 retry policy |
| C | Error would require changing Anchor |
| D | Correct candidate absent from allowed Lexicon universe |
| E | Rare/uncommon phrase but **acoustic evidence strongly supports** current span (**hard negative** vs local-LM collapse) |

---

## Hard negatives (required)

Language-rare but acoustically reliable → **KEEP**. Prevents Model3 → local KenLM.

---

## Contrast pairs (required)

Same surface, different Anchor context → KEEP vs RETRY (e.g. conceptual 裹上+外套 vs 裹上+好日子).  
**Not** runtime hard-coded case rules — training/data generation only.

---

## Anchor in training

- Anchors: **masked from loss** (`targetMask=0`).
- Do **not** train Model3 to predict Anchor correctness.

---

## Alignment

Labels require **stable FineSpan ↔ reference alignment** via `spanId` / offsets / alignment artifact.

**Forbidden:** pure surface `indexOf` / substring heuristic as sole label path.
