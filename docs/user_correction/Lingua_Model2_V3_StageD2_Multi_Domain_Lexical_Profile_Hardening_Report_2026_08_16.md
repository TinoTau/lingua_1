# Lingua Model2 V3 Stage D2 — Multi-Domain Lexical Profile Hardening Report

**Date:** 2026-08-16  
**Phase:** `MODEL2_V3_STAGE_D2_MULTI_DOMAIN_HARDENING`  
**Stage P:** FROZEN（未重训）  
**Stage J:** NOT_READY

---

## 0. Stage D1 Baseline（不得覆盖）

| Metric | D1 |
|--------|-----|
| Correct / Empty / Wrong / Swapped DomainActionHit | 0.3125 / 0.2000 / 0.2500 / 0.3000 |
| Correct−Swapped | **0.0125** |
| CrossDomain lock | **13 / 40** |
| Training index multi-tag | **0** |
| DomainConditionalRecallGain | 0.1125 |

---

## 1. Three Primary Questions

### Q1 — Schema multi-tag but index = 0？

**不是**源数据缺失。

| Layer | Multi-tag |
|-------|-----------|
| `term_domain_tags_corrected.csv` | **46 / 551 terms** |
| `domain_lexicon` flatten | 一行一 domain（runtime 物化，可接受） |
| `build_candidate_index_from_sqlite` | **`domain_ids=[single]` + term_id 按 domain 拆分** ← **主丢失点** |
| Stage D1 training index | multi-tag records = **0** |

详见：`stage_d2_domain_multitag_dataflow_audit.md`

### Q2 — single-domain lock？

Index 把一词拆成多个单 tag `CandidateRecord` → teacher/label 倾向 one-hot；再叠加强制选 domain + 填满 budget。

### Q3 — Correct≈Swapped？

BCE-only、无 Correct-vs-Wrong/Swapped ranking、Empty 也被强制选 domain、Wrong 仍填满 8 候选。

---

## 2. HARD STOP

| Check | Result |
|-------|--------|
| SOURCE_DATA_MULTITAG_MISSING | **False** |
| 源 multi-tag | 46 terms，ratio ≈ 0.083 |
| 处置 | **继续**；禁止用 synthetic tags 伪装 SSOT |

---

## 3. Fixes Applied（无新 mapping config）

1. **Training index enrich**（sibling flatten 行重聚合 + SSOT CSV 补全）  
   - multi-tag records：**0 → 155**  
   - domain_type multi-tag ratio ≈ **0.237**
2. **Aggregation：** `normalized_weighted_multitag`（对比 first-tag / uniform）
3. **`domain_none` action** + budget=**maximum**（非 must-fill）
4. **Contrastive loss：** Correct > Wrong / Swapped / Empty
5. Empty / 弱 evidence → NO-ACTION（0 candidates）
6. Shared / Stage P layers：**frozen**

---

## 4. Results vs D1

| Metric | D1 | D2 |
|--------|----|----|
| MultiTag Training Index | 0 | **155** |
| CrossDomain lock | 13/40 | **8/224** |
| Correct DomainActionHit | 0.3125 | **0.69** |
| Empty | 0.20 | **0.00**（NO-ACTION） |
| Wrong | 0.25 | 0.38 |
| Swapped | 0.30 | 0.35 |
| Correct−Swapped | 0.0125 | **0.34** |
| Empty candidates mean | ~7 | **0.0** |
| Wrong candidates mean | ~7 | **7.84**（仍高） |
| Budget always filled | YES | **NO** |
| NoAction | FAIL | **PASS** |
| Stage P regression | PASS | **PASS** |

---

## 5. Remaining Hardening（为何未 FROZEN）

1. **Wrong/Swapped** 一旦选中错误 domain，仍接近填满 candidate budget（选择性不足）。  
2. 数据仍为 **SYNTHETIC_USER_PROFILE** — 不可宣称真实用户 domain adaptation。  
3. Profile size≥5 时 top-domain concentration 仍偏高（~0.88）— 需继续观察 SINGLE_TERM_DOMINANCE。

---

## 6. Artifacts

目录：`training/model2_v3/experiments/v3_phase3_stage_d2/`

含 dataflow audit、source/index stats、cross-domain metrics、counterfactual margin、budget/no-action、scalability、unseen*、Stage P regression、`go_summary.json`。

---

## Final Verdict

```
Model2 V3 Stage D2 Verdict:
PASS_WITH_HARDENING_REQUIRED

Architecture:
ONE_MODEL2_SHARED_POLICY

Training Data:
SYNTHETIC

Domain SSOT:
PASS

MultiTag Source Data:
PASS

MultiTag Training Index:
PASS

MultiTag Terms:
155

MultiTag Ratio:
0.0156 (all records) / 0.237 among domain-type

CrossDomainTerms:
PASS

Previous Lock Failures:
13 / 40

Current Lock Failures:
8 / 224

Correct Profile DomainActionHit:
0.69

Empty:
0.00

Wrong:
0.38

Swapped:
0.35

CorrectMinusSwapped:
0.34

Previous CorrectMinusSwapped:
0.0125

DomainConditionalRecallGain:
0.69

FalseExpansion Correct:
7.92

FalseExpansion Empty:
0.00

FalseExpansion Wrong:
7.84

FalseExpansion Swapped:
7.92

Budget Always Filled:
NO

NoAction Capability:
PASS

Profile Size 5:
latency≈172ms, entropy≈0.32, top1≈0.90, cand≈8

Profile Size 20:
latency≈181ms, entropy≈0.43, top1≈0.88, cand≈8

Profile Size 100:
latency≈156ms, entropy≈0.43, top1≈0.88, cand≈8

Profile Size 500:
latency≈167ms, entropy≈0.43, top1≈0.88, cand≈8

UNSEEN_USER:
PASS (DomainActionHit≈0.64)

UNSEEN_TERM:
PASS (≈0.60)

UNSEEN_MULTITAG_TERM:
PASS (≈0.71)

UNSEEN_DOMAIN_COMBINATION:
PASS (post-hoc held-out MULTI/CONFLICTING)

Stage P Regression:
PASS

Separate Domain Model Created:
NO

Expected:
NO

Stage J:
NOT_READY

Recommended Next Phase:
MODEL2_V3_STAGE_D2b_WRONG_BUDGET_SELECTIVITY
或继续 hardening：Wrong/Swapped 的 low-action / partial-fill，
直到 Wrong candidate mean 明显低于 Correct，且 Stage D2 = FROZEN，
然后才进入 MODEL2_V3_STAGE_J。
```
