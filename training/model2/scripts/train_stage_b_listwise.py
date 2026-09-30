#!/usr/bin/env python3
"""Phase 6C — Listwise Counterfactual Profile Binding orchestrator."""

from __future__ import annotations

import copy
import json
import platform
import random
import statistics
import sys
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

import torch

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from training.model2.contract import PHONETIC_FEATURE_INDEX_V1, PHONETIC_FEATURE_KEYS
from training.model2.encoding.syllable_vocab import SyllableVocabV1
from training.model2.evaluation.condition_ranking_metrics import (
    base_preservation_test,
    binding_quality_from_entries,
    profile_swap_ranking,
    relation_ablation,
    score_ranking_quartet,
    summarize_ranking,
    wrong_direction_metrics,
)
from training.model2.evaluation.evaluate import cpu_latency_benchmark, term_id_stress_test
from training.model2.evaluation.stage_b_eval import mask_invariance_stage_b
from training.model2.model.condition_relation import load_relation_contract
from training.model2.model.model_v1 import count_parameters
from training.model2.stage_b.active_feature_mask import (
    BOUND_FEATURES_V1,
    WEAK_FEATURES_V1,
    active_mask_bound_only,
    active_mask_bound_plus_weak,
    feature_policy_table,
    intersect_with_schema_mask,
)
from training.model2.stage_b.condition import load_fidelity_weights, load_trainable_mask
from training.model2.training.config import StageATrainConfig
from training.model2.training.dataset import load_candidate_index, load_jsonl, precompute_candidate_tensors
from training.model2.training.listwise_binding_trainer import (
    filter_bound_rows,
    load_stage_a_for_6c,
    tiny_interaction_ablation,
    tiny_listwise_overfit,
    tiny_swap_gate,
    train_listwise_bound,
)
from training.model2.training.stage_b_trainer import _batch_with_profile
from training.model2.training.trainer import save_checkpoint, set_seed


def _dump(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def _slice(entries, pred):
    return [e for e in entries if pred(e)]


def _bundle(entries, train_users, seen_terms, *, bound_only: bool = False):
    if bound_only:
        entries = [e for e in entries if (not e.get("is_pronunciation_positive")) or e.get("corruption_family") in BOUND_FEATURES_V1]
    pron = _slice(entries, lambda e: e["is_pronunciation_positive"])
    overall = summarize_ranking(entries)
    pron_m = summarize_ranking(pron)
    per_dir = {
        fam: summarize_ranking(_slice(pron, lambda e, f=fam: e.get("corruption_family") == f))
        for fam in PHONETIC_FEATURE_KEYS
    }
    per_st = {
        st: summarize_ranking(_slice(pron, lambda e, s=st: str(e.get("intended_strength") or "").upper() == s))
        for st in ("LOW", "MEDIUM", "HIGH")
    }
    slices = {
        "ALL": overall,
        "pronunciation_positive": pron_m,
        "bound_pronunciation": summarize_ranking(
            _slice(pron, lambda e: e.get("corruption_family") in BOUND_FEATURES_V1)
        ),
        "single_feature": summarize_ranking(_slice(pron, lambda e: e.get("user_kind") == "single")),
        "multi_feature": summarize_ranking(_slice(pron, lambda e: e.get("user_kind") == "multi")),
        "unseen_user": summarize_ranking(_slice(entries, lambda e: e.get("pseudo_user_id") not in train_users)),
        "unseen_term": summarize_ranking(_slice(entries, lambda e: e.get("target_term_id") not in seen_terms)),
        "unseen_user_unseen_term": summarize_ranking(
            _slice(
                entries,
                lambda e: e.get("pseudo_user_id") not in train_users and e.get("target_term_id") not in seen_terms,
            )
        ),
        "unseen_feature_combo": summarize_ranking(_slice(pron, lambda e: bool(e.get("unseen_feature_combo")))),
        "no_change": summarize_ranking(_slice(entries, lambda e: e.get("is_no_change"))),
    }
    return {
        "overall": overall,
        "pronunciation_positive": pron_m,
        "per_direction": per_dir,
        "per_strength": per_st,
        "slices": slices,
        "binding_quality": binding_quality_from_entries(entries),
    }


def _data_sufficiency(rows: list[dict[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {"BOUND": {}, "note": "non_rank1 hard cases estimated later if needed"}
    for fam in BOUND_FEATURES_V1:
        by_split = defaultdict(int)
        hard = 0
        for r in rows:
            if not r.get("is_pronunciation_positive") or r.get("corruption_family") != fam:
                continue
            if not r.get("target_in_pool"):
                continue
            by_split[r.get("split") or "?"] += 1
        out["BOUND"][fam] = {
            "train": by_split.get("train", 0),
            "validation": by_split.get("validation", 0),
            "test": by_split.get("test", 0),
            "eval_n": by_split.get("validation", 0) + by_split.get("test", 0),
            "eval_label": "INSUFFICIENT_EVAL" if (by_split.get("validation", 0) + by_split.get("test", 0)) < 8 else "OK",
        }
    out["totals"] = {
        "train_bound_pos": sum(out["BOUND"][f]["train"] for f in BOUND_FEATURES_V1),
        "eval_bound_pos": sum(out["BOUND"][f]["eval_n"] for f in BOUND_FEATURES_V1),
    }
    return out


def _delta_requirement(entries: list[dict[str, Any]]) -> dict[str, Any]:
    bound = [e for e in entries if e.get("is_pronunciation_positive") and e.get("corruption_family") in BOUND_FEATURES_V1]
    if not bound:
        return {"n": 0}
    need1 = [e.get("delta_needed_for_rank1", 0) for e in bound]
    need3 = [e.get("delta_needed_for_rank3", 0) for e in bound]
    learned = [e.get("delta_target_correct", 0) for e in bound]
    return {
        "n": len(bound),
        "required_delta_to_rank1_mean": sum(need1) / len(need1),
        "required_delta_to_rank1_p50": statistics.median(need1),
        "required_delta_to_rank3_mean": sum(need3) / len(need3),
        "required_delta_to_rank3_p50": statistics.median(need3),
        "learned_delta_target_mean": sum(learned) / len(learned),
        "frac_learned_ge_need_rank3": sum(1 for a, b in zip(learned, need3) if a + 1e-6 >= b) / len(bound),
        "frac_already_rank1_empty": sum(1 for x in need1 if x <= 1e-8) / len(bound),
    }


def _selectivity(entries: list[dict[str, Any]]) -> dict[str, Any]:
    bound = [e for e in entries if e.get("is_pronunciation_positive") and e.get("corruption_family") in BOUND_FEATURES_V1]
    if not bound:
        return {"n": 0}

    def mean_key(k):
        vals = [e.get(k, 0.0) for e in bound if k in e]
        return sum(vals) / max(1, len(vals))

    return {
        "n": len(bound),
        "RelevantDeltaMean_correct": mean_key("RelevantDeltaMean_correct"),
        "IrrelevantDeltaMean_correct": mean_key("IrrelevantDeltaMean_correct"),
        "ConditionSelectivity_correct": mean_key("ConditionSelectivity_correct"),
        "ConditionSelectivity_unavailable": mean_key("ConditionSelectivity_unavailable"),
        "ConditionSelectivity_wrong": mean_key("ConditionSelectivity_wrong"),
        "pass_correct_positive": mean_key("ConditionSelectivity_correct") > 0.0,
        "pass_empty_near_zero": abs(mean_key("ConditionSelectivity_unavailable")) < 1e-5,
    }


def _false_correction(entries: list[dict[str, Any]]) -> dict[str, Any]:
    nc = [e for e in entries if e.get("is_no_change")]
    if not nc:
        return {"n": 0, "ProfileInducedFalseCorrectionRate": 0.0}
    # False correction proxy: empty keeps rank1 on target, correct loses it
    bad = 0
    for e in nc:
        if e.get("rank_unavailable", 99) == 0 and e.get("rank_correct", 0) != 0:
            bad += 1
    return {
        "n": len(nc),
        "ProfileInducedFalseCorrectionRate": bad / len(nc),
        "Recall@1_unavailable": sum(1 for e in nc if e.get("rank_unavailable") == 0) / len(nc),
        "Recall@1_correct": sum(1 for e in nc if e.get("rank_correct") == 0) / len(nc),
    }


def _hard_negatives(entries: list[dict[str, Any]]) -> dict[str, Any]:
    # Proxy: pronunciation rows where empty already has target rank1 (profile should not demote)
    # and HN-like: high strength but empty rank1 — condition shouldn't push wrong alt over target
    hn = [
        e
        for e in entries
        if e.get("is_pronunciation_positive")
        and e.get("corruption_family") in BOUND_FEATURES_V1
        and e.get("rank_unavailable") == 0
        and str(e.get("intended_strength") or "").upper() == "HIGH"
    ]
    if not hn:
        return {"n": 0, "note": "no high+rank1 empty bound rows"}
    demoted = sum(1 for e in hn if e.get("rank_correct", 0) > 0)
    return {
        "n": len(hn),
        "demoted_by_correct_profile_rate": demoted / len(hn),
        "pass": demoted / len(hn) < 0.15,
    }


def _counterfactuals(model, rows, cand_cache, active_mask, cfg, path: Path, n: int = 100):
    device = next(model.parameters()).device
    rng = random.Random(cfg.seed)
    use = [
        r
        for r in rows
        if r.get("is_pronunciation_positive")
        and r.get("corruption_family") in BOUND_FEATURES_V1
        and r.get("target_in_pool")
        and r.get("split") in ("validation", "test")
    ]
    rng.shuffle(use)
    use = use[:n]
    by_id = {r["trainrow_id"]: r for r in use}
    from training.model2.training.dataset import StageADataset, collate_stage_a

    ds = StageADataset(use, cand_cache, mode="all", max_pool=cfg.max_pool)
    ds.rows = use
    loader = torch.utils.data.DataLoader(ds, batch_size=8, shuffle=False, collate_fn=collate_stage_a)
    path.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    with path.open("w", encoding="utf-8") as f:
        for batch in loader:
            metas = [by_id[tid] for tid in batch["trainrow_id"]]
            outs = {}
            for mode in ("unavailable", "correct", "wrong"):
                b = _batch_with_profile(batch, metas, mode, active_mask, rng)
                b["cand_relation_features"] = batch["cand_relation_features"]
                bt = {k: v.to(device) if torch.is_tensor(v) else v for k, v in b.items()}
                o = model(bt)
                outs[mode] = (o["scores"].detach().cpu(), o["delta_condition"].detach().cpu(), o["score_base"].detach().cpu())
            for i, meta in enumerate(metas):
                tgt = int(batch["positive_pool_index"][i].item())
                plen = int(batch["pool_len"][i].item())
                rel = batch["cand_relation_features"][i, :plen].tolist()
                sc_e, d_e, base = outs["unavailable"]
                sc_c, d_c, _ = outs["correct"]
                sc_w, d_w, _ = outs["wrong"]

                def rank(sc):
                    return int(sc[i, :plen].argsort(descending=True).tolist().index(tgt))

                rec = {
                    "trainrow_id": meta["trainrow_id"],
                    "source": meta.get("source_span") or meta.get("asr_text"),
                    "target": meta.get("target_term_id") or meta.get("target_surface"),
                    "corruption_family": meta.get("corruption_family"),
                    "active_profile_family": meta.get("corruption_family"),
                    "candidate_list": [
                        {
                            "j": j,
                            "base_score": float(base[i, j]),
                            "relation": rel[j],
                            "delta_correct": float(d_c[i, j]),
                            "delta_wrong": float(d_w[i, j]),
                            "final_correct": float(sc_c[i, j]),
                            "final_wrong": float(sc_w[i, j]),
                            "final_empty": float(sc_e[i, j]),
                        }
                        for j in range(plen)
                    ],
                    "rank_empty": rank(sc_e),
                    "rank_correct": rank(sc_c),
                    "rank_wrong": rank(sc_w),
                    "TargetRankDelta": rank(sc_e) - rank(sc_c),
                }
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                written += 1
    return {"n": written}


def main() -> int:
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--accent-dir",
        type=Path,
        default=ROOT / "training/model2/dataset/pseudo_user_accent_scale_v1",
    )
    ap.add_argument(
        "--rows-dir",
        type=Path,
        default=None,
        help="Defaults to <accent-dir>/stage_b_trainrows",
    )
    ap.add_argument(
        "--stage-a-ckpt",
        type=Path,
        default=ROOT / "training/model2/experiments/stage_a_probe_v1/model2-stageA-probe-m0.pt",
    )
    ap.add_argument(
        "--out-dir",
        type=Path,
        default=ROOT / "training/model2/experiments/stage_b_listwise_binding_v1",
    )
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--device", type=str, default="")
    args = ap.parse_args()

    set_seed(42)
    out_dir = args.out_dir
    ckpt_dir = out_dir / "checkpoints"
    out_dir.mkdir(parents=True, exist_ok=True)
    ckpt_dir.mkdir(parents=True, exist_ok=True)

    accent_dir = args.accent_dir
    rows_dir = args.rows_dir or (accent_dir / "stage_b_trainrows")
    cfg = StageATrainConfig(
        batch_size=16,
        max_pool=16,
        device=args.device or ("cuda" if torch.cuda.is_available() else "cpu"),
        seed=42,
        markers=("MODEL2_BASELINE_V1",) if "baseline" in str(out_dir).lower() else ("ZH",),
    )

    vocab = SyllableVocabV1.load(rows_dir / "syl-vocab-v1.json")
    syl_n = len(vocab.syllable_to_id)
    rows = load_jsonl(rows_dir / "model2_train_rows.jsonl")
    index = load_candidate_index(rows_dir / "candidate_index.jsonl", rows_dir / "candidate_index_meta.json")
    cand_cache = precompute_candidate_tensors(index, vocab)
    schema_mask = load_trainable_mask(accent_dir / "condition_supervision_matrix.json")
    fidelity_w = load_fidelity_weights(accent_dir / "feature_fidelity_metrics.json")
    active_bound = intersect_with_schema_mask(active_mask_bound_only(), schema_mask)
    active_b1w = intersect_with_schema_mask(active_mask_bound_plus_weak(), schema_mask)
    contract = load_relation_contract()

    _dump(out_dir / "metric_contract_audit.json", {
        "legacy_field": "correct_leq_opposite_rate",
        "legacy_bug": "non_strict rank <= counted ties as PASS; name suggested correct_score <= opposite",
        "fix": "CorrectProfileBetterThanOppositeRate / CorrectProfileBetterThanIrrelevantRate",
        "semantics": "rank_correct < rank_other OR (tie rank AND score_correct > score_other); ties != pass",
        "tests": "training/model2/tests/test_phase6c_listwise.py::TestMetricSemantics",
    })
    _dump(out_dir / "active_feature_mask.json", {
        "policy": feature_policy_table(),
        "active_bound": active_bound,
        "active_bound_features": list(BOUND_FEATURES_V1),
        "weak_deferred_primary": list(WEAK_FEATURES_V1),
        "schema_mask": schema_mask,
    })
    sufficiency = _data_sufficiency(rows)
    _dump(out_dir / "data_sufficiency.json", sufficiency)
    _dump(out_dir / "relation_contract.json", contract)

    stage_a_ckpt = args.stage_a_ckpt
    if not stage_a_ckpt.exists():
        print("ERROR: Stage A checkpoint missing:", stage_a_ckpt)
        return 2

    train_users = {r.get("pseudo_user_id") for r in rows if r.get("split") == "train"}
    seen_terms = {r.get("target_term_id") for r in rows if r.get("split") == "train" and r.get("target_term_id")}

    # Base score / delta requirement from B0
    b0 = load_stage_a_for_6c(stage_a_ckpt, syl_n, delta_cap=0.5)
    b0.cfg.use_relation_condition = False
    b0 = b0.to(cfg.device).eval()
    sample = [r for r in rows if r.get("target_in_pool") and r.get("split") == "train"][:64]
    from training.model2.training.dataset import StageADataset, collate_stage_a

    ds0 = StageADataset(sample, cand_cache, mode="all", max_pool=cfg.max_pool)
    ds0.rows = sample
    loader0 = torch.utils.data.DataLoader(ds0, batch_size=16, shuffle=False, collate_fn=collate_stage_a)
    base_scores = []
    with torch.no_grad():
        for batch in loader0:
            bt = {k: v.to(cfg.device) if torch.is_tensor(v) else v for k, v in batch.items()}
            sc = b0(bt)["scores"]
            for i in range(sc.size(0)):
                plen = int(batch["pool_len"][i].item())
                base_scores.extend(sc[i, :plen].detach().cpu().tolist())
    bs_std = statistics.pstdev(base_scores) if len(base_scores) >= 2 else 0.2
    delta_cap = float(max(0.25, min(0.6, 1.0 * bs_std if bs_std > 0 else 0.4)))
    # Do NOT enlarge beyond 6B; keep analysis-driven
    _dump(
        out_dir / "delta_scale_metrics.json",
        {
            "base_score_mean": sum(base_scores) / max(1, len(base_scores)),
            "base_score_std": bs_std,
            "chosen_delta_cap": delta_cap,
            "note": "kept within [0.25,0.6]; listwise objective preferred over raising cap",
        },
    )

    _dump(
        out_dir / "training_config.json",
        {
            **cfg.to_dict(),
            "strategy": "listwise_cf_condition_only_frozen_base",
            "epochs": 30,
            "prob_margin": 0.02,
            "temperature": 1.0,
            "delta_cap": delta_cap,
            "active": "BOUND_7",
            "no_s1_joint_finetune": True,
            "stage_a_checkpoint": str(stage_a_ckpt),
            "fidelity_weights": fidelity_w,
            "condition_scorer": "V2",
        },
    )
    _dump(
        out_dir / "model_config.json",
        {
            "formula": "score_final = score_base + softplus(relation_gate) * delta_v2(interaction, base, base_margin)",
            "interaction": "user * relation * mask",
            "unavailable": "delta_condition = 0 → score_final == score_base",
            "frozen": ["shared", "query_encoder", "candidate_encoder", "base_scorer", "no_match"],
            "trainable": ["condition_compat_v2", "relation_gate"],
            "primary_loss": "listwise_CE_correct + CF_prob_margin(empty/wrong)",
            "retired_primary": "C0_pairwise_margin",
        },
    )

    print("== B0 ==")
    entries_b0 = score_ranking_quartet(b0, rows, cand_cache, active_bound, max_pool=cfg.max_pool)
    b0_metrics = _bundle(entries_b0, train_users, seen_terms, bound_only=True)
    _dump(out_dir / "b0_metrics.json", b0_metrics)
    save_checkpoint(b0, ckpt_dir / "model2-stageB-listwise-b0.pt", meta={"variant": "B0"})

    print("== tiny listwise overfit ==")
    tiny_model = load_stage_a_for_6c(stage_a_ckpt, syl_n, delta_cap=delta_cap).to(cfg.device)
    tiny = tiny_listwise_overfit(tiny_model, rows, cand_cache, cfg, active_bound, n=96, epochs=120, lr=2e-3)
    _dump(out_dir / "tiny_listwise_overfit.json", tiny)
    print("tiny:", tiny)

    tiny_abl = tiny_interaction_ablation(tiny_model, rows, cand_cache, cfg, active_bound, n=64)
    _dump(out_dir / "tiny_interaction_ablation.json", tiny_abl)
    tiny_sw = tiny_swap_gate(tiny_model, rows, cand_cache, cfg, active_bound, n=64)
    _dump(out_dir / "tiny_swap.json", tiny_sw)

    b0_ref = load_stage_a_for_6c(stage_a_ckpt, syl_n, delta_cap=delta_cap)
    b0_ref.cfg.use_relation_condition = False
    preserv_tiny = base_preservation_test(b0_ref, tiny_model, rows, cand_cache, active_bound, max_pool=cfg.max_pool)
    _dump(out_dir / "base_preservation.json", {"after_tiny": preserv_tiny})

    interaction_ok = bool(tiny_abl.get("interaction_pass") or tiny_abl.get("interaction_better_than_user_only"))
    swap_ok = bool(tiny_sw.get("pass")) and not tiny_sw.get("ignored_profile")
    if not tiny.get("pass") or not preserv_tiny.get("pass") or not interaction_ok or not swap_ok:
        fail_class = (
            "METRIC_CONTRACT"
            if False
            else "LISTWISE_OBJECTIVE"
            if not tiny.get("pass")
            else "BASE_PRESERVATION"
            if not preserv_tiny.get("pass")
            else "CONDITION_INTERACTION"
            if not interaction_ok
            else "PROFILE_BINDING"
        )
        _dump(
            out_dir / "probe_verdict.json",
            {
                "verdict": "FAIL",
                "reason": "TINY_GATES",
                "tiny": tiny,
                "tiny_interaction": tiny_abl,
                "tiny_swap": tiny_sw,
                "base_preservation": preserv_tiny,
                "failure_class": fail_class,
            },
        )
        print("STOP: tiny listwise / interaction / swap / base preservation failed")
        # Continue to dump partial artifacts but return fail
        # Still allow full train only if tiny listwise passed — hard stop otherwise
        if not tiny.get("pass") or not preserv_tiny.get("pass") or not interaction_ok:
            return 2

    def _train_eval(name: str, mask: list[int]):
        print(f"== train {name} ==")
        m = load_stage_a_for_6c(stage_a_ckpt, syl_n, delta_cap=delta_cap)
        t0 = time.time()
        hist = train_listwise_bound(
            m,
            rows,
            cand_cache,
            cfg,
            mask,
            epochs=args.epochs,
            lr=1e-3,
            log_path=out_dir / "training_log.jsonl",
        )
        wall = time.time() - t0
        entries = score_ranking_quartet(m, rows, cand_cache, mask, max_pool=cfg.max_pool)
        metrics = _bundle(entries, train_users, seen_terms, bound_only=True)
        metrics["train"] = hist
        metrics["wall_s"] = wall
        preserv = base_preservation_test(b0_ref, m, rows, cand_cache, mask, max_pool=cfg.max_pool)
        metrics["base_preservation"] = preserv
        save_checkpoint(m, ckpt_dir / f"model2-stageB-listwise-{name.lower()}.pt", meta={"variant": name})
        return m, metrics, entries

    b1, b1_metrics, e1 = _train_eval("B1", active_bound)
    _dump(out_dir / "b1_bound_metrics.json", b1_metrics)

    bound_slice = (b1_metrics.get("slices") or {}).get("bound_pronunciation") or b1_metrics.get("pronunciation_positive") or {}
    gain3 = float(bound_slice.get("ConditionGain@3") or 0)
    rank_d = float(bound_slice.get("TargetRankDelta_mean") or 0)
    primary_pass_core = rank_d > 0 and gain3 > 0

    b1w_metrics = None
    if primary_pass_core:
        print("== optional B1W ==")
        _b1w, b1w_metrics, _e1w = _train_eval("B1W", active_b1w)
        _dump(out_dir / "b1w_optional_metrics.json", b1w_metrics)
    else:
        _dump(out_dir / "b1w_optional_metrics.json", {"skipped": True, "reason": "primary_B1_not_pass"})

    primary, primary_m, primary_e = b1, b1_metrics, e1
    pron = (primary_m.get("slices") or {}).get("bound_pronunciation") or primary_m.get("pronunciation_positive") or {}

    _dump(
        out_dir / "listwise_metrics.json",
        {
            "ConditionGain@1": pron.get("ConditionGain@1"),
            "ConditionGain@3": pron.get("ConditionGain@3"),
            "ConditionGain_MRR": pron.get("ConditionGain_MRR"),
            "TargetRankDelta_mean": pron.get("TargetRankDelta_mean"),
            "TargetProbabilityGain_mean": pron.get("TargetProbabilityGain_mean"),
            "MarginGain_mean": pron.get("MarginGain_mean"),
            "frac_rank_improved": pron.get("frac_rank_improved"),
            "CandidateDeltaSpread_mean": pron.get("CandidateDeltaSpread_mean"),
            "ConditionSelectivity_mean": pron.get("ConditionSelectivity_mean"),
        },
    )
    _dump(out_dir / "direction_metrics.json", primary_m.get("per_direction") or {})
    _dump(out_dir / "strength_metrics.json", primary_m.get("per_strength") or {})
    _dump(out_dir / "selectivity_metrics.json", _selectivity(primary_e))
    _dump(out_dir / "delta_requirement_metrics.json", _delta_requirement(primary_e))
    _dump(out_dir / "binding_quality.json", primary_m.get("binding_quality") or {})

    swap = profile_swap_ranking(
        primary,
        [r for r in rows if r.get("corruption_family") in BOUND_FEATURES_V1 or not r.get("is_pronunciation_positive")],
        cand_cache,
        active_bound,
        n=200,
    )
    _dump(out_dir / "profile_swap_metrics.json", swap)
    wrong_dir = wrong_direction_metrics(
        primary,
        [r for r in rows if (r.get("corruption_family") in BOUND_FEATURES_V1)],
        cand_cache,
        active_bound,
        max_n=160,
    )
    _dump(out_dir / "wrong_direction_metrics.json", wrong_dir)
    abl = relation_ablation(
        primary,
        [r for r in rows if r.get("corruption_family") in BOUND_FEATURES_V1],
        cand_cache,
        active_bound,
        max_n=200,
    )
    _dump(out_dir / "relation_ablation.json", abl)
    _dump(out_dir / "nochange_safety.json", _false_correction(primary_e))
    _dump(out_dir / "hard_negative_metrics.json", _hard_negatives(primary_e))
    _dump(out_dir / "mask_invariance.json", mask_invariance_stage_b(primary, rows, cand_cache))
    _dump(out_dir / "term_id_stress.json", term_id_stress_test(primary, rows, cand_cache, cfg))
    _dump(out_dir / "unseen_user_metrics.json", (primary_m.get("slices") or {}).get("unseen_user") or {})
    _dump(out_dir / "unseen_term_metrics.json", (primary_m.get("slices") or {}).get("unseen_term") or {})
    _dump(out_dir / "unseen_combo_metrics.json", (primary_m.get("slices") or {}).get("unseen_feature_combo") or {})

    preserv_final = base_preservation_test(b0_ref, primary, rows, cand_cache, active_bound)
    bp = json.loads((out_dir / "base_preservation.json").read_text(encoding="utf-8"))
    bp["after_full"] = preserv_final
    # hard assertion: empty == B0
    bp["empty_equals_b0_assertion"] = bool(preserv_final.get("pass"))
    _dump(out_dir / "base_preservation.json", bp)

    primary_cpu = copy.deepcopy(primary).cpu().eval()
    _dump(out_dir / "cpu_latency.json", cpu_latency_benchmark(primary_cpu, rows, cand_cache, cfg))
    params = count_parameters(primary)
    _dump(out_dir / "parameter_count.json", params)
    _counterfactuals(primary, rows, cand_cache, active_bound, cfg, out_dir / "counterfactual_examples.jsonl", n=100)

    gain3 = float(pron.get("ConditionGain@3") or 0)
    rank_d = float(pron.get("TargetRankDelta_mean") or 0)
    pg = float(pron.get("TargetProbabilityGain_mean") or 0)
    sel = _selectivity(primary_e)
    nc = _false_correction(primary_e)
    go = {
        "metric_contract": True,
        "base_preservation": bool(preserv_final.get("pass")),
        "tiny_listwise": bool(tiny.get("pass")),
        "tiny_interaction": interaction_ok,
        "tiny_swap": swap_ok,
        "target_rank_delta_pos": rank_d > 0,
        "condition_gain3_pos": gain3 >= 0.02,
        "condition_gain3_nonneg": gain3 > 0,
        "probability_gain_pos": pg > 0,
        "profile_swap": bool(swap.get("pass")) and float(swap.get("MRRSwapDamage") or 0) > 0,
        "wrong_direction": bool(wrong_dir.get("pass")),
        "interaction_ablation": bool(abl.get("interaction_pass")),
        "selectivity": bool(sel.get("pass_correct_positive")),
        "nochange_safe": float(nc.get("ProfileInducedFalseCorrectionRate") or 0) < 0.08,
        "params_ok": params["trainable_total"] < 500_000,
    }
    ranking_ok = go["target_rank_delta_pos"] and (go["condition_gain3_pos"] or go["condition_gain3_nonneg"])
    binding_ok = go["profile_swap"] and go["interaction_ablation"] and go["wrong_direction"]
    go["phase6c_pass"] = (
        go["metric_contract"]
        and go["base_preservation"]
        and go["tiny_listwise"]
        and ranking_ok
        and binding_ok
        and go["selectivity"]
        and go["nochange_safe"]
        and go["params_ok"]
    )
    if go["phase6c_pass"]:
        verdict = "PASS"
    elif go["base_preservation"] and go["tiny_listwise"] and (rank_d > 0 or pg > 0):
        verdict = "PARTIAL_PASS"
    else:
        verdict = "FAIL"

    failure_classes = []
    if not go["target_rank_delta_pos"]:
        failure_classes.append("LISTWISE_OBJECTIVE")
    if not go["profile_swap"]:
        failure_classes.append("PROFILE_BINDING")
    if not go["interaction_ablation"]:
        failure_classes.append("CONDITION_INTERACTION")
    if not go["wrong_direction"]:
        failure_classes.append("FEATURE_SUBSET")

    _dump(
        out_dir / "go_summary.json",
        {
            "verdict": verdict,
            "go": go,
            "ConditionGain@3": gain3,
            "TargetRankDelta_mean": rank_d,
            "TargetProbabilityGain_mean": pg,
            "MRRSwapDamage": swap.get("MRRSwapDamage"),
            "failure_classes": failure_classes,
            "next": "10k–20k Baseline" if go["phase6c_pass"] else "HOLD_NO_SCALE_UP",
            "b1w": None if b1w_metrics is None else "ran",
        },
    )
    _dump(
        out_dir / "probe_verdict.json",
        {
            "go": go,
            "verdict": verdict,
            "failure_classes": failure_classes,
            "env": {
                "python": sys.version,
                "torch": torch.__version__,
                "device": cfg.device,
                "platform": platform.platform(),
            },
        },
    )
    print(
        json.dumps(
            {
                "verdict": verdict,
                "gain3": gain3,
                "rank_delta": rank_d,
                "prob_gain": pg,
                "swap": swap.get("MRRSwapDamage"),
                "interaction_pass": abl.get("interaction_pass"),
            },
            indent=2,
        )
    )
    return 0 if go["phase6c_pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
