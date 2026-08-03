# Supporting Contracts — ASR Post-Processing

| Field | Value |
|-------|-------|
| Status | **SUPPORTING** |
| Rule | 只能解释 CURRENT；不得重新定义 Vote / Path / Cap / Tone Mapping / Atomicity |

权威入口：[`../current/INDEX.md`](../current/INDEX.md)

---

## Supporting Inventory

| 主题 | 文档 | 说明 |
|------|------|------|
| Lexicon Domain Contract | [`../tone-v2/Lexicon_Domain_Contract_Freeze_V1.md`](../tone-v2/Lexicon_Domain_Contract_Freeze_V1.md) | Domain fact（与 CURRENT 重叠时以 Index 为准） |
| Domain Source Unification | [`../fw-detector/DOMAIN_SOURCE_UNIFICATION.md`](../fw-detector/DOMAIN_SOURCE_UNIFICATION.md) | Domain 来源 / Registry |
| Domain Recall | [`../fw-detector/recall/DOMAIN_RECALL.md`](../fw-detector/recall/DOMAIN_RECALL.md) | Recall 与 domains[] |
| Assembly FROZEN V1.2 | [`../fw-detector/assembly/FROZEN_V1_2.md`](../fw-detector/assembly/FROZEN_V1_2.md) | Assembly 内部细节 |
| KenLM Runtime | [`../fw-detector/kenlm/KENLM_RUNTIME.md`](../fw-detector/kenlm/KENLM_RUNTIME.md) | score/rank/pick 边界 |
| Context Prior | [`../fw-detector/CONTEXT_PRIOR.md`](../fw-detector/CONTEXT_PRIOR.md) | diagnostics-only |
| Architecture Overview | [`../fw-detector/ARCHITECTURE.md`](../fw-detector/ARCHITECTURE.md) | 短总览 |
| Diagnostics Freeze | [`../fw-detector/diagnostics/FROZEN.md`](../fw-detector/diagnostics/FROZEN.md) | Trace / diagnostics |
| Interface Freeze | [`../fw-detector/INTERFACE_FREEZE.md`](../fw-detector/INTERFACE_FREEZE.md) | 接口冻结表 |
| Framework Freeze Registry | [`../fw-detector/freeze/FROZEN.md`](../fw-detector/freeze/FROZEN.md) | 子合同入口 |
| Implementation Contract | [`../tone-v2/FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Implementation_Contract_V1.0.0_2026_07_26.md`](../tone-v2/FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Implementation_Contract_V1.0.0_2026_07_26.md) | DTO / fallback / prune |
| Evolution Rule | [`../tone-v2/Lingua_Runtime_Evolution_Rule.md`](../tone-v2/Lingua_Runtime_Evolution_Rule.md) | 演进规则 |
| Recovery Guide | [`../framework_snapshots/FW_V4_FREEZE_2026_08_03/13_Recovery_Guide.md`](../framework_snapshots/FW_V4_FREEZE_2026_08_03/13_Recovery_Guide.md) | 恢复步骤 + 文档阅读顺序 |
| Snapshot Summary | [`../framework_snapshots/FW_V4_FREEZE_2026_08_03/FRAMEWORK_FREEZE_SUMMARY.md`](../framework_snapshots/FW_V4_FREEZE_2026_08_03/FRAMEWORK_FREEZE_SUMMARY.md) | Freeze 包摘要 |
| Recall Subsystem Frozen Contract | [`Recall_Subsystem_Frozen_Contract_2026_08_03.md`](./Recall_Subsystem_Frozen_Contract_2026_08_03.md) | Window/Tone Gate/Mode C/Enumerator/Allowed failures · `FROZEN_AT_2026_08_03` |

Ownership / Decision / Performance / Known Limitations / Acceptance Criteria 等细节以 Snapshot 包内 `01`–`13` 与 Runtime SSOT 为准；本目录不新增平行 SSOT。