# Lingua — Model3 V2 Retry → Recall Query Parity Audit

Date: 2026-09-01  
Phase: `MODEL3_V2_RETRY_RECALL_QUERY_PARITY_AUDIT`  
Mode: READ-ONLY / TEST-TRACE-ONLY / PRODUCTION-SEMANTIC CAUSAL AUDIT

================================
EXECUTIVE VERDICT
=================

| Item | Result |
|------|--------|
| **Verdict** | **`RETRY_RECALL_QUERY_PARITY_PASS_QUERY_MAPPING_PRIMARY`** |
| Historical cohort | **84** |
| Traces recovered | **84 / 84** |
| **QUERY_PARITY_PASS** | **8 / 84** |
| Boundary mismatch | **61** (26 strict `QUERY_BOUNDARY_MISMATCH` + 35 `QUERY_MULTIPLE_MISMATCHES` partial) |
| Pinyin mismatch | **0** |
| **Confirmed Recall owner** (parity-proven) | **8** (`RECALL_TARGET_MISS`) |
| Reclassified upstream (provisional 71) | **62** |
| Remaining unknown / insufficient | **1** |
| Primary first-fail (provisional 71) | **`RETRY_QUERY_BOUNDARY` — 48** |
| OLD_BOUNDARY_LOCK causal (proven) | **13** (+ 7 / 10 previously flagged reconfirmed) |
| **Next phase** | **`MODEL3_V2_RETRY_QUERY_MAPPING_CORRECTION_DESIGN_AUDIT`** |

**Headline:** 上一阶段 `LOCAL_RESEG_TRACE_AUDIT_PASS_RECALL_PRIMARY` **被推翻**。在捕获实际 `recallSpanTopKV2` 输入/输出后，**仅 8 / 71**  provisional Recall 归属经 **QUERY_PARITY_PASS** 验证仍为 **RECALL_TARGET_MISS**。**62 / 71** 移至上游：**Retry query 边界映射** 是 provisional 71 中的主因（48），**OLD_BOUNDARY_LOCK** 为次级但已证实的机制（13）。

================================
WHY PREVIOUS RECALL OWNERSHIP WAS PROVISIONAL
=============================================

上一 Trace Completeness 审计将 **65 × RECALL_TARGET_MISS** 建立在：

- `anyCandidateReturn=true`
- region 级 `recallCandidatesReturned>0`
- fallback span 与 error region 重叠

**未捕获：** 每次 `recallSpanTopKV2` 的 `windowText`、`windowPinyinKey`、`syllables`、`acousticTonePattern`、`retainedDomains` 及返回 candidate surfaces。

**反例（d007，生产 trace）：** 目标修复需 **「师傅」** 组合窗口；实际 Recall 收到 **「市」「副」「局」** 三个单字 query（`shi|fu|ju` 分拆）。Recall **确实被调用** 并返回候选，但 **QUERY_PARITY = FAIL** → 首责在上游 query exposure，非 Recall。

================================
FROZEN ARCHITECTURE
===================

- Path-local Domain Vote：**有意架构**，每 retained path 一次 vote
- Retry：**NO_RETRY_SECOND_VOTE**（84 例 trace 验证 `secondDomainVote=false`）
- `fallbackRegionLocalSpans`：**IMPLEMENTATION_DRIFT**（lattice 失败时复用 first-pass FineSpan 边界）
- 本审计 **未修改** 任何业务逻辑

================================
TRACE METHOD
============

### 新增 TEST-ONLY instrumentation（`MODEL2_DIALOG200_TRACE=1`）

| 字段 | 来源 |
|------|------|
| `windowText`, `windowPinyinKey`, `syllables` | `model3-retry-router.ts` 实际 Recall 前参数 |
| `acousticTonePattern` | owner span `toneRebindTrace` |
| `retainedDomains` | path-local vote 结果 |
| `localSpanSource` | `LATTICE` / `FALLBACK` |
| `candidates[]` | `recallSpanTopKV2` 返回 hits（surface, source, score, toneCompatible） |

写入 `dialog200_path_trace.paths[].model3.retry_recall_invocations`。**不进入 JobResult**。

### Diagnostic replay

- 标签：**DIAGNOSTIC_REPLAY**
- 84 例 historical cohort，`MODEL3_ACCEPTANCE_CAUSAL_FORK=1`
- 产物：`model3_v2_retry_recall_query_trace.jsonl`

================================
NON-INTERFERENCE
================

| 检查 | 结果 |
|------|------|
| Causal harness baseline vs S3 final text | **84 / 84 一致** |
| KenLM pool fingerprint | **84 / 84 一致** |
| 详见 | `model3_v2_retry_recall_trace_non_interference.csv` |

Trace 为 observation-only push；生产决策链在 causal harness 下与 trace-off 语义一致（0/0/200 权威未覆盖）。

================================
ACTUAL RECALL INPUT CONTRACT
============================

每次 Retry Recall 调用记录：

- `spanStart/spanEnd/spanSurface`（local span）
- `windowText` = `rawText.slice(rawStart, rawEnd)`
- `windowPinyinKey` = `globalSyllables.slice(syllableStart, syllableEnd).join('|')`
- `acousticTonePattern` 来自 first-pass tone rebind
- `domainIds` = 该 path 的 `retainedDomains`

**全部 FALLBACK**（84 例 lattice 失败 cohort）：`localSpanSource=FALLBACK`，无 sliding/overlap 备选 window。

================================
BOUNDARY PARITY
===============

| 分类 | 84 cohort |
|------|----------:|
| QUERY_PARITY_PASS | **8** |
| QUERY_BOUNDARY_MISMATCH | **26** |
| QUERY_MULTIPLE_MISMATCHES | **35** |
| INSUFFICIENT_EVIDENCE | **1** |

**Overlap ≠ parity：** 61 例 Recall 被调用但 repair-capable query **未** 到达。

================================
PINYIN / TONE / DOMAIN PARITY
=============================

| 维度 | 在 parity-pass 子集 |
|------|---------------------|
| PINYIN_PARITY_PASS | 8 / 8 |
| TONE | 已 supplied where span has tone rebind |
| DOMAIN_SCOPE_PASS | path-local retained domains preserved |

Pinyin mismatch **不是** 84 cohort 主因；**边界** 是主因。

================================
OLD BOUNDARY REVALIDATION
=========================

| 指标 | 数量 |
|------|------:|
| 先前 flagged 案例（≥10） | **10** |
| 经实际 query trace **确认因果** | **7** |
| **推翻**（parity pass  despite flag） | **0** |

示例 **d007**：`市|副|局` 分拆 query，无法表达 **师傅** 组合修复 → **LOCAL_RESEGMENTATION_FALLBACK_OLD_BOUNDARY_LOCK**。

================================
65 PROVISIONAL TARGET MISS
==========================

| 结果 | 数量 |
|------|------:|
| 仍为 **RECALL_TARGET_MISS**（parity proven） | **8** |
| 移至上游 | **57** |

上一 **65 × RECALL_TARGET_MISS** → **8 确认 + 57 上游**。

================================
6 PROVISIONAL ZERO RETURN
=========================

| 结果 | 数量 |
|------|------:|
| 仍为 **RECALL_ZERO_RETURN** | **0** |
| 移至上游（query 未达 repair-capable） | **6** |

**全部 6 例** 在 parity 门控下 **不再** 归属 Recall：实际 query 为单字 fallback window，与 repair interval 不匹配。

================================
13 POSITIVE CONTROLS
====================

| 分类 | 数量 |
|------|------:|
| DOWNSTREAM_TARGET_PRESENT | **13** |

目标已在池中；Retry Recall query parity 未阻塞最终修复。path provenance 保留。

================================
STRICT CAUSAL FUNNEL
====================

| Stage | Input | Pass | Fail | First-fail |
|-------|------:|-----:|-----:|------------|
| Historical cohort | 84 | 84 | 0 | — |
| Actual query captured | 84 | 82 | 2 | INSUFFICIENT_EVIDENCE |
| **QUERY_PARITY_PASS** | 84 | **8** | **76** | **QUERY_MISMATCH** |
| Recall target returned | 8 | 0 | 8 | RECALL_TARGET_MISS |

================================
OWNER DISTRIBUTION (84)
=======================

| Owner | Count |
|-------|------:|
| RETRY_QUERY_BOUNDARY | **48** |
| LOCAL_RESEGMENTATION_FALLBACK_OLD_BOUNDARY_LOCK | **13** |
| DOWNSTREAM_TARGET_PRESENT | **13** |
| RECALL_TARGET_MISS | **8** |
| NO_REPAIRABLE_TARGET | **1** |
| INSUFFICIENT_EVIDENCE | **1** |
| **Sum** | **84** |

### Provisional 71 核对

| | Count |
|---|------:|
| Previous provisional Recall | **71** |
| Confirmed Recall (parity proven) | **8** |
| Reclassified upstream | **62** |
| Remaining | **1** |
| **8 + 62 + 1 = 71** | ✓ |

================================
ARCHITECTURE / GOVERNANCE
=========================

| Item | Changed |
|------|---------|
| Domain Vote | **NO** |
| FineSpan | **NO** |
| Model2/Model3 | **NO** |
| Retry / Fallback / Recall | **NO** |
| JobResult | **NO** |
| Training | **NO** |

Historical **LOCAL_RESEGMENTATION=84** 仍仅作 **HISTORICAL_REGIONAL_LATTICE_FAILURE_COHORT=84**。

================================
NEXT PHASE
==========

**`MODEL3_V2_RETRY_QUERY_MAPPING_CORRECTION_DESIGN_AUDIT`**

（不自动执行，等待审阅）

================================
ARTIFACTS (7)
=============

1. `Lingua_Model3_V2_Retry_Recall_Query_Parity_Audit_2026_09_01.md`
2. `model3_v2_retry_recall_query_parity_cases.csv`
3. `model3_v2_retry_query_mismatches.csv`
4. `model3_v2_recall_confirmed_failures.csv`
5. `model3_v2_retry_recall_query_funnel.csv`
6. `model3_v2_retry_recall_query_summary.json`
7. `model3_v2_retry_recall_trace_non_interference.csv`

Trace JSONL（diagnostic）：`model3_v2_retry_recall_query_trace.jsonl`

Audit runners：`run-model3-v2-retry-recall-query-parity-replay.mjs`, `run-model3-v2-retry-recall-query-parity-audit.mjs`
