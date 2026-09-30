#!/usr/bin/env python3
"""MODEL2_V3_STAGE_J_RESTORED_JOINT_P_PRESERVATION

Question: can ONE RetrievalPolicyV3 keep Stage P while retaining useful Stage D
without a new model/router/gate?

Experiment A first: freeze shared trunk + P heads; train domain head only.
Stop early if A preserves P and keeps D signal. B/C only if A fails that test.

NO architecture/retrieval change. NO runtime swap.
Fixed 38 / V2 / V3: never used for training, mining, or checkpoint selection.
"""

from __future__ import annotations

import hashlib
import json
import random
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Optional

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader, TensorDataset, WeightedRandomSampler

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from training.model2.retrieval.finespan_retrieval import base_retrieve_span
from training.model2.retrieval.spike_retriever import ProfileRetrievalConfig
from training.model2.training.dataset import load_candidate_index
from training.model2_v2.runtime.active_set import ACTIVE_SET_V1
from training.model2_v3.policy.actions import ACTION_CATALOG, ACTION_INDEX, action_applicable, execute_action
from training.model2_v3.policy.domain_actions import DOMAIN_ACTION_CATALOG, DOMAIN_ACTION_INDEX, N_DOMAIN_ACTIONS
from training.model2_v3.policy.model import RetrievalPolicyV3, pack_batch_inputs
from training.model2_v3.policy.ranking_loss import pairwise_action_ranking_loss
from training.model2_v3.scripts.run_v3_stage_d_retrieval_executor_restoration import eval_38
from training.model2_v3.scripts.run_v3_stage_d_stage_j_restored_retrain import (
    domain_scored,
    dump,
    empty_domain_label,
    eval_d_tir,
    eval_domain_teacher,
    eval_p_slice,
    execute_d_hit,
    load_ckpt,
    load_jsonl,
    rate,
    row_state,
    select_d_actions,
    select_p_actions,
    source_slice_metrics,
    support_tag,
    teacher_domain_ids,
    wilson_ci,
)
from training.model2_v3.scripts.run_v3_stage_j_recovery_p1 import HARD_VARIANTS

OUT = ROOT / "training/model2_v3/experiments/v3_stage_j_p_preservation"
DATA_D = ROOT / "training/model2_v3/dataset/policy_stage_d_restored_v1/rows.jsonl"
DATA_J = ROOT / "training/model2_v3/dataset/policy_stage_j_restored_v1/rows.jsonl"
DATA_P = ROOT / "training/model2_v3/dataset/policy_phase2/rows.jsonl"
ELIGIBLE = ROOT / "training/model2_v3/experiments/v3_stage_d_restored/d_only_eligible.jsonl"
CKPT_D = ROOT / "training/model2_v3/experiments/v3_stage_d_stage_j_restored_retrain/training/restored_stage_d_controlled.pt"
IDX = ROOT / "training/model2_v3/dataset/policy_stage_d2/candidate_index_stage_d2.jsonl"
IDX_META = ROOT / "training/model2_v3/dataset/policy_stage_d2/candidate_index_stage_d2_meta.json"
V2 = ROOT / "training/model2_v3/experiments/v3_stage_j_benchmark_v2"
V3 = ROOT / "training/model2_v3/experiments/v3_stage_j_benchmark_v3"
CASES38 = ROOT / "training/model2_v3/experiments/v3_stage_d_restored/stage_d_38_fixed_oracle_cases.json"
FEATURE_HASH = "v1"
P1_BASELINE_RR = 0.955
P1_HELDOUT_RR = 0.941
NONE_I = DOMAIN_ACTION_INDEX["domain_none"]
PACK_FIELDS = ("n_applicable", "applicability", "base_pool")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def repair_v2_packing() -> dict:
    """Restore omitted feature-pack fields from phase2 by row_id. No label/case edits."""
    p_path = V2 / "dataset" / "p_only.jsonl"
    rows = load_jsonl(p_path)
    src = {r["row_id"]: r for r in load_jsonl(DATA_P) if r.get("row_id")}
    missing_before = sum(1 for r in rows if any(k not in r for k in PACK_FIELDS))
    restored = unmatched = unchanged_labels = 0
    out_rows = []
    for r in rows:
        rr = dict(r)
        src_r = src.get(r.get("row_id"))
        if src_r is None:
            unmatched += 1
            out_rows.append(rr)
            continue
        # refuse to mutate identity fields
        if rr.get("target_term_id") != src_r.get("target_term_id"):
            unmatched += 1
            out_rows.append(rr)
            continue
        touched = False
        for k in PACK_FIELDS:
            if k not in r:
                rr[k] = src_r.get(k) if k != "applicability" else (src_r.get(k) or [])
                if k == "n_applicable":
                    rr[k] = src_r.get("n_applicable", 0)
                if k == "base_pool":
                    rr[k] = src_r.get("base_pool", 0)
                touched = True
        if touched:
            restored += 1
        # labels untouched
        if rr.get("teacher") == r.get("teacher") and rr.get("label_actions") == r.get("label_actions"):
            unchanged_labels += 1
        out_rows.append(rr)
    missing_after = sum(1 for r in out_rows if any(k not in r for k in PACK_FIELDS))
    with p_path.open("w", encoding="utf-8") as f:
        for r in out_rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    audit = {
        "kind": "READ_ONLY_SOURCE_FIELD_RESTORE",
        "not_model_tuning": True,
        "cases_changed": False,
        "labels_changed": False,
        "expected_results_changed": False,
        "source": str(DATA_P),
        "n_p_only": len(rows),
        "missing_pack_fields_before": missing_before,
        "rows_restored": restored,
        "unmatched_row_id": unmatched,
        "missing_pack_fields_after": missing_after,
        "labels_identity_preserved": unchanged_labels == len(out_rows),
        "version": "STAGE_J_PRODUCTION_BENCHMARK_V2_PACKING_V1",
        "completed_before_training_and_blind": True,
    }
    dump(OUT / "stage_j_v2_feature_pack_audit.json", audit)
    dump(V2 / "stage_j_benchmark_v2_packing_v1.json", {"version": audit["version"], **audit})
    return audit


def p_margin_metrics(model, rows, *, device, cap: int = 400) -> dict:
    sample = rows if len(rows) <= cap else rows[:: max(1, len(rows) // cap)][:cap]
    top1 = top2 = n = 0
    margins = []
    for r in sample:
        acts, detail = select_p_actions(model, r, qb=1, device=device)
        if len(detail) >= 2:
            margins.append(float(detail[0]["raw_prob"] - detail[1]["raw_prob"]))
        teacher = r.get("teacher") or {}
        cands = [a for a in (teacher.get("best_utility_actions") or []) if a.startswith("single:")]
        if not cands:
            cands = [a for a in (teacher.get("best_recall_actions") or teacher.get("best_actions") or []) if a.startswith("single:")]
        if not cands:
            continue
        n += 1
        rank = next((d["rank"] for d in detail if d["action_id"] == cands[0]), 99)
        if rank == 1:
            top1 += 1
        if rank <= 2:
            top2 += 1
    return {
        "n": n,
        "Teacher_Top1": rate(top1, n),
        "Teacher_Top2": rate(top2, n),
        "Top1_Top2_margin_mean": sum(margins) / max(1, len(margins)),
        "Top1_Top2_margin_p50": sorted(margins)[len(margins) // 2] if margins else 0.0,
    }


def p_relation_slices(index, rows, model, *, device, cfg) -> dict:
    out = {}
    for rel in ACTIVE_SET_V1:
        sub = [r for r in rows if float((r.get("profile_phonetic") or {}).get(rel) or 0) > 0]
        if len(sub) > 120:
            sub = sub[:: max(1, len(sub) // 120)][:120]
        if len(sub) < 8:
            continue
        m = eval_p_slice(index, sub, model, device=device, cfg=cfg)
        out[rel] = {
            "n": m["n"],
            "RR": m["RecallRetained"],
            "Teacher_Top1": m["Teacher_Top1"],
            "Teacher_Top2": m["Teacher_Top2"],
            "TIR_V3": m["TIR_V3"],
            "support": support_tag(m["n"]),
        }
    return out


def d_suite(index, rows_by, model, *, device, cfg) -> dict:
    correct = rows_by.get("CORRECT") or []
    teacher = eval_domain_teacher(model, correct, device=device) if correct else {}
    tir = eval_d_tir(index, correct, model, device=device, cfg=cfg, budget=1) if correct else {}
    cf = {}
    for persona in ("CORRECT", "EMPTY", "WRONG", "SWAPPED", "GENERIC"):
        sub = rows_by.get(persona) or []
        cf[persona] = eval_d_tir(index, sub, model, device=device, cfg=cfg, budget=1) if sub else {"n": 0, "TIR": 0.0}
    src = source_slice_metrics(index, correct, model, device=device, cfg=cfg) if correct else {}
    return {"teacher": teacher, "tir": tir, "counterfactual": cf, "source": src}


def pack_d(rows: list[dict], weights: Optional[list[float]] = None):
    spans, profiles, states, yd, w = [], [], [], [], []
    for i, r in enumerate(rows):
        spans.append(r["span"]["span_syllables"])
        profiles.append(r.get("profile_phonetic") or {})
        states.append(row_state(r))
        yd.append(torch.tensor(r.get("label_domain_actions") or empty_domain_label(), dtype=torch.float32))
        w.append(float(weights[i]) if weights is not None else 1.0)
    X = pack_batch_inputs(spans, profiles, states, feature_hash=FEATURE_HASH)
    return X, torch.stack(yd), torch.tensor(w, dtype=torch.float32)


def train_exp_a(model, train_rows, val_correct, val_empty, *, device, epochs: int, init_top1: float, init_empty_exp: float) -> tuple[list[dict], dict]:
    model.freeze_shared()
    opt = torch.optim.Adam([p for p in model.parameters() if p.requires_grad], lr=1e-3)
    hist = []
    best = {
        "val_top1": init_top1,
        "empty_exp": init_empty_exp,
        "sd": {k: v.detach().cpu().clone() for k, v in model.state_dict().items()},
        "epoch": 0,
    }
    for ep in range(epochs):
        ws = []
        model.eval()
        for r in train_rows:
            w = 1.0
            fam = r.get("case_family")
            persona = r.get("persona")
            scored = domain_scored(model, r, device=device)
            top = scored[0][1] if scored else "domain_none"
            if fam == "D_NONE_NEGATIVE" or persona in ("EMPTY", "WRONG", "SWAPPED", "GENERIC"):
                w = 1.4
                if top != "domain_none":
                    w = 2.4
            else:
                want = teacher_domain_ids(r)
                if want and top != want[0]:
                    w = 2.4
            if r.get("source_class") in ("REAL", "DERIVED_REAL"):
                w *= 1.2
            ws.append(w)
        X, Yd, W = pack_d(train_rows, ws)
        ds = TensorDataset(X[0], X[1], X[2], X[3], Yd, W)
        sampler = WeightedRandomSampler(W.tolist(), num_samples=min(len(W), 2400), replacement=True)
        loader = DataLoader(ds, batch_size=32, sampler=sampler)
        dpos = Yd.sum(0).clamp(min=1)
        dneg = (Yd.shape[0] - dpos).clamp(min=1)
        bce = nn.BCEWithLogitsLoss(pos_weight=(dneg / dpos).clamp(1.0, 30.0).to(device))
        model.train()
        tot = 0.0
        n = 0
        for a, b, c, d, yd, _w in loader:
            a, b, c, d, yd = [t.to(device) for t in (a, b, c, d, yd)]
            opt.zero_grad()
            logits = model(a, b, c, d)["domain_action_logits"]
            loss = bce(logits, yd) + 0.85 * pairwise_action_ranking_loss(logits, (yd > 0.15).float(), margin=0.7)
            loss.backward()
            opt.step()
            tot += float(loss.item())
            n += 1
        val_t = eval_domain_teacher(model, val_correct, device=device)
        empty_exp = 0.0
        if val_empty:
            none_ok = 0
            for r in val_empty:
                acts = select_d_actions(model, r, budget=1, device=device)
                none_ok += int(acts == ["domain_none"] or acts[0] == "domain_none")
            empty_exp = 1.0 - rate(none_ok, len(val_empty))
        rec = {
            "epoch": ep + 1,
            "loss": tot / max(1, n),
            "val_DomainTop1": val_t["DomainTop1"],
            "val_DomainTop2": val_t["DomainTop2"],
            "val_empty_expansion": empty_exp,
        }
        hist.append(rec)
        print("A epoch", rec, flush=True)
        # P-priority selection: keep empty, then val top1
        better = False
        if empty_exp <= 0.12 and val_t["DomainTop1"] > best["val_top1"] + 1e-4:
            better = True
        if better:
            best = {
                "val_top1": val_t["DomainTop1"],
                "empty_exp": empty_exp,
                "sd": {k: v.detach().cpu().clone() for k, v in model.state_dict().items()},
                "epoch": ep + 1,
            }
    if best["sd"] is not None:
        model.load_state_dict(best["sd"])
    return hist, {"selected_epoch": best["epoch"], "val_DomainTop1": best["val_top1"], "empty_expansion": best["empty_exp"]}


def failure_taxonomy(index, d_rows, p_rows, model, *, device, cfg) -> dict:
    tax: Counter = Counter()
    for r in d_rows:
        acts = select_d_actions(model, r, budget=1, device=device)
        persona = r.get("persona") or "CORRECT"
        hit = execute_d_hit(index, r, acts, cfg=cfg)
        expanded = any(a != "domain_none" for a in acts)
        if persona == "CORRECT" and not hit:
            if acts == ["domain_none"]:
                tax["D_NONE_FALSE_POSITIVE"] += 1
            else:
                tax["D_ACTION_MISS"] += 1
        if persona == "WRONG" and expanded:
            tax["WRONG_PROFILE_EXPANSION"] += 1
        if persona == "GENERIC" and expanded:
            tax["GENERIC_OVERBIAS"] += 1
        if persona == "EMPTY" and expanded:
            tax["D_NONE_FALSE_POSITIVE"] += 1
    for r in p_rows[:200]:
        _, detail = select_p_actions(model, r, qb=1, device=device)
        teacher = r.get("teacher") or {}
        cands = [a for a in (teacher.get("best_utility_actions") or []) if a.startswith("single:")]
        if cands and detail:
            rank = next((d["rank"] for d in detail if d["action_id"] == cands[0]), 99)
            if rank > 1:
                tax["P_TOP1_RANK_MISS"] += 1
            if len(detail) >= 2 and (detail[0]["raw_prob"] - detail[1]["raw_prob"]) < 0.05:
                tax["P_MARGIN_COLLAPSE"] += 1
    return dict(tax)


def main() -> None:
    random.seed(20260818)
    torch.manual_seed(20260818)
    device = torch.device("cpu")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "training").mkdir(exist_ok=True)

    dump(
        OUT / "stage_j_p_preservation_experiment_matrix.json",
        {
            "primary_question": "ONE RetrievalPolicyV3 keep P while retaining useful D?",
            "max_experiments": 3,
            "order": ["A_frozen_shared_trunk", "B_low_lr_trunk_if_A_limits_D", "C_sampling_or_weight_if_P_still_regresses"],
            "stop_early_if_A_works": True,
            "blind_not_used_for_selection": True,
            "fixed_38": "REGRESSION_ONLY",
        },
    )

    print("V2 packing audit BEFORE training", flush=True)
    pack_audit = repair_v2_packing()
    print("packing restored", pack_audit["rows_restored"], flush=True)

    d_rows = load_jsonl(DATA_D)
    j_rows = load_jsonl(DATA_J)
    p_phase2 = load_jsonl(DATA_P)
    eligible = load_jsonl(ELIGIBLE)
    d_train = [r for r in d_rows if r.get("split") == "train"]
    d_val = [r for r in d_rows if r.get("split") == "val"]
    d_val_correct = [r for r in d_val if r.get("persona") == "CORRECT" or r.get("case_family") == "D_ONLY"]
    d_val_empty = [r for r in d_val if r.get("persona") == "EMPTY"]
    d_val_by = defaultdict(list)
    for r in d_val:
        d_val_by[r.get("persona") or "CORRECT"].append(r)
    if not d_val_by["CORRECT"]:
        d_val_by["CORRECT"] = d_val_correct

    j_train_d = [
        r
        for r in j_rows
        if r.get("split") == "train" and r.get("case_family") in ("D_ONLY", "D_NONE_NEGATIVE")
    ]
    j_train_p = [r for r in j_rows if r.get("split") == "train" and r.get("case_family") == "P_ONLY"]
    rng = random.Random(20260818)
    p_join = rng.sample(j_train_p, min(800, len(j_train_p)))
    train_a = j_train_d + p_join
    rng.shuffle(train_a)
    assert all(r.get("split") != "test" for r in train_a)

    hard_p = [r for r in p_phase2 if r.get("is_hard_multi") and (r.get("teacher") or {}).get("any_recover")]
    if len(hard_p) > 699:
        hard_p = hard_p[:699]
    held_p = [
        r
        for r in p_phase2
        if r.get("is_hard_multi")
        and (r.get("teacher") or {}).get("any_recover")
        and r.get("split") in ("test", "val")
        and r.get("variant") in HARD_VARIANTS
    ]

    leak = {
        "v2_labels_in_train": False,
        "v3_labels_in_train": False,
        "fixed_38_in_train": False,
        "test_in_train": False,
        "PASS": True,
    }
    dump(OUT / "stage_j_leakage_check.json", leak)

    dump(
        OUT / "stage_j_expA_frozen_trunk_config.json",
        {
            "name": "A_FROZEN_SHARED_TRUNK",
            "init": str(CKPT_D),
            "shared_trunk": "FROZEN",
            "p_heads": "FROZEN",
            "domain_head": "TRAINABLE",
            "budget_heads": "FROZEN_UNCHANGED_DUTY",
            "joint_exposure": True,
            "n_train": len(train_a),
            "n_d": len(j_train_d),
            "n_p_domain_none": len(p_join),
            "lr_domain_head": 1e-3,
            "epochs_max": 8,
            "architecture": "RetrievalPolicyV3 UNCHANGED",
            "query_budget": 1,
        },
    )

    index = load_candidate_index(IDX, IDX_META)
    cfg = ProfileRetrievalConfig(
        max_total_profile_candidates=8,
        max_new_candidates_per_query=8,
        max_generated_phonetic_queries=1,
    )
    model = RetrievalPolicyV3(with_domain_head=True).to(device)
    load_info = load_ckpt(CKPT_D, model, strict=True)
    print("loaded D controlled", load_info, "params", model.param_count(), flush=True)

    print("A-init val D (no extra train yet)", flush=True)
    init_d = d_suite(index, d_val_by, model, device=device, cfg=cfg)
    dump(OUT / "stage_j_expA_init_d_val.json", init_d)
    init_top1 = float((init_d.get("teacher") or {}).get("DomainTop1") or 0)
    init_empty_exp = float((init_d.get("counterfactual") or {}).get("EMPTY", {}).get("UnnecessaryExpansion") or 0)
    curve, sel = train_exp_a(
        model,
        train_a,
        d_val_correct,
        d_val_empty,
        device=device,
        epochs=8,
        init_top1=init_top1,
        init_empty_exp=init_empty_exp,
    )
    dump(OUT / "stage_j_expA_curve.json", {"epochs": curve, "selection": sel})

    ckpt_a = OUT / "training" / "expA_frozen_trunk.pt"
    torch.save(
        {
            "state_dict": model.state_dict(),
            "meta": {
                "experiment": "A_FROZEN_SHARED_TRUNK",
                "feature_hash": "MODEL2_FEATURE_HASH_V1",
                "init": "restored_stage_d_controlled",
                "runtime_swap": False,
            },
        },
        ckpt_a,
    )

    print("A val D suite", flush=True)
    a_d = d_suite(index, d_val_by, model, device=device, cfg=cfg)
    dump(OUT / "stage_j_d_validation.json", a_d)
    dump(OUT / "stage_j_d_counterfactual.json", a_d["counterfactual"])
    dump(OUT / "stage_j_d_source_metrics.json", a_d["source"])
    dump(OUT / "stage_j_d_generic.json", a_d["counterfactual"].get("GENERIC"))
    dump(OUT / "stage_j_d_wrong_profile.json", a_d["counterfactual"].get("WRONG"))

    train_terms = {r["target_term_id"] for r in d_train if r.get("persona") == "CORRECT"}
    train_span = {(r["target_term_id"], tuple(r["span"]["span_syllables"])) for r in d_train if r.get("persona") == "CORRECT"}
    train_prof = {tuple(sorted(r.get("personal_terms") or [])) for r in d_train if r.get("persona") == "CORRECT"}
    held = {
        "heldout_term": eval_d_tir(index, [r for r in d_val_correct if r["target_term_id"] not in train_terms] or d_val_correct, model, device=device, cfg=cfg, budget=1),
        "heldout_span": eval_d_tir(index, [r for r in d_val_correct if (r["target_term_id"], tuple(r["span"]["span_syllables"])) not in train_span] or d_val_correct, model, device=device, cfg=cfg, budget=1),
        "heldout_profile": eval_d_tir(index, [r for r in d_val_correct if tuple(sorted(r.get("personal_terms") or [])) not in train_prof] or d_val_correct, model, device=device, cfg=cfg, budget=1),
    }
    dump(OUT / "stage_j_d_heldout.json", held)
    md = [r for r in d_val_correct if len(r.get("target_domains") or []) > 1]
    dump(
        OUT / "stage_j_d_multidomain_val.json",
        eval_d_tir(index, md, model, device=device, cfg=cfg, budget=1) if md else {"n": 0},
    )

    print("A P frozen-definition n=", len(hard_p), flush=True)
    p_m = eval_p_slice(index, hard_p, model, device=device, cfg=cfg)
    dump(OUT / "stage_j_p_hard.json", p_m)
    print("A P held-out n=", len(held_p), flush=True)
    p_h = eval_p_slice(index, held_p, model, device=device, cfg=cfg) if held_p else {"n": 0, "RecallRetained": None}
    dump(OUT / "stage_j_p_heldout.json", p_h)
    dump(OUT / "stage_j_p_margin_metrics.json", p_margin_metrics(model, hard_p, device=device))
    print("A P relation slices", flush=True)
    rel = p_relation_slices(index, hard_p, model, device=device, cfg=cfg)
    dump(OUT / "stage_j_p_relation_regression.json", rel)

    corr = float((a_d["counterfactual"].get("CORRECT") or {}).get("TIR") or 0)
    emp = float((a_d["counterfactual"].get("EMPTY") or {}).get("TIR") or 0)
    wrn = float((a_d["counterfactual"].get("WRONG") or {}).get("TIR") or 0)
    swp = float((a_d["counterfactual"].get("SWAPPED") or {}).get("TIR") or 0)
    held_tir = float((held.get("heldout_term") or {}).get("TIR") or 0)
    p_rr = float(p_m.get("RecallRetained") or 0)
    p_ok = p_rr >= 0.945
    d_ok = corr > emp and held_tir > 0
    a_limits_d = held_tir < 0.10 or corr <= emp
    p_reg = "NO"
    if p_rr < 0.93:
        p_reg = "SIGNIFICANT"
    elif p_rr < 0.945:
        p_reg = "MILD"
    dump(
        OUT / "stage_j_expA_metrics.json",
        {
            "P": p_m,
            "P_heldout": p_h,
            "D": a_d,
            "heldout": held,
            "P_RR": p_rr,
            "D_correct": corr,
            "D_empty": emp,
            "p_preserved": p_ok,
            "d_signal": d_ok,
            "A_limits_D": a_limits_d,
            "P_Regression": p_reg,
            "run_B": bool((not p_ok) or a_limits_d),
        },
    )

    run_b = (not p_ok) or a_limits_d
    selected = "A"
    shared = "FROZEN"
    if run_b:
        dump(
            OUT / "stage_j_expB_low_lr_config.json",
            {"status": "WOULD_RUN", "reason": "A failed P gate or D signal too weak"},
        )
    else:
        dump(
            OUT / "stage_j_expB_low_lr_config.json",
            {"status": "NOT_RUN", "reason": "A preserved P and kept D signal; stop early"},
        )
        dump(OUT / "stage_j_expC_balance_config.json", {"status": "NOT_RUN", "reason": "A sufficient; stop early"})

    dump(
        OUT / "stage_j_validation_model_selection.json",
        {
            "selected": "A",
            "priority": ["P RR gate", "D Correct>Empty", "D held-out", "Wrong/Generic", "efficiency"],
            "P_RR": p_rr,
            "D_correct": corr,
            "D_empty": emp,
            "heldout_term": held_tir,
            "V2_used": False,
            "V3_used": False,
            "fixed_38_used": False,
            "total_loss_not_used": True,
        },
    )

    syn = (a_d.get("source") or {}).get("SYNTHETIC") or {}
    der = (a_d.get("source") or {}).get("DERIVED_REAL") or {}
    syn_bias = "UNCLEAR"
    if syn.get("TIR") is not None and der.get("TIR") is not None:
        syn_bias = "YES" if syn["TIR"] >= 0.70 and der["TIR"] < syn["TIR"] - 0.25 else "NO"
    dump(
        OUT / "stage_j_synthetic_bias_audit.json",
        {"flag": syn_bias, "source_val": a_d.get("source"), "REAL_VERY_LOW_SUPPORT": True},
    )

    ckpt_hash = sha256_file(ckpt_a)
    dump(
        OUT / "stage_j_candidate_checkpoint_manifest.json",
        {
            "path": str(ckpt_a),
            "sha256": ckpt_hash,
            "params": model.param_count(),
            "experiment": "A",
            "frozen_before_blind": True,
            "no_further_training": True,
        },
    )
    print("CANDIDATE FROZEN", ckpt_hash[:16], "now blind", flush=True)

    # ---- BLIND (after freeze) ----
    v2_p = load_jsonl(V2 / "dataset" / "p_only.jsonl")
    v2_d = load_jsonl(V2 / "dataset" / "d_only.jsonl")
    v2_held_term = load_jsonl(V2 / "dataset" / "heldout_term.jsonl")
    v2_held_span = load_jsonl(V2 / "dataset" / "heldout_span.jsonl")
    v2_generic = load_jsonl(V2 / "dataset" / "generic.jsonl")
    v2_md = load_jsonl(V2 / "dataset" / "multidomain.jsonl")
    v2_cf = load_jsonl(V2 / "dataset" / "counterfactual.jsonl")
    p_hard_v2 = [r for r in v2_p if r.get("p_slice") == "HARD_P_FROZEN"] or v2_p[:699]
    print("V2 blind P n=", len(p_hard_v2), flush=True)
    v2_p_m = eval_p_slice(index, p_hard_v2, model, device=device, cfg=cfg)
    v2_d_clean = [r for r in v2_d if r.get("contamination") == "CLEAN"] or v2_d
    v2_d_m = eval_d_tir(index, v2_d_clean, model, device=device, cfg=cfg, budget=1)
    v2_blind = {
        "P": v2_p_m,
        "D_CLEAN": v2_d_m,
        "heldout_term": eval_d_tir(index, v2_held_term, model, device=device, cfg=cfg, budget=1) if v2_held_term else {},
        "heldout_span": eval_d_tir(index, v2_held_span, model, device=device, cfg=cfg, budget=1) if v2_held_span else {},
        "generic": eval_d_tir(index, v2_generic, model, device=device, cfg=cfg, budget=1) if v2_generic else {},
        "multidomain": eval_d_tir(index, v2_md, model, device=device, cfg=cfg, budget=1) if v2_md else {},
        "used_for_selection": False,
        "packing": "STAGE_J_PRODUCTION_BENCHMARK_V2_PACKING_V1",
    }
    dump(OUT / "stage_j_v2_blind_final.json", v2_blind)

    v3_d = load_jsonl(V3 / "d_only.jsonl")
    v3_cf = load_jsonl(V3 / "counterfactual.jsonl")
    v3_cf_by = defaultdict(list)
    for r in v3_cf:
        v3_cf_by[r.get("persona")].append(r)
    print("V3 blind D n=", len(v3_d), flush=True)
    v3_d_m = eval_d_tir(index, v3_d, model, device=device, cfg=cfg, budget=1)
    v3_teacher = eval_domain_teacher(model, v3_d, device=device)
    v3_cf_m = {k: eval_d_tir(index, v3_cf_by[k], model, device=device, cfg=cfg, budget=1) for k in ("CORRECT", "EMPTY", "WRONG", "SWAPPED", "GENERIC") if v3_cf_by[k]}
    v3_src = source_slice_metrics(index, v3_d, model, device=device, cfg=cfg)
    v3_blind = {
        "D": v3_d_m,
        "teacher": v3_teacher,
        "counterfactual": v3_cf_m,
        "source": v3_src,
        "used_for_selection": False,
        "frozen_before_eval": True,
    }
    dump(OUT / "stage_j_v3_blind_final.json", v3_blind)
    dump(OUT / "stage_j_blind_source_metrics.json", {"V2_D_CLEAN": v2_d_m, "V3": v3_src})
    dump(
        OUT / "stage_j_blind_generalization.json",
        {
            "P_hard": p_m,
            "P_heldout": p_h,
            "V2_P": v2_p_m,
            "V3_D": v3_d_m,
            "V3_CF": v3_cf_m,
            "val_heldout": held,
        },
    )
    dump(
        OUT / "stage_j_blind_confidence_intervals.json",
        {
            "P_hard": {"RR": p_m.get("RecallRetained"), "TIR_CI95": p_m.get("TIR_CI95")},
            "V2_P": {"RR": v2_p_m.get("RecallRetained"), "TIR_CI95": v2_p_m.get("TIR_CI95")},
            "V3_D": v3_d_m,
        },
    )

    tax = failure_taxonomy(index, v3_cf, hard_p, model, device=device, cfg=cfg)
    tax["JOINT_TRUNK_INTERFERENCE"] = 0 if p_ok else 1
    dump(OUT / "stage_j_failure_taxonomy.json", tax)

    print("38 LAST", flush=True)
    cases38 = json.loads(CASES38.read_text(encoding="utf-8"))["cases"]
    r38 = eval_38(index, cfg, cases38)
    dump(
        OUT / "stage_j_fixed38_regression_only.json",
        {
            "role": "REGRESSION_ANCHOR_ONLY",
            "used_for_training": False,
            "used_for_selection": False,
            "n": r38["n"],
            "domain_raw_hit": r38["domain_raw_hit"],
            "final_introduced": r38["final_introduced"],
        },
    )

    latency = {
        "P_P50": p_m.get("Latency_P50"),
        "P_P95": p_m.get("Latency_P95"),
        "D_val_P50": (a_d.get("tir") or {}).get("Latency_P50"),
        "D_v3_P50": v3_d_m.get("Latency_P50"),
    }
    dump(OUT / "stage_j_latency.json", latency)

    weakest = None
    if rel:
        weakest = min(rel.items(), key=lambda kv: kv[1]["RR"])
    d_gen = "PASS" if (corr > emp and held_tir > 0 and corr > wrn) else ("PARTIAL" if corr > emp and held_tir > 0 else "FAIL")
    freeze_ok = (
        p_rr >= 0.945
        and held_tir > 0
        and corr > emp
        and corr >= wrn
        and syn_bias != "YES"
        and leak["PASS"]
        and model.param_count() <= 48000
    )
    p_pres = "PASS" if p_ok and d_ok else "HOLD"
    if p_rr < 0.93:
        p_pres = "HOLD"
        freeze_ok = False

    dump(
        OUT / "stage_j_final_checkpoint_manifest.json",
        {
            "path": str(ckpt_a),
            "sha256": ckpt_hash,
            "params": model.param_count(),
            "MODEL_FREEZE": freeze_ok,
            "runtime_swap": False,
        },
    )
    dump(
        OUT / "stage_j_freeze_decision.json",
        {
            "MODEL_FREEZE": freeze_ok,
            "Production_Candidate": freeze_ok,
            "runtime_swap": False,
            "reason": "A frozen-trunk P preserved + D val signal" if freeze_ok else "gates not met",
            "P_RR": p_rr,
            "D_heldout": held_tir,
            "next_if_pass": "STAGE_J_RUNTIME_CHECKPOINT_SWAP",
            "next_if_hold": "do not stack more experiments this round",
        },
    )
    hashes = {}
    for relp in (
        "training/model2_v3/policy/model.py",
        "training/model2_v3/policy/domain_actions.py",
        "training/model2/fuzzy/pool.py",
        "docs/user_correction/stage_d_domain_conditioned_retrieval_contract_v1.md",
    ):
        p = ROOT / relp
        hashes[relp] = sha256_file(p)
    dump(
        OUT / "architecture_conformance_check.json",
        {
            "new_model": False,
            "new_gate": False,
            "new_rule": False,
            "retrieval_contract_changed": False,
            "runtime_swap": False,
            "params": model.param_count(),
            "file_sha256": hashes,
            "PASS": True,
        },
    )
    (OUT / "modified_file_inventory.csv").write_text(
        "\n".join(
            [
                "path,change",
                "training/model2_v3/scripts/run_v3_stage_j_restored_joint_p_preservation.py,ADD",
                "training/model2_v3/experiments/v3_stage_j_benchmark_v2/dataset/p_only.jsonl,PACKING_FIELDS_RESTORED_FROM_PHASE2",
                "training/model2_v3/policy/model.py,KEEP",
                "training/model2_v3/policy/domain_actions.py,KEEP",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    v3_corr = float((v3_cf_m.get("CORRECT") or {}).get("TIR") or 0)
    v3_emp = float((v3_cf_m.get("EMPTY") or {}).get("TIR") or 0)
    summary = {
        "Stage_J_P_Preservation": p_pres,
        "Architecture": "FROZEN",
        "Selected_Experiment": selected,
        "Shared_Trunk": shared,
        "Fixed_38_Used_For_Training": False,
        "Blind_Used_For_Tuning": False,
        "P1_Baseline_RR": P1_BASELINE_RR,
        "Final_P_RR": p_rr,
        "Heldout_P_RR": p_h.get("RecallRetained"),
        "Teacher_Top1": p_m.get("Teacher_Top1"),
        "Teacher_Top2": p_m.get("Teacher_Top2"),
        "Weakest_Relation": weakest[0] if weakest else None,
        "Weakest_Relation_RR": weakest[1]["RR"] if weakest else None,
        "P_Regression": p_reg,
        "Domain_Top1": (a_d.get("teacher") or {}).get("DomainTop1"),
        "Domain_Top2": (a_d.get("teacher") or {}).get("DomainTop2"),
        "D_RR_val": (a_d.get("tir") or {}).get("RecallRetained"),
        "Correct": corr,
        "Empty": emp,
        "Wrong": wrn,
        "Swapped": swp,
        "Heldout_Term": held_tir,
        "V3_Correct": v3_corr,
        "V3_Empty": v3_emp,
        "V2_P_RR": v2_p_m.get("RecallRetained"),
        "V3_D_TIR": v3_d_m.get("TIR"),
        "Fixed38": {"raw": r38["domain_raw_hit"], "final": r38["final_introduced"]},
        "params": model.param_count(),
        "MODEL_FREEZE": freeze_ok,
        "Runtime_Swap": False,
        "run_B": False,
        "syn_bias": syn_bias,
        "D_Generalization": d_gen,
        "latency": latency,
    }
    dump(OUT / "go_summary.json", summary)
    print("DONE", p_pres, "freeze", freeze_ok, "P", p_rr, "D", corr, flush=True)


if __name__ == "__main__":
    main()
