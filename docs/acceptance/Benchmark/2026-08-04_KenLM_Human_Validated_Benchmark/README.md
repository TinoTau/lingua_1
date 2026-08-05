# KenLM Human Validated Competition Benchmark

| Field | Value |
|-------|-------|
| Date | 2026-08-04 |
| Version | **KENLM_BENCHMARK_V1** |
| Baseline | **FW_V4_FREEZE_2026_08_03** |
| Phase 01 | KENLM_PHASE01_BASELINE_READY |
| Nature | **READ ONLY** benchmark construction |
| Verdict | **KENLM_BENCHMARK_READY** |

## Contents

| File | Role |
|------|------|
| `kenlm_benchmark.csv` | Permanent case×candidate rows + humanDecision |
| `benchmark_registry.json` | Version registry |
| `benchmark_statistics.csv` | Decision/status counts (no Accuracy) |
| `benchmark_guideline.md` | Annotation rules |
| `benchmark_change_log.md` | Append-only history |
| `report.md` | Narrative + Q1–Q5 |
| `summary.json` | Machine-readable summary |

## Contract

All future KenLM evaluation **must** run against this benchmark set (`benchmarkId` stable).
