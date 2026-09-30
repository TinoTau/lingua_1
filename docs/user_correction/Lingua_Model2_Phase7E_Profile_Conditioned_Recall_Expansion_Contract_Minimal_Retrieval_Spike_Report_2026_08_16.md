# Lingua Model2 Phase 7E — Profile-Conditioned Recall Expansion Contract & Minimal Retrieval Spike

| Field | Value |
|-------|-------|
| Date | 2026-08-16 |
| Nature | **CONTRACT + DETERMINISTIC RETRIEVAL SPIKE** (no neural training) |
| Markers | `PHASE7E_RECALL_SPIKE` / `NOT_FOR_RUNTIME` / `NOT_FROZEN` / `SPIKE_ONLY` |
| Artifacts | `training/model2/experiments/phase7e_recall_spike/` |
| Code | `training/model2/retrieval/` + `scripts/run_phase7e_recall_spike.py` |
| Prior | Phase 7D CLOSED-SET RANKER audit preserved |

---

## 1. Executive Summary

Deterministic **Profile Retrieval (R1)** 证明：在 target 不在 Base FuzzyPool 时，可用 UserProfile + observed syllables（tone-stripped lexicon query）从词库 **新引入** target。

| Slice | TargetIntroductionRate (Correct) |
|-------|----------------------------------|
| ARTIFICIAL_MISS (n=500) | **0.988** |
| NATURAL_BASE_MISS (n=500, query-applicable) | **1.000** |

Counterfactual：Correct **0.998** ≫ Empty **0.0** / Wrong **0.0** / Swapped **0.062**。

**Verdict: PASS** — `PROFILE_CONDITIONED_RECALL_CONCEPT = PROVEN`  
**Neural retrieval needed now: NO**

关键修复：CandidateIndex 音节无调；query 必须 strip tone，否则 Levenshtein 虚高导致几乎零召回。

---

## 2. Architecture

### CURRENT (7D)

```text
ASR → FuzzyPool → Closed-set Model2 ranker
```

### SPIKE (7E)

```text
ASR / FineSpan
       │
       ├── Base FuzzyPool (profile-agnostic)
       │
       └── UserProfile.phonetic_bias
               ↓
          reverse map observed Y → intended X
               ↓
          tone-strip → lexicon FuzzyPool query
               ↓
          New candidates (PROFILE_RETRIEVAL)
       │
       └──────────┐
                  ↓
              Merge/Dedup (term_id)
                  ↓
         Optional Stage B binding / Stage A reorder
```

**Profile Retrieval 是唯一负责 profile-conditioned candidate introduction 的组件。**

---

## 3. Responsibility Boundary (frozen)

| Component | Responsibility |
|-----------|----------------|
| Base FuzzyPool | Profile-agnostic phonetic base recall |
| Model2 Retrieval (new) | Profile-conditioned lexicon introduction |
| Stage B | Optional post-merge binding only |
| Stage A | Optional post-merge reorder only; **not** introduction |

---

## 4. Runtime-Observable Contract

Artifact: `phase7e_field_source_contract.json` → **PASS**

Allowed query inputs: ASR/span, observed syllables, UserProfile bias, lexicon metadata.  
Forbidden: canonical syllables, `target_term_id`, oracle corruption as forced query.

Tone digits: RUNTIME_OBSERVABLE；strip 后用于无调 index → LEXICON_METADATA 派生，非 oracle。

---

## 5. Relation Direction Contract

Artifact: `profile_relation_direction_audit.json` → **PASS**

SSOT: `phonetic_relation_direction_contract_v1.json`

```text
X_Y = intended/canonical X → observed Y
Retrieval reverse = apply OPPOSITE_DIRECTION[X_Y] (= Y_X) on observed
Example: n_l, observed la → apply l_n → na
```

---

## 6. Minimal Retrieval Spike (R1)

```text
active BOUND relations (strength>0, SPIKE_ONLY ACTIVE/INACTIVE)
→ hypothesize intended syllables
→ build_fuzzy_pool on CandidateIndex (full lexicon length buckets)
→ exclude base term_ids
→ top-K by retrieval cost (distance, strength priority, prior)
```

Budget (config):

```text
max_active_profile_relations_per_span = 2
max_generated_phonetic_queries = 8
max_new_candidates_per_query = 8
max_total_profile_candidates = 8
```

Strength: `SPIKE_ONLY` / `NOT_FINAL_STRENGTH_CONTRACT`.

---

## 7. Dataset

Tag: `PHASE7E_RECALL_SPIKE_DATASET`

| Slice | n | Definition |
|-------|---|------------|
| ARTIFICIAL_MISS | 500 | Trainrow FuzzyPool 含 target → strip；且 reverse query applicable |
| NATURAL_BASE_MISS | 500 | Observed（tone-strip）Base FuzzyPool 不含 target；query applicable |
| CONTROL_ALREADY_PRESENT | tracked | 不进 primary |

Data quality note: 大量 baseline 行 `observed≡canonical` → 无法做 reverse；已排除出 artificial primary。

LexiconCoverageRate (primary): **1.0**（构造要求）。

---

## 8. Primary Metrics

| Metric | Correct | Empty | Wrong | Swapped |
|--------|---------|-------|-------|---------|
| TargetIntroductionRate (CF mix n=500) | **0.998** | 0.0 | 0.0 | 0.062 |
| ProfileConditionalRecallGain | **+0.998** | | | |

| Metric | Value |
|--------|-------|
| Artificial-Miss TIR | 0.988 |
| Natural-Miss TIR | 1.000 |
| ProfileOnlyTargetRecovery | 1.000 (natural applicable) |
| NO_CHANGE expansion (empty/row bias) | 0.0375 |
| Forced HIGH BOUND on NO_CHANGE | see `no_change_safety.json` |
| new_candidates_p95 | ≤ 8 (budget) |
| latency P50 / P95 | ~see `latency_metrics.json` (~40–60ms class on this host) |

Complementarity (`base_profile_complementarity.json`): profile-only recovery dominates on natural applicable misses after tone-strip base rebuild.

---

## 9. Counterfactual / Safety

```text
Correct >> Empty
Correct >> Wrong
Correct > Swapped (Swapped residual ~6.2% accidental phonetic overlap)
NO_CHANGE false expansion bounded
```

---

## 10. Provenance & Merge

- Provenances: `BASE_FUZZY` | `PROFILE_RETRIEVAL` | `EXACT` | `OTHER` (proposal)
- Dedup: **term_id authoritative**; dual provenance list, no duplicate slots
- JobResult: **PROPOSAL_ONLY**（本轮未改跨服务契约）

---

## 11. Stage A / Stage B

| | Verdict |
|--|---------|
| Stage A | `KEEP_AS_OPTIONAL_POST_MERGE` — closed-set；不能删除已 merge 的 term_id；**不得**再当 Model2 主能力 |
| Stage B | `KEEP_AS_POST_RECALL_BINDING` — 需对 new slots 重算 CandidateRelation；未 retrain |

---

## 12. Failure Attribution (pre-fix residual)

Failure classes observed during debugging / remaining misses:  
`OBSERVED_EVIDENCE_TOO_DAMAGED`, `NO_PROFILE_RELATION_MATCH`, `BUDGET_PRUNED`, `QUERY_EXPANSION_MISSING`, …  
见 `failure_cases.jsonl`（Correct 失败导出）。

Root cause fixed mid-spike: **tone mismatch vs toneless index**（曾导致 TIR≈0）。

---

## 13. Caveats

1. Natural-Miss 高分依赖 **query-applicable** 过滤 + 多数 observed 为 family-synth / 可反向映射的发音残差；真实 ASR 噪声下 generalization 仍需 7F 验证。  
2. Strength 仅为 ACTIVE/INACTIVE spike policy。  
3. R1 非最终产品质量；未训练神经 retrieval。

---

## 14. Decision

符合 Strong GO：

```text
CorrectProfile TargetIntroductionRate >> Empty/Wrong/Swapped
ProfileOnlyTargetRecovery > 0
NO_CHANGE bounded
budget bounded
Natural Miss also effective (on applicable slice)
```

→ **`PROFILE_CONDITIONED_RECALL_CONCEPT = PROVEN`**

Next: **Phase 7F — Recall Expansion Dataset & Trainable Retrieval Design**  
（仍 HOLD Tone / Node / 50k；禁止退回 Stage A ranking 主线）

---

## Artifact Index

| Artifact | Path under `experiments/phase7e_recall_spike/` |
|----------|-----------------------------------------------|
| Field source | `phase7e_field_source_contract.json` |
| Relation direction | `profile_relation_direction_audit.json` |
| Lexicon capability | `lexicon_retrieval_capability_audit.json` |
| Dataset manifest | `phase7e_recall_spike_dataset_manifest.json` |
| Artificial / Natural metrics | `artificial_miss_metrics.json`, `natural_miss_metrics.json` |
| CF profiles | `correct_*/empty_*/wrong_*/swapped_profile_metrics.json` |
| Recovery / complementarity / safety | `profile_only_recovery.json`, `base_profile_complementarity.json`, `no_change_safety.json` |
| Provenance / merge | `candidate_provenance.json`, `merge_dedup_audit.json` |
| Stage A/B | `stage_a_post_merge_sanity.json`, `stage_b_post_recall_sanity.json` |
| Latency / failures / GO | `latency_metrics.json`, `failure_cases.jsonl`, `go_summary.json` |

---

## Final Verdict

```text
Phase 7E Verdict:
PASS

Base FuzzyPool:
KEEP

Profile-Conditioned Candidate Introduction:
PROVEN

Artificial-Miss TargetIntroductionRate:
0.988

Natural-Miss TargetIntroductionRate:
1.000

Correct Profile vs Empty:
0.998 vs 0.000 (gain +0.998)

Correct Profile vs Wrong:
0.998 vs 0.000

Correct Profile vs Swapped:
0.998 vs 0.062

ProfileOnlyTargetRecovery:
1.000 (natural query-applicable)

NO_CHANGE False Expansion:
0.0375 (row/empty bias slice)

Candidate Expansion Budget:
max_total_profile_candidates=8; new_candidates_p95≤8

Runtime-Observable Contract:
PASS

Relation Direction Contract:
PASS

Lexicon Coverage:
1.0 (primary denominator)

Stage A:
KEEP_AS_OPTIONAL_POST_MERGE

Stage B:
KEEP_AS_POST_RECALL_BINDING

Neural Retrieval Model Needed Now:
NO

Tone:
HOLD

Node:
HOLD

50k:
HOLD

Recommended Next Phase:
Phase 7F — Recall Expansion Dataset & Trainable Retrieval Design
```
