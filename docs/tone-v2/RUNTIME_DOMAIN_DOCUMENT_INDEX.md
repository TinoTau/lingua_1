# Runtime Domain Document Index（SSOT）

| 字段 | 值 |
|------|-----|
| Status | **CURRENT / FROZEN** · Recovery Baseline **FW_V4_FREEZE_2026_08_03** |
| Date | 2026-08-03 |
| Documentation Hierarchy | [`../current/INDEX.md`](../current/INDEX.md) · [`../supporting/INDEX.md`](../supporting/INDEX.md) · [`../acceptance/README.md`](../acceptance/README.md) · [`../archive/README.md`](../archive/README.md) |
| Recovery Baseline | [`../framework_snapshots/FW_V4_FREEZE_2026_08_03/FRAMEWORK_FREEZE_SUMMARY.md`](../framework_snapshots/FW_V4_FREEZE_2026_08_03/FRAMEWORK_FREEZE_SUMMARY.md) · [`../framework_snapshots/FRAMEWORK_FREEZE_SUMMARY.md`](../framework_snapshots/FRAMEWORK_FREEZE_SUMMARY.md) |
| Consolidation | [`../acceptance/Freeze/FW_V4_Documentation_Consolidation_Report_2026_08_03.md`](../acceptance/Freeze/FW_V4_Documentation_Consolidation_Report_2026_08_03.md) |
| 用途 | ASR Post-Processing 文档唯一入口；禁止平行「最终版 / 最新版 / CURRENT_V2」 |

---

## Future Reading Order（强制）

```text
1. Framework Snapshot — FW_V4_FREEZE_2026_08_03
2. CURRENT — docs/current/INDEX.md → Sole Authorities（本 Index）
3. Supporting — docs/supporting/INDEX.md
4. Acceptance — docs/acceptance/（Evidence only）
5. Archive — docs/archive/（需要时追溯）
```

禁止从历史 Development / Audit / Test 报告重新设计已冻结 Framework。

---

## 文档层级

| 层级 | 路径 | 角色 |
|------|------|------|
| Framework Snapshot | [`../framework_snapshots/FW_V4_FREEZE_2026_08_03/`](../framework_snapshots/FW_V4_FREEZE_2026_08_03/) | 可恢复检查点 |
| CURRENT | [`../current/INDEX.md`](../current/INDEX.md) + 下方 Sole Authorities | 唯一设计权威 |
| Supporting | [`../supporting/INDEX.md`](../supporting/INDEX.md) | 解释 CURRENT |
| Acceptance | [`../acceptance/`](../acceptance/) | Evidence |
| Archive | [`../archive/`](../archive/) | HISTORICAL / SUPERSEDED / RETIRED / EXPERIMENT |

---

## 冲突优先级

```text
Lattice Architecture V1.0.0 (Fine Span / Path / Window / Edge)
> Runtime_SSOT_Contract_Freeze (Vote / Multi-Bucket / ≤16 / KenLM boundary)
> Supporting Contracts
> Acceptance Records
> Historical / Superseded / Retired Archive
```

---

## Sole Authorities（CURRENT）

| 文档 | 路径 | 职责 |
|------|------|------|
| Multi-Path Lexical Lattice Architecture V1.0.0 | [`FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md`](./FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md) | Fine Span / Window / Edge / Path |
| Runtime SSOT Contract V1.2 | [`Runtime_SSOT_Contract_Freeze.md`](./Runtime_SSOT_Contract_Freeze.md) | Vote / Multi-Bucket / ≤16 / KenLM boundary / §0A Tone |
| Tone Evidence / Mapping Final Freeze | [`FW_Repair_V4_ToneEvidence_Mapping_Final_Freeze_Report_2026_07_29.md`](./FW_Repair_V4_ToneEvidence_Mapping_Final_Freeze_Report_2026_07_29.md) | Tone Evidence SSOT |
| Atomicity Closure SSOT | [`FW_Repair_V4_Atomicity_Closure_SSOT_Freeze_2026_08_02.md`](./FW_Repair_V4_Atomicity_Closure_SSOT_Freeze_2026_08_02.md) | Atomicity / Lexicon rebuild |
| Implementation Contract V1.0.0 | [`FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Implementation_Contract_V1.0.0_2026_07_26.md`](./FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Implementation_Contract_V1.0.0_2026_07_26.md) | DTO / fallback / prune |
| Lexicon Domain Contract Freeze V1 | [`Lexicon_Domain_Contract_Freeze_V1.md`](./Lexicon_Domain_Contract_Freeze_V1.md) | Lexicon domain fact |
| Runtime Evolution Rule | [`Lingua_Runtime_Evolution_Rule.md`](./Lingua_Runtime_Evolution_Rule.md) | 演进规则 |
| Tone V2 Contract Freeze | [`TONE_V2_CONTRACT_FREEZE.md`](./TONE_V2_CONTRACT_FREEZE.md) | Tone Decision 边界 |
| Framework Freeze Registry | [`../fw-detector/freeze/FROZEN.md`](../fw-detector/freeze/FROZEN.md) | 子合同入口表 |
| Framework Freeze Summary | [`FRAMEWORK_FREEZE_SUMMARY.md`](./FRAMEWORK_FREEZE_SUMMARY.md) | Snapshot 指针 |

禁止并列第二个 Fine Span SSOT、第二个 Vote 公式合同、或第二个 Tone Evidence SSOT。

### fw-detector CURRENT 边界合同

| 主题 | 路径 |
|------|------|
| Architecture | [`../fw-detector/ARCHITECTURE.md`](../fw-detector/ARCHITECTURE.md) |
| Domain Source Unification | [`../fw-detector/DOMAIN_SOURCE_UNIFICATION.md`](../fw-detector/DOMAIN_SOURCE_UNIFICATION.md) |
| Domain Recall | [`../fw-detector/recall/DOMAIN_RECALL.md`](../fw-detector/recall/DOMAIN_RECALL.md) |
| Assembly V1.2 | [`../fw-detector/assembly/FROZEN_V1_2.md`](../fw-detector/assembly/FROZEN_V1_2.md) |
| KenLM Runtime | [`../fw-detector/kenlm/KENLM_RUNTIME.md`](../fw-detector/kenlm/KENLM_RUNTIME.md) |
| Interface Freeze | [`../fw-detector/INTERFACE_FREEZE.md`](../fw-detector/INTERFACE_FREEZE.md) |
| Diagnostics | [`../fw-detector/diagnostics/FROZEN.md`](../fw-detector/diagnostics/FROZEN.md) |

### Recall Subsystem（Supporting · 日期节点）

| 文档 | 路径 |
|------|------|
| Recall Subsystem Frozen Contract | [`../supporting/Recall_Subsystem_Frozen_Contract_2026_08_03.md`](../supporting/Recall_Subsystem_Frozen_Contract_2026_08_03.md) |
| Doc Freeze Registration | [`../acceptance/Freeze/2026-08-03_Recall_Subsystem_Documentation_Freeze/`](../acceptance/Freeze/2026-08-03_Recall_Subsystem_Documentation_Freeze/) |

```text
Recall Subsystem Status: FROZEN_AT_2026_08_03
```

禁止并列第二个 Fine Span SSOT、第二个 Vote 公式合同、或第二个 Tone Evidence SSOT。

---

## Supporting Contracts

见 [`../supporting/INDEX.md`](../supporting/INDEX.md)。Supporting **不得**重新定义 Presence Vote、Path 枚举或候选上限。

| 文档 | 路径 |
|------|------|
| Context Prior | [`../fw-detector/CONTEXT_PRIOR.md`](../fw-detector/CONTEXT_PRIOR.md) |
| Recovery Guide | [`../framework_snapshots/FW_V4_FREEZE_2026_08_03/13_Recovery_Guide.md`](../framework_snapshots/FW_V4_FREEZE_2026_08_03/13_Recovery_Guide.md) |
| Recall Subsystem Frozen Contract | [`../supporting/Recall_Subsystem_Frozen_Contract_2026_08_03.md`](../supporting/Recall_Subsystem_Frozen_Contract_2026_08_03.md) |

---

## Acceptance Records（Evidence）

统一目录：[`../acceptance/`](../acceptance/)

正式产物规范（自 2026-08-03）：

```text
docs/acceptance/Freeze/YYYY-MM-DD_<TaskName>/
  README.md · report.md · summary.json · *.csv · *.md
```

| Bucket | 路径 |
|--------|------|
| Development | [`../acceptance/Development/`](../acceptance/Development/) |
| Test | [`../acceptance/Test/`](../acceptance/Test/) |
| Freeze | [`../acceptance/Freeze/`](../acceptance/Freeze/) |
| Regression | [`../acceptance/Regression/`](../acceptance/Regression/) |

常用证据（非 CURRENT）：

| 主题 | 路径 | 证明 |
|------|------|------|
| Window Boundary Audit | [`../acceptance/Freeze/2026-08-03_Window_Boundary_Audit/`](../acceptance/Freeze/2026-08-03_Window_Boundary_Audit/) | Syllable/Window 全量生成且未错误剪枝 |
| Recall Query Builder Audit | [`../acceptance/Freeze/2026-08-03_Recall_Query_Builder_Audit/`](../acceptance/Freeze/2026-08-03_Recall_Query_Builder_Audit/) | Tone 进入 Mode C 复合 SQL；无 Plain Fallback |
| Recall Candidate Enumeration Audit | [`../acceptance/Freeze/2026-08-03_Recall_Candidate_Enumeration_Audit/`](../acceptance/Freeze/2026-08-03_Recall_Candidate_Enumeration_Audit/) | SQLite→Candidate 无隐藏删除 |
| Recall Candidate Recovery Development | [`../acceptance/Freeze/2026-08-03_Recall_Candidate_Recovery_Development/`](../acceptance/Freeze/2026-08-03_Recall_Candidate_Recovery_Development/) | 正式词库修复与真实候选链样例 |
| Recall Subsystem Doc Freeze | [`../acceptance/Freeze/2026-08-03_Recall_Subsystem_Documentation_Freeze/`](../acceptance/Freeze/2026-08-03_Recall_Subsystem_Documentation_Freeze/) | 本轮文档冻结登记 |
| Presence Vote acceptance | [`../acceptance/Regression/Runtime_Domain_Presence_Vote_Final_Acceptance_Report.md`](../acceptance/Regression/Runtime_Domain_Presence_Vote_Final_Acceptance_Report.md) | Vote 公式 |
| Step 7 Lattice freeze acceptance | [`../acceptance/Regression/FW_Repair_V4_Step7_Final_Lattice_Freeze_and_Full_Acceptance_Report_2026_07_30.md`](../acceptance/Regression/FW_Repair_V4_Step7_Final_Lattice_Freeze_and_Full_Acceptance_Report_2026_07_30.md) | Lattice baseline |
| Code + Doc Freeze report | [`../acceptance/Freeze/FW_V4_FREEZE_2026_08_03_Code_and_Documentation_Freeze_Report.md`](../acceptance/Freeze/FW_V4_FREEZE_2026_08_03_Code_and_Documentation_Freeze_Report.md) | Framework freeze tip |
| Doc consolidation report | [`../acceptance/Freeze/FW_V4_Documentation_Consolidation_Report_2026_08_03.md`](../acceptance/Freeze/FW_V4_Documentation_Consolidation_Report_2026_08_03.md) | Doc hierarchy |

旧 `docs/tone-v2/*.md` 同名文件若为 `# MOVED` stub，请跟随新路径。
---

## Historical Archive

统一目录：[`../archive/`](../archive/)

| Status | 路径 |
|--------|------|
| RETIRED | [`../archive/RETIRED/`](../archive/RETIRED/) |
| SUPERSEDED | [`../archive/SUPERSEDED/`](../archive/SUPERSEDED/) |
| EXPERIMENT | [`../archive/EXPERIMENT/`](../archive/EXPERIMENT/) |
| HISTORICAL | [`../archive/HISTORICAL/`](../archive/HISTORICAL/) |

示例（已归档，非 CURRENT）：

| 主题 | 路径 |
|------|------|
| KenLM readiness audit | [`../archive/HISTORICAL/FW_Repair_V4_KenLM_Validation_Readiness_Audit_2026_08_02.md`](../archive/HISTORICAL/FW_Repair_V4_KenLM_Validation_Readiness_Audit_2026_08_02.md) |
| LTR vs Lattice necessity | [`../archive/RETIRED/FW_Repair_V4_LTR_vs_MultiPath_Lattice_Necessity_Audit_2026_07_29.md`](../archive/RETIRED/FW_Repair_V4_LTR_vs_MultiPath_Lattice_Necessity_Audit_2026_07_29.md) |
| Document Supersession Index | [`../archive/HISTORICAL/FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Document_Supersession_Index_2026_07_26.md`](../archive/HISTORICAL/FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Document_Supersession_Index_2026_07_26.md) |
| SoftBoundary / LTR Fine Span | [`../archive/RETIRED/`](../archive/RETIRED/) |

---

## 禁止事项

* 不得创建第二个 Runtime SSOT / Fine Span / Tone Evidence 平行合同（含 FINAL / LATEST / NEW / COPY）
* 不得将 Acceptance / Archive 当作正式设计
* 不得用 KenLM Integration PASS 冒充 Quality PASS
* 文档冲突时以上表优先级为准

---

## Step 7 / Freeze Baseline（指针）

| 项 | 值 |
|----|-----|
| Architecture | Multi-Path Lexical Lattice V1.0.0 |
| Runtime SSOT | Contract V1.2 |
| Production Fine Span | `runLatticeFineSpanGeneration` |
| Cross-Path owner | `mergeCrossPathSentenceCandidates` |
| Candidate cap | global ≤16 |
| LTR / parent_fragment / ngrams | production 路径已移除 |
| Framework Freeze | [`../fw-detector/freeze/FROZEN.md`](../fw-detector/freeze/FROZEN.md) |
| Recovery | [`../framework_snapshots/FW_V4_FREEZE_2026_08_03/13_Recovery_Guide.md`](../framework_snapshots/FW_V4_FREEZE_2026_08_03/13_Recovery_Guide.md) |
