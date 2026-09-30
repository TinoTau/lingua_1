#!/usr/bin/env python3
"""Phase 7C — Controlled Stage A Causal Repair Probes.

Markers: PHASE7C_CAUSAL_PROBE_ONLY / NOT_FOR_RUNTIME / NOT_FROZEN / DO_NOT_REPLACE_BASELINE
Each probe is independent vs Phase 7A baseline. Does NOT replace baseline.
"""

from __future__ import annotations

import argparse
import copy
import json
import random
import sys
from pathlib import Path
from typing import Any, Callable, Optional

import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from training.model2.diagnostics.phase7c_eval import (
    MARKERS,
    apply_observed_query_syllables,
    dump,
    field_source_audit,
    full_eval_pack,
    shortcut_bundle,
)
from training.model2.encoding.syllable_vocab import SyllableVocabV1
from training.model2.evaluation.evaluate import evaluate_model_on_rows
from training.model2.evaluation.slices import build_seen_term_set, slice_rows
from training.model2.model.model_v1 import Model2Config, Model2StageAV1, count_parameters
from training.model2.training.config import StageATrainConfig
from training.model2.training.dataset import (
    StageADataset,
    collate_stage_a,
    enrich_trainrows,
    load_candidate_index,
    load_jsonl,
    precompute_candidate_tensors,
)
from training.model2.training.losses import compose_loss
from training.model2.training.stage_b_trainer import load_stage_a_checkpoint
from training.model2.training.trainer import eval_loss, set_seed

SEEDS_DEFAULT = [20260812, 20260813, 20260814]


def build_model_7a(syl_vocab: int, seed: int = 20260812) -> Model2StageAV1:
    """Exact Stage A M0 capacity/flags as Phase 7A baseline checkpoint."""
    cfg = Model2Config(
        variant="M0",
        embed_dim=64,
        char_dim=24,
        syl_dim=24,
        hidden=96,
        syl_vocab=syl_vocab,
        use_weak_prior=False,
        use_condition_in_score=False,
        use_relation_condition=False,
        use_condition_scorer_v2=False,
    )
    set_seed(seed)
    return Model2StageAV1(cfg)


def save_ckpt(model: Model2StageAV1, path: Path, meta: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "state_dict": model.state_dict(),
            "config": model.cfg.__dict__ if hasattr(model.cfg, "__dict__") else dict(model.cfg.__dict__),
            "meta": meta,
            "markers": MARKERS,
        },
        path,
    )


def load_data(rows_dir: Path, samples_path: Path):
    raw = load_jsonl(rows_dir / "model2_train_rows.jsonl")
    samples = {s["sample_id"]: s for s in load_jsonl(samples_path)} if samples_path.exists() else {}
    index = load_candidate_index(rows_dir / "candidate_index.jsonl", rows_dir / "candidate_index_meta.json")
    vocab = SyllableVocabV1.load(rows_dir / "syl-vocab-v1.json")
    rows = enrich_trainrows(raw, samples, index, vocab) if samples else raw
    for r in rows:
        if r.get("is_term_positive") is None:
            r["is_term_positive"] = bool(r.get("target_in_pool") and r.get("sample_kind") == "POSITIVE")
    cand_cache = precompute_candidate_tensors(index, vocab)
    return rows, cand_cache, vocab


def _mixed_loader(rows, cand_cache, cfg, split="train", shuffle=True):
    pos = StageADataset(rows, cand_cache, mode="term_positive", max_pool=cfg.max_pool)
    neg = StageADataset(rows, cand_cache, mode="negative", max_pool=cfg.max_pool)
    hn = StageADataset(rows, cand_cache, mode="hard_negative", max_pool=cfg.max_pool)
    mixed = []
    for ds in (pos, neg, hn):
        for r in ds.rows:
            if split is None or r.get("split") == split:
                mixed.append(r)
    ds_all = StageADataset(mixed, cand_cache, mode="all", max_pool=cfg.max_pool)
    ds_all.rows = mixed
    return DataLoader(ds_all, batch_size=cfg.batch_size, shuffle=shuffle, collate_fn=collate_stage_a)


def phonetic_aux_loss(scores: torch.Tensor, batch: dict, margin: float = 0.1) -> torch.Tensor:
    """Pairwise: if fuzzy_dist[i] < fuzzy_dist[j], prefer score[i] > score[j]."""
    kinds = batch["sample_kind"]
    device = scores.device
    losses = []
    dists_batch = batch.get("fuzzy_pool_distances")
    if dists_batch is None:
        return scores.new_zeros(())
    for bi, kind in enumerate(kinds):
        if kind != "POSITIVE":
            continue
        p = int(batch["pool_len"][bi].item())
        if p < 2:
            continue
        # distances may be list in collate — expect tensor [B,P] if we add it
        if torch.is_tensor(dists_batch):
            d = dists_batch[bi, :p]
        else:
            continue
        sc = scores[bi, :p]
        # sample limited pairs for speed
        for i in range(p):
            for j in range(i + 1, p):
                di, dj = d[i], d[j]
                if not torch.isfinite(di) or not torch.isfinite(dj) or di == dj:
                    continue
                if di < dj:
                    losses.append(F.relu(margin - (sc[i] - sc[j])))
                else:
                    losses.append(F.relu(margin - (sc[j] - sc[i])))
    if not losses:
        return scores.new_zeros(())
    return torch.stack(losses).mean()


def collate_with_distances(batch):
    from training.model2.training.dataset import collate_stage_a as _c

    out = _c(batch)
    # attach fuzzy distances as float tensor
    max_p = out["cand_char_ids"].size(1)
    dist_rows = []
    for item in batch:
        # recover from original row via trainrow — StageADataset item doesn't include distances
        dist_rows.append([0.0] * max_p)
    # filled below in train loop via custom dataset wrapper
    return out


class DistanceAwareDataset(StageADataset):
    def __getitem__(self, idx: int) -> dict[str, Any]:
        item = super().__getitem__(idx)
        r = self.rows[idx]
        dists = list(r.get("fuzzy_pool_distances") or [])
        p = min(len(dists), self.max_pool)
        padded = []
        for i in range(self.max_pool):
            if i < p and dists[i] is not None:
                padded.append(float(dists[i]))
            else:
                padded.append(float("nan"))
        item["fuzzy_pool_distances"] = torch.tensor(padded, dtype=torch.float)
        return item


def collate_stage_a_dist(batch: list[dict]) -> dict:
    from training.model2.training.dataset import collate_stage_a as base

    out = base(batch)
    out["fuzzy_pool_distances"] = torch.stack([b["fuzzy_pool_distances"] for b in batch], dim=0)
    return out


def train_probe(
    model: Model2StageAV1,
    rows: list[dict],
    cand_cache: dict,
    cfg: StageATrainConfig,
    *,
    out_dir: Path,
    epochs: int,
    seed: int,
    loss_mode: str = "ce",  # ce | ce_phonetic_aux
    aux_lambda: float = 0.5,
    cand_char_dropout: float = 0.0,
    eval_every_epoch: bool = False,
    save_every_epoch: bool = True,
) -> dict[str, Any]:
    device = torch.device(cfg.device)
    model = model.to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=cfg.lr, weight_decay=cfg.weight_decay)
    set_seed(seed)
    history = []
    epoch_metrics = []
    ckpt_dir = out_dir / "checkpoints"
    ckpt_dir.mkdir(parents=True, exist_ok=True)
    seen_surf = build_seen_term_set(rows)
    seen_rows = slice_rows(rows, seen_terms=seen_surf, unseen=False)
    unseen_rows = slice_rows(rows, seen_terms=seen_surf, unseen=True)

    # epoch 0 (init)
    if save_every_epoch:
        save_ckpt(model, ckpt_dir / "epoch_000.pt", {"epoch": 0, "seed": seed})
    if eval_every_epoch:
        epoch_metrics.append(
            {
                "epoch": 0,
                "SEEN_R1": evaluate_model_on_rows(model, seen_rows, cand_cache, cfg).get("Recall@1"),
                "UNSEEN_R1": evaluate_model_on_rows(model, unseen_rows, cand_cache, cfg).get("Recall@1"),
                "shortcut_SEEN": shortcut_bundle(model, seen_rows, cand_cache, cfg, max_n=256),
            }
        )

    for epoch in range(1, epochs + 1):
        model.train()
        if loss_mode == "ce_phonetic_aux":
            pos = DistanceAwareDataset(rows, cand_cache, mode="term_positive", max_pool=cfg.max_pool)
            neg = StageADataset(rows, cand_cache, mode="negative", max_pool=cfg.max_pool)
            hn = StageADataset(rows, cand_cache, mode="hard_negative", max_pool=cfg.max_pool)
            mixed = [r for ds in (pos, neg, hn) for r in ds.rows if r.get("split") == "train"]
            # rebuild distance-aware for mixed train rows only for positives path — simpler: all via DistanceAware
            ds_all = DistanceAwareDataset(mixed, cand_cache, mode="all", max_pool=cfg.max_pool)
            ds_all.rows = mixed
            loader = DataLoader(
                ds_all, batch_size=cfg.batch_size, shuffle=True, collate_fn=collate_stage_a_dist
            )
        else:
            loader = _mixed_loader(rows, cand_cache, cfg, split="train", shuffle=True)

        totals = {"loss": 0.0, "n": 0}
        for batch in loader:
            batch_t = {k: v.to(device) if torch.is_tensor(v) else v for k, v in batch.items()}
            if cand_char_dropout > 0:
                # randomly zero candidate char ids (keep syllables)
                mask = (torch.rand(batch_t["cand_char_ids"].shape[:2], device=device) < cand_char_dropout) & (
                    batch_t["pool_mask"] if "pool_mask" in batch_t else True
                )
                # pool_mask may be bool [B,P]
                if "pool_mask" in batch_t:
                    drop = torch.rand(batch_t["cand_char_ids"].size(0), batch_t["cand_char_ids"].size(1), device=device)
                    drop = (drop < cand_char_dropout) & batch_t["pool_mask"]
                else:
                    drop = torch.rand(batch_t["cand_char_ids"].size(0), batch_t["cand_char_ids"].size(1), device=device) < cand_char_dropout
                batch_t["cand_char_ids"] = batch_t["cand_char_ids"].clone()
                batch_t["cand_char_ids"][drop] = 0

            out = model(batch_t)
            parts = compose_loss(
                out,
                batch_t,
                lambda_neg=cfg.lambda_neg,
                lambda_hn=cfg.lambda_hn,
                hn_margin=cfg.hn_margin,
            )
            loss = parts["loss"]
            if loss_mode == "ce_phonetic_aux":
                loss = loss + aux_lambda * phonetic_aux_loss(out["scores"], batch_t)
            if not torch.isfinite(loss):
                return {"ok": False, "error": "NaN", "history": history}
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            opt.step()
            bs = batch_t["span_char_ids"].size(0)
            totals["loss"] += float(loss.item()) * bs
            totals["n"] += bs

        val = eval_loss(model, rows, cand_cache, cfg, split="validation")
        row = {"epoch": epoch, "train_loss": totals["loss"] / max(1, totals["n"]), "val_loss": val}
        history.append(row)
        if save_every_epoch:
            save_ckpt(model, ckpt_dir / f"epoch_{epoch:03d}.pt", {"epoch": epoch, "seed": seed, **row})
        if eval_every_epoch:
            em = {
                "epoch": epoch,
                "train_loss": row["train_loss"],
                "val_loss": val,
                "SEEN_R1": evaluate_model_on_rows(model, seen_rows, cand_cache, cfg).get("Recall@1"),
                "UNSEEN_R1": evaluate_model_on_rows(model, unseen_rows, cand_cache, cfg).get("Recall@1"),
                "shortcut_SEEN": shortcut_bundle(model, seen_rows, cand_cache, cfg, max_n=256),
            }
            epoch_metrics.append(em)
            print(
                f"  epoch {epoch}: train={row['train_loss']:.3f} val={val:.3f} "
                f"SEEN={em['SEEN_R1']:.3f} UNSEEN={em['UNSEEN_R1']:.3f}",
                flush=True,
            )
        else:
            print(f"  epoch {epoch}: train={row['train_loss']:.3f} val={val:.3f}", flush=True)

    save_ckpt(model, out_dir / "checkpoint_final.pt", {"epoch": epochs, "seed": seed})
    return {"ok": True, "history": history, "epoch_metrics": epoch_metrics, "params": count_parameters(model)}


def verdict_from_pack(base: dict, probe: dict) -> str:
    b_u = (base.get("UNSEEN") or {}).get("Recall@1") or 0
    p_u = (probe.get("UNSEEN") or {}).get("Recall@1") or 0
    b_s = (base.get("SEEN") or {}).get("Recall@1") or 0
    p_s = (probe.get("SEEN") or {}).get("Recall@1") or 0
    b_co = ((base.get("shortcut_SEEN") or {}).get("candidate_only") or {}).get("Recall@1") or 0
    p_co = ((probe.get("shortcut_SEEN") or {}).get("candidate_only") or {}).get("Recall@1") or 0
    b_nq = ((base.get("shortcut_SEEN") or {}).get("null_query") or {}).get("Recall@1") or 0
    p_nq = ((probe.get("shortcut_SEEN") or {}).get("null_query") or {}).get("Recall@1") or 0
    b_fp = (base.get("nomatch_fp") or {}).get("NO_MATCH_FP_rate") or 0
    p_fp = (probe.get("nomatch_fp") or {}).get("NO_MATCH_FP_rate") or 0

    unseen_up = p_u >= b_u + 0.02
    shortcut_down = (p_co <= b_co - 0.03) or (p_nq <= b_nq - 0.03)
    seen_ok = p_s >= b_s - 0.08
    safety_ok = p_fp <= b_fp + 0.05
    shortcut_up = (p_co >= b_co + 0.05) and (p_nq >= b_nq + 0.05)

    if p_fp > b_fp + 0.08 and unseen_up:
        return "SAFETY_REGRESSION"
    if unseen_up and shortcut_up:
        return "NEW_SHORTCUT"
    if unseen_up and shortcut_down and seen_ok and safety_ok:
        return "SUPPORTED"
    if unseen_up and seen_ok:
        return "PARTIALLY_SUPPORTED"
    if not unseen_up and (p_co < b_co - 0.05):
        return "PARTIALLY_SUPPORTED"  # shortcut broken but no transfer yet — important result
    if abs(p_u - b_u) < 0.015 and abs(p_co - b_co) < 0.03:
        return "NOT_SUPPORTED"
    return "INCONCLUSIVE"


def reproduce_baseline(stage_a_dir: Path, rows, cand_cache, vocab, cfg, out_dir: Path) -> dict:
    metrics = json.loads((stage_a_dir / "metrics.json").read_text(encoding="utf-8"))
    expected = {
        "SEEN.Recall@1": 0.7283898305084746,
        "SEEN.Recall@3": 0.9449152542372882,
        "UNSEEN.Recall@1": 0.043521266073194856,
        "UNSEEN.Recall@3": 0.09792284866468842,
    }
    got = {
        "SEEN.Recall@1": metrics["SEEN_TERM"]["Recall@1"],
        "SEEN.Recall@3": metrics["SEEN_TERM"]["Recall@3"],
        "UNSEEN.Recall@1": metrics["UNSEEN_TERM"]["Recall@1"],
        "UNSEEN.Recall@3": metrics["UNSEEN_TERM"]["Recall@3"],
    }
    ok = all(abs(got[k] - expected[k]) < 1e-4 for k in expected)
    # live shortcut re-eval on 7A ckpt
    model = load_stage_a_checkpoint(
        stage_a_dir / "model2-stageA-baseline-m0.pt",
        use_condition_in_score=False,
        syl_vocab=vocab.to_dict()["size"],
    )
    model.eval()
    pack = full_eval_pack(model, rows, cand_cache, cfg, label="7A_baseline_live")
    report = {
        "markers": MARKERS,
        "artifact_match": ok,
        "expected": expected,
        "got_from_artifacts": got,
        "live_eval": {
            "SEEN_R1": pack["SEEN"]["Recall@1"],
            "UNSEEN_R1": pack["UNSEEN"]["Recall@1"],
            "candidate_only_seen_R1": pack["shortcut_SEEN"]["candidate_only"]["Recall@1"],
            "null_query_seen_R1": pack["shortcut_SEEN"]["null_query"]["Recall@1"],
        },
        "pass": ok,
        "DIAGNOSTIC_ORACLE_CEILING_note": (
            "FuzzyDistance UNSEEN≈0.979 is DIAGNOSTIC_ORACLE_CEILING under canonical span_syllables; "
            "not RUNTIME_OBSERVABLE_PERFORMANCE."
        ),
    }
    dump(out_dir / "phase7c_baseline_reproduction.json", report)
    dump(out_dir / "baseline_7a_full_eval.json", pack)
    return report, pack, model


def run_one_seed_probe(
    name: str,
    rows_fn: Callable,
    train_kwargs: dict,
    base_pack: dict,
    rows0,
    cand_cache,
    vocab,
    cfg,
    exp_root: Path,
    seed: int,
    epochs: int,
) -> dict:
    out_dir = exp_root / name / f"seed_{seed}"
    out_dir.mkdir(parents=True, exist_ok=True)
    rows = rows_fn(rows0, vocab)
    dump(
        out_dir / "config.json",
        {
            "markers": MARKERS,
            "probe": name,
            "seed": seed,
            "epochs": epochs,
            "train_kwargs": {k: v for k, v in train_kwargs.items() if k != "out_dir"},
            "params_policy": "match_7A_M0",
        },
    )
    model = build_model_7a(vocab.to_dict()["size"], seed=seed)
    print(f"=== {name} seed={seed} ===", flush=True)
    stats = train_probe(
        model,
        rows,
        cand_cache,
        cfg,
        out_dir=out_dir,
        epochs=epochs,
        seed=seed,
        **train_kwargs,
    )
    if not stats.get("ok"):
        dump(out_dir / "train_fail.json", stats)
        return {"ok": False, **stats}
    pack = full_eval_pack(model, rows, cand_cache, cfg, label=f"{name}_{seed}")
    # Also eval on baseline rows contract for fair UNSEEN comparison when P1 changes rows
    if name.startswith("phase7c_p1"):
        pack_on_baseline_rows = full_eval_pack(model, rows0, cand_cache, cfg, label=f"{name}_{seed}_eval_on_7A_rows")
        dump(out_dir / "metrics_eval_on_7A_query_contract.json", pack_on_baseline_rows)
    dump(out_dir / "metrics.json", pack)
    dump(out_dir / "shortcut_metrics.json", {"SEEN": pack["shortcut_SEEN"], "UNSEEN": pack["shortcut_UNSEEN"]})
    dump(
        out_dir / "position_bias.json",
        {
            "SEEN_original": pack["SEEN"],
            "SEEN_random_order": pack["SEEN_random_order"],
            "UNSEEN_original": pack["UNSEEN"],
            "UNSEEN_random_order": pack["UNSEEN_random_order"],
            "POOL_POSITION_SHORTCUT": abs((pack["SEEN"].get("Recall@1") or 0) - (pack["SEEN_random_order"].get("Recall@1") or 0))
            > 0.05,
        },
    )
    dump(out_dir / "per_relation.json", pack["per_relation"])
    dump(out_dir / "phonetic_agreement.json", pack["phonetic_agreement_UNSEEN"])
    dump(out_dir / "training_dynamics.json", {"history": stats["history"], "epoch_metrics": stats.get("epoch_metrics")})
    dump(out_dir / "parameter_count.json", stats["params"])
    v = verdict_from_pack(base_pack, pack)
    dump(out_dir / "probe_verdict.json", {"verdict": v, "markers": MARKERS})
    return {"ok": True, "verdict": v, "pack": pack, "out_dir": str(out_dir), "stats": stats}


def summarize_seeds(results: list[dict], key_path) -> dict:
    xs = []
    for r in results:
        if not r.get("ok"):
            continue
        cur = r["pack"]
        for k in key_path:
            cur = cur[k]
        xs.append(float(cur))
    if not xs:
        return {}
    return {
        "mean": sum(xs) / len(xs),
        "std": (sum((x - sum(xs) / len(xs)) ** 2 for x in xs) / len(xs)) ** 0.5,
        "min": min(xs),
        "max": max(xs),
        "n": len(xs),
        "values": xs,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rows-dir", type=Path, default=ROOT / "training/model2/dataset/baseline_v1/stage_b_trainrows")
    ap.add_argument("--samples", type=Path, default=ROOT / "training/model2/dataset/baseline_v1/training_samples.jsonl")
    ap.add_argument("--stage-a-dir", type=Path, default=ROOT / "training/model2/experiments/stage_a_baseline_v1")
    ap.add_argument("--out-root", type=Path, default=ROOT / "training/model2/experiments")
    ap.add_argument("--epochs", type=int, default=20)
    ap.add_argument("--seeds", type=int, nargs="+", default=[20260812])
    ap.add_argument("--only", type=str, default="all", help="all|p1|p2|p3|p4|report")
    ap.add_argument("--skip-repro-eval", action="store_true", help="Reuse cached baseline_7a_full_eval.json")
    args = ap.parse_args()

    exp = {
        "p1": args.out_root / "phase7c_p1_query_channel",
        "p2": args.out_root / "phase7c_p2_phonetic_bias",
        "p3": args.out_root / "phase7c_p3_anti_memorization",
        "p4": args.out_root / "phase7c_p4_early_stop",
        "meta": args.out_root / "phase7c_meta",
    }
    for p in exp.values():
        p.mkdir(parents=True, exist_ok=True)

    cfg = StageATrainConfig(batch_size=32, epochs=args.epochs, lr=1e-3, device="cpu")
    print("=== load data ===", flush=True)
    rows0, cand_cache, vocab = load_data(args.rows_dir, args.samples)
    dump(exp["meta"] / "runtime_like_query_audit.json", field_source_audit(rows0[0]))
    # runtime-like availability
    dump(
        exp["meta"] / "runtime_like_query_status.json",
        {
            "markers": MARKERS,
            "RUNTIME_LIKE_QUERY": "AVAILABLE_VIA_P1B",
            "definition": "ASR span_text + ASR_DERIVED_APPROX syllables; no canonical target syllables in query",
            "note": "P1-B training/eval rows implement this contract; oracle Fuzzy ceiling does not apply.",
        },
    )

    print("=== reproduce 7A ===", flush=True)
    cached = exp["meta"] / "baseline_7a_full_eval.json"
    repro_path = exp["meta"] / "phase7c_baseline_reproduction.json"
    if args.skip_repro_eval and cached.exists() and repro_path.exists():
        repro = json.loads(repro_path.read_text(encoding="utf-8"))
        base_pack = json.loads(cached.read_text(encoding="utf-8"))
        if not repro.get("pass"):
            print("STOP — BASELINE REPRODUCTION FAIL")
            return 2
        print("baseline reproduction PASS (cached live eval)", flush=True)
    else:
        repro, base_pack, _ = reproduce_baseline(args.stage_a_dir, rows0, cand_cache, vocab, cfg, exp["meta"])
        if not repro["pass"]:
            print("STOP — BASELINE REPRODUCTION FAIL")
            return 2
        print("baseline reproduction PASS", flush=True)

    all_seed_results = {k: [] for k in ("p1", "p2", "p3", "p4")}
    results = {}

    for seed0 in args.seeds:
        if args.only in ("all", "p1") and len(args.seeds) == 1 or (args.only == "p1"):
            if args.only in ("all", "p1"):
                print("=== prepare P1 observed query syllables ===", flush=True)
                r = run_one_seed_probe(
                    "phase7c_p1_query_channel",
                    lambda rows, vocab: apply_observed_query_syllables(rows, vocab),
                    {"loss_mode": "ce", "cand_char_dropout": 0.0, "eval_every_epoch": False, "save_every_epoch": True},
                    base_pack,
                    rows0,
                    cand_cache,
                    vocab,
                    cfg,
                    args.out_root,
                    seed0,
                    args.epochs,
                )
                results["p1"] = r
                all_seed_results["p1"].append(r)
                if r.get("ok"):
                    dump(exp["p1"] / "primary_seed_summary.json", {"seed": seed0, "verdict": r["verdict"]})

        if args.only in ("all", "p2") and (args.only == "p2" or len(args.seeds) == 1):
            r = run_one_seed_probe(
                "phase7c_p2_phonetic_bias",
                lambda rows, vocab: rows,
                {
                    "loss_mode": "ce_phonetic_aux",
                    "aux_lambda": 0.5,
                    "cand_char_dropout": 0.0,
                    "eval_every_epoch": False,
                    "save_every_epoch": True,
                },
                base_pack,
                rows0,
                cand_cache,
                vocab,
                cfg,
                args.out_root,
                seed0,
                args.epochs,
            )
            results["p2"] = r
            all_seed_results["p2"].append(r)

        if args.only in ("all", "p3") or args.only == "p3":
            if args.only in ("all", "p3"):
                r = run_one_seed_probe(
                    "phase7c_p3_anti_memorization",
                    lambda rows, vocab: rows,
                    {
                        "loss_mode": "ce",
                        "cand_char_dropout": 0.5,
                        "eval_every_epoch": False,
                        "save_every_epoch": True,
                    },
                    base_pack,
                    rows0,
                    cand_cache,
                    vocab,
                    cfg,
                    args.out_root,
                    seed0,
                    args.epochs,
                )
                results["p3"] = r
                all_seed_results["p3"].append(r)

        if args.only in ("all", "p4") and (args.only == "p4" or len(args.seeds) == 1):
            r = run_one_seed_probe(
                "phase7c_p4_early_stop",
                lambda rows, vocab: rows,
                {
                    "loss_mode": "ce",
                    "cand_char_dropout": 0.0,
                    "eval_every_epoch": True,
                    "save_every_epoch": True,
                },
                base_pack,
                rows0,
                cand_cache,
                vocab,
                cfg,
                args.out_root,
                seed0,
                args.epochs,
            )
            results["p4"] = r
            all_seed_results["p4"].append(r)
            if r.get("ok"):
                dump(
                    exp["p4"] / f"seed_{seed0}" / "checkpoint_manifest.json",
                    {
                        "epochs": list(range(0, args.epochs + 1)),
                        "policy": "save every epoch; best by val_loss and by UNSEEN_R1 reported in epoch_metrics",
                    },
                )
                em = r["stats"].get("epoch_metrics") or []
                if em:
                    best_unseen = max(em, key=lambda x: x.get("UNSEEN_R1") or -1)
                    best_val = min([x for x in em if x.get("epoch", 0) >= 1], key=lambda x: x.get("val_loss") or 1e9)
                    final = em[-1]
                    early_unseen = next((x for x in em if x.get("epoch") == 1), {})
                    interp = "MINOR"
                    if (best_unseen.get("UNSEEN_R1") or 0) >= (final.get("UNSEEN_R1") or 0) + 0.05:
                        interp = "MAJOR"
                    elif (early_unseen.get("UNSEEN_R1") or 0) < 0.10 and (final.get("SEEN_R1") or 0) > (
                        early_unseen.get("SEEN_R1") or 0
                    ) + 0.2:
                        interp = "AMPLIFIER"
                    elif (early_unseen.get("UNSEEN_R1") or 0) < 0.10:
                        interp = "MINOR"
                    dump(
                        exp["p4"] / f"seed_{seed0}" / "early_stop_interpretation.json",
                        {
                            "best_unseen_epoch": best_unseen,
                            "best_val_loss_epoch": best_val,
                            "final_epoch": final,
                            "interpretation": interp,
                        },
                    )

    # multi-seed summary for p3 if present
    if all_seed_results["p3"]:
        dump(
            exp["p3"] / "seed_stability.json",
            {
                "UNSEEN_R1": summarize_seeds(all_seed_results["p3"], ["UNSEEN", "Recall@1"]),
                "candidate_only_SEEN_R1": summarize_seeds(
                    all_seed_results["p3"], ["shortcut_SEEN", "candidate_only", "Recall@1"]
                ),
                "seen_unseen_gap": summarize_seeds(all_seed_results["p3"], ["seen_unseen_gap_R1"]),
            },
        )

    dump(exp["meta"] / "probe_run_results.json", {k: {"ok": v.get("ok"), "verdict": v.get("verdict")} for k, v in results.items()})
    print(json.dumps({k: v.get("verdict") for k, v in results.items()}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
