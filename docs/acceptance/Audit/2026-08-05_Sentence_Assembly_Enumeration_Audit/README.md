# Sentence Assembly Enumeration & Diversity Audit

**Verdict: `ASSEMBLY_CONTRACT_INCOMPLETE`**

- Baseline: `FW_V4_FREEZE_2026_08_03`
- Nature: **READ ONLY** — no code / contract / runtime change
- Scope: Sentence Assembly combination enumeration only（不含 Tone / Recall / KenLM score）

| File | Content |
|------|---------|
| `README.md` | 本说明 |
| `report.md` | Q1–Q12 + 结论 |
| `summary.json` | 机器可读结论 |
| `assembly_enumeration_contract.md` | 枚举合同现状 |
| `candidate_generation_flow.md` | 生成流程图 |
| `enumeration_algorithm.md` | 精确算法 |
| `owner_matrix.md` | Owner 边界 |
| `candidate_similarity_analysis.csv` | 候选两两相似度 |
| `candidate_cluster_statistics.csv` | 近重复聚类统计 |
| `candidate_slot_utilization.csv` | Top16 占用 |
| `candidate_duplication_matrix.csv` | 重复来源矩阵 |
| `runtime_dependency_matrix.csv` | 运行时依赖 |

详见 `report.md`。
