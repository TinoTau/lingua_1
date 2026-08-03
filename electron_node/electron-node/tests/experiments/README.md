# Experiment tools — CURRENT (2026-07-27)

## SpanAssemblyV4 metrics (live)

| Field | Status |
|-------|--------|
| `logicalWindowRecallCount` | **CURRENT** |
| `physicalSqlStatementCount` | **CURRENT** |

Obsolete attempt-gate metrics are **not** read by active scripts. Fail-fast helper: `require-logical-window-recall-count.mjs`.

## Active scripts

- `analyze-span-assembly-v4-dialog200.mjs`
- `analyze-schema-v2-dialog200.mjs`
- `summarize-schema-v2-dialog200.mjs`

Outputs: `*.active.json` (never overwrite archived historical snapshots).

## Historical snapshots

Moved to `docs/tone-v2/_audit_scratch/historical/pre_b1_b2_repair/experiment_snapshots/`.
