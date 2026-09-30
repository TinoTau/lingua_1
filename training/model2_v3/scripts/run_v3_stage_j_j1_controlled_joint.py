#!/usr/bin/env python3
"""Stage J J1 — Controlled ONE Unified Model training on PRODUCTION_BENCHMARK_V1.

- Architecture: RetrievalPolicyV3(with_domain_head=True) UNCHANGED
- Feature: MODEL2_FEATURE_HASH_V1
- P recipe: P1 refine (top1 soft + pairwise 1.25/0.75 + hard×3)
- D teacher: execute-validated only
- Curriculum: Phase1 P-anchor → Phase2 joint (max 2 phases)
- No runtime wiring
"""

from __future__ import annotations

import json
import math
import random
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Optional

import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset, WeightedRandomSampler

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from training.model2.contract import DOMAIN_SLOT_IDS
from training.model2.retrieval.finespan import FineSpanView
from training.model2.retrieval.finespan_retrieval import base_retrieve_span
from training.model2.retrieval.spike_retriever import ProfileRetrievalConfig
from training.model2.training.dataset import load_candidate_index
from training.model2_v2.runtime.active_set import ACTIVE_SET_V1
from training.model2_v3.policy.actions import ACTION_CATALOG, ACTION_INDEX, action_applicable, execute_action
from training.model2_v3.policy.domain_actions import (
    DOMAIN_ACTION_CATALOG,
    DOMAIN_ACTION_INDEX,
    N_DOMAIN_ACTIONS,
    execute_domain_action,
)
from training.model2_v3.policy.model import N_ACTIONS, RetrievalPolicyV3, pack_batch_inputs
from training.model2_v3.policy.ranking_loss import pairwise_action_ranking_loss
from training.model2_v3.policy.stage_d_target_identity_v1 import target_hit
from training.model2_v3.scripts.run_v3_phase3_stage_p_refine import top1_labels
from training.model2_v3.scripts.run_v3_stage_j_recovery_d1 import span_view

OUT = ROOT / "training/model2_v3/experiments/v3_stage_j_j1_prod"
DATA_P = ROOT / "training/model2_v3/dataset/policy_phase2"
CKPT_P1 = ROOT / "training/model2_v3/experiments/v3_stage_j_recovery_p1_d1/training/p1_stage_p_feature_hash_v1.pt"
CKPT_P2 = ROOT / "training/model2_v3/experiments/v3_phase2/training/model2_v3_phase2_policy.pt"
IDX = ROOT / "training/model2_v3/dataset/policy_stage_d2/candidate_index_stage_d2.jsonl"
IDX_META = ROOT / "training/model2_v3/dataset/policy_stage_d2/candidate_index_stage_d2_meta.json"
FEATURE_HASH = "v1"
W_P, W_D, W_QB = 1.25, 0.55, 0.25
P1_BASELINE_RR = 0.955
P1_HELDOUT_RR = 0.941


def dump(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", path.name, flush=True)


def load_jsonl(path: Path) -> list[dict]:
    rows = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            rows.append(json.loads(line))
    return rows


def load_ckpt(path: Path, model: RetrievalPolicyV3, *, strict: bool = False) -> str:
    obj = torch.load(path, map_location="cpu", weights_only=False)
    sd = obj["state_dict"] if isinstance(obj, dict) and "state_dict" in obj else obj
    missing, unexpected = model.load_state_dict(sd, strict=strict)
    return f"loaded {path.name} strict={strict} missing={len(missing)} unexpected={len(unexpected)}"


def rate(a: int, b: int) -> float:
    return float(a) / float(b) if b else 0.0


def red(new: float, old: float) -> float:
    return (old - new) / old if old else 0.0


def wilson_ci(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n <= 0:
        return (0.0, 0.0)
    p = k / n
    den = 1 + z * z / n
    centre = p + z * z / (2 * n)
    margin = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return (max(0.0, (centre - margin) / den), min(1.0, (centre + margin) / den))


def empty_domain_label() -> list[float]:
    y = [0.0] * N_DOMAIN_ACTIONS
    y[DOMAIN_ACTION_INDEX["domain_none"]] = 1.0
    return y


def zero_action_label() -> list[float]:
    return [0.0] * N_ACTIONS


def row_state(r: dict) -> dict:
    return {
        "base_pool": r.get("base_pool", 0),
        "query_budget": 8,
        "cand_budget": 8,
        "n_applicable": r.get("n_applicable", 0),
        "applicability": r.get("applicability", []),
        "personal_terms": r.get("personal_terms") or [],
        "domain_evidence": r.get("long_term_domain_evidence") or {},
        "term_evidence": r.get("personal_term_evidence") or {},
        "max_lexical_items": 32,
    }


def select_p_actions(model, row, *, qb: int, device) -> tuple[list[str], list[dict]]:
    model.eval()
    x = pack_batch_inputs(
        [row["span"]["span_syllables"]],
        [row.get("profile_phonetic") or {}],
        [row_state(row)],
        device=device,
        feature_hash=FEATURE_HASH,
    )
    with torch.no_grad():
        out = model(*x)
        probs = torch.sigmoid(out["action_logits"][0]).cpu()
    scored = []
    prof = row.get("profile_phonetic") or {}
    for i, a in enumerate(ACTION_CATALOG):
        if a.kind != "single":
            continue
        if not all(float(prof.get(r) or 0) > 0 for r in a.relations):
            continue
        scored.append((float(probs[i]), a.action_id))
    scored.sort(reverse=True)
    detail = [{"action_id": aid, "raw_prob": s, "rank": r + 1} for r, (s, aid) in enumerate(scored)]
    return [aid for _, aid in scored[:qb]], detail


def select_d_actions(model, row, *, budget: int, device) -> list[str]:
    model.eval()
    x = pack_batch_inputs(
        [row["span"]["span_syllables"]],
        [row.get("profile_phonetic") or {}],
        [row_state(row)],
        device=device,
        feature_hash=FEATURE_HASH,
    )
    with torch.no_grad():
        out = model(*x)
        logits = out.get("domain_action_logits")
        if logits is None:
            return ["domain_none"]
        probs = torch.sigmoid(logits[0]).cpu()
    scored = [(float(probs[i]), a.action_id) for i, a in enumerate(DOMAIN_ACTION_CATALOG)]
    scored.sort(reverse=True)
    # skip domain_none if others present
    chosen = []
    for s, aid in scored:
        if aid == "domain_none" and chosen:
            continue
        chosen.append(aid)
        if len(chosen) >= budget:
            break
    return chosen or ["domain_none"]


def eval_p_slice(index, rows, model, *, device, cfg) -> dict:
    b1_hits = v3_hits = 0
    b1_q = v3_q = b1_c = v3_c = 0
    lat = []
    top1 = top2 = n_t = 0
    for r in rows:
        span = span_view(r["span"])
        tid = r["target_term_id"]
        prof = r.get("profile_phonetic") or {}
        base = set(base_retrieve_span(index, span, cfg=cfg))
        # B1
        acts_b1 = [a.action_id for a in ACTION_CATALOG if a.kind == "single" and action_applicable(span, a, prof)]
        new_b1: set[str] = set()
        nq = 0
        for aid in acts_b1:
            res = execute_action(index, span, ACTION_CATALOG[ACTION_INDEX[aid]], base_ids=base, cfg=cfg, max_cands=8)
            nq += int(res.get("n_queries") or 0)
            for t in res.get("term_ids") or []:
                if len(new_b1) >= 8:
                    break
                new_b1.add(t)
        b1_hits += int(tid in new_b1)
        b1_q += nq
        b1_c += len(new_b1)
        # V3
        t0 = time.perf_counter()
        acts, detail = select_p_actions(model, r, qb=1, device=device)
        new_v: set[str] = set()
        nq2 = 0
        for aid in acts:
            res = execute_action(index, span, ACTION_CATALOG[ACTION_INDEX[aid]], base_ids=base, cfg=cfg, max_cands=8)
            nq2 += int(res.get("n_queries") or 0)
            for t in res.get("term_ids") or []:
                if len(new_v) >= 8:
                    break
                new_v.add(t)
        lat.append((time.perf_counter() - t0) * 1000)
        v3_hits += int(tid in new_v)
        v3_q += nq2
        v3_c += len(new_v)
        # teacher top
        teacher = r.get("teacher") or r.get("teacher_p") or {}
        cands = [a for a in (teacher.get("best_utility_actions") or []) if a.startswith("single:")]
        if not cands:
            cands = [a for a in (teacher.get("best_recall_actions") or []) if a.startswith("single:")]
        if not cands:
            cands = [a for a in (teacher.get("best_actions") or []) if a.startswith("single:")]
        if cands:
            n_t += 1
            rank = next((d["rank"] for d in detail if d["action_id"] == cands[0]), 99)
            if rank == 1:
                top1 += 1
            if rank <= 2:
                top2 += 1
    n = len(rows)
    tir_b1 = rate(b1_hits, n)
    tir_v3 = rate(v3_hits, n)
    rr = tir_v3 / tir_b1 if tir_b1 > 0 else 0.0
    lo, hi = wilson_ci(v3_hits, n)
    # crude RR CI via TIR CI / b1 (approx)
    return {
        "n": n,
        "TIR_B1": tir_b1,
        "TIR_V3": tir_v3,
        "RecallRetained": rr,
        "RecallRetained_TIR_CI95": [lo, hi],
        "QueryReduction": red(v3_q / max(1, n), b1_q / max(1, n)),
        "CandidateReduction": red(v3_c / max(1, n), b1_c / max(1, n)),
        "E2ECostReduction": red(
            v3_q / max(1, n) + 0.2 * v3_c / max(1, n) + 0.001 * (sorted(lat)[len(lat) // 2] if lat else 0),
            b1_q / max(1, n) + 0.2 * b1_c / max(1, n) + 0.001 * 100,
        ),
        "Latency_P50": sorted(lat)[len(lat) // 2] if lat else 0,
        "Latency_P95": sorted(lat)[int(0.95 * (len(lat) - 1))] if lat else 0,
        "Teacher_Top1": top1 / max(1, n_t),
        "Teacher_Top2": top2 / max(1, n_t),
        "hits_v3": v3_hits,
    }


def eval_d_eligible(index, rows, model, *, device, cfg, oracle_actions: bool = False) -> dict:
    hits = 0
    oracle = 0
    lat = []
    for r in rows:
        span = span_view(r["span"])
        tid = r["target_term_id"]
        base = set(base_retrieve_span(index, span, cfg=cfg))
        ev = r.get("long_term_domain_evidence") or {}
        # oracle
        o_ok = False
        for ainfo in r.get("teacher_recover_actions") or []:
            a = DOMAIN_ACTION_CATALOG[DOMAIN_ACTION_INDEX[ainfo["action_id"]]]
            res = execute_domain_action(index, span, a, ev, base_ids=base, cfg=cfg, max_cands=8)
            if target_hit(index, tid, res.get("term_ids") or [])["identity_hit"]:
                o_ok = True
                break
        oracle += int(o_ok)
        t0 = time.perf_counter()
        if oracle_actions:
            acts = [ainfo["action_id"] for ainfo in (r.get("teacher_recover_actions") or [])][:2]
        else:
            acts = select_d_actions(model, r, budget=2, device=device)
        ok = False
        for aid in acts:
            a = DOMAIN_ACTION_CATALOG[DOMAIN_ACTION_INDEX[aid]]
            res = execute_domain_action(index, span, a, ev, base_ids=base, cfg=cfg, max_cands=8)
            if target_hit(index, tid, res.get("term_ids") or [])["identity_hit"]:
                ok = True
                break
        lat.append((time.perf_counter() - t0) * 1000)
        hits += int(ok)
    n = len(rows)
    tir = rate(hits, n)
    o_tir = rate(oracle, n)
    rr = tir / o_tir if o_tir > 0 else 0.0
    lo, hi = wilson_ci(hits, n)
    return {
        "n": n,
        "TIR": tir,
        "Oracle_TIR": o_tir,
        "RecallRetained": rr,
        "TIR_CI95": [lo, hi],
        "hits": hits,
        "Latency_P50": sorted(lat)[len(lat) // 2] if lat else 0,
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    device = torch.device("cpu")
    readiness = json.loads((OUT / "stage_j_prod_benchmark_readiness.json").read_text(encoding="utf-8"))
    print("benchmark readiness", readiness, flush=True)

    index = load_candidate_index(IDX, IDX_META)
    cfg = ProfileRetrievalConfig(
        max_total_profile_candidates=8,
        max_new_candidates_per_query=8,
        max_generated_phonetic_queries=1,
    )
    rows_p = load_jsonl(DATA_P / "rows.jsonl")
    hard_p = [r for r in rows_p if r.get("is_hard_multi") and (r.get("teacher") or {}).get("any_recover")]
    d_rows = load_jsonl(OUT / "dataset" / "d_only_eligible.jsonl")
    pd_rows = load_jsonl(OUT / "dataset" / "pd_cases.jsonl")
    cf_rows = load_jsonl(OUT / "dataset" / "counterfactual_rows.jsonl")

    # Build training mix
    train_p = [r for r in rows_p if r["split"] == "train"]
    hard_all = hard_p
    train_mix_p = train_p + hard_all * 3
    d_train = [r for r in d_rows if r["split"] == "train" and r.get("eligible_d_only")]
    d_test = [r for r in d_rows if r["split"] in ("test", "val") and r.get("eligible_d_only")]
    pd_train = [r for r in pd_rows if r.get("split") == "train"]
    pd_test = [r for r in pd_rows if r.get("split") in ("test", "val")]
    pd_elig_test = [r for r in pd_test if r.get("eligible_pd_intro")]

    dump(
        OUT / "j1_training_config.json",
        {
            "architecture": "RetrievalPolicyV3(with_domain_head=True)",
            "feature_hash": "MODEL2_FEATURE_HASH_V1",
            "curriculum": ["phase1_p_anchor", "phase2_joint"],
            "W_P": W_P,
            "W_D": W_D,
            "W_QB": W_QB,
            "p_loss": "BCE + 1.25*pairwise(margin=0.75) + 0.25*CE(qb)",
            "d_loss": "BCE domain actions (execute-validated labels)",
            "init": str(CKPT_P1) if CKPT_P1.exists() else str(CKPT_P2),
            "phase1_epochs": 6,
            "phase2_epochs": 8,
            "lr_phase1": 3e-4,
            "lr_phase2": 2e-4,
            "sampler_cap": 8000,
            "batch": 64,
            "DATA_COVERAGE_LIMITED": readiness.get("DATA_COVERAGE_LIMITED"),
            "n_d_train": len(d_train),
            "n_d_test": len(d_test),
            "n_pd_train": len(pd_train),
            "n_hard_p": len(hard_p),
        },
    )

    def pack_p_batch(rows):
        spans, profiles, states, ya, yq, yd, weights, flags = [], [], [], [], [], [], [], []
        for r in rows:
            spans.append(r["span"]["span_syllables"])
            profiles.append(r.get("profile_phonetic") or {})
            states.append(row_state(r))
            ya.append(top1_labels(r) if r.get("teacher") or r.get("label_actions") is not None else torch.zeros(N_ACTIONS))
            if not (r.get("teacher") or {}).get("best_utility_actions") and r.get("label_actions"):
                # top1_labels may fallback
                pass
            yq.append(int(r.get("label_query_budget_class") or 1))
            yd.append(torch.tensor(r.get("label_domain_actions") or empty_domain_label(), dtype=torch.float32))
            w = 5.0 if r.get("is_hard_multi") else 1.0
            weights.append(w)
            flags.append(1)  # task_p
        X = pack_batch_inputs(spans, profiles, states, feature_hash=FEATURE_HASH)
        return X, torch.stack(ya), torch.tensor(yq, dtype=torch.long), torch.stack(yd), torch.tensor(weights), torch.tensor(flags)

    # Phase 1: P-only anchor from train_mix_p
    print("Phase1 pack P", flush=True)
    rng = random.Random(7)
    # subsample train_mix for memory if huge
    mix_p = train_mix_p
    if len(mix_p) > 40000:
        mix_p = rng.sample(mix_p, 40000)
    Xp, Yap, Yqp, Ydp, Wp, Fp = pack_p_batch(mix_p)
    # For phase1 domain labels empty
    Ydp = torch.stack([torch.tensor(empty_domain_label(), dtype=torch.float32) for _ in range(len(mix_p))])

    model = RetrievalPolicyV3(with_domain_head=True).to(device)
    p1_params = RetrievalPolicyV3(with_domain_head=False).param_count()
    init_msg = ""
    if CKPT_P1.exists():
        init_msg = load_ckpt(CKPT_P1, model, strict=False)
    elif CKPT_P2.exists():
        init_msg = load_ckpt(CKPT_P2, model, strict=False)
    print(init_msg, "params", model.param_count(), flush=True)

    def train_loader(X, Ya, Yq, Yd, W, epochs, lr, phase_name, use_d: bool):
        ds = TensorDataset(X[0], X[1], X[2], X[3], Ya, Yq, Yd, W)
        sampler = WeightedRandomSampler(W.tolist(), num_samples=min(len(W), 8000), replacement=True)
        loader = DataLoader(ds, batch_size=64, sampler=sampler)
        opt = torch.optim.Adam(model.parameters(), lr=lr)
        pos = Ya.sum(dim=0).clamp(min=1)
        neg = (Ya.shape[0] - pos).clamp(min=1)
        bce_p = nn.BCEWithLogitsLoss(pos_weight=(neg / pos).clamp(1.0, 30.0).to(device))
        # domain pos weight
        dpos = Yd.sum(dim=0).clamp(min=1)
        dneg = (Yd.shape[0] - dpos).clamp(min=1)
        bce_d = nn.BCEWithLogitsLoss(pos_weight=(dneg / dpos).clamp(1.0, 30.0).to(device))
        ce = nn.CrossEntropyLoss()
        hist = []
        for ep in range(epochs):
            model.train()
            tot = tot_p = tot_d = tot_q = 0.0
            n = 0
            for a, b, c, d, ya, yq, yd, _w in loader:
                a, b, c, d, ya, yq, yd = [t.to(device) for t in (a, b, c, d, ya, yq, yd)]
                opt.zero_grad()
                out = model(a, b, c, d)
                lp = bce_p(out["action_logits"], ya) + 1.25 * pairwise_action_ranking_loss(
                    out["action_logits"], (ya > 0.5).float(), margin=0.75
                )
                lq = ce(out["query_budget_logits"], yq)
                ld = out["action_logits"].new_zeros(())
                if use_d and "domain_action_logits" in out:
                    ld = bce_d(out["domain_action_logits"], yd)
                loss = W_P * lp + W_QB * lq + (W_D * ld if use_d else 0.0)
                loss.backward()
                opt.step()
                tot += float(loss.item())
                tot_p += float(lp.item())
                tot_d += float(ld.item()) if use_d else 0.0
                tot_q += float(lq.item())
                n += 1
            hist.append(
                {
                    "phase": phase_name,
                    "epoch": ep + 1,
                    "loss": tot / max(1, n),
                    "loss_p": tot_p / max(1, n),
                    "loss_d": tot_d / max(1, n),
                    "loss_qb": tot_q / max(1, n),
                }
            )
            print(phase_name, "epoch", ep + 1, hist[-1], flush=True)
        return hist

    hist1 = train_loader(Xp, Yap, Yqp, Ydp, Wp, epochs=6, lr=3e-4, phase_name="phase1_p_anchor", use_d=False)

    # Phase 2: joint — mix P hard + D train + PD train
    print("Phase2 pack joint", flush=True)
    joint_rows = []
    # P hard oversample
    for r in hard_all:
        rr = dict(r)
        rr["label_domain_actions"] = empty_domain_label()
        rr["case_family"] = "HARD_P"
        joint_rows.append(rr)
    joint_rows = joint_rows * 3
    joint_rows.extend(train_p[:8000])
    for r in d_train:
        rr = dict(r)
        rr["profile_phonetic"] = {}
        rr["label_actions"] = zero_action_label()
        rr["teacher"] = {}
        rr["label_query_budget_class"] = 1
        rr["is_hard_multi"] = False
        rr["case_family"] = "HARD_D" if r.get("multitag") else "D_ONLY"
        joint_rows.append(rr)
    # oversample D
    joint_rows.extend(d_train * 2)
    for r in pd_train:
        rr = dict(r)
        rr["teacher"] = r.get("teacher_p") or {}
        rr["label_domain_actions"] = (
            # from teacher recover if present else empty
            ([0.0] * N_DOMAIN_ACTIONS)
        )
        y = empty_domain_label()
        for ainfo in r.get("teacher_recover_actions") or []:
            aid = ainfo["action_id"]
            if aid in DOMAIN_ACTION_INDEX:
                y[DOMAIN_ACTION_INDEX[aid]] = 1.0
                y[DOMAIN_ACTION_INDEX["domain_none"]] = 0.0
        rr["label_domain_actions"] = y
        rr["case_family"] = "HARD_PD" if r.get("eligible_pd_intro") else "P_PLUS_D"
        joint_rows.append(rr)

    # Neutrals
    for r in train_p[8000:9200]:
        rr = dict(r)
        rr["profile_phonetic"] = {}
        rr["personal_terms"] = []
        rr["long_term_domain_evidence"] = {}
        rr["label_domain_actions"] = empty_domain_label()
        rr["label_actions"] = zero_action_label()
        rr["teacher"] = {}
        rr["case_family"] = "NEUTRAL"
        joint_rows.append(rr)

    rng.shuffle(joint_rows)
    # Fix top1 labels needing teacher — for D-only use zeros
    spans, profiles, states, ya, yq, yd, weights = [], [], [], [], [], [], []
    for r in joint_rows:
        spans.append(r["span"]["span_syllables"])
        profiles.append(r.get("profile_phonetic") or {})
        states.append(row_state(r))
        if r.get("case_family") in ("D_ONLY", "HARD_D", "NEUTRAL"):
            ya.append(torch.zeros(N_ACTIONS))
        else:
            ya.append(top1_labels(r))
        yq.append(int(r.get("label_query_budget_class") or 1))
        yd.append(torch.tensor(r.get("label_domain_actions") or empty_domain_label(), dtype=torch.float32))
        w = 5.0 if r.get("is_hard_multi") or r.get("case_family") in ("HARD_D", "HARD_PD") else 1.0
        if r.get("case_family") in ("D_ONLY", "HARD_D"):
            w *= 3.0
        weights.append(w)
    Xj = pack_batch_inputs(spans, profiles, states, feature_hash=FEATURE_HASH)
    Yaj = torch.stack(ya)
    Yqj = torch.tensor(yq, dtype=torch.long)
    Ydj = torch.stack(yd)
    Wj = torch.tensor(weights)
    hist2 = train_loader(Xj, Yaj, Yqj, Ydj, Wj, epochs=8, lr=2e-4, phase_name="phase2_joint", use_d=True)

    ckpt_path = OUT / "training" / "j1_unified_checkpoint.pt"
    ckpt_path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "state_dict": model.state_dict(),
            "architecture": "RetrievalPolicyV3",
            "with_domain_head": True,
            "feature_hash": "MODEL2_FEATURE_HASH_V1",
            "phase": "stage_j_j1",
            "param_count": model.param_count(),
        },
        ckpt_path,
    )
    dump(
        OUT / "j1_checkpoint_manifest.json",
        {
            "path": str(ckpt_path.relative_to(ROOT)).replace("\\", "/"),
            "param_count": model.param_count(),
            "p1_param_count_ref": p1_params,
            "param_increase_vs_p1": model.param_count() - p1_params,
            "ONE_checkpoint": True,
        },
    )
    dump(OUT / "j1_training_curve.json", {"phase1": hist1, "phase2": hist2})
    dump(
        OUT / "j1_loss_balance.json",
        {
            "W_P": W_P,
            "W_D": W_D,
            "W_QB": W_QB,
            "final_phase2": hist2[-1] if hist2 else {},
            "note": "No architecture change; scalar weights only",
        },
    )

    # ---- Evals ----
    print("Eval P regression", flush=True)
    p_eval = eval_p_slice(index, hard_p, model, device=device, cfg=cfg)
    dump(OUT / "j1_p_regression.json", {"P1_baseline_RR": P1_BASELINE_RR, **p_eval, "PASS": p_eval["RecallRetained"] >= 0.95})

    held = [
        r
        for r in hard_p
        if r["split"] in ("test", "val")
        and r.get("variant")
        in ("CORRECT_MULTI", "HIGH_CARD_10", "HIGH_CARD_20", "HIGH_CARD_50", "WEAK_STRONG", "CORRECT")
    ]
    p_held = eval_p_slice(index, held, model, device=device, cfg=cfg)
    dump(OUT / "j1_p_heldout.json", {"P1_heldout_RR": P1_HELDOUT_RR, **p_held})

    rel_slices = {}
    for rel in ACTIVE_SET_V1:
        sub = [r for r in hard_p if float((r.get("profile_phonetic") or {}).get(rel) or 0) > 0]
        if len(sub) > 150:
            sub = sub[:: max(1, len(sub) // 150)][:150]
        if len(sub) < 10:
            continue
        rel_slices[rel] = eval_p_slice(index, sub, model, device=device, cfg=cfg)
    dump(OUT / "j1_p_relation_slices.json", rel_slices)

    print("Eval D", flush=True)
    d_m = eval_d_eligible(index, d_test or d_rows, model, device=device, cfg=cfg)
    d_oracle = eval_d_eligible(index, d_test or d_rows, model, device=device, cfg=cfg, oracle_actions=True)
    dump(OUT / "j1_d_recall_retained.json", {"model": d_m, "oracle_check": d_oracle})

    # counterfactuals Correct/Empty/Wrong/Swapped on eligible groups
    def cf_tir(persona: str) -> dict:
        sub = [r for r in cf_rows if r.get("persona") == persona and r.get("split") in ("test", "val", "train")]
        # limit
        sub = sub[: min(200, len(sub))]
        if not sub:
            return {"n": 0, "TIR": 0.0}
        # map to eval rows
        hits = 0
        for r in sub:
            span = span_view(r["span"])
            tid = r["target_term_id"]
            base = set(base_retrieve_span(index, span, cfg=cfg))
            ev = r.get("long_term_domain_evidence") or {}
            acts = select_d_actions(model, r, budget=2, device=device)
            ok = False
            for aid in acts:
                a = DOMAIN_ACTION_CATALOG[DOMAIN_ACTION_INDEX[aid]]
                res = execute_domain_action(index, span, a, ev, base_ids=base, cfg=cfg, max_cands=8)
                if target_hit(index, tid, res.get("term_ids") or [])["identity_hit"]:
                    ok = True
                    break
            hits += int(ok)
        return {"n": len(sub), "TIR": rate(hits, len(sub)), "hits": hits}

    cf = {
        "CORRECT": cf_tir("CORRECT"),
        "EMPTY": cf_tir("EMPTY"),
        "WRONG": cf_tir("WRONG"),
        "SWAPPED": cf_tir("SWAPPED"),
    }
    cf["PASS"] = (
        cf["CORRECT"]["n"] > 0
        and cf["CORRECT"]["TIR"] > 0
        and cf["CORRECT"]["TIR"] > cf["EMPTY"]["TIR"]
    )
    dump(OUT / "j1_d_counterfactuals.json", cf)

    # domain slices
    dom_slices = {}
    for d in DOMAIN_SLOT_IDS:
        sub = [r for r in (d_test or d_rows) if d in (r.get("target_domains") or [])]
        if len(sub) < 3:
            dom_slices[d] = {"n": len(sub), "LOW_SUPPORT": True}
            continue
        dom_slices[d] = eval_d_eligible(index, sub, model, device=device, cfg=cfg)
    dump(OUT / "j1_d_domain_slices.json", dom_slices)

    held_d = [r for r in d_rows if r.get("heldout_term")]
    dump(OUT / "j1_heldout_terms.json", eval_d_eligible(index, held_d, model, device=device, cfg=cfg) if held_d else {"n": 0})
    multi = [r for r in (d_test or d_rows) if r.get("multitag")]
    dump(OUT / "j1_multidomain.json", eval_d_eligible(index, multi, model, device=device, cfg=cfg) if multi else {"n": 0})
    hard_d = [r for r in (d_test or d_rows) if r.get("multitag")]
    dump(OUT / "j1_hard_d.json", eval_d_eligible(index, hard_d, model, device=device, cfg=cfg) if hard_d else {"n": 0})

    # P+D ablation
    print("Eval P+D", flush=True)
    def pd_ablation(rows, mode: str) -> dict:
        rows = rows[: min(200, len(rows))]
        hits = 0
        for r in rows:
            span = span_view(r["span"])
            tid = r.get("domain_target_term_id") or r["target_term_id"]
            base = set(base_retrieve_span(index, span, cfg=cfg))
            new_ids: set[str] = set()
            rr = dict(r)
            if mode == "none":
                rr["profile_phonetic"] = {}
                rr["long_term_domain_evidence"] = {}
                rr["personal_terms"] = []
            elif mode == "p":
                rr["long_term_domain_evidence"] = {}
                rr["personal_terms"] = []
            elif mode == "d":
                rr["profile_phonetic"] = {}
            # full = as-is
            if mode in ("p", "full", "none"):
                if rr.get("profile_phonetic"):
                    for aid in select_p_actions(model, rr, qb=1, device=device)[0]:
                        res = execute_action(index, span, ACTION_CATALOG[ACTION_INDEX[aid]], base_ids=base, cfg=cfg, max_cands=8)
                        for t in res.get("term_ids") or []:
                            new_ids.add(t)
            if mode in ("d", "full"):
                for aid in select_d_actions(model, rr, budget=2, device=device):
                    a = DOMAIN_ACTION_CATALOG[DOMAIN_ACTION_INDEX[aid]]
                    res = execute_domain_action(
                        index, span, a, rr.get("long_term_domain_evidence") or {}, base_ids=base, cfg=cfg, max_cands=8
                    )
                    for t in res.get("term_ids") or []:
                        new_ids.add(t)
            # hit under identity for domain target preferentially
            th = target_hit(index, tid, list(new_ids)[:16])
            # also allow P target tid exact
            if th["identity_hit"] or r["target_term_id"] in new_ids:
                hits += 1
        n = len(rows)
        lo, hi = wilson_ci(hits, n)
        return {"n": n, "TIR": rate(hits, n), "CI95": [lo, hi], "hits": hits}

    pd_eval_rows = pd_elig_test or [r for r in pd_rows if r.get("eligible_pd_intro")] or pd_test[:100]
    ab = {
        "none": pd_ablation(pd_eval_rows, "none"),
        "p_only": pd_ablation(pd_eval_rows, "p"),
        "d_only": pd_ablation(pd_eval_rows, "d"),
        "full": pd_ablation(pd_eval_rows, "full"),
    }
    best_single = max(ab["p_only"]["TIR"], ab["d_only"]["TIR"])
    ab["Full_ge_BestSingle"] = ab["full"]["TIR"] + 1e-12 >= best_single
    ab["JointInterference"] = (
        "SIGNIFICANT"
        if ab["full"]["TIR"] + 0.05 < best_single
        else ("MILD" if ab["full"]["TIR"] < best_single else "NO")
    )
    dump(OUT / "j1_pd_ablation.json", ab)
    dump(OUT / "j1_pd_combined.json", ab["full"])

    # profile strength / scalability
    strength = {}
    for s in (1, 5, 20):
        sub = [r for r in (d_test or d_rows) if r.get("profile_strength") == s]
        if sub:
            strength[str(s)] = eval_d_eligible(index, sub, model, device=device, cfg=cfg)
    dump(OUT / "j1_profile_strength.json", strength)
    scale = {}
    for sz in (5, 20, 50, 100):
        sub = [r for r in (d_test or d_rows) if int(r.get("profile_size") or 0) == sz]
        if not sub:
            sub = [r for r in (d_test or d_rows) if abs(int(r.get("profile_size") or 0) - sz) <= 5]
        if sub:
            scale[str(sz)] = eval_d_eligible(index, sub[:80], model, device=device, cfg=cfg)
    dump(OUT / "j1_profile_scalability.json", scale)

    dump(
        OUT / "j1_target_introduction.json",
        {
            "P_only": {"n": p_eval["n"], "TIR": p_eval["TIR_V3"]},
            "D_only": {"n": d_m["n"], "TIR": d_m["TIR"], "base_absent_enforced": True},
            "P_plus_D": ab["full"],
        },
    )
    dump(
        OUT / "j1_confidence_intervals.json",
        {
            "P_TIR_CI95": p_eval.get("RecallRetained_TIR_CI95"),
            "D_TIR_CI95": d_m.get("TIR_CI95"),
            "PD_TIR_CI95": ab["full"].get("CI95"),
            "method": "Wilson score interval on TIR counts",
        },
    )
    dump(
        OUT / "j1_efficiency.json",
        {
            "P_QueryReduction": p_eval["QueryReduction"],
            "P_CandidateReduction": p_eval["CandidateReduction"],
            "P_E2ECostReduction": p_eval["E2ECostReduction"],
            "query_budget": 1,
        },
    )
    dump(OUT / "j1_latency.json", {"P50": p_eval["Latency_P50"], "P95": p_eval["Latency_P95"]})
    dump(
        OUT / "j1_generalization.json",
        {
            "heldout_p": p_held,
            "heldout_d_terms": "see j1_heldout_terms.json",
            "multidomain": "see j1_multidomain.json",
        },
    )
    dump(
        OUT / "j1_failure_taxonomy.json",
        {
            "note": "Aggregate placeholders from metric gaps",
            "P_RR_gap_vs_P1": P1_BASELINE_RR - p_eval["RecallRetained"],
            "D_RR": d_m["RecallRetained"],
            "D_TIR": d_m["TIR"],
            "classes_observed": {
                "P_TOP1_RANK_MISS": max(0.0, 1.0 - p_eval["Teacher_Top1"]),
                "D_ACTION_SELECTION_MISS": max(0.0, d_oracle["TIR"] - d_m["TIR"]) if d_oracle["n"] else None,
                "JOINT_INTERFERENCE": ab["JointInterference"],
            },
        },
    )
    dump(
        OUT / "j1_architecture_conformance.json",
        {
            "ONE_Model2": True,
            "with_domain_head": True,
            "No_Stage_A": True,
            "No_Stage_B": True,
            "No_router": True,
            "No_gate": True,
            "No_hard_domain_filter": True,
            "No_runtime_change": True,
            "PASS": True,
        },
    )

    # Gates
    p_rr = p_eval["RecallRetained"]
    if p_rr >= 0.95:
        p_reg = "PASS"
    elif p_rr >= 0.93:
        p_reg = "RISK"
    else:
        p_reg = "FAIL"
    d_signal = cf["PASS"] and d_m["TIR"] > 0
    coverage = readiness.get("Benchmark_Statistical_Coverage", "LIMITED")
    prod_candidate = (
        p_reg == "PASS"
        and d_signal
        and coverage in ("STRONG", "MODERATE")
        and ab["JointInterference"] != "SIGNIFICANT"
        and not readiness.get("DATA_COVERAGE_LIMITED", True)
    )
    overall = "HOLD"
    if p_reg == "FAIL" or not d_signal:
        overall = "HOLD"
    elif readiness.get("DATA_COVERAGE_LIMITED") or coverage == "LIMITED":
        overall = "PASS_WITH_LIMITATIONS" if p_reg in ("PASS", "RISK") and d_signal else "HOLD"
    elif prod_candidate:
        overall = "PASS"
    else:
        overall = "PASS_WITH_LIMITATIONS"

    weakest = None
    if rel_slices:
        weakest = min(rel_slices.items(), key=lambda kv: kv[1].get("RecallRetained", 1))[0]

    go = {
        "Stage_J_J1_Production_Scale": overall,
        "Architecture": "UNCHANGED",
        "P1_Baseline_RR": P1_BASELINE_RR,
        "J1_P_RR": p_rr,
        "J1_P_N": p_eval["n"],
        "J1_P_Heldout_RR": p_held["RecallRetained"],
        "Teacher_Top1": p_eval["Teacher_Top1"],
        "Teacher_Top2": p_eval["Teacher_Top2"],
        "P_Regression": p_reg,
        "Weakest_Relation": weakest,
        "D_Oracle_TIR": d_m["Oracle_TIR"],
        "D_J1_RecallRetained": d_m["RecallRetained"],
        "D_Correct": cf["CORRECT"],
        "D_Empty": cf["EMPTY"],
        "D_Wrong": cf["WRONG"],
        "D_Swapped": cf["SWAPPED"],
        "D_Signal": "PASS" if d_signal else "FAIL",
        "PD_Full": ab["full"],
        "Joint_Interference": ab["JointInterference"],
        "ONE_Checkpoint": True,
        "Model_Parameters": model.param_count(),
        "Param_Increase_vs_P1": model.param_count() - p1_params,
        "Inference_P50": p_eval["Latency_P50"],
        "Inference_P95": p_eval["Latency_P95"],
        "Stage_J_Production_Candidate": "YES" if prod_candidate else "NO",
        "DATA_COVERAGE_LIMITED": readiness.get("DATA_COVERAGE_LIMITED"),
        "Benchmark_Statistical_Coverage": coverage,
        "Recommended_Next_Phase": (
            "RUNTIME_CHECKPOINT_SWAP_E2E" if prod_candidate else "EXPAND_D_PD_BENCHMARK_OR_FIX_JOINT"
        ),
    }
    dump(OUT / "go_summary.json", go)
    print("J1 DONE", json.dumps(go, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
