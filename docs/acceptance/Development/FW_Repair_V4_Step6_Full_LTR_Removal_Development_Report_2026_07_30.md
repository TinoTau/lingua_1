<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Development/FW_Repair_V4_Step6_Full_LTR_Removal_Development_Report_2026_07_30.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Step 6 Full LTR Removal and Legacy Test Cleanup Development Report

| Field | Value |
|------|-------|
| Status | **STEP6_PASS** |
| Date | **2026-07-30** |
| Stage | Step 6 / 7 |
| Authority | Runtime SSOT Contract V1.2 · Multi-Path Lexical Lattice Architecture V1.0.0 · Tone Evidence / Mapping Contract V1.0 |
| Scope | Physical LTR deletion · test rewrite · Acceptance whitelist removal · Cross-Bucket helper deletion · SSOT/index cleanup |
| Forbidden this round | Algorithm changes (Vote / Path / Cap / KenLM / Tone) |

---

## 1. Executive Summary

本轮从仓库**彻底删除** LTR Fine Span 旧链路（源码、专属测试、helper、Acceptance 白名单、生产/测试 import），并将 Coordinate / Window 测试改为 Lattice Ownership。

- `ltr-fine-span-generator.ts` / `.test.ts` 已物理删除；
- `mergeCrossBucketSentenceCandidates` 已删除（仅剩 Cross-Path first-wins Owner）；
- Acceptance 无 LTR 白名单；`electron_node` 源码/测试/脚本对禁止符号扫描为 **0**；
- dialog_200：**200/200**，`legacyModuleAbsent=true`，Legacy Trace=0；
- build / accept / freeze 全部通过。

**最终结论：`STEP6_PASS`**

---

## 2. Pre-Delete Repository Scan

扫描模式：

```text
runLtrFineSpanGeneration|ltr-fine-span-generator|generateLocalOptionsAtCursor|
commitBestFormalFineSpan|LtrFineSpan|ltr_soft_boundary|ltr_fine_span|
ltr.formalSpans|ltr.trace|fallbackToLtr|shadowLtr
```

| 文件 | 符号 | 用途 | 动作 | 处理后 |
|---|---|---|---|---|
| `ltr-fine-span-generator.ts` | 全部 LTR API | 旧 Fine Span 生成器 | DELETE_SOURCE | 文件不存在 |
| `ltr-fine-span-generator.test.ts` | LTR tests | 专属测试 | DELETE_TEST | 文件不存在 |
| `phase0-coordinate-ssot.test.ts` | generateLocal… / runLtr… | Coordinate + LTR complete | REWRITE_TEST_TO_LATTICE | Lattice + fallback edges |
| `phase1-window-edge-harness.test.ts` | generateLocalOptionsAtCursor | blockedFilter 用例 | REWRITE_TEST_TO_LATTICE | buildLexicalWindowQueries |
| `span-assembly-v4-orchestrator.step3.test.ts` | jest.mock LTR | 负向隔离 | REMOVE_IMPORT / REWRITE | 无 LTR mock |
| `lattice/phase2/merge` 测试 | 负向字符串 | 静态禁令 | REWRITE | 分片 ban token |
| `types.ts` `ltr_fine_span` | signal union | 历史 signal | REMOVE | 仅 `path_fine_span` |
| `runtime-ssot-acceptance.cjs` | whitelist | Step5 临时白名单 | REMOVE_ACCEPTANCE_WHITELIST | 全量扫描 0 |
| `build-sentence-candidates.ts` | mergeCrossBucket… | TEST_ONLY higher-score | DELETE_SOURCE | 已删 |
| SoftBoundary / LTR audits | 文档 | 历史权威 | HISTORICAL_DOCUMENT | SUPERSEDED banner |
| Step3–5 probes 中 patch LTR | audit scratch | 计数器 | HISTORICAL（docs） | Step6 新 probe 不依赖 |
| `ltrRuntimeEnabled: false` | compliance | 负向合同 | KEEP | 允许保留 |

---

## 3. Deleted Source Files

| File | Status |
|---|---|
| `electron_node/.../span-assembly-v4/ltr-fine-span-generator.ts` | **DELETED** |
| `electron_node/.../span-assembly-v4/ltr-fine-span-generator.test.ts` | **DELETED** |

无空文件、rename、deprecated/、stub、re-export。

---

## 4. Deleted LTR Types and Symbols

已随 generator 删除（未迁移到任何 compat/legacy/shared 类型文件）：

```text
LtrFineSpanGenerationInput / Result
LtrFineSpanStepTrace / Option / OptionTrace / Trace
LtrFineSpanOption ranking helpers
commitBestFormalFineSpan / runLtrFineSpanCommit
generateLocalOptionsAtCursor / buildLtrOptionWindows
runLtrFineSpanGeneration
```

`FwDetectorSignal` 移除 `ltr_fine_span`。

---

## 5. Deleted Tests

- 全部 `ltr-fine-span-generator.test.ts`（cursor / unique commit / option ranking / tiebreak）。
- 未将这些行为迁移为 Lattice 测试。

---

## 6. Rewritten Coordinate Tests

`phase0-coordinate-ssot.test.ts`：

- 保留：raw/syllable Coordinate SSOT、Latin gap raw mapping；
- Latin gap hard-block：改为 `buildLexicalWindowQueries` + `latticeHardBlockFilter`；
- 覆盖用例：改为 `runLatticeFineSpanGenerationFromLexicalEdges`（空 LexicalEdge → 生产 fallback 注入 → PathFineSpan 覆盖 / half-open / 无重叠）。

---

## 7. Rewritten Window / Edge Tests

`phase1-window-edge-harness.test.ts`：

- 删除 `generateLocalOptionsAtCursor`；
- `boundary_cross_count` 用例改为 `buildLexicalWindowQueries` + 既有 `blockedFilter` 合同。

---

## 8. Harness Cleanup

| Item | Action |
|---|---|
| phase1/phase2 `productionCutover` | **REMOVED** |
| phase2 header “production continues to use LTR” | **REMOVED** |
| Dependency | harness → lattice-fine-span-runtime only（未反向） |
| LTR comparison / shadow / winner reference | **ABSENT** |

---

## 9. Legacy Cross-Bucket Helper Decision

**DELETE（最终）**

理由：

- 生产 orchestrator 不调用；
- 仅旧测试使用；
- higher-score retention 与 Cross-Path first-wins SSOT 冲突；
- 无独立 Path-local 正式 Ownership。

处理：删除实现 + 测试改为 `mergeCrossPathSentenceCandidates` + SSOT/supporting docs 更新。

---

## 10. Acceptance Whitelist Removal

`runtime-ssot-acceptance.cjs`：

- 删除文件级 LTR 白名单；
- 对 `main/src/fw-detector` + `scripts` + `tests` 做禁止符号全量扫描；
- 禁止符号以分片拼接构造，避免扫描自命中；
- 结果：`STATIC_SCAN_OK { whitelist: [] }`。

---

## 11. Package / Build / Export Cleanup

| Check | Result |
|---|---|
| package.json 指向 LTR 文件 | 无 |
| barrel / export LTR | 无 |
| dist 无 `ltr-fine-span-generator.js` | 确认（dialog_200 `legacyModuleAbsent=true`） |
| Jest / tsconfig 失效路径 | 无 |

---

## 12. Runtime SSOT File Consolidation

`find docs -iname "Runtime_SSOT*"`：

| File | Classification |
|---|---|
| `Runtime_SSOT_Contract_Freeze.md` | **KEEP_SOLE_AUTHORITY (V1.2)** |
| `Runtime_SSOT_Freeze_Readiness_Development_Report.md` | Execution Record（非 Freeze） |
| `Runtime_SSOT_Recovery_Baseline_Audit.md` | Accepted Audit |
| `Runtime_SSOT_Recovery_Report.md` | Execution Record |

无 `Final` / `Latest` / `(2)` / `(7)` 平行冻结文件。

---

## 13. Historical Document Classification

已在文首标记：

```text
HISTORICAL / SUPERSEDED BY MULTI-PATH LEXICAL LATTICE / NOT RUNTIME AUTHORITY
```

覆盖 SoftBoundary 系列 + LTR necessity/readiness audits。

`RUNTIME_DOMAIN_DOCUMENT_INDEX.md`：

- Fine Span production → **MULTI_PATH_LEXICAL_LATTICE**；
- LTR necessity → Historical / Superseded；
- SoftBoundary → Historical 表。

未改写历史结论正文。

---

## 14. Post-Delete Static Scan

在 `electron_node` / `tests` / `scripts` / `package.json`：

```text
banned pattern hits = 0
*ltr* under main/src = 0 files
```

允许保留：`ltrRuntimeEnabled: false`（负向合同）。

`*softboundary*` 仅存于 docs 历史报告（已 SUPERSEDED）。

---

## 15. Modified Files（主要）

- 删除：`ltr-fine-span-generator.ts` / `.test.ts`
- 重写：`phase0-coordinate-ssot.test.ts`、`phase1-window-edge-harness.test.ts`、`span-assembly-v4-orchestrator.step3.test.ts`
- 清理：phase1/2 harness、`types.ts`、相关负向测试、`build-sentence-candidates.ts`
- 测试迁移：`fine-span-domain-presence-vote.test.ts`、`domain-presence-vote-acceptance.test.ts` → Cross-Path merge
- Acceptance：`runtime-ssot-acceptance.cjs`、`freeze-contract.test.ts`
- Docs：`Runtime_SSOT_Contract_Freeze.md`、`RUNTIME_DOMAIN_DOCUMENT_INDEX.md`、SoftBoundary/LTR banners、assembly/kenlm supporting refs
- Probe：`step6-ltr-removal-dialog200-probe.mjs`

---

## 16. Tests Executed

```text
build:main
freeze-contract + Lattice/Path/Phase0/Phase1/Phase2/Merge/Vote/Assembly/Orchestrator/P5/Kenlm suites
（209+ 相关用例 PASS）
```

---

## 17. Acceptance Results

| Command | Result |
|---|---|
| `npm run accept:runtime-ssot` | **ACCEPTANCE_PASS**（零白名单扫描） |
| `npm run accept:domain-multibucket-kenlm` | **ACCEPTANCE_PASS**（WSL 预热后 ACTIVE） |

---

## 18. dialog_200 Results

Probe：`docs/tone-v2/_audit_scratch/step6-ltr-removal-dialog200-probe.mjs`  
Summary：`step6_ltr_removal/dialog_200_summary.json`

| Metric | Value |
|---|---|
| casesTotal | 200 |
| orchestratorSuccess | **200** |
| orchestratorFailure | **0** |
| latticeTracePresent | 200 |
| pathAssemblyTracePresent | 200 |
| crossPathTracePresent | 200 |
| kenlmInputOver16 | **0** |
| duplicateKenlmText | **0** |
| undefinedPrefilledCombinations | **0** |
| legacyTraceFieldCount | **0** |
| legacyModuleAbsent | **true** |
| hardGatePass | **true** |

未再 patch LTR 函数（模块已不存在）。

---

## 19. Algorithm Behavior Comparison

本轮仅删除旧链与清理依赖。未修改：

```text
Window / Recall / Edge / fallback / Path cap / Vote / 0.75 /
Bucket / Assembly / first-wins / global 16 / KenLM / Tone overlap
```

dialog_200 Trace/KenLM 边界与 Step 5 一致（≤16、无重复、无 undefined prefilled）。

---

## 20. Remaining Legacy References

| Item | Status |
|---|---|
| SoftBoundary / LTR 历史 docs | HISTORICAL only |
| Step3–5 audit probes（docs） | 历史产物；Step6 使用新 probe |
| `offline-ltr-perf-probe.mjs`（archived） | historical archive 文件名；非运行时 |
| `ltrRuntimeEnabled: false` | 唯一允许负向合同字段 |

生产 / 测试 / 脚本：**无** adapter、stub、deprecated wrapper、fallback-to-LTR、shadow、feature flag。

---

## 21. Target List Completion

| ID | Status |
|---|---|
| T1 全仓审计 | DONE |
| T2 物理删除 generator | DONE |
| T3 删除 LTR 专属测试 | DONE |
| T4 Coordinate/Window 重写 | DONE |
| T5 Harness 清理 | DONE |
| T6 Cross-Bucket helper | DELETED |
| T7 Acceptance 白名单 | REMOVED |
| T8 package/export | DONE |
| T9 唯一 Runtime SSOT | DONE |
| T10 历史文档 SUPERSEDED | DONE |
| T11 零残留扫描 | DONE |
| T12 build/accept/dialog_200 | DONE |

---

## 22. Check List Completion

- [x] 全仓 LTR 引用表
- [x] 删除 generator / test / 类型 / helper / imports / exports
- [x] phase0 / phase1 重写
- [x] Harness 无 LTR comparison
- [x] 无 adapter / stub / fallback / shadow
- [x] Acceptance 白名单删除；扫描 0
- [x] mergeCrossBucket 已删除
- [x] Runtime SSOT 唯一
- [x] 历史文档 SUPERSEDED
- [x] build / accept / freeze / Lattice 链测试通过
- [x] dialog_200 200/200；Legacy Trace 0；KenLM ≤16 无重复
- [x] 冻结算法未改

---

## 23. Final Verdict

```text
STEP6_PASS
```

LTR generator、类型、测试、helper、import、export、Acceptance 白名单均已彻底删除；无 adapter/stub/deprecated/fallback/shadow/feature flag；Coordinate/Window 测试属 Lattice Ownership；正式 Runtime SSOT 唯一；build、Acceptance、Freeze、dialog_200 全部通过；生产算法行为未改变。
