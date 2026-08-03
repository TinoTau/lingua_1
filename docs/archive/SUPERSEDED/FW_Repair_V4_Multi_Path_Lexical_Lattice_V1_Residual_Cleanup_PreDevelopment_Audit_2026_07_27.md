<!-- Documentation Hierarchy Metadata
Status: **SUPERSEDED**
Superseded By: CURRENT Sole Authorities + FW_V4_FREEZE_2026_08_03
Archive Path: docs/archive/SUPERSEDED/FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Residual_Cleanup_PreDevelopment_Audit_2026_07_27.md
-->

> **SUPERSEDED** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT Sole Authorities + FW_V4_FREEZE_2026_08_03

# FW Repair V4 — Multi-Path Lexical Lattice V1 · Residual Cleanup Pre-Development Audit

| Field | Value |
|-------|-------|
| Date | 2026-07-27 |
| Nature | **开发前代码审计（Read-only）** |
| Scope | B1/B2 完成后的历史字段 / 实验脚本 / 探针 / JSON / 文档 / 测试残留 |
| Out of scope | 业务逻辑修复 · 架构变更 · Phase 1 开发 · 覆盖历史证据 |
| Upstream | Final Code Verification Audit **PASS**（运行时主链已无 Budget / 旧 Evidence 残留） |

---

## 1. Executive Summary

运行时 `main/src` **已干净**（本轮不重复分析）。残留集中在：

| 类别 | 结论 |
|------|------|
| 仍在维护、会读错字段的 **实验脚本** | **必须 MODIFY** → `logicalWindowRecallCount` |
| 仍宣称 `maxSqlPerUtterance=150` 的 **运行文档 SSOT** | **必须 MODIFY**（`DOMAIN_RECALL.md`） |
| 依赖已删诊断字段的 **Acceptance 探针脚本** | **MODIFY 或归档停用**；产出的 JSON **KEEP 作历史证据** |
| 历史审计 / 快照 / 验收 FAIL 证据 | **KEEP**（禁止覆盖） |

```text
READY FOR RESIDUAL CLEANUP
```

---

## 2. Runtime Boundary

| 边界 | 本轮动作 |
|------|----------|
| `electron_node/.../main/src` | **不重复审计** — Final Code Verification 已确认无 Budget gate / 旧字段返回值 |
| 例外允许出现 | `logicalWindowRecallCount`（现行 SSOT）；B1 测试负向断言 `maxSqlPerUtterance` / `ngramQueryCount` |
| 本轮焦点 | `tests` · `tests/experiments` · `docs` · `_audit_scratch` · probe · JSON snapshot |

---

## 3. Residual Search Result

全仓关键词逐项分类（不含 `main/src` 业务实现细节复述）。

### 3.1 `ngramQueryCount`

| 位置类型 | 代表路径 | 判定 |
|----------|----------|------|
| Runtime DTO / 返回值 | （已更名为 `logicalWindowRecallCount`） | — |
| Test（负向） | `b1-recall-full-traversal.test.ts` | **KEEP** |
| Experiment script | `analyze-span-assembly-v4-dialog200.mjs` · `analyze-schema-v2-dialog200.mjs` · `summarize-schema-v2-dialog200.mjs` | **MODIFY** |
| Historical JSON | `tests/experiments/*quality-perf.json` · `d001-audit-full.json` · `tests/*dialog200-quality-perf.json` | **KEEP**（历史快照） |
| Probe（过时） | `offline-ltr-perf-probe.mjs` · `phase0-phase1-utterance-cache-probe.mjs` | **MODIFY**（若仍执行）或 **IGNORE**（归档停用） |
| Historical Document | 多份 tone-v2 审计 / 开发报告 | **IGNORE** / **KEEP** |

### 3.2 `maxSqlPerUtterance`

| 位置类型 | 代表路径 | 判定 |
|----------|----------|------|
| Runtime limits | 已删除 | — |
| Test（负向） | `b1-recall-full-traversal.test.ts` | **KEEP** |
| **Active SSOT doc** | `docs/fw-detector/recall/DOMAIN_RECALL.md` L102 | **MODIFY** |
| Probe（依赖常量） | `phase1-acceptance-budget-skip-probe.mjs` · `phase1-acceptance-completeness-matrix.mjs` | **MODIFY** 或 **DELETE 活跃用法**（文件可归档 KEEP） |
| Historical Document / Acceptance FAIL | Phase1 Acceptance / B1 Pre-Dev / LTR Perf 等 | **KEEP** |
| Architecture FROZEN / Implementation Contract | **无命中** | — |

### 3.3 `sql_budget_exhausted` / `SkippedRecallWindow` / `windowsSkippedDueToSqlBudget`

| 位置类型 | 判定 |
|----------|------|
| Runtime | **无** |
| Probe | `phase1-acceptance-completeness-matrix.mjs` 仍读 `diagnostics.windowsSkippedDueToSqlBudget` → 现为 `undefined` → **MODIFY/停用** |
| Scratch JSON | `acceptance_completeness_matrix.*` 含 `budgetSkippedWindowCount` → **KEEP**（B1 前证据） |
| Historical Document | **KEEP** |

### 3.4 `budgetSkipped` / `partialRecall`

| 位置类型 | 判定 |
|----------|------|
| 现行 Phase1 dialog_200 probe | `partialRecallCases` = incompleteness 计数（已对齐新语义）→ **KEEP** |
| 旧 completeness matrix 脚本/产物 | `budgetSkipped` / `partialRecallCases` = budget>0 → **产物 KEEP**；**脚本 MODIFY 或停用** |
| 文档中描述旧语义 | **KEEP**（历史验收 FAIL 证据） |

### 3.5 `logicalWindowRecallCount`

| 位置类型 | 判定 |
|----------|------|
| Runtime / harness / types / orchestrator | **KEEP**（现行 SSOT） |
| 现行 probe `phase1-window-edge-dialog200-probe.mjs` | **KEEP**（已对齐） |
| Experiment scripts | **尚未采用** → 见 §4 **MODIFY** |

---

## 4. Experiment Audit

### 4.1 仍会读旧字段的可执行脚本

| 文件 | 行为 | 新运行时效果 | 动作 |
|------|------|--------------|------|
| `tests/experiments/analyze-span-assembly-v4-dialog200.mjs` | `v4.ngramQueryCount`；`avg_ngram_queries`；d001 摘要同字段 | 读 **`undefined`**；`\|\| 0` → **假零均值** | **MODIFY** → `logicalWindowRecallCount`；输出键可改名或保留别名一层 |
| `tests/experiments/analyze-schema-v2-dialog200.mjs` | `avgNgramQueries` ← `ngramQueryCount \|\| 0` | 同上假零 | **MODIFY** |
| `tests/experiments/summarize-schema-v2-dialog200.mjs` | `ngram_queries: …ngramQueryCount` | 行内 `undefined` | **MODIFY** |

**不存在**「两套并行统计 SSOT」——问题是 **单源已改名、消费者未跟**。

### 4.2 统一修改 vs 删除

| 选项 | 结论 |
|------|------|
| 删除实验脚本 | **否** — 脚本仍服务 dialog_200 质量/诊断汇总，非死文件 |
| 统一修改 | **是** — 全部改为读 `logicalWindowRecallCount`；摘要键建议同步改名（可短暂兼容：`x?.logicalWindowRecallCount ?? x?.ngramQueryCount` **仅读历史 batch JSON** 时有用） |

### 4.3 Historical experiment JSON

| 文件 | 判定 |
|------|------|
| `span-assembly-v4-dialog200-quality-perf.json` 等 | **KEEP** — 禁止覆盖；属当时运行快照 |
| `p1-residue-cleanup-dialog200-quality-perf.json` | **KEEP** |
| `d001-audit-full.json` | **KEEP** |
| `tests/greedy-longest-v21-…` / `span-level-parentterm-…` / `parentterm-fragmentedge-…` | **KEEP** |

新跑实验应写 **新文件名**（或带日期后缀），不得原地覆盖旧 JSON。

---

## 5. Historical Artifact Audit

### 5.1 必须保留（历史证据）

| 产物 | 理由 |
|------|------|
| `…/lattice_v1_phase1/acceptance_completeness_matrix.json(l)` | Phase1 Acceptance **FAIL** 的 budgetSkipped=75 证据 |
| `…/lattice_v1_phase1/budget_skipped_readonly_recall_probe.json` | B1 只读补召回（被跳过窗仍有正式 hits） |
| `…/lattice_v1_phase1/dialog_200_phase1_summary.json` + `results.jsonl` | B1/B2 修复后 `partialRecallCases=0` 证据 |
| Phase1 Acceptance Audit / B1·B2 Pre-Dev / Development / Final Code Verification 文档 | 审计链不可删 |

**禁止覆盖**上述文件内容。

### 5.2 应归档 / 停止作为「现行工具」

| 脚本 | 现状 | 建议 |
|------|------|------|
| `phase1-acceptance-budget-skip-probe.mjs` | 用 `V4_LIMITS.maxSqlPerUtterance` **模拟** 150 截断；常量已删 → 再跑逻辑破碎 | **ARCHIVE**（文件 KEEP；头注释标明 superseded；不进日常 checklist） |
| `phase1-acceptance-completeness-matrix.mjs` | 读已删 `windowsSkippedDueToSqlBudget`；读 `V4_LIMITS.maxSqlPerUtterance` | **MODIFY** 对齐新完整性字段，或 **ARCHIVE** 后改用 `phase1-window-edge-dialog200-probe.mjs` |

### 5.3 现行有效探针

| 脚本 | 判定 |
|------|------|
| `phase1-window-edge-dialog200-probe.mjs` | **KEEP** — 已用 `logicalWindowRecallCount` / incompleteness |

### 5.4 其他过时探针（非 Lattice 专属，仍读旧字段）

| 脚本 | 判定 |
|------|------|
| `offline-ltr-perf-probe.mjs` | `m.ngramQueryCount`；`sqlBudgetExhausted: >=150` → **MODIFY** 或 ARCHIVE |
| `phase0-phase1-utterance-cache-probe.mjs` | metrics `ngramQueryCount` → **MODIFY** 或 ARCHIVE |

---

## 6. Document Audit

### 6.1 必须同步更新（Active / 会误导现行实现）

| 文档 | 问题 | 动作 |
|------|------|------|
| `docs/fw-detector/recall/DOMAIN_RECALL.md` §6 | 表内仍列 `maxSqlPerUtterance \| 150` | **MODIFY** — 删除该行；注明 Recall Core **不得**以 attempt 数截断；计量用 `logicalWindowRecallCount` / `physicalSqlStatementCount` |

Architecture FROZEN / Implementation Contract：**无**上述残留命中 → 本轮无需改。

`ARCHITECTURE.md` / `CONFIG.md`：**无**命中。

### 6.2 历史审计 / 开发报告 — KEEP

下列文件中的 `maxSqlPerUtterance` / Budget Skip / 旧调用链描述为 **当时事实**，属证据链：

- Phase1 Window Edge Acceptance / Pre-Dev / Development Report  
- B1 Recall Budget Pre-Dev / B1+B2 Development / Final Code Verification  
- LTR FineSpan Performance Audit、FW_Raw_LTR Compatibility、Phase0 Cache Report 等  

**KEEP** — 不因「代码已变」而删改历史结论；若需防止误读，可在 **Supersession Index** 加一行指针（可选，非必须）。

### 6.3 旧 Evidence 调用链

文档中「先 first-wins 再 evidence」仅出现在 **B2 修复前** 审计/报告 → **KEEP**。  
现行 Contract/Architecture **未**把错误顺序冻成权威。

---

## 7. Dead File Audit

| 文件 | 无人引用/包脚本未挂 npm？ | 再跑是否有效？ | 判定 |
|------|---------------------------|----------------|------|
| `phase1-acceptance-budget-skip-probe.mjs` | 是（scratch） | **否**（常量已删） | 文件 **KEEP**（证据方法论）；活跃用法 **DELETE** |
| `phase1-acceptance-completeness-matrix.mjs` | 是 | **否**（诊断字段已删） | 同上 → **MODIFY 或 ARCHIVE** |
| `phase1-window-edge-dialog200-probe.mjs` | scratch | **是** | **KEEP** |
| `tests/experiments/analyze-*.mjs` / `summarize-*.mjs` | 手工实验 | 能跑但统计错 | **MODIFY**（非 DELETE） |
| Historical `*quality-perf.json` | 快照 | N/A | **KEEP** |
| 旧 Generator / 第二套 Recall | — | — | **未发现** |

无「可物理删除且不损证据」的强制 DELETE 文件清单；清理以 **字段对齐 + 停用失效探针 + SSOT 文档修正** 为主。

---

## 8. KEEP

- 全部历史 Acceptance / B1 探针 **JSON 产物**  
- 全部历史审计与 Development Report（含 FAIL 叙述）  
- `phase1-window-edge-dialog200-probe.mjs`（已对齐）  
- B1 单测负向断言  
- Runtime `logicalWindowRecallCount`  
- Architecture FROZEN / Implementation Contract（本轮无改需求）  
- Experiment **历史** quality-perf JSON（不覆盖）

---

## 9. MODIFY

| # | 目标 | 改法 |
|---|------|------|
| M1 | `analyze-span-assembly-v4-dialog200.mjs` | `ngramQueryCount` → `logicalWindowRecallCount`；`avg_ngram_queries` 键同步 |
| M2 | `analyze-schema-v2-dialog200.mjs` | `avgNgramQueries` 源字段同上 |
| M3 | `summarize-schema-v2-dialog200.mjs` | `ngram_queries` 源字段同上 |
| M4 | `docs/fw-detector/recall/DOMAIN_RECALL.md` | 删除 `maxSqlPerUtterance` 行；补现行计量字段说明 |
| M5 | `offline-ltr-perf-probe.mjs`（若保留执行） | 字段更名；删除 `>=150` exhausted 伪逻辑 |
| M6 | `phase0-phase1-utterance-cache-probe.mjs`（若保留执行） | metrics 字段更名 |
| M7 | `phase1-acceptance-completeness-matrix.mjs`（若保留执行） | 改用 `logicalWindowRecallCount === recallable`；去掉 budgetSkipped；**输出写新文件名** |

---

## 10. DELETE

| # | 目标 | 含义 |
|---|------|------|
| D1 | 失效探针的 **活跃职责** | budget-skip / 旧 completeness 脚本不再作为验收工具（文件可留档） |
| D2 | （无）历史 JSON / 历史审计正文 | **禁止**为整洁删除证据 |
| D3 | （无）实验脚本整文件 | 应用 MODIFY，非删脚本 |

---

## 11. Target List

Residual Cleanup 开发回合 **仅允许**触及：

1. `electron_node/electron-node/tests/experiments/analyze-span-assembly-v4-dialog200.mjs`  
2. `electron_node/electron-node/tests/experiments/analyze-schema-v2-dialog200.mjs`  
3. `electron_node/electron-node/tests/experiments/summarize-schema-v2-dialog200.mjs`  
4. `docs/fw-detector/recall/DOMAIN_RECALL.md`  
5. （可选）`docs/tone-v2/_audit_scratch/offline-ltr-perf-probe.mjs`  
6. （可选）`docs/tone-v2/_audit_scratch/phase0-phase1-utterance-cache-probe.mjs`  
7. （可选）`docs/tone-v2/_audit_scratch/phase1-acceptance-completeness-matrix.mjs` — 重写或头注释 ARCHIVE  
8. （可选）`docs/tone-v2/_audit_scratch/phase1-acceptance-budget-skip-probe.mjs` — 仅 ARCHIVE 注释，不改历史 JSON  

**禁止：** `main/src` 业务逻辑 · 覆盖 `_audit_scratch/lattice_v1_phase1/*` 历史产物 · Phase 1/2 功能开发。

---

## 12. Check List

```text
[ ] M1–M3 实验脚本改读 logicalWindowRecallCount；再跑时不产生假零均值
[ ] M4 DOMAIN_RECALL.md 不再将 maxSqlPerUtterance=150 列为现行参数
[ ] 失效 budget / completeness 探针：ARCHIVE 或改写；不覆盖旧 matrix JSON
[ ] 可选探针 M5/M6 对齐或标明 do-not-run
[ ] 新实验输出使用新文件名（不覆盖 *quality-perf.json）
[ ] main/src 零改动（或仅文档/注释外零改动）
[ ] 不进入 Phase 1 / Path / Vote / Assembly / Cutover
```

---

## 13. Remaining Risks

| 风险 | 等级 | 说明 |
|------|------|------|
| 有人仍跑旧 analyze 脚本 → 报告 `avg_ngram_queries=0` | 中 | 误导性能对比 |
| `DOMAIN_RECALL.md` 未改 → 后人「恢复 150 gate」 | 高 | 与已冻结 B1 SSOT 冲突 |
| 误删 / 覆盖 Acceptance matrix JSON | 高 | 丢失 B1 FAIL 证据 |
| 把 Residual Cleanup 扩成架构重写 | 流程 | 本计划禁止 |

---

## 14. Final Decision

```text
READY FOR RESIDUAL CLEANUP
```

残留范围清晰、可执行、不依赖架构重开。  
**不得**将本轮解释为进入 Phase 1。
