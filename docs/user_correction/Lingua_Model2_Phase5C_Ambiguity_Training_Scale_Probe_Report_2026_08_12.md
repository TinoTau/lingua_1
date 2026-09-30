# Lingua Model2 Phase 5C — Ambiguity Training Scale Probe Report

| Field | Value |
|-------|-------|
| Date | 2026-08-12 |
| Nature | **2k–5k Training Scale Dataset + Dataset Gate**（非正式 10k–20k Baseline） |
| TTS source | 真实 Piper → acoustic corruption → production faster-whisper-vad |
| Output | `training/model2/dataset/training_scale_v1/` |
| Markers | `TRAINING_SCALE_PROBE` / `NOT_FOR_RUNTIME` / `NOT_FROZEN` |
| Verdict | **FAIL / STOP（不得进入 10k–20k；本轮未训练模型）** |
| Failure class | **DATA**（TTS TERM_POSITIVE 上 deterministic distance 仍整体饱和） |

---

## 1. Executive Summary

本轮生成了 **3000** 条真实 TTS/ASR utterance（未复制 Probe rows），并建成 TrainRows。

Dataset Gate **FAIL**，因此 **未训练 M0/M1**（遵守“先 STOP，不要用神经网络掩盖数据问题”）。

| 项 | 结果 |
|----|------|
| Utterances | 3000 / 3000 TTS+ASR 成功；0 failed |
| TERM_POSITIVE | 2247（train 1766 / val 233 / test 248） |
| unseen-term val / test | 231 / 248（≥50） |
| FuzzyPool Recall@16 | **100%** |
| TARGET_IN_LEXICON | **100%** |
| user/term leakage（TERM_POSITIVE） | **0** |
| N2 non-empty NO_CHANGE | **887** |
| B_pool_distance R@1（TTS all） | **0.982 ≥ 0.98 → 饱和 STOP** |
| 真正 EQUAL_DISTANCE | **126**（该 slice 上 baseline R@1=**0.683**） |
| distance rank>0 | 仅 **40** 条 |
| RULE_SYNTHETIC（独立） | 335；其中 pool 内 321，rank>0 = **298**（不作 TTS 主指标） |

**结论：** 扩大到 3k 真实 TTS **没有**把 overall distance baseline 拉下饱和线。问题不是模型，而是 **canonical Piper + ASR 误差仍然落在 target 的唯一最近邻上**。不得靠扩到 20k 掩盖。

---

## 2. Phase5B Preconditions

保持：可训练 Dual Encoder、MASK、term_id stress、141K 参数、NO_MATCH/HN 机制、FuzzyPool V1 `d≤2 cap=16`、Stage A 不训 phonetic/tone。本轮 **未改模型架构**。

---

## 3. Why Scale Dataset Is Needed

Phase 5B：`B_pool_distance` R@1=1.0。无法证明 learned ranking 相对启发式有业务增益。本轮目标是制造 **FuzzyPool Ambiguity**。

---

## 4. Dataset Generation Scope

| 项 | 值 |
|----|----|
| planned utterances | **3000**（目标约 3k；区间 2k–5k） |
| pseudo groups | **150** |
| target terms | **588** unique domain terms（lexicon 上限；未灌水复制） |
| carriers | **55** `{TERM}` + 5 background |
| 未重跑 Probe TTS | 是；独立目录 `training_scale_v1/` |
| wall | 3726 s；TTS avg 294 ms；ASR avg 753 ms |

禁止项均遵守：无人工改 ASR 当 TTS_ASR_SYNTHETIC。

---

## 5. Carrier Expansion

`carrier_templates_v2.jsonl`：55 个结构模板（预订/送达/集合/会议/餐饮/行程等）。禁止 `{TERM}` 重复。3 条因 context leak 被 plan 拦截。

---

## 6. Target Term Expansion

588 unique domain terms（2–5 字）。未达 1000：lexicon domain 非 alias 去重后只有这些。未用复制句+不同 noise 灌水。

---

## 7. Ambiguous Term Inventory

`ambiguity_inventory.jsonl`：对 588 个 domain term 跑冻结 FuzzyPool V1。

| 预采样标签（d1≥4 或高 prior 邻居） | n |
|----------------------------------|---|
| prefer_ambiguous | 446 |
| control | 142 |

**发现：** 几乎所有 term 的 **自身 pinyin pool** 都有 15 个邻居（cap=16）。这只说明 lexicon 稠密，**不**等于 ASR span 会变成 equal-distance query。

---

## 8. Ambiguity Taxonomy

V1 类：

| Class | 定义（修正后） |
|-------|----------------|
| EQUAL_DISTANCE | target 与至少一个 distractor 同 distance（非 unique nearest） |
| NEAR_TIE | 非 unique 且 gap≤1 |
| NON_AMBIGUOUS | **unique nearest**（即使 runner-up 为 d+1） |

初版曾把 gap=1 的 unique nearest 标成 NEAR_TIE，造成 90%“难例”假象。已修正：unique nearest = NON_AMBIGUOUS。

TTS TERM_POSITIVE 重标后：

| Class | n |
|-------|---|
| NON_AMBIGUOUS | 2121 |
| EQUAL_DISTANCE | 126 |
| NEAR_TIE | 0 |

---

## 9. Ambiguity Score

derived（不进模型）：`num_candidates_at_best_distance`、`score_gap_target_vs_best_other`、`num_candidates_within_margin`、`pool_entropy_proxy`、`target_is_unique_nearest`。

TTS：unique_nearest=2119；gap=0 仅 126。

---

## 10. Dataset Sampling Strategy

Plan：65% prefer_ambiguous terms、35% control；val/test 预分配 10%/10%；user×term 只配对同 split。  
结果：ASR 误差仍把绝大多数 query 变成 unique nearest。**预采样 term 的邻居密度 ≠ 生成后 span 的 ranking 歧义。**

---

## 11. Positive Statistics

| | n |
|--|---|
| POSITIVE 总 | 4749（含 RULE 335） |
| TERM_POSITIVE（TTS 主任务） | **2247** |
| train / val / test | 1766 / 233 / 248 |
| ASR error rate | 83.3%（2500/3000） |

---

## 12. Non-Term Positive Statistics

`ignored_non_term_positive_count` = **2167**（与 TERM_POSITIVE 几乎 1:1）。

说明大量 TTS/ASR 误差是 **字级/繁简/格式**，不是 lexicon candidate recall。未用它们填 Model2 主 loss。比例过高 → 报告为 DATA 特征，不是训练规模。

---

## 13. Negative N1/N2 Statistics

| Type | n | 含义 |
|------|---|------|
| N1 Empty Pool | 73 | 背景句 / 无 term span |
| N2 Non-empty NO_CHANGE | **887** | 正确 term span，pool 有邻居；教 NO_MATCH |

N2 构造：ASR 已含 target 时，`source_span=target_term`（不改 FuzzyPool 算法）。Phase 5B 全空 pool 问题已缓解。

---

## 14. Hard Negative Native/Injected Statistics

| | n |
|--|---|
| HN_NATIVE | **0** |
| HN_INJECTED | 3000 |
| HN_TOTAL | 3000 |

Personal term 几乎从不自然进入 ASR span 的 phonetic pool（与 5A/5B 一致）。Injected 保留且 **分开统计**。

---

## 15. Split Strategy

生成前 user-disjoint + term-disjoint 配对。结果 80/10/10 量级：TERM_POSITIVE 1766/233/248。  
TERM_POSITIVE 上 train∩val / train∩test term overlap = **0**；user leaks = 0。

---

## 16. Unseen-Term Sample Counts

| | n |
|--|---|
| unseen-term val TERM_POSITIVE | **231** |
| unseen-term test TERM_POSITIVE | **248** |

Gate ≥50：**PASS**。

---

## 17. Context Leakage Audit

`context_target_leak`：target 出现在 left/right context。  
count=**2**（默认不进主训/评）。Plan 阶段拦截 3 条重复 carrier。

---

## 18. FuzzyPool Visibility

| 指标 | 值 |
|------|-----|
| Recall@16 | **1.0** |
| TARGET_IN_LEXICON | **1.0** |
| TARGET_OOV | **0** |
| ExactMiss→FuzzyHit | 2218 |
| ExactHit→FuzzyHit | 29 |
| ExactMiss→FuzzyMiss | 0 |
| Python pool P95 | 60 ms（Known Deferred；非训练阻塞） |

---

## 19. Distance Baseline Saturation Check

**TTS TERM_POSITIVE（主指标）：**

| Baseline | n | R@1 | R@3 | MRR |
|----------|---|-----|-----|-----|
| B_pool_distance | 2245 | **0.982** | 0.998 | 0.990 |
| B_pool_prior | 2245 | 0.376 | 0.761 | 0.578 |
| B_exact span-in-lexicon | 2245 | 1.3% exact hit | — | — |

**EQUAL_DISTANCE slice（n=126）：** B_pool_distance R@1=**0.683**（此 slice 不饱和）。  
**distance rank>0：** 仅 40 条。

整体 R@1≥0.98 → **STOP**。

---

## 20. Dataset Gate Result

| Gate | 结果 |
|------|------|
| 2k–5k utterances | PASS |
| 未复制 Probe | PASS |
| leakage=0 | PASS |
| TERM_POSITIVE 足够 | PASS（2247） |
| unseen val/test≥50 | PASS |
| FuzzyPool≥95% | PASS |
| TARGET_IN_LEXICON≈100% | PASS |
| ambiguous 占比足够（≥25%） | **FAIL**（126/2245=5.6%） |
| distance 不饱和 | **FAIL**（0.982） |

**verdict: FAIL — 不训练。**

---

## 21. Tiny Overfit

**未跑。** Gate FAIL 后禁止训练。

---

## 22. Training Configuration

未启动。冻结起点仍为 Phase 5B（AdamW 1e-3，M0/M1 架构不变）。脚本已就绪：`train_stage_a_scale.py`（epochs=20, batch=32），仅在 gate PASS 后运行。

---

## 23. Training Curves

N/A（未训练）。

---

## 24. Exact Baseline

Exact span-in-lexicon ≈ **1.3%**。价值仍在 FuzzyPool（ExactMiss→FuzzyHit 2218）。

---

## 25. Distance/Prior Baselines

见 §19。B_pool_distance = (distance ASC, −prior)。B_pool_prior = (−prior, distance)，R@1=0.376，**不是**最强启发式。最强简单 baseline 仍是 **distance+prior**。

---

## 26. M0 Results

**未训练。** 不得用 5B Probe 权重冒充本轮 Scale 结果。

---

## 27. M1 Results

未训练。M0 仍将是未来 Stage A 主 baseline。

---

## 28. Ambiguous Slice Results

仅 **baseline**（无模型）：

| Slice | n | B_pool_distance R@1 |
|-------|---|---------------------|
| ALL TTS TERM_POSITIVE | 2245 | 0.982 |
| EQUAL_DISTANCE | 126 | **0.683** |
| NON_AMBIGUOUS | 2119 | ~1.0 |

126 条是第一次出现“启发式不能独占”的 TTS slice，但占比太小，不能当作 50–70% 难例集。

---

## 29. Unseen-Term Results

样本规模已够（val 231 / test 248），但 **未训练**，无 M0 unseen 指标。  
不得用 5B 的 n=3 结论外推。

---

## 30. Unseen Ambiguous Results

EQUAL_DISTANCE 总量仅 126，再切 unseen 后统计力不足。未训练。

---

## 31. NO_MATCH Results

未训练。数据侧：N2=887 已可训练 non-empty NO_CHANGE；N1=73 仍需 distractors。

---

## 32. Hard Negative Results

HN_NATIVE=0；HN_INJECTED=3000。未训练，无 FP。Native yield 仍低 → 允许 injected，但必须分列。

---

## 33. Term-ID / Surface Generalization Stress

未训练。架构未改：无 term_id embedding。脚本保留 stress。

---

## 34. Mask Invariance

未训练。Stage A mask 合同未改。

---

## 35. CPU Forward Benchmark

未新训模型。5B M0 CPU B=1 P95≈2.2 ms 仍适用（架构未变）。Dataset 变大 **不会**膨胀 runtime 参数。

---

## 36. Parameter Count

未新训。冻结预算仍 **141,118**。

---

## 37. Dataset / Model Artifacts

```text
training/model2/dataset/training_scale_v1/
  plan.jsonl  rule_plan.jsonl  results.jsonl  training_samples.jsonl
  model2_train_rows.jsonl  dataset_manifest.json  service_lock.json
  ambiguity_inventory.jsonl  ambiguity_metrics.json
  fuzzy_pool_metrics.json  split_audit.json  leakage_audit.json
  negative_type_metrics.json  hard_negative_metrics.json
  dataset_gate.json  generation_metrics.json
```

无 `experiments/stage_a_scale_v1/` checkpoint（未训练）。

RULE 独立：`rule_plan.jsonl`；source_type=RULE_SYNTHETIC；不计入 TTS 主指标。RULE 在 pool 内 321 条中 **298 条 distance rank>0**（R@1≈0.07）——证明“错误最近邻”任务可被 **文本规则** 制造，但 **不是** acoustic proof。

---

## 38. Modified File Inventory

| 文件 | 变更 |
|------|------|
| `training/model2/export/sample_builder.py` | N2：正确 term 用 term span 作 NEGATIVE |
| `training/model2/export/train_row.py` | ambiguity / leak / N1N2 / hn_native 字段 |
| `training/model2/evaluation/baselines.py` | B_pool_prior |
| `training/model2/evaluation/slices.py` | ambiguous / leak 过滤 |
| `training/model2/evaluation/evaluate.py` | N1/N2、native/injected HN FP |
| `training/model2/training/dataset.py` | 排除 context leak |
| `training/model2/ambiguity/taxonomy.py` | unique nearest ≠ 难例 |

未改 Fine Span / Exact / Domain Vote / KenLM / Node。

---

## 39. Added File Inventory

```text
training/model2/ambiguity/{__init__,taxonomy,inventory}.py
training/model2/corpus/carrier_templates_v2.jsonl
training/model2/scripts/build_scale_plan.py
training/model2/scripts/run_scale_pipeline.py
training/model2/scripts/build_scale_trainrows.py
training/model2/scripts/dataset_gate_scale.py
training/model2/scripts/train_stage_a_scale.py
training/model2/scripts/run_scale_postprocess.py
training/model2/tests/test_phase5c_ambiguity.py
docs/user_correction/Lingua_Model2_Phase5C_Ambiguity_Training_Scale_Probe_Report_2026_08_12.md
```

---

## 40. Tests

| 测试 | 结果 |
|------|------|
| `test_phase5c_ambiguity` | PASS |
| `test_stage_a_model` | PASS |
| probe pipeline unittest | 18 PASS |
| live TTS/ASR 3000 | 100% 成功 |

---

## 41. KEEP / MODIFY / ADD / DELETE / DEFER

| | |
|--|--|
| KEEP | FuzzyPool V1；M0 架构；Stage A MASK；真实 Piper/FW |
| MODIFY | Ambiguity 定义：unique nearest 不得标成难例 |
| ADD | Scale dataset、N2 negatives、inventory、gate 脚本 |
| DELETE | 无 |
| DEFER | Stage B；Node；production freeze；10k–20k；FuzzyPool indexed runtime；HN_NATIVE 高 yield |

---

## 42. Risks

| 风险 | 等级 | 说明 |
|------|------|------|
| Canonical TTS 无法制造 ranking 歧义 | **高** | 本轮核心 FAIL |
| NON_TERM 与 TERM 数量接近 | 中 | 字级误差主导，不是 Model2 任务 |
| HN_NATIVE=0 | 中 | 弱 prior 难在 pool 内自然出现 |
| 用 RULE 冒充 TTS 主指标 | 高 | 已隔离；禁止 |
| 扩 20k 重复 unique-nearest | **高** | 明确禁止 |

无 FuzzyPool Contract BLOCKER（可见性 100%）。

---

## 43. Baseline Dataset Preconditions

进入 10k–20k **之前**必须先解决 DATA：

1. TTS/ASR 主集上 `B_pool_distance R@1 < 0.98`
2. 真正 EQUAL_DISTANCE / rank>0 占比进入建议的 50–70% 难例带，或至少数百条可评估
3. 不得把 RULE_SYNTHETIC 混进 TTS 主指标来“过门”
4. 保持 unseen val/test≥50、FuzzyPool≥95%、leakage=0
5. 仍禁止 Stage B / Node

可行方向（需另开阶段，本轮不做）：

* 针对 **equal-distance ASR 误差模式** 增加声学难度（仍真实 ASR，不改 hypothesis）
* 筛选/续生成只保留 rank>0 与 EQUAL_DISTANCE，再补 control
* 不把 20k unique-nearest 当进度

---

## 44. Acceptance Checklist

| # | 项 | 结果 |
|---|----|------|
| 1 | 2k–5k 真实生成 | **PASS**（3000） |
| 2 | 未复制 Probe | **PASS** |
| 3 | leakage=0 | **PASS** |
| 4 | unseen val/test 足够 | **PASS** |
| 5 | FuzzyPool≥95% / in-lexicon≈100% | **PASS** |
| 6 | ambiguity slice 足够且 overall distance 不饱和 | **FAIL** |
| 7 | Tiny overfit / M0 训练 | **未跑（gate FAIL）** |
| 8 | M0 vs distance on AMBIGUOUS / UNSEEN_AMBIGUOUS | **无法验收** |
| 9 | N2 可训练 | **数据 PASS**（887） |
| 10 | 未接 Node / 未 Stage B | **PASS** |

---

## Failure Classification

**DATA** — 不是 MODEL / LOSS / ENCODING / MASK / POOL。

FuzzyPool 可见性完好。模型架构无需为过本轮 Gate 而改。  
**禁止**用“再多 20k 同样的最近邻误差”代替歧义采样。

## Next Phase Decision

**STOP at 2k–5k Training Scale。不允许进入 10k–20k Baseline Dataset V1。**

下一步必须先做 **Ambiguity Yield Repair**（真实 ASR，不改 hypothesis），直到 TTS 主集 distance baseline 不再饱和。
