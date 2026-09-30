# Lingua Model2 Phase 5B — Stage A Minimal Model Training Probe Report

| Field | Value |
|-------|-------|
| Date | 2026-08-12 |
| Nature | **Learnability / pipeline probe**（非正式 Baseline，非正式泛化验收） |
| Source | `training/model2/dataset/probe_trainrow_v1/model2_train_rows.jsonl`（766 rows；未重跑 TTS/ASR） |
| Output | `training/model2/experiments/stage_a_probe_v1/` |
| Markers | `PROBE_ONLY` / `NOT_FOR_RUNTIME` / `NOT_FROZEN` |
| Verdict | **PASS（GO for 2k–5k Training Scale Probe）** |

---

## 1. Executive Summary

本轮第一次训练 Model2 Stage A 最小 Probe，只回答：

**冻结的 Model2 V1 Dual-Encoder 架构是否具有基本可训练性？**

结论：**是。** Tiny Overfit、loss 下降、MASK 不变性、term_id 非语义依赖、参数预算、CPU forward 均通过。不得用 766 Probe rows 宣称正式泛化质量。

| Gate | 结果 |
|------|------|
| Tiny Overfit（n=48） | PASS：loss 2.73→1.28；train R@1 0.44→**0.96** |
| M0 可学习 | PASS：TERM_POSITIVE R@1 **0.949**（随机≈0.064） |
| vs Fuzzy distance baseline | M0 **未超过** B_pool_distance（R@1=1.0）— 见 §22 解释 |
| MASK invariance | PASS（max abs diff = 0） |
| term_id stress | PASS（max abs diff = 0） |
| Params | **141,118**（<200K target；<2M hard max） |
| NO_MATCH / HN FP | 0.0 / 0.0 |
| CPU B=1 P95 | **~2.2 ms**（不含 FuzzyPool） |

**GO_GATE: PASS** — 允许进入 2k–5k Training Scale Probe。禁止跳过该步直接上 10k–20k。

---

## 2. Phase5A Preconditions

基于 `Lingua_Model2_Phase5A_TrainRow_FuzzyPool_Probe_Development_Report_2026_08_12.md`：

| 前提 | 状态 |
|------|------|
| FuzzyPool V1 `d≤2, cap=16` | 未改；Recall@16 ceiling = 100% |
| TrainRows 766 | 复用；未复制 rows |
| TERM_POSITIVE = 197 | 仅此进入主 recall loss |
| NON_TERM_POSITIVE = 130 | `ignored_for_model2_recall` |
| Stage A masks | phonetic/tone/realized = 0 |
| char-hash-v1 | trainer 复用，无第二套 hash |
| 未改 ASR/FW/Domain Vote/KenLM | 保持 |

---

## 3. Training Task Definition

Model2 唯一职责仍是：

**User-Conditioned Fuzzy Candidate Recall**

本轮只训练 **Model2 Score**（Stage A：无 phonetic/tone 监督）：

```text
score_M0 = dot(Qbase, C)
score_M1 = dot(Qbase, C) + w_personal·f_personal + w_domain·f_domain
```

NO_MATCH 为 learnable anchor（方案 A）。Hard Negative 用显式 `is_injected_hard_negative`，禁止把 `distance=99` 当 feature。

---

## 4. TERM_POSITIVE Filtering

| Bucket | n | 主 recall loss |
|--------|---|----------------|
| TERM_POSITIVE | 197 | **是**（TTS_ASR_SYNTHETIC 且 target 在 pool） |
| 其中 train / val / test | 194 / 2 / 1 | 预分 split，未 random split |

判定与 Phase 5A 一致：`target_span` 对齐 `metadata.target_term`，且非 RULE_SYNTHETIC。

---

## 5. NON_TERM_POSITIVE Handling

| 项 | 值 |
|----|----|
| `ignored_non_term_positive_count` | **130** |
| 处理 | 保留 provenance；不进 lexicon recall positive loss |
| 未来 | DEFER 给 char correction / normalization |

未删除事实数据，未把繁简/单字格式差强行训成 lexicon recall。

---

## 6. Candidate Representation

```text
CandidateEncoder(
  char-hash-v1 n-grams of surface,
  syllable ids,
  syllable_count,
  term_type one-hot (domain|base)
) → C[64]
```

**禁止** `EmbeddingTable[term_id]` 作为主表示。`term_id` 仅作 identity / cache lookup。

---

## 7. Anti-Memorization Design

1. 无 trainable term_id table（单元测试扫描参数名）
2. CandidateEncoder 只吃 surface/pinyin/metadata
3. `candidate_embed_probe.npz` = encoder 对 lexicon snapshot 的离线缓存，不是 vocabulary SSOT
4. Term-ID stress：打乱 pool 的 term_id 列表、特征张量不变 → 分数不变
5. Unseen-term slice 单独报告（n=3，仅 smoke）

---

## 8. Query Encoder

```text
span_char + left_char + right_char + span_syllables
+ syllable_count + relative_position
    → shared tables → mean-pool → MLP → Qbase[64] (L2-normalized)
```

Tokenization：`char-hash-v1`（NFC、char trigram、FNV-1a 64、bucket=4096、PAD=0）。

---

## 9. Candidate Encoder

共享同一套 char/syllable embedding tables，独立 projection head。输入不含 term_id。

---

## 10. Shared Embedding Decision

比较：

| 方案 | 选择 |
|------|------|
| A. Query/Candidate 完全独立大 embedding | 否 |
| **B. 共享 char/syllable tables + 独立 projection** | **采用** |

理由：参数更小、Q/C 空间更易对齐、unseen surface 仍走同一 hash/syllable 路径。不是为了“Dual Encoder”机械复制两套表。

---

## 11. M0 Architecture

QueryEncoder + CandidateEncoder + `dot(Q, C)` + learnable NO_MATCH。  
Condition MLP 存在于图中，**不进入 score**（`use_condition_in_score=False`，`condition_gate=0`）。

---

## 12. M1 Architecture

M0 + candidate-level：

* `personal_exact_match`
* `personal_syllable_sim_max`
* `personal_evidence_rank`
* `candidate_domain_*`

线性权重从 0 初始化。Stage A 主 baseline 仍是 **M0**。M1 提升不得冒充 phonetic/tone UserProfile conditioning。

未引入 Transformer / Attention User Encoder / 第三种架构。

---

## 13. Parameter Counts

Trainable **141,118**（target ~200K；warning 500K；hard max 2M）。

| 模块 | 参数 |
|------|------|
| shared char/syl embeddings | 107,352 |
| query encoder (projection only) | 15,712 |
| candidate encoder (projection only) | 11,200 |
| condition encoder | 6,784 |
| weak prior head | 5 |
| NO_MATCH + gate | 65 |
| **total** | **141,118** |

char: 4096×24；syl: 377×24。未超 warning。

---

## 14. NO_MATCH Design

采用 **方案 A：learnable NO_MATCH anchor**（未并行 threshold head）。

发现：118 条 NEGATIVE 的 FuzzyPool V1 **全部为空**（长句/无改写 span，非 lexicon 形）。空 pool 上 CE 对 NO_MATCH 无竞争，loss 恒为 0。

**V1 修复（不改 FuzzyPool）：** 对空 pool NEGATIVE 注入 8 个 **training-only random distractors**（由 `trainrow_id` SHA-256 确定性采样）。FuzzyPool V1 生成逻辑不变。

修复后：`l_neg` epoch1=0.99 → epoch40=0.70；NEGATIVE 上 NO_MATCH hit rate = **1.0**。

---

## 15. Hard Negative Design

| 项 | 值 |
|----|----|
| 显式字段 | `is_injected_hard_negative: bool` |
| 与 distance 解耦 | trainer **不读** `distance=99` |
| Loss | margin：`relu(score_HN − score_NO_MATCH + 0.2)` |
| 注入数 | 320（全部 HN 为 injected；native phonetic 可见率 0，与 5A 一致） |

`distance=99` 仅保留在 FuzzyPoolHit 列表填充注释中，不作模型 feature。

---

## 16. Loss Definition

```text
L = L_positive + 0.5 * L_negative + 0.5 * L_hard_negative
```

* `L_positive` = CE over pool+NO_MATCH，target = `positive_pool_index`（仅 TERM_POSITIVE）
* `L_negative` = CE，target = NO_MATCH
* `L_hn` = margin vs NO_MATCH

本轮单一 λ 组合（未做 2–3 组网格搜索以外的生产变体）。

---

## 17. Dataset Split

沿用预先划分的 user-disjoint / term-disjoint / user×term holdout。**未重新 random split。**

| split | 全量 rows | TERM_POSITIVE |
|-------|-----------|---------------|
| train | 751 | 194 |
| validation | 8 | 2 |
| test | 7 | 1 |

val/test 过小 → 本轮只定义 **learnability probe**，不能定义正式 generalization acceptance。

---

## 18. Tiny Overfit Result

| 项 | 值 |
|----|----|
| n | 48 TERM_POSITIVE train |
| epochs / lr | 80 / 2e-3 |
| initial loss / R@1 | 2.73 / 0.44 |
| final loss / R@1 | **1.28 / 0.958** |
| NaN/Inf | 无 |
| Gate | **PASS** |

---

## 19. Training Configuration

| 项 | 值 |
|----|----|
| seed | 20260812 |
| Python | 3.10.11 |
| PyTorch | 2.13.0+cpu |
| CUDA | 不可用；训练在 **CPU** |
| Runtime 目标 | **CPU**（与训练设备分开记录；未设计 GPU inference） |
| optimizer | AdamW lr=1e-3, wd=1e-4 |
| batch / epochs | 16 / 40 |
| mix/epoch | pos 194 + neg 116 + hn 310 = 620 |
| char-hash / cand-index / feature schema | char-hash-v1 / cand-index-v1 / user-feature-schema-v1 |
| lexicon snapshot | `sha256:ab78bf3599911711fc18ce59c62ab93c8f50c5410a1a6254e01125a244ce1f76` |

---

## 20. Training Curves

M0（epoch 1 → 40）：

| | train_loss | l_pos | l_neg | l_hn | val_loss |
|--|------------|-------|-------|------|----------|
| ep1 | 3.31 | 2.81 | 0.99 | 0.002 | 3.20 |
| ep40 | 1.68 | 1.33 | 0.70 | 0.0 | 2.83 |

Loss 单调可学、无 NaN。val_loss 高且不稳定是 **n=2** 预期，不是训练崩溃。

---

## 21. Exact Recall Baseline

**B_exact**（source span 是否 lexicon exact hit）：

* n=197 TERM_POSITIVE
* exact_span_in_lexicon_rate = **1.02%**

与 Phase 5A ExactMiss→FuzzyHit≈99% 一致：本 Probe 的价值几乎全在 FuzzyPool，不在 Exact。

---

## 22. Fuzzy Distance Baseline

**B_pool_distance**（distance 升序，prior 降序）：

| slice | n | R@1 | R@3 | MRR |
|-------|---|-----|-----|-----|
| all TERM_POSITIVE | 197 | **1.000** | 1.000 | 1.000 |

**为何 M0 未超过 baseline：** 本 TTS Probe 的 target 几乎总是 pool 内最近邻。确定性 distance 已达天花板。这是 **DATA** 特性（近音 ASR 误差），不是 MODEL/LOSS bug。M0 的意义是证明能从 pool 学到接近该排序的 ranking，而不是在 766 行上击败已饱和的启发式。

下一阶段 2k–5k 需要更多 **distance 歧义** 样本，才能检验 learned ranker 的增量。

---

## 23. M0 Metrics

TERM_POSITIVE（TTS only；pool 含 target）：

| slice | n | R@1 | R@3 | R@4 | MRR |
|-------|---|-----|-----|-----|-----|
| all | 197 | 0.949 | 0.995 | 0.995 | 0.969 |
| train | 194 | 0.964 | 1.000 | 1.000 | 0.979 |
| val | 2 | 0.000 | 1.000 | 1.000 | 0.417 |
| test | 1 | 0.000 | 0.000 | 0.000 | 0.071 |

* Positive average pool size ≈ **15.66**
* FuzzyPool Recall@16 ceiling = **1.0**（独立可见性上限）
* 随机 R@1 ≈ 1/15.66 ≈ 0.064；M0 明显优于随机

---

## 24. M1 Metrics

| slice | n | R@1 | R@3 | R@4 | MRR |
|-------|---|-----|-----|-----|-----|
| all | 197 | 0.939 | 0.990 | 0.995 | 0.962 |
| train | 194 | 0.954 | 0.995 | 1.000 | 0.972 |

M1 与 M0 接近；弱 prior **没有**带来可靠增益。Stage A 正式主 baseline = **M0**。不得把 M1 解释为 User phonetic/tone conditioning。

---

## 25. Seen/Unseen Term Slices

| | n | M0 R@1 | M0 R@3 | M0 MRR |
|--|---|--------|--------|--------|
| seen (train terms) | 194 | 0.964 | 1.000 | 0.979 |
| unseen holdout | **3** | 0.000 | 0.667 | 0.302 |

n=3 **没有统计置信度**。R@1=0 记为 **smoke warning**，不据此判定 CandidateEncoder 泛化失败（§23 硬 FAIL 需要足够样本）。distance baseline 在这 3 条上仍为 R@1=1.0，说明 phonetic 特征本身可检索；learned ranker 在 holdout 上过拟合风险存在，必须靠下一阶段更大 term-disjoint 集检验。

---

## 26. Term-ID Memorization Stress

打乱 `fuzzy_pool_term_ids` 元数据、保持 surface/pinyin 张量：

* max_abs_diff = **0**
* Gate = **PASS**

模型分数不依赖 term_id 字符串。结构上也不存在 term_id embedding table。

---

## 27. Mask Invariance Test

保持 mask=0，随机改 phonetic/tone condition 值：

* n=32；max_abs_diff = **0**；mean_abs_diff = **0**
* Gate = **PASS**

Condition MLP 被 mask 与 `phonetic_profile_acoustically_realized=0` 切断，未从 masked 通道获取监督。

---

## 28. Wrong Weak-Prior Stress

M1：batch 内滚动交换 personal/domain features。

| | R@1 |
|--|-----|
| correct profile | 0.938 |
| wrong profile | 0.938 |
| delta | 0.0 |

Wrong prior 未压过 base evidence。Stage A 不要求 Correct > Empty。

---

## 29. NO_MATCH FP

| 指标 | M0 | M1 |
|------|----|----|
| NO_MATCH FP（TERM_POSITIVE 上 NO_MATCH > target） | **0.0** (0/197) | **0.0** |
| NO_MATCH hit on NEGATIVE（含 distractors） | **1.0** (118/118) | **1.0** |

机制有效；未失控。

---

## 30. HardNegative FP

注入 HN score > NO_MATCH：

* M0/M1：**0.0**（0/320）
* `l_hn` 迅速到 0（margin 已满足）

---

## 31. Candidate Embedding Artifact

`training/model2/experiments/stage_a_probe_v1/candidate_embed_probe.npz`

| 项 | 值 |
|----|----|
| 来源 | CandidateEncoder(M0) × lexicon snapshot |
| dim | 64 |
| n | 9914 |
| checkpoint | `model2-stageA-probe-m0.pt` |
| encoder version | cand-enc-stageA-probe-v1 |
| candidate index | cand-index-v1 |
| 标记 | PROBE_ONLY / NOT vocabulary SSOT |

---

## 32. CPU Forward Benchmark

纯 Model2 score（P≈16；不含 Python FuzzyPool）：

| B | P50 ms | P95 ms |
|---|--------|--------|
| 1 | 1.38 | 2.15 |
| 5 | 1.89 | 2.85 |
| 10 | 2.27 | 3.04 |

符合小模型量级，不会单独成为显著瓶颈。

---

## 33. Probe Limitations

1. 766 rows / TERM_POSITIVE 197 / val 2 / test 1 — **不能**作正式泛化验收
2. B_pool_distance 已饱和（R@1=1.0）— 无法在本 Probe 上证明 learned > heuristic
3. Unseen n=3 — 无置信度
4. NEGATIVE FuzzyPool 全空 — 依赖 training-only distractors
5. HN 全部为 injected（phonetic 不可见）— 与 5A 一致
6. TTS pseudo user ≠ 真实发音条件
7. 未接 Node；未 freeze；未 production export

---

## 34. Modified File Inventory

| 文件 | 变更 |
|------|------|
| `training/model2/export/train_row.py` | 增加 `is_injected_hard_negative` 等 derived 字段 |
| `training/model2/scripts/rebuild_probe_trainrows.py` | 写出 HN 显式 flag；注释 distance=99 非 feature |
| `training/model2/requirements.txt` | 增加 `torch>=2.1` |

未修改 Fine Span / Exact Recall / Domain Vote / KenLM / JobResult / SessionBootstrap / Node runtime。

---

## 35. Added File Inventory

```text
training/model2/model/{__init__,encoders,scorer,model_v1}.py
training/model2/training/{__init__,config,dataset,losses,trainer}.py
training/model2/evaluation/{__init__,metrics,baselines,slices,evaluate}.py
training/model2/scripts/{train_stage_a_probe,evaluate_stage_a_probe}.py
training/model2/tests/test_stage_a_model.py
training/model2/experiments/stage_a_probe_v1/
  training_config.json  dataset_manifest.json  model_config.json
  tiny_overfit_metrics.json  m0_metrics.json  m1_metrics.json
  baseline_metrics.json  slice_metrics.json
  mask_invariance.json  term_id_stress.json  wrong_profile_stress.json
  cpu_latency.json  probe_verdict.json  training_log.jsonl
  model2-stageA-probe-m0.pt  model2-stageA-probe-m1.pt
  candidate_embed_probe.npz  enriched_train_rows.jsonl
docs/user_correction/Lingua_Model2_Phase5B_StageA_Model_Training_Probe_Report_2026_08_12.md
```

---

## 36. Tests

| 测试 | 结果 |
|------|------|
| `test_param_budget_under_warning` | PASS（141K；shared 不双计） |
| `test_mask_invariance_unit` | PASS |
| `test_no_term_id_embedding_table` | PASS |
| `test_term_positive_filter_and_hn_flag` | PASS |
| Tiny overfit gate | PASS |
| Offline eval + stress（训练脚本内） | PASS |

---

## 37. KEEP / MODIFY / ADD / DELETE / DEFER

| 动作 | 项 |
|------|----|
| KEEP | FuzzyPool V1；Exact Recall；Domain Vote；KenLM；char-hash-v1；Stage A MASK；M0 为 Stage A 主 baseline |
| MODIFY | TrainRow 增加显式 HN / bucket 字段（derived，不改 pool 生成） |
| ADD | Dual encoder、loss/trainer、Probe ckpt/NPZ、离线 eval |
| DELETE | 无。禁止把 `distance=99` 当 trainer feature（已停用） |
| DEFER | Stage B phonetic/tone；Node 接入；production freeze；10k–20k；FuzzyPool Python P95≈81ms indexed 实现；NON_TERM char-correction 分支；RULE_SYNTHETIC 主指标 |

---

## 38. Risks

| 风险 | 等级 | 说明 |
|------|------|------|
| Distance baseline 饱和 | 中 | 扩数据时必须保留歧义 pool，否则无法证明 learned ranker 增量 |
| Unseen-term 过拟合 | 中 | n=3 smoke；2k–5k 必须强制 term-disjoint 报告 |
| NEGATIVE 空 pool | 低 | training distractors 有效；runtime 空 pool→NO_MATCH 是合理行为 |
| FuzzyPool Python P95≈81ms | Known | **本轮不修**；Node 前另做 indexed/cache |
| M1 弱 prior 无增益 | 低 | 预期；主 baseline 保持 M0 |

无 BLOCKER Contract bug。

---

## 39. Training-Scale Dataset Preconditions

进入 **2k–5k Training Scale Probe** 前必须：

1. 保持 TERM_POSITIVE 过滤与 `is_injected_hard_negative`
2. 保持 user/term-disjoint split；扩大 **val/test** 与 **unseen-term** 样本
3. 增加 FuzzyPool 内 **非最近邻 target**（distance 歧义）
4. 不复制 766 rows；不重跑本 Probe TTS 来“灌水”
5. 若 Scale Probe 上 unseen 仍接近随机且 term_id stress 失败 → 回退 ENCODING，禁止靠 10k–20k 掩盖
6. 仍禁止 Stage B / Node / production freeze

---

## 40. Acceptance Checklist

| # | 项 | 结果 |
|---|----|------|
| 1 | Tiny overfit succeeds | **PASS** |
| 2 | loss 正常下降；无 NaN/Inf | **PASS** |
| 3 | candidate target indexing 正确 | **PASS** |
| 4 | candidate 语义不依赖 term_id | **PASS** |
| 5 | term_id stress | **PASS** |
| 6 | MASK invariance | **PASS** |
| 7 | params < 2M | **PASS** (141K) |
| 8 | M0 Recall@K ≫ 随机 | **PASS** |
| 9 | 与 distance baseline 可解释比较 | **PASS**（baseline 饱和；M0 接近但未超过 — DATA） |
| 10 | NO_MATCH 机制工作 | **PASS** |
| 11 | HN loss 工作；FP 未失控 | **PASS** |
| 12 | unseen 未“完全崩溃”（n=3 smoke） | **PASS with warning** |
| 13 | CPU Model2 forward 小模型量级 | **PASS** |
| 14 | 未改 FuzzyPool production / 未接 Node | **PASS** |
| 15 | 未宣称 766 行正式泛化 | **PASS** |

---

## Next Phase Decision

**GO → 2k–5k Model Training Dataset / Training Scale Probe。**

若 Scale Probe 再 PASS，才允许 10k–20k Baseline Dataset V1。

本轮 FAIL 分类回退映射（未触发）：DATA / POOL / MODEL / LOSS / ENCODING / MASK / NEGATIVE。M0 未超过 distance baseline 归类为 **DATA（probe 饱和）**，不归 MODEL FAIL。
