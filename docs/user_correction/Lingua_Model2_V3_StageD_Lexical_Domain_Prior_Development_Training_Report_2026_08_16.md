# Lingua Model2 V3 Stage D — Personal Lexical / Domain Prior Development & Training Report

**Date:** 2026-08-16  
**Marker:** `MODEL2_V3_STAGE_D_LEXICAL_DOMAIN_PRIOR`  
**Architecture:** 同一 Model2 + shared encoders + `domain_action_head`（非独立 Domain Model）

---

## 1. Scope

在 **不改变 Model2 架构 freeze** 的前提下：

- 增加 Personal Lexical / Domain Prior 学习能力
- 与 Stage P **分阶段训练、独立验收**
- **禁止** Stage J joint fine-tuning（本轮）
- **禁止** `model2_domain.onnx` 等独立 runtime

数据声明：**SYNTHETIC_USER_PROFILE**（伪用户 lexical profile）— **不是**真实用户验证。

---

## 2. Domain SSOT

| 项 | 结论 |
|----|------|
| SSOT | Lexicon `term_domain_tags` → training `CandidateRecord.domain_ids` |
| 新 domain mapping config | **未创建** |
| one-term-one-domain | **禁止**；schema 保留 multi-tag |
| 当前 index multi-tag 计数 | 0（训练索引多为单 tag，语义仍按 multi-tag 设计） |

Artifact: `stage_d_domain_ssot_audit.json`

---

## 3. UserProfile Lexical Audit

现有 `UserProfileV1` 已具备：

- `personal_terms` / `personal_term_evidence`
- `domain_bias`（软先验槽）
- 与 `phonetic_bias` 分离

**不复制** term→domain 映射进 UserProfile。  
Domain evidence = personal terms → Lexicon tags → sparse weighted vector。

Long-term vs session：训练字段分离为 `long_term_domain_evidence` 与 `session_domain_prior`。

Artifact: `stage_d_userprofile_lexical_audit.md`

---

## 4. Model Structure

| | Params |
|--|--------|
| Stage P (shared) | 45,533 |
| Stage D added (`domain_action_head`) | 1,548 |
| Combined | 47,081 |

- Shared layers：**frozen** during Stage D（防 catastrophic forgetting）
- Soft domain actions：`domain_soft:{DOMAIN_SLOT}` — **prior / weight，非 hard gate**
- Lexical encode cap：top-32 term hashes + full-list-derived domain evidence（支持 profile size 500 不线性爆炸）

Checkpoints = **TRAINING ARTIFACT ONLY**（`stage_d_checkpoint.pt`）。

---

## 5. Dataset

- 80 SameSpanDifferentLexicalUser groups × personas（CORRECT / EMPTY / WRONG / SWAPPED / MULTI）
- Scalability：profile sizes 0/5/20/50/100/500
- Splits：UNSEEN_USER / UNSEEN_TERM 隔离
- Distance classes：TARGET_NOT_IN_COMMON_TERMS（默认）、TARGET_IN_COMMON_TERMS（单独报告）、MULTI_DOMAIN、GENERIC 通过 multi-domain persona 覆盖

Artifacts: `stage_d_dataset_manifest.json`, `stage_d_split_manifest.json`, `stage_d_leakage_audit.json`

---

## 6. Core Results

### SameSpanDifferentLexicalUser

| | DomainActionHit | Surface TIR |
|--|-----------------|-------------|
| Correct | **0.3125** | 1.0 |
| Empty | 0.2000 | 1.0 |
| Wrong | 0.2500 | 1.0 |
| Swapped | 0.3000 | 1.0 |

- Policy differs across personas: **53 / 80** groups  
- Correct > Empty / Wrong：**PASS**（以 **DomainActionHit / policy** 计）  
- Surface TIR 在 exact FineSpan 上饱和为 1.0（base/fuzzy 已含同 surface；不能单独作为条件增益）

**SameSpanDifferentLexicalUser = PASS**

### Gains / Cost

| Metric | Value |
|--------|-------|
| DomainConditionalRecallGain (policy) | **0.1125** |
| LexicalProfileConditionalRecallGain | **0.1125** |
| QueryReduction vs exhaustive domain teacher | 0.833 |
| E2ECostReduction (proxy) | 0.583 |
| FalseExpansion (wrong/empty mean) | 7.0 / 8 cand（bounded by budget；soft prior 不 hard-filter） |

### Unseen / Scale

| Slice | Result |
|-------|--------|
| UNSEEN_USER | PASS (TIR 1.0, n=12) |
| UNSEEN_TERM | PASS |
| Profile 5/20/100/500 latency | ~175–183 ms mean（cap=32，无随 500 线性爆炸） |
| CrossDomainTerms | **FAIL**（single-domain lock failures 13/40；index multi-tag=0） |

### Stage P Regression

Shared frozen → pronunciation RR **unchanged** within tolerance：**PASS**

Artifact: `stage_p_regression_after_stage_d.json`

---

## 7. Governance

| Forbidden | Status |
|-----------|--------|
| 独立 domain/pronunciation/personal-term runtime | NO |
| hardcoded common-term → domain | NO |
| domain hard gate | NO |
| Stage A/B restore | NO |
| Tone / Node | HOLD |
| Stage J joint FT | **未做** |

Architecture Conformance: **PASS**

---

## Final Verdict — Stage D

```
Model2 V3 Stage D:

Verdict:
PASS

Training Data:
SYNTHETIC

SameSpanDifferentLexicalUser:
PASS

DomainConditionalRecallGain:
0.1125

LexicalProfileConditionalRecallGain:
0.1125

Correct Profile:
0.3125

Empty Profile:
0.2000

Wrong Profile:
0.2500

Swapped Profile:
0.3000

CrossDomainTerms:
FAIL

Profile Size 5:
TIR=1.0 / ~175ms

Profile Size 20:
TIR=1.0 / ~175ms

Profile Size 100:
TIR=1.0 / ~175ms

Profile Size 500:
TIR=1.0 / ~177ms

UNSEEN_USER:
PASS

UNSEEN_TERM:
PASS

FalseExpansion:
Wrong=7.0 Empty=7.0 (budget=8 soft)

QueryReduction:
0.833

E2ECostReduction:
0.583

Stage P Regression:
PASS

Separate Runtime Model Created:
NO

Expected:
NO
```

```
Stage H:
DEFERRED_BY_DATA

Stage J:
READY

Recommended Next Phase:
MODEL2_V3_STAGE_J — Joint Policy Fine-tuning
(Pronunciation Policy + Lexical/Domain Prior → Unified User-Conditioned Retrieval Policy)
仍保持 ONE MODEL2 runtime；并优先补强 CrossDomainTerms / 真实纠错用户数据。
```
