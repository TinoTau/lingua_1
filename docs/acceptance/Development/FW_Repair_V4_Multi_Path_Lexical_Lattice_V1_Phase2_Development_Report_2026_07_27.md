<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Development/FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Phase2_Development_Report_2026_07_27.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Multi-Path Lexical Lattice V1 · Phase 2 Development Report

| Field | Value |
|-------|-------|
| Date | 2026-07-27 |
| Nature | **Phase 2 Development** |
| Authority | Architecture V1.0.0 FROZEN · Implementation Contract V1.0.0 (+ Change Record **1.0.1**) · Phase 2 Pre-Development Audit |
| Final Decision | **PHASE 2 IMPLEMENTATION COMPLETE** · **READY FOR PHASE 2 CODE VERIFICATION** |

---

## 1. Executive Summary

本轮实现了 Phase 2 交付链（harness / offline only）：

```text
LexicalEdge[]
  → injectFallbackEdges (gap-minimal, length=1)
  → enumerateCompleteSegmentationPaths (bounded, deterministic)
  → SegmentationPath[]
  → materializeFormalFineSpans
  → PathFineSpanView[]
```

| 项 | 结果 |
|----|------|
| Unit tests (Phase 2 + Phase 1 regression subset) | **8 suites / 57 PASS** |
| dialog_200 offline probe | **200 completed / 0 failed** |
| Production orchestrator | **未改行为**（仍调用 LTR） |
| Dual chain / feature flag / shadow | **无** |
| Phase 1 Window/Recall/Evidence 语义 | **未改** |

```text
PHASE 2 IMPLEMENTATION COMPLETE
READY FOR PHASE 2 CODE VERIFICATION
```

**未宣布：** Production Cutover Complete / LTR Ownership Removed / Ready for Phase 3 Production。

---

## 2. Contract Change Record

Implementation Contract §0 新增：

| Version | Date | Change |
|---------|------|--------|
| **1.0.1** | 2026-07-27 | Phase boundary clarification：Phase 2 可实现并验收 Path 模块（harness/offline only）。生产 LTR → SegmentationPath cutover 必须与 Phase 3 首个 Path-aware downstream 原子切换；此前禁止 shadow / feature flag / dual chain。 |

- 未静默覆盖 1.0.0 正文规则  
- 未改变 Architecture 主方向  

---

## 3. Scope

### In

- DTO：`SegmentationPath` / `PathFineSpanView` / `PrunedSegmentationPathTrace` / `PathCapEvent`
- `boundaryKey` / `pathId` 确定性身份
- Fallback Edge 注入（Contract §6）
- Bounded Complete Segmentation Path Enumeration + structural prune
- `PathFineSpanView` materializer
- Phase 2 harness + unit tests + dialog_200 probe
- Probe caps in `V4_LIMITS`
- Fact-only Path diagnostics fields

### Out

- Domain Vote / SameDomain Assembly  
- CompatibilityGraph KEEP/DELETE  
- KenLM / Global ≤16  
- Production orchestrator 接入 Path  
- LTR 文件物理删除  
- Feature flag / shadow dual chain  

---

## 4. Files Changed

### NEW

| File |
|------|
| `span-assembly-v4/lattice-path-types.ts` |
| `span-assembly-v4/build-boundary-key.ts` |
| `span-assembly-v4/build-boundary-key.test.ts` |
| `span-assembly-v4/inject-fallback-edges.ts` |
| `span-assembly-v4/inject-fallback-edges.test.ts` |
| `span-assembly-v4/enumerate-complete-segmentation-paths.ts` |
| `span-assembly-v4/enumerate-complete-segmentation-paths.test.ts` |
| `span-assembly-v4/materialize-formal-fine-spans.ts` |
| `span-assembly-v4/materialize-formal-fine-spans.test.ts` |
| `span-assembly-v4/phase2-path-harness.ts` |
| `span-assembly-v4/phase2-path-harness.test.ts` |
| `docs/tone-v2/_audit_scratch/phase2-path-dialog200-probe.mjs` |
| `docs/tone-v2/_audit_scratch/lattice_v1_phase2/dialog_200_phase2_summary.json` |
| `docs/tone-v2/_audit_scratch/lattice_v1_phase2/dialog_200_phase2_results.jsonl` |

### LIMITED MODIFY

| File | Change |
|------|--------|
| Implementation Contract | Change Record **1.0.1** only |
| `build-lexical-edges.ts` | `edgeKind: 'lexical' \| 'fallback'` |
| `v4-limits.ts` | probe `maxActivePathsPerPosition=8`, `maxCompleteSegmentationPaths=8` |
| `domain-context-contract.ts` | `FineSpanSelectionReason` += `'lattice_path_edge'` |
| `v4-diagnostics-types.ts` | optional Path fact fields |
| `v4-diagnostics-trace.ts` | optional push helpers（未接生产决策） |

### UNCHANGED (production behavior)

| File |
|------|
| `span-assembly-v4-orchestrator.ts` |
| `ltr-fine-span-generator.ts` |
| `recall-topk-for-windows.ts` |
| `build-lexical-window-queries.ts` |
| Vote / Assembly / Compatibility / KenLM / SQLite |

---

## 5. DTO Implementation

见 `lattice-path-types.ts`：与 Implementation Contract §4.3 / §4.6 / §8.4 对齐。

---

## 6. Boundary Identity

```text
boundaryKey = "${start}-${end}|..."   # sorted contiguous edgeRefs
pathId      = sha256(boundaryKey).hex  # full 64-char hex, fixed length
```

实现：`build-boundary-key.ts`  
禁止 UUID / 时间戳 / random / Map 顺序依赖。

---

## 7. Enumeration Algorithm

`enumerateCompleteSegmentationPaths`：

1. `validateLexicalEdgeGraph` — 非法边 / 重复 boundary throw  
2. 隐式 DAG：`Map<pos, LexicalEdge[]>`；outgoing 稳定排序：`end ASC → lexical before fallback → edgeId ASC`  
3. 按位置扩展 partial paths（active paths ending at position）  
4. per-position cap：best-first 保留  
5. complete-path cap：best-first 保留  
6. 同一 `boundaryKey` 仅一条 Path；Candidate 不扩 Path  

**Comparator 语义（best-first，负值 = a 更优）：**

```text
fallback ASC → invalidGap(=fallback) ASC → fuzzy ASC → parent ASC
→ toneRelaxed ASC → exact DESC → lexical DESC → boundaryKey ASC
```

---

## 8. Fallback Injection

`injectFallbackEdges` 四步：

1. lexical-only 可达性 BFS  
2. 若可达 → 零注入  
3. 否则 0-1 DP（lexical cost=0，fallback i→i+1 cost=1）求最小 fallback 集合 + 确定性 parent 决破  
4. 仅注入 length=1 fallback；`candidates=[]`；无 domain / 无假 termId  

禁止无条件每音节注入。

---

## 9. Resource Caps

`V4_LIMITS`：

```text
maxActivePathsPerPosition = 8      # PROBE — NOT FINAL
maxCompleteSegmentationPaths = 8   # PROBE — NOT FINAL
```

无 cap 时全部合法 `boundaryKey` 保留。

---

## 10. Deterministic Pruning

仅结构 + Recall evidence；禁止 Domain / Assembly / KenLM / LLM。  
输入 Edge 乱序 → 输出一致（unit 覆盖）。

---

## 11. PathFineSpanView

`materializeFormalFineSpans(path, coordinate)`：

- 每 Edge → 一个 FormalFineSpan adapter slot  
- `selectionReason = 'lattice_path_edge'`（非 LTR commit 语义）  
- fallback → `windowSource: 'fallback'`  
- **candidates 引用共享**（`===` 断言）  

---

## 12. Candidate Reference Sharing

Unit + dialog_200 probe 均检查：

```text
view.formalFineSpans[i].candidates === path.edgeRefs[i].candidates
```

dialog_200：`candidateReferenceCopyViolations = 0`

---

## 13. Diagnostics

`SpanAssemblyV4TraceDiagnostics` 增加 optional fact-only：

- `pathEnumerationFacts`  
- `pathCapEvents`  
- `pathFacts`  

Collector 提供 push helpers；**生产 orchestrator 未调用**；不反向影响枚举。

---

## 14. Unit Tests

| Suite | Focus |
|-------|-------|
| `build-boundary-key.test.ts` | 稳定 / 唯一 / 断裂 throw |
| `inject-fallback-edges.test.ts` | 零注入 / 单点 / 连续三点 gap |
| `enumerate-complete-segmentation-paths.test.ts` | 多路径 / 乱序 / caps / 非法边 |
| `materialize-formal-fine-spans.test.ts` | 坐标 / 引用共享 / lattice reason |
| `phase2-path-harness.test.ts` | 管线 + isolation（orch 仍 LTR） |
| Phase 1 regression subset | residual / b1 / phase1 harness |

```text
8 suites / 57 PASS
```

---

## 15. dialog_200 Results

证据：

- `docs/tone-v2/_audit_scratch/lattice_v1_phase2/dialog_200_phase2_summary.json`  
- `docs/tone-v2/_audit_scratch/lattice_v1_phase2/dialog_200_phase2_results.jsonl`  

| Metric | Value |
|--------|-------|
| completed | **200** |
| failed | **0** |
| utterances needing fallback | **200**（全部；lexical-only 全覆盖在真实语料上极少） |
| zero complete paths after fallback | **0** |
| capTriggeredCases | **0** |
| perPositionCapTriggered | **0** |
| completeCapTriggered | **0** |
| uniqueBoundaryKeyViolations | **0** |
| unstablePathIdViolations | **0** |
| candidateReferenceCopyViolations | **0** |
| retainedPathCount distribution | `1→172`, `2→20`, `4→8` |
| fallbackInjectionCount | min 5 / p50 9 / p95 17 / max 20 / sum 2042 |

**解释：** dialog_200 的 LexicalEdge 图普遍存在不可达 gap（硬阻窗口 / 无命中音节），因此每条都触发 gap-minimal fallback；注入后均能形成 ≥1 完整 Path。路径分支很少，故 PROBE cap=8 未触发——符合「无 cap 时全保留」语义。

---

## 16. Performance Results

| Metric | Value |
|--------|-------|
| latency p50 | ~87.6 ms（含 Phase1 harness Recall） |
| latency p95 | ~154 ms |
| latency p99 | ~196 ms |
| total wall | ~18.9 s / 200 |
| heap delta | recorded in summary |

未恢复 Recall attempt gate / Domain-KenLM prune / 单路径贪心。

---

## 17. Production Isolation

| Check | Result |
|-------|--------|
| orchestrator 是否变化 | **否**（仍 `runLtrFineSpanGeneration`） |
| LTR + Lattice 双执行 | **否** |
| feature flag | **否** |
| Domain/Vote/Assembly/KenLM 调用（Phase2 harness） | **否** |
| Phase 1 冻结语义修改 | **否**（仅 `edgeKind` 联合类型扩展） |

---

## 18. Phase 1 Regression

```text
phase1-window-edge-harness.test / b1-recall-full-traversal / residual-cleanup → PASS
```

---

## 19. KEEP

- Phase 1 Window / Recall / Evidence / harness  
- LTR 生产路径与文件  
- CompatibilityGraph / Vote / Assembly / KenLM / SQLite  

## 20. MODIFY

- Contract Change Record 1.0.1  
- `edgeKind` union  
- probe caps  
- `lattice_path_edge` selection reason  
- diagnostics fact fields  

## 21. NEW

- 全部 Path 模块 + tests + dialog_200 probe/archives  

## 22. DELETE

- **本轮无删除**（LTR / generateGlobalWindows 保留至后期 cleanup）  

---

## 23. Remaining Risks

1. **dialog_200 全量 fallback 依赖** — 真实 Edge 图稀疏；Phase 3 Vote 前需评估 fallback 过多对 domain 的稀释（fallback 不投票，已符合 Contract）。  
2. **最小 gap DP 只注入一条 min-cost fallback 集合** — 同成本多解时确定性择一；可能损失另一组同成本 boundaryKeys（Architecture “minimal gaps” 允许）。  
3. **生产仍 LTR** — Phase 3 必须原子切换，禁止半接入。  
4. **PROBE caps 未在 dialog_200 触发** — 需人工稠密图 / 更低 cap 的专项压力测试（unit 已覆盖 cap 逻辑）。  

---

## 24. Target List Completion

| Target | Status |
|--------|--------|
| lattice-path-types.ts | DONE |
| build-boundary-key.ts (+test) | DONE |
| inject-fallback-edges.ts (+test) | DONE |
| enumerate-complete-segmentation-paths.ts (+test) | DONE |
| materialize-formal-fine-spans.ts (+test) | DONE |
| phase2-path-harness.ts (+test) | DONE |
| phase2-path-dialog200-probe.mjs | DONE |
| v4-limits / diagnostics LIMITED | DONE |
| Contract 1.0.1 | DONE |
| Orchestrator cutover | **DEFERRED**（按 1.0.1 原子性澄清） |

---

## 25. Check List Completion

### Contract

- [x] Change Record 1.0.1  
- [x] 未静默覆盖 1.0.0  
- [x] Architecture 主方向不变  

### Path / Enum / Fallback / View / Isolation / Verification

- [x] 全部计划清单项（见上文测试与 dialog_200）  
- [x] deterministic replay PASS  
- [x] 无生产双链路  

---

## 26. Final Decision

```text
PHASE 2 IMPLEMENTATION COMPLETE
READY FOR PHASE 2 CODE VERIFICATION
```

### Explicit non-claims

```text
Production Cutover Complete — NO
LTR Ownership Removed — NO
Ready for Phase 3 Production — NO (needs Phase 2 Code Verification + Phase 3 Path-aware downstream + atomic cutover)
```

---

## Appendix — git / isolation answers (required)

| Question | Answer |
|----------|--------|
| git diff 范围 | NEW Path 模块 + LIMITED types/limits/diagnostics + Contract 1.0.1 + audit_scratch Phase2 outputs；**不含** orchestrator / LTR / Recall 语义 / Vote / Assembly / KenLM |
| 生产 orchestrator 是否变化 | **否** |
| LTR + Lattice 双执行 | **否** |
| 是否调用 Domain/Vote/Assembly/KenLM | **否**（Phase 2 harness） |
| 是否修改 Phase 1 冻结代码语义 | **否**（仅类型允许 fallback；builder 仍只产 lexical） |
