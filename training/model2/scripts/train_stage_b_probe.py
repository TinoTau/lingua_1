#!/usr/bin/env python3
"""Phase 6A — User-Conditioned Stage B Training Probe orchestrator."""

from __future__ import annotations

import copy
import json
import platform
import subprocess
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
from training.model2.evaluation.evaluate import (
    cpu_latency_benchmark,
    evaluate_nomatch_on_negatives,
    term_id_stress_test,
)
from training.model2.evaluation.stage_b_eval import (
    condition_ablation,
    mask_invariance_stage_b,
    opposite_direction_test,
    profile_swap_stress,
    profile_zeroing_vs_base,
    score_profile_quartet,
    slice_entries,
    strength_monotonicity_probe,
    summarize_quartet,
)
from training.model2.model.model_v1 import count_parameters
from training.model2.stage_b.condition import load_fidelity_weights, load_trainable_mask
from training.model2.training.config import StageATrainConfig
from training.model2.training.dataset import load_candidate_index, load_jsonl, precompute_candidate_tensors
from training.model2.training.stage_b_trainer import (
    load_stage_a_checkpoint,
    tiny_condition_overfit,
    train_stage_b,
)
from training.model2.training.trainer import save_checkpoint, set_seed


def _dump(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def _ensure_trainrows(accent_dir: Path, trainrow_dir: Path) -> None:
    if (trainrow_dir / "model2_train_rows.jsonl").exists():
        return
    cmd = [
        sys.executable,
        str(ROOT / "training/model2/scripts/build_stage_b_trainrows.py"),
        "--in-dir",
        str(accent_dir),
        "--out-dir",
        str(trainrow_dir),
    ]
    subprocess.check_call(cmd, cwd=str(ROOT))


def _eval_bundle(model, rows, cand_cache, cfg, trainable_mask, seen_terms, train_users) -> dict[str, Any]:
    # Prefer val+test for formal metrics
    eval_rows = [r for r in rows if r.get("split") in ("validation", "test")]
    entries = score_profile_quartet(
        model, eval_rows, cand_cache, trainable_mask=trainable_mask, max_pool=cfg.max_pool, seed=cfg.seed
    )
    pron = slice_entries(entries, lambda e: e["is_pronunciation_positive"])
    overall = summarize_quartet(entries)
    pron_m = summarize_quartet(pron)

    per_dir = {}
    for fam in PHONETIC_FEATURE_KEYS:
        sub = slice_entries(pron, lambda e, f=fam: e.get("corruption_family") == f)
        per_dir[fam] = summarize_quartet(sub)

    per_strength = {}
    for st in ("LOW", "MEDIUM", "HIGH"):
        sub = slice_entries(pron, lambda e, s=st: str(e.get("intended_strength") or "").upper() == s)
        per_strength[st] = summarize_quartet(sub)

    initial = {"n_l", "l_n", "zh_z", "z_zh", "ch_c", "c_ch", "sh_s", "s_sh", "f_h", "h_f"}
    final = {"an_ang", "ang_an", "en_eng", "eng_en", "in_ing", "ing_in"}
    slices = {
        "ALL": overall,
        "pronunciation_positive": pron_m,
        "single_feature": summarize_quartet(slice_entries(pron, lambda e: e.get("user_kind") == "single")),
        "multi_feature": summarize_quartet(slice_entries(pron, lambda e: e.get("user_kind") == "multi")),
        "seen_user": summarize_quartet(
            slice_entries(entries, lambda e: e.get("pseudo_user_id") in train_users)
        ),
        "unseen_user": summarize_quartet(
            slice_entries(entries, lambda e: e.get("pseudo_user_id") not in train_users)
        ),
        "seen_term": summarize_quartet(
            slice_entries(entries, lambda e: e.get("target_term_id") in seen_terms)
        ),
        "unseen_term": summarize_quartet(
            slice_entries(entries, lambda e: e.get("target_term_id") not in seen_terms)
        ),
        "unseen_user_unseen_term": summarize_quartet(
            slice_entries(
                entries,
                lambda e: e.get("pseudo_user_id") not in train_users
                and e.get("target_term_id") not in seen_terms,
            )
        ),
        "seen_feature_combo": summarize_quartet(
            slice_entries(pron, lambda e: not e.get("unseen_feature_combo"))
        ),
        "unseen_feature_combo": summarize_quartet(
            slice_entries(pron, lambda e: bool(e.get("unseen_feature_combo")))
        ),
        "initial_family": summarize_quartet(
            slice_entries(pron, lambda e: e.get("corruption_family") in initial)
        ),
        "final_family": summarize_quartet(
            slice_entries(pron, lambda e: e.get("corruption_family") in final)
        ),
        "backend_PHONEME": summarize_quartet(
            slice_entries(pron, lambda e: e.get("backend") == "PHONEME")
        ),
        "backend_CHINESE_SURFACE": summarize_quartet(
            slice_entries(pron, lambda e: e.get("backend") == "CHINESE_SURFACE")
        ),
        "no_change": summarize_quartet(slice_entries(entries, lambda e: e.get("is_no_change"))),
    }
    return {
        "overall": overall,
        "pronunciation_positive": pron_m,
        "per_direction": per_dir,
        "per_strength": per_strength,
        "slices": slices,
        "n_entries": len(entries),
        "n_pron": len(pron),
    }


def _counterfactuals(model, rows, cand_cache, trainable_mask, cfg, path: Path, n: int = 40) -> None:
    from training.model2.training.stage_b_trainer import _batch_with_profile
    from training.model2.training.dataset import StageADataset, collate_stage_a
    import random

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
                bt = {k: v.to(device) if torch.is_tensor(v) else v for k, v in b.items()}
                outs[mode] = model(bt)["scores"].cpu()
            for i, meta in enumerate(metas):
                plen = int(batch["pool_len"][i].item())
                tids = batch["fuzzy_pool_term_ids"][i]
                rec = {
                    "trainrow_id": meta["trainrow_id"],
                    "corruption_family": meta.get("corruption_family"),
                    "target_term_id": meta.get("target_term_id"),
                    "topk": {},
                }
                for mode, sc in outs.items():
                    order = sc[i, :plen].argsort(descending=True).tolist()[:4]
                    rec["topk"][mode] = [
                        {"term_id": tids[j] if j < len(tids) else None, "score": float(sc[i, j])}
                        for j in order
                    ]
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def main() -> int:
    accent_dir = ROOT / "training/model2/dataset/pseudo_user_accent_scale_v1"
    trainrow_dir = accent_dir / "stage_b_trainrows"
    out_dir = ROOT / "training/model2/experiments/stage_b_user_condition_probe_v1"
    out_dir.mkdir(parents=True, exist_ok=True)
    ckpt_dir = out_dir / "checkpoints"
    ckpt_dir.mkdir(parents=True, exist_ok=True)

    cfg = StageATrainConfig(seed=20260814, epochs=20, batch_size=16, lr=1e-3)
    cfg.markers = ("STAGE_B_PROBE_ONLY", "NOT_FOR_RUNTIME", "NOT_FROZEN")
    if torch.cuda.is_available():
        cfg.device = "cuda"
    set_seed(cfg.seed)

    print("== build trainrows ==")
    _ensure_trainrows(accent_dir, trainrow_dir)

    rows = load_jsonl(trainrow_dir / "model2_train_rows.jsonl")
    index = load_candidate_index(
        trainrow_dir / "candidate_index.jsonl",
        trainrow_dir / "candidate_index_meta.json",
    )
    vocab = SyllableVocabV1.load(trainrow_dir / "syl-vocab-v1.json")
    syl_vocab_n = len(vocab.syllable_to_id)
    cand_cache = precompute_candidate_tensors(index, vocab)
    trainable_mask = load_trainable_mask(accent_dir / "condition_supervision_matrix.json")
    fidelity_w = load_fidelity_weights(accent_dir / "feature_fidelity_metrics.json")

    train_users = {r.get("pseudo_user_id") for r in rows if r.get("split") == "train"}
    seen_terms = {
        r.get("target_term_id")
        for r in rows
        if r.get("split") == "train" and r.get("target_term_id")
    }

    stage_a_ckpt = ROOT / "training/model2/experiments/stage_a_probe_v1/model2-stageA-probe-m0.pt"
    stage_a_ok = stage_a_ckpt.exists()

    _dump(
        out_dir / "training_config.json",
        {
            **cfg.to_dict(),
            "epochs_s0": 8,
            "epochs_s1": 12,
            "lr_s0": 1e-3,
            "lr_s1": 2e-4,
            "lambda_cond": 0.5,
            "stage_a_checkpoint": str(stage_a_ckpt) if stage_a_ok else None,
            "stage_a_init": stage_a_ok,
            "equal_weight_variant": "B1",
            "fidelity_weight_variant": "B2",
            "phonetic_feature_index_v1": dict(PHONETIC_FEATURE_INDEX_V1),
            "fidelity_supervision_weights": fidelity_w,
            "trainable_phonetic_mask": trainable_mask,
            "tone_mask": "all_zero",
            "personal_domain_mask": "all_zero",
        },
    )
    _dump(
        out_dir / "model_config.json",
        {
            "architecture": "Model2StageAV1",
            "fusion": "condition_gate * einsum(condition, candidate) residual on scores",
            "use_condition_in_score": True,
            "note": "Same Stage A structure; Stage B trains previously masked condition path",
            "markers": list(cfg.markers),
        },
    )
    _dump(out_dir / "dataset_manifest.json", json.loads((trainrow_dir / "dataset_manifest.json").read_text(encoding="utf-8")))

    # ---- B0: frozen Stage A baseline (condition off) ----
    print("== B0 baseline ==")
    if stage_a_ok:
        b0 = load_stage_a_checkpoint(stage_a_ckpt, use_condition_in_score=False, syl_vocab=syl_vocab_n)
    else:
        from training.model2.model.model_v1 import Model2Config, Model2StageAV1

        b0 = Model2StageAV1(Model2Config(use_condition_in_score=False, syl_vocab=syl_vocab_n))
    b0 = b0.to(cfg.device)
    b0.eval()
    b0_metrics = _eval_bundle(b0, rows, cand_cache, cfg, trainable_mask, seen_terms, train_users)
    _dump(out_dir / "b0_metrics.json", b0_metrics)
    save_checkpoint(
        b0,
        ckpt_dir / "model2-stageB-probe-b0.pt",
        meta={"variant": "B0", "markers": list(cfg.markers)},
    )

    # ---- Tiny condition overfit gate ----
    print("== tiny condition overfit ==")
    tiny_model = load_stage_a_checkpoint(
        stage_a_ckpt, use_condition_in_score=True, syl_vocab=syl_vocab_n
    ) if stage_a_ok else copy.deepcopy(b0)
    if not stage_a_ok:
        tiny_model.cfg.use_condition_in_score = True
    tiny = tiny_condition_overfit(
        tiny_model, rows, cand_cache, cfg, trainable_mask, n=96, epochs=50, lr=2e-3, lambda_cond=1.0
    )
    _dump(out_dir / "tiny_condition_overfit.json", tiny)
    print("tiny:", tiny)
    if not tiny.get("pass"):
        _dump(
            out_dir / "probe_verdict.json",
            {
                "verdict": "FAIL",
                "reason": "TINY_CONDITION_OVERFIT",
                "failure_class": "CONDITION_ENCODING_OR_LOSS",
                "tiny": tiny,
            },
        )
        print("STOP: tiny condition overfit failed")
        return 2

    def _train_variant(name: str, equal_weight: bool) -> tuple[Any, dict]:
        print(f"== train {name} equal_weight={equal_weight} ==")
        m = load_stage_a_checkpoint(
            stage_a_ckpt, use_condition_in_score=True, syl_vocab=syl_vocab_n
        ) if stage_a_ok else copy.deepcopy(b0)
        if not stage_a_ok:
            m.cfg.use_condition_in_score = True
        # init gate slightly positive so condition path can move
        with torch.no_grad():
            m.condition_gate.fill_(0.1)
        t0 = time.time()
        hist = train_stage_b(
            m,
            rows,
            cand_cache,
            cfg,
            trainable_mask=trainable_mask,
            equal_weight=equal_weight,
            epochs_s0=8,
            epochs_s1=12,
            lr_s0=1e-3,
            lr_s1=2e-4,
            lambda_cond=0.5,
            log_path=out_dir / "training_log.jsonl",
        )
        wall = time.time() - t0
        metrics = _eval_bundle(m, rows, cand_cache, cfg, trainable_mask, seen_terms, train_users)
        metrics["train"] = hist
        metrics["wall_s"] = wall
        save_checkpoint(
            m,
            ckpt_dir / f"model2-stageB-probe-{name.lower()}.pt",
            meta={"variant": name, "equal_weight": equal_weight, "markers": list(cfg.markers)},
        )
        return m, metrics

    b1, b1_metrics = _train_variant("B1", equal_weight=True)
    _dump(out_dir / "b1_metrics.json", b1_metrics)
    b2, b2_metrics = _train_variant("B2", equal_weight=False)
    _dump(out_dir / "b2_metrics.json", b2_metrics)

    # Choose primary = better ConditionGain@3 on pronunciation slice
    g1 = (b1_metrics.get("pronunciation_positive") or {}).get("ConditionGain@3") or -1
    g2 = (b2_metrics.get("pronunciation_positive") or {}).get("ConditionGain@3") or -1
    primary_name, primary, primary_metrics = ("B2", b2, b2_metrics) if g2 >= g1 else ("B1", b1, b1_metrics)

    # Stress / ablation on primary
    print("== stress/ablation ==")
    _dump(out_dir / "per_direction_metrics.json", primary_metrics.get("per_direction") or {})
    _dump(out_dir / "per_strength_metrics.json", primary_metrics.get("per_strength") or {})
    _dump(
        out_dir / "unseen_user_metrics.json",
        (primary_metrics.get("slices") or {}).get("unseen_user") or {},
    )
    _dump(
        out_dir / "unseen_term_metrics.json",
        (primary_metrics.get("slices") or {}).get("unseen_term") or {},
    )
    _dump(
        out_dir / "unseen_combo_metrics.json",
        (primary_metrics.get("slices") or {}).get("unseen_feature_combo") or {},
    )
    _dump(
        out_dir / "profile_counterfactual_metrics.json",
        {
            "primary": primary_name,
            "correct_vs_empty": {
                "ConditionGain@1": (primary_metrics.get("pronunciation_positive") or {}).get("ConditionGain@1"),
                "ConditionGain@3": (primary_metrics.get("pronunciation_positive") or {}).get("ConditionGain@3"),
                "TargetScoreGain_mean": (primary_metrics.get("pronunciation_positive") or {}).get(
                    "TargetScoreGain_mean"
                ),
            },
            "correct_vs_wrong": {
                "Recall@3_correct": (primary_metrics.get("pronunciation_positive") or {}).get("Recall@3_correct"),
                "Recall@3_wrong": (primary_metrics.get("pronunciation_positive") or {}).get("Recall@3_wrong"),
            },
        },
    )
    _dump(
        out_dir / "wrong_profile_metrics.json",
        {
            "WrongProfileDamage@1": (primary_metrics.get("pronunciation_positive") or {}).get(
                "WrongProfileDamage@1"
            ),
            "WrongProfileDamage@3": (primary_metrics.get("pronunciation_positive") or {}).get(
                "WrongProfileDamage@3"
            ),
            "WrongProfileDamage_score_mean": (primary_metrics.get("pronunciation_positive") or {}).get(
                "WrongProfileDamage_score_mean"
            ),
        },
    )

    abl = condition_ablation(primary, rows, cand_cache, trainable_mask)
    _dump(out_dir / "condition_ablation.json", abl)
    _dump(out_dir / "mask_invariance.json", mask_invariance_stage_b(primary, rows, cand_cache))
    _dump(
        out_dir / "term_id_stress.json",
        term_id_stress_test(primary, rows, cand_cache, cfg),
    )
    _dump(
        out_dir / "profile_swap_stress.json",
        profile_swap_stress(primary, rows, cand_cache, trainable_mask),
    )
    _dump(
        out_dir / "profile_zeroing.json",
        profile_zeroing_vs_base(primary, b0, rows, cand_cache, trainable_mask),
    )
    _dump(
        out_dir / "opposite_direction.json",
        opposite_direction_test(primary, rows, cand_cache, trainable_mask),
    )
    _dump(
        out_dir / "strength_monotonicity.json",
        strength_monotonicity_probe(primary, rows, cand_cache, trainable_mask),
    )
    neg_fp = evaluate_nomatch_on_negatives(primary, rows, cand_cache, cfg)
    _dump(out_dir / "nomatch_negative_metrics.json", neg_fp)

    # CPU latency
    primary_cpu = copy.deepcopy(primary).cpu().eval()
    lat = cpu_latency_benchmark(primary_cpu, rows, cand_cache, cfg)
    _dump(out_dir / "cpu_latency.json", lat)
    params = count_parameters(primary)
    # condition-related
    cond_n = params["by_module"].get("condition_encoder", 0) + 1  # + gate
    _dump(
        out_dir / "parameter_count.json",
        {**params, "condition_related_params": cond_n, "hard_max": 2_000_000},
    )

    _counterfactuals(
        primary, rows, cand_cache, trainable_mask, cfg, out_dir / "counterfactual_examples.jsonl"
    )

    # GO criteria
    pron_m = primary_metrics.get("pronunciation_positive") or {}
    gain3 = float(pron_m.get("ConditionGain@3") or 0)
    gain_score = float(pron_m.get("TargetScoreGain_mean") or 0)
    wrong_dmg = float(pron_m.get("WrongProfileDamage@3") or 0)
    mask_ok = json.loads((out_dir / "mask_invariance.json").read_text(encoding="utf-8")).get("pass")
    swap = json.loads((out_dir / "profile_swap_stress.json").read_text(encoding="utf-8"))
    zero = json.loads((out_dir / "profile_zeroing.json").read_text(encoding="utf-8"))
    unseen_u = (primary_metrics.get("slices") or {}).get("unseen_user") or {}
    unseen_t = (primary_metrics.get("slices") or {}).get("unseen_term") or {}
    unseen_c = (primary_metrics.get("slices") or {}).get("unseen_feature_combo") or {}

    go = {
        "tiny_overfit": bool(tiny.get("pass")),
        "mask_invariance": bool(mask_ok),
        "condition_gain_score_pos": gain_score > 0.01,
        "condition_gain_recall3_pos": gain3 > 0.005,
        "wrong_not_better_than_correct": float(pron_m.get("Recall@3_wrong") or 0)
        <= float(pron_m.get("Recall@3_correct") or 0) + 0.02,
        "wrong_damage_not_catastrophic": wrong_dmg > -0.15,
        "profile_swap_interpretable": bool(swap.get("pass")) and not swap.get("ignored_profile"),
        "profile_zeroing_ok": bool(zero.get("pass")),
        "params_ok": params["trainable_total"] < 2_000_000,
        "unseen_user_not_random": float(unseen_u.get("MRR_correct") or 0) > 0.05,
        "unseen_term_not_random": float(unseen_t.get("MRR_correct") or 0) > 0.05,
        "primary_variant": primary_name,
    }
    go["stage_b_probe_pass"] = all(
        [
            go["tiny_overfit"],
            go["mask_invariance"],
            go["condition_gain_score_pos"] or go["condition_gain_recall3_pos"],
            go["wrong_not_better_than_correct"],
            go["wrong_damage_not_catastrophic"],
            go["params_ok"],
        ]
    )
    _dump(out_dir / "probe_verdict.json", {"go": go, "env": {
        "python": sys.version,
        "torch": torch.__version__,
        "cuda": torch.cuda.is_available(),
        "platform": platform.platform(),
        "device": cfg.device,
    }})
    _dump(
        out_dir / "go_summary.json",
        {
            "verdict": "PASS" if go["stage_b_probe_pass"] else "FAIL",
            "primary": primary_name,
            "ConditionGain@3": gain3,
            "TargetScoreGain_mean": gain_score,
            "go": go,
            "unseen_combo_ConditionGain@3": unseen_c.get("ConditionGain@3"),
            "markers": list(cfg.markers),
        },
    )
    print(json.dumps({"verdict": go["stage_b_probe_pass"], "primary": primary_name, "gain3": gain3, "gain_score": gain_score}, indent=2))
    return 0 if go["stage_b_probe_pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
