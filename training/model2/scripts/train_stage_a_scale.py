#!/usr/bin/env python
"""Stage A scale training (frozen M0/M1). TRAINING_SCALE_PROBE only."""

from __future__ import annotations

import json
import platform
import sys
from pathlib import Path

import numpy as np
import torch

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from training.model2.encoding.syllable_vocab import SyllableVocabV1
from training.model2.evaluation.baselines import (
    evaluate_fuzzy_distance_baseline,
    evaluate_fuzzy_prior_baseline,
    exact_recall_visibility,
)
from training.model2.evaluation.evaluate import (
    cpu_latency_benchmark,
    evaluate_hn_fp,
    evaluate_model_on_rows,
    evaluate_nomatch_fp,
    evaluate_nomatch_on_negatives,
    mask_invariance_test,
    term_id_stress_test,
    wrong_profile_stress,
)
from training.model2.evaluation.slices import build_seen_term_set, slice_rows
from training.model2.model.model_v1 import count_parameters
from training.model2.scripts.train_stage_a_probe import export_candidate_embed
from training.model2.training.config import StageATrainConfig
from training.model2.training.dataset import (
    enrich_trainrows,
    load_candidate_index,
    load_jsonl,
    precompute_candidate_tensors,
)
from training.model2.training.trainer import (
    build_model,
    save_checkpoint,
    set_seed,
    tiny_overfit_test,
    train_one,
)


def _dump(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def _eval_pack(model, rows, cand_cache, cfg):
    seen = build_seen_term_set(rows)
    all_term = slice_rows(rows)
    amb = slice_rows(rows, ambiguous=True)
    non = slice_rows(rows, ambiguous=False)
    unseen = slice_rows(rows, seen_terms=seen, unseen=True)
    unseen_amb = slice_rows(rows, seen_terms=seen, unseen=True, ambiguous=True)
    seen_amb = slice_rows(rows, seen_terms=seen, unseen=False, ambiguous=True)
    return {
        "all_term_positive": evaluate_model_on_rows(model, all_term, cand_cache, cfg),
        "train": evaluate_model_on_rows(model, slice_rows(rows, split="train"), cand_cache, cfg),
        "validation": evaluate_model_on_rows(model, slice_rows(rows, split="validation"), cand_cache, cfg),
        "test": evaluate_model_on_rows(model, slice_rows(rows, split="test"), cand_cache, cfg),
        "AMBIGUOUS_POSITIVE": evaluate_model_on_rows(model, amb, cand_cache, cfg),
        "NON_AMBIGUOUS_POSITIVE": evaluate_model_on_rows(model, non, cand_cache, cfg),
        "UNSEEN_TERM": evaluate_model_on_rows(model, unseen, cand_cache, cfg),
        "UNSEEN_TERM_AMBIGUOUS": evaluate_model_on_rows(model, unseen_amb, cand_cache, cfg),
        "SEEN_TERM_AMBIGUOUS": evaluate_model_on_rows(model, seen_amb, cand_cache, cfg),
        "nomatch_fp": evaluate_nomatch_fp(model, rows, cand_cache, cfg),
        "nomatch_n1": evaluate_nomatch_on_negatives(model, rows, cand_cache, cfg, negative_type="N1"),
        "nomatch_n2": evaluate_nomatch_on_negatives(model, rows, cand_cache, cfg, negative_type="N2"),
        "hn_fp_injected": evaluate_hn_fp(model, rows, cand_cache, cfg, native=False),
        "hn_fp_native": evaluate_hn_fp(model, rows, cand_cache, cfg, native=True),
        "mask_invariance": mask_invariance_test(model, rows, cand_cache, cfg),
        "term_id_stress": term_id_stress_test(model, rows, cand_cache, cfg),
        "wrong_profile_stress": wrong_profile_stress(model, rows, cand_cache, cfg),
        "cpu_latency": cpu_latency_benchmark(model, rows, cand_cache, cfg),
    }


def main() -> int:
    data_dir = ROOT / "training/model2/dataset/training_scale_v1"
    gate_path = data_dir / "dataset_gate.json"
    if not gate_path.exists():
        print("missing dataset_gate.json — run dataset_gate_scale.py first")
        return 2
    gate = json.loads(gate_path.read_text(encoding="utf-8"))
    if gate.get("verdict") != "PASS":
        print("DATASET GATE FAIL — not training")
        return 2

    out_dir = ROOT / "training/model2/experiments/stage_a_scale_v1"
    out_dir.mkdir(parents=True, exist_ok=True)
    cfg = StageATrainConfig(
        batch_size=32,
        epochs=20,
        lr=1e-3,
        tiny_n=64,
        tiny_epochs=60,
        markers=("TRAINING_SCALE_PROBE", "NOT_FOR_RUNTIME", "NOT_FROZEN"),
        note="Stage A scale probe — frozen M0/M1 architecture.",
    )
    if torch.cuda.is_available():
        cfg.device = "cuda"
    set_seed(cfg.seed)

    raw_rows = load_jsonl(data_dir / "model2_train_rows.jsonl")
    samples = {s["sample_id"]: s for s in load_jsonl(data_dir / "training_samples.jsonl")}
    index = load_candidate_index(data_dir / "candidate_index.jsonl", data_dir / "candidate_index_meta.json")
    vocab = SyllableVocabV1.load(data_dir / "syl-vocab-v1.json")
    rows = enrich_trainrows(raw_rows, samples, index, vocab)
    cand_cache = precompute_candidate_tensors(index, vocab)

    _dump(
        out_dir / "training_config.json",
        {
            **cfg.to_dict(),
            "env": {
                "python": sys.version,
                "torch": torch.__version__,
                "cuda": torch.cuda.is_available(),
                "train_device": cfg.device,
                "runtime_device_target": "cpu",
                "platform": platform.platform(),
            },
        },
    )

    print("=== Tiny Overfit ===", flush=True)
    _, tiny = tiny_overfit_test(rows, cand_cache, cfg, vocab.to_dict()["size"])
    _dump(out_dir / "tiny_overfit_metrics.json", tiny)
    if not tiny.get("ok"):
        _dump(out_dir / "probe_verdict.json", {"verdict": "FAIL", "reason": "tiny_overfit"})
        return 1

    log_path = out_dir / "training_log.jsonl"
    if log_path.exists():
        log_path.unlink()
    results = {"tiny": tiny}
    for variant in ("M0", "M1"):
        print(f"=== Train {variant} ===", flush=True)
        set_seed(cfg.seed)
        model = build_model(cfg, variant, vocab.to_dict()["size"])
        params = count_parameters(model)
        if params["trainable_total"] > 2_000_000:
            return 1
        stats = train_one(model, rows, cand_cache, cfg, log_path=log_path)
        if not stats.get("ok"):
            return 1
        pack = _eval_pack(model, rows, cand_cache, cfg)
        pack["variant"] = variant
        pack["params"] = params
        pack["train_stats"] = {
            "final_train_loss": stats["final_train_loss"],
            "final_val_loss": stats["final_val_loss"],
            "curve_tail": stats["history"][-5:],
        }
        pack["markers"] = list(cfg.markers)
        _dump(out_dir / f"{variant.lower()}_metrics.json", pack)
        save_checkpoint(
            model,
            out_dir / f"model2-stageA-scale-{variant.lower()}.pt",
            {"variant": variant, "params": params, "markers": list(cfg.markers)},
        )
        if variant == "M0":
            export_candidate_embed(
                model,
                cand_cache,
                out_dir / "candidate_embed_scale.npz",
                {
                    "model_checkpoint": "model2-stageA-scale-m0.pt",
                    "embedding_dim": cfg.embed_dim,
                    "lexicon_snapshot": index.lexicon_snapshot_id,
                    "markers": list(cfg.markers),
                    "note": "Offline CandidateEncoder cache — NOT vocabulary SSOT",
                },
            )
            _dump(out_dir / "mask_invariance.json", pack["mask_invariance"])
            _dump(out_dir / "term_id_stress.json", pack["term_id_stress"])
            _dump(out_dir / "cpu_latency.json", pack["cpu_latency"])
        results[variant] = pack

    all_term = slice_rows(rows)
    amb = slice_rows(rows, ambiguous=True)
    unseen_amb = slice_rows(rows, seen_terms=build_seen_term_set(rows), unseen=True, ambiguous=True)
    surfaces = set(index.by_surface.keys())
    baselines = {
        "B_exact": exact_recall_visibility(all_term, surfaces),
        "B_pool_distance": evaluate_fuzzy_distance_baseline(all_term),
        "B_pool_distance_ambiguous": evaluate_fuzzy_distance_baseline(amb),
        "B_pool_distance_unseen_ambiguous": evaluate_fuzzy_distance_baseline(unseen_amb),
        "B_pool_prior": evaluate_fuzzy_prior_baseline(all_term),
        "B_pool_prior_ambiguous": evaluate_fuzzy_prior_baseline(amb),
    }
    _dump(out_dir / "baseline_metrics.json", baselines)
    _dump(
        out_dir / "slice_metrics.json",
        {
            "M0_ambiguous": results["M0"]["AMBIGUOUS_POSITIVE"],
            "M0_unseen_ambiguous": results["M0"]["UNSEEN_TERM_AMBIGUOUS"],
            "M0_unseen": results["M0"]["UNSEEN_TERM"],
            "M0_non_ambiguous": results["M0"]["NON_AMBIGUOUS_POSITIVE"],
            "M1_ambiguous": results["M1"]["AMBIGUOUS_POSITIVE"],
        },
    )

    m0_amb = results["M0"]["AMBIGUOUS_POSITIVE"].get("Recall@1", 0)
    b_amb = baselines["B_pool_distance_ambiguous"].get("Recall@1", 1)
    m0_unseen = results["M0"]["UNSEEN_TERM"].get("Recall@1", 0)
    avg_pool = results["M0"]["all_term_positive"].get("Positive_average_pool_size", 16) or 16
    random_r1 = 1.0 / avg_pool
    gates = {
        "tiny": results["tiny"]["gate"],
        "mask": results["M0"]["mask_invariance"]["gate"],
        "term_id": results["M0"]["term_id_stress"]["gate"],
        "params_ok": results["M0"]["params"]["trainable_total"] < 2_000_000,
        "unseen_beats_random": m0_unseen > random_r1 * 1.5,
        "m0_vs_distance_ambiguous": {"m0": m0_amb, "baseline": b_amb, "delta": m0_amb - b_amb},
    }
    hard = (
        gates["tiny"] != "PASS"
        or gates["mask"] != "PASS"
        or gates["term_id"] != "PASS"
        or not gates["params_ok"]
        or not gates["unseen_beats_random"]
    )
    verdict = "FAIL" if hard else "PASS"
    # Value note: ambiguous win is reported, not a hard fail by itself
    _dump(
        out_dir / "probe_verdict.json",
        {
            "verdict": verdict,
            "gates": gates,
            "markers": list(cfg.markers),
            "note": "PASS allows 10k-20k Baseline Dataset only if ambiguous comparison is interpretable.",
        },
    )
    print("VERDICT", verdict, gates, flush=True)
    return 0 if verdict == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
