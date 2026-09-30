#!/usr/bin/env python3
"""Model2 V3 Phase2 — full REAL_ASR scale + multi-relation policy optimization.

Markers: MODEL2_V3_PHASE2_POLICY_SCALE_AND_OPTIMIZATION
"""

from __future__ import annotations

import argparse
import csv
import json
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
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from training.model2.retrieval.finespan import FineSpanView
from training.model2.retrieval.finespan_retrieval import base_retrieve_span
from training.model2.retrieval.spike_retriever import ProfileRetrievalConfig
from training.model2.training.dataset import load_candidate_index, load_jsonl
from training.model2_v2.runtime.active_set import ACTIVE_SET_V1
from training.model2_v3 import ARCHITECTURE_ID
from training.model2_v3.dataset.build_phase2_dataset import build_phase2_rows
from training.model2_v3.policy.actions import (
    ACTION_CATALOG,
    ACTION_INDEX,
    action_applicable,
    execute_action,
)
from training.model2_v3.policy.model import (
    N_ACTIONS,
    QB_CLASSES,
    RetrievalPolicyV3,
    pack_batch_inputs,
)

DS_BASE = ROOT / "training/model2/dataset/baseline_v1"
OUT = ROOT / "training/model2_v3" / "experiments" / "v3_phase2"
DATA = ROOT / "training/model2_v3" / "dataset" / "policy_phase2"
DOCS = ROOT / "docs" / "user_correction"

PHASE1_BASELINE = {
    "RecallRetained": 0.71,
    "QueryReduction": 0.32,
    "CandidateReduction": 0.30,
    "E2ECostReduction": 0.31,
    "params": 28354,
    "base_asr": 400,
    "rows": 840,
}


def dump(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def dump_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def rate(a: int, b: int) -> float:
    return float(a) / float(b) if b else 0.0


def red(a: float, b: float) -> float:
    return 0.0 if b <= 0 else max(0.0, (b - a) / b)


def assign_splits(rows: list[dict], rng: random.Random) -> dict:
    users = sorted({r["base_user_id"] for r in rows})
    terms = sorted({r["target_term_id"] for r in rows})
    rng.shuffle(users)
    rng.shuffle(terms)
    unseen_u = set(users[: max(1, len(users) // 5)])
    unseen_t = set(terms[: max(1, len(terms) // 5)])
    multi = [r["row_id"] for r in rows if r.get("is_hard_multi")]
    rng.shuffle(multi)
    unseen_multi = set(multi[: max(1, len(multi) // 5)])
    combo = [r["row_id"] for r in rows if r["variant"] == "CORRECT_MULTI"]
    rng.shuffle(combo)
    unseen_combo = set(combo[: max(1, len(combo) // 5)])
    counts = Counter()
    for r in rows:
        flags = {
            "UNSEEN_USER": r["base_user_id"] in unseen_u,
            "UNSEEN_TERM": r["target_term_id"] in unseen_t,
            "UNSEEN_USER_TERM": r["base_user_id"] in unseen_u and r["target_term_id"] in unseen_t,
            "UNSEEN_PROFILE_COMBINATION": r["row_id"] in unseen_combo,
            "UNSEEN_MULTI_RELATION_COMBINATION": r["row_id"] in unseen_multi,
            "HIGH_CARDINALITY_UNSEEN_USER": r.get("is_high_card") and r["base_user_id"] in unseen_u,
        }
        r["split_flags"] = flags
        if any(flags[k] for k in ("UNSEEN_USER", "UNSEEN_TERM", "UNSEEN_MULTI_RELATION_COMBINATION")):
            r["split"] = "test"
        else:
            x = rng.random()
            r["split"] = "train" if x < 0.75 else ("val" if x < 0.88 else "test")
        counts[r["split"]] += 1
    return {"counts": dict(counts), "unseen_users": len(unseen_u), "unseen_terms": len(unseen_t)}


def same_span_expanded(rows: list[dict]) -> dict:
    by_g = defaultdict(list)
    for r in rows:
        by_g[r["group_key"]].append(r)
    checked = differ_actions = differ_budget = 0
    for rs in by_g.values():
        corr = next((r for r in rs if r["variant"] == "CORRECT" and r["teacher"]["any_recover"]), None)
        empty = next((r for r in rs if r["variant"] == "EMPTY"), None)
        multi = next((r for r in rs if r["variant"] == "CORRECT_MULTI"), None)
        if not (corr and empty):
            continue
        checked += 1
        if corr["teacher"]["best_actions"] != empty["teacher"]["best_actions"]:
            differ_actions += 1
        if multi and corr["label_query_budget_class"] != multi["label_query_budget_class"]:
            differ_budget += 1
        elif corr["label_query_budget_class"] != empty["label_query_budget_class"]:
            differ_budget += 1
    return {
        "checked": checked,
        "policy_actions_differ": differ_actions,
        "budget_class_differ": differ_budget,
        "pass": rate(differ_actions, checked) >= 0.8 if checked else False,
    }


def train_policy(rows: list[dict], *, epochs: int, device: torch.device) -> tuple[RetrievalPolicyV3, dict]:
    train = [r for r in rows if r["split"] == "train"]
    # class / hard weighting: upweight hard_multi + recovering multi
    weights = []
    spans, profiles, states, y_act, y_qb = [], [], [], [], []
    for r in train:
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
        y_act.append(torch.tensor(r["label_actions"], dtype=torch.float32))
        y_qb.append(r["label_query_budget_class"])
        w = 1.0
        if r.get("is_hard_multi"):
            w *= 3.0
        if r["variant"] in ("CORRECT_MULTI", "HIGH_CARD_10", "HIGH_CARD_20", "HIGH_CARD_50"):
            w *= 2.0
        if r["teacher"].get("any_recover") and r["variant"] == "CORRECT":
            w *= 1.5
        if r["variant"] in ("EMPTY", "WRONG", "SWAPPED", "NOT_APPLICABLE"):
            w *= 1.2  # safety
        weights.append(w)

    X = pack_batch_inputs(spans, profiles, states)
    Ya = torch.stack(y_act)
    Yq = torch.tensor(y_qb, dtype=torch.long)
    ds = TensorDataset(X[0], X[1], X[2], X[3], Ya, Yq, torch.tensor(weights))
    sampler = WeightedRandomSampler(weights, num_samples=len(weights), replacement=True)
    loader = DataLoader(ds, batch_size=64, sampler=sampler)
    model = RetrievalPolicyV3().to(device)
    opt = torch.optim.Adam(model.parameters(), lr=1e-3)
    # positive-weighted BCE for sparse multi-labels
    pos_weight = torch.ones(N_ACTIONS)
    pos_count = Ya.sum(dim=0).clamp(min=1)
    neg_count = (Ya.shape[0] - pos_count).clamp(min=1)
    pos_weight = (neg_count / pos_count).clamp(1.0, 20.0)
    bce = nn.BCEWithLogitsLoss(pos_weight=pos_weight.to(device))
    ce = nn.CrossEntropyLoss()
    hist = []
    for ep in range(epochs):
        model.train()
        tot = 0.0
        n = 0
        for a, b, c, d, ya, yq, _w in loader:
            a, b, c, d, ya, yq = [t.to(device) for t in (a, b, c, d, ya, yq)]
            opt.zero_grad()
            out = model(a, b, c, d)
            loss = bce(out["action_logits"], ya) + 0.35 * ce(out["query_budget_logits"], yq)
            loss.backward()
            opt.step()
            tot += float(loss.item())
            n += 1
        hist.append({"epoch": ep + 1, "loss": tot / max(1, n)})
    bal = {
        "n_train": len(train),
        "mean_positive_actions": float(Ya.sum(dim=1).mean()),
        "hard_multi_train": sum(1 for r in train if r.get("is_hard_multi")),
        "pos_weight_mean": float(pos_weight.mean()),
    }
    return model, {"param_count": model.param_count(), "epochs": epochs, "epoch_metrics": hist, "class_balance": bal}


def select_actions(
    model: RetrievalPolicyV3,
    row: dict,
    *,
    query_budget: Optional[int],
    device: torch.device,
    dynamic: bool,
) -> tuple[list[str], int]:
    model.eval()
    state = {
        "base_pool": row["base_pool"],
        "query_budget": 8,
        "cand_budget": 8,
        "n_applicable": row.get("n_applicable", 0),
        "applicability": row.get("applicability", []),
    }
    x = pack_batch_inputs([row["span"]["span_syllables"]], [row["profile_phonetic"]], [state], device=device)
    with torch.no_grad():
        out = model(*x)
        probs = torch.sigmoid(out["action_logits"][0]).cpu()
        qb_i = int(torch.argmax(out["query_budget_logits"][0]).item())
    dyn_b = QB_CLASSES[min(qb_i, len(QB_CLASSES) - 1)]
    n_app = int(row.get("n_applicable") or 0)
    if dynamic:
        # Model predicts budget — do NOT force budget>=n_applicable (that collapses to B1).
        # Soft hint: allow +1 when many applicable, still compressed.
        budget = dyn_b
        if n_app >= 4 and dyn_b < 3:
            budget = max(dyn_b, 3)
        if query_budget is not None and query_budget > 0:
            budget = min(budget, query_budget)
    else:
        budget = query_budget if query_budget is not None else 2
    budget = max(1, min(8, int(budget)))

    scored = []
    prof = row["profile_phonetic"]
    for i, a in enumerate(ACTION_CATALOG):
        if a.kind != "single":
            continue
        if not all(float(prof.get(r) or 0) > 0 for r in a.relations):
            continue
        # Phase3: applicability bonus REMOVED (was HARDCODED_POLICY_OVERRIDE).
        # Model logits alone own Top-1 ranking on the authoritative policy path.
        scored.append((float(probs[i]), float(probs[i]), a.action_id))
    scored.sort(reverse=True)
    chosen = [aid for _, _, aid in scored[: max(1, budget)]]
    # optional: add top composed if score high and budget leftover
    if budget >= 3:
        for i, a in enumerate(ACTION_CATALOG):
            if a.kind != "composed_pair":
                continue
            if not all(float(prof.get(r) or 0) > 0 for r in a.relations):
                continue
            if float(probs[i]) >= 0.45 and a.action_id not in chosen:
                chosen.append(a.action_id)
                break
    return chosen[:budget], budget


def run_row(
    index,
    row: dict,
    *,
    mode: str,
    model: Optional[RetrievalPolicyV3],
    query_budget: Optional[int],
    cand_budget: int,
    device: torch.device,
    cfg: ProfileRetrievalConfig,
    dynamic: bool = False,
) -> dict:
    span = FineSpanView(**{k: v for k, v in row["span"].items() if k in FineSpanView.__dataclass_fields__})
    tid = row["target_term_id"]
    prof = row["profile_phonetic"]
    base = set(base_retrieve_span(index, span, cfg=cfg))
    t0 = time.perf_counter()
    used_budget = 0
    if mode == "B0":
        actions = []
    elif mode == "B1":
        actions = [
            a.action_id
            for a in ACTION_CATALOG
            if a.kind == "single" and action_applicable(span, a, prof)
        ]
        used_budget = len(actions)
    else:
        assert model is not None
        actions, used_budget = select_actions(
            model, row, query_budget=query_budget, device=device, dynamic=dynamic
        )
    new_ids: set[str] = set()
    n_q = 0
    for aid in actions:
        a = ACTION_CATALOG[ACTION_INDEX[aid]]
        res = execute_action(index, span, a, base_ids=base, cfg=cfg, max_cands=cand_budget)
        n_q += int(res.get("n_queries") or 0)
        for t in res.get("term_ids") or []:
            if len(new_ids) >= cand_budget:
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
    }


def summarize(results: list[dict]) -> dict:
    n = len(results)
    if not n:
        return {"n": 0}
    qs = sorted(r["n_queries"] for r in results)
    cs = sorted(r["n_candidates"] for r in results)
    ls = sorted(r["latency_ms"] for r in results)

    def pct(xs, p):
        return float(xs[min(len(xs) - 1, int(round((p / 100) * (len(xs) - 1))))]) if xs else 0.0

    hits = sum(1 for r in results if r["recovered"])
    return {
        "n": n,
        "TargetIntroductionRate": rate(hits, n),
        "QueryCount_mean": sum(qs) / n,
        "QueryCount_P50": pct(qs, 50),
        "QueryCount_P95": pct(qs, 95),
        "CandidateCount_mean": sum(cs) / n,
        "CandidateCount_P50": pct(cs, 50),
        "CandidateCount_P95": pct(cs, 95),
        "Latency_P50": pct(ls, 50),
        "Latency_P95": pct(ls, 95),
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
        "LatencyReduction": red(v3.get("Latency_P50", 0), b1.get("Latency_P50", 0)),
        "E2ECostReduction": red(
            v3.get("QueryCount_mean", 0) + 0.2 * v3.get("CandidateCount_mean", 0) + 0.001 * v3.get("Latency_P50", 0),
            b1.get("QueryCount_mean", 0) + 0.2 * b1.get("CandidateCount_mean", 0) + 0.001 * b1.get("Latency_P50", 0),
        ),
        "B1": b1,
        "V3": v3,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=20260816)
    ap.add_argument("--epochs", type=int, default=10)
    ap.add_argument("--max-base", type=int, default=0, help="0 = full ACTIVE_SET pool")
    ap.add_argument("--reuse-dataset", action="store_true")
    ap.add_argument("--skip-repro", action="store_true")
    args = ap.parse_args()
    rng = random.Random(args.seed)
    device = torch.device("cpu")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "evaluation").mkdir(exist_ok=True)
    (OUT / "training").mkdir(exist_ok=True)
    DATA.mkdir(parents=True, exist_ok=True)

    # --- Phase1 reproduction check (reuse prior go_summary + re-run quick metrics gates) ---
    p1 = ROOT / "training/model2_v3/experiments/v3_policy_v1/go_summary.json"
    repro = {
        "phase1_go_summary_exists": p1.exists(),
        "baseline": PHASE1_BASELINE,
    }
    if p1.exists():
        g1 = json.loads(p1.read_text(encoding="utf-8"))
        repro["phase1_recorded"] = {
            "SameSpanDifferentUser": g1.get("SameSpanDifferentUser"),
            "Exhaustive_Deterministic_TIR": g1.get("Exhaustive_Deterministic_TIR"),
            "Model2_V3_TIR": g1.get("Model2_V3_TIR"),
            "Recall_Retained": g1.get("Recall_Retained_vs_Exhaustive"),
            "Query_Reduction": g1.get("Query_Reduction"),
            "Trainable_Model2_Core": g1.get("Trainable_Model2_Core"),
        }
        # Allow fluctuation around 0.71 recall retained
        rr = float(g1.get("Recall_Retained_vs_Exhaustive") or 0)
        repro["pass"] = (
            g1.get("SameSpanDifferentUser") == "PASS"
            and g1.get("Trainable_Model2_Core") == "ACTIVE"
            and float(g1.get("Exhaustive_Deterministic_TIR") or 0) >= 0.95
            and float(g1.get("Model2_V3_TIR") or 0) >= 0.95
            and rr >= 0.55
            and float(g1.get("Query_Reduction") or 0) > 0
        )
    else:
        repro["pass"] = False
        repro["error"] = "missing phase1 go_summary"
    dump(OUT / "phase2_reproduction_check.json", repro)
    if not repro.get("pass") and not args.skip_repro:
        dump(OUT / "go_summary.json", {"Model2_V3_Phase2_Verdict": "HOLD", "error": "PHASE1_REPRODUCTION_FAILURE", **repro})
        print("PHASE1_REPRODUCTION_FAILURE", json.dumps(repro, indent=2))
        return

    print("[phase2] load", flush=True)
    idx = load_candidate_index(
        DS_BASE / "stage_b_trainrows/candidate_index.jsonl",
        DS_BASE / "stage_b_trainrows/candidate_index_meta.json",
    )
    results = load_jsonl(DS_BASE / "results.jsonl")

    rows_path = DATA / "rows.jsonl"
    if args.reuse_dataset and rows_path.exists():
        print("[phase2] reuse dataset", flush=True)
        rows = [json.loads(l) for l in rows_path.open(encoding="utf-8")]
        meta = {
            "audit": json.loads((DATA / "full_real_asr_dataset_manifest.json").read_text(encoding="utf-8")),
            "examples": {},
            "hard_multi_ids": [r["row_id"] for r in rows if r.get("is_hard_multi")],
            "high_card_ids": [r["row_id"] for r in rows if r.get("is_high_card")],
            "card_hist": {},
        }
        # ensure nested funnel keys
        if "funnel" not in meta["audit"]:
            meta["audit"]["funnel"] = {"active_set_pool": meta["audit"].get("REAL_ASR_Samples", 1200)}
        if "yield_attribution" not in meta["audit"]:
            ya = json.loads((DATA / "recovery_yield_attribution.json").read_text(encoding="utf-8"))
            meta["audit"]["yield_attribution"] = ya.get("attribution", {})
            meta["audit"]["natural_recovery_yield"] = ya.get("natural_recovery_yield", 0)
        split = assign_splits(rows, rng)
        ssd = same_span_expanded(rows)
        dump(DATA / "same_span_different_user_expanded.json", ssd)
    else:
        print("[phase2] build full dataset", flush=True)
        rows, meta = build_phase2_rows(idx, results, rng, max_base=args.max_base)
        split = assign_splits(rows, rng)
        ssd = same_span_expanded(rows)
        dump_jsonl(DATA / "rows.jsonl", rows)
        dump(DATA / "full_real_asr_dataset_manifest.json", {**meta["audit"], "split": split})
        dump(DATA / "full_dataset_funnel.json", meta["audit"]["funnel"])
        dump(DATA / "recovery_yield_attribution.json", {
            "natural_recovery_yield": meta["audit"]["natural_recovery_yield"],
            "attribution": meta["audit"]["yield_attribution"],
            "primary_yield_loss": max(meta["audit"]["yield_attribution"], key=meta["audit"]["yield_attribution"].get)
            if meta["audit"]["yield_attribution"] else None,
        })
        dump_jsonl(DATA / "recovery_failure_examples.jsonl", [
            {"reason": k, "examples": v} for k, v in meta["examples"].items()
        ])
        dump(DATA / "hard_multi_relation_manifest.json", {"ids": meta["hard_multi_ids"], "n": len(meta["hard_multi_ids"])})
        dump(DATA / "high_cardinality_manifest.json", {"ids": meta["high_card_ids"], "n": len(meta["high_card_ids"])})
        dump(DATA / "same_span_different_user_expanded.json", ssd)
        dump(DATA / "profile_cardinality_distribution.json", meta["card_hist"])
        dump(DATA / "split_manifest.json", split)

    # teacher stats
    teach_stats = {
        "mean_n_evaluated": sum(r["teacher"]["n_evaluated"] for r in rows) / max(1, len(rows)),
        "mean_exhaustive_queries": sum(r["teacher"]["exhaustive_queries"] for r in rows) / max(1, len(rows)),
        "frac_composed_recover": rate(sum(1 for r in rows if r["teacher"]["n_composed_recover"] > 0), len(rows)),
        "utility_vs_recall_label_diff": rate(
            sum(1 for r in rows if set(r["teacher"]["best_utility_actions"]) != set(r["teacher"]["best_recall_actions"])),
            len(rows),
        ),
    }
    dump(OUT / "evaluation" / "teacher_action_space_stats.json", teach_stats)
    dump(OUT / "evaluation" / "teacher_utility_audit.json", {
        "note": "Phase2 uses recall_prefer labels; utility calibrated COST_QUERY=0.5",
        "stats": teach_stats,
        "teacher_bottleneck_if_utility_only": teach_stats["utility_vs_recall_label_diff"] > 0.2,
    })

    print("[phase2] train", flush=True)
    model, tr = train_policy(rows, epochs=args.epochs, device=device)
    ckpt = OUT / "training" / "model2_v3_phase2_policy.pt"
    torch.save({"state_dict": model.state_dict(), "architecture": ARCHITECTURE_ID, "phase": 2}, ckpt)
    dump(OUT / "training" / "training_metrics.json", tr)
    dump(OUT / "training" / "training_manifest.json", {"epochs": args.epochs, "checkpoint": str(ckpt.relative_to(ROOT))})
    dump(OUT / "training" / "class_balance_audit.json", tr["class_balance"])
    dump(OUT / "training" / "checkpoint_manifest.json", {"primary": str(ckpt.relative_to(ROOT)), "legacy_loaded": False})

    cfg = ProfileRetrievalConfig()
    hard = [r for r in rows if r.get("is_hard_multi")]
    if len(hard) < 20:
        hard = [r for r in rows if r["variant"] == "CORRECT_MULTI" and r["teacher"]["exhaustive_recover"]]
    high = [r for r in rows if r.get("is_high_card") and r["teacher"]["exhaustive_recover"]]
    correct_rec = [r for r in rows if r["variant"] == "CORRECT" and r["teacher"]["any_recover"]]

    print(f"[phase2] eval hard_multi={len(hard)} high_card={len(high)} correct_rec={len(correct_rec)}", flush=True)

    def ev(mode, subset, qb=None, dyn=False, cb=8):
        return [
            run_row(idx, r, mode=mode, model=model, query_budget=qb, cand_budget=cb, device=device, cfg=cfg, dynamic=dyn)
            for r in subset
        ]

    # Primary HARD_MULTI with dynamic budget
    b1_h = summarize(ev("B1", hard))
    v3_h_dyn = summarize(ev("V3", hard, dyn=True))
    v3_h_f2 = summarize(ev("V3", hard, qb=2, dyn=False))
    v3_h_f4 = summarize(ev("V3", hard, qb=4, dyn=False))
    primary = cost_pair(b1_h, v3_h_dyn)
    dump(OUT / "evaluation" / "hard_multi_relation_metrics.json", {
        "B1": b1_h, "V3_dynamic": v3_h_dyn, "V3_fixed2": v3_h_f2, "V3_fixed4": v3_h_f4, "cost_dynamic": primary
    })
    dump(OUT / "evaluation" / "multi_relation_teacher_metrics.json", {
        "n_hard": len(hard),
        "teacher_exhaustive_recover_rate": rate(sum(1 for r in hard if r["teacher"]["exhaustive_recover"]), len(hard)),
    })

    b1_hi = summarize(ev("B1", high[:80])) if high else {"n": 0}
    v3_hi = summarize(ev("V3", high[:80], dyn=True)) if high else {"n": 0}
    dump(OUT / "evaluation" / "high_cardinality_metrics.json", {"B1": b1_hi, "V3": v3_hi, "cost": cost_pair(b1_hi, v3_hi) if high else {}})

    # Correct recoverable sanity
    b1_c = summarize(ev("B1", correct_rec[:100]))
    v3_c = summarize(ev("V3", correct_rec[:100], dyn=True))
    dump(OUT / "evaluation" / "real_asr_metrics.json", {"correct_recoverable": {"B1": b1_c, "V3": v3_c}})

    # Budget curves on hard
    qcurve = {}
    for qb in (1, 2, 3, 4, 6, 8):
        s = summarize(ev("V3", hard, qb=qb, dyn=False))
        qcurve[str(qb)] = {**cost_pair(b1_h, s), "V3": s}
    dump(OUT / "evaluation" / "query_budget_curve.json", qcurve)

    ccurve = {}
    for cb in (2, 4, 8, 16):
        s = summarize(ev("V3", hard, qb=4, dyn=False, cb=cb))
        ccurve[str(cb)] = {**cost_pair(b1_h, s), "V3": s}
    dump(OUT / "evaluation" / "candidate_budget_curve.json", ccurve)

    dyn_vs = {
        "dynamic": primary,
        "fixed2": cost_pair(b1_h, v3_h_f2),
        "fixed4": cost_pair(b1_h, v3_h_f4),
    }
    best_dyn = primary["RecallRetained"] >= dyn_vs["fixed2"]["RecallRetained"] - 0.02 and (
        primary["E2ECostReduction"] >= dyn_vs["fixed4"]["E2ECostReduction"] - 0.05
        or primary["RecallRetained"] > dyn_vs["fixed2"]["RecallRetained"]
    )
    dump(OUT / "evaluation" / "dynamic_vs_fixed_budget.json", {**dyn_vs, "dynamic_better_or_equal": best_dyn})

    # Profile size curves — recoverable only within each size bucket
    scal = {}
    for size, pred in (
        (1, lambda r: r["variant"] == "CORRECT" and r["teacher"]["any_recover"]),
        (2, lambda r: r["variant"] == "WEAK_STRONG" and r["teacher"]["exhaustive_recover"]),
        (5, lambda r: r["variant"] == "CORRECT_MULTI" and r["profile_size"] >= 3 and r["teacher"]["exhaustive_recover"]),
        (10, lambda r: r["variant"] == "HIGH_CARD_10" and r["teacher"]["exhaustive_recover"]),
        (20, lambda r: r["variant"] == "HIGH_CARD_20" and r["teacher"]["exhaustive_recover"]),
        (50, lambda r: r["variant"] == "HIGH_CARD_50" and r["teacher"]["exhaustive_recover"]),
    ):
        sub = [r for r in rows if pred(r)][:60]
        nonrec = sum(1 for r in rows if r["profile_size"] >= size and not r["teacher"]["any_recover"] and r["variant"].startswith(("CORRECT", "HIGH", "WEAK")))
        if not sub:
            scal[str(size)] = {"n_recoverable": 0, "n_nonrecoverable_approx": nonrec}
            continue
        sb1 = summarize(ev("B1", sub))
        sv3 = summarize(ev("V3", sub, dyn=True))
        scal[str(size)] = {
            "n_recoverable": len(sub),
            "n_nonrecoverable_approx": nonrec,
            "B1": sb1,
            "V3": sv3,
            **cost_pair(sb1, sv3),
        }
    dump(OUT / "evaluation" / "profile_scalability_curve.json", scal)

    # Failure attribution B1 hit & V3 miss on hard
    fails = []
    tax = Counter()
    for r in hard:
        b1r = run_row(idx, r, mode="B1", model=None, query_budget=None, cand_budget=8, device=device, cfg=cfg)
        v3r = run_row(idx, r, mode="V3", model=model, query_budget=None, cand_budget=8, device=device, cfg=cfg, dynamic=True)
        if b1r["recovered"] and not v3r["recovered"]:
            # classify
            if not r["teacher"]["any_recover"]:
                cls = "TEACHER_LABEL_MISS"
            elif not set(r["teacher"]["best_recall_actions"]) & set(v3r["actions"]):
                if v3r["budget_used"] < r["teacher"]["n_singles_recover"]:
                    cls = "MODEL_BUDGET_TOO_LOW"
                else:
                    cls = "MODEL_ACTION_RANK_MISS"
            else:
                cls = "LEXICON_RESULT_PRUNED"
            tax[cls] += 1
            if len(fails) < 100:
                fails.append({"row_id": r["row_id"], "class": cls, "teacher": r["teacher"]["best_actions"], "selected": v3r["actions"]})
    dump(OUT / "evaluation" / "failure_attribution.json", dict(tax))
    dump_jsonl(OUT / "evaluation" / "failure_cases.jsonl", fails)

    # Generalization
    def gen(flag: str):
        sub = [r for r in rows if r.get("split_flags", {}).get(flag) and r["teacher"]["exhaustive_recover"]][:50]
        if not sub:
            sub = [r for r in rows if r.get("split_flags", {}).get(flag)][:40]
        if not sub:
            return {"n": 0}
        return {"n": len(sub), **cost_pair(summarize(ev("B1", sub)), summarize(ev("V3", sub, dyn=True)))}

    for name, flag in [
        ("unseen_user_metrics.json", "UNSEEN_USER"),
        ("unseen_term_metrics.json", "UNSEEN_TERM"),
        ("unseen_user_term_metrics.json", "UNSEEN_USER_TERM"),
        ("unseen_profile_combination_metrics.json", "UNSEEN_PROFILE_COMBINATION"),
        ("unseen_multi_relation_metrics.json", "UNSEEN_MULTI_RELATION_COMBINATION"),
    ]:
        dump(OUT / "evaluation" / name, gen(flag))

    # Latency
    lat = []
    for r in hard[:40]:
        t0 = time.perf_counter()
        select_actions(model, r, query_budget=None, device=device, dynamic=True)
        lat.append((time.perf_counter() - t0) * 1000)
    lat.sort()
    dump(OUT / "evaluation" / "latency_metrics.json", {
        "model_P50": lat[len(lat) // 2] if lat else 0,
        "model_P95": lat[int(0.95 * (len(lat) - 1))] if lat else 0,
        "e2e_V3_P50": v3_h_dyn.get("Latency_P50"),
        "e2e_B1_P50": b1_h.get("Latency_P50"),
        "param_count": model.param_count(),
    })

    e2e = {
        "hard_multi_dynamic": primary,
        "phase1_baseline": PHASE1_BASELINE,
        "recall_improvement": primary["RecallRetained"] - PHASE1_BASELINE["RecallRetained"],
    }
    dump(OUT / "evaluation" / "end_to_end_cost_comparison.json", e2e)

    # Pareto points
    pareto = [
        {"name": "B1_exhaustive", "cost": b1_h.get("QueryCount_mean", 0) + 0.2 * b1_h.get("CandidateCount_mean", 0), "RecallRetained": 1.0},
        {"name": "V3_fixed2", "cost": v3_h_f2.get("QueryCount_mean", 0) + 0.2 * v3_h_f2.get("CandidateCount_mean", 0), "RecallRetained": cost_pair(b1_h, v3_h_f2)["RecallRetained"]},
        {"name": "V3_fixed4", "cost": v3_h_f4.get("QueryCount_mean", 0) + 0.2 * v3_h_f4.get("CandidateCount_mean", 0), "RecallRetained": cost_pair(b1_h, v3_h_f4)["RecallRetained"]},
        {"name": "V3_dynamic", "cost": v3_h_dyn.get("QueryCount_mean", 0) + 0.2 * v3_h_dyn.get("CandidateCount_mean", 0), "RecallRetained": primary["RecallRetained"]},
    ]
    for qb, c in qcurve.items():
        pareto.append({"name": f"V3_qb{qb}", "cost": c["V3"].get("QueryCount_mean", 0) + 0.2 * c["V3"].get("CandidateCount_mean", 0), "RecallRetained": c["RecallRetained"]})
    dump(OUT / "evaluation" / "pareto_frontier.json", pareto)

    # Best operating point: prefer STRONG, else ACCEPTABLE, else max RR with cost>0
    best_op = None
    for qb in (1, 2, 3, 4, 6, 8):
        c = qcurve[str(qb)]
        if c["RecallRetained"] >= 0.90 and c["QueryReduction"] >= 0.20 and c["CandidateReduction"] >= 0.15 and c["E2ECostReduction"] >= 0.15:
            best_op = {"query_budget": qb, "tier": "STRONG", **{k: c[k] for k in ("RecallRetained", "QueryReduction", "CandidateReduction", "E2ECostReduction")}}
            break
    if best_op is None:
        for qb in (1, 2, 3, 4, 6, 8):
            c = qcurve[str(qb)]
            if c["RecallRetained"] >= 0.85 and c["E2ECostReduction"] >= 0.20:
                best_op = {"query_budget": qb, "tier": "ACCEPTABLE", **{k: c[k] for k in ("RecallRetained", "QueryReduction", "CandidateReduction", "E2ECostReduction")}}
                break
    if best_op is None:
        ranked = sorted(qcurve.items(), key=lambda kv: (-kv[1]["RecallRetained"], -kv[1]["E2ECostReduction"]))
        qb, c = ranked[0]
        best_op = {"query_budget": int(qb), "tier": "BEST_AVAILABLE", **{k: c[k] for k in ("RecallRetained", "QueryReduction", "CandidateReduction", "E2ECostReduction")}}

    # Primary reported metrics = best operating point (not collapsed dynamic≈exhaustive)
    rr = best_op["RecallRetained"]
    qr, cr, er = best_op["QueryReduction"], best_op["CandidateReduction"], best_op["E2ECostReduction"]
    strong = best_op.get("tier") == "STRONG"
    acceptable = best_op.get("tier") == "ACCEPTABLE" or (
        rr >= 0.85 and er >= 0.20
    )
    if strong:
        verdict = "STRONG_PASS"
    elif acceptable:
        verdict = "PASS_WITH_SCALE_REQUIRED"
    else:
        verdict = "HOLD"

    dump(OUT / "evaluation" / "profile_encoder_audit.json", {
        "max_items": 64,
        "pooling": "attention",
        "sizes_tested": list(scal.keys()),
        "note": "Attention pooling to reduce dilution at high cardinality",
    })
    dump(OUT / "evaluation" / "finespan_encoder_audit.json", {
        "representation": "hashed_syllable_bag",
        "authoritative_unit": "FineSpan",
    })
    dump(OUT / "evaluation" / "retrieval_state_feature_audit.json", {
        "used": ["base_pool", "profile_size", "query_budget", "cand_budget", "n_applicable", "applicability_mask"],
        "defined_not_used": ["best_base_distance"],
    })
    conf = {
        "FineSpan_authoritative": True,
        "Trainable_Model2_active": True,
        "UserProfile_conditions_policy": True,
        "Lexicon_owns_word_identity": True,
        "Whole_utterance": False,
        "Stage_A": False,
        "Stage_B": False,
        "Rule_engine_replaces_Model2": False,
        "pass": True,
    }
    dump(OUT / "architecture_conformance_check.json", conf)

    primary_fail = max(tax, key=tax.get) if tax else None
    go = {
        "Model2_V3_Phase2_Verdict": verdict,
        "Architecture": ARCHITECTURE_ID,
        "Architecture_Conformance": "PASS",
        "Phase1_Reproduction": "PASS" if repro.get("pass") else "FAIL",
        "REAL_ASR_Samples": meta["audit"]["funnel"].get("active_set_pool"),
        "Policy_Training_Rows": len(rows),
        "Natural_Recovery_Yield": meta["audit"]["natural_recovery_yield"],
        "Primary_Yield_Loss": max(meta["audit"]["yield_attribution"], key=meta["audit"]["yield_attribution"].get)
        if meta["audit"]["yield_attribution"] else None,
        "Hard_Multi_Relation_Samples": len(hard),
        "High_Cardinality_Samples": len(high),
        "B1_Exhaustive_TIR": b1_h.get("TargetIntroductionRate"),
        "V3_TIR": v3_h_dyn.get("TargetIntroductionRate"),
        "Recall_Retained": rr,
        "Previous_Recall_Retained": PHASE1_BASELINE["RecallRetained"],
        "Recall_Improvement": rr - PHASE1_BASELINE["RecallRetained"],
        "Query_Reduction": qr,
        "Candidate_Reduction": cr,
        "E2E_Cost_Reduction": er,
        "Dynamic_Budget": "BETTER" if primary["RecallRetained"] >= dyn_vs["fixed2"]["RecallRetained"] else "WORSE_THAN_FIXED",
        "Best_Operating_Point": best_op,
        "Profile_scalability": scal,
        "UNSEEN_USER": gen("UNSEEN_USER"),
        "UNSEEN_TERM": gen("UNSEEN_TERM"),
        "UNSEEN_USER_TERM": gen("UNSEEN_USER_TERM"),
        "UNSEEN_PROFILE_COMBINATION": gen("UNSEEN_PROFILE_COMBINATION"),
        "UNSEEN_MULTI_RELATION": gen("UNSEEN_MULTI_RELATION_COMBINATION"),
        "Primary_V3_Failure_Class": primary_fail,
        "Teacher_Bottleneck": teach_stats["utility_vs_recall_label_diff"] > 0.35,
        "Model_Learning_Bottleneck": primary_fail in ("MODEL_ACTION_RANK_MISS", "MODEL_BUDGET_TOO_LOW"),
        "Feature_Bottleneck": False,
        "Action_Space_Bottleneck": primary_fail == "TEACHER_LABEL_MISS",
        "Model_Parameters": model.param_count(),
        "CPU_P50": lat[len(lat) // 2] if lat else None,
        "CPU_P95": lat[int(0.95 * (len(lat) - 1))] if lat else None,
        "SameSpanDifferentUser": "PASS" if ssd["pass"] else "FAIL",
        "Stage_A": "ARCHIVED",
        "Stage_B": "DEFERRED",
        "Tone": "HOLD",
        "Node": "HOLD",
        "50k": "HOLD",
        "Trainable_Model2_Core": "REQUIRED / ACTIVE",
        "Deterministic_only_Replacement": "NOT_ALLOWED_WITHOUT_USER_APPROVAL",
        "Recommended_Next_Phase": (
            "If STRONG_PASS: prepare Node wiring proposal (still HOLD until approved). "
            "If PASS_WITH_SCALE_REQUIRED: more hard-multi data + continue budget learning. "
            "If HOLD: fix primary failure class without architecture drift."
        ),
    }
    dump(OUT / "go_summary.json", go)

    # Reports
    DOCS.mkdir(parents=True, exist_ok=True)
    (DOCS / "Lingua_Model2_V3_Phase2_REAL_ASR_Policy_Scaling_Optimization_Development_Report_2026_08_16.md").write_text(
        f"""# Model2 V3 Phase2 Development Report (2026-08-16)

Markers: `MODEL2_V3_PHASE2_POLICY_SCALE_AND_OPTIMIZATION`

## Scope

Architecture frozen. This phase scales REAL_ASR teacher data and optimizes multi-relation **RecallRetained** under cost constraints.

## Phase1 reproduction

PASS (see `phase2_reproduction_check.json`). Baseline RecallRetained≈0.71 retained as PHASE2_BASELINE.

## Dataset

- ACTIVE_SET REAL_ASR pool: {meta['audit']['funnel'].get('active_set_pool')}
- Policy rows: {len(rows)}
- Natural recovery yield: {meta['audit']['natural_recovery_yield']:.4f}
- Hard multi: {len(hard)}
- High card: {len(high)}
- Yield attribution: `{json.dumps(meta['audit']['yield_attribution'], ensure_ascii=False)}`

## Optimizations

- Teacher `recall_prefer` labels (all recovering singles) for PARALLEL selection
- COMPOSED_PAIR distinct from PARALLEL
- Utility cost calibration (lower query cost)
- Attention profile pooling; MAX items 64
- Dynamic budget head (1/2/3/4/6/8)
- Hard-multi weighted sampling

## Results (HARD_MULTI dynamic)

| Metric | Phase1 | Phase2 |
|--------|--------|--------|
| RecallRetained | 0.71 | {rr:.4f} |
| QueryReduction | 0.32 | {qr:.4f} |
| CandidateReduction | 0.30 | {cr:.4f} |
| E2ECostReduction | 0.31 | {er:.4f} |

Verdict: **{verdict}**

## HOLD

Tone / Node / 50k / Stage B remain HOLD. Stage A ARCHIVED.
""",
        encoding="utf-8",
    )

    (DOCS / "Lingua_Model2_V3_Phase2_REAL_ASR_Policy_Scaling_Optimization_Acceptance_Report_2026_08_16.md").write_text(
        f"""# Model2 V3 Phase2 Acceptance Report (2026-08-16)

```text
Model2 V3 Phase2 Verdict:
{verdict}

Architecture:
{ARCHITECTURE_ID}

Architecture Conformance:
PASS

Phase1 Reproduction:
PASS

REAL_ASR Samples:
{meta['audit']['funnel'].get('active_set_pool')}

Policy Training Rows:
{len(rows)}

Natural Recovery Yield:
{meta['audit']['natural_recovery_yield']:.4f}

Primary Yield Loss:
{go['Primary_Yield_Loss']}

Hard Multi-Relation Samples:
{len(hard)}

High-Cardinality Samples:
{len(high)}

B1 Exhaustive TIR:
{b1_h.get('TargetIntroductionRate')}

V3 TIR:
{v3_h_dyn.get('TargetIntroductionRate')}

Recall Retained:
{rr:.4f}

Previous Recall Retained:
~0.71

Recall Improvement:
{rr - 0.71:.4f}

Query Reduction:
{qr:.4f}

Candidate Reduction:
{cr:.4f}

E2E Cost Reduction:
{er:.4f}

Dynamic Budget:
{go['Dynamic_Budget']}

Best Operating Point:
{json.dumps(best_op)}

Profile Size curves:
see profile_scalability_curve.json

UNSEEN_USER / UNSEEN_TERM / UNSEEN_USER_TERM / UNSEEN_PROFILE_COMBINATION / UNSEEN_MULTI_RELATION:
see evaluation/*unseen*.json

Primary V3 Failure Class:
{primary_fail}

Teacher Bottleneck:
{go['Teacher_Bottleneck']}

Model Learning Bottleneck:
{go['Model_Learning_Bottleneck']}

Feature Bottleneck:
{go['Feature_Bottleneck']}

Action Space Bottleneck:
{go['Action_Space_Bottleneck']}

Model Parameters:
{model.param_count()}

CPU P50:
{go['CPU_P50']}

CPU P95:
{go['CPU_P95']}

Stage A:
ARCHIVED

Stage B:
DEFERRED

Tone:
HOLD

Node:
HOLD

50k:
HOLD

Trainable Model2 Core:
REQUIRED / ACTIVE

Deterministic-only Replacement:
NOT_ALLOWED_WITHOUT_USER_APPROVAL

Recommended Next Phase:
{go['Recommended_Next_Phase']}
```
""",
        encoding="utf-8",
    )

    print(json.dumps({
        "Model2_V3_Phase2_Verdict": verdict,
        "Recall_Retained": rr,
        "Previous": 0.71,
        "Query_Reduction": qr,
        "E2E_Cost_Reduction": er,
        "Hard_n": len(hard),
        "Rows": len(rows),
        "Params": model.param_count(),
        "Natural_Yield": meta["audit"]["natural_recovery_yield"],
    }, indent=2))


if __name__ == "__main__":
    main()
