---
title: Adopt Repository Documentation Governance
status: ACCEPTED
date: 2026-08-03
baseline: FW_V4_FREEZE_2026_08_03
supersedes:
related_ssot: docs/current/DOCUMENTATION_GOVERNANCE.md
related_acceptance: docs/acceptance/Documentation/2026-08-03_Docs_Repository_Governance_and_Consolidation/
---

# ADR-0001 — Adopt Repository Documentation Governance

## Status

ACCEPTED — 2026-08-03

## Context

`docs/` 与模块文档长期积累后出现：

- Acceptance 报告与 `tone-v2` / scratch 多副本并存；
- CURRENT / Supporting / Historical 职责边界模糊；
- 部分索引将同一物理文件同时宣称为 CURRENT 与 Supporting；
- 缺少统一入口与强制 Acceptance Pack 合同；
- 后续 Cursor / 开发者容易从历史报告重新推导架构。

在 `FW_V4_FREEZE_2026_08_03` 恢复基线已建立、Recall 子系统已完成日期节点文档冻结的前提下，需要把**文档治理本身**登记为 Sole Authority。

## Decision

1. 采用分层文档体系：CURRENT → Supporting → Snapshot → Acceptance → ADR → Archive → Scratch。
2. Acceptance 与 CURRENT 严格分离：Acceptance 只作证据。
3. 不删除历史唯一证据；精确重复副本可删除或改为 pointer。
4. 每轮任务只保留一个正式 Acceptance Pack 目录。
5. Sole Authority 正文可继续驻留 `tone-v2` / `fw-detector` 等模块路径，由 `docs/current/INDEX.md` 统一登记。
6. 以 `docs/current/DOCUMENTATION_GOVERNANCE.md` 为 Documentation Governance Sole Authority。
7. 以 `docs:check` 作为文档治理门禁。

## Consequences

- 未来任务必须遵守命名、Metadata、索引更新顺序与单一产物目录。
- 大规模无意义搬迁 Sole Authority 正文被明确禁止（职责清晰优先）。
- 旧报告仍可追溯，但不得覆盖 CURRENT。
- 需要维护 `scripts/docs/check-documentation-governance.mjs`。

## Alternatives Considered

| Alternative | Why rejected |
|-------------|--------------|
| 把所有 Sole Authority 物理搬进 `docs/current/` | 破坏既有 Snapshot / 代码引用，收益低于风险 |
| 删除全部 Historical | 丧失恢复与审计证据 |
| 仅靠口头约定、无 Gate | 无法阻止多副本与平行 CURRENT 再生 |
| 以最新 Acceptance 报告直接替代 CURRENT | 混淆证据与权威 |

## Related SSOT

- `docs/current/DOCUMENTATION_GOVERNANCE.md`
- `docs/current/INDEX.md`

## Related Acceptance

- `docs/acceptance/Documentation/2026-08-03_Docs_Repository_Governance_and_Consolidation/`
