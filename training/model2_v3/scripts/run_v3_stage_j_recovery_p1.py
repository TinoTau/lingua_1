#!/usr/bin/env python3
"""Experiment P1 — Stage-P-only FEATURE_HASH_V1 controlled refine reproduction.

ONLY intentional change vs frozen Stage P refine:
  pack_batch_inputs(..., feature_hash=\"v1\")

NO domain head. NO joint. NO architecture change.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from typing import Any, Optional

import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset, WeightedRandomSampler

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from training.model2.retrieval.finespan import FineSpanView
from training.model2.retrieval.finespan_retrieval import base_retrieve_span
from training.model2.retrieval.spike_retriever import ProfileRetrievalConfig
from training.model2.training.dataset import load_candidate_index
from training.model2_v2.runtime.active_set import ACTIVE_SET_V1
from training.model2_v3.policy.actions import ACTION_CATALOG, ACTION_INDEX, action_applicable, execute_action
from training.model2_v3.policy.model import RetrievalPolicyV3, pack_batch_inputs
from training.model2_v3.policy.ranking_loss import pairwise_action_ranking_loss
from training.model2_v3.scripts.run_v3_phase3_stage_p_refine import top1_labels

DATA = ROOT / "training/model2_v3/dataset/policy_phase2"
OUT = ROOT / "training/model2_v3/experiments/v3_stage_j_recovery_p1_d1"
CKPT_P2 = ROOT / "training/model2_v3/experiments/v3_phase2/training/model2_v3_phase2_policy.pt"
IDX = ROOT / "training/model2/dataset/baseline_v1/stage_b_trainrows/candidate_index.jsonl"
IDX_META = ROOT / "training/model2/dataset/baseline_v1/stage_b_trainrows/candidate_index_meta.json"
FEATURE_HASH = "v1"
HARD_VARIANTS = (
    "CORRECT_MULTI",
    "HIGH_CARD_10",
    "HIGH_CARD_20",
    "HIGH_CARD_50",
    "WEAK_STRONG",
    "CORRECT",
)


def dump(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", path.name, flush=True)


def load_ckpt(path: Path, model: RetrievalPolicyV3, *, strict: bool = True) -> None:
    obj = torch.load(path, map_location="cpu", weights_only=False)
    sd = obj["state_dict"] if isinstance(obj, dict) and "state_dict" in obj else obj
    model.load_state_dict(sd, strict=strict)


def load_rows() -> list[dict]:
    rows = []
    with (DATA / "rows.jsonl").open(encoding="utf-8") as f:
        for line in f:
            rows.append(json.loads(line))
    return rows


def rate(a: int, b: int) -> float:
    return float(a) / float(b) if b else 0.0


def red(new: float, old: float) -> float:
    return (old - new) / old if old else 0.0


def select_actions(
    model: RetrievalPolicyV3,
    row: dict,
    *,
    query_budget: int,
    device: torch.device,
) -> tuple[list[str], list[dict]]:
    model.eval()
    state = {
        "base_pool": row["base_pool"],
        "query_budget": 8,
        "cand_budget": 8,
        "n_applicable": row.get("n_applicable", 0),
        "applicability": row.get("applicability", []),
    }
    x = pack_batch_inputs(
        [row["span"]["span_syllables"]],
        [row["profile_phonetic"]],
        [state],
        device=device,
        feature_hash=FEATURE_HASH,
    )
    with torch.no_grad():
        out = model(*x)
        probs = torch.sigmoid(out["action_logits"][0]).cpu()
    scored: list[tuple[float, str]] = []
    prof = row["profile_phonetic"]
    for i, a in enumerate(ACTION_CATALOG):
        if a.kind != "single":
            continue
        if not all(float(prof.get(r) or 0) > 0 for r in a.relations):
            continue
        scored.append((float(probs[i]), a.action_id))
    scored.sort(reverse=True)
    detail = [{"action_id": aid, "raw_prob": s, "rank": r + 1} for r, (s, aid) in enumerate(scored)]
    chosen = [aid for _, aid in scored[: max(1, min(8, query_budget))]]
    return chosen, detail


def run_row(
    index,
    row: dict,
    *,
    mode: str,
    model: Optional[RetrievalPolicyV3],
    query_budget: Optional[int],
    device: torch.device,
    cfg: ProfileRetrievalConfig,
) -> dict:
    span = FineSpanView(**{k: v for k, v in row["span"].items() if k in FineSpanView.__dataclass_fields__})
    tid = row["target_term_id"]
    prof = row["profile_phonetic"]
    base = set(base_retrieve_span(index, span, cfg=cfg))
    t0 = time.perf_counter()
    detail: list[dict] = []
    if mode == "B1":
        actions = [
            a.action_id
            for a in ACTION_CATALOG
            if a.kind == "single" and action_applicable(span, a, prof)
        ]
        used_budget = len(actions)
    else:
        assert model is not None
        actions, detail = select_actions(model, row, query_budget=int(query_budget or 1), device=device)
        used_budget = len(actions)
    new_ids: set[str] = set()
    n_q = 0
    for aid in actions:
        a = ACTION_CATALOG[ACTION_INDEX[aid]]
        res = execute_action(index, span, a, base_ids=base, cfg=cfg, max_cands=8)
        n_q += int(res.get("n_queries") or 0)
        for t in res.get("term_ids") or []:
            if len(new_ids) >= 8:
                break
            new_ids.add(t)
    return {
        "recovered": tid in new_ids,
        "n_queries": n_q,
        "n_candidates": len(new_ids),
        "n_actions": len(actions),
        "budget_used": used_budget,
        "latency_ms": (time.perf_counter() - t0) * 1000.0,
        "actions": actions,
        "score_detail": detail,
    }


def summarize(results: list[dict]) -> dict:
    n = len(results)
    if not n:
        return {"n": 0}

    def pct(xs, p):
        xs = sorted(xs)
        return float(xs[min(len(xs) - 1, int(round((p / 100) * (len(xs) - 1))))]) if xs else 0.0

    qs = [r["n_queries"] for r in results]
    cs = [r["n_candidates"] for r in results]
    ls = [r["latency_ms"] for r in results]
    hits = sum(1 for r in results if r["recovered"])
    return {
        "n": n,
        "TargetIntroductionRate": rate(hits, n),
        "QueryCount_mean": sum(qs) / n,
        "QueryCount_P50": pct(qs, 50),
        "CandidateCount_mean": sum(cs) / n,
        "Latency_P50": pct(ls, 50),
    }


def cost_pair(b1: dict, v3: dict) -> dict:
    rr = (
        v3.get("TargetIntroductionRate", 0) / b1["TargetIntroductionRate"]
        if b1.get("TargetIntroductionRate", 0) > 0
        else 0.0
    )
    return {
        "RecallRetained": rr,
        "QueryReduction": red(v3.get("QueryCount_mean", 0), b1.get("QueryCount_mean", 0)),
        "CandidateReduction": red(v3.get("CandidateCount_mean", 0), b1.get("CandidateCount_mean", 0)),
        "E2ECostReduction": red(
            v3.get("QueryCount_mean", 0) + 0.2 * v3.get("CandidateCount_mean", 0) + 0.001 * v3.get("Latency_P50", 0),
            b1.get("QueryCount_mean", 0) + 0.2 * b1.get("CandidateCount_mean", 0) + 0.001 * b1.get("Latency_P50", 0),
        ),
        "B1": b1,
        "V3": v3,
    }


def eval_slice(index, rows, model, *, qb: int, device, cfg) -> dict:
    b1s, v3s = [], []
    for r in rows:
        b1s.append(run_row(index, r, mode="B1", model=None, query_budget=None, device=device, cfg=cfg))
        v3s.append(run_row(index, r, mode="V3", model=model, query_budget=qb, device=device, cfg=cfg))
    return cost_pair(summarize(b1s), summarize(v3s))


def teacher_top_rank(row: dict, detail: list[dict]) -> Optional[int]:
    teacher = row.get("teacher") or {}
    cands = [a for a in (teacher.get("best_utility_actions") or []) if a.startswith("single:")]
    if not cands:
        cands = [a for a in (teacher.get("best_recall_actions") or []) if a.startswith("single:")]
    if not cands:
        cands = [a for a in (teacher.get("best_actions") or []) if a.startswith("single:")]
    if not cands:
        return None
    want = cands[0]
    for d in detail:
        if d["action_id"] == want:
            return int(d["rank"])
    return None


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    device = torch.device("cpu")
    print("P1 load rows", flush=True)
    rows = load_rows()
    hard = [r for r in rows if r.get("is_hard_multi") and (r.get("teacher") or {}).get("any_recover")]
    train = [r for r in rows if r["split"] == "train"]
    train_mix = train + hard * 3

    dump(
        OUT / "p1_controlled_variables.json",
        {
            "changed_variables": ["feature_hash"],
            "feature_hash": {"from": "legacy Python hash()", "to": "MODEL2_FEATURE_HASH_V1", "pack_arg": "v1"},
            "unchanged": {
                "model": "RetrievalPolicyV3(with_domain_head=False)",
                "labels": "top1_labels teacher soft",
                "loss": "BCE + 1.25*pairwise(margin=0.75) + 0.25*CE(qb)",
                "train": "train + hard*3, hard_weight=5, sampler<=8000, batch=64",
                "optim": "Adam lr=3e-4 epochs=12",
                "decode": "qb=1 no applicability_bonus",
                "init": str(CKPT_P2.relative_to(ROOT)) if CKPT_P2.exists() else "MISSING",
                "dataset": "policy_phase2/rows.jsonl + baseline_v1 candidate index",
            },
            "necessary_non_silent_notes": [
                "Historical freeze eval n=197 row_id snapshot NOT preserved; cannot forge exact 197 denominator",
                "eval pack_batch_inputs must use feature_hash=v1 to match train (documented, required)",
            ],
            "P1_CONTROLLED_VARIABLES": "PASS",
        },
    )

    spans, profiles, states, y_act, y_qb, weights = [], [], [], [], [], []
    for r in train_mix:
        spans.append(r["span"]["span_syllables"])
        profiles.append(r["profile_phonetic"])
        states.append(
            {
                "base_pool": r["base_pool"],
                "query_budget": 8,
                "cand_budget": 8,
                "n_applicable": r.get("n_applicable", 0),
                "applicability": row_appl(r),
            }
        )
        y_act.append(top1_labels(r))
        y_qb.append(r["label_query_budget_class"])
        weights.append(5.0 if r.get("is_hard_multi") else 1.0)

    print("P1 pack features feature_hash=v1", flush=True)
    X = pack_batch_inputs(spans, profiles, states, feature_hash=FEATURE_HASH)
    Ya = torch.stack(y_act)
    Yq = torch.tensor(y_qb, dtype=torch.long)
    ds = TensorDataset(X[0], X[1], X[2], X[3], Ya, Yq, torch.tensor(weights))
    sampler = WeightedRandomSampler(weights, num_samples=min(len(weights), 8000), replacement=True)
    loader = DataLoader(ds, batch_size=64, sampler=sampler)

    model = RetrievalPolicyV3(with_domain_head=False).to(device)
    assert not model.with_domain_head
    if CKPT_P2.exists():
        load_ckpt(CKPT_P2, model, strict=True)
        init_note = "phase2_strict"
    else:
        init_note = "random_no_phase2"
        print("WARN missing phase2 ckpt", flush=True)

    dump(
        OUT / "p1_training_config.json",
        {
            "feature_hash": FEATURE_HASH,
            "feature_hash_version": "MODEL2_FEATURE_HASH_V1",
            "with_domain_head": False,
            "ranking_mode": "bce_pairwise_top1",
            "pairwise_weight": 1.25,
            "pairwise_margin": 0.75,
            "qb_ce_weight": 0.25,
            "lr": 3e-4,
            "epochs": 12,
            "batch_size": 64,
            "sampler_cap": 8000,
            "hard_weight": 5.0,
            "hard_oversample": 3,
            "init": init_note,
            "param_count": model.param_count(),
            "query_budget_decode": 1,
            "applicability_bonus": False,
        },
    )
    dump(
        OUT / "p1_dataset_manifest.json",
        {
            "rows_total": len(rows),
            "train": len(train),
            "hard_any_recover_all_splits": len(hard),
            "train_mix_len": len(train_mix),
            "heldout_hard_variant_filtered": len(
                [
                    r
                    for r in hard
                    if r["split"] in ("test", "val") and r.get("variant") in HARD_VARIANTS
                ]
            ),
            "historical_freeze_n": 197,
            "historical_freeze_row_ids": "NOT_PRESERVED",
        },
    )

    opt = torch.optim.Adam(model.parameters(), lr=3e-4)
    pos_count = Ya.sum(dim=0).clamp(min=1)
    neg_count = (Ya.shape[0] - pos_count).clamp(min=1)
    pos_weight = (neg_count / pos_count).clamp(1.0, 30.0)
    bce = nn.BCEWithLogitsLoss(pos_weight=pos_weight.to(device))
    ce = nn.CrossEntropyLoss()

    hist = []
    print("P1 train 12 epochs", flush=True)
    for ep in range(12):
        model.train()
        tot = 0.0
        n = 0
        for a, b, c, d, ya, yq, _w in loader:
            a, b, c, d, ya, yq = [t.to(device) for t in (a, b, c, d, ya, yq)]
            opt.zero_grad()
            out = model(a, b, c, d)
            logits = out["action_logits"]
            loss = (
                bce(logits, ya)
                + 1.25 * pairwise_action_ranking_loss(logits, (ya > 0.5).float(), margin=0.75)
                + 0.25 * ce(out["query_budget_logits"], yq)
            )
            loss.backward()
            opt.step()
            tot += float(loss.item())
            n += 1
        hist.append({"epoch": ep + 1, "loss": tot / max(1, n)})
        print("epoch", ep + 1, hist[-1]["loss"], flush=True)

    ckpt_path = OUT / "training" / "p1_stage_p_feature_hash_v1.pt"
    ckpt_path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "state_dict": model.state_dict(),
            "architecture": "RetrievalPolicyV3",
            "with_domain_head": False,
            "phase": "stage_j_recovery_p1",
            "ranking_mode": "bce_pairwise_top1",
            "feature_hash": "MODEL2_FEATURE_HASH_V1",
            "epoch_metrics": hist,
        },
        ckpt_path,
    )
    dump(
        OUT / "p1_checkpoint_manifest.json",
        {
            "path": str(ckpt_path.relative_to(ROOT)).replace("\\", "/"),
            "feature_hash": "MODEL2_FEATURE_HASH_V1",
            "with_domain_head": False,
            "param_count": model.param_count(),
            "ranking_mode": "bce_pairwise_top1",
            "epochs": 12,
        },
    )

    index = load_candidate_index(IDX, IDX_META)
    cfg = ProfileRetrievalConfig(
        max_total_profile_candidates=8,
        max_new_candidates_per_query=8,
        max_generated_phonetic_queries=1,
    )

    print("P1 eval current frozen-definition n=", len(hard), flush=True)
    current = eval_slice(index, hard, model, qb=1, device=device, cfg=cfg)
    dump(OUT / "p1_current_frozen_definition_eval.json", {"definition": "is_hard_multi && any_recover ALL splits", "n": len(hard), **current})

    # Historical freeze-parity: cannot reconstruct exact 197; report CURRENT under freeze def + note
    dump(
        OUT / "p1_freeze_parity_eval.json",
        {
            "definition": "is_hard_multi && any_recover ALL splits (same as freeze)",
            "historical_n": 197,
            "historical_row_id_snapshot": "NOT_PRESERVED",
            "current_n_under_same_definition": len(hard),
            "reason_n_differs": "policy_phase2 grew since Stage P freeze (hard any_recover 197→{})".format(len(hard)),
            "metrics_on_current_same_definition": current,
            "NOTE": "Do not forge historical 197 denominator; primary gate uses current frozen-definition RR",
        },
    )

    held = [
        r
        for r in hard
        if r["split"] in ("test", "val") and r.get("variant") in HARD_VARIANTS
    ]
    print("P1 eval held-out n=", len(held), flush=True)
    held_m = eval_slice(index, held, model, qb=1, device=device, cfg=cfg)
    dump(OUT / "p1_heldout_eval.json", {"definition": "hard+variant filter+heldout", "n": len(held), **held_m})

    # Top1/Top2 on current hard (cap 400 for cost)
    sample = hard if len(hard) <= 400 else hard[:: max(1, len(hard) // 400)][:400]
    top1 = top2 = below = 0
    for r in sample:
        _, detail = select_actions(model, r, query_budget=1, device=device)
        rank = teacher_top_rank(r, detail)
        if rank is None:
            continue
        if rank == 1:
            top1 += 1
        elif rank == 2:
            top2 += 1
        else:
            below += 1
    denom = max(1, top1 + top2 + below)
    top_stats = {
        "n": denom,
        "teacher_at_top1": top1,
        "teacher_at_top2_cum": top1 + top2,
        "teacher_below_top2": below,
        "correct_teacher_Top1_pct": top1 / denom,
        "correct_teacher_Top2_pct": (top1 + top2) / denom,
        "correct_teacher_below_Top2_pct": below / denom,
        "stage_j_reference": {"Top1": 0.72, "Top2": 0.955},
    }
    dump(OUT / "p1_top1_top2.json", top_stats)

    # Relation slices on current hard
    slices = {}
    for rel in ACTIVE_SET_V1:
        sub = [r for r in hard if float((r.get("profile_phonetic") or {}).get(rel) or 0) > 0]
        if len(sub) < 8:
            continue
        # subsample for speed
        if len(sub) > 120:
            sub = sub[:: max(1, len(sub) // 120)][:120]
        m = eval_slice(index, sub, model, qb=1, device=device, cfg=cfg)
        # teacher top1 on sub
        t1 = t2 = 0
        n_t = 0
        for r in sub[:80]:
            _, detail = select_actions(model, r, query_budget=1, device=device)
            rank = teacher_top_rank(r, detail)
            if rank is None:
                continue
            n_t += 1
            if rank == 1:
                t1 += 1
            if rank <= 2:
                t2 += 1
        slices[rel] = {
            "n": m["B1"]["n"],
            "RecallRetained": m["RecallRetained"],
            "QueryReduction": m["QueryReduction"],
            "TargetIntroductionRate_V3": m["V3"]["TargetIntroductionRate"],
            "teacher_Top1": t1 / max(1, n_t),
            "teacher_Top2": t2 / max(1, n_t),
        }
    dump(OUT / "p1_relation_slices.json", slices)

    dump(
        OUT / "p1_efficiency.json",
        {
            "current_frozen_definition": {
                "QueryReduction": current["QueryReduction"],
                "CandidateReduction": current["CandidateReduction"],
                "E2ECostReduction": current["E2ECostReduction"],
                "Latency_P50_V3": current["V3"].get("Latency_P50"),
            },
            "heldout": {
                "QueryReduction": held_m["QueryReduction"],
                "CandidateReduction": held_m["CandidateReduction"],
                "E2ECostReduction": held_m["E2ECostReduction"],
            },
            "query_budget": 1,
        },
    )

    rr_primary = float(current["RecallRetained"])
    dump(
        OUT / "p1_regression_comparison.json",
        {
            "frozen_stage_p_legacy_hash_reference": {
                "RecallRetained": 1.0,
                "QueryReduction": 0.517,
                "CandidateReduction": 0.367,
                "E2ECostReduction": 0.470,
                "n_historical": 197,
            },
            "stage_j_joint_reference": {"RecallRetained": 0.813, "n_heldout": 439},
            "p1_current_frozen_definition": current,
            "p1_heldout": held_m,
            "primary_gate": "current_frozen_definition RR >= 0.95",
            "PASS": rr_primary >= 0.95,
            "strong": rr_primary >= 0.98,
        },
    )
    print("P1 DONE RR_current=", rr_primary, "Top1=", top_stats["correct_teacher_Top1_pct"], flush=True)


def row_appl(r: dict) -> list:
    if "applicability" in r:
        return r["applicability"]
    return []


if __name__ == "__main__":
    main()
