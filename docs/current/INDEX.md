# CURRENT SSOT — ASR Post-Processing

| Field | Value |
|-------|-------|
| Status | **CURRENT** |
| Recovery Baseline | [`FW_V4_FREEZE_2026_08_03`](../framework_snapshots/FW_V4_FREEZE_2026_08_03/FRAMEWORK_FREEZE_SUMMARY.md) |
| Rule | 唯一 CURRENT 入口目录；禁止 `CURRENT_V2` / `LATEST` / `FINAL` / `NEW` 平行权威 |

---

## Future Reading Order

```text
1. Framework Snapshot (FW_V4_FREEZE_2026_08_03)
2. CURRENT (this index → Sole Authorities)
3. Supporting (docs/supporting/)
4. Acceptance (docs/acceptance/) — evidence only
5. Archive (docs/archive/) — as needed
```

禁止从历史 Development / Audit / Test 报告重新设计已冻结 Framework。

---

## Sole Authorities（最小 CURRENT）

权威正文仍驻留原路径（避免破坏 Snapshot / 代码引用）；**语义上**以下为唯一 CURRENT：

| 主题 | 文档 |
|------|------|
| Document Index | [`../tone-v2/RUNTIME_DOMAIN_DOCUMENT_INDEX.md`](../tone-v2/RUNTIME_DOMAIN_DOCUMENT_INDEX.md) |
| Framework Snapshot Entry | [`../framework_snapshots/FRAMEWORK_FREEZE_SUMMARY.md`](../framework_snapshots/FRAMEWORK_FREEZE_SUMMARY.md) |
| Lattice Architecture | [`../tone-v2/FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md`](../tone-v2/FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md) |
| Runtime SSOT | [`../tone-v2/Runtime_SSOT_Contract_Freeze.md`](../tone-v2/Runtime_SSOT_Contract_Freeze.md) |
| Evolution Rule | [`../tone-v2/Lingua_Runtime_Evolution_Rule.md`](../tone-v2/Lingua_Runtime_Evolution_Rule.md) |
| Atomicity | [`../tone-v2/FW_Repair_V4_Atomicity_Closure_SSOT_Freeze_2026_08_02.md`](../tone-v2/FW_Repair_V4_Atomicity_Closure_SSOT_Freeze_2026_08_02.md) |
| Tone Evidence / Mapping | [`../tone-v2/FW_Repair_V4_ToneEvidence_Mapping_Final_Freeze_Report_2026_07_29.md`](../tone-v2/FW_Repair_V4_ToneEvidence_Mapping_Final_Freeze_Report_2026_07_29.md) |
| Tone Contract Freeze | [`../tone-v2/TONE_V2_CONTRACT_FREEZE.md`](../tone-v2/TONE_V2_CONTRACT_FREEZE.md) |
| Implementation Contract | [`../tone-v2/FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Implementation_Contract_V1.0.0_2026_07_26.md`](../tone-v2/FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Implementation_Contract_V1.0.0_2026_07_26.md) |
| Lexicon Domain Contract | [`../tone-v2/Lexicon_Domain_Contract_Freeze_V1.md`](../tone-v2/Lexicon_Domain_Contract_Freeze_V1.md) |
| Framework Freeze Registry | [`../fw-detector/freeze/FROZEN.md`](../fw-detector/freeze/FROZEN.md) |

### fw-detector 冻结子合同（CURRENT 边界）

| 主题 | 文档 |
|------|------|
| Architecture Overview | [`../fw-detector/ARCHITECTURE.md`](../fw-detector/ARCHITECTURE.md) |
| Domain Source Unification | [`../fw-detector/DOMAIN_SOURCE_UNIFICATION.md`](../fw-detector/DOMAIN_SOURCE_UNIFICATION.md) |
| Domain Recall | [`../fw-detector/recall/DOMAIN_RECALL.md`](../fw-detector/recall/DOMAIN_RECALL.md) |
| Assembly | [`../fw-detector/assembly/FROZEN_V1_2.md`](../fw-detector/assembly/FROZEN_V1_2.md) |
| KenLM Runtime Boundary | [`../fw-detector/kenlm/KENLM_RUNTIME.md`](../fw-detector/kenlm/KENLM_RUNTIME.md) |
| Validator / Interface Freeze | [`../fw-detector/INTERFACE_FREEZE.md`](../fw-detector/INTERFACE_FREEZE.md) |
| Diagnostics | [`../fw-detector/diagnostics/FROZEN.md`](../fw-detector/diagnostics/FROZEN.md) |

冲突优先级：

```text
Lattice Architecture V1.0.0
> Runtime_SSOT_Contract_Freeze V1.2
> Supporting Contracts
> Acceptance Records
> Archive
```

---

## 非 CURRENT

| 层级 | 路径 | 用途 |
|------|------|------|
| Supporting | [`../supporting/INDEX.md`](../supporting/INDEX.md) | 解释 CURRENT |
| Acceptance | [`../acceptance/README.md`](../acceptance/README.md) | Evidence |
| Archive | [`../archive/README.md`](../archive/README.md) | 追溯 |

`docs/tone-v2/` 下大量 `# MOVED` stub 仅作旧链跳转，**不是** CURRENT。
