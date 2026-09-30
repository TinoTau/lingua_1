# LINGUA_PILOT200_POST_PRE_EDGE_RESTORE_FULL_REMEASURE_REPORT

| Field | Value |
|---|---|
| Date | 2026-09-12 |
| Nature | TRACE-FIRST / FULL PILOT200 BASELINE REMEASURE |
| Execution Mode | **PARTIAL** (NON-AUTHORITATIVE PARTIAL / PROBE RUN) |
| AUTHORITATIVE_MODEL2_SSOT | AUG12_PRE_LEXICAL_EDGE |
| Outcome | **RUN_INCOMPLETE** |
| Dominant Failure Owner | **NOT_COMPUTED_FOR_INCOMPLETE_BASELINE** |
| ONE_NEXT_OWNER | **PILOT200_POST_PRE_EDGE_RESTORE_FULL_REMEASURE** |

> ⚠️ **GOVERNANCE WARNING: PARTIAL / PROBE RUN (NON-AUTHORITATIVE)**
> 本次运行为局部探针或非完整运行（6/600 runs, 2/200 cases）。
> 运行结果已根据治理契约自动 Fail-Closed（outcome = RUN_INCOMPLETE）。所有指标仅供调试，严禁作为正式 Pilot 研究结论。

---

## 1. Executive Summary & Core Research Questions

### Q1. 600-run Full Pilot 是否完整有效？
**NO**。本次仅执行了 6/600 runs（覆盖 2/200 cases）。运行状态为 **RUN_INCOMPLETE**，本次测量结果为非权威局部探针数据（NON_AUTHORITATIVE）。

### Q2. CORRECT_PROFILE 相比 NO_PROFILE，是否提高了 target-relevant Model2 expansion？
*[NON-AUTHORITATIVE PARTIAL OBSERVATION]* 局部观察中 CORRECT_PROFILE 产生了 0 次扩展，但非完整基线无法提供权威对比。

### Q3. 这种 improvement 是否从 Model2 action 顺利传播到下游？
*[NON-AUTHORITATIVE PARTIAL OBSERVATION]* 局部执行未完成全量传播验证，第一阻断点待全量基线确认。

### Q4. WRONG_PROFILE 是否造成系统性 false expansion / degradation？
*[NON-AUTHORITATIVE PARTIAL OBSERVATION]* 局部探针中 WRONG_PROFILE 候选增量为 115，退化数为 0。

### Q5. Model2 是否证明了“学习发音关系并泛化到未见词”？
*[NOT EVALUATED]* 基线未完整执行，泛化性假设无法定性。

### Q6. 最主要的 first-failure owner 是什么？
*[NOT COMPUTED FOR INCOMPLETE BASELINE]* 主导失败所有者需在 600 全量基线完成后统计。当前局部计数为 {"NO_PROFILE_BASE_REPAIR_FAIL":1,"TONE_QUERY":1,"RELATION_TRANSFORM":1}

### Q7. 问题出在 Model2 capability 还是下游链路？
*[NOT EVALUATED]* 归因分析需在完整基线数据上进行。

### Q8. Pilot200 核心研究假设当前定性？
**NOT_EVALUATED**（完整基线尚未完成，禁止在局部数据上下假说结论）。

---

## 2. 运行完整性与画像条件矩阵

| Profile Condition | Expected Runs | Completed Runs | Valid Runs | Final Repair Pass |
|---|---|---|---|---|
| NO_PROFILE | 2 | 2 | 2 | 0 / 2 |
| CORRECT_PROFILE | 2 | 2 | 2 | 0 / 2 |
| WRONG_PROFILE | 2 | 2 | 2 | 0 / 2 |
| **TOTAL** | **6** | **6** | **6** | - |

---

## 3. Gate A–I 全链路通过率与门禁分母

| Gate | Applicable | Pass | Fail | Pass Rate (%) |
|---|---|---|---|---|
| Gate A (WINDOW_REACHABILITY) | 3 | 3 | 0 | 100.0% |
| Gate B (MODEL2_ACTION) | 2 | 2 | 0 | 100.0% |
| Gate C (RELATION_TRANSFORM) | 2 | 1 | 1 | 50.0% |
| Gate D (TONE_QUERY) | 2 | 0 | 2 | 0.0% |
| Gate E (LEXICON_RECALL) | 2 | 0 | 2 | 0.0% |
| Gate F (CANDIDATE_MATERIALIZATION) | 2 | 0 | 2 | 0.0% |
| Gate G (LEXICAL_EDGE) | 2 | 0 | 2 | 0.0% |
| Gate H (SEGMENTATION) | 2 | 0 | 2 | 0.0% |
| Gate I (DOWNSTREAM_FINAL) | 3 | 0 | 3 | 0.0% |

---

## 4. 第一失败所有者分布 (First-Failure-Owner)

```json
{
  "NO_PROFILE_BASE_REPAIR_FAIL": 1,
  "TONE_QUERY": 1,
  "RELATION_TRANSFORM": 1
}
```

---

## 5. 多维指标拆解 (Breakdown)

### Split 分布 (DEV / VALIDATION / HOLDOUT)
```json
{
  "DEV": {
    "totalRuns": 6,
    "correctProfileFinalPass": 0,
    "noProfileFinalPass": 0,
    "wrongProfileFinalPass": 0,
    "model2Hits": 0
  }
}
```

### Relation 分布 (7大家族)
```json
{
  "n_l": {
    "totalRuns": 6,
    "correctProfileFinalPass": 0,
    "noProfileFinalPass": 0,
    "wrongProfileFinalPass": 0,
    "model2Hits": 0
  }
}
```

### User 分布 (U001–U005)
```json
{
  "U001": {
    "totalRuns": 6,
    "correctProfileFinalPass": 0,
    "noProfileFinalPass": 0,
    "wrongProfileFinalPass": 0,
    "model2Hits": 0
  }
}
```

### Domain 分布 (6大垂直领域)
```json
{
  "general_daily": {
    "totalRuns": 6,
    "correctProfileFinalPass": 0,
    "noProfileFinalPass": 0,
    "wrongProfileFinalPass": 0,
    "model2Hits": 0
  }
}
```

---

## 6. 唯一下一责任人归属 (ONE_NEXT_OWNER)

根据治理契约，当前评估状态：**RUN_INCOMPLETE**
唯一下一责任人指派：

```text
ONE_NEXT_OWNER = PILOT200_POST_PRE_EDGE_RESTORE_FULL_REMEASURE
```
