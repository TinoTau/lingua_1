# Runtime Domain Document Index（SSOT）

| 字段 | 值 |
|------|-----|
| Status | **CURRENT / FROZEN** |
| Date | 2026-07-20 |
| Presence Vote | **ACCEPTED AND FROZEN** — cite [`Runtime_Domain_Presence_Vote_Final_Acceptance_Report.md`](./Runtime_Domain_Presence_Vote_Final_Acceptance_Report.md); authority [`Runtime_SSOT_Contract_Freeze.md`](./Runtime_SSOT_Contract_Freeze.md) |
| 用途 | Runtime Domain 文档唯一入口；禁止平行“最终版/最新版”冻结文档 |

---

## 冲突优先级

```text
Current source code
> Sole Runtime Authority
> Supporting Contracts
> Accepted audits
> Execution / Acceptance Records
> Historical / Superseded
```

---

## Sole Runtime Authority

| 文档 | 路径 | 职责 |
|------|------|------|
| Runtime SSOT Contract V1.1 | [`Runtime_SSOT_Contract_Freeze.md`](./Runtime_SSOT_Contract_Freeze.md) | **唯一 Runtime 主链合同**（Vote / retainedDomains / Multi-Bucket / Cross-Bucket Dedup / ≤16 / KenLM integration boundary） |

禁止并列第二个 Runtime 主链合同。

---

## Supporting Contracts

| 文档 | 路径 | 职责 |
|------|------|------|
| Lexicon Domain Contract Freeze V1 | [`Lexicon_Domain_Contract_Freeze_V1.md`](./Lexicon_Domain_Contract_Freeze_V1.md) | Lexicon domain fact SSOT |
| Domain Source Unification (DSU) | [`../fw-detector/DOMAIN_SOURCE_UNIFICATION.md`](../fw-detector/DOMAIN_SOURCE_UNIFICATION.md) | Domain 来源、Registry、Recall scope |
| Domain Recall | [`../fw-detector/recall/DOMAIN_RECALL.md`](../fw-detector/recall/DOMAIN_RECALL.md) | Recall 行为与 domains[] 传播 |
| Assembly FROZEN V1.2 | [`../fw-detector/assembly/FROZEN_V1_2.md`](../fw-detector/assembly/FROZEN_V1_2.md) | Assembly 内部细节 |
| KenLM Runtime | [`../fw-detector/kenlm/KENLM_RUNTIME.md`](../fw-detector/kenlm/KENLM_RUNTIME.md) | KenLM 运行接口 |
| Context Prior | [`../fw-detector/CONTEXT_PRIOR.md`](../fw-detector/CONTEXT_PRIOR.md) | diagnostics-only 边界 |
| Architecture Overview | [`../fw-detector/ARCHITECTURE.md`](../fw-detector/ARCHITECTURE.md) | 短总览（非冻结合同） |

Supporting contracts **不得**重新定义 Presence Vote、retainedDomains、候选上限或 KenLM pick 公式；冲突时以 Sole Runtime Authority 为准。

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
