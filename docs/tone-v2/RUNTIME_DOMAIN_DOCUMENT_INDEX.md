# Runtime Domain Document Index（SSOT）

| 字段 | 值 |
|------|-----|
| Status | **CURRENT / FROZEN** · Recovery Baseline **FW_V4_FREEZE_2026_08_03** |
| Date | 2026-08-03 |
| Recovery Baseline | **CURRENT** — [`../framework_snapshots/FW_V4_FREEZE_2026_08_03/FRAMEWORK_FREEZE_SUMMARY.md`](../framework_snapshots/FW_V4_FREEZE_2026_08_03/FRAMEWORK_FREEZE_SUMMARY.md) · [`../framework_snapshots/FRAMEWORK_FREEZE_SUMMARY.md`](../framework_snapshots/FRAMEWORK_FREEZE_SUMMARY.md) |
| Fine Span / Path | **FROZEN FOR IMPLEMENTATION** — [`FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md`](./FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md) |
| Presence Vote formula | **ACCEPTED AND FROZEN** — cite [`Runtime_Domain_Presence_Vote_Final_Acceptance_Report.md`](./Runtime_Domain_Presence_Vote_Final_Acceptance_Report.md); authority [`Runtime_SSOT_Contract_Freeze.md`](./Runtime_SSOT_Contract_Freeze.md) **V1.2** (Path-scoped caller) |
| Tone Evidence / Mapping | **FROZEN** — [`FW_Repair_V4_ToneEvidence_Mapping_Final_Freeze_Report_2026_07_29.md`](./FW_Repair_V4_ToneEvidence_Mapping_Final_Freeze_Report_2026_07_29.md) · Runtime SSOT §0A |
| Fine Span production | **MULTI_PATH_LEXICAL_LATTICE** — [`FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md`](./FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md) |
| Atomicity / Lexicon rebuild | **FROZEN** — [`FW_Repair_V4_Atomicity_Closure_SSOT_Freeze_2026_08_02.md`](./FW_Repair_V4_Atomicity_Closure_SSOT_Freeze_2026_08_02.md) |
| KenLM readiness | **READY** — [`FW_Repair_V4_KenLM_Validation_Readiness_Audit_2026_08_02.md`](./FW_Repair_V4_KenLM_Validation_Readiness_Audit_2026_08_02.md)（非质量 PASS · CAPABILITY_VALIDATION_PENDING） |
| LTR vs Lattice necessity (historical) | **SUPERSEDED / HISTORICAL** — [`FW_Repair_V4_LTR_vs_MultiPath_Lattice_Necessity_Audit_2026_07_29.md`](./FW_Repair_V4_LTR_vs_MultiPath_Lattice_Necessity_Audit_2026_07_29.md)（NOT RUNTIME AUTHORITY） |
| Mainchain Audit (Recall→Vote→Assembly) | [`FW_Repair_V4_Recall_DomainVote_SentenceAssembly_Mainchain_Audit_2026_07_29.md`](./FW_Repair_V4_Recall_DomainVote_SentenceAssembly_Mainchain_Audit_2026_07_29.md) |
| Supersession | [`FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Document_Supersession_Index_2026_07_26.md`](./FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Document_Supersession_Index_2026_07_26.md) |
| 用途 | Runtime Domain + Lattice Fine Span + Tone Evidence 文档唯一入口；禁止平行“最终版/最新版”冻结文档 |

---

## 冲突优先级

```text
Lattice Architecture V1.0.0 (Fine Span / Path / Window / Edge)
> Runtime_SSOT_Contract_Freeze (Vote formula / Multi-Bucket / ≤16 / KenLM boundary)
> Supporting Contracts
> Accepted audits
> Execution / Acceptance Records
> Historical / Superseded (incl. SoftBoundary LTR-only)
```

---

## Sole Authorities

| 文档 | 路径 | 职责 |
|------|------|------|
| Multi-Path Lexical Lattice Architecture V1.0.0 | [`FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md`](./FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md) | **Fine Span / Window / Edge / Path / Path callers / Trace·Regression·Acceptance（Lattice）** |
| Runtime SSOT Contract V1.2 | [`Runtime_SSOT_Contract_Freeze.md`](./Runtime_SSOT_Contract_Freeze.md) | **Vote 公式 / Multi-Bucket / Cross-Bucket Dedup / ≤16 / KenLM integration boundary** · **§0A Tone Evidence / Mapping FROZEN** |
| Tone Evidence / Mapping Final Freeze | [`FW_Repair_V4_ToneEvidence_Mapping_Final_Freeze_Report_2026_07_29.md`](./FW_Repair_V4_ToneEvidence_Mapping_Final_Freeze_Report_2026_07_29.md) | **Tone Evidence SSOT · Production · Mapping overlap · Evidence Unavailable** |
| Implementation Contract V1.0.0 | [`FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Implementation_Contract_V1.0.0_2026_07_26.md`](./FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Implementation_Contract_V1.0.0_2026_07_26.md) | Lattice 实施 DTO / fallback / prune detail |

禁止并列第二个 Fine Span SSOT、第二个 Vote 公式合同、或第二个 Tone Evidence SSOT。

---

## Supporting Contracts

| 文档 | 路径 | 职责 |
|------|------|------|
| Lexicon Domain Contract Freeze V1 | [`Lexicon_Domain_Contract_Freeze_V1.md`](./Lexicon_Domain_Contract_Freeze_V1.md) | Lexicon domain fact SSOT |
| Domain Source Unification (DSU) | [`../fw-detector/DOMAIN_SOURCE_UNIFICATION.md`](../fw-detector/DOMAIN_SOURCE_UNIFICATION.md) | Domain 来源、Registry、Recall scope |
| Domain Recall | [`../fw-detector/recall/DOMAIN_RECALL.md`](../fw-detector/recall/DOMAIN_RECALL.md) | Recall 行为与 domains[] 传播 |
| Assembly FROZEN V1.2 | [`../fw-detector/assembly/FROZEN_V1_2.md`](../fw-detector/assembly/FROZEN_V1_2.md) | Assembly 内部细节（Path-scoped） |
| KenLM Runtime | [`../fw-detector/kenlm/KENLM_RUNTIME.md`](../fw-detector/kenlm/KENLM_RUNTIME.md) | KenLM 运行接口（cross-Path ≤16） |
| Context Prior | [`../fw-detector/CONTEXT_PRIOR.md`](../fw-detector/CONTEXT_PRIOR.md) | diagnostics-only 边界 |
| Architecture Overview | [`../fw-detector/ARCHITECTURE.md`](../fw-detector/ARCHITECTURE.md) | 短总览（非冻结合同） |
| Framework Freeze Registry | [`../fw-detector/freeze/FROZEN.md`](../fw-detector/freeze/FROZEN.md) | 框架冻结入口表 |
| Document Supersession Index | [`FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Document_Supersession_Index_2026_07_26.md`](./FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Document_Supersession_Index_2026_07_26.md) | 新旧文档替代关系 |

Supporting contracts **不得**重新定义 Presence Vote 公式、Path 枚举或候选上限；Fine Span 冲突以 Lattice Architecture 为准，Vote 公式冲突以 Runtime SSOT 为准。

---

## Execution Records

| 文档 | Status |
|------|--------|
| [`Runtime_Domain_Minimal_Repair_Real_KenLM_Acceptance_and_Final_Freeze_Report.md`](./Runtime_Domain_Minimal_Repair_Real_KenLM_Acceptance_and_Final_Freeze_Report.md) | Acceptance / Execution Record |
| [`Runtime_Domain_Documentation_Repair_and_Final_Freeze_Report.md`](./Runtime_Domain_Documentation_Repair_and_Final_Freeze_Report.md) | Documentation Repair Record |
| [`Fine_Span_Domain_Presence_Vote_and_Multi_Bucket_Assembly_Development_Report.md`](./Fine_Span_Domain_Presence_Vote_and_Multi_Bucket_Assembly_Development_Report.md) | Execution Record |
| [`Runtime_SSOT_Recovery_Report.md`](./Runtime_SSOT_Recovery_Report.md) | Execution Record |
| [`Runtime_SSOT_Freeze_Readiness_Development_Report.md`](./Runtime_SSOT_Freeze_Readiness_Development_Report.md) | Execution Record |
| [`Freeze_Readiness_Cleanup_Plan.md`](./Freeze_Readiness_Cleanup_Plan.md) | Execution Record |
| [`Rollback_Plan.md`](./Rollback_Plan.md) | Execution Record |

---

## Accepted Audits

| 文档 | Status |
|------|--------|
| [`Runtime_Domain_Presence_Vote_Freeze_and_Compatibility_Chain_Audit_Report.md`](./Runtime_Domain_Presence_Vote_Freeze_and_Compatibility_Chain_Audit_Report.md) | **FREEZE AND CLEANUP PASS** |
| [`Runtime_Domain_Presence_Vote_Final_Acceptance_Report.md`](./Runtime_Domain_Presence_Vote_Final_Acceptance_Report.md) | **ACCEPTED** — Presence Vote functional acceptance |
| [`Runtime_Domain_Presence_Vote_End_to_End_Completeness_Audit.md`](./Runtime_Domain_Presence_Vote_End_to_End_Completeness_Audit.md) | ACCEPTED AUDIT BASELINE |
| [`Fine_Span_Presence_Runtime_Compliance_and_SSOT_Document_Repair_Audit.md`](./Fine_Span_Presence_Runtime_Compliance_and_SSOT_Document_Repair_Audit.md) | ACCEPTED AUDIT BASELINE |
| [`Runtime_Domain_Documentation_Compliance_Audit.md`](./Runtime_Domain_Documentation_Compliance_Audit.md) | ACCEPTED DOCUMENTATION AUDIT |
| [`Runtime_SSOT_Recovery_Baseline_Audit.md`](./Runtime_SSOT_Recovery_Baseline_Audit.md) | ACCEPTED BASELINE AUDIT |

---

## Historical / Superseded

| 文档 | Status |
|------|--------|
| [`FW_Repair_V4_ToneEvidence_Contract_Architecture_Audit_2026_07_29.md`](./FW_Repair_V4_ToneEvidence_Contract_Architecture_Audit_2026_07_29.md) | **SUPERSEDED (Tone conclusions)** — 首 batch 导出假象 / 72 Miss 为当前瓶颈等已过时；以 Final Freeze + SSOT Attribution 为准 |
| [`FW_Repair_V4_ToneParticipation_RootCause_SpanSlidingWindow_Audit_2026_07_29.md`](./FW_Repair_V4_ToneParticipation_RootCause_SpanSlidingWindow_Audit_2026_07_29.md) | **SUPERSEDED (Tone conclusions)** — 「72 Miss / Span 瓶颈 / 多 batch Slice 丢失」等不得再作 CURRENT |
| SoftBoundary / LTR Fine Span plans & reports (2026-07-22–25) | **HISTORICAL / SUPERSEDED BY MULTI-PATH LEXICAL LATTICE / NOT RUNTIME AUTHORITY** — see Document Supersession Index |
| [`FW_Repair_V4_LTR_vs_MultiPath_Lattice_Necessity_Audit_2026_07_29.md`](./FW_Repair_V4_LTR_vs_MultiPath_Lattice_Necessity_Audit_2026_07_29.md) | **HISTORICAL / SUPERSEDED** — production Fine Span is Lattice |
| [`FW_Repair_V4_LTR_Full_Replacement_Readiness_Audit_2026_07_29.md`](./FW_Repair_V4_LTR_Full_Replacement_Readiness_Audit_2026_07_29.md) | **HISTORICAL / SUPERSEDED** — LTR removed in Step 6 |
| Lattice Interface/Data Contract Draft | **SUPERSEDED** by Implementation Contract V1.0.0 + Architecture V1.0.0 |
| [`Legacy_Domain_Logic_Removal_and_Real_Dialogue_Multi_Bucket_Acceptance_Report.md`](./Legacy_Domain_Logic_Removal_and_Real_Dialogue_Multi_Bucket_Acceptance_Report.md) | **SUPERSEDED / HISTORICAL**（原 PASS 不含真实 KenLM quality） |
| [`Multi_Domain_Vote_Semantics_Audit.md`](./Multi_Domain_Vote_Semantics_Audit.md) | HISTORICAL — DEVELOPMENT GATE FAIL |
| [`Multi_Domain_Candidate_Contract_Development_Report.md`](./Multi_Domain_Candidate_Contract_Development_Report.md) | **REJECTED / SUPERSEDED** |
| [`Multi_Domain_Candidate_Contract_Audit.md`](./Multi_Domain_Candidate_Contract_Audit.md) | HISTORICAL AUDIT |
| [`Multi_Domain_Runtime_Deviation_Rollback_SSOT_Audit.md`](./Multi_Domain_Runtime_Deviation_Rollback_SSOT_Audit.md) | HISTORICAL AUDIT |
| [`DomainId_Full_Removal_PreDevelopment_Audit.md`](./DomainId_Full_Removal_PreDevelopment_Audit.md) | HISTORICAL PRE-DEV |
| [`WindowCandidate_Domain_Dependency_PreDevelopment_Audit.md`](./WindowCandidate_Domain_Dependency_PreDevelopment_Audit.md) | HISTORICAL PRE-DEV |

---

## 禁止事项

* 不得创建第二个 Runtime SSOT Freeze V2/Final/Latest/(2) 平行合同  
* 不得将 Execution Record 当作正式设计  
* 不得用 KenLM Integration PASS 冒充 Quality PASS  
* 文档冲突时以上表优先级为准  

---

## Step 7 Baseline Closure（2026-07-30）

| 项 | 值 |
|----|-----|
| Architecture | Multi-Path Lexical Lattice V1.0.0 |
| Runtime SSOT | Contract V1.2 |
| Tone | Evidence / Mapping Contract V1.0 |
| Production Fine Span entry | `runLatticeFineSpanGeneration` |
| Cross-Path owner | `mergeCrossPathSentenceCandidates` |
| Candidate cap | global ≤16（`maxSentenceCandidates`） |
| Acceptance | `npm run accept:runtime-ssot` · `npm run accept:domain-multibucket-kenlm` |
| LTR | 活动源码/模块/恢复入口 = 0；`ltrRuntimeEnabled` 已 DELETE |
| Framework Freeze index | [`../fw-detector/freeze/FROZEN.md`](../fw-detector/freeze/FROZEN.md) |
| Step 7 report | [`FW_Repair_V4_Step7_Final_Lattice_Freeze_and_Full_Acceptance_Report_2026_07_30.md`](./FW_Repair_V4_Step7_Final_Lattice_Freeze_and_Full_Acceptance_Report_2026_07_30.md) |