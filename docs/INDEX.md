---
title: Lingua Docs — Unified Entry
status: OPERATING_GUIDE
baseline: FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05
---

# Lingua Documentation — Start Here

```text
1. Documentation Governance
2. Framework Snapshot
3. CURRENT SSOT Index → Sole Authority
4. Supporting (if needed)
5. Acceptance (evidence only)
6. Do not re-derive architecture from Historical reports
```

## Start Here

| Step | Document |
|------|----------|
| Documentation Governance | [`current/DOCUMENTATION_GOVERNANCE.md`](./current/DOCUMENTATION_GOVERNANCE.md) |
| Current recovery baseline | [`framework_snapshots/FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05/FRAMEWORK_FREEZE_SUMMARY.md`](./framework_snapshots/FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05/FRAMEWORK_FREEZE_SUMMARY.md) |
| CURRENT SSOT Index | [`current/INDEX.md`](./current/INDEX.md) |

## Current SSOT

[`current/INDEX.md`](./current/INDEX.md) — Sole Authorities for ASR Post-Processing / Lattice / Tone / Recall / KenLM Runtime / …

## Framework Snapshot

[`framework_snapshots/FRAMEWORK_FREEZE_SUMMARY.md`](./framework_snapshots/FRAMEWORK_FREEZE_SUMMARY.md)

Previous historical baseline (do not rewrite): [`framework_snapshots/FW_V4_FREEZE_2026_08_03/FRAMEWORK_FREEZE_SUMMARY.md`](./framework_snapshots/FW_V4_FREEZE_2026_08_03/FRAMEWORK_FREEZE_SUMMARY.md)

## Supporting Contracts

[`supporting/INDEX.md`](./supporting/INDEX.md)

## Architecture Decisions

[`architecture/INDEX.md`](./architecture/INDEX.md)

## Acceptance Records

[`acceptance/README.md`](./acceptance/README.md)

正式产物只能写入：

```text
docs/acceptance/{Development|Audit|Test|Regression|Freeze|Documentation}/YYYY-MM-DD_<TaskName>/
```

## Operating Guides

[`operating/INDEX.md`](./operating/INDEX.md) · [`setup/`](./setup/) · [`troubleshooting/`](./troubleshooting/)

## Historical Archive

[`archive/INDEX.md`](./archive/INDEX.md)

## Documentation Governance

[`current/DOCUMENTATION_GOVERNANCE.md`](./current/DOCUMENTATION_GOVERNANCE.md)

门禁：`npm run docs:check`（见 `electron_node/electron-node/package.json`）

## Legacy README

模块概览与跨仓文档位置见 [`README.md`](./README.md)（项目导览；**不以**其替代 CURRENT Index）。
