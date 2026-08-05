# Illegal Surface & SameDomain Bucket Audit

**Verdict: `ILLEGAL_SURFACE_AND_BUCKET_ROOT_CAUSE_CONFIRMED`**

- Baseline: `FW_V4_FREEZE_2026_08_03`
- READ ONLY — no code / lexicon / KenLM changes

## Pack files (10)

| File | Content |
|------|---------|
| `README.md` | 本说明 |
| `report.md` | Q1–Q10 + Legacy fragment + 最终结论 |
| `summary.json` | 机器可读结论 / SQLite 摘要 / focus 同一性 |
| `case_inventory.csv` | dialog_200 相关 Case 清单 |
| `surface_lexicon_presence.csv` | 生城/声城/生成等正式词库状态 |
| `character_provenance.csv` | 逐字符 provenance |
| `generation_trace.csv` | 生成 funnel + window + recall（`section` 列） |
| `domain_bucket_trace.csv` | domain membership / vote / sameDomain bucket |
| `path_assembly_trace.csv` | edge / path / assembly / crosspath / 诊断字段 |
| `root_cause_and_quality.csv` | 根因 + 单/多点修复分布 |

详见 `report.md`。
