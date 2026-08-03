<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Phase1_B1_B2_SSOT_Repair_Final_Code_Verification_Audit_2026_07_27.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# FW Repair V4 — Multi-Path Lexical Lattice V1 · Phase 1 B1/B2 SSOT Repair Final Code Verification Audit

| Field | Value |
|-------|-------|
| Date | 2026-07-27 |
| Nature | **Final Code Verification**（只读；不开发、不改设计、不改配置/SQLite/词库） |
| Scope | B1 Recall SSOT · B2 Evidence SSOT |
| Evidence basis | 真实代码 · 真实调用链 · 真实测试 / probe 产物 |
| Explicitly not trusted | 开发报告叙述 · Commit Message · 注释文案（仅作交叉对照） |

---

## 1. Executive Summary

对 `electron_node/electron-node/main/src` 运行时路径的只读核验表明：

| Blocker | 判定 |
|---------|------|
| **B1 Recall SSOT** | **完成** — Recall Core 无 attempt/resource gate；`maxSqlPerUtterance` 已从 limits 删除；`logicalWindowRecallCount === input.windows.length` |
| **B2 Evidence SSOT** | **完成** — `buildLexicalEdges` 单遍顺序为 OR Evidence → identity first-wins；`hasFuzzy` 来自 `recallCandidateKind` 薄透传 |

Production LTR 主链未接入 Lattice Phase 1 模块；未发现第二套 Recall / Evidence / Budget / Edge 实现。

```text
Final Decision: PASS
```

---

## 2. B1 Code Verification

### 2.1 Recall Core — `recallTopKForWindows`

**文件：** `electron_node/electron-node/main/src/fw-detector/span-assembly-v4/recall-topk-for-windows.ts`  
**函数：** `recallTopKForWindows`（约 L238–L459）

| 检查项 | 代码事实 |
|--------|----------|
| `maxSqlPerUtterance` | **不存在**于本文件；`V4_LIMITS` / `CoarseAssemblyLimits` 亦无此常量 |
| attempt gate | **不存在**（无 `>=` 阈值截断） |
| 因资源限制 `break` | **不存在**于 window 循环 |
| 因资源限制 `continue` / 提前 `return` | **不存在**于 window 循环 |
| budget skip | **不存在** |

Window 循环结构（事实）：

```text
for (let wi = 0; wi < input.windows.length; wi += 1) {
  // cache / SQL / bind
  logicalWindowRecallCount += 1;
}
return { …, logicalWindowRecallCount, physicalSqlStatementCount };
```

**允许存在的非预算控制流（不构成 B1 违规）：**

| 位置 | 行为 | 判定 |
|------|------|------|
| `bindLexiconHitsToWindow` L160–L162 | `!minPriorPassed` → `continue` | Candidate 过滤，**不跳过 Window Recall** |
| cache miss SQL `catch` L370–L373 | `throw err` | 失败上抛，非预算跳过 |
| 函数末尾 `return` | 正常返回 | 非提前截断 |

**结论：** 不存在任何因资源限制导致合法 recallable Window 未完成 Recall 的路径。

### 2.2 Diagnostics（B1）

| 字段 | Owner | 语义 | 是否决定 Recall |
|------|-------|------|-----------------|
| `logicalWindowRecallCount` | `recallTopKForWindows` 返回；orchestrator / harness 累加或断言 | 本调用实际遍历的 Window 数 | **否**（仅事实） |
| `physicalSqlStatementCount` | 同函数内对 `getPhysicalStatementStats().total` 的 delta；可镜像写入 `utteranceRecall.stats` | 真实 SQLite statement 执行增量 | **否** |
| cacheHit / cacheMiss | `utterance-recall-cache` stats → harness / orchestrator 诊断 | Fact 缓存命中事实 | **否** |

Harness（`phase1-window-edge-harness.ts` L179–L183）在 `logicalWindowRecallCount !== recallableWindows.length` 时 **throw** — 完整性守卫，不替代 Recall 决策。

未发现：同名字段双语义、Budget 诊断反控 Recall、`sql_budget_exhausted` 写入路径。

### 2.3 Production（B1 影响面）

Production 调用链仍为：

```text
span-assembly-v4-orchestrator
  → runLtrFineSpanGeneration(cursor / localOptions)
  → blockedFilter
  → recallTopKForWindows
  → … compatibility / domain assembly / KenLM …
```

| 检查 | 结果 |
|------|------|
| orchestrator 是否 import Lattice Phase 1 模块 | **否**（源码隔离测试锁定） |
| 新增 Lattice feature flag / shadow / temporary switch | **否** |
| 业务逻辑相对 B1 的实质变更 | **仅** metrics 字段 `ngramQueryCount` → `logicalWindowRecallCount`；无第二召回链 |

`allocateDomainBucketSentenceBudget` 属于 Domain Assembly 句子预算，**不是** Window Recall attempt gate；KEEP（既有生产职责，非 B1 残留）。

---

## 3. B2 Code Verification

### 3.1 `buildLexicalEdges` 真实顺序

**文件：** `build-lexical-edges.ts`  
**函数：** `buildEdgeCandidatesAndEvidence`（L77–L94）→ `buildLexicalEdges`（L100–L128）

单遍循环事实顺序：

```text
for each candidate c:
  1) orCandidateEvidence(evidence, c)   // OR Evidence（含将被 first-wins 丢弃的来源）
  2) candidateMergeKey(c) → seen? skip : keep
→ return { kept, evidence }
```

**不是** first-wins keep 后再 OR Evidence。

### 3.2 Evidence 来源与 Owner

| Flag | 来源字段 | 推导位置 |
|------|----------|----------|
| `hasExact` | `hitKind === 'exact_term'` | `orCandidateEvidence` |
| `hasToneExact` | `toneLookupStage === 'tone_exact'` | 同上 |
| `hasToneRelaxed` | `toneLookupStage === 'plain_fallback'` | 同上 |
| `hasFuzzy` | `isFuzzyRecallCandidateKind(c.recallCandidateKind)` | 同上 |
| `hasParent` | `hitKind === 'parent_fragment'` | 同上 |

| 检查 | 结果 |
|------|------|
| 多个 Evidence Builder | **否** — 唯一写入 `LexicalEdge.recallEvidence` 的路径在 `buildLexicalEdges` |
| 重复 OR / 二次聚合 | **否** |
| Evidence Owner | **唯一：** `buildLexicalEdges` / `orCandidateEvidence` |

`isFuzzyRecallCandidateKind`（`lexicon/candidate-score.ts`）为既有 RecallKind 分类复用，**不是** Edge 侧新 fuzzy 分类器。

### 3.3 Candidate identity

`candidateMergeKey`：

```text
termId 非空 → `term:${termId}`
否则 → `cand:${candidateId}`
```

**未参与去重：** `replacement` / `domain` / `hitKind` / surface。

### 3.4 `hasFuzzy`

| 检查 | 结果 |
|------|------|
| 来自 `recallCandidateKind` | **是** — bind 透传 `hit.recallCandidateKind`（`recall-topk-for-windows.ts` L196） |
| 字符串 / surface 判断 | **否** |
| 硬编码 `hasFuzzy: false` 残留实现 | **否**（仅测试期望值中可出现 `false`） |
| 新的 fuzzy 分类体系 | **否** |

---

## 4. Runtime Search Result

全仓关键词检索分类（运行时代码以 `main/src` 为准）。

| 符号 | 命中类别 | 判定 |
|------|----------|------|
| `maxSqlPerUtterance` | **仅** `b1-recall-full-traversal.test.ts` 负向断言（`'maxSqlPerUtterance' in V4_LIMITS` → false）；历史文档；旧验收文 | 测试 **KEEP**；文档 **IGNORE** |
| `sql_budget_exhausted` | `main/src` **0 命中**；历史文档 / 旧验收 | **IGNORE**（文档） |
| `SkippedRecallWindow` | `main/src` **0 命中** | — |
| `windowsSkippedDueToSqlBudget` | `main/src` **0 命中** | — |
| `budgetSkipped` | 历史 scratch `acceptance_completeness_matrix.jsonl`（修复前探针）；文档 | scratch/文档 **IGNORE** |
| `partialRecall` | probe 脚本统计字段名 + 修复后 summary `partialRecallCases: 0`；文档 | 探针 **KEEP**（完整性度量）；文档 **IGNORE** |
| `ngramQueryCount` | `main/src` **仅** B1 测试负向断言；`tests/experiments/*` 脚本/历史 JSON 仍读旧字段名；文档 | 测试 **KEEP**；实验脚本见 §11 **DELETE**；文档/JSON **IGNORE** |

**运行时生产路径：Budget 相关符号零残留。**

---

## 5. Dead Code Audit

针对 Lattice Phase 1 / B1 / B2 相关文件检索：`TODO` / `FIXME` / `deprecated` / `legacy` / `compat` / `temporary` / `migration` / `fallback` / `obsolete`。

| 项 | 位置 | 判定 |
|----|------|------|
| LTR `legacy hard-cut` 注释 | `window-construction-core.ts` | **KEEP** — 共享核心上的 LTR 标志说明，非死代码 |
| `recallToneIncompatibleCount` legacy alias | `recall-topk-for-windows.ts` L450–451 | **KEEP** — 既有 tone 诊断别名，非 B1 Budget |
| LTR 1-syllable `fallback` option | `ltr-fine-span-generator.ts` | **KEEP** — 生产 Formal 进度保证，非 Lattice fallback Edge |
| Metrics `@deprecated` droppedCandidateCount / conflictCount | `v4-types.ts` | **KEEP** — Authority Reduction 既有字段，非 B1/B2 |
| 注释掉的 attempt gate / 双 Evidence 实现 | — | **未发现** |
| 无人调用的 Budget skip 函数 / 死字段 | — | **未发现**（运行时） |

---

## 6. Diagnostics Audit

| 断言 | 结果 |
|------|------|
| Diagnostics 只记录事实 | **成立** — cache / SQL / logical count 不 gate Window |
| `logicalWindowRecallCount` 与语义一致 | **成立** — 每处理一窗 +1；返回长度等于输入窗数 |
| `physicalSqlStatementCount` 重复统计导致双 Owner | **否** — 同一函数内 delta；utterance cache stats 为镜像；orchestrator 以 recall 返回值累加后写回 stats |
| 名称与语义不一致（旧 `ngramQueryCount` 名实不符） | **已消除**（运行时类型/返回值） |
| Budget 诊断决定 Recall | **不存在** |

---

## 7. Interface Audit

| 接口 | 状态 |
|------|------|
| `RecallTopKResult.logicalWindowRecallCount` | **唯一** Window 召回计数字段 |
| `RecallTopKResult.ngramQueryCount` | **不存在** |
| `SpanAssemblyV4Diagnostics` / `SpanAssemblyV4Metrics` | 使用 `logicalWindowRecallCount` |
| `V4_LIMITS.maxSqlPerUtterance` | **已删除** |
| `CoarseAssemblyLimits.maxSqlPerUtterance` | **已删除** |
| `WindowCandidate.recallCandidateKind?` | 薄透传；用途限定 Edge `hasFuzzy` |
| `LexicalEdge.recallEvidence` | 唯一 Evidence DTO |
| `sql_budget_exhausted` / `SkippedRecallWindowTrace` | 诊断类型 **无引用残留**（`v4-diagnostics-*` 无命中） |

替换在运行时 DTO / 返回值层面 **真正完成**。实验脚本字段名见 §11。

---

## 8. Production Isolation

| 检查 | 证据 | 结果 |
|------|------|------|
| orchestrator 不 import `buildLexicalWindowQueries` / `buildLexicalEdges` / harness / latticeHardBlock | `phase1-window-edge-harness.test.ts` isolation 用例读源码断言 | **PASS** |
| 无 `FEATURE_*LATTICE` / `enableLattice` / `shadowLattice` | 同上 | **PASS** |
| Lattice 入口 | `runPhase1WindowEdgeHarness` — tests / offline probe only | **PASS** |
| Production 仍走 LTR | orchestrator → `runLtrFineSpanGeneration` | **PASS** |

---

## 9. Regression Verification

### 9.1 本轮执行的真实测试

```text
npx jest --testPathPattern="b1-recall-full-traversal|phase1-window-edge-harness\.test|freeze-contract"
→ 4 suites / 112 tests PASS
```

### 9.2 B1 覆盖是否真实

| 测试 | 为何旧实现会失败 | 新实现 |
|------|------------------|--------|
| `logicalWindowRecallCount equals input length for 150/151/165` | 旧 gate 在 150 处 `break`，计数 ≠ 输入长度 | 全量遍历 → 相等 |
| `maxSqlPerUtterance` not in `V4_LIMITS` | 旧常量存在 | 已删 |
| `not.toHaveProperty('ngramQueryCount')` | 旧返回字段名 | 已更名 |
| Harness incompleteness throw | 旧预算跳过后计数不等 | 相等则通过 |

**不是**放宽断言或改期望值掩盖截断。

### 9.3 B2 覆盖是否真实

| 测试 | 为何旧实现会失败 | 新实现 |
|------|------------------|--------|
| 同 `termId` 多来源：`hasExact+hasToneExact+hasToneRelaxed+hasParent` 且 keep 首条 | 旧：先 first-wins 再读 kept → 丢第二来源 evidence | 先 OR 再 keep |
| `hasFuzzy` from `recallCandidateKind: 'fuzzy_plain'` | 旧硬编码 / 无透传 → false | thin pass-through → true |

### 9.4 Offline probe（既有产物，非本轮重跑）

`docs/tone-v2/_audit_scratch/lattice_v1_phase1/dialog_200_phase1_summary.json`：

- `partialRecallCases: 0`
- `incompleteRecallCaseCount: 0`
- 五长句 `32:34` / `34:36` 均有 Edge

---

## 10. SSOT Compliance

| 职责 | 唯一 Owner | 第二实现？ |
|------|------------|-----------|
| Lattice Window | `buildLexicalWindowQueries` | **否** |
| Recall | `recallTopKForWindows` | **否**（LTR 与 harness 共用同一函数） |
| LexicalEdge | `buildLexicalEdges` | **否** |
| Evidence | `LexicalEdge.recallEvidence`（由 `buildLexicalEdges` 写入） | **否** |
| Identity | `candidateMergeKey`（termId / candidateId） | **否** |
| Budget Manager / attempt gate | — | **不存在** |

单链路、单 SSOT、职责唯一：**成立**。

未进入 Path / Vote / Assembly / KenLM / Batch SQL / Production Cutover。

---

## 11. Remaining Legacy

| 项 | 位置 | 说明 |
|----|------|------|
| 实验脚本读 `ngramQueryCount` | `tests/experiments/analyze-*.mjs`、`summarize-schema-v2-dialog200.mjs` 等 | 诊断字段已更名；脚本读到 `undefined`；**非生产主链** |
| 历史 quality-perf JSON | `tests/experiments/*.json`、部分 `tests/*.json` | 快照数据含旧字段名 |
| 历史文档 / 旧 Acceptance 写 `maxSqlPerUtterance=150` | `docs/tone-v2/*`、`docs/fw-detector/*` | 审计史；非可执行代码 |
| 修复前 scratch matrix | `_audit_scratch/.../acceptance_completeness_matrix.jsonl` 含 `budgetSkippedWindowCount>0` | 旧探针残留 |

以上 **不构成** 运行时 Budget / Evidence 双链路。

---

## 12. Remaining Risks

| 风险 | 等级 | 说明 |
|------|------|------|
| Lattice 全句 1..5 无 attempt 上限 → 长句 latency/SQL 上升 | 运维/性能 | **非 SSOT 违规**；优化不得恢复 attempt gate |
| 实验脚本指标字段未对齐 | 低 | 仅影响离线分析可读性 |
| Phase 1 尚未正式 Re-Acceptance（流程） | 流程 | 本轮为 Code Verification；与 Acceptance 流程分离 |

---

## 13. KEEP

- `recallTopKForWindows` 全量遍历 + `logicalWindowRecallCount` / `physicalSqlStatementCount`
- `buildLexicalEdges` 单遍 OR → first-wins
- `WindowCandidate.recallCandidateKind` 薄透传 + `isFuzzyRecallCandidateKind`
- Phase 1 harness 完整性 throw
- Production LTR + `blockedFilter` + orchestrator 既有链
- Domain `allocateDomainBucketSentenceBudget`（非 Window Recall budget）
- B1/B2 负向与证据回归测试

---

## 14. DELETE

| 目标 | 建议删除方式 | 紧迫度 |
|------|--------------|--------|
| `tests/experiments/*.mjs` 中对 `spanAssemblyV4.ngramQueryCount` 的读取 | 改为 `logicalWindowRecallCount` 或删除该列 | 低（非生产） |
| 无引用的历史 probe JSON 中 `budgetSkipped*` 字段（若不再用于对比） | 归档或覆盖为新探针输出 | 低 |
| （已完成，确认无需再删）运行时 attempt gate / `maxSqlPerUtterance` / `sql_budget_exhausted` 写入 | — | — |

---

## 15. MUST FIX

```text
（无）
```

---

## 16. Final Decision

```text
PASS
```

**明确确认（运行时 `main/src` + Phase 1 harness/测试）：**

| 要求 | 状态 |
|------|------|
| 不存在 Budget 残留（attempt gate / skip / 常量闸门） | **成立** |
| 不存在旧 Recall 截断逻辑 | **成立** |
| 不存在旧 Evidence（先 first-wins 再 OR） | **成立** |
| 不存在双链路 / Lattice 兼容层 / feature flag | **成立** |
| 不存在死逻辑反控 Recall / Edge | **成立** |
| 不存在 B1/B2 职责冲突 | **成立** |

**B1 Recall SSOT：真正完成。**  
**B2 Evidence SSOT：真正完成。**

下一步流程（非本审计范围）：Phase 1 Re-Acceptance Audit → 其后方可进入 Phase 2。
