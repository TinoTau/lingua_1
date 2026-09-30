#!/usr/bin/env python
"""Stage A minimal training probe orchestrator (PROBE_ONLY)."""

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
from training.model2.training.config import StageATrainConfig
from training.model2.training.dataset import (
    dataset_manifest,
    enrich_trainrows,
    load_candidate_index,
    load_jsonl,
    precompute_candidate_tensors,
    write_enriched_jsonl,
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


def export_candidate_embed(model, cand_cache: dict, path: Path, meta: dict) -> None:
    """Offline cache of CandidateEncoder over lexicon snapshot — not vocabulary SSOT."""
    device = next(model.parameters()).device
    model.eval()
    term_ids = sorted(cand_cache.keys())
    # batch encode
    bs = 256
    embeds = []
    with torch.no_grad():
        for i in range(0, len(term_ids), bs):
            chunk = term_ids[i : i + bs]
            char_ids = torch.tensor([cand_cache[t]["char_ids"] for t in chunk], device=device)
            syl_ids = torch.tensor([cand_cache[t]["syl_ids"] for t in chunk], device=device)
            syl_count = torch.tensor([cand_cache[t]["syl_count"] for t in chunk], device=device)
            tt = torch.tensor([cand_cache[t]["term_type_oh"] for t in chunk], device=device, dtype=torch.float)
            emb = model.candidate_encoder(char_ids, syl_ids, syl_count, tt)
            embeds.append(emb.cpu().numpy())
    arr = np.concatenate(embeds, axis=0)
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        path,
        term_ids=np.array(term_ids, dtype=object),
        embeddings=arr,
        meta=json.dumps(meta, ensure_ascii=False),
    )


def main() -> int:
    trainrow_dir = ROOT / "training/model2/dataset/probe_trainrow_v1"
    sample_path = ROOT / "training/model2/dataset/probe_v1/training_samples.jsonl"
    out_dir = ROOT / "training/model2/experiments/stage_a_probe_v1"
    out_dir.mkdir(parents=True, exist_ok=True)

    cfg = StageATrainConfig()
    if torch.cuda.is_available():
        cfg.device = "cuda"
    set_seed(cfg.seed)

    raw_rows = load_jsonl(trainrow_dir / "model2_train_rows.jsonl")
    samples = {s["sample_id"]: s for s in load_jsonl(sample_path)}
    index = load_candidate_index(
        trainrow_dir / "candidate_index.jsonl",
        trainrow_dir / "candidate_index_meta.json",
    )
    vocab = SyllableVocabV1.load(trainrow_dir / "syl-vocab-v1.json")
    rows = enrich_trainrows(raw_rows, samples, index, vocab)
    write_enriched_jsonl(rows, out_dir / "enriched_train_rows.jsonl")
    manifest = dataset_manifest(rows)
    _dump(out_dir / "dataset_manifest.json", manifest)

    cand_cache = precompute_candidate_tensors(index, vocab)

    env = {
        "python": sys.version,
        "torch": torch.__version__,
        "cuda_available": torch.cuda.is_available(),
        "train_device": cfg.device,
        "runtime_device_target": cfg.runtime_device_target,
        "platform": platform.platform(),
        "seed": cfg.seed,
        "syl_vocab": vocab.to_dict()["size"],
        "markers": list(cfg.markers),
    }
    _dump(out_dir / "training_config.json", {**cfg.to_dict(), "env": env})
    _dump(
        out_dir / "model_config.json",
        {
            "architecture": "shared_char_syl_tables + separate_projection_heads",
            "shared_decision": (
                "Chose shared bottom char/syllable embeddings with separate query/candidate "
                "projection heads (option B) for parameter efficiency and representation alignment."
            ),
            "candidate_representation": "surface char-hash-v1 + syllables + term_type metadata — NOT term_id embedding table",
            "score": "dot(Qbase, C) [+ weak personal/domain for M1]",
            "stage_a_masks": "phonetic/tone/domain masked; condition MLP present but unused in score",
            "no_match": "learnable NO_MATCH anchor (option A)",
            "embed_dim": cfg.embed_dim,
            "markers": list(cfg.markers),
        },
    )

    log_path = out_dir / "training_log.jsonl"
    if log_path.exists():
        log_path.unlink()

    print("=== Tiny Overfit Gate ===", flush=True)
    _, tiny_metrics = tiny_overfit_test(rows, cand_cache, cfg, vocab.to_dict()["size"])
    _dump(out_dir / "tiny_overfit_metrics.json", tiny_metrics)
    print(json.dumps(tiny_metrics, indent=2)[:800], flush=True)
    if not tiny_metrics.get("ok"):
        print("TINY OVERFIT FAIL — stopping before full probe", flush=True)
        _dump(out_dir / "probe_verdict.json", {"verdict": "FAIL", "reason": "tiny_overfit"})
        return 1

    results = {"tiny": tiny_metrics}

    for variant in ("M0", "M1"):
        print(f"=== Train {variant} ===", flush=True)
        set_seed(cfg.seed)
        model = build_model(cfg, variant, vocab.to_dict()["size"])
        params = count_parameters(model)
        print("params", params, flush=True)
        if params["trainable_total"] > 2_000_000:
            _dump(out_dir / "probe_verdict.json", {"verdict": "FAIL", "reason": "params>2M", "params": params})
            return 1
        train_stats = train_one(
            model, rows, cand_cache, cfg, log_path=log_path
        )
        if not train_stats.get("ok"):
            _dump(out_dir / "probe_verdict.json", {"verdict": "FAIL", "reason": "train_nan", "variant": variant})
            return 1

        # metrics on all TERM_POSITIVE (probe — val/test tiny)
        all_term = slice_rows(rows)
        train_term = slice_rows(rows, split="train")
        val_term = slice_rows(rows, split="validation")
        test_term = slice_rows(rows, split="test")
        seen = build_seen_term_set(rows)
        seen_slice = slice_rows(rows, seen_terms=seen, unseen=False)
        unseen_slice = slice_rows(rows, seen_terms=seen, unseen=True)
        # prefer holdout splits for unseen if any
        unseen_holdout = [r for r in unseen_slice if r.get("split") in ("validation", "test")]
        if not unseen_holdout:
            unseen_holdout = unseen_slice

        metrics = {
            "variant": variant,
            "params": params,
            "train_stats": {
                "final_train_loss": train_stats["final_train_loss"],
                "final_val_loss": train_stats["final_val_loss"],
                "epochs": len(train_stats["history"]),
                "curve_tail": train_stats["history"][-5:],
            },
            "all_term_positive": evaluate_model_on_rows(model, all_term, cand_cache, cfg),
            "train": evaluate_model_on_rows(model, train_term, cand_cache, cfg),
            "validation": evaluate_model_on_rows(model, val_term, cand_cache, cfg),
            "test": evaluate_model_on_rows(model, test_term, cand_cache, cfg),
            "seen_term": evaluate_model_on_rows(model, seen_slice, cand_cache, cfg),
            "unseen_term": evaluate_model_on_rows(model, unseen_holdout, cand_cache, cfg),
            "nomatch_fp": evaluate_nomatch_fp(model, rows, cand_cache, cfg),
            "nomatch_on_negative": evaluate_nomatch_on_negatives(model, rows, cand_cache, cfg),
            "hn_fp": evaluate_hn_fp(model, rows, cand_cache, cfg),
            "mask_invariance": mask_invariance_test(model, rows, cand_cache, cfg),
            "term_id_stress": term_id_stress_test(model, rows, cand_cache, cfg),
            "wrong_profile_stress": wrong_profile_stress(model, rows, cand_cache, cfg),
            "cpu_latency": cpu_latency_benchmark(model, rows, cand_cache, cfg),
            "markers": list(cfg.markers),
            "confidence_note": (
                "val/test n is tiny — learnability/pipeline probe only; "
                "NOT formal generalization acceptance."
            ),
        }
        _dump(out_dir / f"{variant.lower()}_metrics.json", metrics)
        save_checkpoint(
            model,
            out_dir / f"model2-stageA-probe-{variant.lower()}.pt",
            {"variant": variant, "params": params, "markers": list(cfg.markers)},
        )
        if variant == "M0":
            export_candidate_embed(
                model,
                cand_cache,
                out_dir / "candidate_embed_probe.npz",
                {
                    "model_checkpoint": "model2-stageA-probe-m0.pt",
                    "candidate_encoder_version": "cand-enc-stageA-probe-v1",
                    "lexicon_snapshot": index.lexicon_snapshot_id,
                    "candidate_index_version": index.candidate_index_version,
                    "embedding_dim": cfg.embed_dim,
                    "markers": list(cfg.markers),
                    "note": "Offline CandidateEncoder cache over lexicon snapshot — NOT vocabulary SSOT",
                },
            )
            _dump(out_dir / "mask_invariance.json", metrics["mask_invariance"])
            _dump(out_dir / "term_id_stress.json", metrics["term_id_stress"])
            _dump(out_dir / "cpu_latency.json", metrics["cpu_latency"])
        if variant == "M1":
            _dump(out_dir / "wrong_profile_stress.json", metrics["wrong_profile_stress"])
        results[variant] = metrics

    surfaces = set(index.by_surface.keys())
    baselines = {
        "B_exact": exact_recall_visibility(rows, surfaces),
        "B_pool_distance_all": evaluate_fuzzy_distance_baseline(all_term := slice_rows(rows)),
        "B_pool_distance_train": evaluate_fuzzy_distance_baseline(slice_rows(rows, split="train")),
        "B_pool_distance_val": evaluate_fuzzy_distance_baseline(slice_rows(rows, split="validation")),
        "B_pool_distance_test": evaluate_fuzzy_distance_baseline(slice_rows(rows, split="test")),
    }
    _dump(out_dir / "baseline_metrics.json", baselines)

    slice_metrics = {
        "M0_seen": results["M0"]["seen_term"],
        "M0_unseen": results["M0"]["unseen_term"],
        "M1_seen": results["M1"]["seen_term"],
        "M1_unseen": results["M1"]["unseen_term"],
        "note": "Unseen-term slice is smoke only given tiny holdout.",
    }
    _dump(out_dir / "slice_metrics.json", slice_metrics)

    # GO/STOP heuristics
    m0 = results["M0"]["all_term_positive"]
    bdist = baselines["B_pool_distance_all"]
    gates = {
        "tiny_overfit": results["tiny"]["gate"],
        "params_m0_lt_2m": results["M0"]["params"]["trainable_total"] < 2_000_000,
        "mask_invariance": results["M0"]["mask_invariance"]["gate"],
        "term_id_stress": results["M0"]["term_id_stress"]["gate"],
        "m0_beats_random": m0.get("Recall@1", 0) > (1.0 / max(1.0, m0.get("Positive_average_pool_size", 16))),
        "m0_vs_distance_baseline": {
            "m0_r1": m0.get("Recall@1"),
            "baseline_r1": bdist.get("Recall@1"),
            "m0_mrr": m0.get("MRR"),
            "baseline_mrr": bdist.get("MRR"),
        },
        "wrong_profile_m1": results["M1"]["wrong_profile_stress"].get("gate"),
    }
    hard_fail = (
        gates["tiny_overfit"] != "PASS"
        or not gates["params_m0_lt_2m"]
        or gates["mask_invariance"] != "PASS"
        or gates["term_id_stress"] != "PASS"
        or not gates["m0_beats_random"]
    )
    verdict = "FAIL" if hard_fail else "PASS"
    _dump(
        out_dir / "probe_verdict.json",
        {
            "verdict": verdict,
            "gates": gates,
            "ignored_non_term_positive_count": manifest["ignored_non_term_positive_count"],
            "note": "PASS means architecture worth scaling data — NOT formal quality acceptance.",
        },
    )
    print("VERDICT", verdict, flush=True)
    return 0 if verdict == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
