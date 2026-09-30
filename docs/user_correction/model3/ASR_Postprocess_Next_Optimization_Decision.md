# ASR Postprocess — Next Optimization Decision

Phase: `ASR_POSTPROCESS_STAGE_PERFORMANCE_QUALITY_BASELINE_AUDIT`  
Date: 2026-09-10  
Evidence: `dialog200_full_pipeline_20260909_001141` / `LINGUA_DIALOG200_BASELINE_V1`

---

## Decision

```text
NEXT_PRIORITY = QUALITY

ONE_NEXT_AUDIT =
PARTIAL_IMPROVEMENT_TO_FULL_RESCUE_AUDIT
```

---

## Why QUALITY (not PERFORMANCE)

1. Postprocess cost is real (~2.4 s p50), but **~75% is a merged FW_rest bucket** without exclusive substage timers → performance owner not isolatable without measurement-only instrumentation.
2. Identified exclusive stages: KenLM ~21%, Retry ~2%, Model3 &lt;1% — Model3/Retry stay frozen; KenLM alone does not explain FULL vs PARTIAL (both pool≈1).
3. Clearest quality phenomenon remains **60 PARTIAL vs 6 FULL_RESCUE** with **near-identical** latency/Retry/pool profiles → need residual-error audit, not a cost cut.

---

## Why this audit (not KenLM / not FW timing)

| Option | Verdict |
|--------|---------|
| PARTIAL_IMPROVEMENT_TO_FULL_RESCUE | **SELECTED** — baseline signal + group compare supports |
| KenLM selection-gap audit | Deferred — 20/71 multi-cand only; many partials have single candidate |
| FW_rest timing instrumentation | Deferred — `MORE_MEASUREMENT` path; not this Delta |
| Model3 / Retry perf | Rejected — frozen + negligible cost |

---

## Next audit scope (reminder)

- Sample **10–20** PARTIAL_IMPROVEMENT (+ optional FULL_RESCUE contrast)
- Offline only on existing RUN_ID
- Allowed residual classes only (lexical / phonetic / selection / incomplete local repair / multi-error / ASR loss / unknown)
- **No production code**
- One later Delta max after owner isolation

---

## Freeze remains

```text
MODEL3 = FROZEN
RETRY_ARCHITECTURE = FROZEN
FULL_MAINLINE = FROZEN
BASELINE_V1 = FROZEN
CAP16 = RETAIN
```
