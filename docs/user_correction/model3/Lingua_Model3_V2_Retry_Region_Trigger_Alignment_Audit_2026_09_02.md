# Lingua — Model3 V2 Retry Region ↔ Trigger Alignment Audit

Date: 2026-09-02  
Phase: `MODEL3_V2_RETRY_REGION_TRIGGER_ALIGNMENT_AUDIT`  
Mode: READ-ONLY / TEST-TRACE-ONLY / CAUSAL OWNER AUDIT

================================
EXECUTIVE VERDICT
=================

| Item | Result |
|------|--------|
| **Verdict** | **`RETRY_REGION_TRIGGER_ALIGNMENT_PASS_MIXED`** |
| **34-case distribution** | 见下表 |
| **Largest category** | **`MULTI_UNIT_TARGET_ATTRIBUTION_ERROR` — 13 (38.2%)** — prior audit paired wrong repair unit ↔ Retry region |
| **Second category (production)** | **`MODEL3_RETRY_SHIFTED_NEARBY` — 8 (23.5%)** |
| **deriveRetryRegions status** | **`FROZEN_CONTRACT_EXECUTED_NO_VALID_DROP`** — **0 / 34** `DERIVE_RETRY_REGION_DROPPED_VALID_RETRY` |
| **Model3 localization (production)** | **16 / 34** — FN 4 + partial 4 + shifted nearby 8 |
| **Prior `RETRY_REGION_DERIVATION` label** | **OVERTURNED** — not a deriveRetryRegions defect |
| **ACP required** | **NO** |
| **Next phase** | **`MODEL3_V2_TRIGGER_REGION_BOUNDARY_DESIGN_AUDIT`** (design only — not executed) |

### 34-case first-loss distribution

| firstFailOwner | Count | % |
|----------------|------:|--:|
| MULTI_UNIT_TARGET_ATTRIBUTION_ERROR | 13 | 38.2 |
| MODEL3_RETRY_SHIFTED_NEARBY | 8 | 23.5 |
| NO_REPAIRABLE_TARGET | 5 | 14.7 |
| MODEL3_TARGET_FALSE_NEGATIVE | 4 | 11.8 |
| MODEL3_TARGET_PARTIAL_COVERAGE | 4 | 11.8 |
| DERIVE_RETRY_REGION_DROPPED_VALID_RETRY | **0** | 0 |

**Headline:** 上一阶段将 34 例归因为 `deriveRetryRegions` **证据不足**。在捕获 **production Model3 KEEP/RETRY**（`model3_v1_runtime_margin_analysis.csv`）并按 repair unit 正确匹配 Retry region 后：**deriveRetryRegions 未丢弃任何已证实的 target RETRY span（0/34）**。真实首责分为：**(A) 13 例 prior 审计 attribution 错误**；**(B) 16 例 Model3 在 target FineSpan 上的 localization 失败**；**(C) 5 例 target 区间无可用 FineSpan 表达**。

================================
FROZEN EVIDENCE
===============

见 `model3_v2_retry_region_trigger_freeze_state.csv`。关键更新：

| Item | After this audit |
|------|------------------|
| `TARGET_RETRY_REGION_MISMATCH = 34` | Symptom only — **not** deriveRetryRegions owner |
| `deriveRetryRegions` | **Contract correct** unless valid RETRY drop proven |
| Query parity 8 / OLD_BOUNDARY 13 / Trace-14 | Unchanged |
| Model3 S3 / 0-0-200 acceptance | Unchanged |

================================
REPAIR UNIT ATTRIBUTION
=======================

**方法：** 每个 repair unit 独立匹配 trace 中 **overlap 最大** 的 Retry region；禁止 utterance 级全配对。

**13 例 `MULTI_UNIT_TARGET_ATTRIBUTION_ERROR`：** prior owner/parity 审计将 repair unit 与 **priorRetryRegionId** 绑定，但该 region 与 target interval **零 overlap**（`priorRegionOverlap=0`），而 utterance 内存在 overlap 正确的 region 或其他 repair unit 的 RETRY。

**代表：** d101（target 0–12「挂号处请问内科」，prior region 20–21「微」）；d008 parity 用 region 26–28 评「三期 7–9」，而 target 最近 RETRY 在 11–12「大」）。

================================
TARGET FINESPAN COVERAGE
========================

**证据源：** `model3_v1_runtime_margin_analysis.csv`（production margin/logit/decision）+ raw_asr 顺序定位 rawStart/rawEnd。

| targetRetryCoverage | Count |
|-------------------|------:|
| TARGET_NO_RETRY | 19 |
| TARGET_PARTIAL_RETRY_COVERAGE | 8 |
| TARGET_FULL_RETRY_COVERAGE | **0** |
| TARGET_NOT_MODEL3_ELIGIBLE | **7** |
| TARGET_ANCHOR_BLOCKED | 0 |
| **Sum** | **34** |

**CORRECTED_METADATA:** 上一版报告写「29/5 spans found」与「NO_SPANS=5」——遗漏 **d101,d118**（`TARGET_NOT_MODEL3_ELIGIBLE` 但 owner=attribution）。正确：**27/7** spans found；coverage 合计 **34**。

**D9 FULL = 0：** 34 例中 **无一** target repair unit 获得 FULL RETRY coverage。

================================
MODEL3 ACTUAL DECISIONS
=======================

Target-overlapping FineSpan 详情见 `model3_v2_target_finespan_decisions.csv`。

**Margin 分布（target-overlapping KEEP spans）：** strong_KEEP / moderate_KEEP / near_boundary / RETRY — 来自 production `margin` 字段；未改阈值。

**典型 — d022「订单显」3–7：**

| Span | Surface | Decision | Margin bin |
|------|---------|----------|------------|
| :3 | 定 | **RETRY** | RETRY |
| :4 | 但 | KEEP | strong_KEEP |
| :5 | 显 | KEEP | moderate_KEEP |

→ `TARGET_PARTIAL_RETRY_COVERAGE` + KEEP barrier → `MODEL3_TARGET_PARTIAL_COVERAGE`。

**典型 — d008「三期」7–9：**

| Span | Surface | Decision |
|------|---------|----------|
| :7 | 散 | KEEP |
| :8 | 清 | KEEP |

Nearest RETRY: :11「大」距离 class `NEAR_1_2_CHARS` → `MODEL3_RETRY_SHIFTED_NEARBY`。

================================
deriveRetryRegions
==================

**模拟：** 读取 production decisions，按 `model3-retry-region.ts` 契约合并 contiguous RETRY（KEEP/Anchor 为 barrier）。

| Check | Result |
|-------|--------|
| Valid target RETRY enters derive input | 12 / 34 cases have ≥1 target RETRY span |
| **Dropped by derive** | **0 / 34** |
| Output matches trace regions | Consistent where target RETRY exists |

**D35/D36: YES** — deriveRetryRegions 在 frozen KEEP barrier 下 **正确执行契约**；**不是** 34 例的主因。

================================
STRICT CAUSAL FUNNEL (34)
=========================

| Stage | Pass | Fail |
|-------|-----:|-----:|
| TARGET_REGION_MISMATCH | 34 | 0 |
| repair unit valid | 34 | 0 |
| target FineSpans found | 29 | 5 |
| sufficient target RETRY (FULL) | **0** | 34 |
| derive preserves target RETRY | 12 input | **0 drops** |

Funnel 数值见 `model3_v2_retry_region_trigger_summary.json` → `funnel`。

================================
ROOT CAUSES
===========

见 `model3_v2_retry_trigger_root_causes.csv`。

| rootCauseId | Count | Production vs audit |
|-------------|------:|---------------------|
| RC_DISTANT_RETRY_OTHER_UNIT | 7 | Audit attribution |
| RC_ATTRIBUTION_WRONG_REGION | 6 | Audit attribution |
| RC_RETRY_NEARBY | 8 | **Model3 localization** |
| RC_MODEL3_FN | 4 | **Model3 localization** |
| RC_MODEL3_PARTIAL* | 4 | **Model3 localization** |
| RC_NO_FINESPAN | 5 | Architecture / expressibility |

================================
CONTROL VALIDATION
==================

| Control | Status |
|---------|--------|
| 13 OLD_BOUNDARY | Path + margin trace consistent with target RETRY present upstream; failure remains fallback (frozen) |
| 8 Recall parity-pass | Target RETRY + region alignment + query parity confirmed in prior audit |
| 14 trace-classification | New attribution method avoids repeating utterance-level cross-pairing for those cases |

================================
FREEZE UPDATE
=============

| Prior label | Status after audit |
|-------------|-------------------|
| `RETRY_REGION_DERIVATION = 34` | **RETIRED** as production owner |
| `deriveRetryRegions` defective | **NOT FROZEN** — 0 valid-drop cases |
| Model3 localization primary | **PROVISIONAL FREEZE** — 16 production cases |

================================
GOVERNANCE
==========

| Component | Changed |
|-----------|---------|
| All production code | **NO** |
| Model3 / deriveRetryRegions / Retry | **NO** |
| JobResult / candidate cap | **NO** |

Audit script: `run-model3-v2-retry-region-trigger-alignment-audit.mjs` (read-only).

================================
NEXT PHASE
==========

**Exactly one:** `MODEL3_V2_TRIGGER_REGION_BOUNDARY_DESIGN_AUDIT`

**Do not execute automatically.** Await user review.

================================
ARTIFACTS (6 + report)
======================

1. `Lingua_Model3_V2_Retry_Region_Trigger_Alignment_Audit_2026_09_02.md`
2. `model3_v2_retry_region_trigger_cases.csv`
3. `model3_v2_target_finespan_decisions.csv`
4. `model3_v2_retry_region_alignment.csv`
5. `model3_v2_retry_trigger_root_causes.csv`
6. `model3_v2_retry_region_trigger_summary.json`
7. `model3_v2_retry_region_trigger_freeze_state.csv`
