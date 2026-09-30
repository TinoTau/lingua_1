#!/usr/bin/env python3
"""Stage J recovery: P-only under MODEL2_FEATURE_HASH_V1, then short joint fine-tune.

Does not change architecture. Goal: lift Stage P RecallRetained toward >=0.95 gate.
"""

from __future__ import annotations

import json
import random
import sys
import time
from pathlib import Path

import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset, WeightedRandomSampler

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from training.model2.retrieval.spike_retriever import ProfileRetrievalConfig
from training.model2.training.dataset import load_candidate_index
from training.model2_v3.policy.feature_hash_v1 import MODEL2_FEATURE_HASH_VERSION
from training.model2_v3.policy.model import RetrievalPolicyV3, pack_batch_inputs
from training.model2_v3.policy.ranking_loss import action_objective
from training.model2_v3.scripts.run_v3_stage_j_unified_training import (
    FEATURE_HASH,
    build_unified_rows,
    cost_pair,
    dump,
    load_jsonl,
    row_state_j,
    run_p_row,
    summarize,
    train_stage_j,
    DATA_P,
    DATA_D,
    OUT,
    IDX,
    IDX_META,
)

CKPT_OUT = OUT / "training/stage_j_checkpoint.pt"


def train_p_only(rows, *, epochs: int, device) -> RetrievalPolicyV3:
    train = [r for r in rows if r["split"] == "train" and r.get("task_p") and r["case_family"] in ("P_ONLY", "NEUTRAL")]
    spans, profiles, states, y_act, y_qb, weights = [], [], [], [], [], []
    for r in train:
        spans.append(r["span"]["span_syllables"])
        profiles.append(r.get("profile_phonetic") or {})
        states.append(row_state_j(r))
        y_act.append(torch.tensor(r["label_actions"], dtype=torch.float32))
        y_qb.append(int(r.get("label_query_budget_class") or 1))
        w = 4.0 if r.get("is_hard_multi") else 1.0
        if r["case_family"] == "NEUTRAL":
            w *= 2.0
        weights.append(w)
    X = pack_batch_inputs(spans, profiles, states, feature_hash=FEATURE_HASH)
    Ya = torch.stack(y_act)
    Yq = torch.tensor(y_qb, dtype=torch.long)
    ds = TensorDataset(X[0], X[1], X[2], X[3], Ya, Yq, torch.tensor(weights))
    sampler = WeightedRandomSampler(weights, num_samples=len(weights), replacement=True)
    loader = DataLoader(ds, batch_size=64, sampler=sampler)
    model = RetrievalPolicyV3(with_domain_head=True).to(device)
    opt = torch.optim.Adam(model.parameters(), lr=1e-3)
    pos = Ya.sum(dim=0).clamp(min=1)
    neg = (Ya.shape[0] - pos).clamp(min=1)
    bce = nn.BCEWithLogitsLoss(pos_weight=(neg / pos).clamp(1.0, 20.0).to(device))
    ce = nn.CrossEntropyLoss()
    for ep in range(epochs):
        model.train()
        tot = 0.0
        n = 0
        for a, b, c, d, ya, yq, _w in loader:
            a, b, c, d, ya, yq = [t.to(device) for t in (a, b, c, d, ya, yq)]
            opt.zero_grad()
            out = model(a, b, c, d)
            loss = action_objective(out["action_logits"], ya, mode="bce_pairwise", bce=bce) + 0.35 * ce(
                out["query_budget_logits"], yq
            )
            loss.backward()
            opt.step()
            tot += float(loss.item())
            n += 1
        print(f"p-only epoch {ep+1}/{epochs} loss={tot/max(1,n):.4f}", flush=True)
    return model


def eval_p(model, unified, index, cfg, device):
    hard = [
        r
        for r in unified
        if r.get("case_family") == "P_ONLY"
        and r.get("is_hard_multi")
        and (r.get("teacher") or {}).get("any_recover")
        and r.get("variant")
        in ("CORRECT_MULTI", "HIGH_CARD_10", "HIGH_CARD_20", "HIGH_CARD_50", "WEAK_STRONG", "CORRECT")
    ]
    hard_eval = [r for r in hard if r["split"] in ("test", "val")] or hard[:120]
    b1s = [run_p_row(index, r, mode="B1", model=None, qb=None, cfg=cfg, device=device) for r in hard_eval]
    v3s = [run_p_row(index, r, mode="V3", model=model, qb=1, cfg=cfg, device=device) for r in hard_eval]
    return cost_pair(summarize(b1s), summarize(v3s)), len(hard_eval)


def main():
    random.seed(20260817)
    torch.manual_seed(20260817)
    device = torch.device("cpu")
    OUT.mkdir(parents=True, exist_ok=True)
    print("build rows", flush=True)
    rows_p = load_jsonl(DATA_P / "rows.jsonl")
    rows_d = load_jsonl(DATA_D / "rows.jsonl")
    unified = build_unified_rows(rows_p, rows_d, seed=20260817, max_p_train=12000)
    index = load_candidate_index(IDX, IDX_META)
    cfg = ProfileRetrievalConfig(
        max_total_profile_candidates=8,
        max_new_candidates_per_query=8,
        max_generated_phonetic_queries=1,
    )
    print("phase1 P-only V1", flush=True)
    model = train_p_only(unified, epochs=8, device=device)
    m1, n = eval_p(model, unified, index, cfg, device)
    print("after P-only RR=", m1["RecallRetained"], "n=", n, flush=True)
    dump(OUT / "stage_j_p_only_v1_recovery.json", {"metrics": m1, "n": n})

    print("phase2 short joint", flush=True)
    # Continue joint from this model
    torch.save({"state_dict": model.state_dict(), "phase": "p_only_v1"}, OUT / "training/stage_j_p_only_v1.pt")
    model2, meta = train_stage_j(unified, epochs=4, device=device, init_ckpt=OUT / "training/stage_j_p_only_v1.pt")
    m2, n2 = eval_p(model2, unified, index, cfg, device)
    print("after joint RR=", m2["RecallRetained"], flush=True)
    torch.save(
        {
            "state_dict": model2.state_dict(),
            "meta": meta,
            "feature_hash": MODEL2_FEATURE_HASH_VERSION,
            "with_domain_head": True,
            "recovery": True,
        },
        CKPT_OUT,
    )
    dump(
        OUT / "stage_j_p_regression.json",
        {
            **m2,
            "n_hard": n2,
            "frozen_baseline": {
                "RecallRetained": 1.0,
                "QueryReduction": 0.5172,
                "CandidateReduction": 0.3666,
                "E2ECostReduction": 0.4697,
            },
            "PASS": m2["RecallRetained"] >= 0.95 and m2["QueryReduction"] > 0,
            "p_only_v1_prior": m1,
        },
    )


if __name__ == "__main__":
    main()
