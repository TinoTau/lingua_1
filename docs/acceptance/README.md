# Acceptance Records — ASR Post-Processing

| Field | Value |
|-------|-------|
| Status | **ACCEPTANCE_RECORD**（Evidence only） |
| Rule | 不得作为 CURRENT；不得据此重新设计 Framework |

---

## Layout

```text
docs/acceptance/
  Development/   — Development Report
  Test/          — Test Report
  Freeze/        — Freeze / Consolidation / dated task packs
  Regression/    — Acceptance / Regression / Quality gates
```

### Dated Freeze packs（自 2026-08-03）

```text
docs/acceptance/Freeze/YYYY-MM-DD_<TaskName>/
  README.md
  report.md
  summary.json
  *.csv
  *.md
```

Evidence only — **不得**覆盖 CURRENT SSOT。

入口：[`../current/INDEX.md`](../current/INDEX.md)
