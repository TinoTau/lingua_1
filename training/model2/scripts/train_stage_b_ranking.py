#!/usr/bin/env python3
"""Phase 6B — Condition Ranking Calibration orchestrator."""

from __future__ import annotations

import copy
import json
import platform
import random
import sys
import time
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
from training.model2.model.model_v1 import Model2Config, Model2StageAV1, count_parameters
from training.model2.stage_b.condition import load_fidelity_weights, load_trainable_mask
from training.model2.training.condition_ranking_trainer import (
    freeze_base_path,
    load_stage_a_for_6b,
    tiny_ranking_overfit,
    train_condition_only,
)
from training.model2.training.config import StageATrainConfig
from training.model2.training.dataset import load_candidate_index, load_jsonl, precompute_candidate_tensors
from training.model2.training.stage_b_trainer import _batch_with_profile
from training.model2.training.trainer import save_checkpoint, set_seed


def _dump(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def _slice(entries, pred):
    return [e for e in entries if pred(e)]


def _bundle(entries, train_users, seen_terms):
    pron = _slice(entries, lambda e: e["is_pronunciation_positive"])
    overall = summarize_ranking(entries)
    pron_m = summarize_ranking(pron)
    per_dir = {fam: summarize_ranking(_slice(pron, lambda e, f=fam: e.get("corruption_family") == f)) for fam in PHONETIC_FEATURE_KEYS}
    per_st = {
        st: summarize_ranking(_slice(pron, lambda e, s=st: str(e.get("intended_strength") or "").upper() == s))
        for st in ("LOW", "MEDIUM", "HIGH")
    }
    slices = {
        "ALL": overall,
        "pronunciation_positive": pron_m,
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


def _counterfactuals(model, b0, rows, cand_cache, trainable_mask, cfg, path: Path, n: int = 80):
    device = next(model.parameters()).device
    rng = random.Random(cfg.seed)
    use = [
        r
        for r in rows
        if r.get("is_pronunciation_positive")
        and r.get("target_in_pool")
        and r.get("split") in ("validation", "test")
    ][:n]
    by_id = {r["trainrow_id"]: r for r in use}
    from training.model2.training.dataset import StageADataset, collate_stage_a

    ds = StageADataset(use, cand_cache, mode="all", max_pool=cfg.max_pool)
    ds.rows = use
    loader = torch.utils.data.DataLoader(ds, batch_size=8, shuffle=False, collate_fn=collate_stage_a)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for batch in loader:
            metas = [by_id[tid] for tid in batch["trainrow_id"]]
            outs = {}
            for mode in ("unavailable", "correct", "wrong"):
                b = _batch_with_profile(batch, metas, mode, trainable_mask, rng)
                b["cand_relation_features"] = batch["cand_relation_features"]
                bt = {k: v.to(device) if torch.is_tensor(v) else v for k, v in b.items()}
                o = model(bt)
                outs[mode] = (o["scores"].detach().cpu(), o["delta_condition"].detach().cpu())
            # B0
            b0b = _batch_with_profile(batch, metas, "unavailable", trainable_mask, rng)
            b0b["cand_relation_features"] = batch["cand_relation_features"]
            bt0 = {k: v.to(device) if torch.is_tensor(v) else v for k, v in b0b.items()}
            s0 = b0(bt0)["scores"].detach().cpu()
            for i, meta in enumerate(metas):
                plen = int(batch["pool_len"][i].item())
                tgt = int(batch["positive_pool_index"][i].item())
                tids = batch["fuzzy_pool_term_ids"][i]
                rec = {
                    "trainrow_id": meta["trainrow_id"],
                    "corruption_family": meta.get("corruption_family"),
                    "target_term_id": meta.get("target_term_id"),
                    "profiles": {},
                }
                for mode, (sc, delta) in outs.items():
                    order = sc[i, :plen].argsort(descending=True).tolist()
                    rank = order.index(tgt) if tgt in order else -1
                    others = [j for j in range(plen) if j != tgt]
                    best = max(others, key=lambda j: float(sc[i, j])) if others else tgt
                    rec["profiles"][mode] = {
                        "target_rank": rank,
                        "target_score": float(sc[i, tgt]),
                        "best_competitor": tids[best] if best < len(tids) else None,
                        "competitor_score": float(sc[i, best]),
                        "margin": float(sc[i, tgt] - sc[i, best]),
                        "topk": [
                            {"term_id": tids[j] if j < len(tids) else None, "score": float(sc[i, j]), "delta": float(delta[i, j])}
                            for j in order[:4]
                        ],
                        "delta_spread": float(delta[i, :plen].max() - delta[i, :plen].min()) if plen else 0.0,
                    }
                order0 = s0[i, :plen].argsort(descending=True).tolist()
                rec["profiles"]["B0"] = {
                    "target_rank": order0.index(tgt) if tgt in order0 else -1,
                    "target_score": float(s0[i, tgt]),
                    "topk": [{"term_id": tids[j] if j < len(tids) else None, "score": float(s0[i, j])} for j in order0[:4]],
                }
                # opposite direction single-feature
                fam = meta.get("corruption_family")
                if fam in PHONETIC_FEATURE_INDEX_V1:
                    b_opp = {k: (v.clone() if torch.is_tensor(v) else v) for k, v in batch.items()}
                    from training.model2.stage_b.condition import OPPOSITE_DIRECTION

                    opp = OPPOSITE_DIRECTION.get(fam, fam)
                    b_opp["phonetic_condition"][i].zero_()
                    b_opp["phonetic_mask"][i] = torch.tensor(trainable_mask, dtype=torch.long)
                    b_opp["phonetic_condition"][i, PHONETIC_FEATURE_INDEX_V1[opp]] = 0.8
                    b_opp["phonetic_profile_acoustically_realized"][i] = 1
                    b_opp["cand_relation_features"] = batch["cand_relation_features"]
                    # only one row meaningful; run full batch ok
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def main() -> int:
    accent_dir = ROOT / "training/model2/dataset/pseudo_user_accent_scale_v1"
    trainrow_dir = accent_dir / "stage_b_trainrows"
    out_dir = ROOT / "training/model2/experiments/stage_b_condition_ranking_v1"
    ckpt_dir = out_dir / "checkpoints"
    out_dir.mkdir(parents=True, exist_ok=True)
    ckpt_dir.mkdir(parents=True, exist_ok=True)

    cfg = StageATrainConfig(seed=20260814, batch_size=16, lr=1e-3)
    cfg.markers = ("STAGE_B_PROBE_ONLY", "NOT_FOR_RUNTIME", "NOT_FROZEN")
    if torch.cuda.is_available():
        cfg.device = "cuda"
    set_seed(cfg.seed)

    if not (trainrow_dir / "model2_train_rows.jsonl").exists():
        print("ERROR: stage_b_trainrows missing; run build_stage_b_trainrows.py first")
        return 2

    rows = load_jsonl(trainrow_dir / "model2_train_rows.jsonl")
    # ensure is_no_change flag
    for r in rows:
        if r.get("eligibility_class") == "ELIGIBLE_NO_CHANGE":
            r["is_no_change"] = True
    index = load_candidate_index(trainrow_dir / "candidate_index.jsonl", trainrow_dir / "candidate_index_meta.json")
    vocab = SyllableVocabV1.load(trainrow_dir / "syl-vocab-v1.json")
    syl_n = len(vocab.syllable_to_id)
    cand_cache = precompute_candidate_tensors(index, vocab)
    trainable_mask = load_trainable_mask(accent_dir / "condition_supervision_matrix.json")
    fidelity_w = load_fidelity_weights(accent_dir / "feature_fidelity_metrics.json")
    contract = load_relation_contract()
    _dump(out_dir / "relation_contract.json", contract)

    stage_a_ckpt = ROOT / "training/model2/experiments/stage_a_probe_v1/model2-stageA-probe-m0.pt"
    if not stage_a_ckpt.exists():
        print("ERROR: Stage A M0 checkpoint missing")
        return 2

    train_users = {r.get("pseudo_user_id") for r in rows if r.get("split") == "train"}
    seen_terms = {r.get("target_term_id") for r in rows if r.get("split") == "train" and r.get("target_term_id")}

    # Audit base score scale for delta_cap
    b0 = load_stage_a_for_6b(stage_a_ckpt, syl_n, delta_cap=0.35)
    b0.cfg.use_relation_condition = False
    b0 = b0.to(cfg.device).eval()
    # sample base margins
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
    import statistics

    if len(base_scores) >= 2:
        bs_std = statistics.pstdev(base_scores)
        bs_range = max(base_scores) - min(base_scores)
    else:
        bs_std, bs_range = 0.2, 1.0
    delta_cap = float(max(0.25, min(0.6, 1.0 * bs_std if bs_std > 0 else 0.4)))
    _dump(
        out_dir / "delta_scale_metrics.json",
        {
            "base_score_mean": sum(base_scores) / max(1, len(base_scores)),
            "base_score_std": bs_std,
            "base_score_range": bs_range,
            "chosen_delta_cap": delta_cap,
            "note": "delta_cap ≈ 1.0 * base_score_std, clipped to [0.25, 0.6]",
        },
    )

    _dump(
        out_dir / "training_config.json",
        {
            **cfg.to_dict(),
            "strategy": "condition_only_frozen_base",
            "epochs": 25,
            "lambda_rank_cond": 1.0,
            "lambda_wrong": 0.5,
            "lambda_nochange": 0.5,
            "delta_cap": delta_cap,
            "stage_a_checkpoint": str(stage_a_ckpt),
            "phonetic_feature_index_v1": dict(PHONETIC_FEATURE_INDEX_V1),
            "fidelity_weights": fidelity_w,
            "no_s1_joint_finetune": True,
        },
    )
    _dump(
        out_dir / "model_config.json",
        {
            "formula": "score_final = score_base + softplus(relation_gate) * tanh(mlp(user×relation, base)) * delta_cap",
            "unavailable": "delta_condition = 0 → score_final == score_base",
            "frozen": ["shared", "query_encoder", "candidate_encoder", "base_scorer", "no_match"],
            "trainable": ["condition_compat", "relation_gate"],
            "markers": list(cfg.markers),
        },
    )

    # ---- B0 metrics (relation off) ----
    print("== B0 ==")
    entries_b0 = score_ranking_quartet(b0, rows, cand_cache, trainable_mask, max_pool=cfg.max_pool)
    # Force unavailable==correct for B0 conceptually; still run
    b0_metrics = _bundle(entries_b0, train_users, seen_terms)
    _dump(out_dir / "b0_metrics.json", b0_metrics)
    save_checkpoint(b0, ckpt_dir / "model2-stageB-ranking-b0.pt", meta={"variant": "B0"})

    # ---- Tiny ranking overfit ----
    print("== tiny ranking overfit ==")
    tiny_model = load_stage_a_for_6b(stage_a_ckpt, syl_n, delta_cap=delta_cap).to(cfg.device)
    tiny = tiny_ranking_overfit(tiny_model, rows, cand_cache, cfg, trainable_mask, n=96, epochs=80, lr=2e-3)
    _dump(out_dir / "tiny_ranking_overfit.json", tiny)
    print("tiny:", tiny)

    # tiny swap
    swap_tiny = profile_swap_ranking(tiny_model, rows, cand_cache, trainable_mask, n=96)
    _dump(out_dir / "tiny_swap_test.json", swap_tiny)

    # base preservation after tiny
    b0_ref = load_stage_a_for_6b(stage_a_ckpt, syl_n, delta_cap=delta_cap)
    b0_ref.cfg.use_relation_condition = False
    preserv_tiny = base_preservation_test(b0_ref, tiny_model, rows, cand_cache, trainable_mask, max_pool=cfg.max_pool)
    _dump(out_dir / "base_preservation.json", {"after_tiny": preserv_tiny})

    if not tiny.get("pass") or not preserv_tiny.get("pass"):
        _dump(
            out_dir / "probe_verdict.json",
            {
                "verdict": "FAIL",
                "reason": "TINY_OR_BASE_PRESERVATION",
                "tiny": tiny,
                "base_preservation": preserv_tiny,
                "failure_class": "RANKING_LOSS" if not tiny.get("pass") else "BASE_PRESERVATION",
            },
        )
        print("STOP: tiny ranking or base preservation failed")
        return 2

    def _train(name: str, equal_weight: bool):
        print(f"== train {name} ==")
        m = load_stage_a_for_6b(stage_a_ckpt, syl_n, delta_cap=delta_cap)
        t0 = time.time()
        hist = train_condition_only(
            m,
            rows,
            cand_cache,
            cfg,
            trainable_mask,
            equal_weight=equal_weight,
            epochs=25,
            lr=1e-3,
            log_path=out_dir / "training_log.jsonl",
        )
        wall = time.time() - t0
        entries = score_ranking_quartet(m, rows, cand_cache, trainable_mask, max_pool=cfg.max_pool)
        metrics = _bundle(entries, train_users, seen_terms)
        metrics["train"] = hist
        metrics["wall_s"] = wall
        preserv = base_preservation_test(b0_ref, m, rows, cand_cache, trainable_mask, max_pool=cfg.max_pool)
        metrics["base_preservation"] = preserv
        save_checkpoint(
            m,
            ckpt_dir / f"model2-stageB-ranking-{name.lower()}.pt",
            meta={"variant": name, "equal_weight": equal_weight, "markers": list(cfg.markers)},
        )
        return m, metrics, entries

    b1, b1_metrics, e1 = _train("B1", True)
    _dump(out_dir / "b1_metrics.json", b1_metrics)
    b2, b2_metrics, e2 = _train("B2", False)
    _dump(out_dir / "b2_metrics.json", b2_metrics)

    g1 = (b1_metrics.get("pronunciation_positive") or {}).get("ConditionGain@3") or -1
    g2 = (b2_metrics.get("pronunciation_positive") or {}).get("ConditionGain@3") or -1
    primary, primary_m, primary_e, primary_name = (
        (b2, b2_metrics, e2, "B2") if g2 >= g1 else (b1, b1_metrics, e1, "B1")
    )

    pron = primary_m.get("pronunciation_positive") or {}
    _dump(
        out_dir / "ranking_gain_metrics.json",
        {
            "primary": primary_name,
            "ConditionGain@1": pron.get("ConditionGain@1"),
            "ConditionGain@3": pron.get("ConditionGain@3"),
            "ConditionGain_MRR": pron.get("ConditionGain_MRR"),
            "TargetRankDelta_mean": pron.get("TargetRankDelta_mean"),
            "frac_rank_improved": pron.get("frac_rank_improved"),
        },
    )
    _dump(
        out_dir / "margin_gain_metrics.json",
        {
            "MarginGain_mean": pron.get("MarginGain_mean"),
            "mean_margin_correct": pron.get("mean_margin_correct"),
            "mean_margin_unavailable": pron.get("mean_margin_unavailable"),
            "mean_delta_spread_correct": pron.get("mean_delta_spread_correct"),
            "mean_delta_spread_unavailable": pron.get("mean_delta_spread_unavailable"),
        },
    )
    _dump(out_dir / "per_direction_metrics.json", primary_m.get("per_direction") or {})
    _dump(out_dir / "per_strength_metrics.json", primary_m.get("per_strength") or {})
    _dump(out_dir / "binding_quality.json", primary_m.get("binding_quality") or {})
    _dump(out_dir / "unseen_user_metrics.json", (primary_m.get("slices") or {}).get("unseen_user") or {})
    _dump(out_dir / "unseen_term_metrics.json", (primary_m.get("slices") or {}).get("unseen_term") or {})
    _dump(out_dir / "unseen_combo_metrics.json", (primary_m.get("slices") or {}).get("unseen_feature_combo") or {})

    swap = profile_swap_ranking(primary, rows, cand_cache, trainable_mask)
    _dump(out_dir / "profile_swap_metrics.json", swap)
    wrong_dir = wrong_direction_metrics(primary, rows, cand_cache, trainable_mask)
    _dump(out_dir / "wrong_direction_metrics.json", wrong_dir)
    abl = relation_ablation(primary, rows, cand_cache, trainable_mask)
    _dump(out_dir / "relation_ablation.json", abl)
    _dump(out_dir / "condition_ablation.json", abl)  # alias
    _dump(out_dir / "mask_invariance.json", mask_invariance_stage_b(primary, rows, cand_cache))
    _dump(out_dir / "term_id_stress.json", term_id_stress_test(primary, rows, cand_cache, cfg))

    # NO_CHANGE / high bias stress
    nc = (primary_m.get("slices") or {}).get("no_change") or {}
    _dump(
        out_dir / "nochange_stress.json",
        {
            "Recall@1_unavailable": nc.get("Recall@1_unavailable"),
            "Recall@1_correct": nc.get("Recall@1_correct"),
            "WrongCorrectionDelta@1": (nc.get("Recall@1_correct") or 0) - (nc.get("Recall@1_unavailable") or 0),
            "n": nc.get("n"),
        },
    )
    high = summarize_ranking(_slice(primary_e, lambda e: e.get("is_pronunciation_positive") and str(e.get("intended_strength")).upper() == "HIGH"))
    _dump(out_dir / "high_bias_stress.json", high)

    preserv_final = base_preservation_test(b0_ref, primary, rows, cand_cache, trainable_mask)
    bp = json.loads((out_dir / "base_preservation.json").read_text(encoding="utf-8"))
    bp["after_full"] = preserv_final
    _dump(out_dir / "base_preservation.json", bp)

    primary_cpu = copy.deepcopy(primary).cpu().eval()
    _dump(out_dir / "cpu_latency.json", cpu_latency_benchmark(primary_cpu, rows, cand_cache, cfg))
    params = count_parameters(primary)
    cond_n = params["by_module"].get("condition_compat", 0) + 1
    _dump(out_dir / "parameter_count.json", {**params, "condition_related_params": cond_n})

    _counterfactuals(primary, b0_ref.to(cfg.device), rows, cand_cache, trainable_mask, cfg, out_dir / "counterfactual_examples.jsonl")

    # GO
    gain3 = float(pron.get("ConditionGain@3") or 0)
    rank_d = float(pron.get("TargetRankDelta_mean") or 0)
    mg = float(pron.get("MarginGain_mean") or 0)
    go = {
        "base_preservation": bool(preserv_final.get("pass")),
        "tiny_ranking": bool(tiny.get("pass")),
        "condition_gain_recall3": gain3 >= 0.02,
        "rank_delta_pos": rank_d > 0.05,
        "margin_gain_pos": mg > 0.01,
        "profile_swap": bool(swap.get("pass")) and not swap.get("ignored_profile"),
        "wrong_direction": bool(wrong_dir.get("pass")),
        "interaction_ablation": bool(abl.get("interaction_better_than_user_only")),
        "params_ok": params["trainable_total"] < 500_000,
        "primary": primary_name,
    }
    ranking_ok = go["margin_gain_pos"] and (go["condition_gain_recall3"] or go["rank_delta_pos"])
    go["stage_b_ranking_pass"] = (
        go["base_preservation"]
        and go["tiny_ranking"]
        and ranking_ok
        and go["profile_swap"]
        and go["params_ok"]
    )
    verdict = "PASS" if go["stage_b_ranking_pass"] else "PARTIAL_PASS" if (go["base_preservation"] and go["tiny_ranking"] and go["margin_gain_pos"]) else "FAIL"
    _dump(
        out_dir / "go_summary.json",
        {
            "verdict": verdict,
            "go": go,
            "ConditionGain@3": gain3,
            "TargetRankDelta_mean": rank_d,
            "MarginGain_mean": mg,
            "SwapDamage@3": swap.get("SwapDamage@3"),
            "MRRSwapDamage": swap.get("MRRSwapDamage"),
            "markers": list(cfg.markers),
            "next": "10k–20k Baseline" if go["stage_b_ranking_pass"] else "CONDITION_CALIBRATION_CONTINUE",
        },
    )
    _dump(out_dir / "probe_verdict.json", {"go": go, "verdict": verdict, "env": {
        "python": sys.version, "torch": torch.__version__, "device": cfg.device, "platform": platform.platform()
    }})
    print(json.dumps({"verdict": verdict, "primary": primary_name, "gain3": gain3, "rank_delta": rank_d, "margin_gain": mg, "swap": swap.get("MRRSwapDamage")}, indent=2))
    return 0 if go["stage_b_ranking_pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
