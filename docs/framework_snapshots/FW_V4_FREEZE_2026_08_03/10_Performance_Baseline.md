# 10 — Performance Baseline

| Field | Value |
|-------|-------|
| Snapshot | **FW_V4_FREEZE_2026_08_03** |
| Nature | **Stage regression baseline** — not open-domain accuracy proof |

---

## Lexicon Identity

| Field | Value |
|-------|-------|
| bundleVersion | 12 |
| term count | 9256 |
| domain tag count | 655 |
| checksum | `ab78bf3599911711fc18ce59c62ab93c8f50c5410a1a6254e01125a244ce1f76` |

## dialog_200

| Metric | Value |
|--------|-------|
| case count | 200 |
| completedCases | 200 |
| failedCases | 0 |
| latticeUncovered | 0 |
| kenlmInputCount | 200 |
| Pre-KenLM p50 | 56 ms（freeze re-verify 2026-08-03；prior closure 41 ms） |
| Pre-KenLM p95 | 100 ms（prior closure 70 ms） |
| Pre-KenLM max | 165 ms（prior closure 111 ms） |

Hard gates unchanged. Latency variance is machine/load observation, not architecture failure.

Evidence: `docs/tone-v2/_audit_scratch/post_atomicity_dialog200/dialog200_summary.json`
