<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Development/FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Phase1_B1_B2_SSOT_Repair_Development_Report_2026_07_27.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Multi-Path Lexical Lattice V1 · Phase 1 B1/B2 SSOT Repair Development Report

| Field | Value |
|-------|-------|
| Date | 2026-07-27 |
| Scope | Phase 1 Blockers **B1 + B2** only |
| Out of scope | Phase 2 · Path · Vote · Assembly · KenLM · Production Cutover |
| Plan | Phase 1 B1/B2 SSOT Repair Development Plan |

---

## 1. Executive Summary

| Blocker | 修复 | 结果 |
|---------|------|------|
| **B1** | 删除 Recall Core attempt gate；全量遍历 recallable Window；删除 `maxSqlPerUtterance` | dialog_200 **partialRecallCases = 0**；五长句 `32:34`/`34:36` 形成 Edge |
| **B2** | Edge-Level evidence OR（去重前）；`recallCandidateKind` 薄透传；`hasFuzzy` 真实映射 | 同 identity 多来源单测 PASS |

Production LTR / orchestrator **未**接入 Lattice；未改 Ranking/SQL/TopK。

```text
READY FOR PHASE 1 RE-ACCEPTANCE AUDIT
```

---

## 2. Scope

**做了：** B1 Recall 完整性 SSOT；B2 LexicalEdge Evidence SSOT；相关单测与 dialog_200 offline harness。  
**没做：** Path / Vote / Assembly / KenLM / cutover / Batch SQL / 提高预算当修复。

---

## 3. Files Changed

| 文件 | 变更 |
|------|------|
| `recall-topk-for-windows.ts` | 删 attempt gate；`ngramQueryCount`→`logicalWindowRecallCount`；`recallCandidateKind` 透传 |
| `phase1-window-edge-harness.ts` | 删 budget-skip 语义；完整性断言 FAIL；诊断字段对齐 |
| `build-lexical-edges.ts` | 单遍 OR evidence → first-wins keep |
| `v4-types.ts` | `logicalWindowRecallCount`；`WindowCandidate.recallCandidateKind?` |
| `v4-limits.ts` | **删除** `maxSqlPerUtterance` |
| `span-assembly-shared/limits.ts` | **删除** 死字段 `maxSqlPerUtterance` |
| `v4-diagnostics-types.ts` / `v4-diagnostics-trace.ts` | 删除 `sql_budget_exhausted` / `SkippedRecallWindow` |
| `span-assembly-v4-orchestrator.ts` | metrics 字段重命名（无业务逻辑变） |
| `types.ts` / `fw-detector-v4-path.ts` | diagnostics 字段对齐 |
| `lexicon/candidate-score.ts` | `isFuzzyRecallCandidateKind` helper |
| `b1-recall-full-traversal.test.ts` | **NEW** |
| `phase1-window-edge-harness.test.ts` | B2 evidence + hasFuzzy cases |
| `phase1-window-edge-dialog200-probe.mjs` | 完整性 / 五 case 探测 |

---

## 4. B1 Before / After Call Graph

**Before：**

```text
recallTopKForWindows
  for window:
    if ngramQueryCount >= 150: break + skip rest
    recall…
```

**After：**

```text
recallTopKForWindows
  for each input window:          // 无资源截断
    canonical key → cache → lexicon → bind
    logicalWindowRecallCount++
→ logicalWindowRecallCount === input.windows.length
```

---

## 5. B1 Removed Logic

```text
- if (ngramQueryCount >= V4_LIMITS.maxSqlPerUtterance) break
- pushSkippedRecallWindow(reason: sql_budget_exhausted)
- V4_LIMITS.maxSqlPerUtterance / CoarseAssemblyLimits.maxSqlPerUtterance
- Harness sqlBudgetExhausted / windowsSkippedDueToSqlBudget
- SkippedRecallWindowTrace 类型与写入路径
```

---

## 6. B1 Diagnostics Changes

| 旧 | 新 |
|----|-----|
| `ngramQueryCount` | **`logicalWindowRecallCount`**（全局一致，无双字段） |
| `maxSqlPerUtterance` | **删除** |
| budget skip 诊断 | **删除**；Harness 不相等则 **throw** |
| `physicalSqlStatementCount` | **KEEP**（独立） |
| cache hit/miss | **KEEP** |

---

## 7. B1 Production Impact Proof

| 证据 | 结论 |
|------|------|
| LTR 每 cursor ≤4 recallable windows | 旧闸门从未在单次调用内触发 |
| 仅 metrics 字段重命名 | 无 cursor / blockedFilter / orchestrator 业务改动 |
| LTR + freeze-contract 单测 | **PASS** |
| orchestrator 仍不导入 Phase1 Lattice | **PASS**（隔离测试） |

---

## 8. B2 Before / After Logic

**Before：** dedupe → evidence(kept)  
**After：** for each input: OR evidence; then first-wins keep subject

---

## 9. B2 Evidence Mapping

```text
hasExact        ← hitKind === exact_term
hasToneExact    ← toneLookupStage === tone_exact
hasToneRelaxed  ← toneLookupStage === plain_fallback
hasParent       ← hitKind === parent_fragment
hasFuzzy        ← isFuzzyRecallCandidateKind(recallCandidateKind)
```

`plain_only_no_pattern` **不**计入 `hasToneRelaxed`（保持既有正式映射）。

---

## 10. hasFuzzy Implementation

```text
Recall Hit.recallCandidateKind
  → bindLexiconHitsToWindow → WindowCandidate.recallCandidateKind?
  → buildLexicalEdges → hasFuzzy via isFuzzyRecallCandidateKind
```

删除硬编码 `hasFuzzy: false`。未新建 fuzzy 召回路径。

---

## 11. KEEP / MODIFY / DELETE Actual Result

**KEEP：** Window Generator、latticeHardBlockFilter、Cache、Canonical Key、TopK/score、termId first-wins、单 Edge、LTR cursor、Production isolation。

**MODIFY：** 见 §3。

**DELETE：** attempt gate、budget 诊断、`maxSqlPerUtterance`、`hasFuzzy: false`。

**MOVE：** 无。

---

## 12. Unit Test Results

| Suite | Result |
|-------|--------|
| `b1-recall-full-traversal.test.ts` | **PASS**（0/1/150/151/165） |
| `phase1-window-edge-harness.test.ts`（含 B2 evidence/fuzzy） | **PASS** |
| `phase1-window-edge-harness.live.test.ts` | **PASS**（3 executed） |
| `ltr-fine-span-generator` / freeze-contract / phase0 / utterance-cache | **PASS** |
| **合计** | **8 suites / 137 tests PASS** |

---

## 13. dialog_200 Results

产物：`docs/tone-v2/_audit_scratch/lattice_v1_phase1/dialog_200_phase1_summary.json`

| 指标 | 修复前（Acceptance） | 修复后 |
|------|---------------------|--------|
| completed / failed | 200 / 0 | **200 / 0** |
| partialRecallCases | 5 | **0** |
| incompleteRecall | — | **0** |
| edgeCount sum | 1600 | **1610**（+10，对应原 10 个有命中跳过窗） |
| uniqueRecallKeys | 15086 | 15161 |
| physicalSql sum | 34105 | 34255 |
| cacheHit / miss | 284 / 15086 | 284 / 15161 |
| latency P50/P95/P99 | 83.6 / 158 / 189 | 88.9 / 174 / 203 |
| heap delta | ~14–19 MB | ~20.4 MB |

`logicalWindowRecall.sum (15445) === recallable`（blocked 5025 + recallable 15445 = generated 20470）。

---

## 14. Known Five Cases Results

对 `d019/d064/d109/d154/d199` 全部：

| Edge | Candidates |
|------|------------|
| `32:34` | 一期, 一齐（2） |
| `34:36` | 评估（1） |

---

## 15. Live SQLite Results

`phase1-window-edge-harness.live.test.ts`：**3 executed / 3 passed / 0 skipped**；词库 `lexicon-v3-five-table-v2` 加载 ok。

---

## 16. Production Regression Results

| 项 | 结果 |
|----|------|
| LTR fine-span tests | PASS |
| freeze-contract | PASS |
| Phase 0 coordinate | PASS |
| Orchestrator Lattice isolation | PASS（静态测试仍断言无接线） |

---

## 17. Performance Comparison

| | Before | After |
|--|--------|-------|
| P50 | ~84–88 ms | ~89 ms |
| P95 | ~158–163 ms | ~174 ms |
| P99 | ~188–187 ms | ~203 ms |
| physicalSql avg | ~170.5 | ~171.3 |

延迟/SQL 轻微上升符合全量 Recall 预期；**未**因此恢复截断。

---

## 18. Remaining Risks

| 风险 | 说明 |
|------|------|
| 更长句 physical SQL / 延迟 | 仅观测；另开性能审计（Cache/Index/Batch），不得删合法 Window |
| 实验脚本仍读旧字段名 `ngramQueryCount` | `tests/experiments/*.mjs` 可能需后续对齐（非生产主链） |
| B2 生产同 identity 多 stage 稀少 | builder 语义已修；构造单测覆盖 |

---

## 19. Architecture Compliance

```text
单一 recallTopKForWindows
全量 recallable Recall（禁止资源截断合法窗）
Candidate identity first-wins + 顺序不变
Edge Evidence = 边界全部输入来源 OR
Path 未实现；不重复推导
无双链路 / 无 feature flag / 无 Budget Manager
Production 未 cutover
```

### Permanent Freeze（本轮确认写入）

```text
1) Recall Core 永远不得因资源策略提前终止/跳过合法 recallable Window。
2) Candidate identity 决定主体去重；Evidence 不属于 identity。
   同 identity 后续来源可不保留为独立 Candidate，但必须进入 Edge 聚合 Evidence。
```

---

## 20. Final Decision

```text
READY FOR PHASE 1 RE-ACCEPTANCE AUDIT
```

**不得**视为 `READY FOR PHASE 2`。
