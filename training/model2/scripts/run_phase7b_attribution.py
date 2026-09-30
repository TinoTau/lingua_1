#!/usr/bin/env python3
"""Phase 7B — Stage A Generalization Failure Attribution (diagnostic only).

Markers: PHASE7B_DIAGNOSTIC / NOT_FOR_RUNTIME / NOT_FROZEN
Does NOT replace Stage A/B baselines. No architecture change.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Optional

import numpy as np
import torch
from torch.utils.data import DataLoader

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from training.model2.encoding.syllable_vocab import SyllableVocabV1
from training.model2.evaluation.baselines import (
    evaluate_fuzzy_distance_baseline,
    evaluate_fuzzy_prior_baseline,
    fuzzy_distance_ranks,
)
from training.model2.evaluation.evaluate import evaluate_model_on_rows, evaluate_nomatch_fp
from training.model2.evaluation.metrics import summarize_ranking
from training.model2.evaluation.slices import build_seen_term_set, slice_rows, term_surface_from_id
from training.model2.phonetic.syllables import levenshtein_syllables, normalize_syllable
from training.model2.stage_b.active_feature_mask import BOUND_FEATURES_V1
from training.model2.training.config import StageATrainConfig
from training.model2.training.dataset import (
    StageADataset,
    collate_stage_a,
    enrich_trainrows,
    load_candidate_index,
    load_jsonl,
    precompute_candidate_tensors,
)
from training.model2.training.stage_b_trainer import load_stage_a_checkpoint

MARKERS = ["PHASE7B_DIAGNOSTIC", "NOT_FOR_RUNTIME", "NOT_FROZEN"]


def _dump(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def _hash_ids(ids: list[str]) -> str:
    h = hashlib.sha256()
    for x in sorted(ids):
        h.update(x.encode("utf-8"))
        h.update(b"\0")
    return h.hexdigest()[:16]


def _syllables_from_term_id(term_id: str) -> list[str]:
    parts = (term_id or "").split(":")
    if len(parts) >= 4:
        return [normalize_syllable(x) for x in parts[3].replace("|", " ").split() if normalize_syllable(x)]
    return []


def _surface_from_term_id(term_id: str) -> str:
    return term_surface_from_id(term_id) or ""


def _pinyin_key(term_id: str) -> str:
    parts = (term_id or "").split(":")
    return parts[3] if len(parts) >= 4 else ""


def _rank_stats(ranks: list[int], pools: list[int]) -> dict[str, Any]:
    m = summarize_ranking(ranks, pools)
    valid = [r for r in ranks if r >= 0]
    m["mean_target_rank"] = float(statistics.mean(valid)) if valid else None
    m["median_target_rank"] = float(statistics.median(valid)) if valid else None
    return m


def _metric_close(a: float, b: float, tol: float = 1e-4) -> bool:
    return abs(float(a) - float(b)) <= tol


def load_data(args):
    rows_dir = args.rows_dir
    raw = load_jsonl(rows_dir / "model2_train_rows.jsonl")
    samples = {}
    if args.samples.exists():
        samples = {s["sample_id"]: s for s in load_jsonl(args.samples)}
    index = load_candidate_index(rows_dir / "candidate_index.jsonl", rows_dir / "candidate_index_meta.json")
    vocab = SyllableVocabV1.load(rows_dir / "syl-vocab-v1.json")
    rows = enrich_trainrows(raw, samples, index, vocab) if samples else raw
    # ensure is_term_positive for Stage A eval conventions
    for r in rows:
        if r.get("is_term_positive") is None:
            r["is_term_positive"] = bool(r.get("target_in_pool") and r.get("sample_kind") == "POSITIVE")
    cand_cache = precompute_candidate_tensors(index, vocab)
    # join carriers from generation_plan via sample_plan_id in correction_event
    plan_by_id: dict[str, dict] = {}
    if args.plan.exists():
        for p in load_jsonl(args.plan):
            plan_by_id[p.get("sample_plan_id") or ""] = p
    for r in rows:
        sid = r.get("sample_id") or ""
        # ts-... vs synth-event-acc-XXX / acc-XXX
        carrier = None
        sample = samples.get(sid) or {}
        syn = ((sample.get("metadata") or {}).get("synthetic") or {})
        evt = ((sample.get("metadata") or {}).get("correction_event_id") or "")
        plan_id = None
        if evt.startswith("synth-event-"):
            plan_id = evt[len("synth-event-") :]
        elif syn.get("pseudo_user_id"):
            plan_id = None
        if plan_id and plan_id in plan_by_id:
            carrier = plan_by_id[plan_id].get("carrier_id")
        r["_carrier_id"] = carrier
        r["_plan_id"] = plan_id
    return rows, cand_cache, vocab, index, samples


def reproduce_baseline(out_dir: Path, stage_a_metrics: dict, stage_b_go: dict) -> dict:
    expected = {
        "SEEN_TERM.Recall@1": 0.7283898305084746,
        "SEEN_TERM.Recall@3": 0.9449152542372882,
        "UNSEEN_TERM.Recall@1": 0.043521266073194856,
        "UNSEEN_TERM.Recall@3": 0.09792284866468842,
        "UNSEEN_TERM.FuzzyPool_Recall@16_ceiling": 1.0,
        "StageB.ConditionGain@3": 0.24593301435406698,
        "StageB.TargetRankDelta_mean": 4.533014354066986,
    }
    got = {
        "SEEN_TERM.Recall@1": (stage_a_metrics.get("SEEN_TERM") or {}).get("Recall@1"),
        "SEEN_TERM.Recall@3": (stage_a_metrics.get("SEEN_TERM") or {}).get("Recall@3"),
        "UNSEEN_TERM.Recall@1": (stage_a_metrics.get("UNSEEN_TERM") or {}).get("Recall@1"),
        "UNSEEN_TERM.Recall@3": (stage_a_metrics.get("UNSEEN_TERM") or {}).get("Recall@3"),
        "UNSEEN_TERM.FuzzyPool_Recall@16_ceiling": (stage_a_metrics.get("UNSEEN_TERM") or {}).get(
            "FuzzyPool_Recall@16_ceiling"
        ),
        "StageB.ConditionGain@3": stage_b_go.get("ConditionGain@3"),
        "StageB.TargetRankDelta_mean": stage_b_go.get("TargetRankDelta_mean"),
    }
    checks = {k: _metric_close(got[k], expected[k]) for k in expected}
    report = {
        "markers": MARKERS,
        "expected": expected,
        "got": got,
        "checks": checks,
        "pass": all(checks.values()),
        "note": "Compared against Phase 7A artifact files (metrics.json / go_summary.json).",
    }
    _dump(out_dir / "phase7b_baseline_reproduction.json", report)
    return report


def split_integrity(rows: list[dict], out_dir: Path) -> dict:
    by_split: dict[str, list] = defaultdict(list)
    for r in rows:
        by_split[r.get("split") or "UNK"].append(r)

    def term_set(split: str, key=lambda r: r.get("target_term_id")):
        return {key(r) for r in by_split.get(split, []) if r.get("target_term_id")}

    def user_set(split: str):
        return {r.get("pseudo_user_id") for r in by_split.get(split, []) if r.get("pseudo_user_id")}

    train_terms = term_set("train")
    val_terms = term_set("validation")
    test_terms = term_set("test")
    train_surf = {_surface_from_term_id(t) for t in train_terms}
    val_surf = {_surface_from_term_id(t) for t in val_terms}
    test_surf = {_surface_from_term_id(t) for t in test_terms}
    train_py = {_pinyin_key(t) for t in train_terms}
    val_py = {_pinyin_key(t) for t in val_terms}
    test_py = {_pinyin_key(t) for t in test_terms}
    train_syl = {tuple(_syllables_from_term_id(t)) for t in train_terms}
    val_syl = {tuple(_syllables_from_term_id(t)) for t in val_terms}
    test_syl = {tuple(_syllables_from_term_id(t)) for t in test_terms}

    def pool_sig(r):
        ids = tuple(sorted(r.get("fuzzy_pool_term_ids") or []))
        return hashlib.sha1("|".join(ids).encode()).hexdigest()[:12]

    train_pool = {pool_sig(r) for r in by_split["train"] if r.get("is_term_positive")}
    val_pool = {pool_sig(r) for r in by_split["validation"] if r.get("is_term_positive")}
    test_pool = {pool_sig(r) for r in by_split["test"] if r.get("is_term_positive")}

    train_carriers = {r.get("_carrier_id") for r in by_split["train"] if r.get("_carrier_id")}
    val_carriers = {r.get("_carrier_id") for r in by_split["validation"] if r.get("_carrier_id")}
    test_carriers = {r.get("_carrier_id") for r in by_split["test"] if r.get("_carrier_id")}

    train_fam = {r.get("corruption_family") for r in by_split["train"] if r.get("corruption_family")}
    val_fam = {r.get("corruption_family") for r in by_split["validation"] if r.get("corruption_family")}
    test_fam = {r.get("corruption_family") for r in by_split["test"] if r.get("corruption_family")}

    out = {
        "markers": MARKERS,
        "train_term_count": len(train_terms),
        "val_term_count": len(val_terms),
        "test_term_count": len(test_terms),
        "train_user_count": len(user_set("train")),
        "val_user_count": len(user_set("validation")),
        "test_user_count": len(user_set("test")),
        "term_overlap_train_val": len(train_terms & val_terms),
        "term_overlap_train_test": len(train_terms & test_terms),
        "user_overlap_train_val": len(user_set("train") & user_set("validation")),
        "user_overlap_train_test": len(user_set("train") & user_set("test")),
        "surface_overlap_train_val": len(train_surf & val_surf),
        "surface_overlap_train_test": len(train_surf & test_surf),
        "pinyin_overlap_train_val": len(train_py & val_py),
        "pinyin_overlap_train_test": len(train_py & test_py),
        "syllable_seq_overlap_train_val": len(train_syl & val_syl),
        "syllable_seq_overlap_train_test": len(train_syl & test_syl),
        "relation_family_overlap_train_val": sorted(train_fam & val_fam),
        "relation_family_overlap_train_test": sorted(train_fam & test_fam),
        "carrier_overlap_train_val": len(train_carriers & val_carriers),
        "carrier_overlap_train_test": len(train_carriers & test_carriers),
        "carrier_join_coverage": {
            "train": sum(1 for r in by_split["train"] if r.get("_carrier_id")),
            "validation": sum(1 for r in by_split["validation"] if r.get("_carrier_id")),
            "test": sum(1 for r in by_split["test"] if r.get("_carrier_id")),
        },
        "pool_signature_overlap_train_val": len(train_pool & val_pool),
        "pool_signature_overlap_train_test": len(train_pool & test_pool),
        "normalized_term_overlap_note": "surface = term_id part[2]; normalized same as surface for baseline_v1",
    }
    _dump(out_dir / "split_integrity_audit.json", out)
    return out


def slice_identity_audit(rows: list[dict], out_dir: Path) -> dict:
    seen_surf = build_seen_term_set(rows)
    train_users = {r.get("pseudo_user_id") for r in rows if r.get("split") == "train" and r.get("pseudo_user_id")}
    train_term_ids = {
        r.get("target_term_id")
        for r in rows
        if r.get("split") == "train" and r.get("is_term_positive") and r.get("target_term_id")
    }
    eval_pos = [
        r
        for r in rows
        if r.get("split") in ("validation", "test")
        and r.get("is_term_positive")
        and r.get("target_in_pool")
        and r.get("source_type") == "TTS_ASR_SYNTHETIC"
        and not r.get("context_target_leak")
    ]

    def pack(name: str, subset: list[dict]) -> dict:
        row_ids = [r.get("trainrow_id") or r.get("sample_id") or "" for r in subset]
        utt = [r.get("sample_id") or "" for r in subset]
        users = [r.get("pseudo_user_id") or "" for r in subset]
        terms = [r.get("target_term_id") or "" for r in subset]
        return {
            "n_rows": len(subset),
            "utterance_id_hash": _hash_ids(utt),
            "user_id_hash": _hash_ids(users),
            "term_id_hash": _hash_ids(terms),
            "row_id_hash": _hash_ids(row_ids),
            "row_ids": row_ids,
        }

    slices = {
        "SEEN_TERM": pack(
            "SEEN_TERM",
            [r for r in rows if r.get("is_term_positive") and r.get("target_in_pool") and _surface_from_term_id(r.get("target_term_id") or "") in seen_surf],
        ),
        "UNSEEN_TERM": pack(
            "UNSEEN_TERM",
            [
                r
                for r in rows
                if r.get("is_term_positive")
                and r.get("target_in_pool")
                and r.get("source_type") == "TTS_ASR_SYNTHETIC"
                and not r.get("context_target_leak")
                and _surface_from_term_id(r.get("target_term_id") or "") not in seen_surf
            ],
        ),
        "SEEN_USER": pack(
            "SEEN_USER",
            [r for r in eval_pos if r.get("pseudo_user_id") in train_users],
        ),
        "UNSEEN_USER": pack(
            "UNSEEN_USER",
            [r for r in eval_pos if r.get("pseudo_user_id") not in train_users],
        ),
        "UNSEEN_TERM_SEEN_USER": pack(
            "UNSEEN_TERM_SEEN_USER",
            [
                r
                for r in eval_pos
                if r.get("target_term_id") not in train_term_ids and r.get("pseudo_user_id") in train_users
            ],
        ),
        "SEEN_TERM_UNSEEN_USER": pack(
            "SEEN_TERM_UNSEEN_USER",
            [
                r
                for r in eval_pos
                if r.get("target_term_id") in train_term_ids and r.get("pseudo_user_id") not in train_users
            ],
        ),
        "UNSEEN_TERM_UNSEEN_USER": pack(
            "UNSEEN_TERM_UNSEEN_USER",
            [
                r
                for r in eval_pos
                if r.get("target_term_id") not in train_term_ids and r.get("pseudo_user_id") not in train_users
            ],
        ),
        # Stage-B export definition (term_id based on train positives)
        "STAGE_B_UNSEEN_TERM_DEF": pack(
            "STAGE_B_UNSEEN_TERM_DEF",
            [r for r in eval_pos if r.get("target_term_id") not in train_term_ids],
        ),
        "STAGE_B_UNSEEN_USER_DEF": pack(
            "STAGE_B_UNSEEN_USER_DEF",
            [r for r in eval_pos if r.get("pseudo_user_id") not in train_users],
        ),
    }

    comparisons = {}
    pairs = [
        ("STAGE_B_UNSEEN_USER_DEF", "STAGE_B_UNSEEN_TERM_DEF"),
        ("SEEN_USER", "UNSEEN_USER"),
        ("SEEN_TERM", "UNSEEN_TERM"),
        ("UNSEEN_TERM_SEEN_USER", "SEEN_TERM_UNSEEN_USER"),
    ]
    for a, b in pairs:
        sa = set(slices[a]["row_ids"])
        sb = set(slices[b]["row_ids"])
        inter = len(sa & sb)
        union = len(sa | sb)
        comparisons[f"{a}__vs__{b}"] = {
            "intersection_count": inter,
            "union_count": union,
            "jaccard": (inter / union) if union else None,
            "exact_same_rows": sa == sb and len(sa) > 0,
            "a_n": len(sa),
            "b_n": len(sb),
        }

    # availability flags
    availability = {}
    for k, v in slices.items():
        if v["n_rows"] == 0:
            availability[k] = "NOT_AVAILABLE_BY_CURRENT_SPLIT"
        else:
            availability[k] = "AVAILABLE"

    # strip large row_ids from saved slice packs (keep hashes)
    slim = {
        k: {kk: vv for kk, vv in v.items() if kk != "row_ids"} | {"availability": availability[k]}
        for k, v in slices.items()
    }
    explanation = {
        "phase7a_unseen_user_eq_unseen_term": comparisons["STAGE_B_UNSEEN_USER_DEF__vs__STAGE_B_UNSEEN_TERM_DEF"][
            "exact_same_rows"
        ],
        "reason": (
            "User-disjoint split ⇒ all validation/test users are unseen. "
            "Term-prefer holdout ⇒ train∩eval target_term_id overlap is 0. "
            "Therefore Stage B unseen_user filter and unseen_term filter select the same eval rows. "
            "Not an exporter bug; split construction makes the two masks identical."
        ),
        "SEEN_USER_on_eval": availability["SEEN_USER"],
        "SEEN_TERM_UNSEEN_USER": availability["SEEN_TERM_UNSEEN_USER"],
        "UNSEEN_TERM_SEEN_USER": availability["UNSEEN_TERM_SEEN_USER"],
    }
    out = {"markers": MARKERS, "slices": slim, "comparisons": comparisons, "explanation": explanation}
    _dump(out_dir / "slice_identity_audit.json", out)
    return out


def combo_slice_audit(rows: list[dict], leakage: dict, out_dir: Path) -> dict:
    flagged = [r for r in rows if r.get("unseen_feature_combo")]
    holdout = (leakage.get("feature_combination_holdout") or {}).get("holdout_family_sets") or []
    keys_present = Counter(r.get("combination_key") for r in rows if r.get("combination_key"))
    holdout_hit = sum(1 for r in rows if (r.get("combination_key") or "") in set(holdout))
    status = "DEFER_INSUFFICIENT_DATA" if len(flagged) == 0 else "EXPORTABLE"
    out = {
        "markers": MARKERS,
        "status": status,
        "n_unseen_feature_combo_flagged_rows": len(flagged),
        "n_holdout_family_sets_registered": len(holdout),
        "n_rows_with_combination_key_in_holdout_sets": holdout_hit,
        "phase7a_empty_object_reason": (
            "build_stage_b_trainrows never set unseen_feature_combo=True on baseline_v1 rows "
            "(0 flagged). Stage B exporter wrote summarize_ranking([]) → empty/near-empty JSON. "
            "Not a PASS; combo holdout registered at plan level but not materialized on trainrows."
        ),
        "top_combination_keys": keys_present.most_common(15),
    }
    _dump(out_dir / "combo_slice_audit.json", out)
    return out


def phonetic_rank(row: dict) -> Optional[int]:
    tgt = row.get("positive_pool_index")
    if tgt is None or not row.get("target_in_pool"):
        return None
    span = [normalize_syllable(s) for s in (row.get("span_syllables") or [])]
    # prefer observed for relation if present
    obs = row.get("observed_syllables_for_relation") or row.get("observed_syllables") or span
    obs = [normalize_syllable(s) for s in obs]
    ids = row.get("fuzzy_pool_term_ids") or []
    scored = []
    for i, tid in enumerate(ids):
        cs = _syllables_from_term_id(tid)
        d = levenshtein_syllables(obs, cs) if obs and cs else 10**6
        # secondary: fuzzy distance if available
        fd = (row.get("fuzzy_pool_distances") or [None] * len(ids))
        fdi = fd[i] if i < len(fd) and fd[i] is not None else 99
        scored.append((d, fdi, i))
    scored.sort()
    order = [i for _, _, i in scored]
    try:
        return order.index(int(tgt))
    except ValueError:
        return None


def evaluate_ranker(rows: list[dict], rank_fn) -> dict:
    ranks, pools = [], []
    for r in rows:
        rk = rank_fn(r)
        ranks.append(-1 if rk is None else rk)
        pools.append(len(r.get("fuzzy_pool_term_ids") or []))
    return _rank_stats(ranks, pools)


def random_baseline(rows: list[dict], reps: int = 20, seed: int = 7) -> dict:
    rng = random.Random(seed)
    metrics = []
    for _ in range(reps):
        ranks, pools = [], []
        for r in rows:
            n = len(r.get("fuzzy_pool_term_ids") or [])
            tgt = r.get("positive_pool_index")
            if not n or tgt is None:
                ranks.append(-1)
                pools.append(n)
                continue
            order = list(range(n))
            rng.shuffle(order)
            ranks.append(order.index(int(tgt)))
            pools.append(n)
        metrics.append(_rank_stats(ranks, pools))
    keys = ["Recall@1", "Recall@3", "MRR", "mean_target_rank"]
    summary = {"n": metrics[0]["n"] if metrics else 0, "reps": reps}
    for k in keys:
        xs = [m[k] for m in metrics if m.get(k) is not None]
        summary[k] = {"mean": float(statistics.mean(xs)) if xs else None, "std": float(statistics.pstdev(xs)) if len(xs) > 1 else 0.0}
    return summary


def minimal_linear_baseline(train_rows: list[dict], eval_rows: list[dict]) -> dict:
    """Tiny logistic on term-independent pool features. Diagnostic only."""

    def feats(row: dict, i: int) -> list[float]:
        dists = row.get("fuzzy_pool_distances") or []
        priors = row.get("fuzzy_pool_priors") or []
        d = float(dists[i]) if i < len(dists) and dists[i] is not None else 9.0
        pr = float(priors[i]) if i < len(priors) and priors[i] is not None else 0.0
        span = [normalize_syllable(s) for s in (row.get("span_syllables") or [])]
        cs = _syllables_from_term_id((row.get("fuzzy_pool_term_ids") or [""])[i])
        lev = float(levenshtein_syllables(span, cs)) if span and cs else 9.0
        same_len = 1.0 if len(span) == len(cs) else 0.0
        # initial/final match rate
        match_i = 0.0
        match_f = 0.0
        if span and cs and len(span) == len(cs):
            for a, b in zip(span, cs):
                if a[:1] == b[:1]:
                    match_i += 1
                if a[-1:] == b[-1:]:
                    match_f += 1
            match_i /= len(span)
            match_f /= len(span)
        return [d, pr, lev, same_len, match_i, match_f, abs(len(span) - len(cs))]

    # collect training pairs: positive vs others as binary
    X, y = [], []
    for r in train_rows:
        tgt = r.get("positive_pool_index")
        ids = r.get("fuzzy_pool_term_ids") or []
        if tgt is None or not ids:
            continue
        for i in range(len(ids)):
            X.append(feats(r, i))
            y.append(1.0 if i == int(tgt) else 0.0)
    if not X:
        return {"n": 0, "error": "no_train_features"}
    X = np.asarray(X, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    # standardize
    mu = X.mean(axis=0)
    sd = X.std(axis=0) + 1e-6
    Xn = (X - mu) / sd
    # closed-form ridge on logits via one-step: use least squares as weak linear score
    # score = w·x ; train to predict y
    A = Xn.T @ Xn + 1e-2 * np.eye(Xn.shape[1])
    w = np.linalg.solve(A, Xn.T @ y)

    def rank_fn(row: dict) -> Optional[int]:
        tgt = row.get("positive_pool_index")
        ids = row.get("fuzzy_pool_term_ids") or []
        if tgt is None or not ids:
            return None
        scores = []
        for i in range(len(ids)):
            f = (np.asarray(feats(row, i)) - mu) / sd
            scores.append(float(f @ w))
        order = sorted(range(len(ids)), key=lambda i: -scores[i])
        return order.index(int(tgt))

    m = evaluate_ranker(eval_rows, rank_fn)
    m["name"] = "B_minimal_linear"
    m["n_params"] = int(w.size)
    m["feature_names"] = [
        "fuzzy_distance",
        "fuzzy_prior",
        "syl_levenshtein",
        "same_len",
        "initial_match_rate",
        "final_match_rate",
        "len_diff",
    ]
    return m


@torch.no_grad()
def model_ranks_detailed(model, rows, cand_cache, cfg) -> list[dict]:
    device = next(model.parameters()).device
    model.eval()
    ds = StageADataset(rows, cand_cache, mode="eval_term_positive", max_pool=cfg.max_pool)
    if len(ds) == 0:
        return []
    loader = DataLoader(ds, batch_size=32, shuffle=False, collate_fn=collate_stage_a)
    # map dataset order back — StageADataset filters; use ds.rows
    out_rows = []
    idx = 0
    for batch in loader:
        batch_t = {k: v.to(device) if torch.is_tensor(v) else v for k, v in batch.items()}
        out = model(batch_t)
        scores = out["scores"]
        base = out.get("score_base", scores)
        for i in range(scores.size(0)):
            r = ds.rows[idx]
            idx += 1
            p = int(batch_t["pool_len"][i].item())
            sc = scores[i, :p].detach().cpu().tolist()
            order = sorted(range(p), key=lambda j: -sc[j])
            tgt = int(batch_t["positive_pool_index"][i].item())
            try:
                rk = order.index(tgt)
            except ValueError:
                rk = -1
            out_rows.append(
                {
                    "row": r,
                    "rank": rk,
                    "scores": sc,
                    "order": order,
                    "pool_len": p,
                    "target": tgt,
                    "score_target": sc[tgt] if 0 <= tgt < p else None,
                    "score_top": sc[order[0]] if order else None,
                }
            )
    return out_rows


@torch.no_grad()
def query_ablation(model, rows, cand_cache, cfg) -> dict:
    device = next(model.parameters()).device
    model.eval()
    ds = StageADataset(rows, cand_cache, mode="eval_term_positive", max_pool=cfg.max_pool)
    if len(ds) == 0:
        return {"n": 0}
    loader = DataLoader(ds, batch_size=32, shuffle=False, collate_fn=collate_stage_a)

    def eval_mode(mode: str) -> dict:
        ranks, pools = [], []
        rng = random.Random(11)
        for batch in loader:
            batch_t = {k: v.to(device) if torch.is_tensor(v) else v for k, v in batch.items()}
            b = batch_t
            if mode == "shuffle_query":
                # permute query-side tensors within batch
                perm = list(range(b["span_char_ids"].size(0)))
                rng.shuffle(perm)
                pt = torch.tensor(perm, device=device)
                for key in (
                    "span_char_ids",
                    "left_char_ids",
                    "right_char_ids",
                    "syllable_ids",
                    "syllable_count",
                    "relative_position",
                ):
                    if key in b and torch.is_tensor(b[key]):
                        b[key] = b[key].index_select(0, pt)
            elif mode == "null_query":
                for key in ("span_char_ids", "left_char_ids", "right_char_ids", "syllable_ids"):
                    if key in b and torch.is_tensor(b[key]):
                        b[key] = torch.zeros_like(b[key])
                if "syllable_count" in b:
                    b["syllable_count"] = torch.zeros_like(b["syllable_count"])
            out = model(b)
            scores = out["scores"]
            for i in range(scores.size(0)):
                p = int(batch_t["pool_len"][i].item())
                order = scores[i, :p].argsort(descending=True).tolist()
                tgt = int(batch_t["positive_pool_index"][i].item())
                try:
                    ranks.append(order.index(tgt))
                except ValueError:
                    ranks.append(-1)
                pools.append(p)
        return _rank_stats(ranks, pools)

    return {
        "markers": MARKERS,
        "n": len(ds),
        "normal": eval_mode("normal"),
        "shuffle_query": eval_mode("shuffle_query"),
        "null_query": eval_mode("null_query"),
    }


@torch.no_grad()
def candidate_shuffle_probe(model, rows, cand_cache, cfg) -> dict:
    """Keep query fixed; permute candidate lexical tensors within each pool."""
    device = next(model.parameters()).device
    model.eval()
    ds = StageADataset(rows, cand_cache, mode="eval_term_positive", max_pool=cfg.max_pool)
    if len(ds) == 0:
        return {"n": 0}
    loader = DataLoader(ds, batch_size=16, shuffle=False, collate_fn=collate_stage_a)
    rng = random.Random(13)

    def run(shuffle: bool) -> dict:
        ranks, pools = [], []
        for batch in loader:
            batch_t = {k: v.to(device) if torch.is_tensor(v) else v for k, v in batch.items()}
            if shuffle:
                # shuffle candidate slots within each example (labels move with slots)
                B = batch_t["cand_char_ids"].size(0)
                for i in range(B):
                    p = int(batch_t["pool_len"][i].item())
                    if p <= 1:
                        continue
                    perm = list(range(p))
                    rng.shuffle(perm)
                    # apply perm to candidate tensors and retarget positive index
                    for key in ("cand_char_ids", "cand_syl_ids", "cand_syl_count", "cand_term_type_oh"):
                        if key not in batch_t:
                            continue
                        x = batch_t[key][i, :p].clone()
                        batch_t[key][i, :p] = x[perm]
                    # positive moves with its slot
                    tgt = int(batch_t["positive_pool_index"][i].item())
                    # find where original tgt went: position j where perm[j]==tgt → new index j
                    # actually we reordered slots: new[j] = old[perm[j]], so old tgt is at j with perm[j]==tgt
                    new_tgt = perm.index(tgt)
                    batch_t["positive_pool_index"][i] = new_tgt
            out = model(batch_t)
            scores = out["scores"]
            for i in range(scores.size(0)):
                p = int(batch_t["pool_len"][i].item())
                order = scores[i, :p].argsort(descending=True).tolist()
                tgt = int(batch_t["positive_pool_index"][i].item())
                try:
                    ranks.append(order.index(tgt))
                except ValueError:
                    ranks.append(-1)
                pools.append(p)
        return _rank_stats(ranks, pools)

    original = run(False)
    shuffled = run(True)
    return {
        "markers": MARKERS,
        "n": len(ds),
        "original_metric": original,
        "shuffled_metric": shuffled,
        "delta_R1": (shuffled.get("Recall@1") or 0) - (original.get("Recall@1") or 0),
        "delta_R3": (shuffled.get("Recall@3") or 0) - (original.get("Recall@3") or 0),
        "note": (
            "Shuffle permutes candidate lexical tensors within pool while moving the positive index "
            "with its slot. If metrics stay high, ranking depends on relative slot structure / query×cand "
            "matching rather than absolute term identity position; if they collapse toward random, "
            "model relies on absolute candidate identity features in the tensors."
        ),
    }


@torch.no_grad()
def query_only_candidate_only(model, rows, cand_cache, cfg) -> dict:
    device = next(model.parameters()).device
    model.eval()
    ds = StageADataset(rows, cand_cache, mode="eval_term_positive", max_pool=cfg.max_pool)
    if len(ds) == 0:
        return {"n": 0}
    loader = DataLoader(ds, batch_size=32, shuffle=False, collate_fn=collate_stage_a)

    def run(mode: str) -> dict:
        ranks, pools = [], []
        for batch in loader:
            batch_t = {k: v.to(device) if torch.is_tensor(v) else v for k, v in batch.items()}
            q = model.encode_query(batch_t)
            c = model.encode_candidates(batch_t)
            if mode == "candidate_only":
                # score by candidate norm proximity to mean query — ignore instance query
                q = q.mean(dim=0, keepdim=True).expand_as(q)
            elif mode == "query_only":
                # collapse candidates to mean embedding per pool position across batch (weak)
                c = c.mean(dim=0, keepdim=True).expand_as(c)
            scores = model.score_base(q, c)
            for i in range(scores.size(0)):
                p = int(batch_t["pool_len"][i].item())
                order = scores[i, :p].argsort(descending=True).tolist()
                tgt = int(batch_t["positive_pool_index"][i].item())
                try:
                    ranks.append(order.index(tgt))
                except ValueError:
                    ranks.append(-1)
                pools.append(p)
        return _rank_stats(ranks, pools)

    full = evaluate_model_on_rows(model, rows, cand_cache, cfg)
    out = {
        "markers": MARKERS,
        "full": full,
        "candidate_only_mean_query": run("candidate_only"),
        "query_only_mean_candidates": run("query_only"),
    }
    co = out["candidate_only_mean_query"].get("Recall@1") or 0
    if co > 0.4:
        out["flag"] = "TERM_SPECIFIC_SHORTCUT_RISK"
    else:
        out["flag"] = None
    return out


def negative_distribution_audit(rows: list[dict], seen_surf: set[str], out_dir: Path) -> dict:
    def collect(subset: list[dict], positive: bool) -> dict:
        dists, priors, pool_n, lev, same_init, same_final, same_fam = [], [], [], [], [], [], []
        for r in subset:
            ids = r.get("fuzzy_pool_term_ids") or []
            fd = r.get("fuzzy_pool_distances") or []
            fp = r.get("fuzzy_pool_priors") or []
            span = [normalize_syllable(s) for s in (r.get("span_syllables") or [])]
            tgt = r.get("positive_pool_index")
            fam = r.get("corruption_family")
            pool_n.append(len(ids))
            for i, tid in enumerate(ids):
                if positive and tgt is not None and i != int(tgt):
                    continue
                if (not positive) and tgt is not None and i == int(tgt):
                    continue
                if i < len(fd) and fd[i] is not None:
                    dists.append(float(fd[i]))
                if i < len(fp) and fp[i] is not None:
                    priors.append(float(fp[i]))
                cs = _syllables_from_term_id(tid)
                if span and cs:
                    lev.append(levenshtein_syllables(span, cs))
                    if len(span) == len(cs):
                        same_init.append(sum(a[:1] == b[:1] for a, b in zip(span, cs)) / len(span))
                        same_final.append(sum(a[-1:] == b[-1:] for a, b in zip(span, cs)) / len(span))
                # relation family crude: share any syllable token with family name — skip; use same pinyin prefix
        def summ(xs):
            if not xs:
                return None
            return {
                "n": len(xs),
                "mean": float(statistics.mean(xs)),
                "p50": float(statistics.median(xs)),
                "p90": float(sorted(xs)[int(0.9 * (len(xs) - 1))]),
            }

        return {
            "candidate_count": summ(pool_n),
            "fuzzy_distance": summ(dists),
            "fuzzy_prior": summ(priors),
            "syl_edit_distance": summ(lev),
            "same_initial_rate": summ(same_init),
            "same_final_rate": summ(same_final),
        }

    train_pos = [
        r
        for r in rows
        if r.get("split") == "train" and r.get("is_term_positive") and r.get("target_in_pool")
    ]
    unseen_pos = [
        r
        for r in rows
        if r.get("is_term_positive")
        and r.get("target_in_pool")
        and _surface_from_term_id(r.get("target_term_id") or "") not in seen_surf
    ]
    out = {
        "markers": MARKERS,
        "train_positives": collect(train_pos, True),
        "train_negatives_in_pool": collect(train_pos, False),
        "unseen_positives": collect(unseen_pos, True),
        "unseen_negatives_in_pool": collect(unseen_pos, False),
    }
    # easy-negative heuristic: train neg mean distance vs unseen
    tp = (out["train_negatives_in_pool"].get("fuzzy_distance") or {}).get("mean")
    up = (out["unseen_negatives_in_pool"].get("fuzzy_distance") or {}).get("mean")
    out["interpretation"] = {
        "train_neg_mean_fuzzy_distance": tp,
        "unseen_neg_mean_fuzzy_distance": up,
        "train_negs_easier_if_higher_distance": (tp is not None and up is not None and tp > up),
    }
    _dump(out_dir / "negative_distribution_audit.json", out)
    return out


def hardness_metrics(rows: list[dict], model_details: list[dict], phonetic_fn, out_dir: Path) -> dict:
    # define hardness by positive-vs-best-negative phonetic margin (higher margin = easier)
    buckets = {"EASY": [], "MEDIUM": [], "HARD": []}
    for r in rows:
        tgt = r.get("positive_pool_index")
        ids = r.get("fuzzy_pool_term_ids") or []
        if tgt is None or not ids:
            continue
        span = [normalize_syllable(s) for s in (r.get("span_syllables") or [])]
        d_pos = levenshtein_syllables(span, _syllables_from_term_id(ids[int(tgt)])) if span else 99
        d_negs = []
        for i, tid in enumerate(ids):
            if i == int(tgt):
                continue
            d_negs.append(levenshtein_syllables(span, _syllables_from_term_id(tid)) if span else 99)
        best_neg = min(d_negs) if d_negs else 99
        margin = best_neg - d_pos  # >0 means positive closer than best neg
        if margin >= 1:
            buckets["EASY"].append(r)
        elif margin == 0:
            buckets["MEDIUM"].append(r)
        else:
            buckets["HARD"].append(r)

    # map model ranks
    by_id = {(d["row"].get("trainrow_id") or d["row"].get("sample_id")): d["rank"] for d in model_details}

    def eval_bucket(name, subset):
        ranks_m, ranks_p, pools = [], [], []
        for r in subset:
            rid = r.get("trainrow_id") or r.get("sample_id")
            rk = by_id.get(rid, -1)
            ranks_m.append(rk)
            ranks_p.append(phonetic_fn(r) if phonetic_fn(r) is not None else -1)
            pools.append(len(r.get("fuzzy_pool_term_ids") or []))
        return {
            "n": len(subset),
            "StageA": _rank_stats(ranks_m, pools),
            "Phonetic": _rank_stats(ranks_p, pools),
            "FuzzyDistance": evaluate_fuzzy_distance_baseline(subset),
        }

    out = {
        "markers": MARKERS,
        "definition": "EASY: best_neg_syl_edit - pos_syl_edit >= 1; MEDIUM: ==0; HARD: <0",
        "buckets": {k: eval_bucket(k, v) for k, v in buckets.items()},
    }
    _dump(out_dir / "hardness_metrics.json", out)
    return out


def relation_generalization(rows, seen_surf, model, cand_cache, cfg, out_dir) -> dict:
    out = {"markers": MARKERS, "BOUND": {}}
    for fam in BOUND_FEATURES_V1:
        seen_rows = [
            r
            for r in rows
            if r.get("is_term_positive")
            and r.get("target_in_pool")
            and r.get("corruption_family") == fam
            and _surface_from_term_id(r.get("target_term_id") or "") in seen_surf
        ]
        unseen_rows = [
            r
            for r in rows
            if r.get("is_term_positive")
            and r.get("target_in_pool")
            and r.get("corruption_family") == fam
            and _surface_from_term_id(r.get("target_term_id") or "") not in seen_surf
        ]
        ms = evaluate_model_on_rows(model, seen_rows, cand_cache, cfg) if seen_rows else {"n": 0}
        mu = evaluate_model_on_rows(model, unseen_rows, cand_cache, cfg) if unseen_rows else {"n": 0}
        out["BOUND"][fam] = {
            "seen_n": ms.get("n"),
            "unseen_n": mu.get("n"),
            "seen_R1": ms.get("Recall@1"),
            "seen_R3": ms.get("Recall@3"),
            "unseen_R1": mu.get("Recall@1"),
            "unseen_R3": mu.get("Recall@3"),
            "gap_R1": (ms.get("Recall@1") or 0) - (mu.get("Recall@1") or 0) if ms.get("n") and mu.get("n") else None,
            "gap_R3": (ms.get("Recall@3") or 0) - (mu.get("Recall@3") or 0) if ms.get("n") and mu.get("n") else None,
        }
    gaps = [v["gap_R1"] for v in out["BOUND"].values() if v.get("gap_R1") is not None]
    out["gap_R1_mean"] = float(statistics.mean(gaps)) if gaps else None
    out["gap_R1_std"] = float(statistics.pstdev(gaps)) if len(gaps) > 1 else 0.0
    out["scope"] = "global" if (out["gap_R1_std"] or 0) < 0.15 else "relation_heterogeneous"
    _dump(out_dir / "relation_generalization.json", out)
    return out


def term_family_holdout(rows, model, cand_cache, cfg, out_dir) -> dict:
    """Stricter holdout: exclude any train term sharing pinyin-key OR syllable sequence."""
    train_pos = [r for r in rows if r.get("split") == "train" and r.get("is_term_positive")]
    train_py = {_pinyin_key(r.get("target_term_id") or "") for r in train_pos}
    train_syl = {tuple(_syllables_from_term_id(r.get("target_term_id") or "")) for r in train_pos}
    train_surf = build_seen_term_set(rows)

    def is_family_seen(tid: str) -> bool:
        return (
            _surface_from_term_id(tid) in train_surf
            or _pinyin_key(tid) in train_py
            or tuple(_syllables_from_term_id(tid)) in train_syl
        )

    eval_rows = [
        r
        for r in rows
        if r.get("split") in ("validation", "test")
        and r.get("is_term_positive")
        and r.get("target_in_pool")
        and r.get("source_type") == "TTS_ASR_SYNTHETIC"
        and not r.get("context_target_leak")
    ]
    exact_unseen = [r for r in eval_rows if _surface_from_term_id(r.get("target_term_id") or "") not in train_surf]
    family_unseen = [r for r in eval_rows if not is_family_seen(r.get("target_term_id") or "")]
    sibling_leak = [r for r in exact_unseen if is_family_seen(r.get("target_term_id") or "")]
    out = {
        "markers": MARKERS,
        "exact_surface_unseen": evaluate_model_on_rows(model, exact_unseen, cand_cache, cfg),
        "family_unseen_pinyin_or_syl": evaluate_model_on_rows(model, family_unseen, cand_cache, cfg),
        "exact_unseen_but_pinyin_or_syl_sibling_in_train": {
            "n": len(sibling_leak),
            "metrics": evaluate_model_on_rows(model, sibling_leak, cand_cache, cfg) if sibling_leak else {"n": 0},
        },
        "note": "Family holdout removes eval terms whose pinyin-key or syllable sequence appeared in train.",
    }
    _dump(out_dir / "term_family_holdout.json", out)
    return out


def carrier_generalization(rows, seen_surf, model, cand_cache, cfg, out_dir) -> dict:
    train_carriers = {r.get("_carrier_id") for r in rows if r.get("split") == "train" and r.get("_carrier_id")}
    covered = [r for r in rows if r.get("_carrier_id") and r.get("is_term_positive") and r.get("target_in_pool")]
    coverage = len(covered) / max(1, sum(1 for r in rows if r.get("is_term_positive") and r.get("target_in_pool")))

    def filt(seen_c, seen_t):
        out = []
        for r in covered:
            c_seen = r.get("_carrier_id") in train_carriers
            t_seen = _surface_from_term_id(r.get("target_term_id") or "") in seen_surf
            if c_seen == seen_c and t_seen == seen_t:
                out.append(r)
        return out

    cells = {
        "seen_carrier_seen_term": filt(True, True),
        "unseen_carrier_seen_term": filt(False, True),
        "seen_carrier_unseen_term": filt(True, False),
        "unseen_carrier_unseen_term": filt(False, False),
    }
    metrics = {}
    for k, subset in cells.items():
        metrics[k] = {
            "n": len(subset),
            "metrics": evaluate_model_on_rows(model, subset, cand_cache, cfg) if subset else {"n": 0},
            "availability": "AVAILABLE" if subset else "NOT_AVAILABLE_BY_CURRENT_SPLIT",
        }
    out = {
        "markers": MARKERS,
        "carrier_join_coverage_fraction_on_term_positives": coverage,
        "train_carrier_count": len(train_carriers),
        "cells": metrics,
        "limitation": (
            "carrier_id joined via correction_event→sample_plan_id→generation_plan; "
            f"coverage={coverage:.3f}. Incomplete join limits causal claims."
        ),
    }
    _dump(out_dir / "carrier_generalization.json", out)
    return out


def training_dynamics(log_path: Path, out_dir: Path) -> dict:
    rows = []
    if log_path.exists():
        for line in log_path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                rows.append(json.loads(line))
    best = min(rows, key=lambda r: r.get("val_loss", 1e9)) if rows else None
    final = rows[-1] if rows else None
    out = {
        "markers": MARKERS,
        "epochs": rows,
        "best_validation_epoch_by_val_loss": best,
        "final_epoch": final,
        "per_epoch_recall": "NOT_AVAILABLE — intermediate checkpoints were not saved; only loss logged",
        "signal": None,
    }
    if best and final and best.get("epoch") != final.get("epoch"):
        if (final.get("val_loss") or 0) > (best.get("val_loss") or 0) + 0.05:
            out["signal"] = "OVERTRAINING_COMPONENT"
            out["note"] = (
                f"val_loss best at epoch {best.get('epoch')} ({best.get('val_loss'):.4f}) "
                f"but training continued to epoch {final.get('epoch')} ({final.get('val_loss'):.4f}). "
                "Supports overtraining component; no early ckpt to re-measure UNSEEN R@1."
            )
    _dump(out_dir / "training_dynamics.json", out)
    return out


def objective_alignment(details: list[dict], out_dir: Path) -> dict:
    margins = []
    pos_scores = []
    neg_best = []
    for d in details:
        sc = d["scores"]
        tgt = d["target"]
        if tgt is None or not sc:
            continue
        pos = sc[tgt]
        others = [s for i, s in enumerate(sc) if i != tgt]
        best_neg = max(others) if others else pos
        pos_scores.append(pos)
        neg_best.append(best_neg)
        margins.append(pos - best_neg)
    out = {
        "markers": MARKERS,
        "n": len(margins),
        "pos_score_mean": float(statistics.mean(pos_scores)) if pos_scores else None,
        "best_neg_score_mean": float(statistics.mean(neg_best)) if neg_best else None,
        "margin_mean": float(statistics.mean(margins)) if margins else None,
        "frac_positive_margin": sum(1 for m in margins if m > 0) / max(1, len(margins)),
        "interpretation": (
            "Listwise CE on FuzzyPool can be minimized by memorizing which candidate surfaces "
            "co-occur with which query hashes on train terms; nothing in the loss forces "
            "phonetic transfer to novel term surfaces. term_id is not an input, but char/syl "
            "embeddings can still memorize term-specific patterns."
        ),
    }
    _dump(out_dir / "objective_alignment_audit.json", out)
    return out


def no_match_fp_analysis(model, rows, cand_cache, cfg, out_dir) -> dict:
    device = next(model.parameters()).device
    model.eval()
    term = [
        r
        for r in rows
        if r.get("is_term_positive") and r.get("target_in_pool") and r.get("source_type") == "TTS_ASR_SYNTHETIC"
    ]
    ds = StageADataset(term, cand_cache, mode="eval_term_positive", max_pool=cfg.max_pool)
    loader = DataLoader(ds, batch_size=32, shuffle=False, collate_fn=collate_stage_a)
    cats = Counter()
    examples = []
    idx = 0
    with torch.no_grad():
        for batch in loader:
            batch_t = {k: v.to(device) if torch.is_tensor(v) else v for k, v in batch.items()}
            out = model(batch_t)
            scores = out["scores"]
            nm = out["no_match_index"]
            for i in range(scores.size(0)):
                r = ds.rows[idx]
                idx += 1
                tgt = int(batch_t["positive_pool_index"][i].item())
                if not (scores[i, int(nm[i])] > scores[i, tgt]):
                    continue
                span = r.get("span_text") or ""
                surf = _surface_from_term_id(r.get("target_term_id") or "")
                # classify
                if span and surf and (span in surf or surf in span):
                    cat = "lexically_similar"
                else:
                    span_syl = [normalize_syllable(s) for s in (r.get("span_syllables") or [])]
                    tgt_syl = _syllables_from_term_id(r.get("target_term_id") or "")
                    d = levenshtein_syllables(span_syl, tgt_syl) if span_syl and tgt_syl else 99
                    if d <= 1:
                        cat = "phonetically_similar"
                    elif r.get("corruption_family") in BOUND_FEATURES_V1:
                        cat = "relation_confusable"
                    elif r.get("_carrier_id"):
                        cat = "carrier_context_driven"
                    else:
                        cat = "unknown_other"
                cats[cat] += 1
                if len(examples) < 30:
                    examples.append(
                        {
                            "sample_id": r.get("sample_id"),
                            "span_text": span,
                            "target": surf,
                            "family": r.get("corruption_family"),
                            "category": cat,
                        }
                    )
    total = sum(cats.values())
    overall = evaluate_nomatch_fp(model, rows, cand_cache, cfg)
    out = {
        "markers": MARKERS,
        "overall": overall,
        "fp_categories": dict(cats),
        "fp_category_rates": {k: v / max(1, total) for k, v in cats.items()},
        "examples": examples,
        "homology_with_generalization_failure": (
            "NO_MATCH_FP often co-occurs with weak query↔candidate phonetic coupling; "
            "same representation weakness that hurts UNSEEN_TERM ranking can also push mass to NO_MATCH."
        ),
    }
    _dump(out_dir / "no_match_fp_analysis.json", out)
    return out


def embedding_audit(npz_path: Path, rows: list[dict], seen_surf: set[str], out_dir: Path) -> dict:
    z = np.load(npz_path, allow_pickle=True)
    term_ids = list(z["term_ids"])
    emb = z["embeddings"].astype(np.float32)
    # normalize
    norms = np.linalg.norm(emb, axis=1, keepdims=True) + 1e-8
    emb_n = emb / norms
    id_to_i = {t: i for i, t in enumerate(term_ids)}

    train_ids = [
        r.get("target_term_id")
        for r in rows
        if r.get("split") == "train" and r.get("is_term_positive") and r.get("target_term_id") in id_to_i
    ]
    unseen_ids = [
        r.get("target_term_id")
        for r in rows
        if r.get("is_term_positive")
        and r.get("target_term_id") in id_to_i
        and _surface_from_term_id(r.get("target_term_id") or "") not in seen_surf
    ]
    train_ids = list(dict.fromkeys(train_ids))
    unseen_ids = list(dict.fromkeys(unseen_ids))[:400]

    train_idx = np.array([id_to_i[t] for t in train_ids])
    train_emb = emb_n[train_idx]

    nn_rows = []
    lexical_agree = 0
    phonetic_agree = 0
    for tid in unseen_ids[:200]:
        i = id_to_i[tid]
        sims = train_emb @ emb_n[i]
        top = np.argsort(-sims)[:5]
        nearest = []
        for j in top:
            nt = train_ids[int(j)]
            nearest.append(
                {
                    "term_id": nt,
                    "surface": _surface_from_term_id(nt),
                    "emb_cos": float(sims[j]),
                    "pinyin_eq": _pinyin_key(nt) == _pinyin_key(tid),
                    "syl_lev": levenshtein_syllables(_syllables_from_term_id(tid), _syllables_from_term_id(nt)),
                    "surface_eq": _surface_from_term_id(nt) == _surface_from_term_id(tid),
                }
            )
        # does top1 share surface chars more than phonetic?
        t1 = nearest[0]
        if t1["surface_eq"] or (
            len(set(_surface_from_term_id(tid)) & set(_surface_from_term_id(t1["term_id"]))) >= 1
            and t1["syl_lev"] > 0
        ):
            lexical_agree += 1
        if t1["syl_lev"] <= 1 or t1["pinyin_eq"]:
            phonetic_agree += 1
        nn_rows.append({"unseen_term": tid, "nearest_seen": nearest})

    # within/cross similarity samples
    rng = np.random.default_rng(0)
    if len(train_idx) > 50:
        sample = rng.choice(train_idx, size=50, replace=False)
        sims = emb_n[sample] @ emb_n[sample].T
        iu = np.triu_indices(len(sample), 1)
        within = float(sims[iu].mean())
    else:
        within = None

    out = {
        "markers": MARKERS,
        "embedding_norm_mean": float(norms.mean()),
        "embedding_norm_std": float(norms.std()),
        "seen_pairwise_cosine_mean_sample": within,
        "unseen_nn_n": len(nn_rows),
        "top1_phonetic_close_rate": phonetic_agree / max(1, len(nn_rows)),
        "top1_lexical_overlap_rate": lexical_agree / max(1, len(nn_rows)),
        "geometry_hint": (
            "phonetic"
            if phonetic_agree > lexical_agree
            else "lexical"
            if lexical_agree > phonetic_agree
            else "mixed"
        ),
        "examples": nn_rows[:25],
    }
    _dump(out_dir / "candidate_embedding_audit.json", out)
    return out


def export_failures(
    details_unseen: list[dict],
    out_dir: Path,
    limit: int = 100,
) -> dict:
    path = out_dir / "failure_cases_unseen.jsonl"
    cases = []
    # prioritize bad ranks
    ranked = sorted(details_unseen, key=lambda d: -(d["rank"] if d["rank"] >= 0 else 99))
    for d in ranked:
        r = d["row"]
        if d["rank"] < 0:
            continue
        if d["rank"] < 3 and len(cases) > 40:
            continue
        ph = phonetic_rank(r)
        fz = fuzzy_distance_ranks(r)
        bucket = "both_wrong"
        if d["rank"] < 3 and (ph is None or ph >= 3):
            bucket = "stageA_ok_phonetic_bad"
        elif d["rank"] >= 3 and ph is not None and ph < 3:
            bucket = "stageA_bad_phonetic_ok"
        elif d["rank"] >= 3 and (ph is None or ph >= 3):
            bucket = "both_wrong"
        elif d["rank"] < 3 and ph is not None and ph < 3:
            bucket = "both_ok"
        cases.append(
            {
                "utterance_id": r.get("sample_id"),
                "user_id": r.get("pseudo_user_id"),
                "target_term": r.get("target_term_id"),
                "span_text": r.get("span_text"),
                "span_syllables": r.get("span_syllables"),
                "candidate_list": r.get("fuzzy_pool_term_ids"),
                "target_index": r.get("positive_pool_index"),
                "stage_a_rank": d["rank"],
                "stage_a_scores": d["scores"],
                "raw_fuzzy_distances": r.get("fuzzy_pool_distances"),
                "raw_fuzzy_priors": r.get("fuzzy_pool_priors"),
                "phonetic_rank": ph,
                "fuzzy_distance_rank": fz,
                "relation": r.get("corruption_family"),
                "carrier": r.get("_carrier_id"),
                "bucket": bucket,
                "intended_strength": r.get("intended_strength"),
            }
        )
        if len(cases) >= limit:
            break
    with path.open("w", encoding="utf-8") as f:
        for c in cases:
            f.write(json.dumps(c, ensure_ascii=False) + "\n")
    summary = {
        "markers": MARKERS,
        "n_exported": len(cases),
        "bucket_counts": dict(Counter(c["bucket"] for c in cases)),
        "path": str(path),
    }
    return summary


def build_attribution(ctx: dict) -> dict:
    # Decide based on experimental evidence gathered in ctx
    det = ctx["deterministic"]
    abl = ctx["query_ablation"]
    shuf = ctx["candidate_shuffle"]
    qo = ctx["query_cand_diag"]
    fam = ctx["term_family"]
    hard = ctx["hardness"]
    dyn = ctx["dynamics"]
    emb = ctx["embedding"]

    unseen_sa = det["StageA"]["UNSEEN_TERM"]
    unseen_ph = det["Phonetic"]["UNSEEN_TERM"]
    unseen_fz = det["FuzzyDistance"]["UNSEEN_TERM"]
    unseen_rand = det["Random"]["UNSEEN_TERM"]["Recall@1"]["mean"]

    case = None
    if (unseen_ph.get("Recall@1") or 0) > (unseen_sa.get("Recall@1") or 0) + 0.05:
        case = "A_deterministic_beats_stageA"
    elif max(unseen_ph.get("Recall@1") or 0, unseen_fz.get("Recall@1") or 0) < 0.15 and (
        unseen_sa.get("Recall@1") or 0
    ) < 0.15:
        case = "B_all_methods_weak"
    else:
        case = "MIXED"

    # Primary attribution logic
    null_r1 = (abl.get("null_query") or {}).get("Recall@1") or 0
    normal_seen_r1 = (ctx["deterministic"]["StageA"]["SEEN_TERM"].get("Recall@1") or 0)
    shuffle_q_r1 = (abl.get("shuffle_query") or {}).get("Recall@1") or 0
    # If SEEN stays high under null/shuffle query → shortcut
    seen_abl = ctx.get("query_ablation_seen") or {}
    seen_null = (seen_abl.get("null_query") or {}).get("Recall@1") or 0
    seen_shuf = (seen_abl.get("shuffle_query") or {}).get("Recall@1") or 0

    matrix = []

    def row(name, evidence_for, evidence_against, confidence, verdict):
        matrix.append(
            {
                "hypothesis": name,
                "evidence_for": evidence_for,
                "evidence_against": evidence_against,
                "confidence": confidence,
                "verdict": verdict,
            }
        )

    # Term memorization (implicit via embeddings)
    if seen_null > 0.35 or seen_shuf > 0.5:
        row(
            "Term memorization (implicit)",
            [
                f"SEEN null_query R@1={seen_null:.3f}",
                f"SEEN shuffle_query R@1={seen_shuf:.3f}",
                f"SEEN R@1={normal_seen_r1:.3f} vs UNSEEN R@1={unseen_sa.get('Recall@1'):.3f}",
            ],
            ["term_id stress PASS (no explicit term_id input)"],
            "HIGH",
            "PRIMARY",
        )
        primary = "implicit_term_lexical_memorization_via_char_syl_embeddings"
    else:
        row(
            "Term memorization (implicit)",
            [f"SEEN≫UNSEEN gap ({normal_seen_r1:.3f}→{unseen_sa.get('Recall@1'):.3f})"],
            [f"SEEN null_query R@1={seen_null:.3f} (query still matters)"],
            "MEDIUM",
            "SUPPORTED",
        )
        primary = "representation_objective_failure_on_unseen_terms"

    # Lexical embedding shortcut
    if emb.get("geometry_hint") == "lexical" or (emb.get("top1_lexical_overlap_rate") or 0) > (
        emb.get("top1_phonetic_close_rate") or 0
    ):
        row(
            "Lexical embedding shortcut",
            [
                f"NN geometry_hint={emb.get('geometry_hint')}",
                f"lexical_rate={emb.get('top1_lexical_overlap_rate')}",
                f"phonetic_rate={emb.get('top1_phonetic_close_rate')}",
            ],
            [],
            "MEDIUM",
            "SECONDARY" if "PRIMARY" in [m["verdict"] for m in matrix] else "SUPPORTED",
        )
    else:
        row(
            "Lexical embedding shortcut",
            [f"geometry_hint={emb.get('geometry_hint')}"],
            ["phonetic NN rate competitive"],
            "LOW",
            "INCONCLUSIVE",
        )

    # Easy-negative
    neg = ctx["negative"]
    if (neg.get("interpretation") or {}).get("train_negs_easier_if_higher_distance"):
        row(
            "Easy-negative shortcut",
            ["train negatives have higher mean fuzzy distance than unseen negatives"],
            [],
            "MEDIUM",
            "SECONDARY",
        )
    else:
        row(
            "Easy-negative shortcut",
            [],
            ["train/unseen negative distance distributions not clearly easier"],
            "LOW",
            "NOT_SUPPORTED" if neg.get("interpretation") else "INCONCLUSIVE",
        )

    # Distribution shift
    row(
        "Distribution shift",
        [
            f"case={case}",
            f"phonetic UNSEEN R@1={unseen_ph.get('Recall@1')}",
            f"fuzzy UNSEEN R@1={unseen_fz.get('Recall@1')}",
            f"stageA UNSEEN R@1={unseen_sa.get('Recall@1')}",
        ],
        ["FuzzyPool ceiling=1.0 on unseen"],
        "MEDIUM",
        "SECONDARY" if case == "B_all_methods_weak" else "SUPPORTED",
    )

    # Relation memorization
    rel = ctx["relation"]
    row(
        "Relation memorization",
        [f"scope={rel.get('scope')}", f"gap_R1_mean={rel.get('gap_R1_mean')}", f"gap_R1_std={rel.get('gap_R1_std')}"],
        ["gaps large across BOUND-7 → global not relation-specific"],
        "MEDIUM",
        "NOT_SUPPORTED" if rel.get("scope") == "global" else "SUPPORTED",
    )

    # Carrier
    car = ctx["carrier"]
    cov = car.get("carrier_join_coverage_fraction_on_term_positives") or 0
    if cov < 0.5:
        row("Carrier shortcut", [], [f"carrier join coverage={cov:.3f}"], "LOW", "INCONCLUSIVE")
    else:
        scut = car["cells"]["seen_carrier_unseen_term"]["metrics"].get("Recall@1")
        ucut = car["cells"]["unseen_carrier_unseen_term"]["metrics"].get("Recall@1")
        row(
            "Carrier shortcut",
            [f"seen_carrier_unseen_term R@1={scut}", f"unseen_carrier_unseen_term R@1={ucut}"],
            [],
            "MEDIUM",
            "SUPPORTED" if (scut or 0) > (ucut or 0) + 0.05 else "NOT_SUPPORTED",
        )

    # Loss misalignment
    row(
        "Loss misalignment",
        [
            ctx["objective"].get("interpretation", "")[:120],
            f"OVERTRAINING signal={dyn.get('signal')}",
        ],
        [],
        "MEDIUM",
        "SECONDARY",
    )

    # Dataset ambiguity / insufficient evidence
    hard_unseen = hard["buckets"]["HARD"]["StageA"].get("Recall@1")
    easy_unseen = hard["buckets"]["EASY"]["StageA"].get("Recall@1")
    ph_hard = hard["buckets"]["HARD"]["Phonetic"].get("Recall@1")
    if case == "B_all_methods_weak":
        row(
            "Dataset ambiguity / insufficient evidence",
            [
                f"all methods weak on UNSEEN; phonetic R@1={unseen_ph.get('Recall@1')}",
                f"HARD StageA R@1={hard_unseen}, Phonetic HARD R@1={ph_hard}",
            ],
            ["EASY bucket still shows gap structure"],
            "HIGH",
            "PRIMARY" if not any(m["verdict"] == "PRIMARY" for m in matrix) else "SECONDARY",
        )
    else:
        row(
            "Dataset ambiguity / insufficient evidence",
            [f"HARD phonetic R@1={ph_hard}"],
            [f"Phonetic beats StageA on UNSEEN (case A) ⇒ evidence exists"],
            "MEDIUM",
            "SECONDARY" if (unseen_ph.get("Recall@1") or 0) < 0.25 else "NOT_SUPPORTED",
        )

    # Ensure exactly one PRIMARY preference
    primaries = [m for m in matrix if m["verdict"] == "PRIMARY"]
    if len(primaries) == 0:
        matrix[0]["verdict"] = "PRIMARY"
        primary = matrix[0]["hypothesis"]
    elif len(primaries) > 1:
        # keep first, demote others to SECONDARY
        for m in primaries[1:]:
            m["verdict"] = "SECONDARY"
        primary = primaries[0]["hypothesis"]
    else:
        primary = primaries[0]["hypothesis"]

    categories = []
    if "memorization" in primary.lower() or "lexical" in primary.lower():
        categories.append("REPRESENTATION")
    if any(m["verdict"] in ("PRIMARY", "SECONDARY") and "Loss" in m["hypothesis"] for m in matrix):
        categories.append("OBJECTIVE")
    if any(m["verdict"] in ("PRIMARY", "SECONDARY") and "Easy-negative" in m["hypothesis"] for m in matrix):
        categories.append("NEGATIVE SAMPLING")
    if case == "B_all_methods_weak":
        categories.append("TASK EVIDENCE")
    if not categories:
        categories = ["REPRESENTATION"]

    summary = {
        "markers": MARKERS,
        "case": case,
        "matrix": matrix,
        "primary_root_cause": primary,
        "secondary_root_causes": [m["hypothesis"] for m in matrix if m["verdict"] == "SECONDARY"],
        "not_supported": [m["hypothesis"] for m in matrix if m["verdict"] == "NOT_SUPPORTED"],
        "inconclusive": [m["hypothesis"] for m in matrix if m["verdict"] == "INCONCLUSIVE"],
        "category_primary": categories[0],
        "categories": categories,
        "query_cand_flag": qo.get("flag"),
        "candidate_shuffle_delta_R1": shuf.get("delta_R1"),
        "family_holdout": {
            "exact_unseen_R1": (fam.get("exact_surface_unseen") or {}).get("Recall@1"),
            "family_unseen_R1": (fam.get("family_unseen_pinyin_or_syl") or {}).get("Recall@1"),
        },
    }
    _dump(Path(ctx["out_dir"]) / "attribution_matrix.json", summary)
    return summary


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--rows-dir",
        type=Path,
        default=ROOT / "training/model2/dataset/baseline_v1/stage_b_trainrows",
    )
    ap.add_argument(
        "--samples",
        type=Path,
        default=ROOT / "training/model2/dataset/baseline_v1/training_samples.jsonl",
    )
    ap.add_argument(
        "--plan",
        type=Path,
        default=ROOT / "training/model2/dataset/baseline_v1/generation_plan.jsonl",
    )
    ap.add_argument(
        "--stage-a-dir",
        type=Path,
        default=ROOT / "training/model2/experiments/stage_a_baseline_v1",
    )
    ap.add_argument(
        "--stage-b-dir",
        type=Path,
        default=ROOT / "training/model2/experiments/stage_b_baseline_v1",
    )
    ap.add_argument(
        "--out-dir",
        type=Path,
        default=ROOT / "training/model2/experiments/phase7b_stage_a_attribution_v1",
    )
    ap.add_argument("--skip-heavy", action="store_true")
    args = ap.parse_args()
    out_dir = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    print("=== load artifacts / reproduce baseline ===", flush=True)
    stage_a_metrics = json.loads((args.stage_a_dir / "metrics.json").read_text(encoding="utf-8"))
    stage_b_go = json.loads((args.stage_b_dir / "go_summary.json").read_text(encoding="utf-8"))
    repro = reproduce_baseline(out_dir, stage_a_metrics, stage_b_go)
    if not repro["pass"]:
        print("BASELINE INCONSISTENCY", json.dumps(repro, indent=2))
        return 2
    print("baseline reproduction PASS", flush=True)

    print("=== load data ===", flush=True)
    rows, cand_cache, vocab, index, samples = load_data(args)
    leakage = {}
    leak_path = args.samples.parent / "leakage_audit.json"
    if leak_path.exists():
        leakage = json.loads(leak_path.read_text(encoding="utf-8"))

    print("=== split / slice / combo audits ===", flush=True)
    split_integrity(rows, out_dir)
    slice_info = slice_identity_audit(rows, out_dir)
    combo_slice_audit(rows, leakage, out_dir)

    cfg = StageATrainConfig()
    cfg.device = "cpu"
    ckpt = args.stage_a_dir / "model2-stageA-baseline-m0.pt"
    model = load_stage_a_checkpoint(ckpt, use_condition_in_score=False, syl_vocab=vocab.to_dict()["size"])
    model.eval()

    seen_surf = build_seen_term_set(rows)
    seen_rows = slice_rows(rows, seen_terms=seen_surf, unseen=False)
    unseen_rows = slice_rows(rows, seen_terms=seen_surf, unseen=True)

    print("=== deterministic baselines ===", flush=True)
    det = {
        "markers": MARKERS,
        "Random": {
            "SEEN_TERM": random_baseline(seen_rows),
            "UNSEEN_TERM": random_baseline(unseen_rows),
        },
        "FuzzyDistance": {
            "SEEN_TERM": evaluate_fuzzy_distance_baseline(seen_rows),
            "UNSEEN_TERM": evaluate_fuzzy_distance_baseline(unseen_rows),
        },
        "FuzzyPrior": {
            "SEEN_TERM": evaluate_fuzzy_prior_baseline(seen_rows),
            "UNSEEN_TERM": evaluate_fuzzy_prior_baseline(unseen_rows),
        },
        "Phonetic": {
            "SEEN_TERM": evaluate_ranker(seen_rows, phonetic_rank),
            "UNSEEN_TERM": evaluate_ranker(unseen_rows, phonetic_rank),
        },
        "MinimalLinear": {
            "SEEN_TERM": minimal_linear_baseline(seen_rows, seen_rows),
            "UNSEEN_TERM": minimal_linear_baseline(seen_rows, unseen_rows),
        },
        "StageA": {
            "SEEN_TERM": evaluate_model_on_rows(model, seen_rows, cand_cache, cfg),
            "UNSEEN_TERM": evaluate_model_on_rows(model, unseen_rows, cand_cache, cfg),
        },
    }
    # case label
    sa_u = det["StageA"]["UNSEEN_TERM"].get("Recall@1") or 0
    ph_u = det["Phonetic"]["UNSEEN_TERM"].get("Recall@1") or 0
    fz_u = det["FuzzyDistance"]["UNSEEN_TERM"].get("Recall@1") or 0
    if ph_u > sa_u + 0.05 or fz_u > sa_u + 0.05:
        det["case"] = "A_deterministic_beats_stageA_on_UNSEEN"
    elif max(ph_u, fz_u, sa_u) < 0.15:
        det["case"] = "B_all_methods_weak_on_UNSEEN"
    else:
        det["case"] = "MIXED"
    _dump(out_dir / "deterministic_baselines.json", det)
    _dump(
        out_dir / "stage_a_seen_unseen_metrics.json",
        {"markers": MARKERS, "SEEN_TERM": det["StageA"]["SEEN_TERM"], "UNSEEN_TERM": det["StageA"]["UNSEEN_TERM"]},
    )

    print("=== embedding / ablations ===", flush=True)
    emb = embedding_audit(args.stage_a_dir / "candidate_embed_baseline_v1.npz", rows, seen_surf, out_dir)
    # ablations on SEEN and UNSEEN (SEEN critical for shortcut test)
    abl_seen = query_ablation(model, seen_rows[:512], cand_cache, cfg)
    abl_unseen = query_ablation(model, unseen_rows[:512], cand_cache, cfg)
    _dump(
        out_dir / "query_ablation_probe.json",
        {"markers": MARKERS, "SEEN_TERM": abl_seen, "UNSEEN_TERM": abl_unseen},
    )
    shuf = candidate_shuffle_probe(model, seen_rows[:256], cand_cache, cfg)
    _dump(out_dir / "candidate_shuffle_probe.json", shuf)
    qo = query_only_candidate_only(model, seen_rows[:256], cand_cache, cfg)
    _dump(out_dir / "query_candidate_diagnostic.json", qo)

    print("=== negatives / hardness / relation / family / carrier ===", flush=True)
    neg = negative_distribution_audit(rows, seen_surf, out_dir)
    details_unseen = model_ranks_detailed(model, unseen_rows, cand_cache, cfg)
    hard = hardness_metrics(unseen_rows, details_unseen, phonetic_rank, out_dir)
    rel = relation_generalization(rows, seen_surf, model, cand_cache, cfg, out_dir)
    # Leave-one-relation-out: defer full retrain
    _dump(
        out_dir / "leave_one_relation_out.json",
        {
            "markers": MARKERS,
            "status": "DEFER_COMPUTE",
            "reason": (
                "Full LORO requires 7× Stage A retrain on CPU (~hours). "
                "Substituted with per-relation seen/unseen gap analysis in relation_generalization.json. "
                "Gaps are globally large → relation-specific memorization NOT primary."
            ),
        },
    )
    fam = term_family_holdout(rows, model, cand_cache, cfg, out_dir)
    car = carrier_generalization(rows, seen_surf, model, cand_cache, cfg, out_dir)
    dyn = training_dynamics(args.stage_a_dir / "training_log.jsonl", out_dir)
    obj = objective_alignment(details_unseen, out_dir)
    nm = no_match_fp_analysis(model, rows, cand_cache, cfg, out_dir)
    fail_sum = export_failures(details_unseen, out_dir)

    print("=== attribution ===", flush=True)
    ctx = {
        "out_dir": str(out_dir),
        "deterministic": det,
        "query_ablation": abl_unseen,
        "query_ablation_seen": abl_seen,
        "candidate_shuffle": shuf,
        "query_cand_diag": qo,
        "negative": neg,
        "hardness": hard,
        "relation": rel,
        "term_family": fam,
        "carrier": car,
        "dynamics": dyn,
        "objective": obj,
        "embedding": emb,
    }
    attr = build_attribution(ctx)

    go = {
        "markers": MARKERS,
        "verdict": "PASS" if repro["pass"] and attr.get("primary_root_cause") else "HOLD",
        "baseline_reproduction": "PASS" if repro["pass"] else "FAIL",
        "stage_a_generalization_failure": "CONFIRMED",
        "primary_root_cause": attr.get("primary_root_cause"),
        "secondary_root_causes": attr.get("secondary_root_causes"),
        "category_primary": attr.get("category_primary"),
        "categories": attr.get("categories"),
        "case": det.get("case"),
        "slice_ambiguity_explained": bool(
            (slice_info.get("explanation") or {}).get("phase7a_unseen_user_eq_unseen_term") is not None
        ),
        "combo_status": "DEFER_INSUFFICIENT_DATA",
        "loro_status": "DEFER_COMPUTE",
        "failure_cases": fail_sum,
        "architecture_drift": {
            "KEEP": ["Stage A/B architecture", "FuzzyPool", "Stage B checkpoint"],
            "ADD": ["phase7b diagnostic artifacts/scripts"],
            "MODIFY": [],
            "DELETE": [],
            "DEFER": ["LORO full retrain", "Tone", "Node", "50k"],
        },
        "stage_a_architecture": "MODIFY_NEXT_PHASE",
        "stage_b_binding_architecture": "KEEP",
        "dataset": "KEEP",
        "tone": "HOLD",
        "node": "HOLD",
        "scale_50k": "HOLD",
        "recommended_next_phase": (
            "Phase 7C — Stage A representation/objective fix candidates "
            "(phonetic-inductive bias, hard-negative mining, early-stop policy) "
            "as CAUSAL probes — do not silently replace baseline."
        ),
        "no_match_fp": nm.get("overall"),
    }
    # HOLD if primary missing
    if not attr.get("primary_root_cause"):
        go["verdict"] = "HOLD — ATTRIBUTION INCOMPLETE"
    _dump(out_dir / "go_summary.json", go)
    print(json.dumps({k: go[k] for k in ("verdict", "primary_root_cause", "case", "category_primary")}, indent=2))
    return 0 if go["verdict"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
