# Lingua1 — Dialog200 End-to-End Correct-Candidate Funnel Audit V1

```text
MODE   = READ_ONLY / TRACE_FIRST / FULL_DATASET / NO_IMPLEMENTATION
PHASE  = LINGUA_DIALOG200_END_TO_END_CORRECT_CANDIDATE_FUNNEL_AUDIT_V1
RESULT = RESULT A — UPSTREAM RECALL / MODEL2 REMAINS PRIMARY BLOCKER
```

## 0. 一句话结论

在 dialog_200 全量、**生产默认 8/8** 下：`REPAIR_REQUIRED_EVALUABLE = 175`。正确 target 在 Recall/Model2 后仅 **57/175 = 32.57%** 出现；完整正确句进入 KenLM 仅 **6/175 = 3.43%**，且这 6 例最终均已正确（keep-raw / 脚本归一化路径，**不是** KenLM gate 挡住的失败）。失败 case 的最大 FIRST LOSS 是 **BASE_RECALL_OR_MODEL2（116/169 = 68.64%）**；第二质量损失在 **ASSEMBLY（51）**。  
**KenLM ranking / gate / sentence ≤16 / path cap 不是当前系统级主 blocker。**

```text
Q11 KenLM is primary blocker? = NO
NO PRODUCTION CHANGE
PATH_CAP / SENTENCE_CAP=16 / minDeltaToReplace=3.0 UNCHANGED
```

---

## 1. Methodology（必须读）

| Item | Value |
|------|-------|
| Corpus | `test wav/dialog_200` · 200 cases |
| PRIMARY path cap | **8/8** production default（未设置 `LINGUA_EXPERIMENT_MAX_*`） |
| Input mode | **LEXICON_MOCK_REPLAY** — ASR 取自冻结 dump `fresh_dialog200_raw_cases_dialog200_full_pipeline_20260909_001141.jsonl`（2026-09-09 live ASR） |
| Live ASR this session | **NOT USED**（本机 ASR service 不可用）；本审计度量的是 **后处理主链 funnel**，不是重新采样 ASR |
| Trace | `MODEL2_DIALOG200_TRACE=1` |
| Full-sentence equality | `norm(text) === norm(expectedText)`（去空白/标点） |
| Target-term evidence | `MATERIALIZABLE_TARGET_V1` correction units（`requires_lexical`） |
| Path observation | 本 replay **全部 `path_count=1`**（无 acoustic tone slices 时 multi-path 未展开）→ PRIMARY 下 PATH_CAP 损失几乎不可观测 |

```text
PRIMARY FUNNEL = 8/8 + frozen ASR replay through current postprocess
DIAGNOSTIC higher-cap = only 1 PATH_CAP suspect @32/32 → path still ABSENT
DOES NOT AUTHORIZE CAP CHANGE
```

---

## Table A — Dataset Accounting

| Metric | Count | % of 200 |
|--------|------:|---------:|
| TOTAL_CASES | 200 | 100 |
| ASR_ALREADY_CORRECT | 25 | 12.5 |
| REPAIR_REQUIRED_EVALUABLE | **175** | 87.5 |
| FINAL_CORRECT | 31 | 15.5 |
| FINAL_INCORRECT | 169 | 84.5 |
| UNEVALUABLE | 0 | 0 |

```text
ASR_ALREADY_CORRECT 不计入 repair funnel 成功。
Repair rescues among N0 = FINAL_CORRECT_on_repair = 6
(= 31 total final correct − 25 already-correct ASR)
```

---

## Table B — Full Funnel（denominator = N0 = 175）

| Stage | Present | % of N0 | Loss from previous* |
|-------|--------:|--------:|--------------------:|
| N0 Repair Required | 175 | 100 | — |
| N1 Target Recall Present | **57** | **32.57** | **118** |
| N2 Target Edge Present | 56 | 32.00 | 1 |
| N3 Path Pre-Cap Present | 56 | 32.00 | 0† |
| N4 Path Post-Cap Present | 56 | 32.00 | 0 |
| N5 Domain（PRESENT or N/A） | — | — | see note‡ |
| N6 SameDomain Evidence | 57 | 32.57 | — |
| N7 Correct Full Sentence Assembled | **6** | **3.43** | **51**（from recall-present cohort） |
| N8 Pre-Global-Cap Full Sentence | 6 | 3.43 | 0 |
| N9 Entered KenLM | **6** | **3.43** | **0** |
| N10 KenLM Rank1（correct sentence） | 6 | 3.43 | 0 |
| N11 Gate Accepted（replace） | 0 | 0 | 6§ |
| N13 Final Correct（repair subset） | 6 | 3.43 | — |

\* “Loss from previous” 仅对 applicable PRESENT→ABSENT 链有意义。  
† Pre-cap 在 `path_count=1` 且无 prune 证据时，与 post-cap 同值；**不能**据此宣称 PATH_CAP 已解决。  
‡ Domain：多数 target 为 base / 无 domain tag → `NOT_APPLICABLE`；不得用 N/A 稀释 N0。  
§ 6 例 Rank1 keep-raw 且 **FINAL_CORRECT**：`maxDelta=0`，正确句即 raw（脚本归一化后）。**不是** gate 挡住的失败。

---

## Table C — First Loss Distribution（failed repair = 169）

| First Loss | Count | % Failed | Primary Owner | Root Class |
|------------|------:|---------:|---------------|------------|
| **BASE_RECALL_OR_MODEL2** | **116** | **68.64** | Base Recall / Model2 PRE_LEXICAL_EDGE | DATA / TRAINING FAILURE |
| **ASSEMBLY** | **51** | **30.18** | Sentence Assembly | EXPECTED FAILURE / capability（有词无整句） |
| PATH_GENERATION | 1 | 0.59 | Lattice path enum | EXPECTED FAILURE |
| OBSERVABILITY_GAP | 1 | 0.59 | Path pre/post proof | OBSERVABILITY GAP |
| PATH_CAP | 0 | 0 | — | — |
| SENTENCE_CANDIDATE_BUDGET | 0 | 0 | — | — |
| KENLM_RANKING | 0 | 0 | — | — |
| KENLM_APPLY_GATE | 0 | 0（失败集） | — | — |
| MODEL3 | 0 | 0 | — | — |

```text
IMPLEMENTATION_DEFECT count = 0
Violation_demonstrated = NO for all first-loss owners in this audit
```

---

## Table D — Model2 Contribution（N0 = 175）

| Metric | Count | % of N0 |
|--------|------:|--------:|
| Base target recall | 54 | 30.86 |
| Model2 target recall（any non-base hit） | 8 | 4.57 |
| Model2-only recovery | 3 | 1.71 |
| Base AND Model2 | 5 | 2.86 |
| **No target after Model2** | **118** | **67.43** |
| Model2-only → Edge | 2 | — |
| Model2-only → Path post-cap | 2 | — |
| Model2-only → Full Assembly | 0 | — |
| Model2-only → KenLM | 0 | — |
| Model2-only → Final | 0 | — |
| Model2 as FIRST LOSS | 116 | 68.64% of failed |
| Failures **after** target recall PRESENT | 52 | 不得归因 Model2 |

**解读：** Model2-only 对 dialog_200 冻结 ASR 的净贡献极小（3 例出现 target；0 例到达完整句/KenLM/Final）。主缺口是 **target 根本未进入 candidate evidence**。

---

## Table E — KenLM Reachability（repair-required）

| Metric | Count | Notes |
|--------|------:|-------|
| Correct full sentence assembled | 6 | |
| Pre-global-cap present | 6 | |
| Entered KenLM | **6** | **6/175 = 3.43%** |
| Lost by global ≤16 | **0** | |
| KenLM Rank1 | 6 | |
| KenLM non-Rank1 | 0 | |
| Rank1 accepted (replace) | 0 | |
| Rank1 keep-raw & FINAL_CORRECT | 6 | delta=0；成功路径 |
| Rank1 gate-blocked **failures** | **0** | |
| KenLM runtime / zero-score failures | 0 | |

```text
KENLM_GATE_CALIBRATION_NOT_AUTHORIZED_FROM_THIS_AUDIT
（无足够 false-replacement / negative-control 分布；且 Rank1 失败样本为 0）
```

---

## Table F — Case Ledger

全量 200 行：

`docs/user_correction/model3/LINGUA_DIALOG200_END_TO_END_CORRECT_CANDIDATE_FUNNEL_TRACE_V1.jsonl`

字段含：`CASE_ID, ASR, EXPECTED, FINAL, MODEL2_TARGET_SOURCE, E1…E13, KENLM_RANK/DELTA/GATE, FIRST_LOSS, ROOT_CLASS`。

---

## DIAGNOSTIC_PATH_CAP_COUNTERFACTUAL（独立，不并入 PRIMARY）

| Case | 8/8 path post | 32/32 path post | Restored? |
|------|---------------|-----------------|-----------|
| d002 | ABSENT | ABSENT | NO |

```text
Suspects with recall PRESENT & post-cap ABSENT = 1
Higher-cap did not restore.
DIAGNOSTIC ONLY — DOES NOT AUTHORIZE CAP CHANGE
```

---

## Required Answers Q1–Q12

| Q | Answer |
|---|--------|
| **Q1** REPAIR_REQUIRED_EVALUABLE | **175** |
| **Q2** Target present after Recall/Model2 | **57 / 175 = 32.57%** |
| **Q3** Path pre-cap / post-8/8 | **56 / 56**（在 path_count=1 观测下等价；PATH_CAP 主损失未证明） |
| **Q4** Full correct sentence assembled | **6 / 175 = 3.43%** |
| **Q5** Full correct sentence entered KenLM | **6 / 175 = 3.43%** |
| **Q6** Among KenLM inputs: Rank1 / non-Rank1 / zero-score | **6 / 0 / 0**（且 6 例均为最终正确） |
| **Q7** Rank1 gate accept / reject-on-failure | **0 accept-replace；0 failure blocked by gate**（6 keep-raw 为成功） |
| **Q8** Largest FIRST LOSS | **BASE_RECALL_OR_MODEL2（116）** |
| **Q9** Model2 as FIRST LOSS share | **116 / 169 failed = 68.64%** |
| **Q10** Failures after Model2 target PRESENT | **52**（不得归因 Model2） |
| **Q11** 主 blocker 已移到 KenLM？ | **NO** |
| **Q12** 下一轮唯一 owner | **BASE_RECALL_OR_MODEL2**（次级观察：ASSEMBLY=51，不得并行开修） |

---

## Contract Comparisons（抽样）

### FIRST LOSS = BASE_RECALL_OR_MODEL2

```text
Observed:   required lexical correction units absent from base + Model2 union/after_model2
Frozen:     Model2 = PRE_LEXICAL_EDGE expansion; Base Recall + Model2 supply LexicalEdge material
Expectation: not guaranteed to cover every ASR error span
Violation demonstrated: NO
Class: DATA / TRAINING FAILURE（lexicon coverage / query capability / model yield）
```

### FIRST LOSS = ASSEMBLY

```text
Observed:   target term evidence PRESENT on retained path; full expected sentence never in assembly.sentences
Frozen:     SameDomain/base → per-span budget → path assembly → cross-path merge
Expectation: assembly may not reconstruct full reference from partial lexical hits
Violation demonstrated: NO
Class: EXPECTED FAILURE / capability boundary（整句物质化缺口，非 KenLM）
```

### KenLM Gate on the 6 successes

```text
Observed:   correct full sentence ≡ raw (post script-norm); maxDelta=0; pickedIsRaw=true; FINAL_CORRECT
Frozen:     minDeltaToReplace=3.0; keep raw when delta < gate
Violation demonstrated: NO
```

---

## Final Result Enum

```text
RESULT A — UPSTREAM RECALL / MODEL2 REMAINS PRIMARY BLOCKER
```

依据：
1. 118/175 在 N1 即无 target；
2. 116/169 失败的 PRIMARY FIRST LOSS = BASE_RECALL_OR_MODEL2；
3. KenLM 输入正确整句仅 6 例且全部最终正确；
4. Sentence budget / Path cap / KenLM ranking / KenLM gate **在失败集上计数为 0**。

次级质量悬崖：

```text
SECONDARY MASS LOSS = ASSEMBLY (51)
（有 target term，无完整正确句）
```

```text
NEXT OWNER (single) = BASE_RECALL_OR_MODEL2
NOT authorized this round: production code / threshold / cap / Model3 / Domain-guided path / geometry
```

---

## Artifacts（≤3）

1. `LINGUA_DIALOG200_END_TO_END_CORRECT_CANDIDATE_FUNNEL_AUDIT_V1.md`（本报告）
2. `LINGUA_DIALOG200_END_TO_END_CORRECT_CANDIDATE_FUNNEL_TRACE_V1.jsonl`
3. `LINGUA_DIALOG200_END_TO_END_CORRECT_CANDIDATE_FUNNEL_SUMMARY_V1.json`

Harness（可复现，不计 artifact 配额）：`electron_node/electron-node/tests/audit-dialog200-e2e-correct-candidate-funnel.mjs`

---

## Freeze

```text
NO PRODUCTION CHANGE
Cases are evidence. Contracts define behavior.
```
