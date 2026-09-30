# Lingua ASR Postprocess Full Pipeline Quality Acceptance Report

**Phase:** `LINGUA_ASR_POSTPROCESS_FULL_PIPELINE_QUALITY_ACCEPTANCE_AUDIT`  
**Mode:** `READ_ONLY + SYSTEM QUALITY ACCEPTANCE`  
**Date:** 2026-09-08  
**Quality verdict:** `LINGUA_FULL_PIPELINE_QUALITY_AUDIT_PASS_SMALL_NET_GAIN`  
**Architecture:** `PASS_FROZEN_MAINLINE`（与质量分开）

---

## Executive answers (A–L)

| ID | Answer |
| -- | ------ |
| **A** Final 比 raw ASR 更准？ | **YES**（exact + CER） |
| **B** Exact-correct case 增量 | **+6**（30 − 24） |
| **C** Rescue rate（raw errors） | **3.41%**（6 / 176） |
| **D** 原本正确被破坏 | **0** |
| **E** #1 first breakpoint | **`LEXICON_COVERAGE_MISSING`（143）** |
| **F** #1 actionable owner | **Lexicon coverage** |
| **G** Model3 仍 CLOSED？ | **YES**（`MODEL3_REOPEN_REQUIRED=NO`） |
| **H** Retry 仍 FROZEN？ | **YES**（arch violation=0；effectiveness gap=14） |
| **I** cap≤16 造成可测正确性损失？ | **NO**（over16=0；无 CANDIDATE_CAP_LOSS） |
| **J** KenLM 是主要瓶颈？ | **NO**（0 例以 KenLM 为第一断点） |
| **K** 可进入更广质量验证？ | **YES**（baseline 已立；无回归） |
| **L** 唯一下一 Delta | **`LEXICON_COVERAGE_DELTA_PREDEVELOPMENT_AUDIT`** |

---

## Runtime / identity gates

| Check | Result |
| ----- | ------ |
| `RUNTIME_DEFAULT_MODEL` | `MODEL3_V2_S3_RANDOM_INIT_V1` |
| weights SHA | `f1e4196933a66bbea73fdd8f17fa460f52696656208ff05c41f2dc9ff81cbbb1` |
| config SHA | `8c181cb95ab159f5c35c47dc417e527946bf5d0f9614cb83b37a62ab7f01f221` |
| `npm run build:main` | **PASS** |
| Production code diff（本轮） | **NONE** |
| Oracle leak | **NONE**（reference 仅离线评测） |
| A1 | 未使用 / 未 promotion |

---

## Corpus / provenance

| Field | Value |
| ----- | ----- |
| Corpus | `dialog_200`（200 cases） |
| Evidence | S3 production-equivalent dumps（Delta2 后 acceptance / target-scope / provenance / causal trace） |
| Model3 | S3（现为 runtime default；dumps 与当前 default 一致） |
| Timing | reused `model3_retry_performance_summary.json` |
| Lexicon / KenLM path identity | 见既有 acceptance harness；本轮未重新解析 DB 路径 → 若需绝对 path，标为 **provenance gap（non-blocking）** |

**Evidence note：** 早期 provenance 将大量 case 标为 `NO_REPAIRABLE_TARGET`（154）。后续 `model3_v2_s3_target_scope_full200` 将多数 remap 为 `REFERENCE_DIFF_WITH_REPAIRABLE_LOCAL_REGION` + `TARGET_NOT_IN_LEXICON`。本审计以 **target-scope 为第一断点主证据**（更贴近可行动 coverage），并在报告中保留该 remap 说明。

---

## Core quality metrics

| Metric | Value |
| ------ | ----- |
| TOTAL_CASES | 200 |
| RAW_ASR_CORRECT | 24 |
| RAW_ASR_INCORRECT | 176 |
| FINAL_CORRECT | 30 |
| FINAL_INCORRECT | 170 |
| RAW_ACCURACY | **12.0%** |
| FINAL_ACCURACY | **15.0%** |
| ABSOLUTE_ACCURACY_DELTA | **+3.0 pp** |
| RELATIVE_ERROR_REDUCTION | **3.41%** |
| FULL_RESCUE | 6 |
| PARTIAL_IMPROVEMENT | 67 |
| UNCHANGED_ERROR | 103 |
| WRONG_TO_DIFFERENT_WRONG | 0 |
| REGRESSION（raw wrong worse） | 0 |
| CORRECT_PRESERVED | 24 |
| CORRECT_BROKEN | **0** |
| RESCUE_RATE | 3.41% |
| REGRESSION_RATE | **0%** |
| NET_CORRECT_CASE_GAIN | **+6** |
| RAW_CER（mean proxy） | 0.256 |
| FINAL_CER（mean proxy） | 0.189 |
| CER_DELTA | **−0.066** |

### Outcome classes

| Class | N |
| ----- | - |
| `RAW_ALREADY_CORRECT_FINAL_CORRECT` | 24 |
| `RAW_ALREADY_CORRECT_FINAL_REGRESSED` | 0 |
| `RAW_WRONG_FINAL_IMPROVED_TO_CORRECT` | 6 |
| `RAW_WRONG_FINAL_PARTIALLY_IMPROVED` | 67 |
| `RAW_WRONG_FINAL_UNCHANGED` | 103 |
| `RAW_WRONG_FINAL_DIFFERENT_BUT_WRONG` | 0 |
| `RAW_WRONG_FINAL_REGRESSED` | 0 |

**Safety：** 零正确句被破坏。净收益为正但偏小；大量 **partial improve** 显示后处理常缩短编辑距离，但未达 exact match。

**Quality class：** `QUALITY_SMALL_NET_GAIN`

---

## First-breakpoint distribution（raw wrong ∧ final not correct）

| BREAKPOINT | COUNT | % raw errors | % all |
| ---------- | ----: | -----------: | ----: |
| `LEXICON_COVERAGE_MISSING` | 143 | 81.3% | 71.5% |
| `RETRY_QUERY_NOT_REPAIR_CAPABLE` | 14 | 8.0% | 7.0% |
| `RECALL_MATCHING_FAILED` | 9 | 5.1% | 4.5% |
| `MODEL3_FALSE_KEEP` | 1 | 0.6% | 0.5% |

详见 `lingua_full_pipeline_breakpoint_distribution.csv`。

### Closure protection

| Gate | Value |
| ---- | ----- |
| `PROVEN_MODEL3_OWNED_BREAKPOINT_COUNT` | **1** |
| `MODEL3_REOPEN_REQUIRED` | **NO** |
| `RETRY_ARCHITECTURE_VIOLATION_COUNT` | **0** |
| `RETRY_EFFECTIVENESS_GAP_COUNT` | **14** |

Retry 保持 **ACTIVE + FROZEN**（仅 effectiveness gap，非 architecture violation）。

---

## Repairability funnel（raw wrong = 176）

| Stage | Cases | Lost vs prev |
| ----- | ----: | -----------: |
| Raw wrong | 176 | — |
| Repairable target YES | ~172* | — |
| FineSpan exposed YES | high* | — |
| Lexicon covered YES | 24 (inLexicon=True in scope) | **dominant loss** |
| Recall hit YES | low | after lexicon |
| Domain / Assembly / KenLM | rarely reached with correct target | |
| Final correct | 6 | |

\*Target-scope：172 `REFERENCE_DIFF_WITH_REPAIRABLE_LOCAL_REGION`；148 `inLexicon=False`。

**结论：** 正确词大多在 **Lexicon coverage** 层丢失；KenLM / cap / Assembly 很少成为第一断点。

---

## Module responsibility matrix

| Module | Architecture | Quality owner cases | Regression owner | Next action |
| ------ | ------------ | ------------------: | ---------------- | ----------- |
| ASR | PASS | 0 | 0 | 不重开 high-RTF |
| FineSpan | PASS | 0* | 0 | 观察（*旧 NO_REPAIRABLE 已 remap） |
| **Lexicon** | PASS | **143** | 0 | **下一 Delta** |
| Recall | PASS | 9 | 0 | 其后 |
| Domain | PASS | 0 | 0 | NONE |
| Model2 | PASS | 0（N/A 为主） | 0 | NONE |
| Model3 | PASS / CLOSED | 1 | 0 | 保持 CLOSED |
| Retry | PASS / FROZEN | 14（effectiveness） | 0 | 不重开 Delta1/2 |
| Assembly | PASS | 0 | 0 | NONE |
| KenLM | PASS | 0 | 0 | NOT major bottleneck |

`quality owner > 0` ≠ architecture broken。

---

## Candidate budget / KenLM

| Metric | Value |
| ------ | ----- |
| max cross-path pool（acceptance） | 6 |
| over-16 count | 0 |
| Cap 导致正确性损失（proven） | **NO** |
| KenLM 第一断点 | **0** |

---

## Performance（reused）

Production clean p50 pipeline ≈ **7400 ms**（既有 dump）：

| Share | Approx |
| ----- | ------ |
| ASR-dominated residual | ~57% |
| FW residual | ~31% |
| KenLM | ~10% |
| Retry | ~1% |
| Model3 | ~0.35% |

不重开 ASR high-RTF 专项。

---

## Regressions

`lingua_full_pipeline_regressions.csv`：**空**（0 例 `RAW_ALREADY_CORRECT_FINAL_REGRESSED`）。

---

## Next phase（唯一，不执行）

`LEXICON_COVERAGE_DELTA_PREDEVELOPMENT_AUDIT`

禁止并行重开 Model3 / Retry / KenLM / FineSpan，除非新独立审计证明第一断点转移。

---

## Artifacts

1. `Lingua_ASR_Postprocess_Full_Pipeline_Quality_Acceptance_Report.md`（本文件）  
2. `lingua_full_pipeline_case_results.csv`  
3. `lingua_full_pipeline_breakpoint_distribution.csv`  
4. `lingua_full_pipeline_quality_summary.json`  
5. `lingua_full_pipeline_funnel.csv`  
6. `lingua_full_pipeline_regressions.csv`  
7. `lingua_full_pipeline_performance_summary.json`

---

## Final principle

系统事实：

```text
RAW exact 12% → FINAL exact 15%   (+6 cases, 0 broken)
CER mean 0.256 → 0.189
Partial improve 67 / Unchanged error 103
#1 loss owner = LEXICON_COVERAGE_MISSING
Model3 stays CLOSED; Retry stays FROZEN
```

下一 Delta 由 breakpoint 分布决定：**Lexicon coverage**，不是历史印象或 Model3。
