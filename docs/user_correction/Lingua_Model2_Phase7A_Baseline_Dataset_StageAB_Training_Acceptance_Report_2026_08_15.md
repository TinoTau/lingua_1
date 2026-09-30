# Lingua Model2 Phase 7A — Baseline Dataset V1 + Stage A/B Baseline Training & Acceptance Report

| Field | Value |
|-------|-------|
| Date | 2026-08-15 |
| Nature | **10k Baseline Dataset V1 + Stage A/B Baseline Training & Acceptance** |
| Basis | Phase 6C PASS（Listwise Rank Binding GO） |
| Dataset | `training/model2/dataset/baseline_v1/`（`model2-baseline-dataset-v1`） |
| Stage A | `training/model2/experiments/stage_a_baseline_v1/` |
| Stage B | `training/model2/experiments/stage_b_baseline_v1/` |
| Markers | `MODEL2_BASELINE_V1` / `NOT_FOR_RUNTIME` / `NOT_FROZEN` |
| Verdict | **PASS — Baseline Binding GO**；**HOLD — Tone / Node / 50k** |
| Primary question (§54) | Correct Profile 在独立大数据上是否仍优于 Empty / Wrong / Swapped：**是** |

---

## 1. Executive Summary

本轮在 **10,000** 条真实 Piper TTS → production faster-whisper-vad ASR 数据上，冻结 Phase 6C 已证明的 Model2 V1 Core Architecture，完成 Baseline Dataset V1、Stage A Baseline、Stage B Listwise BOUND 训练与验收。

| Gate | Result |
|------|--------|
| Dataset 8k–12k + provenance + leakage | **PASS**（10,000 utt；user/term leakage=0；`stage_b_data_gate=true`） |
| TargetRelationConsistency | **1.0**（7010/7010） |
| Stage A tiny overfit / term-id / params | **PASS** |
| Stage A absolute holdout Recall | **WEAK**（UNSEEN R@1≈0.044；见 §Stage A） |
| Stage B Base preservation（empty == A） | **PASS**（exact） |
| Stage B BOUND ConditionGain@3 | **+0.246** |
| Stage B TargetRankDelta_mean | **+4.533** |
| Stage B MRRSwapDamage | **+0.011** |
| User×Relation ≫ shortcuts | **PASS** |
| NO_CHANGE false correction | **0.0**（n=1011） |
| Unseen slice ConditionGain@3 | **+0.125**（未崩） |
| vs Phase 6C | **方向稳定、幅度下降（degrade but stable）** |

**结论：** 规模化后 condition binding **仍然成立**，允许将 Model2 V1 Core（Stage A base + User×Relation + Scorer V2 + listwise BOUND）视为可接受的 baseline 契约。  
**不得**据此进入 Tone enrichment、Node runtime、或 50k 扩量——Stage A 在 term-holdout 上的绝对排序偏弱，且 strength 仍非严格单调，需先处理 `STAGE_A_BASE` / `STRENGTH_CALIBRATION` 风险。

---

## 2. Phase 6C Preconditions

| Precondition | Status at 7A start |
|--------------|--------------------|
| Metric contract（ties ≠ pass） | Met |
| Base preservation | Met |
| Listwise BOUND rank gain | Met（Gain@3 +0.416） |
| Profile swap > 0 | Met |
| User×Relation superiority | Met |
| Selectivity / NO_CHANGE | Met |
| Architecture freeze | Met |

→ 本轮 **未** 改架构、未加 Tone / personal / domain、未加大模型。

---

## 3. Frozen Model2 V1 Architecture

```text
FineSpan
  ↓
FuzzyPool V1
  ↓
Stage A Dual-Encoder (base score)     ← frozen in Stage B
  ↓
CandidateRelation 16D
  ↓
User×Relation interaction (Scorer V2)
  ↓
score_final = score_base + delta_condition
PROFILE_UNAVAILABLE → delta = 0
```

Primary active mask（训练/验收）：

```text
BOUND: n_l, z_zh, ch_c, sh_s, eng_en, in_ing, h_f
WEAK (primary mask=0; B1W 可选): s_sh, en_eng
REVERSED (mask=0): l_n, zh_z, c_ch, an_ang, ang_an, ing_in, f_h
```

Runtime schema 仍为 **16D**。

加载修复：Stage A checkpoint 含 V1 `condition_compat`（in=17），Stage B 强制 Scorer V2（in=18）。`load_stage_a_for_6c` 现按 shape 过滤重叠权重，条件模块重新初始化后仅训 condition（与 6C probe 路径一致）。`build_model` 已改为默认挂 V2 skeleton，供后续 Stage A 对齐。

---

## 4. Dataset Scope

| Item | Value |
|------|-------|
| dataset_id | `model2-baseline-dataset-v1` |
| Utterances | **10,000**（8k–12k 门内） |
| PseudoUsers | **600**（neutral 60 / single 300 / multi 240） |
| Terms mined | **3,574** |
| TERM carriers | **110**（`carrier_templates_v3`） |
| Plans | 10,000（corrupted planned 4,580 / control 5,420） |
| TrainRows | **17,930**（train 12,170 / val 3,737 / test 2,023） |
| Pronunciation positives | **7,010** |
| Markers | `MODEL2_BASELINE_V1` / `NOT_FOR_RUNTIME` / `NOT_FROZEN` |

目录：`training/model2/dataset/baseline_v1/`  
TrainRows：`.../stage_b_trainrows/`

生成曾因机器重启中断（~4605），恢复服务 `.venv` + CUDA PATH 后 resume 至 10k，**无 Probe 行复制膨胀**。

---

## 5–8. Generation / PseudoUser / Term / Carrier Scale

| Funnel | Value |
|--------|-------|
| ApplicablePositions | 10,254 |
| SelectedCorruptions | 4,656（SelectionRate ≈ 0.454） |
| RealizedCorruptions | 3,541（RealizationRate ≈ 0.761） |
| ASRObservableEffects | 4,291（ASREffectRate ≈ 0.922） |
| EndToEndBehaviourRate | ≈ 0.418 |
| PhonemeBackendRate | ≈ 0.924 |
| SurfaceBackendRate | ≈ 0.060 |
| EligibleTermSpanRate | ≈ 0.777 |
| ELIGIBLE_PRONUNCIATION_POSITIVE | 3,560（samples 侧） |
| ELIGIBLE_NO_CHANGE | 5,420 |
| PairedASRChangeRate | ≈ 0.869（n_paired=443） |

部分 `run_summary` 墙钟统计来自中断前片段；**验收以 10k results + scale/eligibility/leakage 门控为准**。

---

## 9–12. Active Features / WEAK / REVERSED / Pronunciation Policy

Primary = **BOUND-7 only**（继承 6C）。  
WEAK / REVERSED 不进入 primary loss。  
Observed relation 继续使用 `observed_syllables_for_relation`（family 合成；FuzzyPool 仍用原 span）。

---

## 13–17. Relation Consistency / Eligibility / NO_CHANGE / HN / Splits

| Check | Result |
|-------|--------|
| TargetRelationConsistencyRate | **1.0**（7010/7010） |
| user leakage | **0** |
| term overlap train↔val/test | **0** |
| combo holdout | 有效（189 multi-combos 登记） |
| split counts (utterance) | train 6804 / val 2091 / test 1105 |
| Hard negatives in Stage B demotion probe | n=25；`demoted_by_correct_profile_rate=0`；pass |

---

## 18–20. Leakage Audit / Dataset Statistics / Generation Performance

见 `leakage_audit.json`、`dataset_manifest.json`、`scale_metrics.json`。  
TTS/ASR 使用 production-equivalent 服务路径；未换 ASR 模型。参考片段：tts≈144ms、asr≈665ms/call（中断前计数器）。

---

## 21–27. Stage A Architecture / Training / Metrics

**Config：** epochs=20，batch=32，device=**cpu**（`torch 2.13.0+cpu`），seed=20260812。

| Gate | Result |
|------|--------|
| Tiny Overfit | **PASS**（R@1→1.0） |
| Params | **141,728** trainable（<500k） |
| term_id stress | **PASS**（max_abs_diff=0） |
| MASK invariance | **PASS** |
| CPU B1 P50 | ≈1.37ms（pool=16） |

| Slice | n | Recall@1 | Recall@3 | MRR |
|-------|--:|---------:|---------:|----:|
| all term+ | 3371 | 0.523 | 0.691 | 0.635 |
| train | 2360 | 0.728 | 0.945 | 0.837 |
| validation | 643 | 0.039 | 0.073 | 0.154 |
| test | 368 | 0.052 | 0.141 | 0.183 |
| UNSEEN_TERM | 1011 | 0.044 | 0.098 | 0.165 |
| SEEN_TERM | 2360 | 0.728 | 0.945 | 0.837 |

FuzzyPool@16 ceiling = **1.0**（holdout 失败是排序，不是召回天花板）。  
NO_MATCH_FP_rate ≈ **0.287**（可控但偏高，记入风险）。

**判定：** Stage A **可训练** + 契约门通过；**绝对 holdout 排序偏弱**（`STAGE_A_BASE`）。本轮不要求打败所有 deterministic easy cases，但该弱点阻止宣称“可直接上 Node”。

Artifacts：`checkpoint.pt`、`model2-stageA-baseline-m0.pt`、`candidate_embed_baseline_v1.npz`、`metrics.json`、`probe_verdict.json`。

---

## 28–35. Stage B Initialization / Frozen Base / Listwise Training / Gains

**Init：** Stage A baseline M0 → Scorer V2 + relation；base frozen；只训 `condition_compat` + `relation_gate`（trainable≈642）。

| Gate | Result |
|------|--------|
| Tiny listwise overfit | **PASS**（rankΔ +1.71；frac improve 0.91） |
| Tiny User×Relation | **PASS** |
| Tiny / full swap | **PASS** |
| Base preservation after full | **PASS**（Δscore=0，rank identical；`empty_equals_b0_assertion=true`） |

Primary B1 BOUND（`listwise_metrics.json` / `go_summary.json`）：

| Metric | Baseline V1 |
|--------|-------------|
| ConditionGain@1 | **+0.065** |
| ConditionGain@3 | **+0.246** |
| ConditionGain_MRR | **+0.149** |
| TargetRankDelta_mean | **+4.533** |
| TargetProbabilityGain_mean | **+0.052** |
| frac_rank_improved | **0.836** |
| CandidateDeltaSpread_mean | **4.315** |
| ConditionSelectivity_mean | **2.719** |

Suggested GO refs：Gain@3>+0.05、RankΔ>0、Swap>0、NO_CHANGE 极低 → **全部满足**。

---

## 36–40. Correct vs Empty / Wrong / Swapped / Opposite

| Comparison | Evidence |
|------------|----------|
| Correct > Empty | ConditionGain@* > 0；TargetRankDelta > 0 |
| Correct > Wrong | Wrong R@3≈0.106 vs Correct≈0.226（unseen slice）；selectivity wrong≪correct |
| Correct > Swapped | MRRSwapDamage **+0.011**；SwapDamage@3 **+0.025** |
| Correct > Opposite/Irrelevant | rates **0.9875**（n=160；ties≠pass） |

User×Relation ablation（n=200）：

| Variant | mean_rank | Recall@3 |
|---------|----------:|---------:|
| A User+Relation | **3.85** | **0.425** |
| B User-only | 8.445 | 0.11 |
| C Relation-only | 8.445 | 0.11 |
| D Neither | 8.445 | 0.11 |

interaction_gap_vs_user_only ≈ **+4.60** → **PASS**。

---

## 41–45. Per-Direction / Strength / Single-Multi / Unseen

BOUND directions（TargetRankDelta_mean，binding_quality）：

| Feature | n | RankΔ | ProbGain | Reclass |
|---------|--:|------:|---------:|---------|
| n_l | 160 | +5.71 | +0.033 | **BASELINE_BOUND** |
| z_zh | 61 | +3.11 | +0.114 | **BASELINE_BOUND** |
| ch_c | 161 | +3.89 | +0.076 | **BASELINE_BOUND** |
| sh_s | 221 | +4.05 | +0.037 | **BASELINE_BOUND** |
| eng_en | 114 | +4.89 | +0.045 | **BASELINE_BOUND** |
| in_ing | 114 | +4.67 | +0.015 | **BASELINE_BOUND** |
| h_f | 214 | +4.78 | +0.069 | **BASELINE_BOUND** |

Strength（ConditionGain@3）：

| Strength | n | Gain@3 | RankΔ |
|----------|--:|-------:|------:|
| LOW | 107 | +0.318 | +5.96 |
| MEDIUM | 372 | +0.185 | +3.98 |
| HIGH | 566 | +0.272 | +4.63 |

→ **非严格单调**（LOW > HIGH > MEDIUM）。  
**Strength semantics decision（§90）：** 继续采用 **bucketed LOW/MEDIUM/HIGH** 作为 Model2 V1 默认；不切换 continuous/binary。需在后续标定中修正单调性，而非本轮改架构。

Unseen（artifacts `unseen_term_metrics.json` / `unseen_user_metrics.json`，n=2056；两文件数值相同，按同一 holdout 切片报告）：

| Metric | Value |
|--------|------:|
| ConditionGain@3 | **+0.125** |
| TargetRankDelta | **+2.301** |
| TargetProbabilityGain | **+0.026** |
| Correct R@3 | 0.226 |
| Empty R@3 | 0.101 |
| Wrong R@3 | 0.106 |

Anti-synthetic-demo：**未崩**（gain 下降但方向保留）。  
`unseen_combo_metrics.json` 本轮产物为空对象（`{}`）→ 记为 **DEFER / incomplete slice export**，不单独宣称 combo PASS。

---

## 46–50. NO_CHANGE / HN / Delta / CPU / Params

| Item | Value |
|------|-------|
| ProfileInducedFalseCorrectionRate | **0.0**（n=1011） |
| HN demotion probe | pass（n=25） |
| required Δ to rank3 p50 | ≈0.62；learned target Δ mean ≈2.35；frac≥need_rank3 ≈0.89 |
| Stage B CPU B1 P50 | ≈2.05ms |
| Stage B trainable | **642** |

---

## 51. Phase 6C Comparison

| Metric | Phase 6C | Baseline V1 | Δ |
|--------|----------|-------------|---|
| ConditionGain@3 | +0.416 | **+0.246** | degrade |
| TargetRankDelta | +5.056 | **+4.533** | mild degrade |
| ProbGain | +0.106 | **+0.052** | degrade |
| MRRSwapDamage | +0.022 | **+0.011** | degrade, still >0 |
| User×Relation | A≪B/C/D | **A≪B/C/D** | stable |
| NO_CHANGE FP | 0 | **0** | stable |
| Base preservation | exact | **exact** | stable |

**判断：** improve / **stable direction** / magnitude **degrade**。符合“扩规模后分离变难但仍成立”的预期，不构成 HOLD on binding。

---

## 52. WEAK Secondary Experiment（B1W）

Primary PASS 后跑 BOUND+WEAK。overall ConditionGain@3：B1 **0.125** → B1W **0.127**（几乎无增益）。  
→ **s_sh / en_eng 继续 mask**；不并入 Model2 V1 active set。

---

## 53. Active Feature Requalification（§91）

| Class | Features |
|-------|----------|
| **BASELINE_BOUND** | n_l, z_zh, ch_c, sh_s, eng_en, in_ing, h_f |
| **BASELINE_WEAK** | s_sh, en_eng（B1W 无实质增益） |
| **BASELINE_REVERSED** | l_n, zh_z, c_ch, an_ang, ang_an, ing_in, f_h（本轮未主训；保持 defer） |
| **INSUFFICIENT** | （无新增） |

REVERSED backlog 保留，不阻塞 V1。

---

## 54. Model2 V1 Strength Semantics Decision

**Adopt：bucketed strength（LOW / MEDIUM / HIGH）。**  
理由：全链路已按 bucket 生成与评估；continuous/binary 无额外证据；需另开 `STRENGTH_CALIBRATION` 处理非单调，而非改 scorer。

---

## 55. Dataset / Model Artifacts

**Dataset：** `baseline_v1/`（plan/results/samples/manifests/leakage/scale/eligibility/relation + `stage_b_trainrows/`）  
**Stage A：** `experiments/stage_a_baseline_v1/`  
**Stage B：** `experiments/stage_b_baseline_v1/`（含 B0/B1/B1W metrics、counterfactuals、go_summary）  
**Scripts：** `train_stage_a_baseline.py`、`train_stage_b_baseline.py`；loader shape-filter in `listwise_binding_trainer.py`

---

## 56. Tests / Runtime Non-Impact

- 继承 Phase 6C `test_phase6c_listwise.py` metric semantics。  
- **无** Node / ASR / FW / KenLM / Domain Vote 运行时改动。  
- 产物均标记 `NOT_FOR_RUNTIME` / `NOT_FROZEN`。

---

## 57. KEEP / MODIFY / ADD / DELETE / DEFER

| Action | Item |
|--------|------|
| KEEP | FuzzyPool V1、Stage A encoders、16D schema、listwise CF、BOUND-7 mask、`score_base+delta` |
| MODIFY | Stage A→B loader shape filter；Stage A `build_model` 默认 V2 skeleton |
| ADD | `baseline_v1` dataset；`stage_a_baseline_v1`；`stage_b_baseline_v1` |
| DELETE | （无） |
| DEFER | Tone；Node；50k；REVERSED 主训；continuous strength；combo slice 完整导出 |

---

## 58. Risks

1. **STAGE_A_BASE**：term-holdout 绝对 R@1≈0.04，train/SEEN 高 → 存在 term 记忆风险（虽 term_id stress PASS）。  
2. **STRENGTH_CALIBRATION**：LOW/MED/HIGH 非单调。  
3. **PROFILE_GENERALIZATION**：swap damage 绝对值仍小（+0.011）。  
4. Observed syllables 为 family 合成，非逐句 ASR G2P。  
5. `unseen_user` / `unseen_term` 产物数值相同；combo slice 未导出。  
6. NO_MATCH_FP≈0.29 偏高。

---

## 59. Node Integration Preconditions

在解决或显式接受以下项之前 **不得** Node 接入：

1. Stage A holdout 绝对排序达到可解释阈值，或产品明确接受“弱 base + 强 condition delta”；  
2. Strength 单调/标定完成或文档冻结当前 bucket 语义；  
3. Runtime export 契约（checkpoint、vocab、mask、PROFILE_UNAVAILABLE）；  
4. 在线 FuzzyPool / latency 预算实测。

---

## 60. Tone Enrichment Preconditions

Tone 仍 **DEFER**。仅当 Baseline Binding 保持且 Stage A 风险被分类处理后，再开独立 Tone Acoustic Evidence 轮次。禁止用 Tone 掩盖 STAGE_A_BASE。

---

## 61. Acceptance Checklist

- [x] Dataset 8k–12k real TTS→ASR；无 Probe 膨胀  
- [x] Provenance / markers / manifests  
- [x] User leakage=0；term leakage=0；combo holdout 登记  
- [x] TargetRelationConsistency=1.0；FuzzyPool visibility high  
- [x] Stage A trainable；term-id PASS；CPU/params OK  
- [x] Stage A unseen **未物理崩溃**但绝对弱（已记录）  
- [x] Stage B empty == Stage A exact  
- [x] Correct > Empty / Wrong / Swapped / Opposite  
- [x] User×Relation superiority  
- [x] BOUND majority remain bound（7/7）  
- [x] NO_CHANGE FP=0  
- [x] Unseen retain positive ConditionGain  
- [x] Phase 6C comparison  
- [x] WEAK secondary；feature requalification；strength decision  
- [x] Runtime non-impact  
- [x] Formal report（本文件）

---

## 62. Baseline PASS Criteria Mapping（§95）

| Block | Verdict |
|-------|---------|
| Dataset | **PASS** |
| Stage A（契约门） | **PASS** |
| Stage A（绝对 holdout） | **WEAK / risk** |
| Stage B binding | **PASS** |
| Performance | **PASS** |

**Overall：** **PASS — Model2 V1 Baseline Binding GO**  
**HOLD：** Tone / Node / 50k scale（因 STAGE_A_BASE + strength 非单调 + swap 仍偏小）。

禁止用更大模型或更多数据掩盖上述 HOLD。

---

## Verdict

**Phase 7A PASS（Binding）。**  
在约 10k 真实 TTS→ASR 与冻结架构下，Correct UserProfile 仍对 FuzzyPool 产生可验证、candidate-specific 的 ranking 增益；相对 Phase 6C 幅度下降但方向稳定。

**Next（仅在 HOLD 解除或显式接受风险后）：**

1. Stage A holdout 质量专项（DATA/TERM_GENERALIZATION），或产品接受弱 base；  
2. Strength calibration；  
3. 再评估 Tone enrichment / Node integration 作为**独立**阶段。

---

*Report path: `docs/user_correction/Lingua_Model2_Phase7A_Baseline_Dataset_StageAB_Training_Acceptance_Report_2026_08_15.md`*
