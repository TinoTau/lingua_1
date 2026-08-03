# Historical artifacts — pre B1/B2 SSOT Repair

| Field | Value |
|-------|-------|
| Archived | 2026-07-27 |
| Reason | Residual Cleanup — remove active duties for obsolete budget / `ngramQueryCount` probes |
| Status | **HISTORICAL ONLY** — do not run as current acceptance tooling |

## What this directory holds

Probes and outputs that assumed:

- `V4_LIMITS.maxSqlPerUtterance = 150` Window-attempt gate
- `ngramQueryCount` as logical attempt counter
- `windowsSkippedDueToSqlBudget` / `budgetSkipped*` diagnostics

Those runtime behaviors were removed in B1. Re-running these scripts against current code yields broken or false metrics.

## Contents

| Path | Original role |
|------|----------------|
| `phase1-acceptance-budget-skip-probe.mjs` | Stub only (body deleted) — was simulated 150-skip probe |
| `phase1-acceptance-completeness-matrix.mjs` | Stub only — was budgetSkipped matrix builder |
| `offline-ltr-perf-probe.mjs` | Stub only — was LTR perf with obsolete metrics |
| `phase0-phase1-utterance-cache-probe.mjs` | Stub only — was cache probe with obsolete metrics |
| `acceptance_completeness_matrix.json` / `.jsonl` | Pre-repair dialog_200 matrix (budgetSkipped evidence) |
| `budget_skipped_readonly_recall_probe.json` | B1 blocker evidence |
| `experiment_snapshots/` | Historical `*quality-perf.json` containing `ngramQueryCount` |

## Do not

- Use as current Phase 1 acceptance
- Overwrite these files with post-repair numbers
- Reintroduce attempt gates to “make scripts work”

## Current active Phase 1 probe

```text
docs/tone-v2/_audit_scratch/phase1-window-edge-dialog200-probe.mjs
```

Uses `logicalWindowRecallCount` and incompleteness checks aligned with B1 SSOT.
