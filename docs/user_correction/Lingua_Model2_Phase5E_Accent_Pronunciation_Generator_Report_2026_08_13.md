# Lingua Model2 Phase 5E — Accent Pronunciation Generator Report

| Field | Value |
|-------|-------|
| Date | 2026-08-13 |
| Nature | Accent-Oriented TTS Pronunciation Generator Audit & Development |
| Basis | Phase 5D MECHANISM PASS / AMBIGUITY PARTIAL |
| Dataset | `training/model2/dataset/accent_generator_probe_v1/` |
| Piper audit | `Lingua_Model2_Piper_Phoneme_Realization_Audit_2026_08_13.md` |
| Markers | `ACCENT_GENERATOR_PROBE` / `NOT_FOR_RUNTIME` / `NOT_FROZEN` |
| Verdict | **GO（可进入 PseudoUser Accent Dataset Scale Probe）** |
| Model training | **NOT RUN** |
| 2k–5k expansion | **NOT RUN** |

---

## 1. Executive Summary

本轮将发音污染从「找同音汉字」升级为 **结构化口音生成**：

```text
Target → PronunciationSyllable{initial,final,tone}
→ TransformEngine(UserFeature)
→ Realizer(Surface | Phoneme)
→ Piper audio → production ASR
```

| 指标 | 结果 |
|------|------|
| Seed pairs | **64 / 64**（16 directions × 4） |
| TotalRealizationRate | **1.0** |
| TransformationCoverageRate | **1.0** |
| Surface / Phoneme | 13 / 51 |
| PairedASRChangeRate | **0.703** |
| nai3→lai3 | **PHONEME_REALIZED**（ASR：奶→来） |
| NON_LEXICAL base_rate | 0.451 |
| CorruptionAssociated rate | 0.766 |
| Eligible term-span rate | 0.734 |

**冻结原则已落实：** 发音是声学证据，**不要求**对应普通话词表条目；`lai3` 不再在 Transform 阶段被丢弃。

---

## 2. Phase5D Findings

5D 证明 before-TTS corruption 机制成立，但 SurfaceMap 仅 27 VALIDATED；`nai3→lai3` 因无合适汉字被跳过；与 control 的因果差不够清晰。本轮保留 5D 管线，补上 PhonemeRealizer + paired causal 评测。

---

## 3. Accent Generator Objective

模拟用户长期口音/发音习惯，而非仅做「合法汉字替换」。

---

## 4. Canonical Pronunciation Representation

`PronunciationSyllable { initial, final, tone, lexical_status }`  
`lexical_status ∈ {LEXICAL, NON_LEXICAL, UNKNOWN}`  
Compact 形式 `nai3` 仅作序列化，变换一律作用在结构字段上。

---

## 5. Initial/Final/Tone Decomposition

解析最长声母优先（zh/ch/sh…）。Tone 默认 **PRESERVE**。

---

## 6. Transform Engine

`PronunciationTransformEngine V1` 统一处理 16 个 UserFeature 方向。  
适用性按 component 精确匹配（禁止 `"n" in pinyin` 字符串误伤）。

---

## 7. 16 UserFeature Directions

全部覆盖于 Seed Cases；每方向 4 个 paired seeds。`TransformationCoverageRate = 1.0`。

---

## 8. Lexical vs Acoustic Validity

| 概念 | 含义 |
|------|------|
| LEXICALLY_UNREALIZABLE | 无稳定常用汉字表面 |
| ACOUSTICALLY_INVALID | Piper/backend 无法发该音 |

二者分离。无汉字 → `PHONEME_REQUIRED`，不是 Transform 丢弃。

---

## 9. Chinese Surface Realizer

Backend A，**KEEP** 5D SurfaceMap。优先常用稳定字；冷僻字降级为 `PHONEME_REQUIRED`。

---

## 10. SurfaceMap V2

`surface_map_v2.json`：

| Status | n |
|--------|---|
| SURFACE_VALIDATED | 23 |
| SURFACE_REJECTED | 6 |
| PHONEME_REQUIRED | 4 |
| UNREALIZABLE | 0 |

---

## 11. Piper Phoneme Audit

详见独立审计文档。要点：

- 生产 voice = **huayan + espeak cmn**（不是 aishell3 ChinesePhonemizer）
- 可 `phonemes_to_ids → phoneme_ids_to_audio` 绕过 text frontend
- 新增 training-only：`/tts-phonemize`、`/tts-pronunciation`
- **生产 `/tts` 未改**

---

## 12. Phoneme Realizer

Backend B：对 GT 逐字 phonemize，在 corrupted positions 上做 espeak initial/final 变换后合成。  
HTTP 不可用时 local PiperVoice fallback（offline）。

---

## 13. nai3→lai3 PoC

| Field | Value |
|-------|-------|
| backend | **PHONEME** |
| canonical ASR | 帮我查一下**奶** |
| corrupted ASR | 帮我查一下**来** |
| base_realized | **true** |
| tone_realized | false（ASR 记为 lai2；base 正确） |
| status | BASE_REALIZED |

**结论：PHONEME_REALIZED（技术可行）。**

---

## 14. Other Non-Lexical PoCs

51 条 NON_LEXICAL；base_rate **0.451**。低于 LEXICAL 的 0.769，但仍大量可驱动 ASR 变化。  
部分 final 家族（尤其 `in_ing`）PairedASRChange=0，需在 Scale 前加强 final 变换保真。

---

## 15. Seed Cases Integration

`training/model2/pronunciation/seed_cases_v1.jsonl`：**64** seeds（原文档未入库，已机器可读重建）。  
字段含 seed_id / target / pinyin / family / corrupted_pinyin / carriers / tone_policy。

---

## 16. Multi-Syllable Corruption

`decide_positions` 按 applicable index 独立 Bernoulli（HIGH=0.8）；不强制整词全改。例：奶奶可产生部分位置 n→l。

---

## 17. Probabilistic User Behaviour

沿用 LOW/MEDIUM/HIGH；本 probe 默认 HIGH 以保证 paired 因果功率。

---

## 18. Paired Generation

每 seed：`CANONICAL` vs `PRONUNCIATION_CORRUPTED`，同 GT/carrier/voice/ASR；唯一主变量 = pronunciation。

---

## 19. Paired Causal Results

| Metric | Value |
|--------|-------|
| PairedASRChangeRate | **0.703** |
| mean target_rank_delta | +1.0 |
| mean distance_margin_delta | −0.09 |

多数方向 ASR 变化率 ≥0.5；`in_ing=0`、`eng_en=0.25` 为弱项。

---

## 20. Realization Validation V2

区分 BASE / TONE / FULL / DIFFERENTLY / NO_ASR_EFFECT。  
ASR 非唯一声学真理；Tone 模块复用 **DEFER**（不足则不强建第三 ASR）。

---

## 21. Base/Tone/Full Realization

| Rate | Value |
|------|-------|
| Base | 0.516 |
| Tone | 0.234 |
| Full | 0.234 |

口音主信号在 **base**；tone 仍独立字段观察。

---

## 22. Term-Span Alignment

`CorruptionSpanAlignment V1` 记录 gt/tts/asr span、confidence、associated、eligible。  
对齐失败不删 audio/ASR/GT，仅 `MODEL2_TERM_TRAINING_ELIGIBLE=false`。

---

## 23. NON_TERM_POSITIVE Analysis

5D：187/502 ≈ 37% non-term。  
5E proxy：`NonTermPositiveProxyRate = 0.266`；`eligible_rate = 0.734`。  
主因：ASR 收回 GT term、或 align 落到非 term span。已可用 `associated_with_corruption` 过滤 supervision。

---

## 24. 16-Direction Coverage

全部 16 方向均有 paired 实现路径（Surface 或 Phoneme）。Coverage **1.0**。

---

## 25. Lexical vs Non-Lexical Coverage

| Slice | n | Base rate |
|-------|---|-----------|
| LEXICAL | 13 | 0.769 |
| NON_LEXICAL | 51 | 0.451 |

Phoneme backend **足以支撑**无汉字错音生成；保真仍需 Scale 前按方向校准。

---

## 26. Dataset Artifacts

`training/model2/dataset/accent_generator_probe_v1/`：

- paired_plan/results.jsonl  
- realization_results / alignment_results.jsonl  
- transformation_coverage / realization_metrics / paired_metrics / alignment_metrics.json  
- surface_map_v2.json / service_lock.json / dataset_manifest.json  

代码：`pronunciation_syllable.py`、`transform_engine.py`、`realizer.py`、`surface_realizer.py`、`phoneme_realizer.py`、`validation_v2.py`、`span_alignment.py`、`seed_cases_v1.jsonl`。

---

## 27. Tests

`test_phase5e_accent.py` — 7 passed（分解、变换、espeak swap、64 seeds）。  
端到端：64 paired probe + nai3 PoC。

---

## 28. Runtime Non-Impact

未改 ASR/FW/Exact/FuzzyPool runtime/Domain Vote/KenLM/JobResult/Web/Scheduler。  
仅 training/model2 + Piper **training-only** 端点；生产 `/tts` 契约不变。

---

## 29. KEEP / MODIFY / ADD / DELETE / DEFER

| 动作 | 项 |
|------|----|
| KEEP | 5D before-TTS 机制；SurfaceMap；UserFeatureSchema；伪用户概率 |
| ADD | TransformEngine；PhonemeRealizer；SurfaceMap V2；Seeds；paired metrics；training-only TTS endpoints |
| MODIFY | Realizer 路由 Surface→Phoneme；realization V2 |
| DELETE | 「无汉字 ⇒ 丢弃 corruption」硬门 |
| DEFER | Tone corruption；Stage B/M0/M1；2k–5k；复杂 family correlation；Tone 诊断复用 |

---

## 30. Risks

1. Final 变换（in/ing 等）espeak 启发式不够稳  
2. Tone marker 与 pinyin tone 非 1:1  
3. Local Piper 与服务争用 GPU  
4. Base realization 对 NON_LEXICAL 仍仅 ~45%  
5. 过早扩量会放大弱方向噪声  

---

## 31. Scale Dataset Preconditions

进入 **PseudoUser Accent Dataset Scale Probe** 前建议：

1. 按方向校准 final 变换（尤其 in↔ing）  
2. 固定 Phoneme HTTP 路径（重启 Piper 加载新端点）或冻结 local fallback  
3. supervision 默认 `associated_with_corruption && eligible`  
4. 保持 paired canonical 对照抽样  
5. 仍禁止手改 ASRHypothesis  

---

## 32. Acceptance Checklist

| Criterion | Status |
|-----------|--------|
| initial/final/tone 结构化 | **PASS** |
| 统一 TransformEngine | **PASS** |
| Surface 仍可用 | **PASS** |
| 无汉字不错过 Transform | **PASS** |
| Phoneme feasibility 明确 | **PASS** |
| nai3→lai3 有结论 | **PASS（PHONEME_REALIZED）** |
| 16 方向可量化 coverage | **PASS** |
| paired 因果改变 ASR | **PASS（0.70）** |
| alignment / NON_TERM 原因明确 | **PASS** |
| provenance / runtime / 不伪改 ASR | **PASS** |

---

## Verdict

**GO → 下一阶段 PseudoUser Accent Dataset Scale Probe。**

本轮不训练模型、不扩 2k–5k。Scale 须强化 final 变换保真，并以 corruption-associated eligible spans 作为 pronunciation supervision 默认入口。
