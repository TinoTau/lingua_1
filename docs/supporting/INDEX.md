---
title: Supporting Contracts Index
status: SUPPORTING_CONTRACT
baseline: FW_V4_FREEZE_2026_08_03
supports:
  - docs/current/INDEX.md
---

# Supporting Contracts — ASR Post-Processing

| Field | Value |
|-------|-------|
| Status | **SUPPORTING** |
| Rule | 只能解释 CURRENT；**不是** Sole Authority；不得重新定义 Vote / Path / Cap / Tone Mapping / Atomicity |

权威入口：[`../current/INDEX.md`](../current/INDEX.md) · 治理：[`../current/DOCUMENTATION_GOVERNANCE.md`](../current/DOCUMENTATION_GOVERNANCE.md)

---

## Supporting Inventory（仅 Supporting）

下列文档为 Supporting 或 Operating 指针。  
**Assembly / KenLM / Domain / Architecture 等正文的 Sole Authority 登记在 CURRENT Index**，本表不重复宣称权威。

| 主题 | 文档 | 说明 |
|------|------|------|
| Recall Subsystem Frozen Contract | [`Recall_Subsystem_Frozen_Contract_2026_08_03.md`](./Recall_Subsystem_Frozen_Contract_2026_08_03.md) | Window / Tone Gate / Mode C / Enumerator / Allowed failures · `FROZEN_AT_2026_08_03` |
| Document Classification Registry | [`Document_Classification_Registry_2026_08_03.md`](./Document_Classification_Registry_2026_08_03.md) | 原 UNCLASSIFIED 模块路径归类 |
| Context Prior | [`../fw-detector/CONTEXT_PRIOR.md`](../fw-detector/CONTEXT_PRIOR.md) | diagnostics-only；非排序权威 |
| Recovery Guide | [`../framework_snapshots/FW_V4_FREEZE_2026_08_03/13_Recovery_Guide.md`](../framework_snapshots/FW_V4_FREEZE_2026_08_03/13_Recovery_Guide.md) | Operating：恢复步骤 |
| Snapshot Summary | [`../framework_snapshots/FW_V4_FREEZE_2026_08_03/FRAMEWORK_FREEZE_SUMMARY.md`](../framework_snapshots/FW_V4_FREEZE_2026_08_03/FRAMEWORK_FREEZE_SUMMARY.md) | Snapshot 包摘要（权威身份仍是 Snapshot） |

### CURRENT 路径指针（非 Supporting 权威）

需要阅读 Domain / Assembly / KenLM / Lattice 合同时，回到 [`../current/INDEX.md`](../current/INDEX.md)，不要把下列路径当作第二套 CURRENT：

- `docs/fw-detector/assembly/FROZEN_V1_2.md`
- `docs/fw-detector/kenlm/KENLM_RUNTIME.md`
- `docs/fw-detector/recall/DOMAIN_RECALL.md`
- `docs/fw-detector/DOMAIN_SOURCE_UNIFICATION.md`
- `docs/tone-v2/Lexicon_Domain_Contract_Freeze_V1.md`
- `docs/tone-v2/FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Implementation_Contract_V1.0.0_2026_07_26.md`

Ownership / Decision / Performance / Known Limitations / Acceptance Criteria 以 Snapshot `01`–`13` 与 Runtime SSOT 为准。
