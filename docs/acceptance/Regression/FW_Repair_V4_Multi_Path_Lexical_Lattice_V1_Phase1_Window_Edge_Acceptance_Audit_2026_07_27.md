<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Regression/FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Phase1_Window_Edge_Acceptance_Audit_2026_07_27.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Multi-Path Lexical Lattice V1 · Phase 1 Window + Edge Acceptance Audit

| Field | Value |
|-------|-------|
| Date | 2026-07-27 |
| Audit type | **Read-only Acceptance** |
| Code / config / lexicon / SQLite changes | **NONE** |
| Phase 2 | **NOT ENTERED** |

---

## 1. Executive Verdict

```text
FAIL
```

### Blockers

| ID | Blocker |
|----|---------|
| **B1** | `maxSqlPerUtterance=150` 以 **Window Recall Attempt** 截断后，**75** 个 recallable Window 未召回；其中 **10** 个在绕开 budget 的只读 Recall 中产生正式词库 Candidate（合计 15 hits）。合法 LexicalEdge 被预算删除。 |
| **B2** | `buildLexicalEdges` 按 `termId` first-wins 去重后，**仅用保留 Candidate 计算** `recallEvidence`；构造证明同 `termId` 的 parent / tone_relaxed 来源被丢弃后，`hasParent` / `hasToneRelaxed` 变为 false，将直接影响后续 Path `structuralEvidence`。 |

开发报告中的 `PHASE 1 COMPLETE` **不构成**验收通过依据。

---

## 2. Scope and Authority

| 优先级 | 文档 |
|--------|------|
| 1 | Architecture V1.0.0 FROZEN |
| 2 | Implementation Contract V1.0.0 |
| 3 | Phase 1 Pre-Development Audit |
| 4 | Phase 1 Development Report |
| 5 | 代码注释 / 历史文档 |

本轮只验收 Phase 1 WindowQuery / hard-block / Recall 复用 / Edge / Harness / tests / dialog_200 / isolation。  
**禁止**讨论 Path / Vote / Assembly / KenLM / cutover / Batch SQL 实现。

---

## 3. Actual Code Call Graph

### Phase 1 Harness

```text
runPhase1WindowEdgeHarness
  → buildUtteranceSyllableCoordinate
  → partitionCoarseSpans
  → buildLexicalWindowQueries
       → buildWindowDescriptorForRange(allowEmptyCoarseRefs=true, hardBlockOnBoundaryCross=false)
  → latticeHardBlockFilter
  → createUtteranceRecallContext
  → recallTopKForWindows   // V4_LIMITS.maxSqlPerUtterance gates ngramQueryCount
  → buildLexicalEdges
  → releaseUtteranceRecallContext
```

锚点：`phase1-window-edge-harness.ts` L113–L230；`recall-topk-for-windows.ts` L264–L278。

### Production LTR（未改接线）

```text
runSpanAssemblyV4Orchestrator
  → runLtrFineSpanGeneration
       → generateLocalOptionsAtCursor (min=2)
       → blockedFilter          // 仍含 boundary_cross_count 硬阻断
       → recallTopKForWindows
       → commitBestFormalFineSpan
  → CompatibilityGraph → DomainAwareAssembly → KenLM
```

锚点：`span-assembly-v4-orchestrator.ts` L19–L21, L187–L194。

---

## 4. Window Completeness

| 检查项 | 结果 | 证据 |
|--------|------|------|
| 全句连续 1..5 | **PASS** | `build-lexical-window-queries.ts` L44–L60；`LATTICE_WINDOW_MIN/MAX = 1/5` |
| `[start,end)` | **PASS** | core L69–L73, L97–L99 |
| `windowId = start:end` | **PASS** | core L97 |
| 无 cursor / commit / FormalFineSpan | **PASS** | Lattice 生成器无上述符号 |
| 空 coarse 不跳过 | **PASS** | `allowEmptyCoarseRefs: true`；测试 `allows empty coarseBoundaryRefs` |
| 跨 coarse 仍生成 | **PASS** | `hardBlockOnBoundaryCross: false`；测试 `keeps cross-coarse windows` |
| 理论数量 N=1/2/5/6 | **PASS** | 单测 `theoreticalLexicalWindowCount`；N=6→20 |

公式 `sum_start min(5, N-start)` 与实现一致。

---

## 5. Coarse Soft Boundary Compliance

| 旧 LTR 硬切断 | Lattice 路径 |
|---------------|--------------|
| `if (!spanIds.length) return null` | **未进入** Lattice（仅 LTR `allowEmptyCoarseRefs=false`） |
| `boundaryCrossCount > max` → blocked | **未进入** `latticeHardBlockFilter`；Lattice 构造 `hardBlockOnBoundaryCross=false` |
| Harness | 调用 `latticeHardBlockFilter`，非 `blockedFilter` |

跨 coarse 仅写入 `spanIds` / `boundaryCrossCount` / `windowSource=boundary_window`。

---

## 6. Hard-Block SSOT Audit

| 规则 | `blockedFilter` | `latticeHardBlockFilter` | 共享 predicate？ | 行为差异 |
|------|-----------------|--------------------------|------------------|----------|
| boundary_cross_count | L102–L104 **硬阻断** | **不阻断**（softClear L99–L108） | 否（有意） | 有意差异 |
| raw_gap_between_spans | L105–L106 | L128–L129 | **否 — 复制** | 当前文本等价 |
| whitespace_gap | L108–L109 | L131–L132 | 复制 | 等价 |
| punctuation_in_window | L111–L112 | L134–L135 | 复制 | 等价 |
| sentence_boundary | L114–L115 | L137–L138 | 复制 | 等价 |
| non_cjk_syllable | L117–L118 | L140–L141 | 复制 | 等价 |
| asr_word_gap_ms | L120–L121 | L143–L144 | 复制 | 等价 |

**验收标准解读：** 当前 raw hard-block **行为一致**，未发现遗漏导致的正确性差异 → **不因漂移单独 FAIL**。  
**架构风险（MAJOR）：** 两份独立复制，未来易漂移；未抽取单一底层 predicate。

---

## 7. Recall Completeness Matrix

产物：

- `docs/tone-v2/_audit_scratch/lattice_v1_phase1/acceptance_completeness_matrix.json`
- `docs/tone-v2/_audit_scratch/lattice_v1_phase1/acceptance_completeness_matrix.jsonl`

| 汇总 | 值 |
|------|-----|
| execution completed / failed | **200 / 0** |
| identityFailCases | **0**（`blocked+recallable=generated`；`attempted+budgetSkipped=recallable`） |
| generated / blocked / recallable | 20470 / 5025 / 15445 |
| recalledAttempted / budgetSkipped | 15370 / **75** |
| partialRecallCases | **5** |
| edges / candidates | 1600 / 2677 |
| uniqueRecallKeys / cacheHit / cacheMiss | 15086 / 284 / 15086 |
| physicalSql | 34105 |
| latency P50/P95/P99 | 83.6 / 158.2 / 188.8 ms |
| heap delta | ~14.1 MB |

**必须分开报告：**

| 口径 | 结论 |
|------|------|
| execution success | 200/200 harness **跑通** |
| full recall coverage | **否** — 5 case / 75 window 被 budget 跳过 |

禁止把 `200/200 completed` 写成 semantic complete pass。

---

## 8. Budget-Exhausted Case Analysis

只读 probe 产物：  
`docs/tone-v2/_audit_scratch/lattice_v1_phase1/budget_skipped_readonly_recall_probe.json`

五个 case（**同一 GT 文本重复**）：

```text
今天我们团队要讨论后选生城相关的后选生城流程和上线计化安排，请研发一起评估风险。
```

| caseId | generated | blocked | recallable | attempted | skipped | skippedWithHits |
|--------|-----------|---------|------------|-----------|---------|------------------|
| d019 | 180 | 15 | 165 | 150 | 15 | **2** |
| d064 | 180 | 15 | 165 | 150 | 15 | **2** |
| d109 | 180 | 15 | 165 | 150 | 15 | **2** |
| d154 | 180 | 15 | 165 | 150 | 15 | **2** |
| d199 | 180 | 15 | 165 | 150 | 15 | **2** |

**合计：** skippedWindows=75；**skippedWithCandidates=10**；skippedCandidateTotal=15。

### 8.1 被跳过且有正式命中的 Window（每 case 相同）

| windowId | text | len | candidates |
|----------|------|-----|------------|
| `32:34` | 一起 | 2 | `一期` (termId `base-rebuild-term-e4b880e69c9f7c79`, exact, score 2.35)；`一齐` (…e9bd907c79) |
| `34:36` | 评估 | 2 | `评估` (termId `base-rebuild-term-e8af84e4bcb07c70`, exact, score 2.35) |

→ **若无 budget，应产生 lexical Edge；当前 Phase 1 Harness 未产生。**

### 8.2 位置偏差

| 统计 | 值 |
|------|-----|
| skip start 分布 | 32×5, 33×4, 34×3, 35×2, 36×1 |
| skip length 分布 | 1×5, 2×4, 3×3, 4×2, 5×1 |
| relativeStart | ≈0.84（句尾侧） |
| utteranceLastStart | 37 |

**结论：** Window 按 `start asc, end asc` 遍历 + attempt 计数硬截断 → **固定的句首优先、句尾缺失偏差**。属 Phase 2 blocker；且因存在正式命中，本轮直接 **FAIL（B1）**。

完整 15 窗清单见 probe JSON `cases[].skippedWindows`（含 windowText / pinyin / coarse refs / traversalIndex）。

---

## 9. SQL Budget Contract

| 名称 | 实际语义 | 代码证据 |
|------|----------|----------|
| `V4_LIMITS.maxSqlPerUtterance` (=150) | 限制 **`ngramQueryCount`（每 Window 一次 Recall Attempt）**，**不是** physical SQL statement 数 | `recall-topk-for-windows.ts` L266：`if (ngramQueryCount >= V4_LIMITS.maxSqlPerUtterance)`；L425：`ngramQueryCount += 1`（每次 attempt，含 cache hit） |
| `physicalSqlStatementCount` | LexiconRuntime 物理 statement 增量 | L351–L384 / 返回字段 |

**CONTRACT / NAMING DEBT：** 常量名含 `Sql`，实际闸门是 **logical window recall attempt**（cache hit 也占预算）。

dialog_200 上 physicalSql avg≈170.5 > 150，进一步证明命名与闸门语义不一致。

Trace 已记录 `sqlBudgetExhausted` **不能**补偿语义缺失（Architecture：合法 Edge 不得因预算静默消失）。

---

## 10. Recall Semantic Equivalence

`git diff` 对 `recall-topk-for-windows.ts`：**仅 +5 行 `termId` 透传**（`hit.hotword.id` → `WindowCandidate.termId`）。

未改：Exact / Tone / Fuzzy / Parent / TopK / candidateScore / minPrior / domain scope / SQL / term_domain_tags 装配。

`utterance-recall-cache.ts` / lexicon-v2：**无 Phase 1 业务 diff**。

---

## 11. Cache and RecallQueryKey

| 检查 | 结果 |
|------|------|
| `surfaceText` 进入 Key | **PASS** — `recall-topk-for-windows.ts` `surfaceText: window.windowText`；`serializeCanonicalRecallQueryKey` 含 surface |
| 同 pinyin 不同 surface → 不同 key | **PASS** — `phase1-utterance-cache.test.ts` / harness 合同测试 |
| tone / domainScope 区分 | **PASS** |
| 同 Key 每句一次事实召回 | **PASS** — cache miss 后 `utteranceCacheSet`；hit 走 `v3HitsFromLexiconFacts` |
| Candidate 对象隔离 | **PASS** — `v3HitsFromLexiconFacts` 返回浅拷贝；测试 `window mutation does not pollute Fact cache` |
| cacheHit=284 / cacheMiss=15086 | **定义准确**：`utteranceCacheGet` 对 cache 命中/未命中计数；miss≈uniqueKey（每句首次） |

Harness 每句独立 `createUtteranceRecallContext`，未写入 Job/Scheduler/Web/session。

---

## 12. LexicalEdge Contract

| 规则 | 结果 |
|------|------|
| `edgeId = start:end` | **PASS** |
| 同边界唯一 Edge | **PASS**（`seenBoundary`） |
| 无候选不建 Edge | **PASS** |
| 无 fallback | **PASS**（`edgeKind: 'lexical'` only） |
| Candidate 不拆成多 Edge | **PASS** |
| 顺序跟随 Window | **PASS** |

---

## 13. Candidate Identity and Evidence

| 项 | 结果 |
|----|------|
| merge 键 `termId` else `candidateId` | 实现符合合同字面 |
| 禁止按 replacement 合并 | **PASS** |
| `recallEvidence` 是否反映**全部**召回来源 | **FAIL（B2）** |

构造证明（只读调用 `buildLexicalEdges`）：

```text
输入同一 termId：exact+tone_exact 与 parent+plain_fallback
去重后仅保留第一个
recallEvidence = { hasExact:true, hasToneExact:true, hasToneRelaxed:false, hasParent:false }
```

parent / tone_relaxed **证据丢失**。Architecture 中 Path `structuralEvidence` 依赖 Edge 级 evidence → 硬门禁触发。

另：`hasFuzzy` 恒为 `false`（注释称 V3 source 无 fuzzy token）— 记为 **MAJOR** 合同缺口（若 Fuzzy 命中存在将永远不反映）。

---

## 14. Multi-Domain Integrity

真实词库（`lexicon-v3-five-table-v2`，bundleDir `node_runtime/lexicon/v3`）只读 harness：

| surface | domains[] 保留 |
|---------|----------------|
| 拿铁 | `coffee`, `food_order` |
| 少糖 | `coffee`, `food_order`, `milk_tea` |
| 预订 | `food_order`, `tourism_hotel`, `tourism_route`, `transport` |
| 机场 | `tourism_transport`, `transport` |

未发现 `domains[0]` 唯一化；Edge 上完整数组保留。**本项 PASS**（不抵消 B1/B2）。

---

## 15. Live Integration Authenticity

| 项 | 值 |
|----|-----|
| suite | `phase1-window-edge-harness.live.test.ts` |
| executed / passed / failed / skipped | **3 / 3 / 0 / 0** |
| 运行证据 | Jest verbose：165ms / 145ms / 155ms（非 skip） |
| SQLite / ABI | `LexiconRuntimeV2.loadFromBundleDir` status **ok** |
| lexicon path | `node_runtime/lexicon/v3` |
| manifestVersion | `lexicon-v3-five-table-v2` |
| tables（manifest） | term 10061；term_domain_tags 1033；domain 1033 等 |

三个 live case **真实执行**（非 ABI skip）。开发报告写 PASS 在此项成立。

---

## 16. Production Isolation Proof

| 检查 | 结果 |
|------|------|
| orchestrator 导入 Phase 1 符号 | **无**（静态测试 + grep） |
| 动态 import / feature flag / shadow | **未发现** Lattice 相关 |
| 生产请求跑 Harness | **不可能**（无接线） |
| `V4_LIMITS.windowMinSyllables` | 仍为 **2** |
| LTR `blockedFilter` boundary hard block | **保持** |

---

## 17. Regression Results

| 项 | 结果 |
|----|------|
| Phase 0 Coordinate | PASS（既有单测） |
| SOHO / USB / T2 Latin | PASS（Lattice hard-block 合同测试） |
| LTR tests / freeze-contract | PASS（开发阶段回归；本轮未改代码） |
| Recall key / surfaceText | PASS |
| domains[] | PASS（§14） |

---

## 18. Findings Classification

| ID | 分类 | 说明 |
|----|------|------|
| B1 | **BLOCKER** | budget 跳过 Window 中存在正式 Candidate → 合法 LexicalEdge 被删除 |
| B2 | **BLOCKER** | termId first-wins 去重导致 `recallEvidence` 丢失多来源证据 |
| F1 | **MAJOR** | `blockedFilter` vs `latticeHardBlockFilter` 谓词双份复制，未来漂移风险 |
| F2 | **MAJOR** | `maxSqlPerUtterance` 命名与实际（logical attempt，含 cache hit）不符 — CONTRACT/NAMING DEBT |
| F3 | **MAJOR** | `hasFuzzy` 恒 false |
| F4 | **OBSERVATION** | 句首优先截断造成句尾系统性缺失；dialog_200 五 case 为同一长句重复 |
| F5 | **OBSERVATION** | execution 200/200 ≠ full recall coverage |

---

## 19. Required Action

**最小修复范围（本轮不改代码，仅界定）：**

1. **B1 — Recall 完整性 vs budget**  
   - Phase 1 Harness 必须对 **全部 recallable Window** 完成与现网等价的 Recall→Edge，或  
   - 在 Architecture/Contract 明确批准前，**不得**用 attempt 预算删除仍可产生正式 Candidate 的 Window。  
   - 修复后须重跑：75 skipped 只读 probe → `skippedWithCandidates` 必须为 **0**。  
   - **禁止**在未批准情况下：提高 `maxSqlPerUtterance`、Batch SQL、减少 1..5 Window、恢复 coarse hard gate、Path prune。

2. **B2 — Edge evidence**  
   - 去重前对多来源做 **evidence union**，或 merge 键区分来源身份且 `recallEvidence` 聚合全部 hit。  
   - 增加回归：同 termId 多 `hitKind` / `toneLookupStage` → evidence 位完整。

3. （建议，非本轮实现）抽取共享 hard-block predicate，消除 F1；澄清 budget 命名（F2）。

---

## 20. Final Decision

```text
PHASE 1 ACCEPTANCE: FAIL
NOT READY FOR PHASE 2
```

**不得**进入 Phase 2 Pre-Development Audit，直至 B1 / B2 关闭并经复验。
