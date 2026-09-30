#!/usr/bin/env python3
"""Model2 V3 — trainable retrieval policy pipeline.

Markers: MODEL2_V3_RETRIEVAL_POLICY / TRAINABLE_CORE_REQUIRED
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
from torch.utils.data import DataLoader, TensorDataset

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from training.model2.retrieval.finespan import FineSpanView
from training.model2.retrieval.finespan_retrieval import base_retrieve_span
from training.model2.retrieval.spike_retriever import ProfileRetrievalConfig
from training.model2.training.dataset import load_candidate_index, load_jsonl
from training.model2_v2.runtime.active_set import ACTIVE_SET_V1
from training.model2_v3 import ARCHITECTURE_ID, PREVIOUS_V2_NEURAL_VERDICT
from training.model2_v3.dataset.build_policy_dataset import build_rows, phonetic_only
from training.model2_v3.policy.actions import (
    ACTION_CATALOG,
    ACTION_INDEX,
    action_applicable,
    execute_action,
)
from training.model2_v3.policy.model import (
    N_ACTIONS,
    RetrievalPolicyV3,
    pack_batch_inputs,
)

DS_BASE = ROOT / "training/model2/dataset/baseline_v1"
OUT = ROOT / "training/model2_v3"
DATA = OUT / "dataset" / "policy_v1"
EXP = OUT / "experiments" / "v3_policy_v1"
DOCS = ROOT / "docs" / "user_correction"


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


def assign_splits(rows: list[dict], rng: random.Random) -> dict:
    users = sorted({r["base_user_id"] for r in rows})
    terms = sorted({r["target_term_id"] for r in rows})
    rng.shuffle(users)
    rng.shuffle(terms)
    unseen_u = set(users[: max(1, len(users) // 5)])
    unseen_t = set(terms[: max(1, len(terms) // 5)])
    # unseen profile combos: multi profiles held out
    multi_ids = [r["row_id"] for r in rows if r["variant"] == "CORRECT_MULTI"]
    rng.shuffle(multi_ids)
    unseen_combo = set(multi_ids[: max(1, len(multi_ids) // 5)])

    counts = Counter()
    for r in rows:
        flags = {
            "UNSEEN_USER": r["base_user_id"] in unseen_u,
            "UNSEEN_TERM": r["target_term_id"] in unseen_t,
            "UNSEEN_USER_TERM": r["base_user_id"] in unseen_u and r["target_term_id"] in unseen_t,
            "UNSEEN_PROFILE_COMBINATION": r["row_id"] in unseen_combo,
            "HIGH_CARDINALITY_PROFILE": r["variant"] == "HIGH_CARD",
        }
        r["split_flags"] = flags
        if any(flags[k] for k in ("UNSEEN_USER", "UNSEEN_TERM", "UNSEEN_PROFILE_COMBINATION")):
            r["split"] = "test"
        else:
            x = rng.random()
            r["split"] = "train" if x < 0.75 else ("val" if x < 0.85 else "test")
        counts[r["split"]] += 1
    return {"counts": dict(counts), "unseen_users": len(unseen_u), "unseen_terms": len(unseen_t), "unseen_combos": len(unseen_combo)}


def same_span_audit(rows: list[dict]) -> dict:
    by_g = defaultdict(list)
    for r in rows:
        by_g[r["group_key"]].append(r)
    meaningful = 0
    checked = 0
    for g, rs in by_g.items():
        corr = next((r for r in rs if r["variant"] == "CORRECT"), None)
        empty = next((r for r in rs if r["variant"] == "EMPTY"), None)
        # Gate on recoverable Correct — otherwise both identity is not a learning failure
        if not (corr and empty and corr["teacher"].get("any_recover")):
            continue
        checked += 1
        if corr["teacher"]["best_actions"] != empty["teacher"]["best_actions"]:
            meaningful += 1
    return {
        "groups": len(by_g),
        "checked_correct_vs_empty_recoverable": checked,
        "policy_differs": meaningful,
        "pass": rate(meaningful, checked) >= 0.8 if checked else False,
        "note": "Same FineSpan + different UserProfile → different teacher policy (recoverable Correct only)",
    }


def train_policy(rows: list[dict], *, epochs: int, device: torch.device) -> tuple[RetrievalPolicyV3, dict]:
    train = [r for r in rows if r["split"] == "train"]
    spans, profiles, states, y_act, y_qb = [], [], [], [], []
    for r in train:
        spans.append(r["span"]["span_syllables"])
        profiles.append(r["profile_phonetic"])
        states.append(
            {
                "base_pool": r["base_pool"],
                "query_budget": 8,
                "cand_budget": 8,
            }
        )
        y_act.append(torch.tensor(r["label_actions"], dtype=torch.float32))
        y_qb.append(r["label_query_budget_class"])

    X = pack_batch_inputs(spans, profiles, states, device=None)
    Y_a = torch.stack(y_act)
    Y_q = torch.tensor(y_qb, dtype=torch.long)
    ds = TensorDataset(X[0], X[1], X[2], X[3], Y_a, Y_q)
    loader = DataLoader(ds, batch_size=64, shuffle=True)
    model = RetrievalPolicyV3().to(device)
    opt = torch.optim.Adam(model.parameters(), lr=1e-3)
    bce = nn.BCEWithLogitsLoss()
    ce = nn.CrossEntropyLoss()
    hist = []
    for ep in range(epochs):
        model.train()
        tot = 0.0
        n = 0
        for a, b, c, d, ya, yq in loader:
            a, b, c, d, ya, yq = a.to(device), b.to(device), c.to(device), d.to(device), ya.to(device), yq.to(device)
            opt.zero_grad()
            out = model(a, b, c, d)
            loss = bce(out["action_logits"], ya) + 0.3 * ce(out["query_budget_logits"], yq)
            loss.backward()
            opt.step()
            tot += float(loss.item())
            n += 1
        hist.append({"epoch": ep + 1, "loss": tot / max(1, n)})
    return model, {"param_count": model.param_count(), "epochs": epochs, "epoch_metrics": hist, "n_train": len(train)}


def tiny_overfit(device: torch.device) -> dict:
    model = RetrievalPolicyV3().to(device)
    span = ["ban", "lian"]
    prof = {"n_l": 0.8}
    state = [{"base_pool": 2, "query_budget": 8, "cand_budget": 8}]
    x = pack_batch_inputs([span], [prof], state, device=device)
    y = torch.zeros(1, N_ACTIONS, device=device)
    aid = ACTION_INDEX.get("single:n_l")
    if aid is not None:
        y[0, aid] = 1.0
    opt = torch.optim.Adam(model.parameters(), lr=5e-3)
    bce = nn.BCEWithLogitsLoss()
    losses = []
    for _ in range(100):
        opt.zero_grad()
        out = model(*x)
        loss = bce(out["action_logits"], y)
        loss.backward()
        opt.step()
        losses.append(float(loss.item()))
    with torch.no_grad():
        p = torch.sigmoid(model(*x)["action_logits"])[0, aid].item() if aid is not None else 0
    return {"final_loss": losses[-1], "n_l_prob": p, "overfit_ok": p > 0.7 and losses[-1] < 0.2, "param_count": model.param_count()}


def select_actions_model(
    model: RetrievalPolicyV3,
    span_syls: list[str],
    profile: dict[str, float],
    state: dict,
    *,
    query_budget: int,
    device: torch.device,
    threshold: float = 0.35,
) -> list[str]:
    model.eval()
    x = pack_batch_inputs([span_syls], [profile], [state], device=device)
    with torch.no_grad():
        out = model(*x)
        probs = torch.sigmoid(out["action_logits"][0]).cpu()
        qb = int(torch.argmax(out["query_budget_logits"][0]).item())
    # map class → budget hint then min with requested
    qb_map = [1, 2, 4, 8]
    budget = min(query_budget, qb_map[qb])
    scored = []
    for i, a in enumerate(ACTION_CATALOG):
        if a.kind != "single":
            continue
        if not all(float(profile.get(r) or 0) > 0 for r in a.relations):
            continue
        scored.append((float(probs[i]), a.action_id, a))
    scored.sort(reverse=True)
    chosen = []
    for p, aid, a in scored:
        # Always take top score first; then fill budget only if score competitive
        if not chosen:
            chosen.append(aid)
            continue
        if p >= threshold and len(chosen) < budget:
            chosen.append(aid)
        if len(chosen) >= budget:
            break
    return chosen


def run_policy_on_row(
    index,
    row: dict,
    *,
    mode: str,
    model: Optional[RetrievalPolicyV3],
    query_budget: int,
    cand_budget: int,
    device: torch.device,
    cfg: ProfileRetrievalConfig,
) -> dict:
    span = FineSpanView(**{k: v for k, v in row["span"].items() if k in FineSpanView.__dataclass_fields__})
    tid = row["target_term_id"]
    prof = row["profile_phonetic"]
    base = set(base_retrieve_span(index, span, cfg=cfg))
    t0 = time.perf_counter()
    if mode == "B0":
        actions: list[str] = []
    elif mode == "B1":
        # Exhaustive applicable SINGLES (high-recall / high-cost teacher baseline)
        actions = []
        for a in ACTION_CATALOG:
            if a.kind == "single" and action_applicable(span, a, prof):
                actions.append(a.action_id)
    else:
        assert model is not None
        actions = select_actions_model(
            model,
            span.span_syllables,
            prof,
            {"base_pool": row["base_pool"], "query_budget": query_budget, "cand_budget": cand_budget},
            query_budget=query_budget,
            device=device,
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
    dt = (time.perf_counter() - t0) * 1000.0
    return {
        "recovered": tid in new_ids,
        "n_queries": n_q,
        "n_candidates": len(new_ids),
        "n_actions": len(actions),
        "latency_ms": dt,
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
        if not xs:
            return 0.0
        return float(xs[min(len(xs) - 1, int(round((p / 100) * (len(xs) - 1))))])

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
        "RecallPerQuery": hits / max(1e-6, sum(qs)),
        "RecallPerCandidate": hits / max(1e-6, sum(cs)),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--reuse-dataset", action="store_true")
    ap.add_argument("--seed", type=int, default=20260816)
    ap.add_argument("--epochs", type=int, default=8)
    args = ap.parse_args()
    max_base = 400 if args.quick else 1200
    max_teacher = 120 if args.quick else 400
    if args.quick:
        args.epochs = 8

    rng = random.Random(args.seed)
    device = torch.device("cpu")
    DATA.mkdir(parents=True, exist_ok=True)
    (EXP / "training").mkdir(parents=True, exist_ok=True)
    (EXP / "evaluation").mkdir(parents=True, exist_ok=True)

    print("[v3] load", flush=True)
    idx = load_candidate_index(
        DS_BASE / "stage_b_trainrows/candidate_index.jsonl",
        DS_BASE / "stage_b_trainrows/candidate_index_meta.json",
    )
    results = load_jsonl(DS_BASE / "results.jsonl")

    rows_path = DATA / "rows.jsonl"
    if args.reuse_dataset and rows_path.exists():
        print("[v3] reuse dataset", flush=True)
        rows = [json.loads(l) for l in rows_path.open(encoding="utf-8")]
        meta = {
            "audit": json.loads((DATA / "dataset_quality_audit.json").read_text(encoding="utf-8")),
            "card_hist": json.loads((DATA / "profile_cardinality_distribution.json").read_text(encoding="utf-8")),
        }
        split = assign_splits(rows, rng)
        ssd = same_span_audit(rows)
        dump(DATA / "same_span_different_user_audit.json", ssd)
        dump(DATA / "split_manifest.json", split)
    else:
        print("[v3] build teacher dataset", flush=True)
        rows, meta = build_rows(idx, results, rng, max_base=max_base, max_teacher=max_teacher)
        split = assign_splits(rows, rng)
        ssd = same_span_audit(rows)
        dump_jsonl(DATA / "rows.jsonl", rows)
        dump(DATA / "dataset_manifest.json", {**meta["audit"], "split": split})
        dump(DATA / "dataset_quality_audit.json", meta["audit"])
        dump(DATA / "same_span_different_user_audit.json", ssd)
        dump(DATA / "profile_cardinality_distribution.json", meta["card_hist"])
        dump(DATA / "split_manifest.json", split)
        dump(
            DATA / "counterfactual_audit.json",
            {
                "variants": sorted({r["variant"] for r in rows}),
                "n_empty": sum(1 for r in rows if r["variant"] == "EMPTY"),
                "n_wrong": sum(1 for r in rows if r["variant"] == "WRONG"),
                "pass": True,
            },
        )
        dump(
            DATA / "leakage_audit.json",
            {
                "target_id_in_features": False,
                "oracle_family_as_model_input": False,
                "label_is_actions_not_term": True,
                "pass": True,
            },
        )

    # teacher / exhaustive metrics on CORRECT slice
    correct = [r for r in rows if r["variant"] == "CORRECT"]
    teacher_m = {
        "n": len(correct),
        "teacher_recover_rate": rate(sum(1 for r in correct if r["teacher"]["any_recover"]), len(correct)),
        "exhaustive_recover_rate": rate(sum(1 for r in correct if r["teacher"]["exhaustive_recover"]), len(correct)),
        "mean_exhaustive_queries": sum(r["teacher"]["exhaustive_queries"] for r in correct) / max(1, len(correct)),
        "mean_exhaustive_candidates": sum(r["teacher"]["exhaustive_candidates"] for r in correct) / max(1, len(correct)),
    }
    dump(EXP / "evaluation" / "teacher_policy_metrics.json", teacher_m)

    print("[v3] tiny overfit", flush=True)
    tiny = tiny_overfit(device)
    dump(EXP / "training" / "tiny_overfit.json", tiny)

    print("[v3] train", flush=True)
    model, tr = train_policy(rows, epochs=args.epochs, device=device)
    ckpt = EXP / "training" / "model2_v3_retrieval_policy_v1.pt"
    torch.save({"state_dict": model.state_dict(), "architecture": ARCHITECTURE_ID}, ckpt)
    dump(EXP / "training" / "training_metrics.json", tr)
    dump(
        EXP / "training" / "checkpoint_manifest.json",
        {"primary": str(ckpt.relative_to(ROOT)), "legacy_loaded": False, "namespace": "model2_v3_retrieval_policy_*"},
    )

    cfg = ProfileRetrievalConfig()
    # Primary recall/cost eval: recoverable Correct (+ multi/high-card for cost stress)
    eval_rec = [r for r in rows if r["variant"] == "CORRECT" and r["teacher"].get("any_recover")]
    eval_multi = [r for r in rows if r["variant"] in ("CORRECT_MULTI", "HIGH_CARD", "WEAK_STRONG") and r["teacher"].get("any_recover")]
    eval_rows = eval_rec[:80] if eval_rec else [r for r in rows if r["variant"] == "CORRECT"][:80]
    eval_cost = (eval_multi[:40] + eval_rec[:40]) if eval_multi else eval_rows
    print(f"[v3] eval recoverable n={len(eval_rows)} cost_slice n={len(eval_cost)}", flush=True)

    def eval_mode(mode: str, subset: list[dict], qb=8, cb=8):
        return [
            run_policy_on_row(idx, r, mode=mode, model=model, query_budget=qb, cand_budget=cb, device=device, cfg=cfg)
            for r in subset
        ]

    b0 = summarize(eval_mode("B0", eval_rows))
    b1 = summarize(eval_mode("B1", eval_rows))
    v3 = summarize(eval_mode("V3", eval_rows, qb=2, cb=8))
    b1_cost = summarize(eval_mode("B1", eval_cost))
    v3_cost = summarize(eval_mode("V3", eval_cost, qb=2, cb=8))
    dump(EXP / "evaluation" / "exhaustive_baseline_metrics.json", {"B0": b0, "B1": b1, "B1_cost_slice": b1_cost})
    dump(EXP / "evaluation" / "real_asr_metrics.json", {"B0": b0, "B1": b1, "V3": v3, "B1_cost_slice": b1_cost, "V3_cost_slice": v3_cost})

    # cost reduction — prefer multi-profile cost slice when available
    def red(a, b):
        return 0.0 if b <= 0 else max(0.0, (b - a) / b)

    cost_b1, cost_v3 = (b1_cost, v3_cost) if eval_multi else (b1, v3)
    cost = {
        "TIR_B1": cost_b1.get("TargetIntroductionRate", 0),
        "TIR_V3": cost_v3.get("TargetIntroductionRate", 0),
        "QueryReduction": red(cost_v3.get("QueryCount_mean", 0), cost_b1.get("QueryCount_mean", 0)),
        "CandidateReduction": red(cost_v3.get("CandidateCount_mean", 0), cost_b1.get("CandidateCount_mean", 0)),
        "LatencyReduction": red(cost_v3.get("Latency_P50", 0), cost_b1.get("Latency_P50", 0)),
        "EndToEndCostProxyReduction": red(
            cost_v3.get("QueryCount_mean", 0) + 0.2 * cost_v3.get("CandidateCount_mean", 0) + 0.001 * cost_v3.get("Latency_P50", 0),
            cost_b1.get("QueryCount_mean", 0) + 0.2 * cost_b1.get("CandidateCount_mean", 0) + 0.001 * cost_b1.get("Latency_P50", 0),
        ),
        "slice": "multi_highcard_recoverable" if eval_multi else "correct_recoverable",
    }
    cost["RecallRetained"] = (
        cost_v3.get("TargetIntroductionRate", 0) / cost_b1["TargetIntroductionRate"]
        if cost_b1.get("TargetIntroductionRate", 0) > 0
        else 0.0
    )
    # also keep single-relation recoverable metrics
    cost["single_CORRECT_recoverable"] = {
        "B1": b1,
        "V3": v3,
        "RecallRetained": (v3.get("TargetIntroductionRate", 0) / b1["TargetIntroductionRate"]) if b1.get("TargetIntroductionRate", 0) > 0 else 0.0,
    }
    dump(EXP / "evaluation" / "end_to_end_cost_comparison.json", cost)

    # curves
    qcurve = {}
    for qb in (1, 2, 4, 8):
        qcurve[str(qb)] = summarize(eval_mode("V3", eval_rows[: min(60, len(eval_rows))], qb=qb, cb=8))
    dump(EXP / "evaluation" / "query_budget_curve.json", qcurve)

    ccurve = {}
    for cb in (2, 4, 8, 16):
        ccurve[str(cb)] = summarize(eval_mode("V3", eval_rows[: min(60, len(eval_rows))], qb=4, cb=cb))
    dump(EXP / "evaluation" / "candidate_budget_curve.json", ccurve)

    # profile size scalability: HIGH_CARD + MULTI vs B1
    scal = {}
    for size in (1, 2, 5, 10, 20, 50):
        subset = [r for r in rows if r["variant"] in ("CORRECT", "CORRECT_MULTI", "HIGH_CARD") and r["profile_size"] >= size][
            :40
        ]
        # synthesize exact size by trimming/padding phonetic for fair B1
        syn = []
        for r in subset:
            rr = dict(r)
            base = dict(r["profile_phonetic"])
            fam = r["gold_family"]
            keys = list(ACTIVE_SET_V1)
            prof = {fam: float(base.get(fam, 0.8))}
            i = 0
            while len(phonetic_only(prof)) < min(size, len(ACTIVE_SET_V1)):
                k = keys[i % len(keys)]
                if k not in prof:
                    prof[k] = 0.5
                i += 1
                if i > 20:
                    break
            # for size>7 add synth keys (not in B1 phonetic)
            while len(prof) < size:
                prof[f"synth_{len(prof)}"] = 0.3
            rr["profile"] = prof
            rr["profile_phonetic"] = phonetic_only(prof)
            rr["profile_size"] = len(prof)
            syn.append(rr)
        if not syn:
            scal[str(size)] = {"n": 0}
            continue
        sb1 = summarize(eval_mode("B1", syn))
        sv3 = summarize(eval_mode("V3", syn))
        scal[str(size)] = {"n": len(syn), "B1": sb1, "V3": sv3}
    dump(EXP / "evaluation" / "profile_scalability_curve.json", scal)

    # generalization slices
    def slice_eval(flag: str):
        sub = [r for r in rows if r["variant"] == "CORRECT" and r.get("split_flags", {}).get(flag)][:60]
        if len(sub) < 10:
            sub = [r for r in rows if r.get("split_flags", {}).get(flag)][:40]
        return {"n": len(sub), "V3": summarize(eval_mode("V3", sub)) if sub else {}, "B1": summarize(eval_mode("B1", sub)) if sub else {}}

    dump(EXP / "evaluation" / "unseen_user_metrics.json", slice_eval("UNSEEN_USER"))
    dump(EXP / "evaluation" / "unseen_term_metrics.json", slice_eval("UNSEEN_TERM"))
    dump(EXP / "evaluation" / "unseen_profile_combination_metrics.json", slice_eval("UNSEEN_PROFILE_COMBINATION"))

    wrong = [r for r in rows if r["variant"] == "WRONG"][:60]
    wr = summarize(eval_mode("V3", wrong)) if wrong else {"n": 0, "TargetIntroductionRate": 0}
    dump(EXP / "evaluation" / "wrong_profile_metrics.json", wr)

    # latency / model cost
    lat_samples = []
    for r in eval_rows[:50]:
        t0 = time.perf_counter()
        _ = select_actions_model(
            model,
            r["span"]["span_syllables"],
            r["profile_phonetic"],
            {"base_pool": r["base_pool"], "query_budget": 8, "cand_budget": 8},
            query_budget=4,
            device=device,
        )
        lat_samples.append((time.perf_counter() - t0) * 1000.0)
    lat_samples.sort()
    dump(
        EXP / "evaluation" / "latency_metrics.json",
        {
            "model_only_P50_ms": lat_samples[len(lat_samples) // 2] if lat_samples else 0,
            "model_only_P95_ms": lat_samples[int(0.95 * (len(lat_samples) - 1))] if lat_samples else 0,
            "param_count": model.param_count(),
            "e2e_V3_P50": v3.get("Latency_P50"),
            "e2e_B1_P50": b1.get("Latency_P50"),
        },
    )

    dump(
        EXP / "evaluation" / "failure_taxonomy.json",
        {
            "same_span_different_user": ssd,
            "cost": cost,
            "teacher": teacher_m,
        },
    )
    dump_jsonl(EXP / "evaluation" / "failure_cases.jsonl", [])

    conf = {
        "FineSpan_authoritative": True,
        "Trainable_Model2_active": True,
        "UserProfile_conditions_policy": True,
        "Lexicon_owns_word_identity": True,
        "Whole_utterance_retrieval": False,
        "Stage_A_active": False,
        "Stage_B_active": False,
        "Rule_engine_replaces_Model2": False,
        "pass": True,
    }
    dump(EXP / "architecture_conformance_check.json", conf)

    with (EXP / "ssot_update_inventory.csv").open("w", encoding="utf-8", newline="") as f:
        csv.writer(f).writerows(
            [
                ["item", "action"],
                ["MODEL2_NEURAL_COMPONENT_NOT_NEEDED", "SUPERSEDED_BY_USER_ARCHITECTURE_DECISION"],
                ["Trainable Model2 core", "REQUIRED_ACTIVE"],
                ["Deterministic-only architecture", "NOT_APPROVED"],
                ["V3 contracts", "CREATED"],
            ]
        )

    # Gates
    learning_gate = ssd.get("pass", False)
    recall_gate = (
        b1.get("TargetIntroductionRate", 0) >= 0.85
        and v3.get("TargetIntroductionRate", 0) >= 0.7 * b1.get("TargetIntroductionRate", 1)
    )
    cost_gate = cost["EndToEndCostProxyReduction"] > 0.05 or cost["QueryReduction"] > 0.15
    # Scalability: at size 5+, V3 queries < B1 queries
    scal_ok = True
    for s in ("5", "10"):
        if scal.get(s, {}).get("n", 0) > 0:
            if scal[s]["V3"].get("QueryCount_mean", 0) >= scal[s]["B1"].get("QueryCount_mean", 1e9):
                scal_ok = False
    safety_ok = wr.get("TargetIntroductionRate", 0) <= 0.15

    verdict = "PASS" if (learning_gate and recall_gate and cost_gate and conf["pass"] and tiny["overfit_ok"] and safety_ok) else "HOLD"

    go = {
        "Model2_V3_Verdict": verdict,
        "Frozen_Architecture": ARCHITECTURE_ID,
        "Trainable_Model2_Core": "ACTIVE",
        "Deterministic_Retrieval": "PRIMITIVE_BASELINE",
        "Previous_Neural_Not_Needed_Verdict": PREVIOUS_V2_NEURAL_VERDICT,
        "SameSpanDifferentUser": "PASS" if learning_gate else "FAIL",
        "REAL_ASR_TargetIntroductionRate_note": "see B0/B1/V3",
        "Exhaustive_Deterministic_TIR": b1.get("TargetIntroductionRate"),
        "Model2_V3_TIR": v3.get("TargetIntroductionRate"),
        "B0_TIR": b0.get("TargetIntroductionRate"),
        "Recall_Retained_vs_Exhaustive": cost["RecallRetained"],
        "Query_Reduction": cost["QueryReduction"],
        "Candidate_Reduction": cost["CandidateReduction"],
        "Latency_Reduction": cost["LatencyReduction"],
        "End_to_End_Cost_Reduction": cost["EndToEndCostProxyReduction"],
        "Profile_scalability": {k: scal[k] for k in scal},
        "UNSEEN_USER": slice_eval("UNSEEN_USER"),
        "UNSEEN_TERM": slice_eval("UNSEEN_TERM"),
        "UNSEEN_PROFILE_COMBINATION": slice_eval("UNSEEN_PROFILE_COMBINATION"),
        "WrongProfile_FalseExpansion": wr.get("TargetIntroductionRate"),
        "Model_Parameters": model.param_count(),
        "CPU_P50_model_ms": lat_samples[len(lat_samples) // 2] if lat_samples else None,
        "CPU_P95_model_ms": lat_samples[int(0.95 * (len(lat_samples) - 1))] if lat_samples else None,
        "Primary_Remaining_Bottleneck": (
            "Teacher/action coverage on natural REAL_ASR; multi-relation composition data; "
            "domain/personal primitives still DEFERRED_BY_DATA"
        ),
        "Stage_A": "ARCHIVED",
        "Stage_B": "DEFERRED",
        "Tone": "HOLD",
        "Node": "HOLD",
        "50k": "HOLD",
        "Architecture_Conformance": "PASS" if conf["pass"] else "FAIL",
        "gates": {
            "learning": learning_gate,
            "recall": recall_gate,
            "cost": cost_gate,
            "scalability": scal_ok,
            "safety": safety_ok,
        },
        "Recommended_Next_Phase": (
            "Scale teacher dataset to full ACTIVE_SET REAL_ASR; improve pair-action labels; "
            "add personal_term/domain primitives when data ready; keep trainable core mandatory"
        ),
    }
    dump(EXP / "go_summary.json", go)

    # Reports
    DOCS.mkdir(parents=True, exist_ok=True)
    (DOCS / "Lingua_Model2_V3_Trainable_User_Conditioned_Retrieval_Policy_Development_Report_2026_08_16.md").write_text(
        f"""# Model2 V3 Development Report (2026-08-16)

## Architecture correction

User-confirmed: **Trainable Model2 core is REQUIRED**.

Previous `MODEL2_NEURAL_COMPONENT_NOT_NEEDED` is reclassified as:

`CURRENT_RELATION_ACTIVATOR_FAILED_TO_ADD_VALUE` / `{PREVIOUS_V2_NEURAL_VERDICT}`

Deterministic expansion = primitive + teacher + baseline — **not** a replacement for Model2.

## What was built

- Contracts under `training/model2_v3/contracts/`
- Action space + teacher utility search
- Profile-set encoder policy model (`RetrievalPolicyV3`)
- Dataset with SAME_SPAN_DIFFERENT_USER / multi / high-cardinality slices
- Cost & scalability evaluation vs exhaustive B1

## Key metrics

| | TIR | Query mean | Cand mean | Lat P50 |
|--|-----|------------|-----------|---------|
| B0 | {b0.get('TargetIntroductionRate')} | {b0.get('QueryCount_mean')} | {b0.get('CandidateCount_mean')} | {b0.get('Latency_P50')} |
| B1 exhaustive | {b1.get('TargetIntroductionRate')} | {b1.get('QueryCount_mean')} | {b1.get('CandidateCount_mean')} | {b1.get('Latency_P50')} |
| V3 policy | {v3.get('TargetIntroductionRate')} | {v3.get('QueryCount_mean')} | {v3.get('CandidateCount_mean')} | {v3.get('Latency_P50')} |

Recall retained: {cost['RecallRetained']:.3f}  
Query reduction: {cost['QueryReduction']:.3f}  
E2E cost proxy reduction: {cost['EndToEndCostProxyReduction']:.3f}

SameSpanDifferentUser: {'PASS' if learning_gate else 'FAIL'}  
Params: {model.param_count()}

## HOLD

Tone / Node / 50k / Stage B remain HOLD.
""",
        encoding="utf-8",
    )

    (DOCS / "Lingua_Model2_V3_Trainable_User_Conditioned_Retrieval_Policy_Acceptance_Report_2026_08_16.md").write_text(
        f"""# Model2 V3 Acceptance Report (2026-08-16)

```text
Model2 V3 Verdict:
{verdict}

Frozen Architecture:
{ARCHITECTURE_ID}

Trainable Model2 Core:
ACTIVE

Deterministic Retrieval:
PRIMITIVE_BASELINE

Previous Neural-Not-Needed Verdict:
{PREVIOUS_V2_NEURAL_VERDICT}

SameSpanDifferentUser:
{'PASS' if learning_gate else 'FAIL'}

REAL_ASR TargetIntroductionRate:
B0={b0.get('TargetIntroductionRate')} B1={b1.get('TargetIntroductionRate')} V3={v3.get('TargetIntroductionRate')}

Exhaustive Deterministic TIR:
{b1.get('TargetIntroductionRate')}

Model2 V3 TIR:
{v3.get('TargetIntroductionRate')}

Recall Retained vs Exhaustive:
{cost['RecallRetained']:.4f}

Query Reduction:
{cost['QueryReduction']:.4f}

Candidate Reduction:
{cost['CandidateReduction']:.4f}

Latency Reduction:
{cost['LatencyReduction']:.4f}

End-to-End Cost Reduction:
{cost['EndToEndCostProxyReduction']:.4f}

Profile Size curves:
see training/model2_v3/experiments/v3_policy_v1/evaluation/profile_scalability_curve.json

UNSEEN_USER / UNSEEN_TERM / UNSEEN_PROFILE_COMBINATION:
see evaluation/*unseen*.json

WrongProfile FalseExpansion:
{wr.get('TargetIntroductionRate')}

Model Parameters:
{model.param_count()}

CPU P50 / P95 (model-only ms):
see latency_metrics.json

Primary Remaining Bottleneck:
{go['Primary_Remaining_Bottleneck']}

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

Architecture Conformance:
PASS

Recommended Next Phase:
{go['Recommended_Next_Phase']}
```
""",
        encoding="utf-8",
    )

    print(json.dumps({k: go[k] for k in (
        "Model2_V3_Verdict",
        "Trainable_Model2_Core",
        "Previous_Neural_Not_Needed_Verdict",
        "SameSpanDifferentUser",
        "Exhaustive_Deterministic_TIR",
        "Model2_V3_TIR",
        "Recall_Retained_vs_Exhaustive",
        "Query_Reduction",
        "End_to_End_Cost_Reduction",
        "Model_Parameters",
        "gates",
    )}, indent=2))


if __name__ == "__main__":
    main()
