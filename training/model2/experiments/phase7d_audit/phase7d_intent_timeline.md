# Phase 7D — Intent Timeline

Markers: `PHASE7D_AUDIT` / `NOT_FOR_RUNTIME` / `NOT_FROZEN`

## PRIMARY PRODUCT CONTRACT (frozen for this audit)

Model2 must use UserProfile + observed ASR/span evidence to **introduce** lexical candidates that were absent from the original ASR/FuzzyPool set (profile-conditioned recall expansion).

Reranking a target already in pool is **not** fulfillment of this contract.

| Phase | Declared Model2 responsibility | Actual implemented responsibility | Evidence |
|-------|--------------------------------|-------------------------------------|----------|
| Initial (2026-08-11 Design) | “User-Conditioned Fuzzy Recall”; “扩大候选召回”; also “如何改变 candidate ranking” | Infrastructure only (UserProfile / CorrectionEvent); Model2 learning deferred | `docs/user_correction/Lingua_Model2_User_Correction_Design_and_Audit_Prompts_2026_08_11.md` §2–§4 (esp. lines 10–12, 117–178); Phase1 report: Model2 deferred |
| Architecture SSOT (2026-08-12) | Hybrid Fuzzy Retrieval: deterministic Fuzzy Pre-Pool expands lexicon; Model2 learned score **inside expanded pool**; rejected pure Exact-only rerank | Same split: expansion = FuzzyPool; Model2 = conditioned scorer on pre-pool | `Lingua_Model2_Final_Architecture_Input_Contract_PreTraining_Audit_2026_08_12.md` §13–§15 |
| Phase 5A–5F | FuzzyPool visibility / Stage A dual-encoder “Recall@K” on pool | FuzzyPool adds lexicon hits (**no** UserProfile); Stage A CE over pool+NO_MATCH; cannot emit new `term_id` | `training/model2/fuzzy/pool.py` (“UserProfile does NOT affect generation”); `model/model_v1.py` `forward`; Phase5A/5B reports FuzzyPool@16≈100% |
| Phase 6A–6B | User-conditioned Stage B; ConditionGain as gate | Profile affects `score_base+delta` ranking only; pool frozen across CF | Phase6A/6B reports; `evaluation/condition_ranking_metrics.py` |
| Phase 6C | Listwise counterfactual **profile binding** | Correct vs Empty/Wrong/Swapped ranking deltas | Phase6C Executive Summary; `listwise_binding_trainer.py` requires `target_in_pool` |
| Phase 7A | Baseline ~10k; Binding GO primary | Same closed-set Stage A/B; ConditionGain@3≈+0.246 | Phase7A acceptance report; stage_b term_positive `target_in_pool` = 10381/10381 |
| Phase 7B–7C | Attribution / causal probes for Stage A UNSEEN ranking failure | Still ranking/representation; no recall-expansion path | Phase7B/7C reports |

## Drift classification

**MIXED / AMBIGUOUS SSOT (early) + RECALL_STAGE_WAS_PLANNED_BUT_NEVER_IMPLEMENTED (for profile-conditioned open-set expansion)**

- Product language used “recall” / “扩大候选召回”.
- Architecture SSOT assigned **lexicon expansion to FuzzyPool** and **Model2 to ranking inside that pool**.
- UserProfile never entered pool generation.
- Phase 6+ gates measure **profile-conditioned reranking / binding**, not TargetIntroduction.

**Drift point (crystallization):** Architecture Hybrid decision **2026-08-12 §13**, reinforced as acceptance gate at **Phase 6**.

This is not a flip from a working profile-recall path to ranking; that path was never implemented.
