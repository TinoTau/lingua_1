---
title: CURRENT SSOT Index — ASR Post-Processing
status: CURRENT_SSOT
authority: CURRENT_INDEX
baseline: FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05
reviewed_at: 2026-08-05
---

# CURRENT SSOT — ASR Post-Processing

| Field | Value |
|-------|-------|
| Status | **CURRENT** |
| Recovery Baseline | [`FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05`](../framework_snapshots/FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05/FRAMEWORK_FREEZE_SUMMARY.md) |
| Runtime Freeze Tag | `FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05` |
| Runtime Freeze Commit（peeled） | `6889fe16790587df7e711d5ad35b1e50ea53037c` |
| Annotated Tag Object | `d9a401a5d1dbb465a648e156679f656b7e09289f` |
| Identity Documentation Correction Commit | `0e3bcab1a2e76ea32cbd85fef228c10c3fbfc406` — **does not** change frozen runtime; **does not** move Tag; see [`resolved_identity.json`](../acceptance/Freeze/2026-08-05_FW_V4_ASR_PostProcess_Framework_Freeze/resolved_identity.json) |
| Previous Baseline | [`FW_V4_FREEZE_2026_08_03`](../framework_snapshots/FW_V4_FREEZE_2026_08_03/FRAMEWORK_FREEZE_SUMMARY.md)（Historical） |
| Unified Docs Entry | [`../INDEX.md`](../INDEX.md) |
| Documentation Governance | [`DOCUMENTATION_GOVERNANCE.md`](./DOCUMENTATION_GOVERNANCE.md) |
| Rule | 唯一 CURRENT 入口目录；禁止 `CURRENT_V2` / `LATEST` / `FINAL` / `NEW` 平行权威 |

---

## Future Reading Order

```text
1. Documentation Governance
2. Framework Snapshot (FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05)
3. CURRENT (this index → Sole Authorities)
4. Supporting (docs/supporting/)
5. Acceptance (docs/acceptance/) — evidence only
6. Archive (docs/archive/) — as needed
```

禁止从历史 Development / Audit / Test 报告重新设计已冻结 Framework。

---

## Sole Authorities（最小 CURRENT）

权威正文仍驻留原路径（避免破坏 Snapshot / 代码引用）；**语义上**以下为唯一 CURRENT：

| 主题 | 文档 |
|------|------|
| Documentation Governance | [`DOCUMENTATION_GOVERNANCE.md`](./DOCUMENTATION_GOVERNANCE.md) |
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
| Assembly（含 Enumeration + Formula A） | [`../fw-detector/assembly/FROZEN_V1_2.md`](../fw-detector/assembly/FROZEN_V1_2.md) |
| Interface / SentenceCombination | [`../fw-detector/INTERFACE_FREEZE.md`](../fw-detector/INTERFACE_FREEZE.md) |
| KenLM Runtime Boundary | [`../fw-detector/kenlm/KENLM_RUNTIME.md`](../fw-detector/kenlm/KENLM_RUNTIME.md) |
| Validator / Interface Freeze | [`../fw-detector/INTERFACE_FREEZE.md`](../fw-detector/INTERFACE_FREEZE.md) |
| Diagnostics | [`../fw-detector/diagnostics/FROZEN.md`](../fw-detector/diagnostics/FROZEN.md) |

### 本节点正式归档要点（2026-08-05）

```text
1. repairSelectionCompleteness = Formula A（Assembly Sole Owner）
2. Assembly Enumeration = Interval Non-Overlap Repair-Subset DFS（已归档算法）
3. Top16 非容量瓶颈（dialog_200 mean pool ≈1.7）
4. Candidate Diversity 暂无 Owner — 暂停开发
5. allocateDomainBucketSentenceBudget = KNOWN_NON_BLOCKING_INCONSISTENCY
6. Wikipedia KenLM V1 = PRODUCTION_REJECTED
7. Interactive Recognition Repair = DEFERRED_FUTURE_MODULE
8. 禁止新增 Shadow / Compatibility Path
```

### Recall Subsystem（日期节点冻结 · Supporting）

| 主题 | 文档 |
|------|------|
| Recall Subsystem Frozen Contract | [`../supporting/Recall_Subsystem_Frozen_Contract_2026_08_03.md`](../supporting/Recall_Subsystem_Frozen_Contract_2026_08_03.md) |
| Documentation Freeze Registration | [`../acceptance/Freeze/2026-08-03_Recall_Subsystem_Documentation_Freeze/`](../acceptance/Freeze/2026-08-03_Recall_Subsystem_Documentation_Freeze/) |

```text
Recall Subsystem Status: FROZEN_AT_2026_08_03
（仍有效；本节点未改 Tone/Exact Recall 行为）
```

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
