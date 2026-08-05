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
| Runtime Freeze Commit（peeled） | `6889fe16790587df7e711d5ad35b1e50ea53037c` — use `git rev-list -n 1 FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05`（裸 `git rev-parse <tag>` 是 Tag Object，不是 Freeze Commit） |
| Identity Documentation Correction Commit | `0e3bcab1a2e76ea32cbd85fef228c10c3fbfc406` — ≠ Runtime Freeze Commit; see [`resolved_identity.json`](./acceptance/Freeze/2026-08-05_FW_V4_ASR_PostProcess_Framework_Freeze/resolved_identity.json) |
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
