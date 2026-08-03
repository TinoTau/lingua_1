<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Regression/FW_Repair_V4_Step7_Final_Lattice_Freeze_and_Full_Acceptance_Report_2026_07_30.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# FW Repair V4 — Step 7 Final Lattice Freeze and Full Acceptance Report

| 字段 | 值 |
|------|-----|
| Date | 2026-07-30 |
| Phase | Step 7 / 7 — Final Freeze · Full Acceptance · Baseline Closure |
| Nature | **验收与冻结**（禁止算法 / 阈值 / 质量修复） |
| Final Verdict | **STEP7_FINAL_FREEZE_PASS** |

---

## 1. Executive Summary

Multi-Path Lexical Lattice 已确认为唯一生产 Fine Span 主链；LTR 活动源码 / 模块 / 恢复入口为 0；`ltrRuntimeEnabled` 按 **DELETE_RETIRED_CONCEPT** 删除；Runtime SSOT V1.2、Lattice Architecture V1.0.0、Tone Evidence/Mapping V1.0 各自唯一；正式 Acceptance 仅保留两条且全部通过；dialog_200 真实生产 orchestrator **200/200** 硬门通过；clean build 后无 orphan LTR artifact。本轮未修改 Vote / Assembly / Path / Recall / KenLM / Tone 算法或质量数据。

---

## 2. Final Verdict

```text
STEP7_FINAL_FREEZE_PASS
```

满足：

* 唯一生产主链 = Multi-Path Lexical Lattice  
* LTR 活动残留 = 0  
* Runtime / Path / Vote / Assembly / Merge / KenLM / Tone 与唯一 SSOT 一致  
* Acceptance + Freeze tests + clean build + dialog_200 全部通过  
* 无 orphan legacy artifact  
* 无算法 / 阈值 / 质量数据修改  
* 唯一 Baseline Manifest 已写入既有 `docs/fw-detector/freeze/FROZEN.md` §6A  

---

## 3. Final Production Architecture

```text
UtteranceSyllableCoordinate
→ LexicalWindowQuery (1..5)
→ Recall
→ LexicalEdge[]
→ fallback coverage
→ SegmentationPath[]
→ PathFineSpanView[]

for each SegmentationPath:
  → Tone rebind (acousticToneSlices)
  → FineSpan Domain Presence Vote
  → retainedDomains
  → SameDomain Buckets + Base
  → bounded sentence generation

PathAssemblyResult[]
→ mergeCrossPathSentenceCandidates
→ exact-text first-wins dedup
→ global ≤16
→ prefilledCombinations
→ runFwSentenceRerankFromPrefilled
→ raw_log_delta decision
```

**入口：** `runFwDetectorOrchestrator` → `runFwDetectorV4Path` → `runSpanAssemblyV4Orchestrator` → `runLatticeFineSpanGeneration`

---

## 4. Actual Dependency Graph

| 节点 | 依赖 | 标注 |
|------|------|------|
| `fw-detector-orchestrator` | `runFwDetectorV4Path` | PRODUCTION |
| `fw-detector-v4-path` | `runSpanAssemblyV4Orchestrator` · `runFwSentenceRerankFromPrefilled` | PRODUCTION |
| `span-assembly-v4-orchestrator` | `runLatticeFineSpanGeneration` · per-path Vote/Assembly · `mergeCrossPathSentenceCandidates` | PRODUCTION |
| `lattice-fine-span-runtime` | window · recall · edge · fallback · enumerate · materialize | PRODUCTION |
| `build-lexical-window-queries` / `window-construction-core` | coordinate | PRODUCTION |
| Recall / LexiconRuntime | SQLite lexicon | PRODUCTION |
| edge generation / fallback injection | lattice runtime | PRODUCTION |
| `enumerateCompleteSegmentationPaths` | edges + V4_LIMITS caps | PRODUCTION |
| `materializePathFineSpans` | path + coordinate | PRODUCTION |
| `rebindToneForFineSpan` / tone-time-align | `ctx.acousticToneSlices` | PRODUCTION |
| `voteUtteranceDomainFromPool` | PathFineSpan pool | PRODUCTION |
| `runDomainAwareAssembly` | vote + buckets + Base | PRODUCTION |
| `buildSentenceCandidates` | path-local bucket grids | PRODUCTION |
| `mergeCrossPathSentenceCandidates` | PathAssemblyResult[] | PRODUCTION |
| `runFwSentenceRerankFromPrefilled` | required `prefilledCombinations` | PRODUCTION |
| `phase2-path-harness` | wraps lattice entry | HARNESS |
| `_audit_scratch/*probe*` | dialog_200 / Step probes | AUDIT_SCRATCH |
| Acceptance scripts | orchestrator / smoke | ACCEPTANCE |
| Jest suites | unit / contract | TEST |
| SoftBoundary / LTR docs | — | HISTORICAL |

**生产依赖方向验证：** Runtime 源码不 import Harness / Audit Scratch / Test Fixture / Historical LTR module。`phase2-path-harness` 仅被测试/诊断使用，不被 `fw-detector-v4-path` / 生产 orchestrator 引用。

---

## 5. Unique Implementation Audit

| 能力 | 正式唯一实现 | 其它 | 判定 |
|------|--------------|------|------|
| Fine Span generator | `runLatticeFineSpanGeneration` (+ `FromLexicalEdges`) | harness wrapper | 唯一生产 |
| Path enumerator | `enumerateCompleteSegmentationPaths` | `enumerateIntervalPaths` in `build-sentence-candidates`（句候选区间路径，非 Fine Span Path） | 非重复 Fine Span |
| Domain Vote | `voteUtteranceDomainFromPool` | 无 `voteUtteranceDomain(` export | 唯一 |
| Assembly formal path | `runDomainAwareAssembly` | helpers in same module | 唯一 |
| Cross-Path merge | `mergeCrossPathSentenceCandidates` | `mergeCrossBucket*` 已删 | 唯一 |
| KenLM pool builder | Cross-Path merge → `prefilledCombinations` | `buildSentenceCandidates` 仅 Path-local；rerank 禁止 undefined rebuild | 唯一全局 pool |
| Tone evidence mapper | tone-time-align / `rebindToneForFineSpan` · SSOT=`acousticToneSlices` | — | 唯一 |

**无 duplicate production implementation。**

---

## 6. LTR Zero-Residual Verification

活动代码扫描（`electron_node/.../main/src/fw-detector` 及正式 tests/scripts）：

```text
runLtrFineSpanGeneration | ltr-fine-span-generator | generateLocalOptionsAtCursor |
commitBestFormalFineSpan | LtrFineSpan | ltr_soft_boundary | ltr_fine_span |
fallbackToLtr | shadowLtr | ltrRuntimeEnabled
→ 0 matches
```

文件名 `*ltr*` / `*softboundary*`（活动 main/tests/scripts，排除 venv）：**0**

clean build 后 `dist/**/ltr-fine-span-generator.js`：**不存在**（`legacyModuleAbsent=true`）

历史文档允许存在，索引中标记 **HISTORICAL / SUPERSEDED / NOT RUNTIME AUTHORITY**。

---

## 7. ltrRuntimeEnabled Decision

| 问题 | 答案 |
|------|------|
| 1. 谁产生 | 原 `span-assembly-v4-orchestrator` `architectureCompliance` |
| 2. 谁消费 | freeze-contract 字符串断言；Acceptance 负向检查；Step5/6 audit probes |
| 3. 外部稳定接口？ | 否（内部 compliance 诊断字段） |
| 4. Acceptance 真实依赖？ | 仅断言 `!== true`；无正向语义 |
| 5. 删除影响合同？ | 否；改为静态模块不存在 + 字段不得再现 |
| 6. 保留会否让 LTR 概念存续？ | 会 |

**裁决：DELETE_RETIRED_CONCEPT**

已删除类型与运行时字段；Acceptance 改为 `ltrRuntimeEnabled_retired_field_present` 硬失败；freeze-contract 断言源码不含该字段且 LTR 模块文件不存在。未新增替代 legacy 字段。

---

## 8. Runtime Contract Acceptance

| 合同面 | 结果 |
|--------|------|
| Lattice 输入 | rawText / domainIds / LexiconRuntime / profile / coarseSpans / wordTimeSpans / acousticToneSlices / limits — 无 LTR/Harness/Commit cursor |
| Lattice 输出 | SegmentationPath[] · PathFineSpanView[] · LatticeFineSpanTrace |
| Coverage | dialog_200 `coverageFailure=0` |
| Path Assembly | per_path Vote + Assembly；fallback 不计领域票（既有合同测试） |
| Cross-Path | collect → exact-text first-wins → dedup-before-cap → global ≤16 |
| KenLM | `prefilledCombinations` required；一 case 一次 scorer；raw/candidate text only；raw_log_delta 未改 |

`accept:runtime-ssot` → **ACCEPTANCE_PASS**

---

## 9. Frozen Constants Audit

| 常量 | 值 | 唯一来源 | 分类 |
|------|-----|----------|------|
| `DOMAIN_BUCKET_RETENTION_RATIO` | 0.75 | `utterance-domain-vote.ts`（v4-limits re-export） | FROZEN |
| `maxSentenceCandidates` / global cap | 16 | `fw-config` default / Runtime SSOT | FROZEN |
| `minDeltaToReplace` | 3.0 | `fw-config` / SCORE_CONTRACT | FROZEN |
| `maxActivePathsPerPosition` | 8 | `v4-limits.ts` | **PROVISIONAL** |
| `maxCompleteSegmentationPaths` | 8 | `v4-limits.ts` | **PROVISIONAL** |
| Lattice window length | 1..5 | `LATTICE_WINDOW_*` in window-construction-core | FROZEN（Architecture） |
| Recall TopK / per-window | exactTopK=2 等 | `V4_LIMITS` / DOMAIN_RECALL | MODEL_CONFIG / FROZEN recall |
| Tone MIN_SLICE_SEC | Tone Mapping contract | tone-time-align | FROZEN |
| diagnostic `retentionRatio: 0.75` literal in v4-path | mirrors SSOT | Known hygiene（非第二 Vote 配置） | Known Risk |

验证：`0.75` Vote 公式仅一处定义；cap 16 经 `maxSentenceCandidates` 注入，非散落硬编码驱动生产 merge；Path 8/8 **未**写成冻结质量结论。

---

## 10. Acceptance Command Consolidation

`electron_node/electron-node/package.json` 正式入口仅：

```text
npm run accept:runtime-ssot
npm run accept:domain-multibucket-kenlm
```

未新增 `accept:final-lattice` / `accept:step7` / `accept:runtime-v3`。未发现 `accept:*v2|legacy|ltr|temporary|phase` 正式入口。

本轮结果：

* `accept:runtime-ssot` → PASS  
* `accept:domain-multibucket-kenlm` → **ACCEPTANCE_PASS: … (integration)**  

---

## 11. Freeze Contract Coverage

`freeze-contract.test.ts` 覆盖（行为 + 结构 + 静态）：

* Production orchestrator → Lattice  
* No LTR module file  
* Path-scoped Vote / Assembly  
* Cross-Path unique Owner · exact-text first-wins · dedup-before-cap · cap=16  
* `prefilledCombinations` required  
* No primary bucket rebuild  
* Tone SSOT = acousticToneSlices  
* Context Prior diagnostics-only  
* No Beam / Graph Vote / Domain Rerank / VoteMass  
* `ltrRuntimeEnabled` 字段禁止再现  

配套：`domain-presence-vote-acceptance` · `merge-cross-path` · `tone-time-align` 行为门。

---

## 12. Clean Build Results

```text
Remove-Item dist (via clean:main)
npm run build:main → exit 0
ORPHAN_LTR_ARTIFACTS = 0
ltr-fine-span-generator.js in dist = False
```

---

## 13. Full Test Results

| 组 | 结果 |
|----|------|
| freeze-contract / freeze-config-ssot | PASS |
| Coordinate SSOT / Window / Path / Lattice / Cap stress | PASS |
| Vote / Assembly / Cross-Path / Orchestrator Step3 | PASS |
| residual-cleanup / p5-prior / connectivity vote | PASS |
| tone-time-align（half-open / no neighbor borrow / Evidence Unavailable） | PASS |
| p5-blocking-repair | PASS |

合计本轮执行：Jest **20 suites / 238 tests PASS**（17+3 批）。

---

## 14. dialog_200 Final Results

入口：`runSpanAssemblyV4Orchestrator`（真实生产；无 mock Recall / KenLM / LTR）

Probe：`docs/tone-v2/_audit_scratch/step7-final-freeze-dialog200-probe.mjs`  
摘要：`docs/tone-v2/_audit_scratch/step7_final_freeze/dialog_200_summary.json`

| 指标 | 值 |
|------|-----|
| casesTotal | **200** |
| orchestratorSuccess | **200** |
| orchestratorFailure | **0** |
| latticeGenerationFailure | 0 |
| coverageFailure | **0** |
| materializationFailure | **0** |
| pathAssemblyFailure | **0** |
| kenlmInputOver16 | **0** |
| duplicateKenlmText | **0** |
| undefinedPrefilledCombinations | **0** |
| legacyTraceFieldCount | **0** |
| legacyModuleAbsent | **true** |
| pathCountDistribution | 1→170 · 2→21 · 4→9 |
| uniqueCandidateCountDistribution | **1→200** |
| kenlmInputCountDistribution | **1→200** |
| latency p50 / p95 / max | 66 / 109 / 152 ms |
| sqlQueryCount | NOT_OWNED_HERE（本 probe 未挂 SQLite 计数器） |
| hardGatePass | **true** |

---

## 15. KenLM Integration Acceptance

```text
REAL_KENLM_ACCEPTANCE = ACTIVE
ACCEPTANCE_PASS: domain-multibucket-kenlm (integration)
kenlmScorerSuccessRate = 1
```

**Integration Acceptance（本轮冻结）：**

* real scorer invoked  
* prefilled pool enters scorer  
* input 无 domain metadata（既有合同）  
* raw_log_delta contract intact  

**Quality Acceptance（明确不冻结）：**

```text
KENLM QUALITY STATUS = PARTIAL / NOT FROZEN
```

不得将 Top1 / Recall / dialog_200 语义准确率写成冻结通过。

---

## 16. Tone Evidence Acceptance

`tone-time-align.test.ts` Frozen half-open + Evidence Unavailable 组 **PASS**。

确认：

* `ctx.acousticToneSlices` only  
* start < end · strict half-open overlap  
* no neighboring Slice borrowing · no posterior copy · no text/pinyin synthesized Tone  
* Evidence Unavailable legal  

未因 dialog_200 Evidence Unavailable 修改 Tone。

---

## 17. Candidate Diversity Quality Observation

| 观察 | 值 |
|------|-----|
| uniqueTextsAfterDedup | **1 for all 200** |
| kenlmN | **1 for all 200** |
| crossPathInputCandidateCount | 可 >1（exact-text 重复跨 Path/Bucket） |
| pathsPerCase | 多数 1；部分 2/4 |

相对历史“before-dedup distinct=1 for all”表述：更精确地，**去重后唯一文本恒为 1**；输入计数可因重复文本 >1。

```text
这是 Quality Observation，
不属于 Architecture Freeze Failure。
```

后续独立议题：`Candidate Diversity / Assembly Quality Audit`（不得混入本轮）。

---

## 18. Runtime SSOT Alignment

* Runtime SSOT Contract **V1.2**（未创建 V1.3）  
* Compliance：`generatorMode=multi_path_lattice` · `voteScope/assemblyScope=per_path` · `candidateCapScope=global` · LTR 字段已退休  
* Context Prior 仍 diagnostics-only  

---

## 19. Document Index Closure

`RUNTIME_DOMAIN_DOCUMENT_INDEX.md` Active Authority 仅指向：

1. Multi-Path Lexical Lattice Architecture **V1.0.0**  
2. Runtime SSOT Contract **V1.2**  
3. Tone Evidence / Mapping Contract **V1.0**  

Supporting：DSU · DOMAIN_RECALL · Lexicon Domain · KENLM_RUNTIME · CONTEXT_PRIOR（从属关系明确）。

LTR / SoftBoundary **不在** Active / Current / Required / Authority / Production 栏目。

---

## 20. Historical Archive Boundary

| 规则 | 状态 |
|------|------|
| 不被生产 import | ✅ |
| 不被 package script 调用 | ✅ |
| 不被正式 Acceptance 调用 | ✅ |
| 不被 active index 引用为权威 | ✅ |
| 文首 HISTORICAL / SUPERSEDED | ✅（既有 Step6 标记） |
| Audit scratch Step3–7 probes | 保留执行记录；非正式 test 命令依赖 |

**OPTIONAL_ARCHIVE_CLEANUP：** `_audit_scratch` 大量临时 JSON/probe 可日后归档；本轮不清理以免改变运行内容。

---

## 21. Baseline Manifest

**唯一清单位置：** `docs/fw-detector/freeze/FROZEN.md` §6A（未新建 FINAL_FINAL / LATEST / Step7_SSOT）。

含：Architecture / Runtime SSOT / Tone / Production entry / Fine Span owner / Vote·Assembly scope / Cross-Path owner / Cap / KenLM input / Acceptance / Required tests / Known risks / Not-frozen quality / Removed legacy。

索引交叉引用：`RUNTIME_DOMAIN_DOCUMENT_INDEX.md` Step 7 Baseline Closure。

---

## 22. Repository Hygiene

| 检查 | 结果 |
|------|------|
| clean build orphan LTR | 0 |
| broken accept scripts | 无 |
| duplicate SSOT freeze files | 无（单一 Runtime_SSOT_Contract_Freeze.md） |
| temporary probe → production import | 无 |
| unused export 全仓清扫 | 非阻塞；OPTIONAL |
| 词库 / KenLM 模型 / dialog_200 / Tone 模型 | 本轮无非预期修改 |

本轮允许的代码变更仅：`ltrRuntimeEnabled` 删除及相关 Acceptance/freeze/文档收敛。

---

## 23. Known Risks

1. **Candidate diversity：** KenLM pool 几乎恒为 1 唯一文本（Quality Observation）。  
2. **Path caps 8/8 PROVISIONAL：** 资源保护探针值，非语言质量冻结。  
3. **diagnostic `retentionRatio: 0.75` literal**（`fw-detector-v4-path`）：与 SSOT 同值但未引用常量导出——卫生项，非第二 Vote 配置。  
4. **fallbackCaseCount=200：** 多数 case 触发 fallback edge 注入（覆盖完备性机制）；质量影响未在本轮评估。  
5. **V4_LIMITS.windowMinSyllables=2** vs Lattice **1..5**：生产 Lattice 使用 `LATTICE_WINDOW_*`；旧 V4_LIMITS 字段易混淆（文档已知独立）。  
6. **KenLM integration sample ASSEMBLY_NOT_GENERATED=1：** 集成门未失败；属质量/样本边角。  

---

## 24. Not-Frozen Quality Areas

```text
Lexicon content quality
KenLM ranking quality
Recall noise quality
dialog_200 full E2E semantic accuracy
Candidate diversity / Assembly quality
Path probe caps (8/8)
```

Functional freeze ≠ quality freeze。

---

## 25. Step 1–7 Completion Matrix

| Step | 目标 | 状态 |
|------|------|------|
| 1 | PathFineSpan Ownership 拆出 | DONE |
| 2 | Lattice Production Entry | DONE |
| 3 | Orchestrator → Lattice | DONE |
| 4 | Cross-Path Merge / Dedup / ≤16 | DONE |
| 5 | Trace / Diagnostics / Acceptance / SSOT | DONE |
| 6 | LTR 彻底删除 | DONE |
| 7 | Final Freeze / Full Acceptance / Baseline | **DONE · PASS** |

---

## 26. Target List Completion

| ID | 项 | 状态 |
|----|-----|------|
| T1 | 最终生产依赖图 | ✅ |
| T2 | 唯一主链与实现 | ✅ |
| T3 | LTR 零活动残留 | ✅ |
| T4 | ltrRuntimeEnabled DELETE | ✅ |
| T5 | Runtime 数据合同 | ✅ |
| T6 | 冻结常量审计 | ✅ |
| T7 | Acceptance 收敛 | ✅ |
| T8 | Freeze Contract 最终化 | ✅ |
| T9 | dialog_200 生产验收 | ✅ |
| T10 | 真实 KenLM 集成验收 | ✅ |
| T11 | Tone Freeze 验收 | ✅ |
| T12 | 文档索引 / 归档边界 | ✅ |
| T13 | Baseline Manifest | ✅ |
| T14 | clean build / hygiene | ✅ |
| T15 | 最终冻结报告 | ✅ |

---

## 27. Check List Completion

* [x] 最终生产依赖图已生成  
* [x] Runtime 不依赖 Harness / Audit / Test  
* [x] Fine Span / Path enumerator / Vote / Assembly / Cross-Path / KenLM pool 实现唯一  
* [x] LTR 全仓活动残留为 0  
* [x] ltrRuntimeEnabled = DELETE_RETIRED_CONCEPT  
* [x] Runtime DTO / Path coverage / per_path Vote·Assembly / fallback 不计票 / first-wins / dedup-before-cap / cap=16 / prefilled required  
* [x] KenLM 一次调用 · 无 domain metadata · raw_log_delta 未改变  
* [x] Tone acousticToneSlices · half-open · 无 fill/borrow  
* [x] 0.75 / 16 唯一来源 · Path cap PROVISIONAL  
* [x] Acceptance 无重复 · 两条正式命令均通过  
* [x] Freeze tests 通过 · dialog_200 200/200 · Legacy Trace=0 · KenLM>16=0 · Dup=0 · Undefined prefilled=0  
* [x] Active Authority 收敛 · LTR 仅 Historical · Baseline Manifest 唯一  
* [x] clean build 无 orphan · 未修改冻结算法 · Known Risks 已记录  

---

## 28. Final Freeze Statement

```text
STEP7_FINAL_FREEZE_PASS

Multi-Path Lexical Lattice 是唯一生产主链。
LTR 活动源码、测试、脚本、模块与恢复入口为 0。
Runtime / Path / Vote / Assembly / Merge / KenLM / Tone
合同全部与唯一 SSOT 一致。
Acceptance、Freeze Tests、clean build、dialog_200 全部通过。
仓库无 orphan legacy artifact。
没有任何算法、阈值或质量数据被修改。
已形成唯一可维护的冻结基线（FROZEN.md §6A）。
```

**权威引用：**

* `docs/tone-v2/FW_Repair_V4_Multi_Path_Lexical_Lattice_Architecture_V1.0.0_FROZEN.md`  
* `docs/tone-v2/Runtime_SSOT_Contract_Freeze.md`（V1.2）  
* `docs/tone-v2/FW_Repair_V4_ToneEvidence_Mapping_Final_Freeze_Report_2026_07_29.md`  
* `docs/fw-detector/freeze/FROZEN.md`（Baseline Manifest §6A）  
* `docs/tone-v2/RUNTIME_DOMAIN_DOCUMENT_INDEX.md`  

---

## Appendix A — Step 7 Allowed Code/Doc Delta

| 分类 | 文件 |
|------|------|
| MODIFIED_PRODUCTION | `v4-types.ts` · `span-assembly-v4-orchestrator.ts`（删除 `ltrRuntimeEnabled`） |
| REWRITTEN_TEST / ACCEPTANCE | `freeze-contract.test.ts` · `run-domain-multibucket-kenlm-acceptance.cjs` |
| SSOT / INDEX | `Runtime_SSOT_Contract_Freeze.md` · `RUNTIME_DOMAIN_DOCUMENT_INDEX.md` · `FROZEN.md` |
| AUDIT_SCRATCH | `step7-final-freeze-dialog200-probe.mjs` + `step7_final_freeze/*` |
| NEW_REPORT | 本文件 |

未改：词库、KenLM 模型、dialog_200 数据、Tone 模型、Vote/Assembly/Path/Recall 算法与阈值。
