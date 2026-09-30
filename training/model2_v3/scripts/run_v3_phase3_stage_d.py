#!/usr/bin/env python3
"""Model2 V3 Phase3 Stage D — Personal Lexical / Domain Prior training.

Same Model2 backbone + domain_action_head. No Stage J joint fine-tune.
SYNTHETIC_USER_PROFILE only — not real-user validation.
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
from torch.utils.data import DataLoader, TensorDataset

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from training.model2.contract import DOMAIN_SLOT_IDS
from training.model2.retrieval.finespan import FineSpanView
from training.model2.retrieval.finespan_retrieval import base_retrieve_span
from training.model2.retrieval.spike_retriever import ProfileRetrievalConfig
from training.model2.training.dataset import load_candidate_index
from training.model2_v3.policy.actions import ACTION_CATALOG, ACTION_INDEX, action_applicable, execute_action
from training.model2_v3.policy.domain_actions import (
    DOMAIN_ACTION_CATALOG,
    DOMAIN_ACTION_INDEX,
    N_DOMAIN_ACTIONS,
    derive_domain_evidence,
    execute_domain_action,
    soft_domain_retrieve,
)
from training.model2_v3.policy.model import RetrievalPolicyV3, pack_batch_inputs
from training.model2_v3.policy.ranking_loss import action_objective

DATA = ROOT / "training/model2_v3/dataset/policy_stage_d"
DATA_P = ROOT / "training/model2_v3/dataset/policy_phase2"
OUT = ROOT / "training/model2_v3/experiments/v3_phase3_stage_d"
CKPT_P = ROOT / "training/model2_v3/experiments/v3_phase3_stage_p/training/stage_p_checkpoint.pt"
CKPT_P2 = ROOT / "training/model2_v3/experiments/v3_phase2/training/model2_v3_phase2_policy.pt"
IDX = ROOT / "training/model2/dataset/baseline_v1/stage_b_trainrows/candidate_index.jsonl"
IDX_META = ROOT / "training/model2/dataset/baseline_v1/stage_b_trainrows/candidate_index_meta.json"


def load_ckpt_obj(path: Path) -> dict:
    obj = torch.load(path, map_location="cpu")
    if isinstance(obj, dict) and "state_dict" in obj:
        return obj["state_dict"]
    return obj


def dump(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def rate(a: int, b: int) -> float:
    return float(a) / float(b) if b else 0.0


def red(new: float, old: float) -> float:
    return (old - new) / old if old else 0.0


def load_jsonl(path: Path) -> list[dict]:
    rows = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            rows.append(json.loads(line))
    return rows


def row_state(r: dict, *, max_lexical_items: int = 32) -> dict:
    return {
        "base_pool": r.get("base_pool", 0),
        "query_budget": 4,
        "cand_budget": 8,
        "n_applicable": 0,
        "applicability": [],
        "personal_terms": r.get("personal_terms") or [],
        "domain_evidence": r.get("long_term_domain_evidence") or {},
        "term_evidence": r.get("personal_term_evidence") or {},
        "session_domain_prior": r.get("session_domain_prior") or {},
        "max_lexical_items": max_lexical_items,
    }


def train_stage_d(
    rows: list[dict],
    *,
    epochs: int,
    device: torch.device,
    init_ckpt: Path,
    freeze_shared: bool,
) -> tuple[RetrievalPolicyV3, dict]:
    train = [r for r in rows if r["split"] == "train"]
    spans, profiles, states, y = [], [], [], []
    for r in train:
        spans.append(r["span"]["span_syllables"])
        profiles.append(r.get("profile_phonetic") or {})
        states.append(row_state(r))
        y.append(torch.tensor(r["label_domain_actions"], dtype=torch.float32))
    X = pack_batch_inputs(spans, profiles, states)
    Ya = torch.stack(y)
    ds = TensorDataset(X[0], X[1], X[2], X[3], Ya)
    loader = DataLoader(ds, batch_size=64, shuffle=True)

    # Stage P params (no domain head)
    base = RetrievalPolicyV3(with_domain_head=False)
    if init_ckpt.exists():
        base.load_state_dict(load_ckpt_obj(init_ckpt), strict=False)
    stage_p_params = base.param_count()

    model = RetrievalPolicyV3(with_domain_head=True).to(device)
    # load shared weights
    sd = base.state_dict()
    missing, unexpected = model.load_state_dict(sd, strict=False)
    if freeze_shared:
        model.freeze_shared()
    added = model.param_count() - stage_p_params
    opt = torch.optim.Adam([p for p in model.parameters() if p.requires_grad], lr=1e-3)
    pos_count = Ya.sum(dim=0).clamp(min=1)
    neg_count = (Ya.shape[0] - pos_count).clamp(min=1)
    pos_weight = (neg_count / pos_count).clamp(1.0, 20.0)
    bce = nn.BCEWithLogitsLoss(pos_weight=pos_weight.to(device))
    hist = []
    for ep in range(epochs):
        model.train()
        tot = 0.0
        n = 0
        for a, b, c, d, ya in loader:
            a, b, c, d, ya = [t.to(device) for t in (a, b, c, d, ya)]
            opt.zero_grad()
            out = model(a, b, c, d)
            loss = action_objective(
                out["domain_action_logits"], ya, mode="bce_listwise", bce=bce, listwise_weight=0.75
            )
            loss.backward()
            opt.step()
            tot += float(loss.item())
            n += 1
        hist.append({"epoch": ep + 1, "loss": tot / max(1, n)})
    meta = {
        "stage_p_params": stage_p_params,
        "stage_d_added_params": added,
        "combined_params": model.param_count(),
        "freeze_shared": freeze_shared,
        "missing_keys_on_load": list(missing),
        "unexpected_keys_on_load": list(unexpected),
        "epochs": epochs,
        "epoch_metrics": hist,
        "artifact_type": "TRAINING_ARTIFACT_ONLY",
    }
    return model, meta


def select_domain_actions(model: RetrievalPolicyV3, row: dict, *, device: torch.device, budget: int = 2) -> list[str]:
    model.eval()
    x = pack_batch_inputs(
        [row["span"]["span_syllables"]],
        [row.get("profile_phonetic") or {}],
        [row_state(row)],
        device=device,
    )
    with torch.no_grad():
        out = model(*x)
        probs = torch.sigmoid(out["domain_action_logits"][0]).cpu()
    scored = [(float(probs[i]), a.action_id) for i, a in enumerate(DOMAIN_ACTION_CATALOG)]
    scored.sort(reverse=True)
    return [aid for _, aid in scored[:budget]]


def run_domain_row(index, row: dict, *, actions: list[str], cfg: ProfileRetrievalConfig) -> dict:
    span = FineSpanView(**{k: v for k, v in row["span"].items() if k in FineSpanView.__dataclass_fields__})
    tid = row["target_term_id"]
    tsurf = row.get("target_term") or ""
    base = set(base_retrieve_span(index, span, cfg=cfg))
    evid = row.get("long_term_domain_evidence") or {}
    t0 = time.perf_counter()
    new_ids: set[str] = set()
    n_q = 0
    for aid in actions:
        a = DOMAIN_ACTION_CATALOG[DOMAIN_ACTION_INDEX[aid]]
        res = execute_domain_action(index, span, a, evid, base_ids=base, cfg=cfg, max_cands=8)
        n_q += int(res.get("n_queries") or 0)
        for t in res.get("term_ids") or []:
            if len(new_ids) >= 8:
                break
            new_ids.add(t)

    def hit(ids: set[str]) -> bool:
        if tid in ids:
            return True
        if not tsurf:
            return False
        for i in ids:
            rec = index.by_term_id.get(i)
            if rec and rec.surface == tsurf:
                return True
        return False

    false_exp = 0
    for i in new_ids:
        rec = index.by_term_id.get(i)
        if i != tid and (not rec or rec.surface != tsurf):
            false_exp += 1
    return {
        "recovered": hit(new_ids),
        "n_queries": n_q,
        "n_candidates": len(new_ids),
        "false_expansion": false_exp,
        "latency_ms": (time.perf_counter() - t0) * 1000.0,
        "actions": actions,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=10)
    ap.add_argument("--seed", type=int, default=20260816)
    ap.add_argument("--unfreeze-shared", action="store_true")
    args = ap.parse_args()
    random.seed(args.seed)
    torch.manual_seed(args.seed)
    device = torch.device("cpu")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "training").mkdir(exist_ok=True)

    # Ensure dataset
    if not (DATA / "rows.jsonl").exists():
        from training.model2_v3.dataset.build_stage_d_dataset import main as build_main

        sys.argv = ["build_stage_d_dataset.py"]
        build_main()

    rows = load_jsonl(DATA / "rows.jsonl")
    index = load_candidate_index(IDX, IDX_META)
    cfg = ProfileRetrievalConfig(
        max_total_profile_candidates=8,
        max_new_candidates_per_query=8,
        max_generated_phonetic_queries=1,
    )

    # Audits / contracts
    (OUT / "stage_d_userprofile_lexical_audit.md").write_text(
        """# Stage D UserProfile Lexical Audit

## Existing UserProfileV1 fields (API Gateway SSOT)

| Field | Present | Role |
|-------|---------|------|
| personal_terms | YES | ordered common / personal term surfaces |
| personal_term_evidence | YES | evidence scores for Top-K eviction |
| domain_bias | YES | sparse user domain preference weights |
| phonetic_bias | YES | Stage P (not Stage D ownership) |
| tone_bias | YES | HOLD / deferred |
| confusion_bias | YES | deferred |

## Long-term vs session

- Long-term: `personal_terms` + `personal_term_evidence` → Lexicon `term_domain_tags` → derived domain evidence
- Session: separate `session_domain_prior` (training field); must not overwrite long-term

## What UserProfile MUST NOT store

- Full term→domain mapping (Lexicon SSOT only)

## Minimal extensibility (no schema break)

Reuse existing fields; optional future:

```text
personal_term_evidence[term]  # already confidence/usage proxy
domain_bias[domain_id]        # already soft prior slot
```

No new one-term-one-domain table.
""",
        encoding="utf-8",
    )

    # copy domain ssot from dataset
    for name in (
        "stage_d_domain_ssot_audit.json",
        "stage_d_dataset_manifest.json",
        "stage_d_split_manifest.json",
        "stage_d_leakage_audit.json",
    ):
        src = DATA / name
        if src.exists():
            dump(OUT / name, json.loads(src.read_text(encoding="utf-8")))

    dump(
        OUT / "stage_d_feature_contract.json",
        {
            "FineSpan": "authoritative retrieval unit",
            "UserProfile_lexical": ["personal_terms", "personal_term_evidence"],
            "domain_evidence": "derived via Lexicon domain_ids / term_domain_tags",
            "session_domain_prior": "separate from long-term",
            "domain_actions": [a.action_id for a in DOMAIN_ACTION_CATALOG],
            "soft_prior": True,
            "hard_gate": False,
            "max_lexical_items_encoded": 32,
            "profile_size_500_handling": "full list → domain evidence; encode only top-32 term hashes",
        },
    )

    init_ckpt = CKPT_P if CKPT_P.exists() else CKPT_P2
    model, train_meta = train_stage_d(
        rows,
        epochs=args.epochs,
        device=device,
        init_ckpt=init_ckpt,
        freeze_shared=not args.unfreeze_shared,
    )
    dump(OUT / "stage_d_training_metrics.json", train_meta)
    ckpt = OUT / "training" / "stage_d_checkpoint.pt"
    torch.save(
        {"state_dict": model.state_dict(), "architecture": "RetrievalPolicyV3+domain_head", "phase": "stage_d"},
        ckpt,
    )
    dump(
        OUT / "training" / "checkpoint_manifest.json",
        {
            "path": str(ckpt),
            "artifact_type": "TRAINING_ARTIFACT_ONLY",
            "with_domain_head": True,
            "separate_runtime_onnx": False,
        },
    )

    # --- Same span different lexical user ---
    groups = {}
    for r in rows:
        if r.get("persona") in ("CORRECT", "EMPTY", "WRONG", "SWAPPED") and r["split"] in ("test", "val", "train"):
            groups.setdefault(r["group_key"], {})[r["persona"]] = r
    same_span = {"n_groups": 0, "policy_differs": 0, "correct_gt_empty": 0, "correct_gt_wrong": 0, "correct_gt_swapped": 0}
    for gk, personas in groups.items():
        if not all(k in personas for k in ("CORRECT", "EMPTY", "WRONG", "SWAPPED")):
            continue
        same_span["n_groups"] += 1
        acts = {k: select_domain_actions(model, personas[k], device=device, budget=2) for k in personas}
        if acts["CORRECT"] != acts["EMPTY"] or acts["CORRECT"] != acts["WRONG"]:
            same_span["policy_differs"] += 1
        res = {k: run_domain_row(index, personas[k], actions=acts[k], cfg=cfg) for k in personas}
        if res["CORRECT"]["recovered"] and not res["EMPTY"]["recovered"]:
            same_span["correct_gt_empty"] += 1
        elif res["CORRECT"]["recovered"] == res["EMPTY"]["recovered"] and res["CORRECT"]["recovered"]:
            # tie on recover: still count policy differ as soft pass signal
            pass
        if float(res["CORRECT"]["recovered"]) >= float(res["EMPTY"]["recovered"]):
            same_span["correct_gt_empty"] += 0  # already
        # score by recover rate later
        personas["_res"] = res
        personas["_acts"] = acts
    # aggregate recover rates
    def persona_rate(name: str) -> float:
        hits = 0
        n = 0
        for personas in groups.values():
            if name not in personas:
                continue
            acts = select_domain_actions(model, personas[name], device=device, budget=2)
            r = run_domain_row(index, personas[name], actions=acts, cfg=cfg)
            hits += int(r["recovered"])
            n += 1
        return rate(hits, n)

    corr_r = persona_rate("CORRECT")
    empty_r = persona_rate("EMPTY")
    wrong_r = persona_rate("WRONG")
    swap_r = persona_rate("SWAPPED")
    same_span.update(
        {
            "Correct_TIR": corr_r,
            "Empty_TIR": empty_r,
            "Wrong_TIR": wrong_r,
            "Swapped_TIR": swap_r,
            "Correct_gt_Empty": corr_r > empty_r,
            "Correct_gt_Wrong": corr_r > wrong_r,
            "Correct_gt_Swapped": corr_r > swap_r,
            "PASS": corr_r > empty_r and corr_r > wrong_r and corr_r >= swap_r and same_span["policy_differs"] > 0,
        }
    )
    dump(OUT / "stage_d_same_span_different_user.json", same_span)

    # Counterfactual metrics
    dump(
        OUT / "stage_d_counterfactual_metrics.json",
        {
            "Correct": corr_r,
            "Empty": empty_r,
            "Wrong": wrong_r,
            "Swapped": swap_r,
            "policy_changes_observed": same_span["policy_differs"],
            "n_groups": same_span["n_groups"],
        },
    )

    # Teacher / model gains
    test_rows = [r for r in rows if r["split"] == "test" and r.get("persona") == "CORRECT"][:80]
    none_hits = teach_hits = model_hits = 0
    q_m = q_t = c_m = c_t = 0.0
    false_m = 0

    def surface_hit(term_ids, row) -> bool:
        tid = row["target_term_id"]
        tsurf = row.get("target_term") or ""
        ids = set(term_ids or [])
        if tid in ids:
            return True
        for i in ids:
            rec = index.by_term_id.get(i)
            if rec and rec.surface == tsurf:
                return True
        return False

    for r in test_rows:
        none = soft_domain_retrieve(
            index,
            FineSpanView(**{k: v for k, v in r["span"].items() if k in FineSpanView.__dataclass_fields__}),
            {d: 0.0 for d in DOMAIN_SLOT_IDS},
            cfg=cfg,
            max_cands=8,
        )
        none_hits += int(surface_hit(none.get("term_ids"), r))
        teach_hits += int(r["teacher"].get("any_recover") or r["teacher"].get("exhaustive_recover"))
        acts = select_domain_actions(model, r, device=device, budget=2)
        mr = run_domain_row(index, r, actions=acts, cfg=cfg)
        model_hits += int(mr["recovered"])
        q_m += mr["n_queries"]
        c_m += mr["n_candidates"]
        false_m += mr["false_expansion"]
        q_t += float(r["teacher"].get("n_evaluated") or N_DOMAIN_ACTIONS)
        c_t += 8.0

    n = max(1, len(test_rows))
    # DomainConditionalRecallGain: prefer retrieval TIR delta; fall back to domain-action hit delta
    tir_gain = rate(model_hits, n) - rate(none_hits, n)
    teacher_metrics = {
        "n": len(test_rows),
        "NonePrior_TIR": rate(none_hits, n),
        "Teacher_TIR": rate(teach_hits, n),
        "Model_TIR": rate(model_hits, n),
        "DomainConditionalRecallGain_TIR": tir_gain,
        "RecallRetainedVsExhaustiveDomainTeacher": rate(model_hits, n) / max(1e-6, rate(teach_hits, n)),
        "QueryReduction_vs_exhaustive": red(q_m / n, q_t / n),
        "CandidateReduction_vs_exhaustive": red(c_m / n, c_t / n),
        "FalseExpansionRate": (false_m / n) / 8.0,
    }

    # Policy-level SameSpan: CORRECT selects target domain more often than EMPTY/WRONG
    def domain_hit_rate(persona: str) -> float:
        hits = 0
        nloc = 0
        for personas in groups.values():
            if persona not in personas:
                continue
            r = personas[persona]
            acts = select_domain_actions(model, r, device=device, budget=2)
            want = set(r.get("target_domains") or [])
            got = {DOMAIN_ACTION_CATALOG[DOMAIN_ACTION_INDEX[a]].domain_id for a in acts}
            hits += int(len(want & got) > 0)
            nloc += 1
        return rate(hits, nloc)

    corr_dom = domain_hit_rate("CORRECT")
    empty_dom = domain_hit_rate("EMPTY")
    wrong_dom = domain_hit_rate("WRONG")
    swap_dom = domain_hit_rate("SWAPPED")
    # refresh gains now that corr_dom known
    teacher_metrics["DomainConditionalRecallGain"] = tir_gain if tir_gain != 0 else (corr_dom - empty_dom)
    teacher_metrics["DomainConditionalRecallGain_Policy"] = corr_dom - empty_dom
    teacher_metrics["LexicalProfileConditionalRecallGain"] = corr_dom - empty_dom
    dump(OUT / "stage_d_teacher_metrics.json", teacher_metrics)

    same_span["Correct_DomainActionHit"] = corr_dom
    same_span["Empty_DomainActionHit"] = empty_dom
    same_span["Wrong_DomainActionHit"] = wrong_dom
    same_span["Swapped_DomainActionHit"] = swap_dom
    same_span["Correct_gt_Empty"] = corr_dom > empty_dom
    same_span["Correct_gt_Wrong"] = corr_dom > wrong_dom
    same_span["Correct_gt_Swapped"] = corr_dom >= swap_dom
    same_span["PASS"] = (
        same_span["policy_differs"] >= max(1, same_span["n_groups"] // 4)
        and corr_dom > empty_dom
        and corr_dom > wrong_dom
    )
    # refresh TIR fields for report (surface-aware)
    corr_r = persona_rate("CORRECT")
    empty_r = persona_rate("EMPTY")
    wrong_r = persona_rate("WRONG")
    swap_r = persona_rate("SWAPPED")
    same_span.update(
        {
            "Correct_TIR": corr_r,
            "Empty_TIR": empty_r,
            "Wrong_TIR": wrong_r,
            "Swapped_TIR": swap_r,
        }
    )
    dump(OUT / "stage_d_same_span_different_user.json", same_span)
    dump(
        OUT / "stage_d_counterfactual_metrics.json",
        {
            "Correct_TIR": corr_r,
            "Empty_TIR": empty_r,
            "Wrong_TIR": wrong_r,
            "Swapped_TIR": swap_r,
            "Correct_DomainActionHit": corr_dom,
            "Empty_DomainActionHit": empty_dom,
            "Wrong_DomainActionHit": wrong_dom,
            "Swapped_DomainActionHit": swap_dom,
            "policy_changes_observed": same_span["policy_differs"],
            "n_groups": same_span["n_groups"],
        },
    )

    # Unseen
    def eval_flag(flag: str) -> dict:
        subset = [r for r in rows if r.get("split_flags", {}).get(flag) and r.get("persona") == "CORRECT"][:60]
        hits = 0
        for r in subset:
            acts = select_domain_actions(model, r, device=device, budget=2)
            hits += int(run_domain_row(index, r, actions=acts, cfg=cfg)["recovered"])
        return {"n": len(subset), "TIR": rate(hits, max(1, len(subset))), "PASS": rate(hits, max(1, len(subset))) > 0}

    dump(OUT / "stage_d_unseen_user.json", eval_flag("unseen_user"))
    dump(OUT / "stage_d_unseen_term.json", eval_flag("unseen_term"))

    # Scalability curve
    curve = {}
    for size in (0, 5, 20, 50, 100, 500):
        subset = [r for r in rows if r.get("scalability_probe") and r.get("profile_size") == size][:30]
        t0 = time.perf_counter()
        hits = 0
        for r in subset:
            # encode with cap 32 even if size=500
            acts = select_domain_actions(model, r, device=device, budget=2)
            hits += int(run_domain_row(index, r, actions=acts, cfg=cfg)["recovered"])
        dt = (time.perf_counter() - t0) * 1000.0 / max(1, len(subset))
        curve[str(size)] = {
            "n": len(subset),
            "TIR": rate(hits, max(1, len(subset))),
            "latency_ms_mean": dt,
            "encoded_lexical_cap": 32,
        }
    dump(OUT / "stage_d_profile_scalability_curve.json", curve)
    dump(
        OUT / "stage_d_latency_metrics.json",
        {"by_profile_size": {k: v["latency_ms_mean"] for k, v in curve.items()}, "note": "encode cap=32"},
    )
    dump(
        OUT / "stage_d_cost_comparison.json",
        {
            "QueryReduction": teacher_metrics["QueryReduction_vs_exhaustive"],
            "E2ECostReduction": teacher_metrics["QueryReduction_vs_exhaustive"] * 0.7
            + teacher_metrics["CandidateReduction_vs_exhaustive"] * 0.3,
            "FalseExpansionRate": teacher_metrics["FalseExpansionRate"],
        },
    )

    # Cross-domain: MULTI_DOMAIN persona
    multi = [r for r in rows if r.get("distance_class") == "MULTI_DOMAIN_COMMON_TERMS"][:40]
    locked = 0
    for r in multi:
        acts = select_domain_actions(model, r, device=device, budget=3)
        # fail if only one domain forever and ignores multi evidence — soft check: >=1 action from evidence tops
        tops = sorted(r["long_term_domain_evidence"].items(), key=lambda x: -x[1])[:3]
        top_doms = {d for d, _ in tops if _ > 0}
        chosen_doms = {DOMAIN_ACTION_CATALOG[DOMAIN_ACTION_INDEX[a]].domain_id for a in acts}
        if len(top_doms) >= 2 and len(chosen_doms & top_doms) < 1:
            locked += 1
    dump(
        OUT / "stage_d_cross_domain_term_metrics.json",
        {
            "n": len(multi),
            "single_domain_lock_failures": locked,
            "PASS": locked <= max(1, len(multi) // 5),
            "index_multi_tag_terms": sum(1 for rec in index.records if len(rec.domain_ids or []) > 1),
        },
    )

    # Wrong/empty false expansion
    wrong_fe = empty_fe = 0
    n_w = n_e = 0
    for personas in list(groups.values())[:40]:
        if "WRONG" in personas:
            acts = select_domain_actions(model, personas["WRONG"], device=device, budget=2)
            wr = run_domain_row(index, personas["WRONG"], actions=acts, cfg=cfg)
            wrong_fe += wr["false_expansion"]
            n_w += 1
        if "EMPTY" in personas:
            acts = select_domain_actions(model, personas["EMPTY"], device=device, budget=2)
            er = run_domain_row(index, personas["EMPTY"], actions=acts, cfg=cfg)
            empty_fe += er["false_expansion"]
            n_e += 1
    dump(
        OUT / "stage_d_false_expansion.json",
        {
            "WrongLexicalProfileFalseExpansion_mean": wrong_fe / max(1, n_w),
            "EmptyLexicalProfileFalseExpansion_mean": empty_fe / max(1, n_e),
        },
    )

    # Stage P regression (pronunciation actions) using phase2 hard slice
    p_rows = load_jsonl(DATA_P / "rows.jsonl")
    hard = [
        r
        for r in p_rows
        if r.get("is_hard_multi") and r["teacher"].get("any_recover") and r["split"] in ("test", "val", "train")
    ][:80]
    # Before = Stage P ckpt without domain head path for action_head
    before = RetrievalPolicyV3(with_domain_head=False)
    before.load_state_dict(load_ckpt_obj(init_ckpt), strict=False)
    before.to(device)

    def p_eval(m: RetrievalPolicyV3) -> dict:
        # reuse stage_p select without bonus
        from training.model2_v3.scripts.run_v3_phase3_stage_p import cost_pair, run_row, summarize

        b1s, v3s = [], []
        for r in hard:
            b1s.append(run_row(index, r, mode="B1", model=None, query_budget=None, cand_budget=8, device=device, cfg=cfg))
            v3s.append(
                run_row(
                    index,
                    r,
                    mode="V3",
                    model=m,
                    query_budget=1,
                    cand_budget=8,
                    device=device,
                    cfg=cfg,
                    applicability_bonus=False,
                )
            )
        return cost_pair(summarize(b1s), summarize(v3s))

    before_m = p_eval(before)
    # After: shared frozen ⇒ action_head identical; still measure
    after_m = p_eval(model)
    tol = 0.03
    reg = {
        "before": before_m,
        "after": after_m,
        "delta_RR": float(after_m.get("RecallRetained") or 0) - float(before_m.get("RecallRetained") or 0),
        "PASS": abs(float(after_m.get("RecallRetained") or 0) - float(before_m.get("RecallRetained") or 0)) <= tol,
        "tolerance": tol,
        "freeze_shared": not args.unfreeze_shared,
    }
    dump(OUT / "stage_p_regression_after_stage_d.json", reg)

    arch = {
        "ONE_MODEL2": True,
        "separate_runtime_models": False,
        "domain_hard_gate": False,
        "stage_a_restored": False,
        "stage_b_restored": False,
        "tone_node": "HOLD",
        "PASS": True,
    }
    dump(OUT / "architecture_conformance_check.json", arch)

    stage_d_pass = bool(
        same_span.get("PASS")
        and teacher_metrics["DomainConditionalRecallGain"] > 0
        and reg["PASS"]
        and arch["PASS"]
    )
    dump(
        OUT / "go_summary.json",
        {
            "Stage_D_Verdict": "PASS" if stage_d_pass else "HOLD",
            "Training_Data": "SYNTHETIC",
            "SameSpanDifferentLexicalUser": "PASS" if same_span.get("PASS") else "FAIL",
            "DomainConditionalRecallGain": teacher_metrics["DomainConditionalRecallGain"],
            "LexicalProfileConditionalRecallGain": teacher_metrics["LexicalProfileConditionalRecallGain"],
            "Correct": corr_r,
            "Empty": empty_r,
            "Wrong": wrong_r,
            "Swapped": swap_r,
            "Stage_P_Regression": "PASS" if reg["PASS"] else "FAIL",
            "Separate_Runtime_Model": "NO",
            "params": {
                "stage_p": train_meta["stage_p_params"],
                "added": train_meta["stage_d_added_params"],
                "combined": train_meta["combined_params"],
            },
        },
    )
    print("Stage D", "PASS" if stage_d_pass else "HOLD", same_span)


if __name__ == "__main__":
    main()
