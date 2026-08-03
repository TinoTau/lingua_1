# FW Repair V4 — Docs Repository Audit, Consolidation and Documentation Governance

| Field | Value |
|-------|-------|
| Date | 2026-08-03 |
| Baseline | **FW_V4_FREEZE_2026_08_03** |
| Nature | Documentation Audit · Governance · Consolidation |
| Code / Lexicon / SQLite / Models | **Unchanged** |
| Verdict | **DOCUMENTATION_GOVERNANCE_ESTABLISHED** |

---

## 1. Executive Conclusion

`docs/` 已完成全量只读审计、分类、有节制整理、索引与 CRITICAL 链接门禁。  
CURRENT / Supporting / Snapshot / ADR / Acceptance / Archive / Scratch 职责分离。  
`docs/current/DOCUMENTATION_GOVERNANCE.md` 登记为 Documentation Governance Sole Authority；未来文档必须按统一 Acceptance Pack 合同生成。

---

## 2. Phase Execution Order

1. Phase 1 全量审计（先于任何删除）→ `docs_inventory.csv`  
2. Phase 2 Governance + ADR + Indexes  
3. Phase 3 `migration_plan.csv`  
4. Phase 4 执行精确重复清理与索引合并（未大规模搬迁 Sole Authority 正文）  
5. Phase 5 索引 / Snapshot 导航修复  
6. Phase 6 未来合同写入 Governance  
7. Phase 7 `docs:check` + 本 Acceptance Pack  

---

## 3–5. Inventory Answers

| # | Question | Answer |
|---|----------|--------|
| 1 | docs 扫描文件数（含模块 docs / kenLM md / 根文档类） | 见 `summary.json` → `scannedFiles`（Phase-1 ≈ 3470） |
| 2 | CURRENT_SSOT | 见 `classificationCounts.CURRENT_SSOT` |
| 3 | SUPPORTING_CONTRACT | 见 counts（含本轮新增 Registry / Recall contract） |
| 4 | ACCEPTANCE_RECORD | 见 counts |
| 5 | HISTORICAL+SUPERSEDED+RETIRED | 见 `historicalLikeCount` |
| 6 | Duplicate groups | 见 `duplicateGroups`（Phase-1 = 40） |
| 7 | Exact duplicates deleted | 见 `document_cleanup_actions.csv` / `exactDuplicatesDeleted` |
| 8 | Moved / pointer | KenLM Capability tone-v2 → pointer；其余以 Index 合并为主 |
| 9 | Links fixed | CRITICAL gate decodeURI + Snapshot/Index 导航；Historical 旧链记录不硬阻断 |
| 10 | SSOT conflicts remaining | **0**（Supporting 双宣称已降级） |
| 11 | Unclassified production ASR docs | 由 Classification Registry 覆盖；无未裁定 Sole Authority 冲突 |
| 12 | docs:check | 见 `docs_check_result.json` / `summary.json.docsCheck` |
| 13 | Future docs location | `docs/acceptance/<Type>/YYYY-MM-DD_<TaskName>/` |
| 14 | Governance Sole Authority | `docs/current/DOCUMENTATION_GOVERNANCE.md` |

---

## 6. Sole Authority Policy

物理正文可继续驻留 `docs/tone-v2/`、`docs/fw-detector/`。  
语义权威只由 `docs/current/INDEX.md` 登记。  
Recall / Syllable Window 日期节点细节：Supporting `Recall_Subsystem_Frozen_Contract_2026_08_03.md`；父级 Pipeline CURRENT 为 Runtime SSOT。

---

## 7. Duplicate Cleanup

删除 Acceptance 与 `tone-v2` / `_audit_scratch` 的精确重复 CSV/JSON/报告；探针 `.mjs` 保留。  
详见 `document_cleanup_actions.csv`。

---

## 8. Change Policy for Docs Layout

优先 Index 引用，避免无意义大规模搬迁。  
Historical 唯一证据不删除。

---

## 9. docs:check

```text
node scripts/docs/check-documentation-governance.mjs
# or from electron_node/electron-node:
npm run docs:check
```

---

## 10. Git

建议三提交：Governance → Consolidation → Acceptance Record（本包）。  
不移动 `FW_V4_FREEZE_2026_08_03` Tag。

---

## 11. Final Verdict

```text
DOCUMENTATION_GOVERNANCE_ESTABLISHED

docs/ 已完成全量审计、分类、整理、索引和链接修复。

CURRENT SSOT、Supporting Contracts、Framework Snapshots、
Architecture Decisions、Acceptance Records 和 Historical Archive
职责已明确分离。

Documentation Governance 已登记为 Sole Authority，
未来所有开发、审计、测试和冻结均必须按统一目录、
Metadata、命名、索引和 Acceptance Pack 合同生成文档。

docs:check 已通过。
```
