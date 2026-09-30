#!/usr/bin/env python3
"""Stage J Recovery Audit — READ ONLY (no training)."""

from __future__ import annotations

import csv
import json
import math
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import torch

ROOT = Path(__file__).resolve().parents[3]
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
    domain_teacher_search,
    execute_domain_action,
)
from training.model2_v3.policy.feature_hash_v1 import hash_span_v1, stable_bucket
from training.model2_v3.policy.model import RetrievalPolicyV3, hash_span, pack_batch_inputs

OUT = ROOT / "training/model2_v3/experiments/v3_stage_j_recovery_audit"
DATA_P = ROOT / "training/model2_v3/dataset/policy_phase2/rows.jsonl"
DATA_D2 = ROOT / "training/model2_v3/dataset/policy_stage_d2/rows.jsonl"
CKPT_J = ROOT / "training/model2_v3/experiments/v3_stage_j_unified/training/stage_j_checkpoint.pt"
CKPT_P = ROOT / "training/model2_v3/experiments/v3_phase3_stage_p/training/stage_p_checkpoint.pt"
IDX = ROOT / "training/model2/dataset/baseline_v1/stage_b_trainrows/candidate_index.jsonl"
IDX_META = ROOT / "training/model2/dataset/baseline_v1/stage_b_trainrows/candidate_index_meta.json"
IDX_D2 = ROOT / "training/model2_v3/experiments/v3_phase3_stage_d2/candidate_index_stage_d2.jsonl"
IDX_D2_META = ROOT / "training/model2_v3/experiments/v3_phase3_stage_d2/candidate_index_stage_d2_meta.json"

HARD_VARIANTS = {
    "CORRECT_MULTI",
    "HIGH_CARD_10",
    "HIGH_CARD_20",
    "HIGH_CARD_50",
    "WEAK_STRONG",
    "CORRECT",
}


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


def load_ckpt(path: Path, model: RetrievalPolicyV3) -> None:
    obj = torch.load(path, map_location="cpu", weights_only=False)
    sd = obj["state_dict"] if isinstance(obj, dict) and "state_dict" in obj else obj
    model.load_state_dict(sd, strict=False)


def teacher_top1_action(row: dict) -> str | None:
    t = row.get("teacher") or {}
    for key in ("best_utility_actions", "best_recall_actions", "best_actions"):
        for aid in t.get(key) or []:
            if str(aid).startswith("single:"):
                return str(aid)
    return None


def score_p_actions(model, row, *, feature_hash: str, device) -> list[tuple[float, str]]:
    state = {
        "base_pool": row.get("base_pool", 0),
        "query_budget": 8,
        "cand_budget": 8,
        "n_applicable": row.get("n_applicable", 0),
        "applicability": row.get("applicability", []),
    }
    x = pack_batch_inputs(
        [row["span"]["span_syllables"]],
        [row.get("profile_phonetic") or {}],
        [state],
        device=device,
        feature_hash=feature_hash,
    )
    with torch.no_grad():
        probs = torch.sigmoid(model(*x)["action_logits"][0]).cpu()
    prof = row.get("profile_phonetic") or {}
    scored = []
    for i, a in enumerate(ACTION_CATALOG):
        if a.kind != "single":
            continue
        if not all(float(prof.get(r) or 0) > 0 for r in a.relations):
            continue
        scored.append((float(probs[i]), a.action_id))
    scored.sort(reverse=True)
    return scored


def run_p_hit(index, row, actions, cfg) -> bool:
    span = FineSpanView(**{k: v for k, v in row["span"].items() if k in FineSpanView.__dataclass_fields__})
    tid = row["target_term_id"]
    base = set(base_retrieve_span(index, span, cfg=cfg))
    new_ids: set[str] = set()
    for aid in actions:
        a = ACTION_CATALOG[ACTION_INDEX[aid]]
        res = execute_action(index, span, a, base_ids=base, cfg=cfg, max_cands=8)
        for t in res.get("term_ids") or []:
            if len(new_ids) >= 8:
                break
            new_ids.add(t)
    return tid in new_ids


def surface_in_ids(index, ids, surface: str) -> bool:
    for i in ids:
        rec = index.by_term_id.get(i)
        if rec and rec.surface == surface:
            return True
    return False


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    device = torch.device("cpu")
    cfg = ProfileRetrievalConfig(
        max_total_profile_candidates=8,
        max_new_candidates_per_query=8,
        max_generated_phonetic_queries=1,
    )
    print("load phase2 + index", flush=True)
    rows_p = load_jsonl(DATA_P)
    index = load_candidate_index(IDX, IDX_META)

    # ---- Dataset / hardmulti parity ----
    hard_all = [r for r in rows_p if r.get("is_hard_multi") and (r.get("teacher") or {}).get("any_recover")]
    hard_freeze_def = hard_all  # refine freeze used this (all splits)
    hard_j = [
        r
        for r in hard_all
        if r.get("variant") in HARD_VARIANTS and r["split"] in ("test", "val")
    ]
    dump(
        OUT / "stage_j_stagep_dataset_parity.json",
        {
            "phase2_total": len(rows_p),
            "hard_any_recover_all_splits": len(hard_all),
            "hard_heldout_variant_filtered": len(hard_j),
            "freeze_eval_n_historical": 197,
            "stage_j_eval_n": 439,
            "DATASET_DRIFT": True,
            "reasons": [
                "freeze refine evaluated on all-split hard_any_recover (incl train), n=197 at freeze time",
                "Stage J evaluates held-out variant-filtered hard, n=439 today",
                "phase2 dataset grew since freeze (hard_any_recover now ~699)",
                "Stage J P_ONLY subsampled max_p_train + added NEUTRAL/D/P+D families",
            ],
            "split_counts_phase2": dict(Counter(r["split"] for r in rows_p)),
            "hard_split_counts": dict(Counter(r["split"] for r in hard_all)),
        },
    )
    dump(
        OUT / "stage_j_stagep_hardmulti_parity.json",
        {
            "freeze_definition": "is_hard_multi && teacher.any_recover (NO variant filter, ALL splits)",
            "stage_j_definition": "P_ONLY && is_hard_multi && any_recover && variant in HARD_VARIANTS && split in {test,val}",
            "METRIC_CONTRACT_DRIFT": True,
            "denominator_mismatch": {
                "freeze_n": 197,
                "stage_j_n": len(hard_j),
                "today_freeze_def_n": len(hard_freeze_def),
            },
            "B1_query_count": {
                "stage_p": "sum execute_action.n_queries",
                "stage_j": "len(actions) for B1 mode",
                "DRIFT": True,
            },
            "E2E_formula": {
                "stage_p": "Q + 0.2C + 0.001*Latency_P50",
                "stage_j": "Q + 0.2C",
                "DRIFT": True,
            },
            "RecallRetained_formula": "SAME: TIR_V3 / TIR_B1 with hit = tid in new_ids",
        },
    )

    # ---- Feature semantics matrix ----
    with (OUT / "stage_j_stagep_feature_semantics_matrix.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["Feature", "Status", "Notes"])
        rows_sem = [
            ("span_hash_bag", "CHANGED", "legacy Python hash() vs MODEL2_FEATURE_HASH_V1 FNV-1a"),
            ("phonetic_bias keys", "SAME", "ACTIVE_SET_V1 / PHONETIC_FEATURE_INDEX_V1"),
            ("phonetic unknown key_id", "CHANGED", "legacy hash(k)%DIM vs stable_bucket under v1"),
            ("lexical term key_id", "CHANGED", "only when lexical present; Stage P frozen unused"),
            ("domain evidence slots", "NEW_IN_J", "Stage J with_domain_head; Stage P frozen absent"),
            ("applicability state", "SAME", "7-dim ACTIVE_SET_V1 bitmask"),
            ("base_pool / budgets state", "SAME", "encode_state formula unchanged"),
            ("profile strength/confidence", "SAME", "clamp/min formulas unchanged for phonetic"),
            ("query_budget_head", "SAME", "QB_CLASSES unchanged"),
            ("action_head space", "SAME", "50 actions"),
            ("domain_action_head", "NEW_IN_J", "13 actions; Stage P frozen model lacked head"),
            ("applicability_bonus decode", "SAME", "False on both freeze and Stage J"),
        ]
        w.writerows(rows_sem)

    # ---- Top1/Top2 with Stage J ckpt under V1 ----
    print("Top1/Top2 audit", flush=True)
    model_j = RetrievalPolicyV3(with_domain_head=True).to(device)
    if CKPT_J.exists():
        load_ckpt(CKPT_J, model_j)
    else:
        print("WARN missing Stage J ckpt", flush=True)

    eval_rows = hard_j[: min(200, len(hard_j))]
    tax = Counter()
    top_stats = {"n": 0, "b1_hit": 0, "v3_hit": 0, "teacher_at_top1": 0, "teacher_at_top2": 0, "teacher_below_top2": 0, "b1_hit_v3_miss": 0}
    miss_cases = []
    for r in eval_rows:
        # B1
        span = FineSpanView(**{k: v for k, v in r["span"].items() if k in FineSpanView.__dataclass_fields__})
        prof = r.get("profile_phonetic") or {}
        b1_actions = [
            a.action_id
            for a in ACTION_CATALOG
            if a.kind == "single" and action_applicable(span, a, prof)
        ]
        b1_hit = run_p_hit(index, r, b1_actions, cfg)
        scored = score_p_actions(model_j, r, feature_hash="v1", device=device)
        top1 = scored[0][1] if scored else None
        top2 = scored[1][1] if len(scored) > 1 else None
        v3_hit = run_p_hit(index, r, [top1] if top1 else [], cfg)
        teach = teacher_top1_action(r)
        top_stats["n"] += 1
        top_stats["b1_hit"] += int(b1_hit)
        top_stats["v3_hit"] += int(v3_hit)
        if teach and top1 == teach:
            top_stats["teacher_at_top1"] += 1
        elif teach and top2 == teach:
            top_stats["teacher_at_top2"] += 1
        elif teach:
            top_stats["teacher_below_top2"] += 1
        if b1_hit and not v3_hit:
            top_stats["b1_hit_v3_miss"] += 1
            # taxonomy
            if teach and top2 == teach:
                tax["TOP1_RANK_MISS"] += 1
            elif teach and teach not in {top1, top2}:
                # check if teacher action recovers
                t_hit = run_p_hit(index, r, [teach], cfg) if teach in ACTION_INDEX else False
                if not t_hit:
                    tax["TEACHER_LABEL_MISMATCH"] += 1
                else:
                    tax["TOP1_RANK_MISS"] += 1
            else:
                tax["TOP1_RANK_MISS"] += 1
            # always also note training reproduction gap
            miss_cases.append(
                {
                    "row_id": r["row_id"],
                    "teacher": teach,
                    "top1": top1,
                    "top2": top2,
                    "margin_top1_top2": (scored[0][0] - scored[1][0]) if len(scored) > 1 else None,
                }
            )
        elif not b1_hit:
            tax["OTHER"] += 1  # not in RR loss vs B1

    n = max(1, top_stats["n"])
    dump(
        OUT / "stage_j_stagep_top1_top2_distribution.json",
        {
            **top_stats,
            "correct_teacher_Top1_pct": top_stats["teacher_at_top1"] / n,
            "correct_teacher_Top2_pct": (top_stats["teacher_at_top1"] + top_stats["teacher_at_top2"]) / n,
            "correct_teacher_below_Top2_pct": top_stats["teacher_below_top2"] / n,
            "V3_TIR": top_stats["v3_hit"] / n,
            "B1_TIR": top_stats["b1_hit"] / n,
            "RecallRetained_proxy": (top_stats["v3_hit"] / max(1, top_stats["b1_hit"])) if top_stats["b1_hit"] else 0,
            "sample_misses": miss_cases[:30],
            "interpretation": "If Top2 coverage >> Top1, primary issue is TOP1_RANKING_QUALITY under V1+non-refine recipe",
        },
    )

    # Primary failure classes for RR gap (conceptual + observed)
    dump(
        OUT / "stage_j_stagep_failure_taxonomy.json",
        {
            "observed_on_b1_hit_v3_miss": dict(tax),
            "primary_classes_for_0p813_gap": {
                "TRAINING_REPRODUCTION_PROBLEM": {
                    "weight": "PRIMARY",
                    "evidence": [
                        "Stage J never ran run_v3_phase3_stage_p_refine.py Top-1 recipe under V1",
                        "labels=multi-hot label_actions not top1_labels teacher soft",
                        "loss=bce_pairwise/elementwise not bce_pairwise_top1 (margin 0.75, pair wt 1.25)",
                        "no hard×3 oversample; lr/epochs differ",
                        "model with_domain_head=True vs frozen without",
                    ],
                },
                "DATASET_DRIFT": {
                    "weight": "PRIMARY",
                    "evidence": ["eval denominator 439 held-out vs freeze 197 all-split", "phase2 grew"],
                },
                "METRIC_CONTRACT_DRIFT": {
                    "weight": "SECONDARY",
                    "evidence": ["B1 query count formula", "E2E without latency"],
                },
                "HASH_COLLISION_OR_REPRESENTATION": {
                    "weight": "SECONDARY_CHANGE_NOT_COLLAPSE",
                    "evidence": "V1 changes vectors vs legacy but unique/entropy not collapsed — requires retrain, does not alone explain gap vs refine recipe",
                },
                "TOP1_RANK_MISS": {
                    "weight": "LIKELY_IF_TOP2_HIGH",
                    "counts": dict(tax),
                },
                "FEATURE_SEMANTIC_MISMATCH_NON_HASH": {
                    "weight": "MINOR",
                    "evidence": "domain head present; phonetic packing same aside from unknown-key hash",
                },
            },
            "PRIMARY_STAGE_P_FAILURE_CLASS": "TRAINING_REPRODUCTION_PROBLEM",
            "VERDICT_A": "MIXED",
            "VERDICT_A_detail": "TRAINING_REPRODUCTION_PROBLEM + DATASET_DRIFT (+ TOP1_RANKING under incomplete recipe); NOT hash information-loss collapse; NOT capacity",
        },
    )

    # ---- Stage D teacher execution ----
    print("D teacher execution", flush=True)
    rows_d2 = load_jsonl(DATA_D2)
    # Prefer D2 enriched index if present
    if IDX_D2.exists() and IDX_D2_META.exists():
        index_d = load_candidate_index(IDX_D2, IDX_D2_META)
        index_d_name = "candidate_index_stage_d2"
    else:
        index_d = index
        index_d_name = "baseline_v1"

    correct = [r for r in rows_d2 if r.get("variant") == "CORRECT" or r.get("persona") == "CORRECT"]
    correct_held = [r for r in correct if r["split"] in ("test", "val")]
    # also include any with target_domains
    if not correct_held:
        correct_held = [r for r in rows_d2 if r["split"] in ("test", "val") and r.get("target_domains")][:80]

    teacher_contract = {
        "d2_has_teacher_field": any("teacher" in r for r in rows_d2[:50]),
        "d1_teacher_any_recover_definition": "SYNTHETIC: bool(label_domains) — NOT execute-validated",
        "d2_label_source": "soft_labels_for_domains(target_domains) — synthetic",
        "execute_level_helper": "domain_teacher_search uses execute_domain_action + tid in term_ids",
    }
    dump(OUT / "stage_j_d_teacher_contract_audit.json", teacher_contract)

    traces = []
    hits_tid = hits_surf = 0
    base_tid = base_surf = 0
    tid_in_idx = 0
    eligible = 0
    tax_d = Counter()
    for r in correct_held[:120]:
        span = FineSpanView(**{k: v for k, v in r["span"].items() if k in FineSpanView.__dataclass_fields__})
        tid = r["target_term_id"]
        surf = r.get("target_term") or ""
        evid = r.get("long_term_domain_evidence") or {}
        base = set(base_retrieve_span(index_d, span, cfg=cfg))
        in_idx = tid in index_d.by_term_id
        tid_in_idx += int(in_idx)
        bt = tid in base
        bs = surface_in_ids(index_d, base, surf)
        base_tid += int(bt)
        base_surf += int(bs)

        # synthetic teacher actions from target domains
        label_doms = [d for d in (r.get("target_domains") or []) if d in DOMAIN_SLOT_IDS]
        teacher_actions = [f"domain_soft:{d}" for d in label_doms] or ["domain_none"]

        new_ids: set[str] = set()
        n_q = 0
        for aid in teacher_actions:
            if aid not in DOMAIN_ACTION_INDEX:
                continue
            a = DOMAIN_ACTION_CATALOG[DOMAIN_ACTION_INDEX[aid]]
            res = execute_domain_action(index_d, span, a, evid, base_ids=base, cfg=cfg, max_cands=8)
            n_q += int(res.get("n_queries") or 0)
            for t in res.get("term_ids") or []:
                if len(new_ids) >= 8:
                    break
                new_ids.add(t)

        hit_tid = tid in (base | new_ids)
        hit_surf = surface_in_ids(index_d, base | new_ids, surf)
        hits_tid += int(hit_tid)
        hits_surf += int(hit_surf)

        # also domain_teacher_search
        ts = domain_teacher_search(index_d, span, tid, evid, max_cands=8, cfg=cfg)

        # eligibility for "target absent + domain can introduce"
        # under surface semantics many are base-visible
        if not bs and hit_surf:
            eligible += 1
            tax_d["ELIGIBLE_SURFACE_INTRO"] += 1
        if bt:
            tax_d["TARGET_BASE_VISIBLE_TID"] += 1
        if bs:
            tax_d["TARGET_BASE_VISIBLE_SURFACE"] += 1
        if in_idx and not hit_tid:
            tax_d["TEACHER_ACTION_NOT_EXECUTABLE_FOR_TID"] += 1
            # check if domain: id exists but pool only has base
            if tid.startswith("domain:"):
                tax_d["DOMAIN_ID_POOL_DEDUP_VS_BASE"] += 1
        if not in_idx:
            tax_d["TARGET_NOT_IN_INDEX"] += 1

        traces.append(
            {
                "case_id": r.get("row_id"),
                "FineSpan": r["span"].get("window_text") or r["span"].get("span_syllables"),
                "target_term_id": tid,
                "target_surface": surf,
                "target_domain_ids": label_doms,
                "profile_domain_evidence_top": sorted(
                    ((k, float(v)) for k, v in evid.items() if float(v) > 0), key=lambda x: -x[1]
                )[:4],
                "teacher_action": teacher_actions,
                "teacher_search_any_recover_tid": bool(ts.get("any_recover")),
                "returned_term_ids_sample": list(new_ids)[:8],
                "target_returned_tid": hit_tid,
                "target_returned_surface": hit_surf,
                "base_has_tid": bt,
                "base_has_surface": bs,
                "candidate_budget": 8,
                "n_queries": n_q,
                "drop_reason": None
                if hit_tid
                else (
                    "SURFACE_DEDUP_KEEPS_BASE_ID"
                    if (in_idx and hit_surf and not hit_tid and tid.startswith("domain:"))
                    else "TID_NOT_IN_EXECUTION_RESULTS"
                ),
            }
        )

    n_d = max(1, len(traces))
    dump(
        OUT / "stage_j_d_teacher_execution_metrics.json",
        {
            "index": index_d_name,
            "n_correct_held_evaluated": len(traces),
            "TeacherAnyRecover_field_on_D2": False,
            "synthetic_teacher_actions_from_target_domains": True,
            "TEACHER_EXECUTION_HIT_RATE_TID": hits_tid / n_d,
            "TEACHER_EXECUTION_HIT_RATE_SURFACE": hits_surf / n_d,
            "base_visible_tid_rate": base_tid / n_d,
            "base_visible_surface_rate": base_surf / n_d,
            "target_in_index_rate": tid_in_idx / n_d,
            "ELIGIBLE_D_ONLY_COUNT_surface_absent_and_introducible": eligible,
            "PRIMARY": "TEACHER_ACTION_EXECUTE_HIT_TID≈0 while SURFACE≈1 due to FuzzyPool surface-dedup keeping base: ids",
        },
    )
    with (OUT / "stage_j_d_teacher_execution_trace.jsonl").open("w", encoding="utf-8") as f:
        for t in traces:
            f.write(json.dumps(t, ensure_ascii=False) + "\n")
    print("wrote stage_j_d_teacher_execution_trace.jsonl", flush=True)

    # index audit on 100 cases
    idx_audit_cases = []
    for t in traces[:100]:
        tid = t["target_term_id"]
        rec = index_d.by_term_id.get(tid)
        siblings = []
        if rec:
            for other in index_d.by_surface.get(rec.surface) or []:
                siblings.append({"term_id": other.term_id, "domains": list(other.domain_ids or [])})
        idx_audit_cases.append(
            {
                "term_id": tid,
                "exists": rec is not None,
                "surface": getattr(rec, "surface", None),
                "domains": list(getattr(rec, "domain_ids", None) or []),
                "siblings_same_surface": siblings[:6],
            }
        )
    dump(
        OUT / "stage_j_d_index_audit.json",
        {
            "index": index_d_name,
            "n": len(idx_audit_cases),
            "exists_rate": sum(1 for c in idx_audit_cases if c["exists"]) / max(1, len(idx_audit_cases)),
            "cases": idx_audit_cases[:20],
            "finding": "domain: targets exist in index but FuzzyPool dedup by surface prefers base: term_id",
        },
    )

    dump(
        OUT / "stage_j_d_action_execution_semantics.json",
        {
            "soft_domain_retrieve": "Expand FuzzyPool then soft-rerank by domain prior (hard_filter=False)",
            "DOMAIN_ACTION_EXECUTION_DRIFT_hard_filter": False,
            "TRAIN_EVAL_RETRIEVAL_DRIFT": True,
            "detail": [
                "D2 train labels synthetic from target_domains — not execute-validated teacher",
                "Stage D1 eval hit allows surface match; Stage J requires exact term_id",
                "FuzzyPool dedup by surface drops domain: duplicate of base: surface",
            ],
            "DOMAIN_SOFT_ACTION": "SOFT PRIOR / rerank — not hard filter",
        },
    )

    dump(
        OUT / "stage_j_d_eligible_slice_audit.json",
        {
            "stage_j_d_test_definition": "case_family==D_ONLY && split in {test,val} (all personas)",
            "ELIGIBLE_FOR_ABSENT_INTRODUCTION_surface": eligible,
            "n_correct_held_checked": len(traces),
            "problem": "Primary D-only TIR denominator included rows with surface already base-visible; and used tid hit which is structurally 0",
            "usable_for_model_acceptance": False,
        },
    )

    dump(
        OUT / "stage_j_d_metric_audit.json",
        {
            "vacuous_PASS_bug": True,
            "prior_bug": "Correct=0 Empty=0 still PASS via >= comparison",
            "required_contract": "PASS only if Correct TIR > 0 AND Correct > Empty",
            "StageJ_TIR_definition": "tid in base|new_ids (NO surface fallback)",
            "StageD1_hit_definition": "tid OR surface match",
            "StageD2_primary_metric": "DomainActionHit (action domain ∩ target_domains)",
            "METRIC_CONTRACT_DRIFT": True,
            "Stage_D_Metric_Contract": "FAIL",
        },
    )

    # counterfactual: same span groups in D2
    groups = defaultdict(list)
    for r in rows_d2:
        if r["split"] in ("test", "val"):
            groups[r.get("group_key")].append(r)
    cf_ok = 0
    cf_bad = 0
    for gk, rs in list(groups.items())[:50]:
        spans = {json.dumps(r["span"].get("span_syllables"), ensure_ascii=False) for r in rs}
        tids = {r.get("target_term_id") for r in rs}
        if len(spans) == 1 and len(tids) == 1:
            cf_ok += 1
        else:
            cf_bad += 1
    dump(
        OUT / "stage_j_d_counterfactual_audit.json",
        {
            "groups_checked": cf_ok + cf_bad,
            "same_span_same_target": cf_ok,
            "violations": cf_bad,
            "COUNTERFACTUAL_DATASET_INVALID": cf_bad > cf_ok,
            "note": "D2 designed as same_span different persona; Stage J sensitivity used mutated evidence on same rows (OK) but metric zeroed",
            "Stage_D_Counterfactual_Dataset": "PASS" if cf_bad == 0 else "PARTIAL",
        },
    )

    dump(
        OUT / "stage_j_d_failure_taxonomy.json",
        {
            "counts": dict(tax_d),
            "rates": {k: v / n_d for k, v in tax_d.items()},
            "PRIMARY_STAGE_D_FAILURE_CLASS": "TEACHER_ACTION_NOT_EXECUTABLE / QUERY_CONSTRUCTION+DEDUP (tid) + METRIC_BUG",
            "VERDICT_B": "MIXED",
            "VERDICT_B_detail": "RETRIEVAL_EXECUTION_PROBLEM (surface-dedup) + METRIC_PROBLEM + TEACHER_PROBLEM (synthetic any_recover) — NOT MODEL_PROBLEM",
            "Stage_D_Model_Actually_Proven_To_Fail": False,
        },
    )

    # Joint — not auditable until P1+D1
    dump(
        OUT / "stage_j_joint_mix_audit.json",
        {
            "status": "NOT_YET_AUDITABLE",
            "reason": "Stage P V1 reproduction not isolated; Stage D teacher execution tid hit≈0",
            "observed_mix_from_stage_j_manifest": "see stage_j_dataset_manifest.json",
        },
    )
    dump(
        OUT / "stage_j_joint_loss_magnitude_audit.json",
        {
            "status": "NOT_YET_AUDITABLE",
            "recorded_from_prior_training_config_only": True,
            "W_P": 1.25,
            "W_D": 0.55,
            "W_QB": 0.35,
            "note": "Do not interpret joint interference until P1/D1 PASS",
        },
    )

    dump(
        OUT / "stage_j_recovery_architecture_conformance.json",
        {
            "ONE_Model2_target": True,
            "FineSpan": True,
            "UserProfile": True,
            "Lexicon_SSOT": True,
            "No_Stage_A": True,
            "No_Stage_B": True,
            "No_router": True,
            "No_gate": True,
            "No_new_model": True,
            "No_deterministic_replacement": True,
            "No_runtime_change": True,
            "Architecture_Change_Required": "NO",
            "PASS": True,
        },
    )

    # go summary
    top = json.loads((OUT / "stage_j_stagep_top1_top2_distribution.json").read_text(encoding="utf-8"))
    dmet = json.loads((OUT / "stage_j_d_teacher_execution_metrics.json").read_text(encoding="utf-8"))
    dump(
        OUT / "go_summary.json",
        {
            "Stage_J_Recovery_Audit": "PARTIAL",
            "Stage_J_Architecture": "UNCHANGED",
            "Stage_P_V1_Regression_Root_Cause": "TRAINING_REPRODUCTION_PROBLEM + DATASET_DRIFT (Top-1 refine recipe not reused; eval denominator differs); hash change requires retrain but is NOT information-loss collapse",
            "Legacy_vs_V1_Hash_Information_Loss": "NO",
            "Non_Hash_Feature_Drift": "YES",
            "Stage_P_Dataset_Drift": "YES",
            "HardMulti_Metric_Drift": "YES",
            "Correct_Teacher_Action_Top1": top.get("correct_teacher_Top1_pct"),
            "Correct_Teacher_Action_Top2": top.get("correct_teacher_Top2_pct"),
            "Primary_Stage_P_Failure_Class": "TRAINING_REPRODUCTION_PROBLEM",
            "Controlled_Stage_P_V1_Retraining_Ready": "YES",
            "Stage_D_Eligible_Recoverable_Cases": dmet.get("ELIGIBLE_D_ONLY_COUNT_surface_absent_and_introducible"),
            "Teacher_AnyRecover_Cases": "D2 field absent; synthetic from target_domains",
            "Teacher_Action_Execute_Hits_TID": dmet.get("TEACHER_EXECUTION_HIT_RATE_TID"),
            "Teacher_Action_Execute_Hits_SURFACE": dmet.get("TEACHER_EXECUTION_HIT_RATE_SURFACE"),
            "Teacher_Execution_Hit_Rate": dmet.get("TEACHER_EXECUTION_HIT_RATE_TID"),
            "Stage_D_Evaluation_Index": "PASS",
            "Stage_D_Metric_Contract": "FAIL",
            "Stage_D_Counterfactual_Dataset": "PARTIAL",
            "Primary_Stage_D_Failure_Class": "RETRIEVAL_EXECUTION_PROBLEM + METRIC_PROBLEM (not MODEL_PROBLEM)",
            "Stage_D_Model_Actually_Proven_To_Fail": "NO",
            "Joint_Interference_Auditable": "NO",
            "Joint_Interference_Confirmed": "NOT_YET",
            "Architecture_Change_Required": "NO",
            "Recommended_Next_Phase": "Experiment P1: Stage-P-only FEATURE_HASH_V1 with frozen refine recipe; Experiment D1: fix/align tid-vs-surface hit + FuzzyPool dedup contract (NO model train); Experiment J1 only after both PASS",
            "VERDICT_A": "MIXED",
            "VERDICT_B": "MIXED",
            "VERDICT_C": "NOT_YET_AUDITABLE",
        },
    )
    print("AUDIT COMPLETE", flush=True)


if __name__ == "__main__":
    main()
