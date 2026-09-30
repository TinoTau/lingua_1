# Lingua1 — Post-Path-Survival Final Correct First-Loss Trace Audit V1

```text
MODE   = READ_ONLY / TRACE_FIRST / NO_IMPLEMENTATION
PHASE  = LINGUA_POST_PATH_SURVIVAL_FINAL_CORRECT_FIRST_LOSS_TRACE_AUDIT_V1
RESULT = E — MULTIPLE INDEPENDENT ROOT CAUSES
         (all classified EXPECTED_FAILURE under Frozen SSOT; Violation=NO)
```

## 0. 一句话结论

对 known-7 中「diagnostic higher-cap 下 target path 已进 Domain Vote，但 FINAL_CORRECT=false」的 4 个 case：正确 evidence 均已越过 Segmentation；**第一次不可逆损失全部发生在 Domain Vote 之后**，且分属两类独立机制——**(A) 全局句候选 ≤16 截断**（1 case）与 **(B) KenLM `minDeltaToReplace=3.0` Apply Gate 拒写**（3 cases，其中 1 case 伴随 fail-open 全零分）。**未证明任何 Frozen SSOT implementation violation。**

```text
PATH_CAP_FINALIZATION     = DEFERRED   # THIS DOES NOT AUTHORIZE CAP CHANGE
GEOMETRY_PRESERVATION     = CLOSED
DOMAIN_GUIDED_PATH_CONTROL = NOT_AUTHORIZED
PRODUCTION FIX            = NOT AUTHORIZED THIS ROUND
```

---

## 1. Cohort（复用 path-budget known-7）

入选条件：

```text
Target LexicalEdge exists
AND Target SegmentationPath exists under diagnostic cap
AND Target Path reaches Domain Vote
AND FINAL_CORRECT = false
```

| Case | Target | Diagnostic cap | Vote retained | Final (wrong) |
|------|--------|----------------|---------------|---------------|
| `p2_u004_033` | 城门 | **12/12** | `tourism_route` | …与**层门**相关… |
| `p2_u005_015` | 提示符 | **12/12** | `tourism_pickup` | …和**提斯福**搭配… |
| `p2_u005_004` | 水道 | **16/16** | `tourism_pickup` | …**随道**的安排… |
| `p2_u004_010` | 行程图 | **32/32** | `tourism_route` | …**行层图**的保修… |

排除（≤32 仍无 Vote 几何）：过拟合 / 护士长 / 黄包车。

结构化产物：`_post_path_survival_first_loss_trace.json`  
Harness（可复现）：`electron_node/electron-node/tests/audit-post-path-survival-first-loss-trace.mjs`

---

## 2. Root Cause Matrix

| Case | E1 Path | E2 Domain | E3 SameDomain | E4 Assembly | E5 KenLM Input | E6 Post-KenLM | E7 Post-Model3 | E8 Final | First Loss | Class |
|------|---------|-----------|---------------|-------------|----------------|---------------|----------------|----------|------------|-------|
| 城门 | PRESENT | N/A (base) | PRESENT | PRESENT | PRESENT | ABSENT | N/A | ABSENT | **KENLM_APPLY_GATE / FAIL_OPEN** | EXPECTED_FAILURE |
| 提示符 | PRESENT | N/A (base) | PRESENT | PRESENT | **ABSENT** | N/A | N/A | ABSENT | **SENTENCE_CANDIDATE_BUDGET** | EXPECTED_FAILURE |
| 水道 | PRESENT | N/A (base) | PRESENT† | PRESENT | PRESENT | PRESENT (#1) | N/A | ABSENT | **KENLM_APPLY_GATE** | EXPECTED_FAILURE (+ DATA_MODEL delta) |
| 行程图 | PRESENT | PRESENT | PRESENT | PRESENT | PRESENT | PRESENT (#1) | N/A | ABSENT | **KENLM_APPLY_GATE** | EXPECTED_FAILURE (+ DATA_MODEL delta) |

† `after_model2_candidates` 按 geom 过滤曾漏检；**Assembly / KenLM pool 含「水道」**为更强证据 → E3 纠正为 PRESENT（非 OBSERVABILITY 停判）。

```text
FIRST_LOSS_DOMAIN_VOTE     = 0
FIRST_LOSS_SAMEDOMAIN      = 0
FIRST_LOSS_ASSEMBLY        = 0
FIRST_LOSS_SENTENCE_BUDGET = 1   # 提示符
FIRST_LOSS_KENLM_GATE      = 3   # 城门 / 水道 / 行程图
FIRST_LOSS_MODEL3          = 0
IMPLEMENTATION_DEFECT      = 0
ARCHITECTURE_GAP           = 0
OBSERVABILITY_GAP          = 0   # 可定位 FIRST LOSS
```

---

## 3. Case Ledgers（压缩）

### 3.1 `p2_u004_033` 城门

```text
ASR:      复查时请重点关注与层门相关的指标变化
EXPECTED: …城门…
FINAL:    …层门…   (identical to ASR)

E0–E5: PRESENT (base_term「城门」在 path candidates；Assembly 生成含城门句；进入 KenLM pool rank 3–4)
DOMAIN_VOTE: retained=[tourism_route]  # base target → E2 N/A
MODEL3 on geom: no overlapping decision/anchor in trace

KenLM:
  pool contains 城门 sentences
  all kenlmScore = 0, baselineRawScore = 0, subprocess_ms = 0
  maxDelta = 0 < minDeltaToReplace = 3.0
  pickedIsRaw = true
  top-3 = raw/层门 variants only (zero-tied)

FIRST_LOSS = KENLM_APPLY_GATE (fail-open zeros → gate keeps raw)
```

**Contract comparison**

```text
FIRST LOSS: KENLM_APPLY_GATE / FAIL_OPEN
Observed:   scoreBatch returns all-zero; maxDelta=0; pickedIsRaw
Frozen:     docs/fw-detector/kenlm/KENLM_RUNTIME.md — fail-open → scores 0; Gate minDeltaToReplace=3.0
Expectation: keep raw when delta < 3.0
Violation demonstrated: NO
CLASS: EXPECTED_FAILURE
```

True LM preference for「城门」在本 run **被 fail-open 清零掩盖**；不据此猜 production ranking bug。

---

### 3.2 `p2_u005_015` 提示符

```text
ASR/FINAL: 今天想试试和提斯福搭配的套餐

E1–E4: PRESENT
  - base_term「提示符」在 candidates
  - path Assembly 生成多条含「提示符」句 (assembly score 8.94)

E5: ABSENT
  - unique_before_cap ≈ 80+ (truncated_count=64), global_cap=16
  - KenLM pool top-16 全是「提斯福」变体 (assembly score 6.58)
  - 「提示符」句出现在 pruned，rank ≥ 33

KenLM on surviving pool: maxDelta≈0.74 < 3.0 → 即便未截断也可能拒写；
但 FIRST LOSS 仍是预算截断（正确句从未进入 KenLM 评分输入）。

FIRST_LOSS = SENTENCE_CANDIDATE_BUDGET (≠ Path Cap)
```

**Contract comparison**

```text
FIRST LOSS: SENTENCE_CANDIDATE_BUDGET
Observed:   mergeCrossPathSentenceCandidates first_wins + ≤16 drops target
Frozen:     orchestrator architectureCompliance candidateCap=16, dedupRetention=first_wins
Expectation: truncate after dedup; no target-protection clause
Violation demonstrated: NO
CLASS: EXPECTED_FAILURE
```

---

### 3.3 `p2_u005_004` 水道

```text
ASR/FINAL: …随道…
E1–E5: PRESENT (Assembly + KenLM pool 含「水道」)
E6: PRESENT — KenLM top#1 = 「…水道…」, deltaVsRaw = 1.768
E8: ABSENT — pickedIsRaw (1.768 < 3.0)

FIRST_LOSS = KENLM_APPLY_GATE
Owner:     rerankFwSentences (raw_log_delta + minDeltaToReplace)
```

**Contract comparison**

```text
FIRST LOSS: KENLM_APPLY_GATE
Observed:   best candidate is target; maxDelta=1.768 < 3.0 → keep ASR「随道」
Frozen:     minDeltaToReplace=3.0 (FROZEN); pick = argmax rawDelta then gate
Expectation: refuse replace when delta < 3.0
Violation demonstrated: NO
CLASS: EXPECTED_FAILURE
Secondary: DATA_MODEL_DELTA_INSUFFICIENT (LM margin 1.77 < gate 3.0)
```

禁止 case-derived bonus / 降 threshold 作为本轮结论。

---

### 3.4 `p2_u004_010` 行程图

```text
ASR/FINAL: …行层图…
E1–E6: PRESENT — domain_term「行程图」∈ tourism_route ∩ retained;
        KenLM top#1 = 「…行程图…」, deltaVsRaw = 1.778
E8: ABSENT — pickedIsRaw

FIRST_LOSS = KENLM_APPLY_GATE
CLASS: EXPECTED_FAILURE (+ DATA_MODEL_DELTA_INSUFFICIENT)
Violation demonstrated: NO
```

与水道同构。

---

## 4. Stage 审计摘要（跨 case）

### Domain Vote
- 4/4 target path 进入 path-scoped Vote；均有 `retainedDomains`。
- 城门/提示符/水道 为 **base_term**（无 domain tag）→ 正确 surface **不依赖** retained domain（E2=N/A）。
- 行程图为 `domain_term` + `tourism_route`，且 retained 含该 domain → E2 PRESENT。
- **无 FIRST_LOSS @ Domain Vote。**

### SameDomain
- 无证据表明 path-level bucket 被错误 merge。
- base / sameDomain 池足以支撑后续 Assembly（水道以 Assembly 证据纠正 cand 过滤漏检）。
- **无 FIRST_LOSS @ SameDomain。**

### Assembly
- 4/4 均组装出含 target surface 的句子（提示符亦组装成功，后在全局预算死亡）。
- **无 FIRST_LOSS @ per-path Assembly 组合规则。**

### Sentence budget（≠ Path Cap）
- 仅提示符：path 已存活，正确句死于 **global ≤16**。
- **FIRST_LOSS_SENTENCE_BUDGET = 1。**

### KenLM
- Contract = **cross-path scorer + Apply Gate**（非 hard filter 删句）。
- 水道/行程图：target 已是 KenLM #1，Gate 拒写。
- 城门：fail-open 全零分 → Gate 拒写。
- **无 Frozen scoring formula 违例证明。**

### Model3
- 本 cohort geom 上无可用 KEEP/RETRY 决策证明其删除正确句。
- 正确句在 Model3 之后仍进入 Assembly/KenLM → **非 FIRST LOSS。**
- Anchor sufficiency 问题：**本 cohort 未 trace 证明**，不预设。

### Final owner
```text
Owner function: rerankFwSentences → pickedIsRaw / picked
Input set:      rawText + ≤16 prefilledCombinations
Decision:       max rawDelta >= minDeltaToReplace ? pick candidate : keep raw
```

---

## 5. Systemic Blocker Gate

```text
SYSTEMIC_BLOCKER = NO
```

理由：
1. 两个独立 FIRST LOSS 族（Budget vs KenLM Gate），不可强行合并；
2. KenLM Gate 两例同构，但是 **contract-correct**，不是 SSOT violation；
3. 不满足「修复方向由 SSOT 推导出 production code restore」——当前行为即 SSOT。

```text
NO_SINGLE_SYSTEMIC_BLOCKER
```

---

## 6. Patch-Risk Audit（只记录，不删除）

| Finding | Authority |
|---------|-----------|
| `minDeltaToReplace=3.0` | LEGITIMATE CONTRACT IMPLEMENTATION |
| KenLM fail-open → scores 0 | LEGITIMATE CONTRACT IMPLEMENTATION |
| Global sentence cap ≤16 first_wins | LEGITIMATE CONTRACT IMPLEMENTATION |
| Experiment env `LINGUA_EXPERIMENT_MAX_*` | DIAGNOSTIC ONLY — not production |
| Case-specific bonus / phrase boost | NOT FOUND in this audit path |

---

## 7. 最终结果

```text
RESULT E — MULTIPLE INDEPENDENT ROOT CAUSES
```

| # | First Loss | Cases | Class | Owner |
|---|------------|-------|-------|-------|
| 1 | SENTENCE_CANDIDATE_BUDGET | 提示符 | EXPECTED_FAILURE | `mergeCrossPathSentenceCandidates` |
| 2 | KENLM_APPLY_GATE (delta&lt;3) | 水道, 行程图 | EXPECTED_FAILURE (+ DATA_MODEL margin) | `rerankFwSentences` |
| 3 | KENLM_APPLY_GATE / FAIL_OPEN zeros | 城门 | EXPECTED_FAILURE | KenLM scorer fail-open + gate |

```text
IMPLEMENTATION_DEFECT FOUND = NO
ARCHITECTURE_GAP            = NO
OBSERVABILITY INSUFFICIENT  = NO (FIRST LOSS located)
```

### 强制四问（cohort 级）

| Question | Answer |
|----------|--------|
| WHAT IS THE FIRST LOSS? | (1) Global sentence ≤16 truncation **or** (2) KenLM Apply Gate `minDeltaToReplace=3.0` |
| WHO OWNS IT? | (1) Cross-path merge **or** (2) `rerankFwSentences` |
| WHAT FROZEN CONTRACT? | KenLM Runtime Batch-Only + Gate 3.0；`candidateCap≤16` first_wins |
| IS THAT CONTRACT VIOLATED? | **NO** |

---

## 8. USER DECISION REQUIRED（RESULT E）

本轮**不得**同时推进多个模块。候选下一 owner（只列，不选）：

```text
NEXT OWNER CANDIDATES =

1. SENTENCE_CANDIDATE_BUDGET
   - 仅影响「提示符」类：正确句已组装但被 ≤16 挤出
   - 下一轮若动：必须先有 Frozen SSOT 变更授权（排序/配额），禁止 case-derived keep

2. KENLM_APPLY_GATE / DATA_MODEL_DELTA
   - 水道/行程图：KenLM 已认对，但 delta≈1.77 < 3.0
   - 方向只允许：DATA/TRAINING AUDIT 或 用户授权的 Architecture Decision（改 Gate）
   - 禁止：if target then boost；禁止本轮改 3.0

3. KENLM FAIL_OPEN (城门)
   - 先做 KenLM subprocess/score 可观测性最小补强（若需证明非偶发 fail-open）
   - 在证明 scorer 应成功而代码违约之前，不得当 IMPLEMENTATION DEFECT
```

```text
PATH_CAP CHANGE           = NOT AUTHORIZED
THRESHOLD CHANGE          = NOT AUTHORIZED
DOMAIN/MODEL3/ASSEMBLY FIX = NOT AUTHORIZED THIS ROUND
```

---

## 9. Artifacts（≤3）

1. `docs/user_correction/model3/LINGUA_POST_PATH_SURVIVAL_FINAL_CORRECT_FIRST_LOSS_TRACE_AUDIT_V1.md`（本报告）
2. `docs/user_correction/model3/_post_path_survival_first_loss_trace.json`（ledger + KenLM gate 细节）
3. `electron_node/electron-node/tests/audit-post-path-survival-first-loss-trace.mjs`（diagnostic harness）

---

## 10. Freeze 确认

```text
NO CODE CHANGED
NO SSOT CHANGED
NO THRESHOLD CHANGED
NO PATH CAP PRODUCTION CHANGE
CASES ARE EVIDENCE; CONTRACTS DEFINE BEHAVIOR
```
