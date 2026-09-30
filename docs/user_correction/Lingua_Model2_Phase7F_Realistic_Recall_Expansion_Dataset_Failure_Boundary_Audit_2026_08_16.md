# Lingua Model2 Phase 7F — Realistic Recall Expansion Dataset & Failure Boundary Audit

| Field | Value |
|-------|-------|
| Date | 2026-08-16 |
| Nature | **FAILURE BOUNDARY AUDIT** (no neural training; no rule chasing) |
| Markers | `PHASE7F_AUDIT` / `NOT_FOR_RUNTIME` / `NOT_FROZEN` |
| Artifacts | `training/model2/experiments/phase7f_realistic_boundary/` |
| Code | `training/model2/retrieval/normalize.py`, `scripts/run_phase7f_realistic_boundary.py` |

---

## 1. Executive Summary

Phase 7E 机制在 **FAMILY_SYNTH / query-applicable** 上仍然成立；在 **REAL_ASR_OBSERVED**（整句 ASR→G2P 作 query）上 **TargetIntroductionRate ≈ 0**。

| Provenance | Correct TIR | n |
|------------|------------:|--:|
| FAMILY_SYNTH (primary) | **0.932** | 250 |
| REAL_ASR_OBSERVED (primary) | **0.000** | 250 |
| Mixed primary (do not use as vanity overall) | 0.466 | 500 |

**Outcome: `OBSERVABILITY_LIMIT`**  
**Verdict: PASS**（审计完成；概念在真实 ASR 残差下为 **PARTIAL**）  
**Trainable retrieval now: NO**

主瓶颈不是“需要大模型”，而是 **runtime-observable pronunciation evidence** 与 profile reverse-map 所需的 Y 残差不对齐。

---

## 2. Phase 7E Baseline

```text
Artificial-Miss TIR ≈ 0.988
Natural-Miss TIR ≈ 1.000 (query-applicable)
Correct ≫ Empty/Wrong/Swapped
```

Caveat 保留：高分来自可反向映射的干净残差。

---

## 3. Runtime Evidence Contract

允许：ASR text、ASR-derived syllables、FineSpan、UserProfile、lexicon metadata。  
禁止：canonical 作 query、`target_term_id`、oracle family 作强制 query。

Normalization SSOT：`training/model2/retrieval/normalize.py` → `pronunciation_normalization_contract.json`（tone strip / ü→v / NFKC / 统一函数）。

---

## 4. Realistic Dataset Construction

Tag: `PHASE7F_REALISTIC_RECALL_DATASET`

| Slice | n (capped) |
|-------|------------:|
| S1 single clean | 100 |
| S2 multi composition | 100 |
| S5 insertion | 100 |
| S6 alignment | 16 |
| S8 ambiguous | 45 |
| S9 multi-relation user | 100 |
| S10 weak | 100 |
| S11 natural base miss | 300 |
| S12 NO_CHANGE | 300 |
| S3/S4/S7 | 0（本批数据不足，已报告） |

Primary CF：**250 FAMILY_SYNTH + 250 REAL_ASR**（分列指标，禁止混成漂亮 overall）。

---

## 5. Leakage Audit

`phase7f_leakage_audit.json` → **PASS_WITH_NOTES**

- Retrieval 未喂 canonical / target_id。  
- Slice 标签可使用 family/canonical（metric-only）。  
- 大量 trainrow `observed≡canonical`（历史问题，已从 applicable synth 过滤）。

---

## 6–7. Deterministic Retrieval Results (by slice)

| Pattern | Supported? | TIR | Precision proxy | Notes |
|---------|------------|----:|----------------:|-------|
| single substitution (S1) | PARTIAL/YES* | 0.42 | 0.24 | *BOUND-only activator；非 BOUND profile 常 `QUERY_NOT_GENERATED` |
| double substitution (S2) | PARTIAL | **0.71** | 0.10 | 单 query reverse；组合未完整支持 |
| deletion (S4) | NO | n≈0 | — | 数据稀疏 |
| insertion (S5) | NO | 0.0 | 0.0 | |
| alignment (S6) | NO | 0.0 | 0.0 | |
| partial profile (S3) | — | n=0 | — | |
| non-profile (S7) | NO by design | n=0 | — | |

---

## 8. Counterfactual Profile Results

Mixed primary（仅作对照，非验收）：

| | TIR |
|--|----:|
| Correct | 0.466 |
| Empty | 0.000 |
| Wrong | 0.000 |
| Swapped | 0.040 |

Gain 来自 FAMILY_SYNTH 半区；REAL_ASR 半区 Correct≈Empty≈0。

---

## 9. Precision / Noise

- FAMILY_SYNTH `NewCandidatePrecision_proxy` ≈ **0.18**（K=8 时噪声高）  
- Budget curve：K=2 → precision ≈0.52，TIR≈0.87；K=8 → TIR↑ 至 0.92，precision↓  
- NO_CHANGE AnyProfileExpansion ≈ **0.023**（优于/接近 7E 0.0375）  
- Wrong/Swapped false expansion：见 `precision_noise_metrics.json`

---

## 10. Candidate & Query Budget Curves

- Candidate K∈{2,4,8}：recall 边际上升，precision 明显下降 → **勿盲目增大 K**  
- Query max∈{1,2,4,8}：TIR 在本批约 **持平 ~0.92**（synth 子样本曲线）；收益拐点靠前

---

## 11. Natural-Miss Performance

- Overall natural-miss TIR（混合）≈ **0.25**  
- PROFILE_ONLY_RECOVERY（S11 complementarity）≈ **0.25**  
- 拆分后：synth 高、real ASR **0**

---

## 12–14. Multi / Partial / Deletion-Insertion

- Multi (S2 FAMILY_SYNTH)：**TIR 0.71** — 机制部分覆盖双替换，但 precision 低、组合 query 不完整。  
- Partial / deletion：本批计数不足或 TIR≈0。  
- Insertion / alignment：TIR≈0 → deterministic reverse **不能**当万能修复。

---

## 15. NO_CHANGE Safety

AnyProfileExpansionRate ≈ **0.023**；FalseCandidateP95 见 `slice_no_change.json`。未因 recall 提升而失控。

---

## 16. Failure Taxonomy

主类（exported ≥200）：

1. `OBSERVED_EVIDENCE_TOO_DAMAGED`  
2. `QUERY_NOT_GENERATED`  
3. `OTHER`  
4. `CANDIDATE_BUDGET_PRUNED`  
5. `NO_PROFILE_RELATION_MATCH`  

REAL_ASR 路径上，整句 G2P 很少产生可被 BOUND reverse 命中的干净 Y 残差。

---

## 17. Deterministic Capability Boundary

```text
DETERMINISTIC_CAPABILITY_BOUNDARY:
Strong when observed contains profile-confused Y residue (family-synth / clean substitution).
Weak/None when ASR evidence is deletion, insertion, alignment shift, or residue not
invertible from UserProfile (typical whole-utterance ASR→G2P).
Must not claim non-profile ASR repair.
BOUND-only activation leaves WEAK/REVERSED profile keys unqueried (spike semantics).
```

---

## 18. Stage A/B Sanity

- Stage A: `KEEP_OPTIONAL`  
- Stage B: `KEEP_POST_RECALL`（new slots 需重算 CandidateRelation；未 retrain）

---

## 19. Runtime Cost

FAMILY_SYNTH 路径 P50≈47ms / P95≈110ms（本机 FuzzyPool 桶扫描）；REAL_ASR 因少 query 更低。无组合爆炸到不可用，但 K↑ 噪声↑。

---

## 20. Neural Retrieval Necessity Decision

```text
outcome = OBSERVABILITY_LIMIT
Trainable_Retrieval_Component_Needed = NO
```

原因：主要失败是 **信息/可观测残差**，不是 query ranking 模糊到必须上神经控制器。  
先做 span 级 ASR 证据、与 profile 对齐的发音观测；再考虑窄控制器。

---

## 21. Final Decision

| Decision | Value |
|----------|-------|
| Outcome | **OBSERVABILITY_LIMIT** |
| Concept under realistic ASR | **PARTIAL** |
| Next | **Phase 7G — Observability & Span Evidence Hardening** |
| Neural retrieval | **NO**（现在） |
| Tone / Node / 50k | **HOLD** |

---

## Final Verdict

```text
Phase 7F Verdict:
PASS

Profile Recall Concept Under Realistic Conditions:
PARTIAL

Natural Base Miss TargetIntroductionRate:
0.253 (mixed); FAMILY_SYNTH 0.932; REAL_ASR 0.000

ProfileOnlyTargetRecovery:
0.25 (S11 mixed complementarity)

Correct vs Empty:
0.466 vs 0.000 (mixed primary; synth-driven)

Correct vs Wrong:
0.466 vs 0.000

Correct vs Swapped:
0.466 vs 0.040

NO_CHANGE False Expansion:
0.023

NewCandidatePrecision:
~0.18 @K=8 (proxy); ~0.52 @K=2 on budget curve subsample

Candidate Budget:
K=2/4/8 TIR 0.865/0.895/0.920; precision falls as K grows

Query Budget:
max_queries 1–8 TIR≈0.92 on synth-heavy curve; little gain beyond 1–2

Primary Failure Classes:
1. OBSERVED_EVIDENCE_TOO_DAMAGED
2. QUERY_NOT_GENERATED
3. OTHER
4. CANDIDATE_BUDGET_PRUNED
5. NO_PROFILE_RELATION_MATCH

Deterministic Capability Boundary:
Works on invertible profile substitutions (FAMILY_SYNTH); fails on whole-utterance REAL_ASR G2P residue, deletion/insertion/alignment; BOUND-only activation gaps.

Main Remaining Bottleneck:
OBSERVABILITY

Trainable Retrieval Component Needed:
NO

If YES, Exact Intended Role:
N/A

Stage A:
KEEP_OPTIONAL

Stage B:
KEEP_POST_RECALL

Tone:
HOLD

Node:
HOLD

50k:
HOLD

Recommended Next Phase:
Phase 7G — Observability & Span Evidence Hardening (no neural retrieval yet)
```
