# Documentation Governance Residual Backlog Closure

| Field | Value |
|-------|-------|
| Date | 2026-08-04 |
| Baseline | FW_V4_FREEZE_2026_08_03 |
| Prior pack | `2026-08-03_Docs_Repository_Governance_and_Consolidation` |
| Nature | Residual classification · duplicate decisions · orphan triage · link policy |
| Code / Lexicon / Models | Unchanged |
| Gate decision | **ENHANCE_GATE** |
| Verdict | See `summary.json` |

---

## 1. Executive Conclusion

上一轮治理体系保持不变。本轮关闭 Phase-1 残留 backlog：21 UNCLASSIFIED、40 Duplicate Groups、1012 Orphans 分层、387 Broken Links 策略、18 vs 19 Authority 计数对账。

---

## 2. Before / After

见 `summary.json` → `metrics` 与 `_metrics.json`。

目标达成：

```text
UNCLASSIFIED = 0
unresolvedDuplicateGroups = 0
criticalBrokenLinks = 0
unindexedCurrent = 0
manualReviewRequired = 0
```

允许保留：

```text
historicalBrokenLinks > 0
orphansPackMember > 0
```

---

## 3. UNCLASSIFIED（21→0）

全部写入 `unclassified_resolution.csv`。要点：

- CODING / user / PROJECT_* → REFERENCE_DATA
- logging → OPERATING_GUIDE
- project/phase3 → HISTORICAL
- CONTEXT_PRIOR → SUPPORTING_CONTRACT（非 KenLM 权威）
- 根目录 analyze/job/observability → SCRATCH（移入 `docs/_scratch/root_residual/`）
- **未**新增并行 CURRENT

---

## 4. Authority Count Reconciliation

`authority_count_reconciliation.csv` → **COUNT_DIFFERENCE_EXPLAINED**

- `CURRENT_SSOT=18`：Phase-1 path classification 计数
- `currentAuthorities=19`：当时 auditor registry 长度（Governance 尚未入库）
- 非 Sole Authority 冲突

---

## 5. Duplicate Groups（40→全部 RESOLVED）

`duplicate_resolution.csv`。已删除的 6 组保持；其余按 Evidence Role 决策 KEEP / POINTER / SNAPSHOT_KEEP / SCRATCH，无 `REQUIRES_REVIEW`。

---

## 6. Orphan Triage

`orphan_triage.csv`：PACK_MEMBER / GENERATED_OR_SCRATCH / UNIQUE_HISTORICAL_EVIDENCE 等。  
`UNINDEXED_CURRENT=0`，`POSSIBLE_CURRENT_OR_SUPPORTING` unresolved=0。

---

## 7. Broken Link Policy

`broken_link_policy_results.csv`：

- Living CRITICAL = 0
- 过期 troubleshooting 事故报告降级 HISTORICAL → HISTORICAL_STATE_LINK
- Acceptance local 无未关闭唯一证据缺失硬门

---

## 8. docs:check

先前 `ok=true` 且无 warning 是因为 Gate **有意**只检查 living CRITICAL / Acceptance pack 合同 / 禁止后缀等，不把 1012 orphans 与历史断链变成噪声。

本轮判定：**ENHANCE_GATE** — 增加 residual CSV 硬门（UNCLASSIFIED、UNINDEXED_CURRENT、open CRITICAL）与有限 warning；PACK_MEMBER / historical / scratch 仅 informational。

---

## 9. Governance Updates

`DOCUMENTATION_GOVERNANCE.md` 新增 §17–§20。ADR-0001 仅加 Implementation Notes，不改写 Decision。

---

## 10. Final Verdict

见文末 `summary.json.finalVerdict`。

```text
DOCUMENTATION_BACKLOG_CLASSIFIED_WITH_HISTORICAL_DEBT

CURRENT、Supporting、Snapshot 和 Acceptance 唯一证据均已闭环；
剩余断链仅属于已分类的 Historical State Links
（及已关闭、不构成唯一证据主张的旧 Acceptance 相对路径债）。

这些历史债务不阻止后续开发。
```
