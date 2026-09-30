# 01 — Architecture Snapshot

| Field | Value |
|-------|-------|
| Snapshot | **FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05** |

## Main Chain

**Current CODE_REALITY (authoritative as of 2026-08-23 Model3 contract sync):**

```text
ASR Raw
→ FW normalize
→ Syllable Coordinate / CoarseSpan
→ Lattice FineSpan + Exact Recall (plain+tone Mode C)
→ Tone Rebind
→ Compatibility
→ Model2 P/D (Stage-J; expand activeCandidates)
→ Domain Vote
→ SameDomain Bucket (+ Base co-assembly)
→ Assembly DFS
→ CrossPath ≤16
→ KenLM score/rank/pick
→ Apply
→ JobResult
```

**Historical snapshot wording (2026-08-05, pre–Model2 Stage-J wiring note):**

```text
ASR Raw → Syllable Coordinate → Lattice Window → Tone Evidence
→ Exact Recall (plain+tone) → Domain Vote → SameDomain Bucket
→ Assembly DFS → CrossPath ≤16 → KenLM score/rank/pick → Apply
```

> Model2 Stage-J was integrated **after** Compatibility and **before** Domain Vote.
> Active diagrams must use CODE_REALITY above. Do not omit Model2.

## Forbidden

```text
Plain Recall fallback · Fuzzy SQL · Tone OR Plain · Shadow Path
Semantic Beam · KenLM Beam · LLM in main chain · Interactive Repair in main chain
Model3 text generation / Anchor discovery / second Recall pipeline (future ACP required)
```

Authority: Lattice Architecture V1.0.0 · Runtime SSOT V1.2 · `docs/fw-detector/ARCHITECTURE.md` · Model3 Architecture Contract V1
