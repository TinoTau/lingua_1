# Lingua Model2 Phase 5D — Pronunciation-Corrupted TTS Probe Report

| Field | Value |
|-------|-------|
| Date | 2026-08-13 |
| Nature | **Pronunciation-Corrupted TTS Dataset Probe**（不训练模型） |
| Input basis | Phase 5C FAIL（canonical TTS 距离饱和） |
| Output | `training/model2/dataset/pronunciation_corrupted_probe_v1/` |
| Markers | `PRONUNCIATION_CORRUPTED_PROBE` / `NOT_FOR_RUNTIME` / `NOT_FROZEN` |
| Verdict | **MECHANISM PASS / AMBIGUITY PARTIAL — 暂不 GO 2k–5k** |
| Failure class（相对 GO） | **DATA/AMBIGUITY**（机制已通；FuzzyPool 难度提升不足） |

---

## 1. Executive Summary

本轮实现并跑通 **Pronunciation-Corrupted TTS Pipeline V1**：

```text
GroundTruth → PronunciationCorruptor → TTSInputText ≠ GT
→ Piper → audio → production faster-whisper → ASRHypothesis（不可人工改）
```

| 项 | 结果 |
|----|------|
| Utterances | **350 / 350** TTS+ASR 成功 |
| Corrupted / Control | **159 / 191** |
| Pseudo users | **35**（30 biased + 5 neutral） |
| PronunciationRealizationSuccessRate | **0.805**（89 INTENDED + 39 DIFFERENTLY） |
| ASRErrorYieldGivenCorruption | **0.956** |
| ASRErrorYieldGivenRealizedCorruption | **1.0** |
| FuzzyPool Recall（TERM_POSITIVE） | **100%** |
| EQUAL_DISTANCE rate（vs canonical 5C） | **0.056 → 0.102**（约 +4.6pp） |
| wrong-nearest rate | **0.018 → 0.032**（+1.4pp，未达“明显”） |
| B_pool_distance R@1 | **0.982 → 0.968**（略降，仍饱和） |
| 模型训练 | **未跑** |

**结论：** 发音污染必须发生在 TTS 之前的机制 **已验证**；伪用户 profile 与声学实现可对齐；但相对 Phase 5C，距离歧义改善 **不够** 以解除 2k–5k 扩量 GO。下一步优先加强 resolver / 选词（近邻可混项）与可选 phoneme override，**禁止**退回人工改 ASR。

---

## 2. Phase5C Failure Review

Phase 5C：`B_pool_distance R@1 = 0.982`；真正 EQUAL_DISTANCE 仅 126；canonical Piper + noise/speed/reverb 产生的 ASR 错大多落在 target 的 **unique nearest**。失败类 **DATA**，不得靠扩到 10k–20k 掩盖。

本轮修正方向：不再等待 TTS“随机读错”，在送入 Piper 前主动替换目标词为指定错误读音表面。

---

## 3. Revised TTS Corruption Principle

**正确：** 污染发生在 TTS 之前。  
**错误：** 正常 TTS 后再手改 ASR 文本（那仍是 `RULE_SYNTHETIC`）。

V1 优先 **汉字表面替换**（最简单可靠）；HTTP 层无 phoneme 接口时，不引入复杂 backend。

---

## 4. GroundTruth vs TTSInput vs ASRHypothesis Contract

| 文本 | 含义 |
|------|------|
| `GroundTruthText` | 用户真正想说的正确内容（训练 target 侧） |
| `TTSInputText` | 为模拟发音错误而修改后的朗读文本 |
| `ASRHypothesis` | production ASR 对真实音频的输出（训练 source 侧） |

训练关系仍是：`ASRHypothesis → GroundTruth`。  
Invariant：`corruption_applied ⇒ GT ≠ TTSInput`；ASR 永不人工覆写。

---

## 5. Piper Capability Audit

| 能力 | 现状 |
|------|------|
| HTTP `/tts` | 仅 `text` + `voice`（中文文本） |
| phoneme IDs / espeak 序列 / SSML | **未经 HTTP 暴露** |
| 内部 ChinesePhonemizer | 存在于 Piper 实现，**非本轮 V1 接口** |
| tone-number 拼音当 TTS 输入 | **禁止**（会当拉丁/数字读） |

**判定：** V1 = Chinese-surface substitution；Phoneme Backend V2 = **DEFER**（若汉字无法稳定驱动再开）。

---

## 6. UserFeatureSchema Reuse

复用冻结 `PHONETIC_FEATURE_KEYS`（16 维，与 `feature_schema.rs` / `contract.py` 一致）。  
不新建第二份 confusion schema；不在 schema 外的方向上设 `realized=true`（标 `UNSUPPORTED_FOR_PROFILE_V1`）。

---

## 7. PronunciationCorruptor V1

离线模块：`training/model2/pronunciation/`

| 文件 | 职责 |
|------|------|
| `syllable_substitution.py` | initial/final 解析 + 方向替换 |
| `tts_surface_resolver.py` | syllable → 汉字表面（确定性） |
| `corruptor.py` | GT term → TTSInput 整句替换 |
| `validation.py` | Piper 短载体验证 + realization 分类 |
| `behaviour.py` | 用户级 PronunciationBehaviourProfile |

---

## 8. Supported Confusion Families

全部 16 个冻结方向均可尝试；Probe 实可实现 pair 分布（plan 前审计）：

`an_ang` 92, `ang_an` 78, `f_h` 78, `zh_z` 61, `l_n` 60, `sh_s` 57, … `n_l` 21, `h_f` 16。

已知：**普通话无 `lai3` 等音节** → `奶(nai3)→lai3` 类为 `UNREALIZABLE_BY_CURRENT_TTS`（跳过，不硬凑）。

---

## 9. Tone Preservation

V1 默认 **保持原 tone**（`nai3 → lai3`，不随机改调）。  
Tone corruption 明确 **DEFER** 为 V1.1，避免与 initial/final 混淆因果。

---

## 10. TTS Surface Resolver

`TtsPronunciationSurfaceMap V1`（`surface_map.json`）：

- 反向 CJK→TONE3 索引（pypinyin，derived artifact，非语言 SSOT）
- 优选常用/稳定字 + 确定性 hash 选择
- Piper 短载体 → ASR 验证后方可 `VALIDATED`

构建统计：33 entries；**27 VALIDATED / 6 REJECTED**。

---

## 11. Surface Candidate Sources

- Node pinyin-pro / Python `syllables_from_text_tone_num`（语气）
- `pypinyin` CJK 反查
- 小型 preferred map（realization artifact）

未新建大型独立词典系统。

---

## 12. Piper Realization Validation

每条 bootstrap 音节：`请读{CHAR}` → Piper → ASR；base syllable 命中才 `VALIDATED`。  
拒收字典音但 Piper 不稳定的候选。

---

## 13. No-Surface Fallback Strategy

A 同音字 → B 短多字（V1 未强依赖）→ C phoneme（审计后 DEFER）→ D `UNREALIZABLE_BY_CURRENT_TTS` 跳过。  
**禁止**改 ASR 或不匹配硬凑。

---

## 14. Phoneme Backend Audit

HTTP 无 phoneme override → **V2 DEFER**。若后续汉字无法覆盖关键 family，优先研究 Piper/eSpeak 底层接口，而非 RULE 伪装。

---

## 15. Whole-Sentence Construction

仅替换 carrier 中 `{TERM}` 一次：`我想买{CORRUPTED_SURFACE}推荐的产品`。  
上下文不变 → 模拟“固定 pronunciation confusion”。

---

## 16. Pseudo User Generation

35 users：先 `PronunciationBehaviourProfile`，再生成 utterance。  
personal_terms / domain **minimal/neutral**（本轮不作为主变量）。

---

## 17. User-Level Corruption Consistency

同一 pseudo user 多句共享 `family_prob`；Bernoulli 由 `seed|user|family|plan_id` 决定。  
中性用户：不施加 corruption（control）。

---

## 18. Profile Strength Semantics

Probe 档位（**未冻结生产值**）：

| Strength | Apply prob |
|----------|------------|
| LOW | 0.20 |
| MEDIUM | 0.50 |
| HIGH | 0.80 |

含义：该 family 在可适用位置出现的概率，非单句“发音强度”。

---

## 19. Probe Dataset Scope

| 项 | 值 |
|----|----|
| planned | 350（区间 200–500） |
| corrupted | 159 |
| control | 191 |
| users | 35（含 5 neutral） |
| utterances/user | 10 |
| wall | ~441 s |
| TTS avg | ~318 ms |
| ASR avg | ~739 ms |

---

## 20. Realization Status Classification

| Status | n（corrupted） |
|--------|----------------|
| REALIZED_AS_INTENDED | 89 |
| REALIZED_DIFFERENTLY | 39 |
| NO_ASR_EFFECT | 31 |
| TTS_REALIZATION_FAILED | 0 |

`phonetic_profile_acoustically_realized=true` **仅**在 REALIZED_* 时设置。

---

## 21. PronunciationRealizationSuccessRate

**0.805**（128/159）。核心 family 可通过汉字表面驱动 Piper。

---

## 22. ASR Error Yield

- Given corruption：**0.956**
- Given realized corruption：**1.0**

说明：TTS 读错后 ASR 几乎总与 GT 不同；也存在“读错但 ASR 修回”的 NO_ASR_EFFECT（31），保留为有价值分布。

---

## 23. Positive / Negative Statistics

| Kind | n |
|------|---|
| POSITIVE | 502 |
| NEGATIVE | 94 |
| TERM_POSITIVE | 315 |
| NON_TERM_POSITIVE | 187 |

非 term positive 仍偏高（对齐问题残留）——扩量前需继续压。

---

## 24. FuzzyPool Visibility

TERM_POSITIVE 上 target in pool：**100%**（≥95% ✓）。

---

## 25. Distance Baseline

Pronunciation-corrupted TERM_POSITIVE：`B_pool_distance R@1 = 0.968`（仍高）。

---

## 26. Equal-Distance Rate

| Source | EQUAL_DISTANCE rate |
|--------|---------------------|
| A Canonical TTS (5C) | 0.056 |
| B Pron-Corrupted | **0.102** |
| C RULE | 0.093 |

相对 canonical **提升约 1.8×**；但 probe 内 control 亦约 0.102 → 部分来自可实现 family 的选词分布，不全是 corruption 单独贡献。

---

## 27. Wrong-Nearest Rate

| Source | wrong-nearest |
|--------|---------------|
| A Canonical | 0.018 |
| B Pron-Corrupted | 0.032 |
| C RULE | 0.928 |

提升微弱；RULE 仍是“难度另一极端”（不真实声学）。

---

## 28. Canonical vs Pronunciation-Corrupted vs Rule Comparison

| Metric | A Canonical | B Pron-Corr | C RULE |
|--------|-------------|-------------|--------|
| R@1 distance | 0.982 | 0.968 | 0.072 |
| equal-distance | 0.056 | 0.102 | 0.093 |
| wrong-nearest | 0.018 | 0.032 | 0.928 |
| Acoustic real? | yes（canonical） | **yes（intended corrupt）** | no |
| Profile couple? | weak | **yes（realized）** | no |

**定位：** B 填补了 A（真声学但太易）与 C（难但不真）之间的 **真实性缺口**；**难度缺口**尚未充分填补。

---

## 29. Non-Term Positive Analysis

187/502 positives 为 non-term（对齐 span ≠ planned term）。需在扩量前加强 term-span 对齐过滤（与 5C 同类问题）。

---

## 30. Provenance Contract

新增：`TTS_PRONUNCIATION_CORRUPTED`（Python + Rust enum）。  
永久区分于 `TTS_ASR_SYNTHETIC` / `RULE_SYNTHETIC` / `REAL_USER_CORRECTION`。

样本元数据包含：GT、TTSInput、family、syllables、surface method/version、pseudo_user、realized、realization_status、tts/asr lock、seed。

---

## 31. Dataset Artifacts

`training/model2/dataset/pronunciation_corrupted_probe_v1/`：

- `pseudo_users.jsonl` / `pseudo_user_profiles.jsonl`
- `pronunciation_plan.jsonl` / `plan.jsonl`
- `surface_map.json`
- `results.jsonl` / `training_samples.jsonl` / `model2_train_rows.jsonl`
- `realization_metrics.json` / `ambiguity_metrics.json` / `fuzzy_pool_metrics.json`
- `source_comparison.json` / `service_lock.json` / `dataset_manifest.json`

---

## 32. Tests

`training/model2/tests/test_phase5d_pronunciation.py` — **17 passed**：

- syllable corruption + tone preserve  
- resolver determinism / no-candidate  
- corruptor GT≠TTSInput / unsupported family  
- user consistency + Bernoulli  
- provenance enum  

Piper realization：由 `build_pronunciation_surface_map.py` 实测（27 validated）。

---

## 33. Runtime Non-Impact

未修改 Node runtime / JobResult / Exact / Domain Vote / KenLM / 冻结推理管线。  
仅离线 `training/model2` + TrainingSourceType 枚举扩展。

---

## 34. KEEP / MODIFY / ADD / DELETE / DEFER

| 动作 | 项 |
|------|----|
| KEEP | UserFeatureSchema V1；FuzzyPool V1；三文本契约；真实 ASR |
| ADD | PronunciationCorruptor；SurfaceMap；TTS_PRONUNCIATION_CORRUPTED；behaviour profile |
| MODIFY | sample_builder 尊重 metadata.source_type；realized 掩码 |
| DELETE | （无）不得用手改 ASR 冒充本 provenance |
| DEFER | Tone corruption V1.1；Phoneme Backend V2；Stage B 训练；2k–5k 扩量 |

---

## 35. Risks

1. 部分目标音节普通话无字 / Piper 拒收 → coverage 空洞  
2. 选词偏差使 probe 内 control 与 corrupted 歧义率接近  
3. 非 term positive 偏高稀释信号  
4. Surface 偶发冷僻字（虽通过 ASR 验证）可能影响自然度  
5. 过早扩量会在仍饱和的 R@1 上浪费 TTS/ASR 成本  

---

## 36. Scale Dataset Preconditions

扩到 2k–5k 前至少满足：

1. 对 EQUAL_DISTANCE / wrong-nearest 有 **更强** 的选词策略（优先 near-neighbor 可混 term）  
2. Surface map 覆盖核心 family，REJECTED 有替代或明确 UNREALIZABLE 配额  
3. Probe 内 **corrupted ≫ control** 的歧义差达到可重复显著水平  
4. non-term positive 率下降  
5. 仍禁止手改 ASR；若汉字不够 → 开 phoneme V2 审计，不退回 RULE  

当前：**机制可复用；扩量 GO = NO**。

---

## 37. Acceptance Checklist

| # | Criterion | Status |
|---|-----------|--------|
| 1 | corruption 在 TTS 之前 | **PASS** |
| 2 | ASRHypothesis 来自 production ASR | **PASS** |
| 3 | 若干 core family Piper 可实现 | **PASS** |
| 4 | realization 可自动判断 | **PASS** |
| 5 | realized=true 不伪造 | **PASS** |
| 6 | pseudo user 与 behaviour 一致 | **PASS** |
| 7 | realization success 足够 | **PASS**（0.805） |
| 8 | FuzzyPool visibility ≥95% | **PASS**（1.0） |
| 9 | equal/wrong-nearest 明显增加 | **PARTIAL**（equal↑；wrong-nearest 弱） |
| 10 | B_pool_distance 饱和明显缓解 | **FAIL**（0.968 仍饱和） |
| 11 | provenance 完整 | **PASS** |
| 12 | runtime 未改 | **PASS** |

---

## Verdict

**MECHANISM PASS / AMBIGUITY PARTIAL — 不进入 2k–5k Pronunciation-Corrupted Scale；本轮不训练 Stage B / M0 / M1。**

下一轮优先：

1. 针对 corrupted syllable 的 **近邻可混词表** 选词；  
2. 扩大并净化 SurfaceMap；  
3. 必要时 Piper phoneme-level override 审计；  
4. 压非 term positive。  

**禁止**退回人工修改 ASRHypothesis。
