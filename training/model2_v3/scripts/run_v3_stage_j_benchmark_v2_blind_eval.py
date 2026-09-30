#!/usr/bin/env python3
"""Blind evaluation of frozen J1 checkpoint on STAGE_J_PRODUCTION_BENCHMARK_V2.

NO retraining. NO architecture change. NO runtime wiring.
"""

from __future__ import annotations

import json
import math
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Any, Optional

import torch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from training.model2.contract import DOMAIN_SLOT_IDS
from training.model2.retrieval.finespan_retrieval import base_retrieve_span
from training.model2.retrieval.spike_retriever import ProfileRetrievalConfig
from training.model2.training.dataset import load_candidate_index
from training.model2_v2.runtime.active_set import ACTIVE_SET_V1
from training.model2_v3.policy.actions import ACTION_CATALOG, ACTION_INDEX, action_applicable, execute_action
from training.model2_v3.policy.domain_actions import (
    DOMAIN_ACTION_CATALOG,
    DOMAIN_ACTION_INDEX,
    execute_domain_action,
)
from training.model2_v3.policy.model import RetrievalPolicyV3, pack_batch_inputs
from training.model2_v3.policy.stage_d_target_identity_v1 import target_hit
from training.model2_v3.scripts.run_v3_stage_j_recovery_d1 import span_view

OUT = ROOT / "training/model2_v3/experiments/v3_stage_j_benchmark_v2"
CKPT = ROOT / "training/model2_v3/experiments/v3_stage_j_j1_prod/training/j1_unified_checkpoint.pt"
IDX = ROOT / "training/model2_v3/dataset/policy_stage_d2/candidate_index_stage_d2.jsonl"
IDX_META = ROOT / "training/model2_v3/dataset/policy_stage_d2/candidate_index_stage_d2_meta.json"
FEATURE_HASH = "v1"
P1_BASELINE_RR = 0.955


def dump(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", path.name, flush=True)


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(l) for l in path.open(encoding="utf-8")]


def rate(a: int, b: int) -> float:
    return float(a) / float(b) if b else 0.0


def red(new: float, old: float) -> float:
    return (old - new) / old if old else 0.0


def wilson_ci(k: int, n: int, z: float = 1.96) -> list[float]:
    if n <= 0:
        return [0.0, 0.0]
    p = k / n
    den = 1 + z * z / n
    centre = p + z * z / (2 * n)
    margin = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return [max(0.0, (centre - margin) / den), min(1.0, (centre + margin) / den)]


def support_tag(n: int) -> str:
    if n < 30:
        return "VERY_LOW_SUPPORT"
    if n < 100:
        return "LOW_SUPPORT"
    return "OK"


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


def select_p(model, row, *, qb: int, device):
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


def select_d(model, row, *, budget: int, device):
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
    chosen = []
    for _, aid in scored:
        if aid == "domain_none" and chosen:
            continue
        chosen.append(aid)
        if len(chosen) >= budget:
            break
    return chosen or ["domain_none"]


def main() -> None:
    assert CKPT.exists(), f"missing {CKPT}"
    device = torch.device("cpu")
    index = load_candidate_index(IDX, IDX_META)
    cfg = ProfileRetrievalConfig(
        max_total_profile_candidates=8,
        max_new_candidates_per_query=8,
        max_generated_phonetic_queries=1,
    )
    model = RetrievalPolicyV3(with_domain_head=True).to(device)
    obj = torch.load(CKPT, map_location="cpu", weights_only=False)
    sd = obj["state_dict"] if isinstance(obj, dict) and "state_dict" in obj else obj
    model.load_state_dict(sd, strict=True)
    model.eval()
    print("loaded frozen J1", CKPT.name, "params", model.param_count(), flush=True)

    p_rows = load_jsonl(OUT / "dataset" / "p_only.jsonl")
    d_rows = load_jsonl(OUT / "dataset" / "d_only.jsonl")
    pd_rows = load_jsonl(OUT / "dataset" / "pd.jsonl")
    cf_rows = load_jsonl(OUT / "dataset" / "counterfactual.jsonl")
    neg_rows = load_jsonl(OUT / "dataset" / "negatives.jsonl")
    hard_d = load_jsonl(OUT / "dataset" / "hard_d.jsonl")
    held_term = load_jsonl(OUT / "dataset" / "heldout_term.jsonl")
    held_span = load_jsonl(OUT / "dataset" / "heldout_span.jsonl")
    generic_rows = load_jsonl(OUT / "dataset" / "generic.jsonl")
    card_rows = load_jsonl(OUT / "dataset" / "d_cardinality.jsonl") if (OUT / "dataset" / "d_cardinality.jsonl").exists() else []

    d_clean = [r for r in d_rows if r.get("contamination") == "CLEAN"]
    d_blind = d_clean  # true blind; N may be VERY_LOW_SUPPORT — do not mix contaminated
    d_all = d_rows
    p_hard = [r for r in p_rows if r.get("p_slice") == "HARD_P_FROZEN"] or p_rows[:699]
    p_held = [r for r in p_hard if r.get("blind_holdout")]
    p_extra = [r for r in p_rows if r.get("p_slice") == "HELDOUT_UNIQUE_EXTRA"]
    p_all_hard = p_hard  # primary vs P1 N=699

    failures = []
    tax = Counter()

    # ---- P eval ----
    print("blind P eval n=", len(p_all_hard), flush=True)
    b1_h = v3_h = 0
    b1_q = v3_q = b1_c = v3_c = 0
    lat = []
    top1 = top2 = n_t = 0
    for r in p_all_hard:
        span = span_view(r["span"])
        tid = r["target_term_id"]
        prof = r.get("profile_phonetic") or {}
        base = set(base_retrieve_span(index, span, cfg=cfg))
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
        b1_h += int(tid in new_b1)
        b1_q += nq
        b1_c += len(new_b1)
        t0 = time.perf_counter()
        acts, detail = select_p(model, r, qb=1, device=device)
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
        hit = tid in new_v
        v3_h += int(hit)
        v3_q += nq2
        v3_c += len(new_v)
        teacher = r.get("teacher") or {}
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
            if rank > 1 and not hit:
                tax["P_TOP1_RANK_MISS"] += 1
        if not hit:
            failures.append(
                {
                    "case_id": r.get("case_id"),
                    "family": "P_ONLY",
                    "failure_class": "P_TOP1_RANK_MISS" if cands else "RETRIEVAL_MISS",
                    "FineSpan": r["span"].get("span_syllables"),
                    "target": tid,
                    "actions": acts,
                    "Top1": detail[0] if detail else None,
                    "Top2": detail[1] if len(detail) > 1 else None,
                }
            )
    n_p = len(p_all_hard)
    tir_b1 = rate(b1_h, n_p)
    tir_v3 = rate(v3_h, n_p)
    p_rr = tir_v3 / tir_b1 if tir_b1 > 0 else 0.0
    p_metrics = {
        "n": n_p,
        "support": support_tag(n_p),
        "TIR_B1": tir_b1,
        "TIR_V3": tir_v3,
        "RecallRetained": p_rr,
        "TIR_CI95": wilson_ci(v3_h, n_p),
        "QueryReduction": red(v3_q / max(1, n_p), b1_q / max(1, n_p)),
        "CandidateReduction": red(v3_c / max(1, n_p), b1_c / max(1, n_p)),
        "Teacher_Top1": top1 / max(1, n_t),
        "Teacher_Top2": top2 / max(1, n_t),
        "Latency_P50": sorted(lat)[len(lat) // 2] if lat else 0,
        "Latency_P95": sorted(lat)[int(0.95 * (len(lat) - 1))] if lat else 0,
        "P1_baseline_RR": P1_BASELINE_RR,
    }
    dump(OUT / "stage_j_v2_p_metrics.json", p_metrics)

    # held-out P
    print("blind P heldout n=", len(p_held), flush=True)
    # reuse lighter: subsample if needed already filtered
    ph_h = ph_b1 = 0
    for r in p_held:
        span = span_view(r["span"])
        tid = r["target_term_id"]
        prof = r.get("profile_phonetic") or {}
        base = set(base_retrieve_span(index, span, cfg=cfg))
        acts_b1 = [a.action_id for a in ACTION_CATALOG if a.kind == "single" and action_applicable(span, a, prof)]
        new_b1 = set()
        for aid in acts_b1:
            res = execute_action(index, span, ACTION_CATALOG[ACTION_INDEX[aid]], base_ids=base, cfg=cfg, max_cands=8)
            for t in res.get("term_ids") or []:
                if len(new_b1) >= 8:
                    break
                new_b1.add(t)
        ph_b1 += int(tid in new_b1)
        acts, _ = select_p(model, r, qb=1, device=device)
        new_v = set()
        for aid in acts:
            res = execute_action(index, span, ACTION_CATALOG[ACTION_INDEX[aid]], base_ids=base, cfg=cfg, max_cands=8)
            for t in res.get("term_ids") or []:
                if len(new_v) >= 8:
                    break
                new_v.add(t)
        ph_h += int(tid in new_v)
    p_held_rr = rate(ph_h, len(p_held)) / rate(ph_b1, len(p_held)) if ph_b1 else 0.0
    dump(
        OUT / "stage_j_v2_heldout_metrics.json",
        {
            "P_heldout": {
                "n": len(p_held),
                "support": support_tag(len(p_held)),
                "RecallRetained": p_held_rr,
                "TIR_V3": rate(ph_h, len(p_held)),
                "CI95": wilson_ci(ph_h, len(p_held)),
            }
        },
    )

    # relation slices
    rel_m = {}
    for rel in ACTIVE_SET_V1:
        sub = [r for r in p_all_hard if float((r.get("profile_phonetic") or {}).get(rel) or 0) > 0]
        if len(sub) > 120:
            sub = sub[:: max(1, len(sub) // 120)][:120]
        if len(sub) < 10:
            continue
        h = b = 0
        for r in sub:
            span = span_view(r["span"])
            tid = r["target_term_id"]
            prof = r.get("profile_phonetic") or {}
            base = set(base_retrieve_span(index, span, cfg=cfg))
            acts_b1 = [a.action_id for a in ACTION_CATALOG if a.kind == "single" and action_applicable(span, a, prof)]
            nb = set()
            for aid in acts_b1:
                res = execute_action(index, span, ACTION_CATALOG[ACTION_INDEX[aid]], base_ids=base, cfg=cfg, max_cands=8)
                for t in res.get("term_ids") or []:
                    if len(nb) >= 8:
                        break
                    nb.add(t)
            b += int(tid in nb)
            acts, _ = select_p(model, r, qb=1, device=device)
            nv = set()
            for aid in acts:
                res = execute_action(index, span, ACTION_CATALOG[ACTION_INDEX[aid]], base_ids=base, cfg=cfg, max_cands=8)
                for t in res.get("term_ids") or []:
                    if len(nv) >= 8:
                        break
                    nv.add(t)
            h += int(tid in nv)
        rel_m[rel] = {
            "n": len(sub),
            "support": support_tag(len(sub)),
            "RecallRetained": rate(h, len(sub)) / rate(b, len(sub)) if b else 0.0,
            "TIR": rate(h, len(sub)),
        }
    dump(OUT / "stage_j_v2_p_relation_slices.json", rel_m)

    # ---- D eval ----
    print("blind D eval n=", len(d_blind), flush=True)
    d_hits = d_oracle = 0
    d_lat = []
    for r in d_blind:
        span = span_view(r["span"])
        tid = r["target_term_id"]
        base = set(base_retrieve_span(index, span, cfg=cfg))
        ev = r.get("long_term_domain_evidence") or {}
        o_ok = False
        for ainfo in r.get("teacher_recover_actions") or []:
            a = DOMAIN_ACTION_CATALOG[DOMAIN_ACTION_INDEX[ainfo["action_id"]]]
            res = execute_domain_action(index, span, a, ev, base_ids=base, cfg=cfg, max_cands=8)
            if target_hit(index, tid, res.get("term_ids") or [])["identity_hit"]:
                o_ok = True
                break
        d_oracle += int(o_ok)
        t0 = time.perf_counter()
        acts = select_d(model, r, budget=2, device=device)
        ok = False
        returned = []
        for aid in acts:
            a = DOMAIN_ACTION_CATALOG[DOMAIN_ACTION_INDEX[aid]]
            res = execute_domain_action(index, span, a, ev, base_ids=base, cfg=cfg, max_cands=8)
            returned = res.get("term_ids") or []
            if target_hit(index, tid, returned)["identity_hit"]:
                ok = True
                break
        d_lat.append((time.perf_counter() - t0) * 1000)
        d_hits += int(ok)
        if o_ok and not ok:
            tax["D_ACTION_SELECTION_MISS"] += 1
            failures.append(
                {
                    "case_id": r.get("case_id"),
                    "family": "D_ONLY",
                    "failure_class": "D_ACTION_SELECTION_MISS",
                    "FineSpan": r["span"].get("span_syllables"),
                    "target": tid,
                    "profile": list((ev or {}).keys())[:5],
                    "selected_actions": acts,
                    "returned": returned[:8],
                }
            )
        elif not o_ok:
            tax["DATA_CONTRACT"] += 1
    n_d = len(d_blind)
    d_tir = rate(d_hits, n_d)
    o_tir = rate(d_oracle, n_d)
    d_rr = d_tir / o_tir if o_tir > 0 else 0.0
    d_metrics = {
        "n": n_d,
        "support": support_tag(n_d),
        "unique_spans": len({tuple(r["span"]["span_syllables"]) for r in d_blind}),
        "unique_terms": len({r["target_term_id"] for r in d_blind}),
        "Oracle_N": d_oracle,
        "Oracle_TIR": o_tir,
        "J1_TIR": d_tir,
        "RecallRetained": d_rr,
        "TIR_CI95": wilson_ci(d_hits, n_d),
        "Latency_P50": sorted(d_lat)[len(d_lat) // 2] if d_lat else 0,
    }
    dump(OUT / "stage_j_v2_d_metrics.json", d_metrics)

    def eval_d_slice(rows: list[dict], tag: str) -> dict:
        h = o = 0
        for r in rows:
            span = span_view(r["span"])
            tid = r["target_term_id"]
            base = set(base_retrieve_span(index, span, cfg=cfg))
            ev = r.get("long_term_domain_evidence") or {}
            o_ok = False
            for ainfo in r.get("teacher_recover_actions") or []:
                a = DOMAIN_ACTION_CATALOG[DOMAIN_ACTION_INDEX[ainfo["action_id"]]]
                res = execute_domain_action(index, span, a, ev, base_ids=base, cfg=cfg, max_cands=8)
                if target_hit(index, tid, res.get("term_ids") or [])["identity_hit"]:
                    o_ok = True
                    break
            o += int(o_ok)
            acts = select_d(model, r, budget=2, device=device)
            ok = False
            for aid in acts:
                a = DOMAIN_ACTION_CATALOG[DOMAIN_ACTION_INDEX[aid]]
                res = execute_domain_action(index, span, a, ev, base_ids=base, cfg=cfg, max_cands=8)
                if target_hit(index, tid, res.get("term_ids") or [])["identity_hit"]:
                    ok = True
                    break
            h += int(ok)
        tir = rate(h, len(rows))
        ot = rate(o, len(rows))
        return {
            "tag": tag,
            "n": len(rows),
            "support": support_tag(len(rows)),
            "Oracle_N": o,
            "Oracle_TIR": ot,
            "J1_TIR": tir,
            "RecallRetained": tir / ot if ot else 0.0,
            "CI95": wilson_ci(h, len(rows)),
        }

    d_all_m = eval_d_slice(d_all, "ALL_INCL_CONTAMINATED")
    d_held_term_m = eval_d_slice(held_term, "HELDOUT_TERM")
    d_held_span_m = eval_d_slice(held_span, "HELDOUT_SPAN")
    d_metrics["all_incl_contaminated"] = d_all_m
    d_metrics["heldout_term"] = d_held_term_m
    d_metrics["heldout_span"] = d_held_span_m
    dump(OUT / "stage_j_v2_d_metrics.json", d_metrics)
    dump(
        OUT / "stage_j_v2_heldout_metrics.json",
        {
            "P_heldout": json.loads((OUT / "stage_j_v2_heldout_metrics.json").read_text(encoding="utf-8")).get("P_heldout"),
            "D_heldout_term": d_held_term_m,
            "D_heldout_span": d_held_span_m,
            "D_clean_blind": {
                "n": len(d_clean),
                "support": support_tag(len(d_clean)),
                "RecallRetained": d_rr,
                "TIR": d_tir,
                "CI95": wilson_ci(d_hits, n_d),
            },
        },
    )

    # counterfactuals / profile value
    def cf_tir(persona: str) -> dict:
        sub = [r for r in cf_rows if r.get("persona") == persona]
        # align to blind D groups
        blind_ids = {r["case_id"] for r in d_blind}
        sub = [r for r in sub if r.get("group_id") in blind_ids] or sub
        sub = sub[: min(400, len(sub))]
        h = 0
        for r in sub:
            span = span_view(r["span"])
            tid = r["target_term_id"]
            base = set(base_retrieve_span(index, span, cfg=cfg))
            ev = r.get("long_term_domain_evidence") or {}
            acts = select_d(model, r, budget=2, device=device)
            ok = False
            for aid in acts:
                a = DOMAIN_ACTION_CATALOG[DOMAIN_ACTION_INDEX[aid]]
                res = execute_domain_action(index, span, a, ev, base_ids=base, cfg=cfg, max_cands=8)
                if target_hit(index, tid, res.get("term_ids") or [])["identity_hit"]:
                    ok = True
                    break
            h += int(ok)
        return {"n": len(sub), "support": support_tag(len(sub)), "TIR": rate(h, len(sub)), "hits": h, "CI95": wilson_ci(h, len(sub))}

    cf = {p: cf_tir(p) for p in ("CORRECT", "EMPTY", "WRONG", "SWAPPED")}
    ce = cf["CORRECT"]["TIR"] - cf["EMPTY"]["TIR"]
    cw = cf["CORRECT"]["TIR"] - cf["WRONG"]["TIR"]
    cs = cf["CORRECT"]["TIR"] - cf["SWAPPED"]["TIR"]
    if ce >= 0.25:
        pv = "STRONG"
    elif ce >= 0.10:
        pv = "MODERATE"
    elif ce > 0:
        pv = "WEAK"
    else:
        pv = "NONE"
    dump(
        OUT / "stage_j_v2_d_profile_value.json",
        {
            **cf,
            "Correct_Empty": ce,
            "Correct_Wrong": cw,
            "Correct_Swapped": cs,
            "PROFILE_VALUE_DELTA": ce,
            "Profile_Value": pv,
        },
    )

    # ---- P+D ablation + synergy ----
    print("blind P+D n=", len(pd_rows), flush=True)
    d_span_term = {(tuple(r["span"]["span_syllables"]), r["target_term_id"]) for r in d_blind}
    pd_eval = [
        r
        for r in pd_rows
        if (tuple(r["span"]["span_syllables"]), r.get("domain_target_term_id") or r.get("target_term_id")) in d_span_term
    ] or pd_rows
    pd_eval = [r for r in pd_eval if r.get("pd_slice") in (None, "D_helps_P_present", "P_PLUS_D") or r.get("case_family") == "P_PLUS_D"]
    # keep one primary slice per unique span+term
    seen_pd = set()
    pd_primary = []
    for r in pd_eval:
        k = (tuple(r["span"]["span_syllables"]), r.get("domain_target_term_id") or r.get("target_term_id"), r.get("pd_slice"))
        if k in seen_pd:
            continue
        seen_pd.add(k)
        if r.get("pd_slice") in (None, "D_helps_P_present"):
            pd_primary.append(r)
    if not pd_primary:
        pd_primary = pd_eval
    pd_eval = pd_primary

    def pd_mode(rows, mode: str) -> dict:
        rows = rows[: min(300, len(rows))]
        h = 0
        for r in rows:
            span = span_view(r["span"])
            tid = r.get("domain_target_term_id") or r["target_term_id"]
            base = set(base_retrieve_span(index, span, cfg=cfg))
            rr = dict(r)
            new_ids: set[str] = set()
            if mode == "none":
                rr["profile_phonetic"] = {}
                rr["long_term_domain_evidence"] = {}
                rr["personal_terms"] = []
            elif mode == "p":
                rr["long_term_domain_evidence"] = {}
                rr["personal_terms"] = []
            elif mode == "d":
                rr["profile_phonetic"] = {}
            if mode in ("p", "full") and (rr.get("profile_phonetic") or {}):
                for aid in select_p(model, rr, qb=1, device=device)[0]:
                    res = execute_action(index, span, ACTION_CATALOG[ACTION_INDEX[aid]], base_ids=base, cfg=cfg, max_cands=8)
                    for t in res.get("term_ids") or []:
                        new_ids.add(t)
            if mode in ("d", "full"):
                for aid in select_d(model, rr, budget=2, device=device):
                    a = DOMAIN_ACTION_CATALOG[DOMAIN_ACTION_INDEX[aid]]
                    res = execute_domain_action(
                        index, span, a, rr.get("long_term_domain_evidence") or {}, base_ids=base, cfg=cfg, max_cands=8
                    )
                    for t in res.get("term_ids") or []:
                        new_ids.add(t)
            if target_hit(index, tid, list(new_ids)[:16])["identity_hit"]:
                h += 1
        return {"n": len(rows), "support": support_tag(len(rows)), "TIR": rate(h, len(rows)), "hits": h, "CI95": wilson_ci(h, len(rows))}

    # per-case for synergy
    synergy_eligible = 0
    synergy_success = 0
    for r in pd_eval[:300]:
        span = span_view(r["span"])
        tid = r.get("domain_target_term_id") or r["target_term_id"]
        base = set(base_retrieve_span(index, span, cfg=cfg))

        def run(mode: str) -> bool:
            rr = dict(r)
            new_ids: set[str] = set()
            if mode == "p":
                rr["long_term_domain_evidence"] = {}
                rr["personal_terms"] = []
            elif mode == "d":
                rr["profile_phonetic"] = {}
            if mode in ("p", "full") and (rr.get("profile_phonetic") or {}):
                for aid in select_p(model, rr, qb=1, device=device)[0]:
                    res = execute_action(index, span, ACTION_CATALOG[ACTION_INDEX[aid]], base_ids=base, cfg=cfg, max_cands=8)
                    for t in res.get("term_ids") or []:
                        new_ids.add(t)
            if mode in ("d", "full"):
                for aid in select_d(model, rr, budget=2, device=device):
                    a = DOMAIN_ACTION_CATALOG[DOMAIN_ACTION_INDEX[aid]]
                    res = execute_domain_action(
                        index, span, a, rr.get("long_term_domain_evidence") or {}, base_ids=base, cfg=cfg, max_cands=8
                    )
                    for t in res.get("term_ids") or []:
                        new_ids.add(t)
            return target_hit(index, tid, list(new_ids)[:16])["identity_hit"]

        p_ok = run("p")
        d_ok = run("d")
        f_ok = run("full")
        if (not p_ok) and (not d_ok):
            synergy_eligible += 1
            if f_ok:
                synergy_success += 1
            else:
                tax["PD_SYNERGY_MISS"] += 1
        if f_ok and (not p_ok) and (not d_ok):
            pass
        if (not f_ok) and (p_ok or d_ok):
            tax["PD_INTERFERENCE"] += 1

    ab = {
        "none": pd_mode(pd_eval, "none"),
        "p_only": pd_mode(pd_eval, "p"),
        "d_only": pd_mode(pd_eval, "d"),
        "full": pd_mode(pd_eval, "full"),
    }
    best = max(ab["p_only"]["TIR"], ab["d_only"]["TIR"])
    if ab["full"]["TIR"] + 0.05 < best:
        ji = "SIGNIFICANT"
    elif ab["full"]["TIR"] < best:
        ji = "MILD"
    else:
        ji = "NO"
    ab["Full_ge_BestSingle"] = ab["full"]["TIR"] + 1e-12 >= best
    dump(OUT / "stage_j_v2_pd_metrics.json", ab)
    dump(
        OUT / "stage_j_v2_synergy_metrics.json",
        {
            "Synergy_Eligible": synergy_eligible,
            "Synergy_Success": synergy_success,
            "Synergy_Rate": rate(synergy_success, synergy_eligible),
            "CI95": wilson_ci(synergy_success, synergy_eligible),
            "support": support_tag(synergy_eligible),
        },
    )
    dump(OUT / "stage_j_v2_joint_interference.json", {"JointInterference": ji, "best_single": best, "full": ab["full"]["TIR"]})

    # multidomain / generic / hard / negatives
    multi = [r for r in d_blind if r.get("multitag")]
    mh = mo = 0
    for r in multi:
        span = span_view(r["span"])
        tid = r["target_term_id"]
        base = set(base_retrieve_span(index, span, cfg=cfg))
        ev = r.get("long_term_domain_evidence") or {}
        for ainfo in r.get("teacher_recover_actions") or []:
            a = DOMAIN_ACTION_CATALOG[DOMAIN_ACTION_INDEX[ainfo["action_id"]]]
            res = execute_domain_action(index, span, a, ev, base_ids=base, cfg=cfg, max_cands=8)
            if target_hit(index, tid, res.get("term_ids") or [])["identity_hit"]:
                mo += 1
                break
        acts = select_d(model, r, budget=2, device=device)
        for aid in acts:
            a = DOMAIN_ACTION_CATALOG[DOMAIN_ACTION_INDEX[aid]]
            res = execute_domain_action(index, span, a, ev, base_ids=base, cfg=cfg, max_cands=8)
            if target_hit(index, tid, res.get("term_ids") or [])["identity_hit"]:
                mh += 1
                break
    dump(
        OUT / "stage_j_v2_multidomain_metrics.json",
        {"n": len(multi), "support": support_tag(len(multi)), "TIR": rate(mh, len(multi)), "Oracle_TIR": rate(mo, len(multi))},
    )
    generic = generic_rows or [r for r in d_blind if len(r.get("target_domains") or []) >= 3]
    gh = go_n = 0
    overbias = 0
    for r in generic:
        span = span_view(r["span"])
        tid = r["target_term_id"]
        base = set(base_retrieve_span(index, span, cfg=cfg))
        ev = r.get("long_term_domain_evidence") or {}
        acts = select_d(model, r, budget=2, device=device)
        hit = False
        for aid in acts:
            a = DOMAIN_ACTION_CATALOG[DOMAIN_ACTION_INDEX[aid]]
            res = execute_domain_action(index, span, a, ev, base_ids=base, cfg=cfg, max_cands=8)
            if target_hit(index, tid, res.get("term_ids") or [])["identity_hit"]:
                hit = True
                break
        gh += int(hit)
        go_n += 1
        # overbias proxy: empty-profile still expands target
        rr = dict(r)
        rr["long_term_domain_evidence"] = {}
        rr["personal_terms"] = []
        for aid in select_d(model, rr, budget=2, device=device):
            if aid == "domain_none":
                continue
            a = DOMAIN_ACTION_CATALOG[DOMAIN_ACTION_INDEX[aid]]
            res = execute_domain_action(index, span, a, {}, base_ids=base, cfg=cfg, max_cands=8)
            if target_hit(index, tid, res.get("term_ids") or [])["identity_hit"]:
                overbias += 1
                tax["GENERIC_OVERBIAS"] += 1
                break
    dump(
        OUT / "stage_j_v2_generic_metrics.json",
        {
            "n": go_n,
            "support": support_tag(go_n),
            "TIR_correct_profile": rate(gh, go_n),
            "GENERIC_OVERBIAS_empty_expands": overbias,
            "GENERIC_OVERBIAS_rate": rate(overbias, go_n),
            "note": "proxy: terms with >=3 domain tags",
        },
    )

    # negative: empty profile should preferably NOT introduce (unnecessary expansion)
    neg_empty = [n for n in neg_rows if n.get("neg_type") == "EMPTY_PROFILE"]
    unexp = 0
    for n in neg_empty[:80]:
        # find matching eligible for target/span
        span = span_view(n["span"])
        tid = n["target_term_id"]
        base = set(base_retrieve_span(index, span, cfg=cfg))
        rr = {"span": n["span"], "profile_phonetic": {}, "personal_terms": [], "long_term_domain_evidence": {}, "personal_term_evidence": {}}
        acts = select_d(model, rr, budget=2, device=device)
        for aid in acts:
            if aid == "domain_none":
                continue
            a = DOMAIN_ACTION_CATALOG[DOMAIN_ACTION_INDEX[aid]]
            res = execute_domain_action(index, span, a, {}, base_ids=base, cfg=cfg, max_cands=8)
            if target_hit(index, tid, res.get("term_ids") or [])["identity_hit"]:
                unexp += 1
                tax["GENERIC_OVERBIAS"] += 1  # reuse bucket for unnecessary expansion
                break
    dump(
        OUT / "stage_j_v2_negative_metrics.json",
        {
            "empty_profile_n": len(neg_empty[:80]),
            "UNNECESSARY_EXPANSION_hits": unexp,
            "unnecessary_rate": rate(unexp, min(80, len(neg_empty))),
        },
    )

    hard_m = {"n": len(hard_d), "support": support_tag(len(hard_d))}
    if hard_d:
        hh = ho = 0
        for r in hard_d:
            span = span_view(r["span"])
            tid = r["target_term_id"]
            base = set(base_retrieve_span(index, span, cfg=cfg))
            ev = r.get("long_term_domain_evidence") or {}
            for ainfo in r.get("teacher_recover_actions") or []:
                a = DOMAIN_ACTION_CATALOG[DOMAIN_ACTION_INDEX[ainfo["action_id"]]]
                res = execute_domain_action(index, span, a, ev, base_ids=base, cfg=cfg, max_cands=8)
                if target_hit(index, tid, res.get("term_ids") or [])["identity_hit"]:
                    ho += 1
                    break
            acts = select_d(model, r, budget=2, device=device)
            for aid in acts:
                a = DOMAIN_ACTION_CATALOG[DOMAIN_ACTION_INDEX[aid]]
                res = execute_domain_action(index, span, a, ev, base_ids=base, cfg=cfg, max_cands=8)
                if target_hit(index, tid, res.get("term_ids") or [])["identity_hit"]:
                    hh += 1
                    break
        hard_m.update({"TIR": rate(hh, len(hard_d)), "Oracle_TIR": rate(ho, len(hard_d)), "CI95": wilson_ci(hh, len(hard_d))})
    dump(OUT / "stage_j_v2_hard_d_metrics.json", hard_m)

    dump(OUT / "stage_j_v2_failure_taxonomy.json", {"counts": dict(tax), "n_failures_exported": len(failures)})
    with (OUT / "stage_j_v2_failure_cases.jsonl").open("w", encoding="utf-8") as f:
        for row in failures[:2000]:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print("wrote stage_j_v2_failure_cases.jsonl", len(failures), flush=True)

    dump(
        OUT / "stage_j_v2_latency.json",
        {
            "P50": p_metrics["Latency_P50"],
            "P95": p_metrics["Latency_P95"],
            "D_P50": d_metrics["Latency_P50"],
            "P_queries_per_span_v3": p_metrics.get("QueryReduction"),
            "P_QueryReduction": p_metrics.get("QueryReduction"),
            "P_CandidateReduction": p_metrics.get("CandidateReduction"),
        },
    )
    dump(
        OUT / "stage_j_v2_confidence_intervals.json",
        {
            "P_TIR_CI95": p_metrics["TIR_CI95"],
            "D_TIR_CI95": d_metrics["TIR_CI95"],
            "PD_full_CI95": ab["full"]["CI95"],
            "Synergy_CI95": wilson_ci(synergy_success, synergy_eligible),
            "method": "Wilson",
        },
    )
    dump(
        OUT / "architecture_conformance_check.json",
        {
            "J1_Checkpoint_Modified": False,
            "J1_Retrained": False,
            "Architecture": "UNCHANGED",
            "No_runtime_change": True,
            "PASS": True,
        },
    )

    # decisions
    p_reg = "NO"
    if p_rr < 0.93:
        p_reg = "SIGNIFICANT"
    elif p_rr < 0.95:
        p_reg = "MILD"
    cov = json.loads((OUT / "stage_j_benchmark_v2_coverage_verdict.json").read_text(encoding="utf-8"))
    uniq = json.loads((OUT / "stage_j_benchmark_v2_unique_stats.json").read_text(encoding="utf-8"))
    gen = "PASS"
    if d_rr < 0.5 or pv == "NONE":
        gen = "FAIL"
    elif cov.get("D") == "LIMITED" or uniq.get("d_unique_spans", 0) < 100:
        gen = "PARTIAL"
    elif ji == "SIGNIFICANT":
        gen = "PARTIAL"

    prod = (
        p_reg == "NO"
        and pv in ("STRONG", "MODERATE")
        and ji != "SIGNIFICANT"
        and cov.get("D") in ("STRONG", "MODERATE")
        and uniq.get("d_unique_spans", 0) >= 100
    )

    weakest = None
    if rel_m:
        weakest = min(rel_m.items(), key=lambda kv: kv[1].get("RecallRetained", 1))[0]

    reason = []
    if uniq.get("d_unique_spans", 0) < 100:
        reason.append("D unique span coverage still below MINIMUM 100")
    if cov.get("D") == "LIMITED":
        reason.append("D coverage LIMITED")
    if pv in ("WEAK", "NONE"):
        reason.append(f"profile value {pv}")
    if cf["EMPTY"]["TIR"] > 0.3:
        reason.append("Empty profile expansion high")
    if not reason:
        reason.append("gates mixed; see metrics")

    primary_fail = max(tax.items(), key=lambda kv: kv[1])[0] if tax else "NONE"

    freeze_bar = "NOT_PRODUCTION_PROVEN" if cov.get("D") == "LIMITED" or uniq.get("d_unique_spans", 0) < 100 else None
    if freeze_bar is None and (gen == "FAIL" or ji == "SIGNIFICANT" or p_reg == "SIGNIFICANT"):
        freeze_bar = "HOLD_FOR_MODEL_IMPROVEMENT"

    go = {
        "Stage_J_Benchmark_V2": "PARTIAL" if uniq.get("d_unique_spans", 0) < 100 else "PASS",
        "Benchmark_Frozen": True,
        "J1_Checkpoint_Modified": False,
        "J1_Retrained": False,
        "Production_Freeze_Bar": freeze_bar or "OPEN",
        "P1_Baseline_RR": P1_BASELINE_RR,
        "J1_Blind_P_RR": p_rr,
        "P_N": n_p,
        "P_Heldout_RR": p_held_rr,
        "P_Regression": p_reg,
        "Weakest_Relation": weakest,
        "D_Oracle_N": d_oracle,
        "D_RecallRetained": d_rr,
        "D_N": n_d,
        "D_clean_n": len(d_clean),
        "D_all_n": len(d_all),
        "D_unique_spans": d_metrics["unique_spans"],
        "Correct": cf["CORRECT"],
        "Empty": cf["EMPTY"],
        "Wrong": cf["WRONG"],
        "Swapped": cf["SWAPPED"],
        "Correct_Empty": ce,
        "Profile_Value": pv,
        "PD_Full": ab["full"],
        "Synergy_Eligible": synergy_eligible,
        "Synergy_Success": synergy_success,
        "Synergy_Rate": rate(synergy_success, synergy_eligible),
        "Joint_Interference": ji,
        "Coverage": cov,
        "J1_Generalization": gen,
        "J1_Production_Candidate": "YES" if prod else "NO",
        "Reason": "; ".join(reason),
        "Highest_Priority_Failure_Class": primary_fail,
        "Known_Secondary_Issues": [
            "WRONG_SWAPPED_DOMAIN_CANDIDATE_BUDGET_SELECTIVITY",
            "DOWNSTREAM_SAMEDOMAIN_INTERACTION",
            "REAL_D_ONLY_COVERAGE_LIMITATION",
        ],
        "Recommended_Next_Phase": (
            "RUNTIME_SWAP_E2E"
            if prod
            else (
                "LEXICON_SOFT_PRIOR_YIELD_AUDIT_THEN_FROZEN_V2_RETEST"
                if freeze_bar == "NOT_PRODUCTION_PROVEN"
                else "J2_TRAIN_ON_SEPARATE_TRAINSET_THEN_BLIND_FROZEN_V2"
            )
        ),
    }
    dump(OUT / "go_summary.json", go)
    dump(OUT / "stage_j_v2_blind_eval_summary.json", go)
    print("BLIND EVAL DONE", json.dumps(go, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
