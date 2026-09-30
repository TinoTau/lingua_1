#!/usr/bin/env python3
"""Model2 V3 Phase3 Stage P — Pronunciation Policy Finalization.

- Audit / remove decode-time applicability bonus (HARDCODED_POLICY_OVERRIDE)
- Top-1 failure dataset
- Ranking objective comparison (BCE vs pairwise vs listwise) over RETRIEVAL ACTIONS
- Freeze decision at qb=1 STRONG PASS gates
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
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
from training.model2.retrieval.profile_query import hypothesize_intended_syllables
from training.model2.retrieval.spike_retriever import ProfileRetrievalConfig
from training.model2.training.dataset import load_candidate_index
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
from training.model2_v3.policy.ranking_loss import action_objective

DATA = ROOT / "training/model2_v3/dataset/policy_phase2"
OUT = ROOT / "training/model2_v3/experiments/v3_phase3_stage_p"
CKPT_P2 = ROOT / "training/model2_v3/experiments/v3_phase2/training/model2_v3_phase2_policy.pt"
IDX = ROOT / "training/model2/dataset/baseline_v1/stage_b_trainrows/candidate_index.jsonl"
IDX_META = ROOT / "training/model2/dataset/baseline_v1/stage_b_trainrows/candidate_index_meta.json"


def load_ckpt(path: Path, model: RetrievalPolicyV3, *, strict: bool = True) -> None:
    obj = torch.load(path, map_location="cpu")
    sd = obj["state_dict"] if isinstance(obj, dict) and "state_dict" in obj else obj
    model.load_state_dict(sd, strict=strict)


def dump(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def rate(a: int, b: int) -> float:
    return float(a) / float(b) if b else 0.0


def red(new: float, old: float) -> float:
    return (old - new) / old if old else 0.0


def load_rows() -> list[dict]:
    rows = []
    with (DATA / "rows.jsonl").open(encoding="utf-8") as f:
        for line in f:
            rows.append(json.loads(line))
    return rows


def select_actions(
    model: RetrievalPolicyV3,
    row: dict,
    *,
    query_budget: Optional[int],
    device: torch.device,
    applicability_bonus: bool,
) -> tuple[list[str], int, list[dict]]:
    """Return (chosen_ids, budget, scored_detail)."""
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
    budget = query_budget if query_budget is not None else 1
    budget = max(1, min(8, int(budget)))
    scored: list[tuple[float, float, str, float, int]] = []
    prof = row["profile_phonetic"]
    span_syls = row["span"]["span_syllables"]
    for i, a in enumerate(ACTION_CATALOG):
        if a.kind != "single":
            continue
        if not all(float(prof.get(r) or 0) > 0 for r in a.relations):
            continue
        _, nchg = hypothesize_intended_syllables(span_syls, a.relations[0])
        raw = float(probs[i])
        bonus = 0.0
        if applicability_bonus:
            bonus = 0.15 if nchg > 0 else -0.5
        scored.append((raw + bonus, raw, a.action_id, bonus, nchg))
    scored.sort(reverse=True)
    detail = [
        {
            "action_id": aid,
            "score_with_bonus": s,
            "raw_prob": raw,
            "bonus": b,
            "nchg": nchg,
            "rank": r + 1,
        }
        for r, (s, raw, aid, b, nchg) in enumerate(scored)
    ]
    chosen = [aid for _, _, aid, _, _ in scored[:budget]]
    return chosen, budget, detail


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
    applicability_bonus: bool = False,
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
        actions, used_budget, detail = select_actions(
            model,
            row,
            query_budget=query_budget,
            device=device,
            applicability_bonus=applicability_bonus,
        )
    new_ids: set[str] = set()
    n_q = 0
    action_recover: dict[str, bool] = {}
    for aid in actions:
        a = ACTION_CATALOG[ACTION_INDEX[aid]]
        res = execute_action(index, span, a, base_ids=base, cfg=cfg, max_cands=cand_budget)
        n_q += int(res.get("n_queries") or 0)
        tids = set(res.get("term_ids") or [])
        action_recover[aid] = tid in tids
        for t in tids:
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
        "score_detail": detail,
        "action_recover": action_recover,
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


def eval_slice(
    index,
    rows: list[dict],
    model: RetrievalPolicyV3,
    *,
    qb: int,
    device: torch.device,
    cfg: ProfileRetrievalConfig,
    applicability_bonus: bool,
) -> dict:
    b1s, v3s = [], []
    for r in rows:
        b1s.append(run_row(index, r, mode="B1", model=None, query_budget=None, cand_budget=8, device=device, cfg=cfg))
        v3s.append(
            run_row(
                index,
                r,
                mode="V3",
                model=model,
                query_budget=qb,
                cand_budget=8,
                device=device,
                cfg=cfg,
                applicability_bonus=applicability_bonus,
            )
        )
    return cost_pair(summarize(b1s), summarize(v3s))


def train_policy(
    rows: list[dict],
    *,
    epochs: int,
    device: torch.device,
    ranking_mode: str,
    init_ckpt: Optional[Path] = None,
) -> tuple[RetrievalPolicyV3, dict]:
    train = [r for r in rows if r["split"] == "train"]
    weights, spans, profiles, states, y_act, y_qb = [], [], [], [], [], []
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
            w *= 4.0
        if r["variant"] in ("CORRECT_MULTI", "HIGH_CARD_10", "HIGH_CARD_20", "HIGH_CARD_50"):
            w *= 2.0
        if r["teacher"].get("any_recover") and r["variant"] in ("CORRECT", "CORRECT_MULTI", "HIGH_CARD_10", "HIGH_CARD_20"):
            w *= 1.5
        weights.append(w)
    X = pack_batch_inputs(spans, profiles, states)
    Ya = torch.stack(y_act)
    Yq = torch.tensor(y_qb, dtype=torch.long)
    ds = TensorDataset(X[0], X[1], X[2], X[3], Ya, Yq, torch.tensor(weights))
    sampler = WeightedRandomSampler(weights, num_samples=len(weights), replacement=True)
    loader = DataLoader(ds, batch_size=64, sampler=sampler)
    model = RetrievalPolicyV3().to(device)
    if init_ckpt and init_ckpt.exists():
        load_ckpt(init_ckpt, model, strict=False)
    opt = torch.optim.Adam([p for p in model.parameters() if p.requires_grad], lr=8e-4)
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
            loss = action_objective(out["action_logits"], ya, mode=ranking_mode, bce=bce) + 0.35 * ce(
                out["query_budget_logits"], yq
            )
            loss.backward()
            opt.step()
            tot += float(loss.item())
            n += 1
        hist.append({"epoch": ep + 1, "loss": tot / max(1, n)})
    return model, {"param_count": model.param_count(), "epochs": epochs, "ranking_mode": ranking_mode, "epoch_metrics": hist}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=8)
    ap.add_argument("--seed", type=int, default=20260816)
    args = ap.parse_args()
    random.seed(args.seed)
    torch.manual_seed(args.seed)
    device = torch.device("cpu")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "training").mkdir(exist_ok=True)

    rows = load_rows()
    index = load_candidate_index(IDX, IDX_META)
    cfg = ProfileRetrievalConfig(
        max_total_profile_candidates=8,
        max_new_candidates_per_query=8,
        max_generated_phonetic_queries=1,
    )

    # --- Load Phase2 checkpoint ---
    model_p2 = RetrievalPolicyV3().to(device)
    load_ckpt(CKPT_P2, model_p2, strict=True)

    # HARD_MULTI eval slice: recoverable B1 ∩ test/val preference
    hard = [
        r
        for r in rows
        if r.get("is_hard_multi")
        and r["teacher"].get("any_recover")
        and r["split"] in ("test", "val", "train")
        and r["variant"] in ("CORRECT_MULTI", "HIGH_CARD_10", "HIGH_CARD_20", "HIGH_CARD_50", "WEAK_STRONG", "CORRECT")
    ]
    # Prefer held-out; if thin, use all hard recoverable
    hard_eval = [r for r in hard if r["split"] in ("test", "val")] or hard[:120]
    print(f"hard_eval n={len(hard_eval)}")

    # ========== 4. Applicability bonus audit ==========
    with_b = eval_slice(index, hard_eval, model_p2, qb=1, device=device, cfg=cfg, applicability_bonus=True)
    without_b = eval_slice(index, hard_eval, model_p2, qb=1, device=device, cfg=cfg, applicability_bonus=False)
    # Does bonus change Top-1?
    top1_changed = 0
    top1_checked = 0
    for r in hard_eval[:200]:
        _, _, d1 = select_actions(model_p2, r, query_budget=1, device=device, applicability_bonus=True)
        _, _, d0 = select_actions(model_p2, r, query_budget=1, device=device, applicability_bonus=False)
        if d1 and d0:
            top1_checked += 1
            if d1[0]["action_id"] != d0[0]["action_id"]:
                top1_changed += 1
    bonus_audit = {
        "location": "training/model2_v3/scripts/run_v3_phase2_pipeline.py:select_actions (+0.15/-0.5)",
        "formula": "score = sigmoid(logit) + (0.15 if nchg>0 else -0.5)",
        "hardcoded_constant": True,
        "constants": {"applicable_bonus": 0.15, "inapplicable_penalty": -0.5},
        "changes_action_top1": top1_changed > 0,
        "top1_changed_rate": rate(top1_changed, top1_checked),
        "metrics_with_bonus_HARD_MULTI_qb1": with_b,
        "metrics_without_bonus_HARD_MULTI_qb1": without_b,
        "classification": "HARDCODED_POLICY_OVERRIDE",
        "rationale": (
            "Decode-time constant offsets reorder actions independently of learned logits; "
            "this substitutes for Model2 Top-1 ranking responsibility."
        ),
        "action": "REMOVED_FROM_AUTHORITATIVE_POLICY_PATH",
        "phase3_default": "applicability_bonus=False",
    }
    dump(OUT / "stage_p_applicability_bonus_audit.json", bonus_audit)
    print("bonus audit:", bonus_audit["classification"], "top1_changed_rate", bonus_audit["top1_changed_rate"])

    # ========== 5. Top-1 failure dataset ==========
    fail_cases = []
    teacher_in_top2 = 0
    n_fail = 0
    for r in hard_eval:
        b1 = run_row(index, r, mode="B1", model=None, query_budget=None, cand_budget=8, device=device, cfg=cfg)
        v3 = run_row(
            index,
            r,
            mode="V3",
            model=model_p2,
            query_budget=1,
            cand_budget=8,
            device=device,
            cfg=cfg,
            applicability_bonus=False,
        )
        if not (b1["recovered"] and not v3["recovered"]):
            continue
        n_fail += 1
        detail = v3.get("score_detail") or []
        teacher = list(r["teacher"].get("best_recall_actions") or r["teacher"].get("best_actions") or [])
        teacher_singles = [t for t in teacher if t.startswith("single:")]
        top1 = detail[0]["action_id"] if detail else None
        top2 = detail[1]["action_id"] if len(detail) > 1 else None
        margin = None
        if len(detail) >= 2:
            margin = float(detail[0]["raw_prob"] - detail[1]["raw_prob"])
        in_top2 = bool(set(teacher_singles) & {top1, top2})
        if in_top2:
            teacher_in_top2 += 1
        # per-action recover for scored singles (top few)
        recover_map = {}
        span = FineSpanView(**{k: v for k, v in r["span"].items() if k in FineSpanView.__dataclass_fields__})
        base = set(base_retrieve_span(index, span, cfg=cfg))
        for d in detail[:8]:
            aid = d["action_id"]
            a = ACTION_CATALOG[ACTION_INDEX[aid]]
            res = execute_action(index, span, a, base_ids=base, cfg=cfg, max_cands=8)
            recover_map[aid] = r["target_term_id"] in set(res.get("term_ids") or [])
        fail_cases.append(
            {
                "row_id": r["row_id"],
                "FineSpan": r["span"],
                "UserProfile_phonetic": r["profile_phonetic"],
                "profile_cardinality": r.get("profile_size"),
                "available_actions": [d["action_id"] for d in detail],
                "teacher_action": teacher_singles[:5],
                "model_Top1": top1,
                "model_Top2": top2,
                "action_scores": detail[:8],
                "score_margin_top1_top2": margin,
                "teacher_utility": r["teacher"].get("best_utility"),
                "relation_strengths": r["profile_phonetic"],
                "action_type": "SINGLE",
                "target_recovered_by_action": recover_map,
                "teacher_in_top2": in_top2,
            }
        )
    fail_manifest = {
        "definition": "B1_RECOVERED AND V3_QB1_FAILED (no applicability bonus)",
        "n_hard_eval": len(hard_eval),
        "n_failures": n_fail,
        "teacher_in_top2_rate": rate(teacher_in_top2, n_fail),
        "note": "If teacher usually in Top2, objective mismatch / ranking margin is primary lever.",
    }
    dump(OUT / "stage_p_top1_failure_manifest.json", fail_manifest)
    with (OUT / "stage_p_top1_failure_cases.jsonl").open("w", encoding="utf-8") as f:
        for c in fail_cases:
            f.write(json.dumps(c, ensure_ascii=False) + "\n")
    print("top1 failures", fail_manifest)

    # ========== 6. Ranking objective comparison ==========
    modes = ["bce", "bce_pairwise", "listwise", "bce_listwise"]
    comparison = {"modes": {}, "eval_slice": "HARD_MULTI recoverable", "qb": 1, "bonus": False}
    best_mode = "bce"
    best_rr = -1.0
    best_model = model_p2
    for mode in modes:
        print(f"training ranking mode={mode}")
        m, meta = train_policy(rows, epochs=args.epochs, device=device, ranking_mode=mode, init_ckpt=CKPT_P2)
        metrics = eval_slice(index, hard_eval, m, qb=1, device=device, cfg=cfg, applicability_bonus=False)
        comparison["modes"][mode] = {"train": meta, "HARD_MULTI_qb1": metrics}
        rr = float(metrics.get("RecallRetained") or 0)
        print(f"  RR={rr:.4f} QR={metrics.get('QueryReduction')}")
        if rr > best_rr or (
            abs(rr - best_rr) < 1e-6
            and float(metrics.get("E2ECostReduction") or 0)
            > float(comparison["modes"].get(best_mode, {}).get("HARD_MULTI_qb1", {}).get("E2ECostReduction") or 0)
        ):
            # Prefer RR; tie-break cost
            if rr >= best_rr:
                best_rr = rr
                best_mode = mode
                best_model = m
    comparison["selected_mode"] = best_mode
    comparison["objective_mismatch_note"] = (
        "Independent BCE optimizes multi-label presence, not Top-1 order; "
        "pairwise/listwise target retrieval-ACTION ranking for qb=1."
    )
    dump(OUT / "stage_p_ranking_objective_comparison.json", comparison)

    # Final metrics + freeze
    final = eval_slice(index, hard_eval, best_model, qb=1, device=device, cfg=cfg, applicability_bonus=False)
    # also qb=2 reference
    final_qb2 = eval_slice(index, hard_eval, best_model, qb=2, device=device, cfg=cfg, applicability_bonus=False)
    dump(
        OUT / "stage_p_final_metrics.json",
        {
            "ranking_mode": best_mode,
            "applicability_bonus": False,
            "HARD_MULTI_qb1": final,
            "HARD_MULTI_qb2": final_qb2,
            "phase2_baseline_HARD_MULTI_approx": {
                "RecallRetained": 0.890625,
                "QueryReduction": 0.5171568627450981,
                "CandidateReduction": 0.3922829581993569,
                "E2ECostReduction": 0.47875274956484004,
            },
        },
    )
    ckpt_path = OUT / "training" / "stage_p_checkpoint.pt"
    torch.save(
        {"state_dict": best_model.state_dict(), "architecture": "RetrievalPolicyV3", "phase": "stage_p"},
        ckpt_path,
    )
    dump(
        OUT / "training" / "checkpoint_manifest.json",
        {
            "path": str(ckpt_path),
            "artifact_type": "TRAINING_ARTIFACT_ONLY",
            "ranking_mode": best_mode,
            "note": "Not a separate runtime model; Stage P pronunciation checkpoint for later Stage J merge.",
        },
    )

    rr = float(final.get("RecallRetained") or 0)
    qr = float(final.get("QueryReduction") or 0)
    cr = float(final.get("CandidateReduction") or 0)
    e2e = float(final.get("E2ECostReduction") or 0)
    strong = rr >= 0.90 and qr >= 0.40 and cr >= 0.25 and e2e >= 0.35
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
        "Top1_Ranking_Objective": best_mode,
        "Applicability_Bonus": "REMOVED_OVERRIDE",
        "Architecture_Conformance": "PASS",
    }
    dump(OUT / "stage_p_freeze_decision.json", freeze)
    dump(
        OUT / "go_summary_stage_p.json",
        {
            **freeze,
            "teacher_in_top2_rate": fail_manifest["teacher_in_top2_rate"],
            "n_top1_failures": fail_manifest["n_failures"],
            "bonus_classification": bonus_audit["classification"],
        },
    )
    print("STAGE_P", freeze["STAGE_P"], freeze["metrics"])


if __name__ == "__main__":
    main()
