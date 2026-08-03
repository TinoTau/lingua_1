<!-- Documentation Hierarchy Metadata
Status: **SUPERSEDED**
Superseded By: CURRENT Sole Authorities + FW_V4_FREEZE_2026_08_03
Archive Path: docs/archive/SUPERSEDED/FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Phase1_B1_Recall_Budget_SSOT_Refactor_PreDevelopment_Audit_2026_07_27.md
-->

> **SUPERSEDED** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT Sole Authorities + FW_V4_FREEZE_2026_08_03

# FW Repair V4 — Multi-Path Lexical Lattice V1 · Phase 1 B1 Recall Budget SSOT Refactor Pre-Development Audit

| Field | Value |
|-------|-------|
| Date | 2026-07-27 |
| Audit type | **Read-only · Pre-Development** |
| Scope | **B1 only** — Recall Budget ownership / SSOT |
| Out of scope | B2 Evidence · Path · Vote · Assembly · KenLM · Batch SQL · Production Cutover |
| Code / config / SQLite / lexicon changes | **NONE** |

---

## 1. Executive Summary

B1 是**结构正确性**问题，不是单纯性能问题：

| Acceptance 输入（已冻结） | 值 |
|---------------------------|-----|
| budget 跳过的 recallable Window | **75** |
| 其中可召回正式 Candidate | **10** |
| 丢失正式 hit | **15** |

根因：

```text
Budget 闸门错误地住在 Recall Core 内
用 “logical Window Recall Attempt” 截断输入列表
→ 合法 recallable Window 永不 Recall
→ 合法 LexicalEdge 无法产生
```

且常量名 `maxSqlPerUtterance` **名实不符**（限制的是 attempt，不是 physical SQL）。

**唯一推荐方案（最小 SSOT）：**

```text
Recall Core 删除 attempt 截断分支
输入多少 recallable Window → 对多少 Window 完成 Recall
Production LTR 不改调用方（每步 ≤4 窗，历史上从未触达 150）
Lattice Harness 继续传入全部 recallable（无需双实现）
Budget 不再决定业务正确性；physical SQL 仅作诊断计数
```

**不**提高 150、不删 Window、不恢复 coarse hard-cut、不新增 Budget Manager / 双模式开关。

---

## 2. Frozen Constraints

| ID | 约束 |
|----|------|
| W1 | `buildLexicalWindowQueries` = Lattice 合法 Window 唯一来源；不得减 1..5 / 改序掩盖 budget |
| R1 | Recall 语义：一 Window → 一次确定性 Recall → Candidate 或空；内核不得决定“是否值得 / 因资源删除 / 是否进 Edge” |
| P1 | Production LTR 未切入 Lattice；本轮不得意外改变旧链输出 |
| S1 | 禁止 `RecallWithBudget` / `RecallWithoutBudget` / `LatticeRecall` / `LegacyRecall` 多实现 |
| A1 | Architecture：Coarse **Forbidden** `skip Recall` / `delete legal LexicalEdge`（§6）；Contract 同禁（§7） |

B1 Acceptance 结论作为设计输入，本轮不重复证明。

---

## 3. Current Budget Call Graph

### 3.1 真实引用位置（代码）

| 符号 | 位置 |
|------|------|
| `V4_LIMITS.maxSqlPerUtterance = 150` | `span-assembly-v4/v4-limits.ts` L8 |
| `CoarseAssemblyLimits.maxSqlPerUtterance = 150` | `span-assembly-shared/limits.ts` L8（**无 TS 运行时引用**） |
| **唯一闸门** | `recall-topk-for-windows.ts` L266–L278 |
| `ngramQueryCount` 初始化 / 递增 / 返回 | 同文件 L258 / L425 / 返回值 |
| `physicalSqlStatementCount` | 同文件 L261 + runtime statement delta |
| `sql_budget_exhausted` trace reason | `v4-diagnostics-types.ts` L41；push 于 L271–L275 |
| `pushSkippedRecallWindow` | `v4-diagnostics-trace.ts` L87 |
| Lattice 诊断派生 | `phase1-window-edge-harness.ts` L210–L218（`recallable - ngramQueryCount`） |
| Production 调用 | `span-assembly-v4-orchestrator.ts` L203–L223 → 注入 LTR `recallForWindows` |
| LTR 每步输入 | `ltr-fine-span-generator.ts` L545–L553：`generateLocalOptionsAtCursor` → filter `!blocked` → `recallForWindows` |

### 3.2 调用图

```text
[Lattice Harness]
  recallableWindows[]  (全句, 可达 165+)
       │
       ▼
  recallTopKForWindows   ←── ngramQueryCount 本地从 0
       │  if ngramQueryCount >= 150: break 其余窗
       ▼
  candidates / ngramQueryCount / physicalSql…

[Production LTR]
  per cursor: options len∈[2,5] → blockedFilter → ≤4 windows
       │
       ▼
  recallTopKForWindows   ←── 每次调用独立 ngramQueryCount=0
       │  实际上永远 < 150
       ▼
  orchestrator 累加 metrics.ngramQueryCount（诊断，非跨调用闸门）
```

**关键事实：** 闸门是**单次调用内**的 attempt 上限，**不是**跨 LTR cursor 的 utterance 级累计闸门。

---

## 4. Historical Origin

| 来源 | 内容 |
|------|------|
| `git`：`v4-limits.ts` 首次出现 | commit `b847ee3` *stable version* (2026-06-16) — 随 V4 limits 引入 `maxSqlPerUtterance: 150` |
| `docs/fw-detector/recall/DOMAIN_RECALL.md` | 表列参数 `150`，**无**保护对象说明 |
| `FW_Repair_V4_LTR_FineSpan_Performance_Audit` | 归类 DATABASE_IO；承认 `+1 per window`、低估真实 SQL；dialog_200 **0 耗尽** |
| `FW_Raw_Left_To_Right_FineSpan_Compatibility_Audit` | 文档复述 `150`；达限 skip |

**Historical intent not proven** 到单一权威动机（SQLite / CPU / 延迟 / 防死循环 / 候选爆炸）。  
可证事实仅有：作为 V4 冻结 limits 的“窗尝试上限”存在，且命名暗示 SQL，实现却计 attempt。

不得猜测更细动机。

---

## 5. Current Ownership

| 模块 | 是否应拥有 Budget | 理由 |
|------|------------------:|------|
| Window Builder | **否** | 只生成合法坐标；不得因资源删窗 |
| **Recall Core** | **否**（当前错误拥有） | 应只执行 Recall；不得决定窗合法性 |
| Utterance Cache | **否** | 只做 Key→Fact；预算不是其职责 |
| Lexicon Runtime | **否** | 执行 SQL；可暴露 physical 计数，不作业务截断 |
| Lattice Harness | **否（业务截断）** | 必须全量传入 recallable；可记录诊断 |
| Production LTR Caller | **否（当前不必）** | 已用 cursor + local options 控制规模；见 §9 |
| Diagnostics | **仅计数** | 描述执行事实；不得决定窗是否存在 |

职责分离：

| 角色 | Owner |
|------|-------|
| 业务正确性 | Window SSOT + Hard Block + 全量 Recall + Edge |
| 资源保护 | **本轮从 Recall Core 移除**；不另建 Policy 层 |
| 诊断计数 | `ngramQueryCount` / `physicalSqlStatementCount` / cache hit·miss |

**一个变量不得同时承担三种职责** — 当前 `maxSqlPerUtterance` 正是反例。

---

## 6. Counter and SQL Semantics

### 6.1 `maxSqlPerUtterance` 实际限制什么？

| 对象 | 是/否 | 锚点 |
|------|:----:|------|
| Window 生成数 | **否** | Window 在 Recall 前已生成 |
| **Window Recall Attempt 数** | **是** | L266 vs `ngramQueryCount`；L425 每窗 +1 |
| Cache lookup 数 | **否**（但 attempt 含 hit） | hit 也走 L425 +1 |
| Cache miss 数 | **否** | miss 不单独作闸门 |
| Canonical Query 唯一键数 | **否** | `uniqueKeyCount` 独立 |
| Lexicon Runtime 调用次数 | **间接** | miss 才调 `recallSpanTopKV3` |
| Physical SQL statement 数 | **否** | `physicalSqlStatementCount` 另计 |

→ **CONTRACT / NAMING DEBT**（Acceptance F2）。

### 6.2 `ngramQueryCount` 生命周期

| 问题 | 答案 |
|------|------|
| 初始化 | 每次 `recallTopKForWindows` 入口 `let ngramQueryCount = 0`（L258） |
| 递增 | 每处理完一窗 `ngramQueryCount += 1`（L425），**在 cache hit/miss 之后** |
| 检查时机 | 循环顶部，处理下一窗之前（L266） |
| Cache Hit 递增？ | **是**（占 attempt） |
| Cache Miss 递增？ | **是** |
| 无 SQL 递增？ | **是**（hit 路径无新 SQL 仍 +1） |
| 一窗多个 SQL？ | **可能**（`recallSpanTopKV3` exact+parent 等）；**不**按 SQL 条数闸门 |

### 6.3 截断效果

达限后真实行为（L266–L278）：

```text
break 整个 for 循环
剩余 Window：不 Recall、不写 cache、candidates 为空
若有 trace：批量 pushSkippedRecallWindow(reason=sql_budget_exhausted)
```

| 问题 | 答案 |
|------|------|
| 返回空 Candidate？ | 被跳过窗**无任何 Candidate 条目**（不是显式空数组绑定） |
| 后续恢复机会？ | **无** — 同一次调用内永久跳过 |
| Lattice Harness | 将跳过窗记为 `windowNoCandidate`；**不建 Edge** |

---

## 7. Recall Core Responsibility Audit

`recallTopKForWindows` 当前混合职责：

| 职责 | 当前存在 | KEEP / MOVE / DELETE |
|------|:--------:|----------------------|
| Canonical Recall Key | 是 | **KEEP** |
| Cache Lookup / Set | 是 | **KEEP** |
| Lexicon Fact Query | 是 | **KEEP** |
| WindowCandidate Binding | 是 | **KEEP** |
| Logical Attempt Budget 截断 | 是 | **DELETE**（闸门分支） |
| Physical SQL Counter | 是 | **KEEP**（诊断） |
| Budget Exhaustion Trace | 是 | **DELETE**（随闸门删除；或永不触发） |
| Window 遍历编排 | 是 | **KEEP**（对输入列表逐窗 Recall） |

**目标语义是否可达：**

```text
recallTopKForWindows
输入多少 recallable Window
就对多少 Window 完成 Recall
```

**可达。** 阻碍仅为 L266–L278 截断分支；删除后无架构阻碍。无需拆第二套 Recall。

---

## 8. Lattice Impact

Architecture / Contract：

- Window Generator 拥有全句 1..5
- Coarse **禁止** skip Recall / delete legal LexicalEdge
- Contract：coarse 不得 `skip Recall`

→ Lattice **必须**对全部 `latticeHardBlockFilter` 后的 recallable Window 完成 Recall。

当前 Harness 已传入全部 recallable；**失败点在 Core 截断**，不在 Harness 漏传。

B1 修复后期望：

```text
budgetSkippedWindowCount = 0
logicalWindowRecallCount = recallableWindowCount
d019/064/109/154/199 的 32:34 / 34:36 产生 Candidate → lexical Edge
```

---

## 9. Production LTR Impact

### 9.1 输入规模（代码）

| 事实 | 证据 |
|------|------|
| 每 cursor 生成 `len = windowMin..Max = 2..5` | `ltr-fine-span-generator.ts` `generateLocalOptionsAtCursor` |
| 仅 `!blocked` 送入 Recall | L552–L553 |
| 最坏每步 Window 数 | **≤4**（再加 1 音节 fallback 不经同一 recall 批时仍远小于 150） |
| 闸门每调用重置 | `recallTopKForWindows` 本地 `ngramQueryCount` |

### 9.2 是否真实依赖截断？

| 证据 | 结论 |
|------|------|
| `dialog200_ltr_performance_probe.json`：`sqlBudgetExhaustedCount: 0` | 生产 LTR 路径**未依赖**截断产生输出 |
| LTR Performance Audit：utterance 级 `ngramQueryCount` max≪150；D7“0 耗尽” | 同左 |
| 每步 ≤4 ≪ 150 | 结构性不可能在单次调用内触达闸门 |

### 9.3 删除 Core budget 后 LTR 输出？

```text
否 — 在现网调用形态下，每步传入窗全集本来就会被处理完毕；
删除闸门不改变 LTR 候选集合。
```

旧 LTR **已通过 cursor + local options** 控制输入规模；**无需**把 Budget “移动”到 LTR Caller 才能保持行为。移动只会增加无用抽象。

### 9.4 调用方边界可行性

| 方向 | 是否成立 |
|------|----------|
| Recall Core 不感知 Budget | **是**（推荐） |
| Lattice 传全部 recallable | **是**（已如此） |
| 旧 LTR 若需限制则在 Caller 切输入 | 理论可行但**当前不需要**；本轮不添加 LTR 侧预算切窗 |

---

## 10. Diagnostics SSOT

| 当前字段 | 真实语义 | KEEP / RENAME / DELETE | 新 Owner |
|----------|----------|------------------------|---------|
| `ngramQueryCount` | 本调用内已 attempt 的 Window 数（含 cache hit） | **KEEP**；语义对齐为 logical window recall count（文档/注释澄清；可选别名 metrics） | Recall Core 返回值 / orchestrator 累加 |
| `maxSqlPerUtterance` | 名：SQL；实：attempt 闸门阈值 | **DELETE 闸门用途**；常量若无引用则从 `v4-limits` / 死常量 `CoarseAssemblyLimits` **DELETE** | — |
| `physicalSqlStatementCount` | runtime 物理 statement 增量 | **KEEP** | Recall Core / utterance stats |
| `cacheHitCount` / `cacheMissCount` | `utteranceCacheGet` 命中/未命中 | **KEEP** | UtteranceRecallContext.stats |
| `uniqueKeyCount` / canonical lookups | 见过的 Canonical Key | **KEEP** | 同上 |
| Harness `windowsSkippedDueToSqlBudget` | `recallable - ngramQueryCount` | 修复后恒 0 → **DELETE** 字段或改为断言用临时检查后移除 | — |
| Harness `sqlBudgetExhausted` | 上式 >0 | **DELETE**（随 B1 关闭） | — |
| Trace `sql_budget_exhausted` | 跳过窗原因 | **DELETE** 写入路径；类型可留至无引用再删 | — |

原则：Diagnostics **只描述事实**，不决定合法 Window 是否存在。

计数关系目标（验收）：

```text
recallableWindowCount = logicalWindowRecallCount (= ngramQueryCount after full pass)
cacheHit + cacheMiss = utteranceCacheGet requestCount
physicalSql 独立统计
```

---

## 11. Target SSOT Architecture

```text
Window SSOT          → buildLexicalWindowQueries
Hard Block SSOT      → latticeHardBlockFilter
Recall Fact SSOT     → recallTopKForWindows + UtteranceRecallCache
Candidate Binding    → bindLexiconHitsToWindow（同文件内）
Edge SSOT            → buildLexicalEdges
Production LTR 输入范围 → LTR caller（cursor local options；不新增 budget）
Resource Diagnostics → physicalSql / logicalWindowRecall / cache 计数
```

**明确禁止新增：**

```text
Budget Manager
Policy Registry
ExhaustionPolicy DTO
enableBudget / latticeVsLegacy 双模式开关
RecallWithBudget / RecallWithoutBudget
```

现有接口删除闸门即可；**无证据**表明必须新增策略层。

---

## 12. Recommended Minimal Refactor

### 方案名：Delete Attempt Gate in Recall Core（唯一推荐）

| 项 | 内容 |
|----|------|
| **修改文件** | `recall-topk-for-windows.ts`；`phase1-window-edge-harness.ts`；可选 `v4-limits.ts` / `span-assembly-shared/limits.ts`（删死常量）；可选 diagnostics 类型清理 |
| **修改函数** | `recallTopKForWindows`：删除 L266–L278 整段；循环改为无条件处理 `input.windows` |
| **删除分支** | `ngramQueryCount >= maxSqlPerUtterance` → `break` + `pushSkippedRecallWindow` |
| **移动职责** | **无** — LTR 不需接收 Budget |
| **保留接口** | `recallTopKForWindows(input)` 签名不变；返回字段保留 `ngramQueryCount` / `physicalSqlStatementCount` |
| **Harness** | 删除或停用 `sqlBudgetExhausted` / `windowsSkippedDueToSqlBudget` / trace `sqlBudgetExhausted`；断言 `ngramQueryCount === recallable.length` |
| **测试范围** | §17；含 d019 五 case Edge；LTR 既有测试；orchestrator 隔离；dialog_200 Phase1 harness |
| **生产影响** | LTR 调用形态下 **行为不变**；metrics 仍累加每步 `ngramQueryCount` |
| **风险** | Lattice 长句 physical SQL / 延迟上升（可观测，不得自动恢复截断）；死常量文档不同步 |

**为何无双链路：** 同一 `recallTopKForWindows`；调用方只决定**传入哪些窗**。  
**为何 LTR 不变：** 每步窗数 ≪ 旧闸门；闸门从未触发。

---

## 13. Alternative Considered

### 备选：Caller-side 输入切片（**不推荐**）

| 项 | 内容 |
|----|------|
| 做法 | Core 删闸门；LTR/Harness 若需限制则 `windows.slice(0, N)` |
| 问题 | Lattice **禁止**切片；若仅 LTR 切片则无收益；若共享 N 则再现 B1 |
| 双链路风险 | 易演化为 “带 cap 的 caller” vs “全量 caller” 政策分叉 |
| 结论 | **拒绝**作为 B1 修复；不符合 SSOT / 冻结原则 |

伪修复排除清单（§十）全部维持排除，不展开实现。

---

## 14. KEEP / MODIFY / MOVE / DELETE

### KEEP

| 项 | 说明 |
|----|------|
| `buildLexicalWindowQueries` | Window SSOT |
| `latticeHardBlockFilter` | Hard block SSOT |
| `UtteranceRecallCache` / Canonical Key / `surfaceText` | 不变 |
| Lexicon Runtime / TopK / score / minPrior / domains / termId | Recall 业务不变 |
| `bindLexiconHitsToWindow` | Binding SSOT |
| `buildLexicalEdges` | Edge SSOT（B2 不在本轮） |
| `physicalSqlStatementCount` | 诊断 |
| LTR `generateLocalOptionsAtCursor` + cursor | 生产输入范围控制 |
| Production orchestrator 不接 Lattice | 隔离 |

### MODIFY

| 文件 | 函数/字段 | 变更 |
|------|-----------|------|
| `recall-topk-for-windows.ts` | `recallTopKForWindows` | 删除 attempt 闸门；注释明确：处理全部输入窗 |
| `phase1-window-edge-harness.ts` | diagnostics / trace | 去除 budget-skip 语义；完整性断言 |
| `v4-limits.ts` | `maxSqlPerUtterance` | 无引用后 **DELETE** 常量 |
| `span-assembly-shared/limits.ts` | 同名字段 | 无引用则 **DELETE** |

### MOVE

| 职责 | 结论 |
|------|------|
| 旧 LTR 输入限制 | **不移动** — 已在 LTR caller；无需从 Core “搬” Budget |

### DELETE

| 项 | 说明 |
|----|------|
| Recall 内部 attempt 截断分支 | L266–L278 |
| `sql_budget_exhausted` 写入路径 | 随闸门删 |
| Harness `budgetSkipped` 空结果业务语义 | 不得再表示“合法未召回” |
| 无引用的 `maxSqlPerUtterance` 常量 | 避免假 SSOT |

不得保留“以后可能再截断”的兼容开关。

---

## 15. Target List

```text
[ ] 删除 recallTopKForWindows 内 maxSqlPerUtterance 截断分支
[ ] 确认 ngramQueryCount == input.windows.length（全量）
[ ] 清理 / 删除 V4_LIMITS.maxSqlPerUtterance（及死常量副本）
[ ] Phase1 Harness：budgetSkipped 诊断删除或恒等断言为 0
[ ] 回归：d019/d064/d109/d154/d199 → 32:34 / 34:36 有 Candidate+Edge
[ ] dialog_200 Phase1：budgetSkipped 合计 = 0
[ ] LTR 既有测试 + freeze-contract 通过
[ ] orchestrator 仍不导入 Lattice Phase1 模块
[ ] 记录 physicalSql / latency / heap（仅事实，不回流截断）
[ ] 不处理 B2 / Path / Batch SQL
```

---

## 16. Check List

```text
[ ] Architecture：无 skip Recall / 无删合法 Edge
[ ] 单一 recallTopKForWindows；无双实现
[ ] 无 Budget Manager / feature flag
[ ] Lattice 全量 recallable
[ ] Production LTR 行为不变（证据：每步≤4 + 历史 0 耗尽）
[ ] 未提高 150、未减 Window、未 coarse hard-cut
[ ] physicalSql 与 logical attempt 语义分离
[ ] 未进入 B2 / Phase 2
```

---

## 17. Regression Plan

### 17.1 B1 正确性

```text
全部 recallable Window attempted
Harness budgetSkippedWindowCount = 0（或字段已删且矩阵无 skip）
```

### 17.2 已知 5 Case

对 `d019/d064/d109/d154/d199`：

| windowId | 期望 |
|----------|------|
| `32:34`（一起） | Recall 有正式 Candidate（如 一期/一齐）→ lexical Edge |
| `34:36`（评估） | Recall 有 `评估` → lexical Edge |

### 17.3 Production LTR

```text
ltr-fine-span-generator / freeze-contract / orchestrator 隔离测试
dialog_200 LTR 路径可选对照：sqlBudgetExhausted 仍为 N/A（闸门已不存在）
```

### 17.4 Diagnostics

```text
recallableWindowCount = logicalWindowRecallCount
cacheHit + cacheMiss = utteranceCacheGet.requestCount
physicalSql 单独报告
```

### 17.5 性能（只记录）

```text
P50 / P95 / P99
physicalSql sum·avg
heap delta
```

**禁止**以性能结果自动恢复截断。

---

## 18. Acceptance Criteria（B1 开发完成后）

| ID | 标准 |
|----|------|
| A1 | `recall-topk-for-windows.ts` 无 `maxSqlPerUtterance` 截断分支 |
| A2 | dialog_200 Phase1：`budgetSkipped` 合计 **0**；partialRecallCases **0** |
| A3 | 五长句 case：`32:34` / `34:36` 形成 Edge |
| A4 | LTR 单测 / freeze-contract **PASS**；orchestrator 零 Lattice 接线 |
| A5 | 无第二套 Recall；无 feature flag |
| A6 | B2 / Phase 2 **未**实施 |

---

## 19. Risks

| 风险 | 等级 | 说明 |
|------|------|------|
| Lattice 长句延迟 / SQL 上升 | OBSERVE | 全量 1..5 的预期代价；只记录 |
| 文档仍写 `maxSqlPerUtterance=150` | MINOR | 开发时同步 DOMAIN_RECALL / 旧审计引用 |
| 误把 physicalSql 再当成截断条件 | BLOCKER 若发生 | 验收禁止 |
| 范围蔓延到 B2 | BLOCKER 若发生 | 本审计明确排除 |

---

## 20. Final Decision

```text
READY FOR B1 SSOT REFACTOR DEVELOPMENT
```

### 唯一推荐方案（冻结本审计）

```text
Delete Attempt Gate in Recall Core
```

| 问题 | 答案 |
|------|------|
| Budget 应留在哪里？ | **不留在业务路径**；仅保留 physical/logical **诊断计数** |
| Recall 内核是否还应感知 Budget？ | **否** |
| Lattice 如何保证全量 Recall？ | Hard Block 后全部 recallable 传入同一 `recallTopKForWindows`；Core 不再截断 |
| 旧 Production LTR 如何不变？ | 不改 orchestrator/LTR 生成；每步窗数本就 ≪ 旧闸门；删除死代码闸门 |
| 删除哪些旧逻辑？ | `ngramQueryCount >= maxSqlPerUtterance` 分支及其 skip Trace；无引用的 `maxSqlPerUtterance` 常量；Harness budget-skip 业务语义 |
| 为何无双链路？ | 单一 Core；调用方只准备输入列表 |

**精确文件范围：**

```text
MUST:  recall-topk-for-windows.ts
MUST:  phase1-window-edge-harness.ts（+ 相关 Phase1 测试 / dialog_200 probe 期望）
MAY:   v4-limits.ts, span-assembly-shared/limits.ts, v4-diagnostics-types.ts
MUST NOT: orchestrator 接 Lattice；B2；Batch SQL；提高预算当修复
```

禁止进入 B2 或 Phase 2。
