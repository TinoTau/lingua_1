---
title: Document Classification Registry (post Phase-1)
status: SUPPORTING_CONTRACT
supports:
  - docs/current/DOCUMENTATION_GOVERNANCE.md
baseline: FW_V4_FREEZE_2026_08_03
---

# Document Classification Registry

本 Supporting Contract 登记 Phase-1 审计中原 `UNCLASSIFIED` 模块路径的 Primary Classification。  
**不**成为 ASR Pipeline Sole Authority。

| Path prefix / file | Classification | Notes |
|--------------------|----------------|-------|
| `docs/CODING/` | REFERENCE_DATA | Project constitution / engineering principles |
| `docs/logging/` | OPERATING_GUIDE | Observability / usage |
| `docs/project/` | HISTORICAL | Phase summaries |
| `docs/PROJECT_MIGRATION.md` | REFERENCE_DATA | Migration notes |
| `docs/PROJECT_STRUCTURE.md` | REFERENCE_DATA | Structure overview |
| `docs/SHARED_FILES_PLACEMENT.md` | REFERENCE_DATA | Placement notes |
| `docs/README.md` | OPERATING_GUIDE | Legacy module map; entry is `docs/INDEX.md` |
| `docs/user/` | REFERENCE_DATA | PRD / feasibility |
| `docs/decision/` | ARCHITECTURE_DECISION | Pre-ADR decision drafts; migrate gradually to `architecture/adr/` |
| `docs/fw-detector/CONTEXT_PRIOR.md` | SUPPORTING_CONTRACT | diagnostics-only |
| Root `analyze_result.txt` / `job_details_report.txt` / `observability.json` | SCRATCH | Loose root artifacts; do not treat as Acceptance |

权威规则：[`../current/DOCUMENTATION_GOVERNANCE.md`](../current/DOCUMENTATION_GOVERNANCE.md)

Residual closure evidence：[`../acceptance/Documentation/2026-08-04_Documentation_Governance_Residual_Backlog_Closure/`](../acceptance/Documentation/2026-08-04_Documentation_Governance_Residual_Backlog_Closure/)
