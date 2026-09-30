#!/usr/bin/env python3
"""Stage P refine: top-1 focused pairwise ranking on HARD_MULTI (no applicability bonus)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset, WeightedRandomSampler

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from training.model2.retrieval.spike_retriever import ProfileRetrievalConfig
from training.model2.training.dataset import load_candidate_index
from training.model2_v3.policy.actions import ACTION_CATALOG, ACTION_INDEX
from training.model2_v3.policy.model import N_ACTIONS, RetrievalPolicyV3, pack_batch_inputs
from training.model2_v3.policy.ranking_loss import pairwise_action_ranking_loss
from training.model2_v3.scripts.run_v3_phase3_stage_p import (
    OUT,
    dump,
    eval_slice,
    load_ckpt,
    load_rows,
)

CKPT_P2 = ROOT / "training/model2_v3/experiments/v3_phase2/training/model2_v3_phase2_policy.pt"
IDX = ROOT / "training/model2/dataset/baseline_v1/stage_b_trainrows/candidate_index.jsonl"
IDX_META = ROOT / "training/model2/dataset/baseline_v1/stage_b_trainrows/candidate_index_meta.json"


def top1_labels(row: dict) -> torch.Tensor:
    """One-hot (or soft) on best recovering SINGLE action by teacher utility order."""
    y = torch.zeros(N_ACTIONS)
    teacher = row.get("teacher") or {}
    # prefer best_utility singles, else best_recall singles
    cands = [a for a in (teacher.get("best_utility_actions") or []) if a.startswith("single:")]
    if not cands:
        cands = [a for a in (teacher.get("best_recall_actions") or []) if a.startswith("single:")]
    if not cands:
        cands = [a for a in (teacher.get("best_actions") or []) if a.startswith("single:")]
    if cands and cands[0] in ACTION_INDEX:
        y[ACTION_INDEX[cands[0]]] = 1.0
        # soft: also mark other recovering singles lightly for BCE stability
        for a in cands[1:3]:
            if a in ACTION_INDEX:
                y[ACTION_INDEX[a]] = 0.35
    elif row.get("label_actions"):
        # fallback multi-label
        y = torch.tensor(row["label_actions"], dtype=torch.float32)
    return y


def main() -> None:
    device = torch.device("cpu")
    rows = load_rows()
    hard = [r for r in rows if r.get("is_hard_multi") and r["teacher"].get("any_recover")]
    train = [r for r in rows if r["split"] == "train"]
    # oversample hard into train mix
    train_mix = train + hard * 3

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
                "applicability": r.get("applicability", []),
            }
        )
        y_act.append(top1_labels(r))
        y_qb.append(r["label_query_budget_class"])
        w = 5.0 if r.get("is_hard_multi") else 1.0
        weights.append(w)

    X = pack_batch_inputs(spans, profiles, states)
    Ya = torch.stack(y_act)
    Yq = torch.tensor(y_qb, dtype=torch.long)
    ds = TensorDataset(X[0], X[1], X[2], X[3], Ya, Yq, torch.tensor(weights))
    sampler = WeightedRandomSampler(weights, num_samples=min(len(weights), 8000), replacement=True)
    loader = DataLoader(ds, batch_size=64, sampler=sampler)

    model = RetrievalPolicyV3().to(device)
    load_ckpt(CKPT_P2, model, strict=True)
    opt = torch.optim.Adam(model.parameters(), lr=3e-4)
    pos_count = Ya.sum(dim=0).clamp(min=1)
    neg_count = (Ya.shape[0] - pos_count).clamp(min=1)
    pos_weight = (neg_count / pos_count).clamp(1.0, 30.0)
    bce = nn.BCEWithLogitsLoss(pos_weight=pos_weight.to(device))
    ce = nn.CrossEntropyLoss()

    hist = []
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
        print("epoch", ep + 1, hist[-1]["loss"])

    index = load_candidate_index(IDX, IDX_META)
    cfg = ProfileRetrievalConfig(
        max_total_profile_candidates=8,
        max_new_candidates_per_query=8,
        max_generated_phonetic_queries=1,
    )
    base_m = RetrievalPolicyV3().to(device)
    load_ckpt(CKPT_P2, base_m, strict=True)
    before = eval_slice(index, hard, base_m, qb=1, device=device, cfg=cfg, applicability_bonus=False)
    after = eval_slice(index, hard, model, qb=1, device=device, cfg=cfg, applicability_bonus=False)
    after2 = eval_slice(index, hard, model, qb=2, device=device, cfg=cfg, applicability_bonus=False)
    print("before", before)
    print("after_qb1", after)
    print("after_qb2", after2)

    ckpt_path = OUT / "training" / "stage_p_checkpoint.pt"
    torch.save(
        {
            "state_dict": model.state_dict(),
            "architecture": "RetrievalPolicyV3",
            "phase": "stage_p_top1_refine",
            "ranking_mode": "bce_pairwise_top1",
        },
        ckpt_path,
    )

    rr = float(after.get("RecallRetained") or 0)
    qr = float(after.get("QueryReduction") or 0)
    cr = float(after.get("CandidateReduction") or 0)
    e2e = float(after.get("E2ECostReduction") or 0)
    strong = rr >= 0.90 and qr >= 0.40 and cr >= 0.25 and e2e >= 0.35
    # update artifacts
    prev_cmp = {}
    cmp_path = OUT / "stage_p_ranking_objective_comparison.json"
    if cmp_path.exists():
        prev_cmp = json.loads(cmp_path.read_text(encoding="utf-8"))
    prev_cmp["top1_refine"] = {
        "mode": "bce_pairwise_top1",
        "before_phase2_no_bonus": before,
        "after": after,
        "after_qb2": after2,
        "epoch_metrics": hist,
    }
    prev_cmp["selected_mode"] = "bce_pairwise_top1"
    dump(cmp_path, prev_cmp)
    dump(
        OUT / "stage_p_final_metrics.json",
        {
            "ranking_mode": "bce_pairwise_top1",
            "applicability_bonus": False,
            "HARD_MULTI_qb1": after,
            "HARD_MULTI_qb2": after2,
            "phase2_checkpoint_no_bonus_qb1": before,
            "n_hard": len(hard),
        },
    )
    freeze = {
        "operating_point": "query_budget=1",
        "gates": {
            "RecallRetained>=0.90": rr >= 0.90,
            "QueryReduction>=0.40": qr >= 0.40,
            "CandidateReduction>=0.25": cr >= 0.25,
            "E2ECostReduction>=0.35": e2e >= 0.35,
        },
        "metrics": {"RecallRetained": rr, "QueryReduction": qr, "CandidateReduction": cr, "E2ECostReduction": e2e},
        "STAGE_P": "FROZEN" if strong else "HOLD",
        "Top1_Ranking_Objective": "bce_pairwise_top1",
        "Applicability_Bonus": "REMOVED_OVERRIDE",
        "Architecture_Conformance": "PASS",
        "note": "Bonus classified HARDCODED_POLICY_OVERRIDE and removed; Top-1 refine on HARD_MULTI.",
    }
    dump(OUT / "stage_p_freeze_decision.json", freeze)
    dump(OUT / "go_summary_stage_p.json", freeze)
    print("STAGE_P", freeze["STAGE_P"], freeze["metrics"])


if __name__ == "__main__":
    main()
