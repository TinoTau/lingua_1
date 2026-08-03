---
title: Acceptance Records Index
status: ACCEPTANCE_RECORD
baseline: FW_V4_FREEZE_2026_08_03
---

# Acceptance Records — ASR Post-Processing

| Field | Value |
|-------|-------|
| Status | **ACCEPTANCE_RECORD**（Evidence only） |
| Rule | 不得作为 CURRENT；不得据此重新设计 Framework |
| Governance | [`../current/DOCUMENTATION_GOVERNANCE.md`](../current/DOCUMENTATION_GOVERNANCE.md) |

---

## Layout

```text
docs/acceptance/
  Development/    — Development Report
  Audit/          — Audit Report
  Test/           — Test Report
  Regression/     — Acceptance / Regression / Quality gates
  Freeze/         — Freeze / Consolidation / dated freeze packs
  Documentation/  — Documentation governance / consolidation
```

### Dated packs（强制）

```text
docs/acceptance/<Type>/YYYY-MM-DD_<TaskName>/
  README.md
  report.md
  summary.json
  *.csv / *.md / *.json（按需）
```

每轮任务 **只允许一个** 正式产物目录。禁止同时复制到 `tone-v2` / `fw-detector` / 仓库根目录。

Evidence only — **不得**覆盖 CURRENT SSOT。

入口：[`../INDEX.md`](../INDEX.md) · [`../current/INDEX.md`](../current/INDEX.md)
