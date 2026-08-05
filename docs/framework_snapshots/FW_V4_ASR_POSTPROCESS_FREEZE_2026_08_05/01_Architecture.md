# 01 — Architecture Snapshot

| Field | Value |
|-------|-------|
| Snapshot | **FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05** |

## Main Chain

```text
ASR Raw → Syllable Coordinate → Lattice Window → Tone Evidence
→ Exact Recall (plain+tone) → Domain Vote → SameDomain Bucket
→ Assembly DFS → CrossPath ≤16 → KenLM score/rank/pick → Apply
```

## Forbidden

```text
Plain Recall fallback · Fuzzy SQL · Tone OR Plain · Shadow Path
Semantic Beam · KenLM Beam · LLM in main chain · Interactive Repair in main chain
```

Authority: Lattice Architecture V1.0.0 · Runtime SSOT V1.2 · `docs/fw-detector/ARCHITECTURE.md`
