<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Phase2_Code_Verification_Node_Runtime_Audit_2026_07_27.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# FW Repair V4 — Multi-Path Lexical Lattice V1 · Phase 2 Code Verification & Node Runtime Audit

| Field | Value |
|-------|-------|
| Date | 2026-07-27 |
| Nature | **Phase 2 Code Verification** + Node Runtime Integration Re-Test + Fallback Cause Audit |
| Mode | 默认只读；仅允许 probe/测试接线最小修复 |
| Final Verdict | **PHASE 2 CODE VERIFICATION: CONDITIONAL PASS** · **REQUIRES CONTRACT / TEST EVIDENCE FIX** |

---

## 1. Executive Summary

上一轮 dialog_200 Phase 2 probe **未启动 Electron GUI 生产节点端（`npm start`）**，但 **已通过项目标准 Electron ABI + `LexiconRuntimeV2.loadFromBundleDir` 执行真实 SQLite operational lexicon Recall**（非 mock）。

本轮在独立目录重跑后：

| 结论 | 证据 |
|------|------|
| 环境分类 | **C — Offline harness with real SQLite Recall** |
| 200/200 fallback 是否因“未启动节点/mock” | **NO** — 真实 Recall 下行为一致 |
| Fallback 主因 | **NO_LEXICON_HIT (~75%)** + **HARD_BLOCKED_WINDOW (~20%)** |
| Phase 2 代码正确性 | 与 Development Report 一致；无 Domain/KenLM/双链路 |
| Contract 完整性 | Supplement 多项属 C/D 类，**需 Change Record 1.0.2**（本轮不擅自改冻结正文） |

```text
PHASE 2 CODE VERIFICATION: CONDITIONAL PASS
REQUIRES CONTRACT / TEST EVIDENCE FIX
```

**不得进入 Phase 3**，直至 Contract 1.0.2（或等价 Acceptance 契约）落地后再做 Acceptance。

---

## 2. Final Verdict

```text
PHASE 2 CODE VERIFICATION: CONDITIONAL PASS
REQUIRES CONTRACT / TEST EVIDENCE FIX
```

条件项（非业务算法 blocker）：

1. Supplement 中 best-first / active partial path / 0-1 DP 单解省略 / invalidGapCount 冗余 / dialog_200 fallback 验收口径 → 写入 **Implementation Contract Change Record 1.0.2**  
2. Acceptance 不得用 “200 completed / 0 failed” 代替质量结论；必须以 fallback 原因分布 + lexical-only coverage 为门槛  

非条件项（已证实）：

- 真实 SQLite Recall 已执行  
- 200/200 fallback **不是**测试环境未加载词库造成  
- Production isolation 成立  

---

## 3. Test Environment Classification

### 上一轮（`lattice_v1_phase2/`）

| 问题 | 答案 | 证据位置 |
|------|------|----------|
| 是否启动真实节点端 GUI？ | **否** | probe 头注释：`ELECTRON_RUN_AS_NODE=1` + harness-only |
| 节点进程是否运行？ | Electron **as Node** 进程，非 `npm start` | 启动方式与 Phase1/lexicon gate 相同 |
| SQLite lexicon 是否加载？ | **是** | `LexiconRuntimeV2.loadFromBundleDir(node_runtime/lexicon/v3)` |
| Recall 是否真实？ | **是** | `phase1-window-edge-harness.ts` → `recallTopKForWindows` |
| term_domain_tags？ | **是（运行时词库）** | manifest `term_domain_tags=1033` |
| utterance recall cache？ | **是** | harness `createUtteranceRecallContext` |
| DB 路径？ | `node_runtime/lexicon/v3/lexicon.sqlite`（~85.9MB） | Phase1 summary `physicalSql.sum=34255` |
| mock/stub/empty recall？ | **否** | 无 mock；knownFive Phase1 有真实 candidates |
| 仅简化 callback？ | **否** | 完整 Phase1 链 |

**判定：C. Offline harness with real SQLite Recall**

> 不属于 A（Production-equivalent GUI Node）。也不属于 D（mock）。  
> 因此：**上一轮 fallback 数据可作为真实词库效果的有效证据**（在 harness 边界内），不可用“没开节点”否定。

### 本轮（`lattice_v1_phase2_node_runtime/`）

同一 C 类路径，补齐启动证据日志 + fallback 原因分类 + Recall 计量。仍 **不** 接入 production orchestrator / 不 shadow LTR。

---

## 4. Node Runtime Startup Evidence

证据文件：`docs/tone-v2/_audit_scratch/lattice_v1_phase2_node_runtime/node_startup_evidence.log`

| 项 | 值 |
|----|-----|
| 启动命令 | `$env:ELECTRON_RUN_AS_NODE=1; electron.exe .../phase2-path-dialog200-node-runtime-probe.mjs` |
| 工作目录 | `electron_node/electron-node` |
| Electron | 28.3.3 |
| Node (ABI) | 18.18.2 |
| 词库目录 | `node_runtime/lexicon/v3` |
| SQLite | `lexicon.sqlite` **85921792** bytes |
| Manifest | bundleVersion **10**；term **10061**；term_domain_tags **1033** |
| `loadFromBundleDir` | **status=ok**（~434ms） |
| Recall domains | bakery\|coffee\|…\|transport（12 fine domains） |
| minPrior | 0.5 |
| mock | false |

说明：probe 内直接 `require('better-sqlite3')` 曾因模块解析路径失败；**LexiconRuntimeV2 内部已成功打开同一 SQLite**（见 `physicalSqlStatementCount.sum=34255`）。已对 probe 做最小修复（从 `electron-node/node_modules` 解析），不改业务逻辑。

---

## 5. SQLite / Lexicon Readiness

| 证据 | 值 |
|------|-----|
| 加载状态 | ok |
| 物理 SQL 语句（200 句合计） | **34255**（与 Phase1 summary 完全一致） |
| candidates 合计 | **2692** |
| lexicalEdge 合计 | **1610** |
| incompleteRecall | **0**（`logicalWindowRecallCount === recallableWindowCount`） |
| cache | Phase1 对照：hit 284 / miss 15161 |

---

## 6. Real Recall Chain Verification

```text
dialog_200
→ Electron ABI LexiconRuntimeV2
→ Coordinate (buildUtteranceSyllableCoordinate)
→ buildLexicalWindowQueries
→ latticeHardBlockFilter
→ recallTopKForWindows + utterance cache
→ SQLite operational lexicon
→ WindowCandidate[]
→ buildLexicalEdges
→ Phase 2 Path Harness
```

| 层 | 计量（200 句合计 / 注） |
|----|-------------------------|
| windows | Phase1 对照 sum≈20470 |
| blocked | Phase1 对照 sum≈5025 |
| recallable | **15445** |
| logicalWindowRecall | = recallable（incomplete=0） |
| physicalSql | **34255** |
| uniqueRecallKey | Phase1 对照 sum≈15161 |
| candidates | **2692** |
| lexicalEdge | **1610** |
| Phase2 paths retained | **244**（sum） |
| 异常 | failed=0 |

代码位置：

- Probe：`docs/tone-v2/_audit_scratch/phase2-path-dialog200-node-runtime-probe.mjs`  
- Harness：`phase1-window-edge-harness.ts` L164–177；`phase2-path-harness.ts`  
- Recall：`recall-topk-for-windows.ts`  

---

## 7. Offline vs Node Runtime Comparison

| Metric | Offline (`lattice_v1_phase2`) | Node Runtime Re-Test | Delta |
|--------|------------------------------:|---------------------:|------:|
| completed | 200 | 200 | 0 |
| failed | 0 | 0 | 0 |
| recallableWindowCount (sum) | (via Phase1) 15445 | 15445 | 0 |
| candidates (sum) | (via Phase1 edges/cands) | 2692 | — |
| lexicalEdgeCount (sum) | 1610 (Phase1) | 1610 | 0 |
| utterances needing fallback | 200 | 200 | 0 |
| fallbackInjectionCount (sum) | 2042 | 2042 | 0 |
| zero lexical-only complete paths | 200* | 200 | 0 |
| retainedPathCount (sum) | 244 | 244 | 0 |
| multi-path utterances | 28 | 28 | 0 |
| latency p50 (ms) | ~87.6 | ~65.7 | ~-22 |
| latency p95 (ms) | ~154.0 | ~122.6 | ~-31 |
| physicalSqlStatementCount (sum) | 34255 (Phase1) | 34255 | 0 |

\*Offline 轮次把 “需 fallback” 近似为 no-lexical-complete；本轮显式 `enumerateCompleteSegmentationPaths(lexical-only)` 证实 **200/200 lexical-only = 0 完整路径**。

### 关键问题回答

```text
200/200 fallback 是否由未启动节点端造成？
```

```text
NO — same behavior under real Node Runtime (class C / real SQLite Recall)
```

**不是** “OFFLINE TEST DID NOT USE PRODUCTION-EQUIVALENT NODE RUNTIME” 作为根因。  
更精确：上一轮已是真实词库 harness；GUI 生产节点未启动，但 **不解释** fallback 异常。

---

## 8. dialog_200 Node Runtime Results

证据目录：`docs/tone-v2/_audit_scratch/lattice_v1_phase2_node_runtime/`

| 文件 | 内容 |
|------|------|
| `dialog_200_phase2_node_summary.json` | 汇总 |
| `dialog_200_phase2_node_results.jsonl` | 逐句 |
| `fallback_cases.jsonl` | fallback 明细 |
| `zero_lexical_path_cases.jsonl` | 200 条 lexical-only 不可达 |
| `cap_cases.jsonl` / `high_path_cases.jsonl` | 空（未触发） |
| `node_startup_evidence.log` | 启动证据 |

上一轮 offline 结果 **保留未覆盖**：`lattice_v1_phase2/`。

---

## 9. Fallback Cause Distribution

| Reason | Count | Ratio | Sentences | 典型 |
|--------|------:|------:|----------:|------|
| **NO_LEXICON_HIT** | 1534 | 75.1% | 200 | d001@12：该起点有 recallable window，命中 0 |
| **HARD_BLOCKED_WINDOW** | 410 | 20.1% | 200 | d001@13：`sentence_boundary` / `raw_gap_between_spans` |
| **UNKNOWN** | 98 | 4.8% | 81 | d004@27：存在 lexical outgoing，但 min-cost 路径仍走 fallback（死支） |
| LATIN_OR_PUNCT_GAP / NON_CJK / ASR / … | 0* | — | — | 多并入 HARD_BLOCKED（`sentence_boundary`/`raw_gap`） |

\*分类器在“该起点全部 window blocked”时优先映射 `blockedBoundaryReason`；本批主因标签落在 `HARD_BLOCKED_WINDOW`（含标点/句界硬阻）。

**不能**把全部 fallback 统称为“词库稀疏”。真实构成：

1. **词库覆盖缺口**（主）  
2. **硬阻窗口导致无法形成 lexical edge**（次）  
3. **少量死支 lexical + 仍需 gap fallback**（UNKNOWN）

涉及模块：Recall/词库覆盖 + Hard-block 过滤；**不是** Path Enumerator 错误，也 **不是** Recall 未执行。

---

## 10. Lexical-only Path Coverage

```text
lexical-only complete path count = 0  (all 200 utterances)
```

逐句：`completePathCountBeforeFallback=0`（见 results / zero_lexical_path_cases）。

---

## 11. Fallback-assisted Path Coverage

```text
fallback-assisted complete paths: every utterance (≥1 after injection)
zero complete paths after fallback: 0
```

Fallback 依赖桶：

| Bucket | Utterances |
|--------|----------:|
| 0 | 0 |
| 1–2 | 0 |
| 3–5 | 17 |
| 6–10 | 115 |
| 11+ | 68 |

**判断：** 当前 SegmentationPath 在 dialog_200 上 **主要依赖 fallback 才能覆盖**；lexical Edge 是局部片段主体，但 **不足以** 单独形成 [0,N) 完整路径。

平均：lexicalEdge ≈ 8.05 / 句，fallbackInjection ≈ 10.21 / 句。

---

## 12. Multi-Path Effectiveness

| Metric | Value |
|--------|------:|
| multi-path utterances | **28 / 200 (14%)** |
| retainedPath sum | 244 |
| avg retained | 1.22 |
| distribution (offline) | 1→172, 2→20, 4→8 |

多路径效果存在但偏弱；主因是稀疏 lexical 图 + 大量 length-1 fallback 降低分支。

---

## 13. Minimal Fallback Alternative Analysis

验证测试：`phase2-min-fallback-analysis.test.ts`（**未改** `inject-fallback-edges.ts`）

| 场景 | 结果 |
|------|------|
| 唯一最小解 | DP = 唯一集合 |
| 两组同成本解（N=4: edges 0→2,1→3） | DP 确定性择一；并集 path keys ≥ DP keys（存在遗漏的交替 boundaryKey） |
| 三组+ | 可构造；资源随并集增长 |

**建议：**

```text
Decision Contract clarification → Implementation Contract Change Record 1.0.2
```

记录：

```text
V1.0.0 keeps single deterministic min-cost fallback set.
Enumerating all same-cost min sets is OUT OF SCOPE unless Contract ≥1.0.2 explicitly expands it.
```

**不建议**本轮改算法；**不需要** Architecture Addendum（方向未变）。

---

## 14. Path Cap Stress Results

验证测试：`phase2-path-cap-stress.test.ts` — **PASS**

| Case | Result |
|------|--------|
| 7/8/9/16 complete under maxComplete=8 | 超 cap 时 retain=8 |
| 32+（dense N=8） | uncapped≥32 → retain=8 |
| per-position only | 触发且乱序稳定 |
| both caps | 稳定 |
| best-first exact>fuzzy>parent | retained `0-3` |

dialog_200 上 cap 仍为 0（稀疏图）— 与 Development Report 一致；压力测试补齐验收盲区。

---

## 15. Comparator Verification

```text
Comparator semantics = best-first
(invalidGapCount modeled as fallbackEdgeCount for gap-finalized paths)
```

**冗余记录（不得静默删除）：**

```text
Contract §8.3 lists invalidGapCount as separate key.
Implementation equates invalidGapCount := fallbackEdgeCount.
→ Contract / Implementation redundancy → Change Record 1.0.2 说明
```

---

## 16. Candidate Reference Sharing

Node re-test：`candidateReferenceCopyViolations = 0`  
Unit materializer：`candidates ===` 断言 PASS  

无 deep-copy / structuredClone。

---

## 17. Determinism

- Edge 乱序 → boundaryKeys 一致（unit + cap stress）  
- 双次 harness replay → unstablePathIdViolations = 0  
- pathId = sha256(boundaryKey)  

---

## 18. Phase 1 Full Regression

本轮执行：

```text
npx jest --testPathPattern="span-assembly-v4|freeze-contract|pinyin-ime-v2-freeze"
```

| Metric | Value |
|--------|------:|
| Test Suites | **29 passed / 29** |
| Tests | **262 passed / 262** |
| Failed | 0 |
| Skipped | 0 |

覆盖：Phase1 harness / B1 / residual / live lexicon / Phase2 全套 / freeze / LTR（仍存在）/ Vote isolation 等。

确认无回归：Window 1..5、Recall full traversal、Evidence OR、Diagnostics fact-only、Production isolation。

---

## 19. Compile / Build

| Check | Result |
|-------|--------|
| `npm run build:main` (tsc) | **PASS**（本轮验证前已成功编译；probe 使用 dist） |
| packaging / electron-builder | **未跑**（本轮非 cutover；非阻断，记为 optional） |

---

## 20. Production Isolation

| Check | Result |
|-------|--------|
| orchestrator 改动 | **无** |
| `runLtrFineSpanGeneration` 仍为生产入口 | **是** |
| Phase2 import into orchestrator | **无** |
| dual chain / feature flag / shadow | **无** |
| Domain/Vote/Assembly/KenLM in Phase2 harness | **无** |

---

## 21. Contract Completeness

| Supplement 规则 | 分类 | 处置 |
|-----------------|------|------|
| best-first comparator | **D Decision** | 需 **1.0.2** |
| active partial path 定义 | **B Interface**（可并入 1.0.2） | 建议写入 Contract |
| fallback `candidates=[]` | **C Data**（实现已符合 §6 精神） | 建议 1.0.2 显式化 |
| 0-1 DP minimal fallback | **D Decision** | 需 **1.0.2** |
| alternate min-cost omission | **D Decision** | 需 **1.0.2** |
| dialog_200 fallback acceptance | **Acceptance** | 需 Acceptance Contract CURRENT，勿只留 Supplement |

**本轮不重写 Architecture。** 建议下一步文档动作：`Implementation Contract Change Record 1.0.2` + Phase2 Acceptance Contract。

---

## 22. Code vs Report Consistency

逐文件核对（对照 Development Report）：

| File | 一致？ | 注记 |
|------|--------|------|
| lattice-path-types.ts | 是 | |
| build-boundary-key.ts | 是 | sha256 full hex |
| inject-fallback-edges.ts | 是 | 0-1 DP；candidates=[] |
| enumerate-complete-segmentation-paths.ts | 是 | best-first；invalidGap=fallback |
| materialize-formal-fine-spans.ts | 是 | `lattice_path_edge`；引用共享 |
| phase2-path-harness.ts | 是 | harness-only |
| build-lexical-edges.ts | 是 | edgeKind union；仍只产 lexical |
| v4-limits.ts | 是 | probe caps 8/8 |
| domain-context-contract.ts | 是 | +`lattice_path_edge` |
| v4-diagnostics-* | 是 | fact-only optional |
| Contract 1.0.1 | 是 | |

未发现：deep-copy、随机序、Domain/KenLM 输入、fallback-to-LTR、shadow、production import。

本轮 **仅** 新增验证测试与 node-runtime probe（允许范围）；**未改** Enumerator/Fallback 业务算法。

---

## 23. Blockers

| ID | Severity | Description | Action |
|----|----------|-------------|--------|
| B1 | **Doc** | Supplement Decision/Data 条款未入 Contract 1.0.2 | 写 Change Record（单独文档轮次） |
| B2 | **Quality gate** | dialog_200 零 lexical-only 完整路径；路径高度依赖 fallback | Acceptance 需设质量门槛；非本轮修算法 |
| B3 | Info | GUI `npm start` 未用于本验证 | 非必须；C 类已满足真实词库 |

**无业务代码 blocker 需在 Verification 中修复。**

---

## 24. Risks

1. 将 “completed=200” 误当成 Phase2 质量 PASS  
2. Phase3 在高 fallback 比例下做 Path Vote，domain 信号被稀释（fallback 不投票 — 符合 Contract，但句子覆盖靠 fallback）  
3. 同成本多 fallback 解被 DP 省略 → 少部分 boundaryKey 不可见  
4. 误把 HARD_BLOCK 全算成词库问题  

---

## 25. Target List

| Target | Status |
|--------|--------|
| 环境判定（首要 10 问） | DONE |
| 独立 node-runtime 证据目录 | DONE |
| Offline vs Node 对照 | DONE |
| Fallback 原因分类 | DONE |
| Cap 压力测试 | DONE |
| Min-fallback 交替分析 | DONE |
| 全量相关 Jest | DONE（29/262） |
| tsc build | DONE |
| Contract 1.0.2 正文 | **PENDING（下轮文档）** |
| Phase 2 Acceptance | **BLOCKED until CONDITIONAL 解除** |

---

## 26. Check List

- [x] 上一轮是否真实词库 Recall — **是（C）**  
- [x] 200/200 fallback 根因 — **NO（非未启动节点）**  
- [x] Fallback 原因分布 — 完成  
- [x] lexical-only vs fallback-assisted — 完成  
- [x] Cap / comparator / determinism — 完成  
- [x] Production isolation — 完成  
- [x] Code vs report — 完成  
- [ ] Contract 1.0.2 — **未写（本轮禁止擅自改冻结正文，仅建议）**  
- [ ] Phase 2 Acceptance — **未开始**  

---

## 27. Final Decision

```text
PHASE 2 CODE VERIFICATION: CONDITIONAL PASS
REQUIRES CONTRACT / TEST EVIDENCE FIX
```

### 对“未启动节点”假说

```text
ROOT CAUSE OF 200/200 FALLBACK:
NOT "offline without lexicon / mock recall"

ACTUAL ROOT CAUSE DISTRIBUTION:
- NO_LEXICON_HIT ≈ 75%
- HARD_BLOCKED_WINDOW ≈ 20%
- UNKNOWN (dead-end lexical / residual) ≈ 5%

MODULES:
- Lexicon coverage / Recall hits (primary)
- Hard-block window filter (secondary)
- Path/Fallback algorithm behaving as Contracted (enabler, not defect)
```

### 下一步（不得跳入 Phase 3）

1. 落地 **Implementation Contract Change Record 1.0.2**（Decision/Data 澄清）  
2. 起草 **Phase 2 Acceptance Contract CURRENT**（含 fallback 质量门槛）  
3. Acceptance 通过后再进入 Phase 3 Pre-Dev Audit  

---

*Verification did not modify Window/Recall/Evidence/Enumerator/Fallback/Materializer/Vote/Assembly/KenLM/Orchestrator/SQLite schema.*
