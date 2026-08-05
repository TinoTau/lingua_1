# Benchmark Change Log

## KENLM_BENCHMARK_V1 — 2026-08-04

- **Action**: Initial create
- **Baseline**: FW_V4_FREEZE_2026_08_03
- **Source**: Phase 01 real kenlmInput competition ranking (`KENLM_PHASE01_BASELINE_READY`)
- **Cases**: 75 Meaningful Competition (`KLM000001` … `KLM000075`)
- **Policy**: APPEND ONLY
  - Allowed: add cases, change `status`, add notes, add `decisionRevision`
  - Forbidden: overwrite historical decision without revision row, renumber IDs, delete VERIFIED cases

### Revision rules

If a VERIFIED decision must change:

1. Keep original row fields historically reconstructable via `decisionRevision` increment
2. Document reason in this change log
3. Never reuse a retired `benchmarkId` for a different case
