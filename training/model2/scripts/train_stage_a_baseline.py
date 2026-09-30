#!/usr/bin/env python3
"""Phase 7A — Stage A Baseline V1 training (frozen architecture, new 10k data)."""

from __future__ import annotations

import argparse
import json
import platform
import sys
from pathlib import Path

import torch

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from training.model2.encoding.syllable_vocab import SyllableVocabV1
from training.model2.evaluation.evaluate import (
    cpu_latency_benchmark,
    evaluate_hn_fp,
    evaluate_model_on_rows,
    evaluate_nomatch_fp,
    evaluate_nomatch_on_negatives,
    mask_invariance_test,
    term_id_stress_test,
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
    return {
        "all_term_positive": evaluate_model_on_rows(model, slice_rows(rows), cand_cache, cfg),
        "train": evaluate_model_on_rows(model, slice_rows(rows, split="train"), cand_cache, cfg),
        "validation": evaluate_model_on_rows(model, slice_rows(rows, split="validation"), cand_cache, cfg),
        "test": evaluate_model_on_rows(model, slice_rows(rows, split="test"), cand_cache, cfg),
        "UNSEEN_TERM": evaluate_model_on_rows(
            model, slice_rows(rows, seen_terms=seen, unseen=True), cand_cache, cfg
        ),
        "SEEN_TERM": evaluate_model_on_rows(
            model, slice_rows(rows, seen_terms=seen, unseen=False), cand_cache, cfg
        ),
        "nomatch_fp": evaluate_nomatch_fp(model, rows, cand_cache, cfg),
        "nomatch_n1": evaluate_nomatch_on_negatives(model, rows, cand_cache, cfg, negative_type="N1"),
        "hn_fp_injected": evaluate_hn_fp(model, rows, cand_cache, cfg, native=False),
        "mask_invariance": mask_invariance_test(model, rows, cand_cache, cfg),
        "term_id_stress": term_id_stress_test(model, rows, cand_cache, cfg),
        "cpu_latency": cpu_latency_benchmark(model, rows, cand_cache, cfg),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--rows-dir",
        type=Path,
        default=ROOT / "training/model2/dataset/baseline_v1/stage_b_trainrows",
    )
    ap.add_argument(
        "--samples",
        type=Path,
        default=ROOT / "training/model2/dataset/baseline_v1/training_samples.jsonl",
    )
    ap.add_argument(
        "--out-dir",
        type=Path,
        default=ROOT / "training/model2/experiments/stage_a_baseline_v1",
    )
    ap.add_argument("--epochs", type=int, default=20)
    ap.add_argument("--batch-size", type=int, default=32)
    args = ap.parse_args()

    rows_dir = args.rows_dir
    out_dir = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    cfg = StageATrainConfig(
        batch_size=args.batch_size,
        epochs=args.epochs,
        lr=1e-3,
        tiny_n=64,
        tiny_epochs=60,
        markers=("MODEL2_BASELINE_V1", "NOT_FOR_RUNTIME", "NOT_FROZEN"),
        note="Stage A Baseline V1 — frozen architecture on baseline_v1 dataset.",
    )
    if torch.cuda.is_available():
        cfg.device = "cuda"
    set_seed(cfg.seed)

    raw_rows = load_jsonl(rows_dir / "model2_train_rows.jsonl")
    samples = {s["sample_id"]: s for s in load_jsonl(args.samples)} if args.samples.exists() else {}
    index = load_candidate_index(rows_dir / "candidate_index.jsonl", rows_dir / "candidate_index_meta.json")
    vocab = SyllableVocabV1.load(rows_dir / "syl-vocab-v1.json")
    rows = enrich_trainrows(raw_rows, samples, index, vocab) if samples else raw_rows
    cand_cache = precompute_candidate_tensors(index, vocab)

    _dump(
        out_dir / "training_config.json",
        {
            **cfg.to_dict(),
            "rows_dir": str(rows_dir),
            "n_rows": len(rows),
            "env": {
                "python": sys.version,
                "torch": torch.__version__,
                "cuda": torch.cuda.is_available(),
                "device": cfg.device,
                "platform": platform.platform(),
            },
        },
    )
    _dump(
        out_dir / "model_config.json",
        {
            "architecture": "Model2StageAV1 frozen M0",
            "use_condition_in_score": False,
            "profile": "MASK/unavailable during Stage A",
            "markers": list(cfg.markers),
        },
    )

    print("=== Tiny Overfit ===", flush=True)
    _, tiny = tiny_overfit_test(rows, cand_cache, cfg, vocab.to_dict()["size"])
    _dump(out_dir / "tiny_overfit_metrics.json", tiny)
    if not tiny.get("ok"):
        _dump(out_dir / "probe_verdict.json", {"verdict": "FAIL", "reason": "tiny_overfit", "tiny": tiny})
        return 1

    log_path = out_dir / "training_log.jsonl"
    if log_path.exists():
        log_path.unlink()

    print("=== Train M0 Baseline ===", flush=True)
    set_seed(cfg.seed)
    model = build_model(cfg, "M0", vocab.to_dict()["size"])
    params = count_parameters(model)
    _dump(out_dir / "parameter_count.json", params)
    if params["trainable_total"] > 2_000_000:
        return 1
    stats = train_one(model, rows, cand_cache, cfg, log_path=log_path)
    if not stats.get("ok"):
        return 1
    pack = _eval_pack(model, rows, cand_cache, cfg)
    pack["params"] = params
    pack["train_stats"] = {
        "final_train_loss": stats["final_train_loss"],
        "final_val_loss": stats["final_val_loss"],
        "curve_tail": stats["history"][-5:],
    }
    _dump(out_dir / "metrics.json", pack)
    _dump(out_dir / "slice_metrics.json", {
        "UNSEEN_TERM": pack.get("UNSEEN_TERM"),
        "SEEN_TERM": pack.get("SEEN_TERM"),
        "test": pack.get("test"),
        "validation": pack.get("validation"),
    })
    _dump(out_dir / "cpu_latency.json", pack.get("cpu_latency") or {})
    save_checkpoint(
        model,
        out_dir / "checkpoint.pt",
        {"variant": "A0_BASELINE", "params": params, "markers": list(cfg.markers)},
    )
    # also alias for Stage B loader
    save_checkpoint(
        model,
        out_dir / "model2-stageA-baseline-m0.pt",
        {"variant": "A0_BASELINE", "params": params, "markers": list(cfg.markers)},
    )
    export_candidate_embed(
        model,
        cand_cache,
        out_dir / "candidate_embed_baseline_v1.npz",
        {
            "model_checkpoint": "model2-stageA-baseline-m0.pt",
            "embedding_dim": cfg.embed_dim,
            "candidate_index": str(rows_dir / "candidate_index.jsonl"),
            "dataset": "baseline_v1",
        },
    )
    term_stress = pack.get("term_id_stress") or {}
    unseen = pack.get("UNSEEN_TERM") or {}
    go = {
        "tiny_overfit": bool(tiny.get("ok")),
        "term_id_stress": bool(term_stress.get("pass", term_stress.get("ok", True))),
        "params_ok": params["trainable_total"] < 500_000,
        "unseen_term_n": unseen.get("n") or (unseen.get("overall") or {}).get("n"),
    }
    go["stage_a_baseline_pass"] = go["tiny_overfit"] and go["params_ok"] and go["term_id_stress"]
    _dump(out_dir / "probe_verdict.json", {"verdict": "PASS" if go["stage_a_baseline_pass"] else "FAIL", "go": go})
    print(json.dumps({"verdict": "PASS" if go["stage_a_baseline_pass"] else "FAIL", "go": go}, indent=2))
    return 0 if go["stage_a_baseline_pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
