# Model3 V2 End-to-End Causal Effectiveness Audit

**Phase:** `MODEL3_V2_END_TO_END_CAUSAL_EFFECTIVENESS_AUDIT`  
**Mode:** `READ_ONLY` / `OBSERVE AND ATTRIBUTE ONLY`  
**Evidence class:** `EVIDENCE`（非 Architecture SSOT）  
**Population:** `dialog_200` production-equivalent replay  
**Primary dump:** `model3_retry_fallback_acceptance_after_raw.jsonl`（Delta2 后）  
**Provenance join:** `model3_v2_s3_candidate_provenance_full200.csv`  
**Generated:** 2026-09-07

---

## Verdict

`MODEL3_CAUSAL_AUDIT_PASS_MODEL3_DOWNSTREAM_BLOCKED`

| Gate | Result |
| ---- | ------ |
| Model identity | PASS（`MODEL3_V2_S3_RANDOM_INIT_V1` / SHA `f1e41969…bbb1`） |
| Architecture drift | `ARCHITECTURE_DRIFT = NONE` |
| Anti-test-gaming | PASS（未发现 case-ID / oracle 生产分支） |
| Delta1 / Delta2 | 保持 `RESOLVED_ACCEPTED`；本轮未发现 regression |
| Final improved | **0 / 200**（及 0 / 16 eligible） |

---

## Executive answers (A–E)

| ID | Question | Answer |
| -- | -------- | ------ |
| **A** | `CAN_MODEL3_RESPONSIBILITY_BE_ACCEPTED_NOW?` | **YES** |
| **B** | `CAN_RETRY_RESPONSIBILITY_BE_ACCEPTED_NOW?` | **YES** |
| **C** | First blocking owner if NO | N/A |
| **D** | Downstream owner if responsibility YES but final low | **`LEXICON_COVERAGE`**（eligible 未改善中 11/16） |
| **E** | 是否需要继续修改 Model3？ | **NO**（最大 proven breakpoint 不在 Model3） |

下一阶段只建议 **一个** semantic delta：

`LEXICON_COVERAGE_DELTA`

（或若优先冻结职责：`MODEL3_FINAL_ACCEPTANCE_AND_FREEZE`；二者择一，不得并行改 Model3/Retry/KenLM/cap。）

---

## 1. Model identity

| Field | Expected | Evidence |
| ----- | -------- | -------- |
| dataset | `MODEL3_V2_PRODUCTION_CORE_S3` | prior S3 acceptance artifacts |
| build | `prod_core_s3_build_20260830_v1` | same |
| model | `MODEL3_V2_S3_RANDOM_INIT_V1` | fallback / stage2 / class-weight summaries |
| weights SHA | `f1e4196933a66bbea73fdd8f17fa460f52696656208ff05c41f2dc9ff81cbbb1` | verified across multiple reports |
| seed | `2026083013` | training identity docs |

`MODEL_IDENTITY_MISMATCH` = **false** → 效果结论有效。

---

## 2. Ground-truth / eligibility population

| Class | N | Meaning |
| ----- | - | ------- |
| `MODEL3_INELIGIBLE_ALREADY_CORRECT` | 30 | final/baseline 已与 expected 等价 |
| `MODEL3_INELIGIBLE_NO_REPAIRABLE_TARGET` | 154 | provenance `NO_REPAIRABLE_TARGET`：无映射可修 locus |
| `MODEL3_ELIGIBLE` | **16** | 存在可评估 repair locus（lexicon / query / recall 类） |

说明：

- **不能**把 170 个 `FINAL_NEUTRAL` 都算成 Model3 failure。
- 154 个无 repairable target 的第一断点归 **`UPSTREAM_FINE_SPAN`**（上游 FineSpan / target 映射），不是 Model3。
- Eligible 仅 16/200：对 **final utility** 偏薄，但对 **职责验收 + 第一断点归属** 足够形成证据链；**不**判 `MODEL3_EFFECTIVENESS_TEST_COVERAGE_INSUFFICIENT`。

---

## 3. Model3 decision audit（eligible only）

| Class | N | Notes |
| ----- | - | ----- |
| `CORRECT_RETRY` | 15 | non-Anchor eligible 上触发 RETRY；下游失败不改此判定 |
| `FALSE_KEEP` | 1 | `d172`：全部 KEEP，Retry 未启动 |
| `CORRECT_KEEP` | 0 | eligible 且需修复时无此档 |

**结论：** Trigger quality 在 eligible 上基本正确（15/16）。唯一 `MODEL3_FALSE_KEEP` 不构成主阻塞。

关于 181 例 `FALSE_RETRY_OR_INELIGIBLE_RETRY` 标签：这是 **非 eligible** case 上仍出现 RETRY 的 case-level 启发式标签，**不是** eligible 决策失败计数。大量 `NO_REPAIRABLE_TARGET` 上 RETRY 表示模型对不确定 span 触发重解释，不能自动记为 False Retry。

---

## 4. Mandatory causal funnel（eligible cases）

| Stage | N | rate_from_eligible |
| ----- | - | ------------------ |
| MODEL3_ELIGIBLE_cases | 16 | 1.0000 |
| CORRECT_RETRY_cases | 15 | 0.9375 |
| FALSE_KEEP_cases | 1 | 0.0625 |
| RetryRegion_present | 15 | 0.9375 |
| Recall_query_sent | 15 | 0.9375 |
| Recall_any_candidate_returned | 15 | 0.9375 |
| **Correct_lexical_hit** | **0** | **0.0000** |
| Domain_path_survived_correct | 0 | 0.0000 |
| Assembly_materialized_correct | 0 | 0.0000 |
| KenLM_selected_or_pooled_correct | 0 | 0.0000 |
| FINAL_IMPROVED | 0 | 0.0000 |

**关键断裂点：** CORRECT_RETRY + region + query 之后，**正确词从未进入候选池**（Correct_lexical_hit = 0）。  
因此 Assembly / KenLM 在本 population 上 **没有机会** 被证明为第一断点。

补充（全量 Delta2 acceptance，非仅 eligible）：

- cross-FineSpan windows queried = 1260，**Recall hits = 0**（geometry 已恢复，lexical utility 未证明）
- `fallbackQueriesWithRecallHits` = 686（任意命中，非正确词）
- `finalImproved` = 0；`secondDomainVoteCount` = 0；`model3ReinvokedCount` = 0

---

## 5. First-breakpoint distribution

### 5.1 All cases with assigned breakpoint

| FIRST_CAUSAL_BREAKPOINT | N | pct |
| ----------------------- | - | --- |
| `UPSTREAM_FINE_SPAN` | 154 | 90.59% |
| `LEXICON_COVERAGE` | 11 | 6.47% |
| `RETRY_RESEGMENTATION` | 3 | 1.76% |
| `RECALL_MATCHING` | 1 | 0.59% |
| `MODEL3_FALSE_KEEP` | 1 | 0.59% |

### 5.2 MODEL3_ELIGIBLE ∧ not FINAL_IMPROVED（每 case 唯一）

| FIRST_CAUSAL_BREAKPOINT | N | pct |
| ----------------------- | - | --- |
| **`LEXICON_COVERAGE`** | **11** | **68.75%** |
| `RETRY_RESEGMENTATION` | 3 | 18.75% |
| `RECALL_MATCHING` | 1 | 6.25% |
| `MODEL3_FALSE_KEEP` | 1 | 6.25% |

Eligible case 映射（摘要）：

| caseId | provenance | Model3 | FIRST_BREAKPOINT |
| ------ | ---------- | ------ | ---------------- |
| d008,d040,d042,d051,d054,d065,d085,d102,d109,d114,d175 | TARGET_NOT_IN_LEXICON | CORRECT_RETRY | LEXICON_COVERAGE |
| d022,d094,d138 | QUERY_NOT_REPAIR_CAPABLE | CORRECT_RETRY | RETRY_RESEGMENTATION |
| d129 | RECALL_TARGET_MISS | CORRECT_RETRY | RECALL_MATCHING |
| d172 | QUERY_NOT_REPAIR_CAPABLE | FALSE_KEEP | MODEL3_FALSE_KEEP |

---

## 6. Component audits（short）

### Retry

- Region 在 15/15 CORRECT_RETRY 上出现；query 已发出。
- Barriers：`secondDomainVote=0`，`model3Reinvoked=0`，无 path collapse / ownership contamination（acceptance hardGates）。
- Delta1 success-path 行为变化 = 0；Delta2 fallback window contract 全绿。
- 3 例 `RETRY_RESEGMENTATION`：正确 window/query 不足以表达 repair（provenance `QUERY_NOT_REPAIR_CAPABLE`），**不是** Anchor 穿越。
- **`RETRY_RESPONSIBILITY_ACCEPTANCE_PASS`**

### Recall / Lexicon

- 任意候选返回 ≠ 正确词命中。
- 11/16 eligible：`LEXICON_TERM_MISSING`（owner = Lexicon）。
- 1/16：`RECALL_MATCHING`（`d129`，term 侧有缺口信号但归 Recall matching）。
- cross-FineSpan Recall utility：**未证明**（hit=0）；**禁止**因此重开 Delta1/2 geometry。

### Domain / SameDomain

- 无 second Domain Vote；无 proven `DOMAIN_SCOPE_DROPPED_VALID_CANDIDATE`（因正确词从未到达）。

### Assembly / KenLM

- 正确 sentence 从未进入 pool → **不能**把 final=0 归因于 KenLM ranking。
- Cap：`crossPathOver16Cases=0`。

### Architecture drift

| Check | Count |
| ----- | ----- |
| second Domain Vote | 0 |
| Model3 re-invoke | 0 |
| Anchor crossing | 0 |
| New candidate owner type | 0 |

`ARCHITECTURE_DRIFT = NONE`（相对冻结职责；Evidence 层未发现 Model3/Retry 职责侵占）。

---

## 7. Responsibility acceptance

### Model3 — `MODEL3_RESPONSIBILITY_ACCEPTANCE_PASS`

- 输入为既有 Anchor + non-Anchor FineSpan；输出仅 KEEP/RETRY。
- 无 lexical recall / span 创建 / domain 决定 / final repair。
- Eligible 上 15/16 正确触发 RETRY；下游失败有明确其他 owner。
- **不以 final improvement rate 否决职责验收。**

### Retry — `RETRY_RESPONSIBILITY_ACCEPTANCE_PASS`

- Bounded region、barrier、无递归 Retry、无 ASR rerun、无 second Model3/Domain Vote。
- Delta1/2 维持；query geometry 到达 Recall。
- Recall hit=0 / lexicon miss **不**否决 Retry 职责。

---

## 8. Decision matrix

| Component | Architecture | Responsibility | Causal effectiveness | Blocking issue | Next action |
| --------- | ------------ | -------------- | -------------------- | -------------- | ----------- |
| Model3 | PASS | PASS | Trigger OK；final 0 | 1× FALSE_KEEP（非主阻塞） | `MODEL3_FINAL_ACCEPTANCE_AND_FREEZE` 候选 |
| Retry | PASS | PASS | Geometry OK；utility limited | 3× resegmentation | 保持冻结；不重开 Delta |
| Recall | PASS | PASS | 任意命中有；正确命中无 | 1× RECALL_MATCHING | 观察 |
| Lexicon | PASS | PASS | **主阻塞** | 11× TARGET_NOT_IN_LEXICON | **`LEXICON_COVERAGE_DELTA`** |
| Domain | PASS | PASS | Continuity OK | 无 proven | NONE |
| Assembly | PASS | PASS | 无正确词可组装 | 未达本层 | NONE |
| KenLM | PASS | PASS（scoring） | 无正确句可排 | 未达本层 | NONE |

---

## 9. A1 / promotion guard

Class-weight A1 曾改变 Model3/Retry/Recall，但 Assembly/KenLM/final **0/200**。本轮 **不**因任何 mid-funnel 指标 promotion A1。权威权重仍为 S3 baseline SHA 上述。

---

## 10. Next development rule（ONE delta）

**推荐唯一 delta：** `LEXICON_COVERAGE_DELTA`

禁止并行：retrain Model3、改 Retry、改 KenLM、抬 candidate cap。

若产品优先冻结 Model3 职责而非追 final utility：下一步改为 `MODEL3_FINAL_ACCEPTANCE_AND_FREEZE`（仍只选一个）。

---

## Artifacts

1. `Model3_V2_End_to_End_Causal_Effectiveness_Audit.md`（本文件）
2. `model3_causal_funnel.csv`
3. `model3_first_breakpoint_distribution.csv`
4. `model3_case_level_causal_trace.csv`
5. `model3_causal_audit_summary.json`
6. `model3_component_decision_matrix.csv`

---

## Final principle check

> Model3 是否正确履行冻结职责？ → **是**（eligible 上主要为 CORRECT_RETRY）。  
> 若 Model3 做对了，正确 repair 为何未到 final？ → **正确词不在 Lexicon / 少数 query 几何或 Recall matching 断裂**；Assembly/KenLM 未获正确候选。

**不要**因为 final 未改善而继续扩大 Model3 职责。
