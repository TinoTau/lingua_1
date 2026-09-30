"""Phase 7C evaluation helpers — PHASE7C_CAUSAL_PROBE_ONLY / NOT_FOR_RUNTIME."""

from __future__ import annotations

import json
import random
from copy import deepcopy
from pathlib import Path
from typing import Any, Optional

import torch
from torch.utils.data import DataLoader

from training.model2.evaluation.baselines import fuzzy_distance_ranks
from training.model2.evaluation.evaluate import evaluate_model_on_rows, evaluate_nomatch_fp
from training.model2.evaluation.metrics import summarize_ranking
from training.model2.evaluation.slices import build_seen_term_set, slice_rows, term_surface_from_id
from training.model2.phonetic.syllables import levenshtein_syllables, normalize_syllable, syllables_from_text_fallback
from training.model2.stage_b.active_feature_mask import BOUND_FEATURES_V1
from training.model2.training.config import StageATrainConfig
from training.model2.training.dataset import StageADataset, collate_stage_a

MARKERS = [
    "PHASE7C_CAUSAL_PROBE_ONLY",
    "NOT_FOR_RUNTIME",
    "NOT_FROZEN",
    "DO_NOT_REPLACE_BASELINE",
]


def dump(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def syllables_from_term_id(term_id: str) -> list[str]:
    parts = (term_id or "").split(":")
    if len(parts) >= 4:
        return [normalize_syllable(x) for x in parts[3].replace("|", " ").split() if normalize_syllable(x)]
    return []


def rank_stats(ranks: list[int], pools: list[int]) -> dict[str, Any]:
    m = summarize_ranking(ranks, pools)
    valid = [r for r in ranks if r >= 0]
    m["mean_target_rank"] = float(sum(valid) / len(valid)) if valid else None
    return m


@torch.no_grad()
def evaluate_with_pool_order(
    model,
    rows: list[dict],
    cand_cache: dict,
    cfg: StageATrainConfig,
    *,
    randomize_order: bool = False,
    seed: int = 0,
) -> dict[str, Any]:
    device = next(model.parameters()).device
    model.eval()
    work = rows
    if randomize_order:
        work = []
        rng = random.Random(seed)
        for r in rows:
            rr = deepcopy(r)
            ids = list(rr.get("fuzzy_pool_term_ids") or [])
            tgt = rr.get("positive_pool_index")
            if not ids or tgt is None:
                work.append(rr)
                continue
            order = list(range(len(ids)))
            rng.shuffle(order)
            rr["fuzzy_pool_term_ids"] = [ids[i] for i in order]
            # remap distances/priors if present
            for key in ("fuzzy_pool_distances", "fuzzy_pool_priors"):
                arr = list(rr.get(key) or [])
                if len(arr) == len(ids):
                    rr[key] = [arr[i] for i in order]
            rr["positive_pool_index"] = order.index(int(tgt))
            work.append(rr)
    return evaluate_model_on_rows(model, work, cand_cache, cfg)


@torch.no_grad()
def shortcut_bundle(
    model,
    rows: list[dict],
    cand_cache: dict,
    cfg: StageATrainConfig,
    *,
    max_n: int = 512,
) -> dict[str, Any]:
    device = next(model.parameters()).device
    model.eval()
    subset = rows[:max_n]
    ds = StageADataset(subset, cand_cache, mode="eval_term_positive", max_pool=cfg.max_pool)
    if len(ds) == 0:
        return {"n": 0}

    def run(mode: str) -> dict:
        ranks, pools = [], []
        loader = DataLoader(ds, batch_size=32, shuffle=False, collate_fn=collate_stage_a)
        rng = random.Random(11)
        for batch in loader:
            b = {k: v.to(device) if torch.is_tensor(v) else v for k, v in batch.items()}
            if mode == "shuffle_query":
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
            elif mode == "candidate_only":
                q = model.encode_query(b)
                c = model.encode_candidates(b)
                q = q.mean(dim=0, keepdim=True).expand_as(q)
                scores = model.score_base(q, c)
                for i in range(scores.size(0)):
                    p = int(b["pool_len"][i].item())
                    order = scores[i, :p].argsort(descending=True).tolist()
                    tgt = int(b["positive_pool_index"][i].item())
                    ranks.append(order.index(tgt) if tgt in order else -1)
                    pools.append(p)
                continue
            out = model(b)
            scores = out["scores"]
            for i in range(scores.size(0)):
                p = int(b["pool_len"][i].item())
                order = scores[i, :p].argsort(descending=True).tolist()
                tgt = int(b["positive_pool_index"][i].item())
                ranks.append(order.index(tgt) if tgt in order else -1)
                pools.append(p)
        return rank_stats(ranks, pools)

    return {
        "n": len(ds),
        "normal": run("normal"),
        "null_query": run("null_query"),
        "shuffle_query": run("shuffle_query"),
        "candidate_only": run("candidate_only"),
    }


def phonetic_agreement(model, rows, cand_cache, cfg, max_n: int = 800) -> dict[str, Any]:
    device = next(model.parameters()).device
    model.eval()
    subset = rows[:max_n]
    ds = StageADataset(subset, cand_cache, mode="eval_term_positive", max_pool=cfg.max_pool)
    agree = 0
    reverse = 0
    n_pairs = 0
    corr_n = 0
    corr_hit = 0
    loader = DataLoader(ds, batch_size=32, shuffle=False, collate_fn=collate_stage_a)
    idx = 0
    with torch.no_grad():
        for batch in loader:
            b = {k: v.to(device) if torch.is_tensor(v) else v for k, v in batch.items()}
            scores = model(b)["scores"]
            for i in range(scores.size(0)):
                r = ds.rows[idx]
                idx += 1
                p = int(b["pool_len"][i].item())
                sc = scores[i, :p].detach().cpu().tolist()
                dists = list(r.get("fuzzy_pool_distances") or [])[:p]
                if len(dists) < p:
                    continue
                # pairwise order preservation among finite distances
                for a in range(p):
                    for j in range(a + 1, p):
                        da, db = dists[a], dists[j]
                        if da is None or db is None or da == db:
                            continue
                        n_pairs += 1
                        # fuzzy wants smaller distance higher rank (lower index ideally)
                        fuzzy_pref_a = da < db
                        model_pref_a = sc[a] > sc[j]
                        if fuzzy_pref_a == model_pref_a:
                            agree += 1
                        else:
                            reverse += 1
                # top1 agreement with fuzzy distance rank
                fz = fuzzy_distance_ranks(r)
                order = sorted(range(p), key=lambda j: -sc[j])
                if fz is not None:
                    corr_n += 1
                    if order[0] == (r.get("fuzzy_pool_term_ids") or []).index(
                        (r.get("fuzzy_pool_term_ids") or [])[int(r["positive_pool_index"])]
                    ) and fz == 0:
                        # weak: both pick target
                        pass
                    if order.index(int(r["positive_pool_index"])) == fz:
                        corr_hit += 1
    return {
        "n_rows": len(ds),
        "pairwise_agreement_rate": agree / max(1, n_pairs),
        "fuzzy_order_reversal_rate": reverse / max(1, n_pairs),
        "n_pairs": n_pairs,
        "rank_agreement_with_fuzzy_distance": corr_hit / max(1, corr_n),
        "n_rank_compare": corr_n,
    }


def per_relation_metrics(model, rows, seen_surf, cand_cache, cfg) -> dict[str, Any]:
    out = {}
    for fam in BOUND_FEATURES_V1:
        seen = [
            r
            for r in rows
            if r.get("is_term_positive")
            and r.get("target_in_pool")
            and r.get("corruption_family") == fam
            and term_surface_from_id(r.get("target_term_id")) in seen_surf
        ]
        unseen = [
            r
            for r in rows
            if r.get("is_term_positive")
            and r.get("target_in_pool")
            and r.get("corruption_family") == fam
            and term_surface_from_id(r.get("target_term_id")) not in seen_surf
        ]
        ms = evaluate_model_on_rows(model, seen, cand_cache, cfg) if seen else {"n": 0}
        mu = evaluate_model_on_rows(model, unseen, cand_cache, cfg) if unseen else {"n": 0}
        out[fam] = {
            "seen_n": ms.get("n"),
            "unseen_n": mu.get("n"),
            "seen_R1": ms.get("Recall@1"),
            "unseen_R1": mu.get("Recall@1"),
            "seen_R3": ms.get("Recall@3"),
            "unseen_R3": mu.get("Recall@3"),
        }
    return out


def full_eval_pack(model, rows, cand_cache, cfg, *, label: str = "") -> dict[str, Any]:
    seen_surf = build_seen_term_set(rows)
    seen = slice_rows(rows, seen_terms=seen_surf, unseen=False)
    unseen = slice_rows(rows, seen_terms=seen_surf, unseen=True)
    pack = {
        "markers": MARKERS,
        "label": label,
        "SEEN": evaluate_model_on_rows(model, seen, cand_cache, cfg),
        "UNSEEN": evaluate_model_on_rows(model, unseen, cand_cache, cfg),
        "SEEN_random_order": evaluate_with_pool_order(model, seen[:800], cand_cache, cfg, randomize_order=True, seed=7),
        "UNSEEN_random_order": evaluate_with_pool_order(
            model, unseen[:800], cand_cache, cfg, randomize_order=True, seed=7
        ),
        "shortcut_SEEN": shortcut_bundle(model, seen, cand_cache, cfg),
        "shortcut_UNSEEN": shortcut_bundle(model, unseen, cand_cache, cfg),
        "phonetic_agreement_UNSEEN": phonetic_agreement(model, unseen, cand_cache, cfg),
        "per_relation": per_relation_metrics(model, rows, seen_surf, cand_cache, cfg),
        "nomatch_fp": evaluate_nomatch_fp(model, rows, cand_cache, cfg),
    }
    sa = pack["SEEN"].get("Recall@1") or 0
    ua = pack["UNSEEN"].get("Recall@1") or 0
    pack["seen_unseen_gap_R1"] = sa - ua
    pack["param_note"] = "same Stage A M0 capacity as 7A unless probe adds aux head"
    return pack


def apply_observed_query_syllables(rows: list[dict], vocab) -> list[dict]:
    """P1-B: replace query syllable channel with ASR_DERIVED_APPROX from span_text.

    Uses pypinyin fallback only (explicitly ASR_DERIVED_APPROX) to avoid per-row Node CLI latency.
    """
    from training.model2.phonetic.syllables import syllables_from_text_fallback

    out = []
    for r in rows:
        rr = dict(r)
        text = rr.get("span_text") or ""
        try:
            syls = [normalize_syllable(s) for s in syllables_from_text_fallback(text) if normalize_syllable(s)]
        except Exception:
            syls = []
        rr["span_syllables_canonical_backup"] = list(rr.get("span_syllables") or [])
        rr["span_syllables"] = syls
        rr["syllable_ids"] = vocab.encode(syls)
        from training.model2.contract import SYLLABLE_MAX

        rr["syllable_count"] = min(len(syls), SYLLABLE_MAX)
        rr["query_syllable_source"] = "ASR_DERIVED_APPROX"
        rr["query_syllable_impl"] = "pypinyin-fallback-v1"
        out.append(rr)
    return out


def field_source_audit(sample_row: dict) -> dict[str, Any]:
    return {
        "markers": MARKERS,
        "fields": {
            "span_text": {
                "SOURCE": "ASR_OBSERVED",
                "value_example": sample_row.get("span_text"),
                "note": "ASR hypothesis fragment used as query chars",
            },
            "span_syllables (baseline)": {
                "SOURCE": "CANONICAL_TARGET",
                "value_example": sample_row.get("span_syllables"),
                "note": "Phase7B: equals target term pinyin 100% — oracle leak into query",
            },
            "span_syllables (P1-B)": {
                "SOURCE": "ASR_DERIVED_APPROX",
                "note": "Derived via syllables_from_text(span_text); may use node bridge or pypinyin fallback",
            },
            "candidate surface/syllables": {
                "SOURCE": "CANDIDATE_METADATA",
                "note": "From CandidateIndex lexicon snapshot",
            },
            "observed_syllables_for_relation": {
                "SOURCE": "SYNTHETIC_LABEL",
                "note": "Corruption-family synthesized observed form for Stage B relation; not ASR G2P",
            },
            "target_term_id": {
                "SOURCE": "SYNTHETIC_LABEL",
                "value_example": sample_row.get("target_term_id"),
            },
            "fuzzy_pool_distances (baseline enrich)": {
                "SOURCE": "DERIVED_FROM_ASR",
                "note": "Computed vs span_syllables; under baseline contract this is vs CANONICAL_TARGET",
            },
        },
    }
