# Partial Repair Candidate Admission Audit

**Verdict: `PARTIAL_REPAIR_ADMISSION_DEFECT_CONFIRMED`**

- Baseline: `FW_V4_FREEZE_2026_08_03`
- READ ONLY

## Pack files (9)

| File | Content |
|------|---------|
| `README.md` | 本说明 |
| `report.md` | Q1–Q12 + 结论 |
| `summary.json` | 机器可读结论 + 对比样本 |
| `minimal_adjustment_options.md` | Option A–D |
| `candidate_repair_provenance.csv` | 逐字符 provenance |
| `candidate_repair_classification.csv` | 候选完整性分类 |
| `assembly_and_fallback_trace.csv` | Assembly 路径 + Raw fallback 职责 |
| `scoring_cap_responsibility.csv` | KenLM 前评分 / Cap / 职责重叠 |
| `budget_cases_and_root_cause.csv` | 预算统计 + Partial/Complete 迹 + 根因 |

详见 `report.md`。
