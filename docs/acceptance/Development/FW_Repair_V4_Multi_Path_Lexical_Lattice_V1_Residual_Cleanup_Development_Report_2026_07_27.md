<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Development/FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Residual_Cleanup_Development_Report_2026_07_27.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Multi-Path Lexical Lattice V1 · Residual Cleanup Development Report

| Field | Value |
|-------|-------|
| Date | 2026-07-27 |
| Nature | **Residual Cleanup Development** |
| Not | Phase 1 功能 · Re-Acceptance · Phase 2 · 架构重构 · Production Cutover |
| Upstream | Residual Cleanup Pre-Development Audit · B1/B2 Code Verification **PASS** |

---

## 1. Executive Summary

清理 B1/B2 后遗留的失效实验字段、现行文档中的 attempt-gate 描述，以及仍可被误执行的旧探针职责。

| 层 | 结果 |
|----|------|
| Runtime `main/src` 业务逻辑 | **本轮零修改**（仅新增 residual 静态测试文件） |
| Active Experiment | 统一 `logicalWindowRecallCount`；缺字段 **fail-fast**；无双字段兼容 |
| Current Document | `DOMAIN_RECALL.md` / `diagnostics/FROZEN.md` 同步 B1/B2 |
| Historical artifacts | **未覆盖**；移入 `historical/pre_b1_b2_repair/` 并标注 |
| Obsolete probes | 归档 + `throw` 阻断执行 |

```text
RESIDUAL CLEANUP COMPLETE
READY FOR RESIDUAL VERIFICATION
```

---

## 2. Authority and Scope

**依据：** B1/B2 Code Verification PASS；Phase 1 功能已完成；Re-Acceptance 未执行。

**冻结规则遵守：**

1. Recall Core 不因资源策略跳过合法 Window  
2. `logicalWindowRecallCount` 为现行逻辑窗计数字段  
3. `ngramQueryCount` 废弃，活跃路径不得使用  
4–5. Candidate identity / Edge Evidence 规则未改代码（仅文档同步）  
6. 历史证据未覆盖  

**允许范围：** experiments · probes · 现行 SSOT 文档 · 归档 · 非运行时测试  

**禁止范围：** Recall/Edge 业务逻辑 · Orchestrator · Path/Vote/KenLM · Lexicon/SQLite  

---

## 3. Residual Search Results

| Symbol | ACTIVE_RUNTIME | ACTIVE_EXPERIMENT | ACTIVE_TEST | CURRENT_DOCUMENT | HISTORICAL_* / SCRATCH |
|--------|----------------|-------------------|-------------|------------------|-------------------------|
| `ngramQueryCount` | 无（业务） | **已清除读取**；helper 内仅作禁止检测 | B1 负向断言 KEEP | 仅「废弃」说明 | quality-perf JSON / 旧审计 KEEP |
| `maxSqlPerUtterance` | 无 | 无 | B1 负向 KEEP | **已删现行表行**；改为禁止描述 | 历史审计 KEEP |
| `sql_budget_exhausted` / `SkippedRecallWindow` / `windowsSkippedDueToSqlBudget` | 无 | 无 | 无 | 无现行 | 归档探针/matrix KEEP |
| `budgetSkipped*` | 无 | 无 | 无 | 无 | 归档产物 KEEP |
| `partialRecall` | harness probe 完整性语义 KEEP | — | — | — | 旧 matrix 语义不同 KEEP |
| `logicalWindowRecallCount` | 现行 SSOT KEEP | **统一使用** | residual + B1 | DOMAIN_RECALL / diagnostics | post-repair probe JSON KEEP |
| `hasFuzzy: false` | 无硬编码实现 | — | 测试期望值可出现 | — | — |

---

## 4. Files Changed

### 4.1 Experiment（本轮）

| 文件 | 修改前 | 修改后 | 属 Cleanup？ | 影响 Runtime？ |
|------|--------|--------|--------------|----------------|
| `tests/experiments/require-logical-window-recall-count.mjs` | （新） | fail-fast 读取；禁 `ngramQueryCount` 共存 | 是 | 否 |
| `analyze-span-assembly-v4-dialog200.mjs` | 读 `ngramQueryCount \|\| 0` → 假零；写历史 `quality-perf.json` | `requireLogicalWindowRecallCount`；输出 `*.active.json` | 是 | 否 |
| `analyze-schema-v2-dialog200.mjs` | `avgNgramQueries` 假零 | `avgLogicalWindowRecallCount` fail-fast；`*.active.json` | 是 | 否 |
| `summarize-schema-v2-dialog200.mjs` | `ngram_queries` 可 undefined | `logical_window_recall_count` 有 V4 则强制校验；`*.active.json` | 是 | 否 |
| `tests/experiments/README.md` | （新） | 字段 SSOT 说明 | 是 | 否 |

### 4.2 Documents（本轮）

| 文件 | 修改前 | 修改后 | 属 Cleanup？ | 影响 Runtime？ |
|------|--------|--------|--------------|----------------|
| `docs/fw-detector/recall/DOMAIN_RECALL.md` | 表列 `maxSqlPerUtterance=150` | §6.1 B1 全量遍历 + diagnostics；§6.2 B2 Evidence | 是 | 否 |
| `docs/fw-detector/diagnostics/FROZEN.md` | 无 traversal 字段说明 | 增加 `logicalWindowRecallCount` / `physicalSqlStatementCount`；标注废弃旧字段 | 是 | 否 |

### 4.3 Archive / probes（本轮）

| 处理 | 路径 |
|------|------|
| ARCHIVE + throw | `…/historical/pre_b1_b2_repair/{phase1-acceptance-budget-skip-probe,phase1-acceptance-completeness-matrix,offline-ltr-perf-probe,phase0-phase1-utterance-cache-probe}.mjs` |
| ARCHIVE（未改内容） | 同目录下 pre-repair `acceptance_completeness_matrix.json(l)` · `budget_skipped_readonly_recall_probe.json` |
| NEW manifest | `historical/pre_b1_b2_repair/README.md` · `_audit_scratch/README.md` · `lattice_v1_phase1/README.md` |
| KEEP active | `phase1-window-edge-dialog200-probe.mjs`（已用 `logicalWindowRecallCount`） |
| KEEP post-repair | `lattice_v1_phase1/dialog_200_phase1_summary.json` + `results.jsonl` |

### 4.4 Tests（本轮）

| 文件 | 说明 | 影响 Runtime？ |
|------|------|----------------|
| `main/src/fw-detector/span-assembly-v4/residual-cleanup.test.ts` | 活跃路径禁止符号 + schema fail-fast + 归档存在性 | 否（仅测试） |

### 4.5 main/src 业务

```text
本轮未修改 recallTopKForWindows / buildLexicalEdges / orchestrator / LTR / limits。
```

（工作区中其他 `main/src` 脏文件属既有 B1/B2 Phase1 开发，非本 Cleanup 回合写入。）

---

## 5. Experiment Script Cleanup

- 三脚本统一 `logicalWindowRecallCount`  
- **无** `??` / `\|\|` 双字段兼容  
- 缺失或非有限非负整数 → **throw**  
- 输入若仍含 `ngramQueryCount` → **throw**（禁止双字段）  
- 新输出文件名 `*.active.json`，避免覆盖历史 `*quality-perf.json`

---

## 6. Document SSOT Cleanup

**DOMAIN_RECALL.md：** 删除现行 `maxSqlPerUtterance=150`；写入 B1 全量遍历与诊断字段；写入 B2 Evidence OR / identity / `hasFuzzy`←`recallCandidateKind`。

**diagnostics/FROZEN.md：** 同步 traversal diagnostics；明确不得 gate Recall。

**未篡改：** Phase1 Acceptance FAIL、B1/B2 审计/开发报告、历史 tone-v2 审计正文数值。

Architecture FROZEN / Implementation Contract：本轮无 `maxSql` 现行命中，未改。

---

## 7. Historical Artifact Handling

| 产物 | 原用途 | 仍被活跃引用？ | 处理 | 理由 |
|------|--------|----------------|------|------|
| acceptance_completeness_matrix.* | B1 前 budgetSkipped=75 证据 | 否（脚本已归档） | ARCHIVE 目录，内容不变 | KEEP 证据 |
| budget_skipped_readonly_recall_probe.json | B1 blocker 只读补召回 | 否 | ARCHIVE | KEEP 证据 |
| tests/experiments/*quality-perf.json | 旧实验快照含 `ngramQueryCount` | 否（脚本改写 active） | KEEP 原地 | 禁止覆盖 |
| dialog_200_phase1_summary/results | 修复后完整性 | 是（对照） | KEEP 在 lattice_v1_phase1 | 当前证据 |

**DELETE：** 无（无临时重复空文件需删）。

---

## 8. Probe Deactivation or Archival

| Probe | package/CI 引用？ | 处理 |
|-------|-------------------|------|
| budget-skip / completeness / offline-ltr / phase0-cache | **无** npm/CI 命中 | 移入 historical + throw |
| phase1-window-edge-dialog200-probe | 手工 | **KEEP active** |

---

## 9. Runtime Impact

```text
Production / Recall / Edge 业务逻辑：无变更。
```

---

## 10. Test Results

```text
npx jest --testPathPattern="residual-cleanup|b1-recall-full-traversal|phase1-window-edge-harness\\.test|freeze-contract"
→ 5 suites / 120 tests PASS
```

含：B1 full traversal · B2/Phase1 harness · freeze-contract · Production isolation · residual-cleanup 静态与 schema。

---

## 11. KEEP

- 历史审计与 FAIL 报告正文  
- 历史 `*quality-perf.json` / `d001-audit-full.json`  
- B1 负向单测中的废弃符号断言  
- 现行 Phase1 dialog_200 probe 与 post-repair summary  
- Runtime `logicalWindowRecallCount` 实现  

---

## 12. MODIFY

- 三实验脚本 + helper + experiments README  
- `DOMAIN_RECALL.md` · `diagnostics/FROZEN.md`  
- residual-cleanup 测试  

---

## 13. ARCHIVE

- 四失效探针 + pre-repair matrix/budget JSON → `docs/tone-v2/_audit_scratch/historical/pre_b1_b2_repair/`  

---

## 14. DELETE

- 无物理删除历史证据  
- 活跃路径上的旧探针文件路径：随 **move** 移除（内容保留在 historical）  

---

## 15. Remaining Residuals

| 项 | 说明 |
|----|------|
| 历史文档正文仍出现 `maxSqlPerUtterance=150` | **IGNORE/KEEP** — 非现行 SSOT |
| 历史 JSON 仍含 `ngramQueryCount` | **KEEP** — 快照 |
| helper / 废弃说明中的符号字符串 | 检测与文档标记用途 |

---

## 16. Scope Violations

```text
无。
```

未为 Cleanup 修改 Recall/Edge 业务代码。

---

## 17. Target List Completion

| ID | 状态 |
|----|------|
| TARGET-1 实验脚本统一字段 | **DONE** |
| TARGET-2 缺字段明确失败 | **DONE** |
| TARGET-3 现行文档删 gate 描述 | **DONE** |
| TARGET-4 文档同步 B1 | **DONE** |
| TARGET-5 文档同步 B2 | **DONE** |
| TARGET-6 历史未被篡改 | **DONE** |
| TARGET-7 失效 probe 退出活跃链 | **DONE** |
| TARGET-8 历史 artifact 标记/归档 | **DONE** |
| TARGET-9 main/src 业务零修改 | **DONE** |
| TARGET-10 回归通过 | **DONE** |

---

## 18. Check List Completion

```text
[x] 全仓残留搜索完成
[x] 每个命中已分类
[x] 活跃实验脚本不再读取 ngramQueryCount
[x] 无双字段兼容读取
[x] 缺失 logicalWindowRecallCount 时明确失败
[x] 当前文档不再描述 Recall attempt gate 为现行
[x] 当前文档已同步 B1 冻结规则
[x] 当前文档已同步 B2 冻结规则
[x] 历史文档未被篡改
[x] 历史 JSON 未被覆盖
[x] 旧 probe 已归档并 throw 停用
[x] package scripts / CI 不引用失效 probe
[x] main/src 无业务逻辑变更（本轮）
[x] B1/B2 回归测试通过
[x] Production isolation 仍通过
[x] 未进入 Phase 2
```

---

## 19. Final Decision

```text
RESIDUAL CLEANUP COMPLETE
READY FOR RESIDUAL VERIFICATION
```

下一工序：**Residual Verification**（不是 Phase 1 Re-Acceptance，不是 Phase 2）。
