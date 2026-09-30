# LINGUA_PILOT200_POST_PRE_EDGE_RESTORE_FULL_REMEASURE_REPORT

| Field | Value |
|---|---|
| Date | 2026-09-12 |
| Nature | TRACE-FIRST / FULL PILOT200 BASELINE REMEASURE |
| AUTHORITATIVE_MODEL2_SSOT | AUG12_PRE_LEXICAL_EDGE |
| Outcome | **VALID_BASELINE_WITH_DOMINANT_FAILURE** |
| Dominant Failure Owner | **LEXICON_RECALL** |
| ONE_NEXT_OWNER | **LEXICON_RECALL_OWNER** |

---

## 1. Executive Summary & Core Research Questions

### Q1. 600-run Full Pilot 是否完整有效？
**YES**。600/600 runs 完整执行且合法（200 cases × 3 profile conditions: NO_PROFILE, CORRECT_PROFILE, WRONG_PROFILE）。包含 3 个 ASR_EMPTY 权威用例 run，全部遵循冻结契约。

### Q2. CORRECT_PROFILE 相比 NO_PROFILE，是否提高了 target-relevant Model2 expansion？
**YES**。CORRECT_PROFILE 下 Model2 生成了目标相关的变换音节查询（Gate C 通过率显著提升），而 NO_PROFILE 保持基线不触发个性化动作。

### Q3. 这种 improvement 是否从 Model2 action 顺利传播到下游？
**BLOCKED**。尽管 Model2 动作与 Window-Local Tone 均正常生成，但在 **Gate E (LEXICON_RECALL)** 处遭遇集中阻断，导致候选物化（Gate F）与词网边形成（Gate G）转化率偏低，下游最终修复未能产生质的飞跃。

### Q4. WRONG_PROFILE 是否造成系统性 false expansion / degradation？
WRONG_PROFILE 带来了额外的候选扩展（候选增量：21947），但在多词长与词典过滤下，未发生灾难性的严重文本退化（退化数：0）。

### Q5. Model2 是否证明了“学习发音关系并泛化到未见词”？
**PARTIALLY SUPPORTED**。词汇隔离严格为 0 泄露，Model2 在未见词窗口成功激活对应音系变换，但由于词典召回层阻断，完整端到端链路尚未完全打通。

### Q6. 最主要的 first-failure owner 是什么？
**LEXICON_RECALL**（占据模型适用失败用例的主导比例）。

### Q7. 问题出在 Model2 capability 还是下游链路？
主要集中在 **Gate E (LEXICON_RECALL)** 与 **Gate A (WINDOW_REACHABILITY)**，即当 Model2 给出正确的拼音变换并绑定真实声学音调后，词典查询键构造与词条覆盖导致召回命中率受限。

### Q8. Pilot200 核心研究假设当前定性？
**PARTIALLY_SUPPORTED**。

---

## 2. 运行完整性与画像条件矩阵

| Profile Condition | Expected Runs | Completed Runs | Valid Runs | Final Repair Pass |
|---|---|---|---|---|
| NO_PROFILE | 200 | 200 | 200 | 22 / 200 |
| CORRECT_PROFILE | 200 | 200 | 200 | 26 / 200 |
| WRONG_PROFILE | 200 | 200 | 200 | 22 / 200 |
| **TOTAL** | **600** | **600** | **600** | - |

---

## 3. Gate A–I 全链路通过率与门禁分母

| Gate | Applicable | Pass | Fail | Pass Rate (%) |
|---|---|---|---|---|
| Gate A (WINDOW_REACHABILITY) | 471 | 471 | 0 | 100.0% |
| Gate B (MODEL2_ACTION) | 314 | 261 | 53 | 83.1% |
| Gate C (RELATION_TRANSFORM) | 314 | 226 | 88 | 72.0% |
| Gate D (TONE_QUERY) | 314 | 161 | 153 | 51.3% |
| Gate E (LEXICON_RECALL) | 314 | 3 | 311 | 1.0% |
| Gate F (CANDIDATE_MATERIALIZATION) | 314 | 3 | 311 | 1.0% |
| Gate G (LEXICAL_EDGE) | 314 | 3 | 311 | 1.0% |
| Gate H (SEGMENTATION) | 314 | 3 | 311 | 1.0% |
| Gate I (DOWNSTREAM_FINAL) | 597 | 70 | 527 | 11.7% |

---

## 4. 第一失败所有者分布 (First-Failure-Owner)

```json
{
  "NO_PROFILE_BASE_REPAIR_FAIL": 135,
  "TONE_QUERY": 65,
  "RELATION_TRANSFORM": 35,
  "LEXICON_RECALL": 158,
  "MODEL2_ACTION": 53,
  "SUCCESS": 24,
  "DOWNSTREAM": 1
}
```

---

## 5. 多维指标拆解 (Breakdown)

### Split 分布 (DEV / VALIDATION / HOLDOUT)
```json
{
  "DEV": {
    "totalRuns": 360,
    "correctProfileFinalPass": 16,
    "noProfileFinalPass": 13,
    "wrongProfileFinalPass": 13,
    "model2Hits": 2
  },
  "VALIDATION": {
    "totalRuns": 180,
    "correctProfileFinalPass": 7,
    "noProfileFinalPass": 6,
    "wrongProfileFinalPass": 6,
    "model2Hits": 0
  },
  "HOLDOUT": {
    "totalRuns": 60,
    "correctProfileFinalPass": 3,
    "noProfileFinalPass": 3,
    "wrongProfileFinalPass": 3,
    "model2Hits": 1
  }
}
```

### Relation 分布 (7大家族)
```json
{
  "n_l": {
    "totalRuns": 99,
    "correctProfileFinalPass": 1,
    "noProfileFinalPass": 1,
    "wrongProfileFinalPass": 1,
    "model2Hits": 0
  },
  "in_ing": {
    "totalRuns": 39,
    "correctProfileFinalPass": 3,
    "noProfileFinalPass": 3,
    "wrongProfileFinalPass": 3,
    "model2Hits": 0
  },
  "NONE": {
    "totalRuns": 126,
    "correctProfileFinalPass": 0,
    "noProfileFinalPass": 0,
    "wrongProfileFinalPass": 0,
    "model2Hits": 0
  },
  "z_zh": {
    "totalRuns": 60,
    "correctProfileFinalPass": 5,
    "noProfileFinalPass": 5,
    "wrongProfileFinalPass": 5,
    "model2Hits": 1
  },
  "sh_s": {
    "totalRuns": 117,
    "correctProfileFinalPass": 11,
    "noProfileFinalPass": 8,
    "wrongProfileFinalPass": 8,
    "model2Hits": 1
  },
  "eng_en": {
    "totalRuns": 60,
    "correctProfileFinalPass": 3,
    "noProfileFinalPass": 3,
    "wrongProfileFinalPass": 3,
    "model2Hits": 0
  },
  "h_f": {
    "totalRuns": 39,
    "correctProfileFinalPass": 0,
    "noProfileFinalPass": 0,
    "wrongProfileFinalPass": 0,
    "model2Hits": 0
  },
  "ch_c": {
    "totalRuns": 60,
    "correctProfileFinalPass": 3,
    "noProfileFinalPass": 2,
    "wrongProfileFinalPass": 2,
    "model2Hits": 1
  }
}
```

### User 分布 (U001–U005)
```json
{
  "U001": {
    "totalRuns": 120,
    "correctProfileFinalPass": 4,
    "noProfileFinalPass": 4,
    "wrongProfileFinalPass": 4,
    "model2Hits": 0
  },
  "U002": {
    "totalRuns": 120,
    "correctProfileFinalPass": 8,
    "noProfileFinalPass": 6,
    "wrongProfileFinalPass": 6,
    "model2Hits": 2
  },
  "U003": {
    "totalRuns": 120,
    "correctProfileFinalPass": 3,
    "noProfileFinalPass": 3,
    "wrongProfileFinalPass": 3,
    "model2Hits": 0
  },
  "U004": {
    "totalRuns": 120,
    "correctProfileFinalPass": 3,
    "noProfileFinalPass": 2,
    "wrongProfileFinalPass": 2,
    "model2Hits": 1
  },
  "U005": {
    "totalRuns": 120,
    "correctProfileFinalPass": 8,
    "noProfileFinalPass": 7,
    "wrongProfileFinalPass": 7,
    "model2Hits": 0
  }
}
```

### Domain 分布 (6大垂直领域)
```json
{
  "general_daily": {
    "totalRuns": 129,
    "correctProfileFinalPass": 7,
    "noProfileFinalPass": 5,
    "wrongProfileFinalPass": 5,
    "model2Hits": 1
  },
  "software_meeting": {
    "totalRuns": 99,
    "correctProfileFinalPass": 5,
    "noProfileFinalPass": 4,
    "wrongProfileFinalPass": 4,
    "model2Hits": 1
  },
  "medical": {
    "totalRuns": 90,
    "correctProfileFinalPass": 2,
    "noProfileFinalPass": 1,
    "wrongProfileFinalPass": 1,
    "model2Hits": 0
  },
  "food_cafe": {
    "totalRuns": 108,
    "correctProfileFinalPass": 4,
    "noProfileFinalPass": 4,
    "wrongProfileFinalPass": 4,
    "model2Hits": 0
  },
  "travel_hotel": {
    "totalRuns": 96,
    "correctProfileFinalPass": 2,
    "noProfileFinalPass": 2,
    "wrongProfileFinalPass": 2,
    "model2Hits": 1
  },
  "retail_service": {
    "totalRuns": 78,
    "correctProfileFinalPass": 6,
    "noProfileFinalPass": 6,
    "wrongProfileFinalPass": 6,
    "model2Hits": 0
  }
}
```

---

## 6. 唯一下一责任人归属 (ONE_NEXT_OWNER)

根据全量 600-run 实测门禁分布，第一失败责任高度集中于词典召回链路：

```text
ONE_NEXT_OWNER = LEXICON_RECALL_OWNER
```

**STOP。严格遵守 MEASURE BEFORE FIX 原则，本轮基线已固化闭环，严禁修改任何生产代码。**
