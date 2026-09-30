# -*- coding: utf-8 -*-
"""Eval-only: load Full100K Strict Integration seeds and select freeze checkpoint.

NO retraining. Read-only evaluation for MODEL3_SYNTHETIC_V1 freeze.
"""
from __future__ import annotations

import json
from pathlib import Path

import torch

from training.model3_dataset.train import train_full100k_strict_integration as integ
from training.model3_dataset.train.bigru_v1 import FEAT_DIM, Model3BiGRUV1
from training.model3_dataset.train.config_loader import load_training_config


def selection_score(r: dict) -> float:
    # Reject weak Anchor causality even if Precision is high.
    if r["strict_pair"] < 0.80 or r["strict_zero"] > 0.05:
        return -1e9
    return (
        0.25 * r["f1"]
        + 0.20 * r["precision"]
        + 0.15 * r["recall"]
        + 0.25 * r["strict_pair"]
        + 0.10 * max(0.0, r["strict_pair"] - r["strict_shuffle"])
        + 0.05 * r["heldout_family_f1"]
    )


def main() -> None:
    cfg = load_training_config()
    device = torch.device("cpu")
    full_root = integ.repo_path(cfg["datasets"]["full100k_root"])
    strict_root = integ.repo_path(cfg["datasets"]["strict_root"])
    hard_root = integ.repo_path(cfg["datasets"]["hard_keep_root"])
    ckpt_root = integ.repo_path(cfg["paths"]["checkpoint_root"])

    print("loading data…", flush=True)
    hard_keep_map = integ.load_hard_keep(hard_root)
    strict_sc = integ.load_sidecar(strict_root)
    strict_test = integ.load_split(strict_root, "test")
    full_test = integ.load_split(full_root, "test")
    full_train = integ.load_split(full_root, "train")
    strict_train = integ.load_split(strict_root, "train")
    train, _sources = integ.build_integration_train(full_train, strict_train, strict_sc, hard_keep_map)
    vocab_ref = integ.build_char_vocab(train)

    strict_pairs_test = integ.build_strict_test_pairs(strict_test, strict_sc)
    hk_test_ids = {sid for sid, hk in hard_keep_map.items() if hk.get("split") == "test"}
    hard_keep_test = [s for s in strict_test if s["sampleId"] in hk_test_ids][:1200]
    hard_keep_test += [
        s
        for s in full_test
        if s["sampleId"] in hk_test_ids and s["sampleId"] not in {x["sampleId"] for x in hard_keep_test}
    ][:1200]
    no_anchor_test = [s for s in full_test if s.get("trainingBucket") == "NO_ANCHOR"][:1500]
    natural_test = [s for s in full_test if s.get("trainingBucket") == "NATURAL"][:1500]

    results = []
    for seed in cfg["seed_policy"]["seeds"][:3]:
        d = ckpt_root / f"seed_{seed}"
        vocab = json.loads((d / "vocab.json").read_text(encoding="utf-8"))
        assert vocab == vocab_ref
        model = Model3BiGRUV1(vocab_size=len(vocab), feat_dim=FEAT_DIM)
        state = torch.load(d / "weights.pt", map_location="cpu", weights_only=True)
        model.load_state_dict(state)
        model.to(device)
        model.eval()
        print(f"eval seed={seed}…", flush=True)
        suite = integ.eval_suite(
            model,
            full_test,
            strict_pairs_test,
            hard_keep_test,
            no_anchor_test,
            natural_test,
            vocab,
            device,
            collect_errors=False,
        )
        f = suite["full100k"]
        sp = suite["strict_pair"]
        g = suite["generalization"]
        row = {
            "seed": seed,
            "precision": f["retry_precision"],
            "recall": f["retry_recall"],
            "f1": f["retry_f1"],
            "false_retry": f["false_retry_rate"],
            "strict_pair": sp["normal"]["pair_accuracy"],
            "strict_zero": sp["zero"]["pair_accuracy"],
            "strict_shuffle": sp["shuffle"]["pair_accuracy"],
            "hard_keep": suite["hard_keep"]["accuracy"],
            "no_anchor_fp": suite["no_anchor"]["false_retry_rate"],
            "heldout_family_f1": g["heldout_family"]["retry_f1"],
            "unseen_surface_f1": g["unseen_surface"]["retry_f1"],
            "unseen_context_f1": g["unseen_context"]["retry_f1"],
        }
        row["selection_score"] = selection_score(row)
        results.append(row)
        print(json.dumps(row, ensure_ascii=False), flush=True)

    winner = max(results, key=lambda r: r["selection_score"])
    out = {
        "phase": "MODEL3_V1_SYNTHETIC_FREEZE_SEED_SELECTION",
        "selection_rule": (
            "multi-metric: Precision/Recall/F1 + Strict Pair + (Strict-Shuffle gap) "
            "+ Heldout Family; reject Strict Pair < 0.80"
        ),
        "per_seed": results,
        "authoritative_seed": winner["seed"],
        "authoritative": winner,
    }
    out_path = ckpt_root / "freeze_seed_eval.json"
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print("WINNER", winner["seed"], flush=True)
    print("WROTE", out_path, flush=True)


if __name__ == "__main__":
    main()
