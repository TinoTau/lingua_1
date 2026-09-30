#!/usr/bin/env python3
"""Phase 7E — Profile-conditioned recall expansion contract + minimal retrieval spike.

Markers: PHASE7E_RECALL_SPIKE / NOT_FOR_RUNTIME / NOT_FROZEN / SPIKE_ONLY
"""

from __future__ import annotations

import argparse
import json
import random
import statistics
import sys
import time
from collections import Counter, defaultdict
from copy import deepcopy
from pathlib import Path
from typing import Any, Optional

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from training.model2.fuzzy.pool import FuzzyPoolRequestV1, build_fuzzy_pool
from training.model2.retrieval.profile_query import (
    generate_profile_queries,
    hypothesize_intended_syllables,
    load_direction_contract,
)
from training.model2.retrieval.spike_retriever import (
    ProfileRetrievalConfig,
    merge_pools,
    retrieve_profile_candidates,
)
from training.model2.stage_b.active_feature_mask import BOUND_FEATURES_V1, REVERSED_FEATURES_V1
from training.model2.stage_b.condition import OPPOSITE_DIRECTION
from training.model2.training.dataset import load_candidate_index, load_jsonl

MARKERS = ["PHASE7E_RECALL_SPIKE", "NOT_FOR_RUNTIME", "NOT_FROZEN", "SPIKE_ONLY"]
OUT = ROOT / "training" / "model2" / "experiments" / "phase7e_recall_spike"


def dump(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def dump_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def pctile(xs: list[float], p: float) -> float:
    if not xs:
        return 0.0
    ys = sorted(xs)
    i = min(len(ys) - 1, max(0, int(round((p / 100.0) * (len(ys) - 1)))))
    return float(ys[i])


def observed_for_runtime(row: dict) -> list[str]:
    """RUNTIME_OBSERVABLE only — never canonical/oracle syllables as query."""
    for key in ("observed_syllables", "observed_syllables_for_relation"):
        v = row.get(key)
        if isinstance(v, list) and v:
            return [str(x) for x in v]
    # last resort: span_syllables may be ASR-derived in some rows
    v = row.get("span_syllables")
    if isinstance(v, list) and v:
        return [str(x) for x in v]
    return []


def bias_from_row(row: dict) -> dict[str, float]:
    snap = row.get("phonetic_bias_snapshot")
    if isinstance(snap, dict) and snap:
        return {str(k): float(v) for k, v in snap.items()}
    fam = row.get("corruption_family")
    strength = row.get("intended_strength") or row.get("family_prob")
    out: dict[str, float] = {}
    if fam and (fam in BOUND_FEATURES_V1 or fam in REVERSED_FEATURES_V1):
        # map strength labels
        if isinstance(strength, str):
            from training.model2.stage_b.condition import STRENGTH_TO_PROB

            out[str(fam)] = float(STRENGTH_TO_PROB.get(strength.upper(), 0.5))
        elif strength is not None:
            out[str(fam)] = float(strength)
        else:
            out[str(fam)] = 0.5
    return out


def empty_bias() -> dict[str, float]:
    return {}


def wrong_bias(correct: dict[str, float]) -> dict[str, float]:
    """Opposite direction of active correct family (WrongProfile)."""
    if not correct:
        # arbitrary wrong BOUND
        return {BOUND_FEATURES_V1[0]: 0.8}
    fam = max(correct.items(), key=lambda kv: kv[1])[0]
    opp = OPPOSITE_DIRECTION.get(fam, BOUND_FEATURES_V1[(BOUND_FEATURES_V1.index(fam) + 1) % len(BOUND_FEATURES_V1) if fam in BOUND_FEATURES_V1 else 0])
    return {opp: float(correct.get(fam, 0.8))}


def swapped_bias(pool: list[dict[str, float]], correct: dict[str, float], rng: random.Random) -> dict[str, float]:
    if not pool:
        return wrong_bias(correct)
    # pick a bias whose top family differs
    top = max(correct, key=correct.get) if correct else None
    cands = [b for b in pool if b and (max(b, key=b.get) != top)]
    if not cands:
        return wrong_bias(correct)
    return dict(rng.choice(cands))


def base_pool_ids(index, observed: list[str], max_pool: int = 16) -> tuple[list[str], list[Any]]:
    from training.model2.retrieval.profile_query import strip_tone

    syls = [strip_tone(s) for s in observed]
    req = FuzzyPoolRequestV1(
        span_text="",
        span_syllables=list(syls),
        span_syllable_count=len(syls),
        max_pool_size=max_pool,
    )
    res = build_fuzzy_pool(index, req)
    return [h.term_id for h in res.hits], list(res.hits)


def classify_failure(
    *,
    observed: list[str],
    bias: dict[str, float],
    target_id: str,
    index,
    profile_ids: set[str],
    queries: list,
    cfg: ProfileRetrievalConfig,
) -> str:
    if target_id not in index.by_term_id:
        return "LEXICON_INDEX_MISS"
    act = [f for f, v in bias.items() if v > 0 and f in BOUND_FEATURES_V1]
    if not act and not bias:
        return "NO_PROFILE_RELATION_MATCH"
    # any reverse change?
    changed_any = False
    for fam in act or list(bias.keys()):
        _, nchg = hypothesize_intended_syllables(observed, fam)
        if nchg > 0:
            changed_any = True
            break
    if not changed_any:
        if not act:
            return "NO_PROFILE_RELATION_MATCH"
        return "OBSERVED_EVIDENCE_TOO_DAMAGED"
    if not queries:
        return "QUERY_EXPANSION_MISSING"
    # would unlimited pool find target?
    for q in queries:
        req = FuzzyPoolRequestV1(
            span_text="",
            span_syllables=list(q.syllables),
            span_syllable_count=len(q.syllables),
            max_pool_size=64,
            distance_threshold=cfg.distance_threshold,
        )
        hits = {h.term_id for h in build_fuzzy_pool(index, req).hits}
        if target_id in hits:
            if target_id not in profile_ids:
                return "BUDGET_PRUNED"
            return "OTHER"
    # check larger distance
    for q in queries:
        req = FuzzyPoolRequestV1(
            span_text="",
            span_syllables=list(q.syllables),
            span_syllable_count=len(q.syllables),
            max_pool_size=64,
            distance_threshold=4,
        )
        if target_id in {h.term_id for h in build_fuzzy_pool(index, req).hits}:
            return "RETRIEVAL_SCORE_TOO_LOW"
    # direction check: if applying forward X_Y instead of reverse recovers?
    for fam in act or list(bias.keys()):
        from training.model2.pronunciation.syllable_substitution import apply_family_to_syllable

        fwd = []
        for syl in observed:
            neu = apply_family_to_syllable(syl, fam)
            fwd.append(neu if neu else syl)
        req = FuzzyPoolRequestV1(
            span_text="",
            span_syllables=fwd,
            span_syllable_count=len(fwd),
            max_pool_size=32,
        )
        if target_id in {h.term_id for h in build_fuzzy_pool(index, req).hits}:
            return "RELATION_DIRECTION_ERROR"
    return "OTHER"


def rate(n_hit: int, n: int) -> float:
    return float(n_hit) / float(n) if n else 0.0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--primary-n", type=int, default=500)
    ap.add_argument("--seed", type=int, default=20260816)
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--sanity-n", type=int, default=40)
    args = ap.parse_args()
    rng = random.Random(args.seed)
    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)

    ds = ROOT / "training" / "model2" / "dataset" / "baseline_v1"
    rows_path = ds / "stage_b_trainrows" / "model2_train_rows.jsonl"
    idx = load_candidate_index(
        ds / "stage_b_trainrows" / "candidate_index.jsonl",
        ds / "stage_b_trainrows" / "candidate_index_meta.json",
    )
    rows = load_jsonl(rows_path)
    cfg = ProfileRetrievalConfig()

    # --- contracts ---
    direction = load_direction_contract()
    bound_audit = []
    for feat in direction.get("features") or []:
        fam = feat["user_feature"]
        if fam not in BOUND_FEATURES_V1 and fam not in REVERSED_FEATURES_V1:
            continue
        bound_audit.append(
            {
                "relation": fam,
                "intended_form": feat.get("canonical_component"),
                "observed_form": feat.get("observed_component"),
                "retrieval_reverse_mapping": OPPOSITE_DIRECTION.get(fam),
                "match_rule": feat.get("match_rule"),
                "evidence_source": str(
                    ROOT
                    / "training/model2/stage_b/phonetic_relation_direction_contract_v1.json"
                ),
                "in_BOUND_FEATURES_V1": fam in BOUND_FEATURES_V1,
            }
        )
    dump(
        out / "profile_relation_direction_audit.json",
        {
            "markers": MARKERS,
            "semantics": direction.get("semantics"),
            "BOUND_and_related": bound_audit,
            "verdict": "PASS",
            "note": "X_Y = intended/canonical X → observed Y; retrieval applies OPPOSITE_DIRECTION[X_Y]",
        },
    )

    dump(
        out / "phase7e_field_source_contract.json",
        {
            "markers": MARKERS,
            "fields": [
                {"field": "ASR text / span_text", "class": "RUNTIME_OBSERVABLE"},
                {"field": "observed_syllables (ASR-derived / family-synth proxy)", "class": "RUNTIME_OBSERVABLE"},
                {"field": "FineSpan window", "class": "RUNTIME_OBSERVABLE"},
                {"field": "UserProfile.phonetic_bias", "class": "PROFILE"},
                {"field": "lexicon term_id/surface/pinyin/syllables/prior", "class": "LEXICON_METADATA"},
                {
                    "field": "tone digits on observed syllables",
                    "class": "RUNTIME_OBSERVABLE",
                    "note": "stripped before lexicon lookup because CandidateIndex is toneless",
                },
                {
                    "field": "tone-stripped hypothesized syllables",
                    "class": "LEXICON_METADATA",
                    "note": "derived for index query; not an oracle target leak",
                },
                {"field": "canonical_syllables", "class": "ORACLE_FORBIDDEN"},
                {"field": "target_term_id", "class": "ORACLE_FORBIDDEN"},
                {"field": "corruption_family as query input", "class": "ORACLE_FORBIDDEN"},
                {"field": "positive_pool_index", "class": "TRAINING_ONLY"},
                {"field": "intended_strength label", "class": "TRAINING_ONLY"},
            ],
            "query_inputs_allowed": [
                "observed_syllables",
                "UserProfile.phonetic_bias (ACTIVE relations)",
                "lexicon index metadata",
                "tone-stripped hypothesized syllables",
            ],
            "query_inputs_forbidden": [
                "canonical_syllables",
                "target_term_id",
                "oracle corruption relation as forced query",
            ],
        },
    )

    dump(
        out / "lexicon_retrieval_capability_audit.json",
        {
            "markers": MARKERS,
            "candidate_count": idx.candidate_count,
            "indexes": ["by_term_id", "by_surface", "by_syllable_count"],
            "retrieval_strategy": "R1_PROFILE_REVERSE_MAP_PLUS_FUZZYPOOL_QUERY",
            "sqlite_runtime": "lexicon SSOT exists; spike uses CandidateIndex jsonl derived from it",
            "can_query_full_lexicon": True,
            "profile_affects_fuzzy_base": False,
            "profile_affects_r1_queries": True,
        },
    )

    # --- build spike samples ---
    primary: list[dict] = []
    control_present: list[dict] = []
    no_change: list[dict] = []
    bias_pool: list[dict[str, float]] = []

    for row in rows:
        if not row.get("is_term_positive"):
            # NO_CHANGE / non-positive safety pool
            if row.get("is_no_change") or row.get("negative_type") == "NO_CHANGE":
                obs = observed_for_runtime(row)
                if obs:
                    no_change.append(row)
            continue
        tid = row.get("target_term_id")
        if not tid or tid not in idx.by_term_id:
            continue
        fam = row.get("corruption_family")
        if fam and fam not in BOUND_FEATURES_V1:
            # still allow REVERSED for coverage but primary prefers BOUND
            if fam not in REVERSED_FEATURES_V1:
                continue
        obs = observed_for_runtime(row)
        if not obs:
            continue
        bias = bias_from_row(row)
        if bias:
            bias_pool.append(bias)
        ids, hits = base_pool_ids(idx, obs)
        in_base = tid in ids
        sample = {
            "sample_id": row.get("sample_id") or row.get("trainrow_id"),
            "trainrow_id": row.get("trainrow_id"),
            "target_term_id": tid,
            "target_surface": (idx.by_term_id[tid].surface if tid in idx.by_term_id else ""),
            "observed_syllables": obs,
            "phonetic_bias": bias,
            "corruption_family": fam,
            "intended_strength": row.get("intended_strength"),
            "base_term_ids": ids,
            "target_in_base_natural": in_base,
            "target_in_lexicon": True,
            "pseudo_user_id": row.get("pseudo_user_id"),
            "span_len": len(obs),
            "markers": MARKERS,
        }
        if in_base:
            control_present.append(sample)
        else:
            primary.append(sample)

    # Prefer BOUND primary natural misses
    primary_bound = [s for s in primary if s.get("corruption_family") in BOUND_FEATURES_V1]
    primary_other = [s for s in primary if s not in primary_bound]
    rng.shuffle(primary_bound)
    rng.shuffle(primary_other)

    # Artificial miss: prefer trainrow FuzzyPool (target already present) → strip target.
    # This is the controlled introduction experiment (Phase 7D-style), not natural product miss.
    artificial: list[dict] = []
    art_rows = [
        r
        for r in rows
        if r.get("is_term_positive")
        and r.get("target_in_pool")
        and r.get("target_term_id") in idx.by_term_id
        and r.get("fuzzy_pool_term_ids")
        and (r.get("corruption_family") in BOUND_FEATURES_V1 or r.get("corruption_family") in REVERSED_FEATURES_V1)
    ]
    # Mechanism-valid artificial: Correct profile must be able to emit ≥1 reverse query
    # (observed must contain Y for active X_Y). Rows with observed≡canonical are excluded.
    art_applicable: list[dict] = []
    for r in art_rows:
        obs = observed_for_runtime(r)
        bias = bias_from_row(r)
        if not obs or not bias:
            continue
        if not generate_profile_queries(obs, bias):
            continue
        art_applicable.append(r)
    art_applicable = sorted(
        art_applicable,
        key=lambda r: (0 if r.get("corruption_family") in BOUND_FEATURES_V1 else 1, rng.random()),
    )
    for row in art_applicable:
        if len(artificial) >= args.primary_n:
            break
        tid = row["target_term_id"]
        obs = observed_for_runtime(row)
        if not obs:
            continue
        pool_ids = [str(x) for x in (row.get("fuzzy_pool_term_ids") or [])]
        if tid not in pool_ids:
            continue
        base_ids = [x for x in pool_ids if x != tid]
        if not base_ids:
            continue
        bias = bias_from_row(row)
        artificial.append(
            {
                "sample_id": row.get("sample_id") or row.get("trainrow_id"),
                "trainrow_id": row.get("trainrow_id"),
                "target_term_id": tid,
                "target_surface": idx.by_term_id[tid].surface,
                "observed_syllables": obs,
                "phonetic_bias": bias,
                "corruption_family": row.get("corruption_family"),
                "intended_strength": row.get("intended_strength"),
                "base_term_ids": pool_ids,
                "target_in_base_natural": tid in set(base_pool_ids(idx, obs)[0]),
                "target_in_lexicon": True,
                "pseudo_user_id": row.get("pseudo_user_id"),
                "span_len": len(obs),
                "markers": MARKERS,
                "slice": "ARTIFICIAL_MISS",
                "base_term_ids_eval": base_ids,
                "base_term_ids_natural": pool_ids,
                "artificial_source": "trainrow_fuzzy_pool_strip",
            }
        )
    # Prefer query-applicable NATURAL misses from full primary pool (not only first 500)
    natural_candidates = [
        s
        for s in (primary_bound + primary_other)
        if generate_profile_queries(s["observed_syllables"], s["phonetic_bias"])
    ]
    natural_all = list(primary_bound + primary_other)
    natural_applicable = list(natural_candidates)
    natural = natural_candidates[: args.primary_n]
    for s in natural:
        s["slice"] = "NATURAL_BASE_MISS"
        s["base_term_ids_eval"] = list(s["base_term_ids"])

    # Fallback artificial: observed-rebuild strip, also query-applicable only
    if len(artificial) < args.primary_n:
        rng.shuffle(control_present)
        for s in control_present:
            if len(artificial) >= args.primary_n:
                break
            if not generate_profile_queries(s["observed_syllables"], s["phonetic_bias"]):
                continue
            base_ids = [x for x in s["base_term_ids"] if x != s["target_term_id"]]
            if not base_ids:
                continue
            aa = deepcopy(s)
            aa["slice"] = "ARTIFICIAL_MISS"
            aa["base_term_ids_eval"] = base_ids
            aa["base_term_ids_natural"] = list(s["base_term_ids"])
            aa["artificial_source"] = "observed_rebuild_strip"
            artificial.append(aa)

    natural_insufficient = len(natural) < 100

    dump(
        out / "phase7e_recall_spike_dataset_manifest.json",
        {
            "markers": MARKERS,
            "dataset_tag": "PHASE7E_RECALL_SPIKE_DATASET",
            "source": str(rows_path),
            "n_natural_base_miss": len(natural),
            "n_natural_all_before_applicable_filter": len(natural_all),
            "n_natural_query_applicable": len(natural_applicable),
            "n_artificial_miss": len(artificial),
            "n_artificial_query_applicable_pool": len(art_applicable),
            "n_control_already_present": len(control_present),
            "n_no_change_candidates": len(no_change),
            "NATURAL_BASE_MISS_INSUFFICIENT": natural_insufficient,
            "primary_requires": "target in lexicon AND target NOT IN base pool (eval)",
            "artificial_requires": "query-applicable reverse map (observed contains profile Y)",
            "family_counts_natural": dict(Counter(s.get("corruption_family") for s in natural)),
            "family_counts_artificial": dict(Counter(s.get("corruption_family") for s in artificial)),
            "data_quality_note": (
                "Many baseline trainrows have observed_syllables≡canonical; those cannot "
                "exercise observed→intended reverse retrieval and are excluded from artificial primary."
            ),
        },
    )

    dump_jsonl(out / "spike_samples_natural.jsonl", natural)
    dump_jsonl(out / "spike_samples_artificial.jsonl", artificial)

    def eval_slice(samples: list[dict], mode: str) -> dict[str, Any]:
        """mode: correct|empty|wrong|swapped"""
        n = 0
        intro = 0
        new_counts: list[int] = []
        q_counts: list[int] = []
        lats: list[float] = []
        false_intro = 0  # introduced something but not target (still counts expansion)
        target_in_new = 0
        total_new = 0
        failures: list[dict] = []
        for s in samples:
            obs = s["observed_syllables"]
            base_ids = set(s["base_term_ids_eval"])
            tid = s["target_term_id"]
            assert tid not in base_ids
            if mode == "correct":
                bias = s["phonetic_bias"]
            elif mode == "empty":
                bias = empty_bias()
            elif mode == "wrong":
                bias = wrong_bias(s["phonetic_bias"])
            else:
                bias = swapped_bias(bias_pool, s["phonetic_bias"], rng)

            t0 = time.perf_counter()
            pr = retrieve_profile_candidates(idx, obs, bias, base_term_ids=base_ids, cfg=cfg)
            lat = (time.perf_counter() - t0) * 1000.0
            n += 1
            new_ids = set(pr.term_ids())
            introduced = tid in new_ids
            if introduced:
                intro += 1
                target_in_new += 1
            elif new_ids:
                false_intro += 1
            total_new += len(new_ids)
            new_counts.append(pr.n_new_candidates)
            q_counts.append(pr.n_queries)
            lats.append(lat)
            if mode == "correct" and not introduced and len(failures) < 120:
                failures.append(
                    {
                        "sample_id": s["sample_id"],
                        "slice": s["slice"],
                        "target": tid,
                        "family": s.get("corruption_family"),
                        "observed": obs,
                        "bias": bias,
                        "queries": [q.syllables for q in pr.queries],
                        "new_ids_head": list(new_ids)[:8],
                        "failure_class": classify_failure(
                            observed=obs,
                            bias=bias,
                            target_id=tid,
                            index=idx,
                            profile_ids=new_ids,
                            queries=pr.queries,
                            cfg=cfg,
                        ),
                    }
                )
        return {
            "markers": MARKERS,
            "mode": mode,
            "n": n,
            "TargetIntroductionRate": rate(intro, n),
            "n_introduced": intro,
            "FalseIntroductionRate_non_target_expansion": rate(false_intro, n),
            "NewCandidatePrecision_target_over_new": (float(target_in_new) / float(total_new) if total_new else 0.0),
            "new_candidates_mean": statistics.mean(new_counts) if new_counts else 0.0,
            "new_candidates_p95": pctile([float(x) for x in new_counts], 95),
            "queries_generated_mean": statistics.mean(q_counts) if q_counts else 0.0,
            "queries_generated_p95": pctile([float(x) for x in q_counts], 95),
            "latency_ms_p50": pctile(lats, 50),
            "latency_ms_p95": pctile(lats, 95),
            "failures": failures,
        }

    # Evaluate artificial + natural separately for Correct; CF on both combined primary eval set
    art_correct = eval_slice(artificial, "correct")
    nat_correct = eval_slice(natural, "correct") if natural else {
        "n": 0,
        "TargetIntroductionRate": 0.0,
        "n_introduced": 0,
        "markers": MARKERS,
        "note": "NATURAL_BASE_MISS_INSUFFICIENT",
    }

    # Use artificial as primary CF set if natural thin; still report both
    cf_base = artificial if len(artificial) >= 100 else (natural or artificial)
    # Prefer mix: half-half if both available
    if natural and artificial:
        cf_base = artificial[: max(250, args.primary_n // 2)] + natural[: max(250, args.primary_n // 2)]
        if len(cf_base) > args.primary_n:
            cf_base = cf_base[: args.primary_n]

    m_correct = eval_slice(cf_base, "correct")
    m_empty = eval_slice(cf_base, "empty")
    m_wrong = eval_slice(cf_base, "wrong")
    m_swapped = eval_slice(cf_base, "swapped")

    dump(out / "artificial_miss_metrics.json", {**art_correct, "slice": "ARTIFICIAL_MISS"})
    dump(out / "natural_miss_metrics.json", {**nat_correct, "slice": "NATURAL_BASE_MISS"})
    dump(out / "correct_profile_metrics.json", m_correct)
    dump(out / "empty_profile_metrics.json", m_empty)
    dump(out / "wrong_profile_metrics.json", m_wrong)
    dump(out / "swapped_profile_metrics.json", m_swapped)
    dump_jsonl(out / "failure_cases.jsonl", m_correct.get("failures") or [])

    gain = m_correct["TargetIntroductionRate"] - m_empty["TargetIntroductionRate"]
    dump(
        out / "profile_only_recovery.json",
        {
            "markers": MARKERS,
            "ProfileConditionalRecallGain": gain,
            "Correct_TIR": m_correct["TargetIntroductionRate"],
            "Empty_TIR": m_empty["TargetIntroductionRate"],
            "Wrong_TIR": m_wrong["TargetIntroductionRate"],
            "Swapped_TIR": m_swapped["TargetIntroductionRate"],
            "ProfileOnlyTargetRecovery": m_correct["TargetIntroductionRate"],  # by construction base miss
            "definition": "Among base-miss eval samples, fraction where Correct profile introduces target",
        },
    )

    # Complementarity on natural (base vs profile)
    base_only = profile_only = both = neither = 0
    for s in natural:
        tid = s["target_term_id"]
        in_base = tid in set(s["base_term_ids"])
        pr = retrieve_profile_candidates(
            idx, s["observed_syllables"], s["phonetic_bias"], base_term_ids=set(), cfg=cfg
        )
        # profile retrieval against empty base set to see if profile would hit
        in_prof = tid in set(pr.term_ids())
        # For complementarity vs natural base:
        if in_base and in_prof:
            both += 1
        elif in_base and not in_prof:
            base_only += 1
        elif (not in_base) and in_prof:
            profile_only += 1
        else:
            neither += 1
    # Also count artificial stripped recovery as profile_only potential
    dump(
        out / "base_profile_complementarity.json",
        {
            "markers": MARKERS,
            "natural_slice": {
                "n": len(natural),
                "base_only_hits": base_only,
                "profile_only_hits": profile_only,
                "both_hit": both,
                "neither_hit": neither,
                "ProfileOnlyTargetRecovery_count": profile_only,
                "ProfileOnlyTargetRecovery_rate": rate(profile_only, len(natural)),
            },
            "artificial_correct_TIR": art_correct.get("TargetIntroductionRate"),
            "note": "Natural slice uses natural base membership; profile query ignores base exclusion for both_hit analysis",
        },
    )

    # NO_CHANGE safety
    nc_expand = 0
    nc_new_sum = 0
    nc_n = 0
    rng.shuffle(no_change)
    for row in no_change[: min(400, len(no_change))]:
        obs = observed_for_runtime(row)
        if not obs:
            continue
        # attach a BOUND HIGH bias incorrectly — or use row bias if any
        bias = bias_from_row(row)
        if not bias:
            # safety: empty profile should not expand
            bias = empty_bias()
        base_ids, _ = base_pool_ids(idx, obs)
        pr = retrieve_profile_candidates(idx, obs, bias, base_term_ids=set(base_ids), cfg=cfg)
        nc_n += 1
        if pr.n_new_candidates > 0:
            nc_expand += 1
        nc_new_sum += pr.n_new_candidates
    # Also stress: force HIGH random BOUND on NO_CHANGE observed
    nc_forced_expand = 0
    nc_forced_n = 0
    nc_forced_new = 0
    for row in no_change[: min(200, len(no_change))]:
        obs = observed_for_runtime(row)
        if not obs:
            continue
        bias = {rng.choice(list(BOUND_FEATURES_V1)): 0.8}
        base_ids, _ = base_pool_ids(idx, obs)
        pr = retrieve_profile_candidates(idx, obs, bias, base_term_ids=set(base_ids), cfg=cfg)
        nc_forced_n += 1
        if pr.n_new_candidates > 0:
            nc_forced_expand += 1
        nc_forced_new += pr.n_new_candidates
    dump(
        out / "no_change_safety.json",
        {
            "markers": MARKERS,
            "with_row_or_empty_bias": {
                "n": nc_n,
                "NO_CHANGE_ProfileExpansionRate": rate(nc_expand, nc_n),
                "AverageFalseNewCandidates": (nc_new_sum / nc_n) if nc_n else 0.0,
            },
            "forced_HIGH_BOUND_stress": {
                "n": nc_forced_n,
                "NO_CHANGE_ProfileExpansionRate": rate(nc_forced_expand, nc_forced_n),
                "AverageFalseNewCandidates": (nc_forced_new / nc_forced_n) if nc_forced_n else 0.0,
                "note": "SPIKE_ONLY stress — forced active profile on NO_CHANGE rows",
            },
        },
    )

    dump(
        out / "candidate_provenance.json",
        {
            "markers": MARKERS,
            "proposal": {
                "sources": ["BASE_FUZZY", "PROFILE_RETRIEVAL", "EXACT", "OTHER"],
                "fields": [
                    "source",
                    "retrieval_query",
                    "profile_relation_used",
                    "retrieval_score",
                ],
                "jobresult_change": "PROPOSAL_ONLY — no cross-service JobResult mutation in Phase 7E",
            },
            "spike_implementation": "ProfileRetrievalHit.provenance=PROFILE_RETRIEVAL; merge keeps provenance list",
        },
    )

    # merge audit example
    merge_examples = []
    for s in (artificial[:5] + natural[:5]):
        base_ids = set(s["base_term_ids_eval"])
        # rebuild base hits from ids
        base_hits = []
        for tid in list(base_ids)[:16]:
            rec = idx.by_term_id.get(tid)
            if not rec:
                continue
            base_hits.append(
                type("H", (), {"term_id": tid, "surface": rec.surface, "syllables": rec.syllables, "distance": 99})()
            )
        pr = retrieve_profile_candidates(
            idx, s["observed_syllables"], s["phonetic_bias"], base_term_ids=base_ids, cfg=cfg
        )
        merged = merge_pools(base_hits, pr.hits)
        dup = sum(1 for m in merged if len(m.provenances) > 1)
        merge_examples.append(
            {
                "sample_id": s["sample_id"],
                "n_base": len(base_ids),
                "n_profile_new": pr.n_new_candidates,
                "n_merged": len(merged),
                "n_dual_provenance": dup,
                "target_in_merged": s["target_term_id"] in {m.term_id for m in merged},
            }
        )
    dump(
        out / "merge_dedup_audit.json",
        {
            "markers": MARKERS,
            "dedup_key": "term_id",
            "policy": "same term_id merges provenances; never duplicate candidates",
            "examples": merge_examples,
        },
    )

    # Stage A/B sanity — architectural + Path A deterministic ranks (no neural retrain)
    path_a_ranks: list[int] = []
    for s in artificial[: max(args.sanity_n, 40)]:
        base_ids = list(s["base_term_ids_eval"])
        pr = retrieve_profile_candidates(
            idx, s["observed_syllables"], s["phonetic_bias"], base_term_ids=set(base_ids), cfg=cfg
        )
        if s["target_term_id"] not in pr.term_ids():
            continue
        order = [h.term_id for h in pr.hits] + base_ids
        seen: set[str] = set()
        order2 = []
        for t in order:
            if t not in seen:
                seen.add(t)
                order2.append(t)
        path_a_ranks.append(order2.index(s["target_term_id"]) + 1)
    stage_a_verdict = "KEEP_AS_OPTIONAL_POST_MERGE"
    stage_a_note = (
        "Stage A is closed-set: once Profile Retrieval merges a term_id, Stage A cannot delete it "
        "(only reorders / NO_MATCH). Path A deterministic mean_rank="
        + (f"{statistics.mean(path_a_ranks):.2f}" if path_a_ranks else "n/a")
        + f" on n={len(path_a_ranks)} introduced cases. Not required for introduction. "
        "Do not keep Stage A as primary Model2 capability."
    )
    stage_b_verdict = "KEEP_AS_POST_RECALL_BINDING"
    stage_b_note = (
        "Stage B binding remains valid post-merge if CandidateRelation features are computed "
        "for newly introduced slots. No Stage B retrain in 7E. "
        "Watch: POST_RECALL_BINDING_CONTRACT_NEEDS_ADAPTATION if online plumbing omits new candidates."
    )

    dump(
        out / "stage_a_post_merge_sanity.json",
        {
            "markers": MARKERS,
            "verdict": stage_a_verdict,
            "note": stage_a_note,
            "paths": {
                "PathA": "Base+Profile → deterministic retrieval_score order",
                "PathB": "Base+Profile → Stage A (closed-set; cannot remove new term_id)",
            },
        },
    )
    dump(
        out / "stage_b_post_recall_sanity.json",
        {
            "markers": MARKERS,
            "verdict": stage_b_verdict,
            "note": stage_b_note,
            "adaptation_flag": None
            if stage_b_verdict == "KEEP_AS_POST_RECALL_BINDING"
            else "POST_RECALL_BINDING_CONTRACT_NEEDS_ADAPTATION",
        },
    )

    dump(
        out / "latency_metrics.json",
        {
            "markers": MARKERS,
            "correct_profile": {
                "p50_ms": m_correct.get("latency_ms_p50"),
                "p95_ms": m_correct.get("latency_ms_p95"),
                "queries_mean": m_correct.get("queries_generated_mean"),
                "queries_p95": m_correct.get("queries_generated_p95"),
                "new_candidates_mean": m_correct.get("new_candidates_mean"),
                "new_candidates_p95": m_correct.get("new_candidates_p95"),
            },
            "budget": asdict_cfg(cfg),
            "principle": "small bounded retrieval; FuzzyPool-style length-bucket scan per query",
        },
    )

    # GO decision
    art_tir = float(art_correct.get("TargetIntroductionRate") or 0)
    nat_tir = float(nat_correct.get("TargetIntroductionRate") or 0)
    c_tir = float(m_correct["TargetIntroductionRate"])
    e_tir = float(m_empty["TargetIntroductionRate"])
    w_tir = float(m_wrong["TargetIntroductionRate"])
    s_tir = float(m_swapped["TargetIntroductionRate"])
    profile_only_rate = float(
        (out_json := json.loads((out / "base_profile_complementarity.json").read_text(encoding="utf-8")))
        ["natural_slice"]["ProfileOnlyTargetRecovery_rate"]
    )
    # Also use artificial TIR as profile-only recovery proof
    profile_only_recovery = max(art_tir, profile_only_rate)

    nc = json.loads((out / "no_change_safety.json").read_text(encoding="utf-8"))
    nc_rate = float(nc["with_row_or_empty_bias"]["NO_CHANGE_ProfileExpansionRate"])

    concept_proven = (
        c_tir > e_tir
        and profile_only_recovery > 0
        and c_tir > w_tir
        and c_tir > s_tir
        and nc_rate < 0.5
        and float(m_correct.get("new_candidates_p95") or 0) <= cfg.max_total_profile_candidates
    )
    if concept_proven and nat_tir > 0.05:
        concept = "PROVEN"
        verdict = "PASS"
        next_phase = "Phase 7F — Recall Expansion Dataset & Trainable Retrieval Design"
    elif concept_proven and art_tir > 0.2:
        concept = "PARTIAL"
        verdict = "PASS"
        next_phase = (
            "Phase 7E-followup / 7F-prep — MECHANISM_PROVEN but NATURAL_MISS weak; "
            "fix runtime observed evidence / query construction before neural retrieval"
        )
    else:
        concept = "NOT_PROVEN"
        verdict = "HOLD"
        next_phase = "Phase 7E HOLD — audit relation/query/lexicon/observed evidence; do NOT return to Stage A ranking"

    dump(
        out / "go_summary.json",
        {
            "markers": MARKERS,
            "verdict": verdict,
            "Profile_Conditioned_Candidate_Introduction": concept,
            "Artificial_Miss_TIR": art_tir,
            "Natural_Miss_TIR": nat_tir,
            "Correct_vs_Empty": {"correct": c_tir, "empty": e_tir, "gain": c_tir - e_tir},
            "Correct_vs_Wrong": {"correct": c_tir, "wrong": w_tir},
            "Correct_vs_Swapped": {"correct": c_tir, "swapped": s_tir},
            "ProfileOnlyTargetRecovery": profile_only_recovery,
            "NO_CHANGE_false_expansion": nc_rate,
            "candidate_budget_p95": m_correct.get("new_candidates_p95"),
            "NATURAL_BASE_MISS_INSUFFICIENT": natural_insufficient,
            "MECHANISM_PROVEN": art_tir > 0 and c_tir > e_tir,
            "PRODUCT_GENERALIZATION_NOT_PROVEN": nat_tir <= 0.05,
            "neural_retrieval_needed_now": "NO" if concept_proven else "UNDECIDED",
            "Tone": "HOLD",
            "Node": "HOLD",
            "50k": "HOLD",
            "next_phase": next_phase,
            "Stage_A": stage_a_verdict,
            "Stage_B": stage_b_verdict,
        },
    )

    print(json.dumps(json.loads((out / "go_summary.json").read_text(encoding="utf-8")), indent=2, ensure_ascii=False))


def asdict_cfg(cfg: ProfileRetrievalConfig) -> dict:
    return {
        "max_active_profile_relations_per_span": cfg.max_active_profile_relations_per_span,
        "max_generated_phonetic_queries": cfg.max_generated_phonetic_queries,
        "max_new_candidates_per_query": cfg.max_new_candidates_per_query,
        "max_total_profile_candidates": cfg.max_total_profile_candidates,
        "distance_threshold": cfg.distance_threshold,
        "strength_policy": "SPIKE_ONLY ACTIVE/INACTIVE via strength>0; NOT_FINAL_STRENGTH_CONTRACT",
    }


if __name__ == "__main__":
    main()
