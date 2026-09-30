# Lingua Model2 Phase 5F — PseudoUser Accent Dataset Scale Probe + Condition Supervision Calibration

| Field | Value |
|-------|-------|
| Date | 2026-08-13 |
| Nature | PseudoUser Accent Scale Probe（真实 TTS→ASR）+ Condition Supervision Gate |
| Basis | Phase 5E GO；Piper Phoneme Realization Audit |
| Dataset | `training/model2/dataset/pseudo_user_accent_scale_v1/` |
| Markers | `PSEUDO_USER_ACCENT_SCALE` / `NOT_FOR_RUNTIME` / `NOT_FROZEN` |
| Verdict | **GO（Stage B Data Gate PASS；允许进入 User-Conditioned Model2 Stage B 训练准备）** |
| Model training | **NOT RUN**（本轮明确禁止） |
| Tone diagnostic | **DEFERRED**（不阻塞 scale） |

---

## 1. Executive Summary

本轮将 5E 已验证的 Pronunciation Generator 扩展为 **2999 条真实 utterance** 的 PseudoUser Accent Scale Probe，验证：

```text
UserProfile 强度 → pronunciation behaviour → Piper 声学 → production ASR error
```

是否形成稳定、可重复、可学习的条件关系。

| 指标 | 结果 |
|------|------|
| TotalUtterances | **2999**（目标 2k–5k） |
| TotalPseudoUsers | **200** |
| Applicable → Selected → Realized → ASREffect | 3086 → 1313 → 1028 → 1190 |
| SelectionRate / RealizationRate / ASREffectRate | 0.425 / 0.783 / 0.906 |
| EndToEndBehaviourRate | **0.386** |
| PairedASRChangeRate | **0.888**（n=179 paired corruption） |
| CorruptionAssociatedPositiveRate | **0.800** |
| EligibleTermSpanRate | **0.796** |
| NonTermPositiveRate | **0.0039**（相对 corrupted） |
| Surface / Phoneme backend（corrupted） | 89 / 1202 |
| 16 directions TRAINABLE_CONTINUOUS | **16 / 16** |
| User / term leakage | **0** |
| Stage B data gate | **PASS** |

核心结论：**UserProfile 强度系统性、单调地改变真实生成发音与 ASR 可观察行为**；弱方向不再靠事后筛选伪造分布。Stage B 可进入训练准备，但 **本轮未训练** M0/M1/Stage B。

---

## 2. Phase5E Preconditions

5E 已冻结并保留：

* 64/64 seed；16 directions 全覆盖；TotalRealizationRate=1.0
* Surface + Phoneme realizer；`nai3→lai3` = PHONEME_REALIZED
* `/tts-phonemize` `/tts-pronunciation` training-only；生产 `/tts` 未改
* CorruptionSpanAlignment；User-level probabilistic behaviour（0.2/0.5/0.8）
* `LEXICALLY_UNREALIZABLE ≠ ACOUSTICALLY_INVALID`

本轮 **未重新设计** 上述机制，仅扩规模 + 校准监督门。

---

## 3. Dataset Scope

| 项 | 值 |
|----|-----|
| Dataset id | `model2-pseudo-user-accent-scale-v1` |
| Utterances | 2999 |
| Corrupted planned / Control | 1291 / 1708 |
| Paired control planned | 429（成功配对评测 179） |
| TrainingSample / TrainRow | 4996 / 4996 |
| Carriers | `carrier_templates_v2`（60 ≥50） |
| Lexicon mined terms | 770 |
| Seed | plan 内固定；user 构建确定性 |

---

## 4. PseudoUser Design

* **200 users**：single 100（50%）/ multi 80（40%）/ neutral 20（10%）
* Multi-feature 标记：`SYNTHETIC_INDEPENDENT_COMBINATION`（非真实方言相关模型）
* 16 directions × LOW/MEDIUM/HIGH 均有 single-feature 覆盖
* Neutral：全 NONE，作 control 分布锚点

---

## 5. Feature Strength Semantics

| Strength | Application probability |
|----------|-------------------------|
| NONE | 0.00 |
| LOW | 0.20 |
| MEDIUM | 0.50 |
| HIGH | 0.80 |

语义仅定义 **corruption application probability**，非 acoustic severity。观测行为与 intended 分离统计，**禁止事后筛到 0.8**。

---

## 6. Single / Multi Feature Users

| Kind | Count | 用途 |
|------|-------|------|
| single | 100 | 因果与单调性 |
| multi | 80 | 组合泛化；独立合成 |
| neutral | 20 | 无污染基线 |

---

## 7. 16-Direction Distribution

计划 corrupted 按方向（不完全均衡，尊重真实 yield）：

| Direction | Planned | Direction | Planned |
|-----------|---------|-----------|---------|
| n_l | 75 | an_ang | 53 |
| l_n | 69 | ang_an | 80 |
| zh_z | 139 | en_eng | 72 |
| z_zh | 80 | eng_en | 111 |
| ch_c | 70 | in_ing | 64 |
| c_ch | 80 | ing_in | 68 |
| sh_s | 62 | f_h | 64 |
| s_sh | 98 | h_f | 106 |

Lexicon mining 候选按方向 25–129 不等（`term_mining_stats.json`）。

---

## 8. User-Level Generation

每个 user ~10–30 utterances；同一 user 多 applicable positions。  
`user_behaviour_metrics.json` 记录 per-user × family：intended strength、applicable、selected/realized/ASR rates。

---

## 9. Applicable Position Statistics

| Funnel 级 | Count |
|-----------|-------|
| ApplicablePositionCount | 3086 |
| SelectedCorruptionCount | 1313 |
| AcousticallyRealizedCount | 1028 |
| ASRObservableEffectCount | 1190 |

注：ASRObservable > Realized，因部分 `DIFFERENTLY_REALIZED` / 对齐边界仍记 ASR 效应，但 eligibility 更严。

---

## 10. Selection Behaviour

* Overall SelectionRate = **0.425**（由 strength mix 加权，非全 HIGH）
* 每方向 SelectionRate 均满足 **HIGH > MEDIUM > LOW > NONE**（NONE=0）
* 例 `n_l`：0.778 / 0.368 / 0.170 / 0.000

---

## 11. Acoustic Realization

* RealizationRate（selected→realized）= **0.783**
* TTS 失败仅 **4** 条（`TTS_REALIZATION_FAILED`）
* Phoneme 主路径；Surface 仅在可映射时使用

---

## 12. ASR Observable Effect

* ASREffectRate（selected→ASR change proxy）= **0.906**
* PairedASRChangeRate = **0.888**
* 人工未编辑任何 ASRHypothesis

---

## 13. End-to-End Behaviour

* EndToEndBehaviourRate = ASRObservable / Applicable = **0.386**
* 这是真实 pipeline efficiency，**进入训练分布**，不强制对齐 0.8

| Family group | E2E |
|--------------|-----|
| Initial | 0.410 |
| Final | 0.343 |

---

## 14. Per-Feature Fidelity（AccentFeatureFidelity V1）

| Feature | Fidelity | Supervision | mon_sel | mon_e2e | E2E HIGH | BaseReal |
|---------|----------|-------------|---------|---------|----------|----------|
| n_l | GOOD | TRAINABLE_CONTINUOUS | ✓ | ✓ | 0.714 | 0.911 |
| l_n | GOOD | TRAINABLE_CONTINUOUS | ✓ | ✓ | 0.760 | 0.900 |
| zh_z | GOOD | TRAINABLE_CONTINUOUS | ✓ | ✓ | 0.779 | 0.811 |
| z_zh | GOOD | TRAINABLE_CONTINUOUS | ✓ | ✓ | 0.719 | 0.900 |
| ch_c | GOOD | TRAINABLE_CONTINUOUS | ✓ | ✓ | 0.768 | 0.726 |
| c_ch | GOOD | TRAINABLE_CONTINUOUS | ✓ | ✓ | 0.700 | 0.863 |
| sh_s | GOOD | TRAINABLE_CONTINUOUS | ✓ | ✓ | 0.667 | 0.719 |
| s_sh | GOOD | TRAINABLE_CONTINUOUS | ✓ | ✓ | 0.731 | 0.776 |
| an_ang | GOOD | TRAINABLE_CONTINUOUS | ✓ | ✓ | 0.731 | 0.607 |
| ang_an | GOOD | TRAINABLE_CONTINUOUS | ✓ | ✓ | 0.730 | 0.938 |
| en_eng | GOOD | TRAINABLE_CONTINUOUS | ✓ | ✓ | 0.700 | 0.750 |
| eng_en | GOOD | TRAINABLE_CONTINUOUS | ✓ | ✓ | 0.708 | 0.643 |
| in_ing | GOOD | TRAINABLE_CONTINUOUS | ✓ | ✓ | 0.756 | 0.641 |
| ing_in | **USABLE** | TRAINABLE_CONTINUOUS | ✓ | ✓ | 0.652 | **0.235** |
| f_h | GOOD | TRAINABLE_CONTINUOUS | ✓ | ✓ | 0.893 | 0.985 |
| h_f | GOOD | TRAINABLE_CONTINUOUS | ✓ | ✓ | 0.748 | 0.963 |

**注意：** `ing_in` BaseRealization 偏低，虽过 continuous 门，Stage B 应重点监控；必要时降为 BINARY / MASK 部分 slice。

---

## 15. Initial vs Final Fidelity

* Initial：整体更稳；E2E 0.410；多数 GOOD + 高 BaseReal
* Final：E2E 0.343；`an/ang`、`en/eng` 可用；`ing_in` 最弱
* **不要**把 initial/final 混成单一平均后宣称“全好”

---

## 16. Surface vs Phoneme Fidelity

| Backend | Corrupted usage | 角色 |
|---------|-----------------|------|
| PHONEME | 1202（~91.5%） | 非词表音节主路径 |
| CHINESE_SURFACE | 89（~6.8%） | 词表可映射兜底 |
| CANONICAL | 1708 | control |

Phoneme 与 Surface **不等价**：scale 主分布由 Phoneme HTTP 驱动；禁止 per-worker 本地 Piper 多实例争 GPU。

---

## 17. Per-Strength Calibration

对全部 16 方向，E2E 与 Selection 均呈：

```text
HIGH > MEDIUM > LOW > NONE≈0
```

例 `n_l` E2E：0.714 / 0.368 / 0.170 / 0.000。  
强度档可分离 → **无需**整体退回 binary（除个别弱方向可局部采用）。

---

## 18. Monotonicity Analysis

* SelectionRate：16/16 严格单调
* E2E soft monotonic：16/16（允许小噪声容差）
* Neutral / NONE：接近零污染行为

---

## 19. Binary Fallback Analysis

* 正式标签：全部 `TRAINABLE_CONTINUOUS`；`trainable_binary=[]`
* 推荐监控降级：`ing_in`（及必要时 `an_ang` BaseReal 偏低切片）可 Stage B 内 **mask 或 binary OFF/ON**
* 不因 schema 有 16 维就强制同等监督权重

---

## 20. Term Mining

* 自 Lexicon SSOT 自动挖 2–3 字词为主
* 770 candidates；覆盖 16 directions
* 64 seed 仅作高质量 anchor，**非** 64×noise 扩 3k

---

## 21. Carrier Diversity

* 60 carrier templates（statement/question/request/travel/food/software/…）
* context_target_leak 跳过 1；主训排除泄漏

---

## 22. Paired Control Results

| Metric | Value |
|--------|-------|
| n_paired（corruption 侧） | 179 |
| PairedASRChangeRate | **0.888** |
| 多数方向 | ≥0.78 |
| 较弱 | `ing_in` 0.625；`s_sh` 0.714 |

同 GT/carrier/voice/term，仅改 pronunciation → 因果差清晰。

---

## 23. Tone Diagnostic Integration

**DEFERRED**。原因：timestamp→Tone offline 批处理成本高，且非本轮阻塞项。  
可行性：现有 Tone 模块可作 **OPTIONAL parallel enrichment**；下轮再接。

---

## 24. Tone Evidence Availability

未写入 `observed_tone`。契约预留三字段独立：

```text
ASR lexical tone | Observed acoustic tone | Target lexical tone
```

非词表 observed（如 lai3）允许保存；不 invent fake confidence。

---

## 25. CorruptionSpanAlignment

继续使用 gt/tts/asr span + confidence + `associated_with_corruption` + eligible。  
默认 pronunciation supervision：

```text
associated_with_corruption == true AND eligible == true
```

---

## 26. Eligible Positive Statistics

| Class | Count |
|-------|-------|
| ELIGIBLE_NO_CHANGE | 1708 |
| ELIGIBLE_PRONUNCIATION_POSITIVE | 1028 |
| INELIGIBLE_ALIGNMENT | 123 |
| INELIGIBLE_REALIZATION | 135 |
| INELIGIBLE_NON_TERM | 5 |

EligiblePronunciationPositiveRate（/corrupted）≈ **0.796**。

---

## 27. Non-Term Positive Analysis

* NonTermPositiveRate ≈ **0.39%**（5E proxy ~26.6% → 大幅下降）
* Ineligible 以 alignment / realization 为主，而非“整句任意 diff”
* 所有 ineligible **保留 provenance**，不进 Model2 pronunciation supervision

---

## 28. User Split

| Split | Utterances |
|-------|------------|
| train | 1920 |
| validation | 735 |
| test | 344 |

**user-disjoint**；`user_leaks=[]`。

---

## 29. Term Split

term-disjoint 审计：train↔val / train↔test overlap = **0**。  
保留 unseen-user × unseen-term 切片能力（split_manifest）。

---

## 30. Feature Combination Holdout

* Multi combos：72
* Holdout family sets：30+（见 `leakage_audit.json`）
* combo overlap train↔val/test = **0**

用于未来检测 Model2 是否只记 profile 模板。

---

## 31. Leakage Audit

| Check | Result |
|-------|--------|
| user leakage | 0 |
| term overlap | 0 |
| feature-combo overlap | 0 |
| context_target_leak skipped | 1 |

---

## 32. Condition Supervision Matrix

产物：`condition_supervision_matrix.json`

| Condition | Reliable? | Supervision | Fidelity | mask_default |
|-----------|-----------|-------------|----------|--------------|
| 16 phonetic dirs | yes | TRAINABLE_CONTINUOUS | GOOD/USABLE | 1 |
| tone_* | no | DEFER | UNUSABLE | 0 |
| personal_terms | no | DEFER | WEAK | 0 |
| domain_bias | no | DEFER | WEAK | 0 |

---

## 33. TRAINABLE / WEAK / DEFER Feature Matrix

* TRAINABLE_CONTINUOUS：16 phonetic
* TRAINABLE_BINARY：0（正式）
* WEAK / DEFER（phonetic）：0
* DEFER（非 phonetic）：tone / personal / domain

Stage B：**仅 TRAINABLE_*** 进入有效 mask；弱切片可运行时再 MASK。

---

## 34. TrainingSample / TrainRow Compatibility

* 现有 contract 可表达 profile + corruption provenance + eligibility
* 未来需显式 `phonetic_condition[i]` + `phonetic_mask[i]`（弱特征 mask=0）
* 本轮未发现 contract 无法表达条件数据 → **不重开 Stage A**

---

## 35. Dataset Artifacts

目录：`training/model2/dataset/pseudo_user_accent_scale_v1/`

```text
pseudo_users.jsonl
pseudo_user_profiles.jsonl
generation_plan.jsonl
paired_plan.jsonl
results.jsonl
training_samples.jsonl
model2_train_rows.jsonl
user_behaviour_metrics.json
feature_fidelity_metrics.json
paired_metrics.json
alignment_metrics.json
eligibility_metrics.json
split_manifest.json
leakage_audit.json
condition_supervision_matrix.json
service_lock.json
dataset_manifest.json
plan_manifest.json
term_mining_stats.json
lexicon_candidate_terms.jsonl
run_summary.json
```

---

## 36. Generation Performance

| Metric | Value |
|--------|-------|
| Wall time | ~4003 s（~66.7 min） |
| TTS calls / avg | 3178 / **205 ms** |
| ASR calls / avg | 3178 / **754 ms** |
| Main path | HTTP `/tts-pronunciation`（require_http_phoneme） |
| Local Piper fallback | 未作 scale 主路径 |

后续 10k/50k：ASR 为主要瓶颈；可批 ASR / 多 queue，但勿多开 Piper model instance。

---

## 37. Tests

`training/model2/tests/test_phase5f_accent_scale.py`（unittest **6/6 OK**）：

* strength probs；monotonic helpers；fidelity/supervision
* user mix/coverage；deterministic seed；user-disjoint splits

E2E：2999 真实 Piper→faster-whisper，非 mock metadata。

---

## 38. Runtime Non-Impact

未修改：

* Node FineSpan / Exact Recall / FuzzyPool / Domain Vote / KenLM / JobResult
* Gateway UserProfile / Scheduler correction 主链
* 生产 `POST /tts`

仅使用 training-only phoneme endpoints + offline dataset。

---

## 39. KEEP / MODIFY / ADD / DEFER

| Action | Item |
|--------|------|
| KEEP | TransformEngine V1；Surface+Phoneme；span alignment；strength 四档；5E endpoints |
| MODIFY | alignment rate 分母改为 corruption-planned；NonTerm 压降 |
| ADD | scale plan/users；behaviour funnel；fidelity V1；condition_supervision_matrix；eligibility classes；split/holdout |
| DEFER | Tone offline diagnostic；真实方言 correlation；正式 Stage B 训练；10k+ 扩容 |
| DELETE | 无（ineligible 保留 provenance） |

---

## 40. Risks

1. **`ing_in` BaseRealization 低** — continuous 标签偏乐观，需 Stage B 监控/可 MASK  
2. Final family E2E 低于 initial — 勿等权监督  
3. Multi-feature 为独立合成 — 真实用户相关结构未建模  
4. ASRObservable > Realized 计数差异 — 训练应用 eligibility class，勿裸用 ASR diff  
5. Tone 未接入 — 条件空间暂缺声学 tone 软证据  

---

## 41. Stage B Preconditions

已满足（Data Gate）：

* [x] 2k–5k 真实 TTS+ASR；provenance 完整；无手改 ASR  
* [x] Profile strength 影响发音分布；核心方向单调；neutral≈control  
* [x] n/l、zh/z、ch/c、sh/s、an/ang、en/eng 等 TRAINABLE_* 充足  
* [x] corruption-associated eligible 可靠；NonTerm 不主导  
* [x] user/term leakage=0；combo holdout 存在  
* [x] condition matrix 冻结；弱非 phonetic MASK  
* [x] production runtime 未动  

下一阶段可：**User-Conditioned Model2 Stage B 训练**（仍须单独计划；本报告不启动训练）。

---

## 42. Acceptance Checklist

| # | Criterion | Status |
|---|-----------|--------|
| 1 | 2999 real utterances | PASS |
| 2 | Intended vs observed 分离 | PASS |
| 3 | Four-level funnel 统计 | PASS |
| 4 | Selection 单调 HIGH>…>NONE | PASS |
| 5 | AccentFeatureFidelity V1 | PASS |
| 6 | Initial/Final 分开报告 | PASS |
| 7 | Surface/Phoneme 分开统计 | PASS |
| 8 | Paired causal metrics | PASS |
| 9 | Eligibility classes + 保留 ineligible | PASS |
| 10 | User/term/combo split | PASS |
| 11 | condition_supervision_matrix | PASS |
| 12 | 无正式模型训练 | PASS |
| 13 | Runtime 未改 | PASS |
| 14 | Tone 不阻塞（DEFER） | PASS |
| 15 | Stage B GO criteria | **PASS** |

---

## Interpretation（§56）

本轮 **不**证明 HIGH=恰好 80% ASR 错。  
本轮证明：UserProfile 参数能 **系统性、单调地** 改变真实语音与 ASR error distribution → Model2 有资格学习

```text
P(candidate | ASR, context, UserProfile)
```

而非仅

```text
P(candidate | generic phonetic distance)
```

---

## STOP Conditions Review

未触发：无可分离 behaviour / 主 feature 崩坏 / 筛选伪造相关 / eligible 过低 / phoneme 端点失控。  
回退桶：**无需**（PROFILE_CALIBRATION 等）。局部关注 FINAL_TRANSFORM（`ing_in`）。

---

**Verdict: Phase 5F = PASS / Stage B Data Gate GO. Model training = NOT RUN.**
