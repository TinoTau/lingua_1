<!-- Documentation Hierarchy Metadata
Status: **ACCEPTANCE_RECORD**
Superseded By: Evidence only — not CURRENT
Archive Path: docs/acceptance/Development/Lingua_Metrics_Layer_SSOT_Alignment_Development_Report_2026_07_14.md
-->

> **ACCEPTANCE_RECORD** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: Evidence only — not CURRENT

# Lingua Metrics Layer SSOT Alignment — Development Report

**Date:** 2026-07-14  
**Process:** CODING P4 · Development  
**Binding（唯一开发依据）：**  
- [Supplement](./Lingua_Metrics_Layer_SSOT_Alignment_Supplement_2026_07_14.md)  
- [Constraint Addendum](./Lingua_Metrics_Layer_SSOT_Constraint_Addendum.md)  
**Upstream Audit:** [Diagnostics Metrics Audit](./Lingua_Repair_Diagnostics_SSOT_Metrics_Audit_2026_07_14.md)（B）

---

## Final Verdict

# **A**

**Metrics Layer PASS。** Runtime Diagnostics 成为唯一 Architecture SSOT。  
Consumer Funnel 已降级。可以进入 **KenLM Corpus Audit**（消费本 Metrics Mapping；Generated 文本类指标须 Trace rematerialize）。

---

## 0. Consistency Check（开发前）

| Expected | Actual | Impact | Action |
|----------|--------|--------|--------|
| Metrics 只 Read→Map→Report | 新脚本 + E2E pass-through | 双 SSOT 消除 | **KEEP** |
| 不改 Repair/KenLM/Recall 业务 | `fw-detector` 主链未改 | Runtime Diff=0 | **KEEP** |
| Generated ≠ Dump | `combinationCount`/`allCombinations` vs `topCandidates` | 可观测分离 | **RESTORE** |
| Unavailable ≠ Failure | mapper 显式 Unavailable | 无伪 Failure | **KEEP** |
| Funnel 不作 SSOT | Success Funnel 文档 Deprecated | 文档一致 | **DELETE** 第二 SSOT |
| E2E summary → Generated 空 | 旧 JSON `generated_texts_unavailable=200` | 证据需 rematerialize | **MODIFY** Metrics run → `level=trace` |

---

## 1. What Was Built

| 交付物 | 路径 |
|--------|------|
| Constraint Addendum（落盘） | `docs/tone-v2/Lingua_Metrics_Layer_SSOT_Constraint_Addendum.md` |
| Field Mapping 文档 | `docs/tone-v2/Lingua_Metrics_Layer_SSOT_Mapping.md` |
| Metrics mapper | `electron_node/electron-node/tests/experiments/analyze-metrics-ssot.mjs` |
| E2E pass-through + trace config | `run-asr-e2e-quality-validation.mjs` |
| Diagnostics / Interface / Architecture 附录 | `diagnostics/FROZEN.md` · `INTERFACE_FREEZE.md` · `ARCHITECTURE.md` |
| Funnel 降级 | `Lingua_ASR_Repair_Success_Funnel_Audit_2026_07_14.md` · 旧 analyze 脚本 header |
| Mapper 输出 | `tmp/.../metrics_ssot_report.json` |

**未改：** FW · Tone · Recall · Domain Vote · Sentence Assembly · KenLM pick · Lexicon · Runtime ABI。

---

## 2. Acceptance Checklist

| # | Requirement | Result |
|---|-------------|:------:|
| 1 | Runtime only SSOT | **PASS** |
| 2 | Metrics mapping only | **PASS** |
| 3 | No Projection business logic | **PASS** |
| 4 | Generated / Dump separated | **PASS** |
| 5 | Stage semantics independent | **PASS**（阶段独立；不可用=Unavailable） |
| 6 | Runtime interfaces unchanged | **PASS** |
| 7 | Repair Pipeline unchanged | **PASS** |
| 8 | Reports consume Runtime | **PASS**（`analyze-metrics-ssot.mjs`） |
| 9 | Ownership follows Runtime | **PASS**（跳过 Unavailable；`pickedIsRaw` 不改名） |
| 10 | Docs reflect Runtime | **PASS** |

---

## 3. Architecture Compliance

| Gate | Result |
|------|:------:|
| No Shadow Logic | PASS |
| No Compatibility Logic | PASS |
| No Hidden Gate | PASS |
| No Bypass | PASS |
| No Dead Feature（Funnel-as-SSOT） | PASS（Deprecated） |
| No Dual SSOT | PASS |
| No Runtime Drift | PASS |

---

## 4. Mapper Run（Historical E2E JSON）

| Metric | Value |
|--------|------:|
| cases_mapped | 200 |
| generated_texts_available | **0** |
| generated_texts_unavailable | **200** |
| lookup_trace_available | **0** |
| lookup_trace_unavailable | **200** |

符合 Counterfactual：旧 run 为 `diagnosticsLevel=summary` → **Unavailable**，未记 Failure。  
新 E2E 配置已改为 `level=trace` + `targetIds=[]`，**下次全量跑**可物化 Generated / Lookup。

---

## 5. KEEP / MODIFY / RESTORE / DELETE

| Action | Item |
|--------|------|
| **KEEP** | Runtime field names；Gate/Assembly 业务 |
| **MODIFY** | E2E extractMetrics → pass-through；diagnostics level=trace for Metrics runs |
| **RESTORE** | `allCombinations` / Generated vs Dump 语义在报告中的地位 |
| **DELETE** | Funnel-as-Architecture-SSOT；kenlmLayer Stage 推导；Dump Exact 冒充 Assembly/Recall Success |

---

## 6. 最终回答

| # | 问题 | 回答 |
|---|------|------|
| 1 | Runtime 是否唯一 SSOT？ | **YES** |
| 2 | Metrics 是否全部 Mapping？ | **YES**（catalog 已固化） |
| 3 | 是否消除双 SSOT？ | **YES** |
| 4 | 是否消除 Projection 重定义？ | **YES**（新入口）；旧 Funnel 脚本 Deprecated |
| 5 | Generated 与 Dump 是否彻底分离？ | **YES**（字段+规则）；历史 JSON Generated=Unavailable |
| 6 | Assembly 是否有独立 Metrics？ | **YES**（`combinationCount` / Generated texts；不用 Exact） |
| 7 | KenLM 是否有独立 Metrics？ | **YES**（`pickedIsRaw` / `maxDelta` / deltas / picked） |
| 8 | 是否可以开始 KenLM Corpus Audit？ | **YES** — 基于 Runtime 字段 Mapping；含 Generated 文本覆盖的项须 **trace rematerialize** |

---

## 7. Expected / Actual（发现）

| Item | Expected | Actual | Impact |
|------|----------|--------|--------|
| Historical E2E Generated texts | Trace 全量 | summary → 无 `allCombinations` | Generated Overlay 暂 Unavailable |
| `pickedIsRaw` naming | 保持原名 | 保持 | 合规 |
| Funnel SSOT claim | 撤销 | 已 Deprecated | 合规 |

---

## 8. Regression

`Runtime Business Logic Diff = 0`（本轮仅 experiments 脚本 + docs + diagnostics **config**）。

---

*End of Development Report*
