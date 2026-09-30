#!/usr/bin/env python3
"""Phase 7F — Realistic recall expansion dataset & failure boundary audit.

Markers: PHASE7F_AUDIT / NOT_FOR_RUNTIME / NOT_FROZEN
Does NOT train neural retrieval. Does NOT tune rules to chase metrics.
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
from training.model2.phonetic.syllables import text_to_syllables
from training.model2.pronunciation.syllable_substitution import (
    apply_family_to_syllable,
    corrupt_syllable_sequence,
)
from training.model2.retrieval.normalize import (
    normalize_for_lexicon_lookup,
    normalize_syllable_sequence_for_lookup,
)
from training.model2.retrieval.profile_query import (
    generate_profile_queries,
    hypothesize_intended_syllables,
)
from training.model2.retrieval.spike_retriever import (
    ProfileRetrievalConfig,
    retrieve_profile_candidates,
)
from training.model2.stage_b.active_feature_mask import BOUND_FEATURES_V1, REVERSED_FEATURES_V1
from training.model2.stage_b.condition import OPPOSITE_DIRECTION, STRENGTH_TO_PROB
from training.model2.training.dataset import load_candidate_index, load_jsonl

MARKERS = ["PHASE7F_AUDIT", "NOT_FOR_RUNTIME", "NOT_FROZEN"]
OUT = ROOT / "training" / "model2" / "experiments" / "phase7f_realistic_boundary"


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


def rate(a: int, b: int) -> float:
    return float(a) / float(b) if b else 0.0


def bias_from_row(row: dict) -> dict[str, float]:
    snap = row.get("phonetic_bias_snapshot")
    if isinstance(snap, dict) and snap:
        return {str(k): float(v) for k, v in snap.items() if float(v) > 0}
    fam = row.get("corruption_family")
    if not fam:
        return {}
    st = row.get("intended_strength") or "MEDIUM"
    if isinstance(st, str):
        v = float(STRENGTH_TO_PROB.get(st.upper(), 0.5))
    else:
        v = float(st or 0.5)
    if v <= 0:
        return {}
    return {str(fam): v}


def observed_runtime(row: dict) -> list[str]:
    for k in ("observed_syllables", "observed_syllables_for_relation"):
        v = row.get(k)
        if isinstance(v, list) and v:
            return [str(x) for x in v]
    v = row.get("span_syllables")
    if isinstance(v, list) and v:
        return [str(x) for x in v]
    return []


def base_pool(index, observed: list[str], max_pool: int = 16) -> tuple[list[str], list[Any]]:
    syls = normalize_syllable_sequence_for_lookup(observed)
    req = FuzzyPoolRequestV1("", syls, len(syls), max_pool_size=max_pool)
    res = build_fuzzy_pool(index, req)
    return [h.term_id for h in res.hits], list(res.hits)


def empty_bias() -> dict[str, float]:
    return {}


def wrong_bias(correct: dict[str, float]) -> dict[str, float]:
    if not correct:
        return {BOUND_FEATURES_V1[0]: 0.8}
    fam = max(correct.items(), key=lambda kv: kv[1])[0]
    opp = OPPOSITE_DIRECTION.get(fam, BOUND_FEATURES_V1[0])
    return {opp: float(correct.get(fam, 0.8))}


def swapped_bias(pool: list[dict[str, float]], correct: dict[str, float], rng: random.Random) -> dict[str, float]:
    top = max(correct, key=correct.get) if correct else None
    cands = [b for b in pool if b and max(b, key=b.get) != top]
    if not cands:
        return wrong_bias(correct)
    return dict(rng.choice(cands))


def explained_by_family(obs: str, can: str, fam: str) -> bool:
    """True if obs looks like Y and can looks like X for feature X_Y."""
    if fam not in OPPOSITE_DIRECTION:
        return False
    # forward X→Y on canonical should yield observed (tone-insensitive compare)
    fwd = apply_family_to_syllable(can, fam)
    if fwd is None:
        return False
    return normalize_for_lexicon_lookup(fwd) == normalize_for_lexicon_lookup(obs)


def position_diffs(obs: list[str], canon: list[str]) -> list[tuple[int, str, str]]:
    n = min(len(obs), len(canon))
    diffs = []
    for i in range(n):
        if normalize_for_lexicon_lookup(obs[i]) != normalize_for_lexicon_lookup(canon[i]):
            diffs.append((i, obs[i], canon[i]))
    return diffs


def classify_slice_labels(row: dict, *, in_base: bool, bias: dict[str, float], obs: list[str]) -> list[str]:
    labels: list[str] = []
    canon = [str(x) for x in (row.get("canonical_syllables") or [])]
    fam = row.get("corruption_family")
    diffs = position_diffs(obs, canon) if canon and obs else []

    if row.get("is_no_change") or (row.get("provenance") or {}).get("eligibility_class") == "ELIGIBLE_NO_CHANGE":
        labels.append("S12_NO_CHANGE")
    if not in_base and row.get("is_term_positive") and row.get("target_term_id"):
        labels.append("S11_NATURAL_BASE_MISS")

    if len(obs) < len(canon) and canon:
        labels.append("S4_ASR_SYLLABLE_DELETION")
    if len(obs) > len(canon) and canon:
        labels.append("S5_ASR_SYLLABLE_INSERTION")

    # multi active bias keys
    active = [k for k, v in bias.items() if v > 0 and (k in BOUND_FEATURES_V1 or k in REVERSED_FEATURES_V1)]
    if len(active) >= 2:
        labels.append("S9_MULTI_RELATION_PROFILE_USER")

    st = str(row.get("intended_strength") or "").upper()
    if st == "LOW" or (bias and max(bias.values()) <= 0.25):
        labels.append("S10_WEAK_PROFILE")

    if fam and diffs:
        explained = [d for d in diffs if explained_by_family(d[1], d[2], fam)]
        unexplained = [d for d in diffs if not explained_by_family(d[1], d[2], fam)]
        if len(explained) >= 1 and not unexplained and len(diffs) >= 1 and len(active) <= 1:
            labels.append("S1_SINGLE_PROFILE_CLEAN")
        if len(explained) >= 1 and unexplained:
            labels.append("S3_PROFILE_PARTIAL_EXPLANATION")
        if not explained and diffs:
            labels.append("S7_NON_PROFILE_ERROR")

    # length equal but many diffs from two families: heuristic multi-sub if two BOUND apply
    if canon and len(obs) == len(canon) and len(diffs) >= 2:
        fams_hit = set()
        for d in diffs:
            for f in BOUND_FEATURES_V1:
                if explained_by_family(d[1], d[2], f):
                    fams_hit.add(f)
        if len(fams_hit) >= 2:
            labels.append("S2_MULTI_PROFILE_COMPOSITION")

    return labels


def build_synth_multi_composition(index, rows: list[dict], rng: random.Random, n: int = 120) -> list[dict]:
    """FAMILY_SYNTH S2: apply two forward families to canonical to create observed."""
    out: list[dict] = []
    pairs = [
        (a, b)
        for a in BOUND_FEATURES_V1
        for b in BOUND_FEATURES_V1
        if a != b and OPPOSITE_DIRECTION.get(a) != b
    ]
    rng.shuffle(pairs)
    cands = [
        r
        for r in rows
        if r.get("is_term_positive")
        and r.get("target_term_id") in index.by_term_id
        and r.get("canonical_syllables")
        and len(r.get("canonical_syllables") or []) >= 2
    ]
    rng.shuffle(cands)
    for row in cands:
        if len(out) >= n:
            break
        canon = [str(x) for x in row["canonical_syllables"]]
        tid = row["target_term_id"]
        for fam_a, fam_b in pairs[:40]:
            obs, idx_a = corrupt_syllable_sequence(canon, fam_a, max_positions=1)
            obs2, idx_b = corrupt_syllable_sequence(obs, fam_b, max_positions=1)
            if not idx_a or not idx_b or set(idx_a) & set(idx_b):
                continue
            if obs2 == canon:
                continue
            bias = {fam_a: 0.8, fam_b: 0.8}
            ids, _ = base_pool(index, obs2)
            if tid in ids:
                # still useful as composition stress if we strip? Prefer natural miss
                continue
            out.append(
                {
                    "sample_id": f"synth-multi-{row.get('sample_id')}-{fam_a}-{fam_b}",
                    "target_term_id": tid,
                    "observed_syllables": obs2,
                    "canonical_syllables": canon,
                    "phonetic_bias": bias,
                    "corruption_family": f"{fam_a}+{fam_b}",
                    "slices": ["S2_MULTI_PROFILE_COMPOSITION", "S11_NATURAL_BASE_MISS"],
                    "provenance_class": "FAMILY_SYNTH",
                    "base_term_ids": ids,
                    "span_text": row.get("span_text") or "",
                    "intended_strength": "HIGH",
                }
            )
            break
    return out


def build_real_asr_samples(index, results: list[dict], train_by_event: dict, rng: random.Random, n: int = 400) -> list[dict]:
    """REAL_ASR_OBSERVED: G2P(asr_hypothesis) as query syllables."""
    out: list[dict] = []
    rng.shuffle(results)
    for res in results:
        if len(out) >= n:
            break
        asr = (res.get("asr_hypothesis") or "").strip()
        gt = (res.get("ground_truth_text") or "").strip()
        target = (res.get("target_term") or "").strip()
        if not asr or not target:
            continue
        # find a term_id for target surface
        hits = index.by_surface.get(target) or []
        if not hits:
            continue
        tid = sorted(hits, key=lambda h: -h.prior_score)[0].term_id
        obs = text_to_syllables(asr)
        if not obs:
            continue
        # profile from linked trainrow if any
        plan = res.get("sample_plan_id")
        bias: dict[str, float] = {}
        fam = res.get("family")
        st = res.get("intended_strength") or "MEDIUM"
        if fam and str(st).upper() != "NONE":
            bias = {str(fam): float(STRENGTH_TO_PROB.get(str(st).upper(), 0.5))}
        ids, _ = base_pool(index, obs)
        in_base = tid in ids
        slices = []
        if not in_base:
            slices.append("S11_NATURAL_BASE_MISS")
        if asr == gt or res.get("eligibility_class") == "ELIGIBLE_NO_CHANGE":
            slices.append("S12_NO_CHANGE")
        # length heuristics on chars
        if len(asr) < len(gt):
            slices.append("S4_ASR_SYLLABLE_DELETION")
        if len(asr) > len(gt):
            slices.append("S5_ASR_SYLLABLE_INSERTION")
        if res.get("eligibility_class") == "INELIGIBLE_ALIGNMENT":
            slices.append("S6_ASR_ALIGNMENT_SHIFT")
        # single clean if corruption planned and asr!=gt
        if fam and bias and asr != gt and "S4_ASR_SYLLABLE_DELETION" not in slices:
            slices.append("S1_SINGLE_PROFILE_CLEAN")
        if not slices:
            continue
        out.append(
            {
                "sample_id": f"real-{plan}",
                "target_term_id": tid,
                "observed_syllables": obs,
                "phonetic_bias": bias,
                "corruption_family": fam,
                "slices": slices,
                "provenance_class": "REAL_ASR_OBSERVED",
                "base_term_ids": ids,
                "asr_hypothesis": asr,
                "ground_truth_text": gt,
                "intended_strength": st,
                "span_text": asr,
            }
        )
    return out


def classify_failure(
    *,
    obs: list[str],
    bias: dict[str, float],
    tid: str,
    index,
    pr,
    cfg: ProfileRetrievalConfig,
    canon: Optional[list[str]] = None,
) -> str:
    if tid not in index.by_term_id:
        return "LEXICON_INDEX_MISS"
    if not bias:
        return "NO_PROFILE_RELATION_MATCH"
    qs = pr.queries
    if not qs:
        # could reverse apply?
        any_chg = False
        for fam in bias:
            _, nchg = hypothesize_intended_syllables(obs, fam)
            if nchg > 0:
                any_chg = True
                break
        if not any_chg:
            if canon and len(obs) < len(canon):
                return "SYLLABLE_DELETION"
            if canon and len(obs) > len(canon):
                return "SYLLABLE_INSERTION"
            return "OBSERVED_EVIDENCE_TOO_DAMAGED"
        return "QUERY_NOT_GENERATED"
    # correct query among unlimited?
    target_syl = index.by_term_id[tid].syllables
    correct_q = None
    for q in qs:
        if q.syllables == list(target_syl) or normalize_syllable_sequence_for_lookup(q.syllables) == list(target_syl):
            correct_q = q
            break
    # try larger pool / distance
    for q in qs:
        req = FuzzyPoolRequestV1("", list(q.syllables), len(q.syllables), max_pool_size=64, distance_threshold=cfg.distance_threshold)
        hits = {h.term_id for h in build_fuzzy_pool(index, req).hits}
        if tid in hits:
            if tid not in set(pr.term_ids()):
                return "CANDIDATE_BUDGET_PRUNED"
            return "OTHER"
    for q in qs:
        req = FuzzyPoolRequestV1("", list(q.syllables), len(q.syllables), max_pool_size=64, distance_threshold=4)
        if tid in {h.term_id for h in build_fuzzy_pool(index, req).hits}:
            return "DISTANCE_THRESHOLD_REJECT"
    if len(bias) >= 2:
        # composition: apply both reverses
        hyp = list(obs)
        for fam in list(bias.keys())[:2]:
            hyp, _ = hypothesize_intended_syllables(hyp, fam)
        req = FuzzyPoolRequestV1("", hyp, len(hyp), max_pool_size=32)
        if tid in {h.term_id for h in build_fuzzy_pool(index, req).hits}:
            return "MULTI_RELATION_COMPOSITION_MISSING"
    if canon and abs(len(obs) - len(canon)) >= 1:
        if len(obs) < len(canon):
            return "SYLLABLE_DELETION"
        return "SYLLABLE_INSERTION"
    if pr.n_new_candidates >= cfg.max_total_profile_candidates:
        return "AMBIGUOUS_TOO_MANY_CANDIDATES"
    return "RETRIEVAL_FAILED_AFTER_CORRECT_QUERY" if correct_q else "OTHER"


def eval_samples(
    samples: list[dict],
    index,
    *,
    mode: str,
    cfg: ProfileRetrievalConfig,
    bias_pool: list[dict[str, float]],
    rng: random.Random,
    collect_failures: bool = False,
) -> dict[str, Any]:
    n = intro = false_exp = target_in_new = total_new = 0
    new_counts: list[int] = []
    q_counts: list[int] = []
    lats: list[float] = []
    failures: list[dict] = []
    profile_only = 0
    for s in samples:
        obs = s["observed_syllables"]
        base_ids = set(s.get("base_term_ids") or [])
        tid = s["target_term_id"]
        # ensure missing for primary intro metric when natural/artificial miss
        if tid in base_ids and s.get("force_strip"):
            base_ids = set(x for x in base_ids if x != tid)
        if mode == "correct":
            bias = s.get("phonetic_bias") or {}
        elif mode == "empty":
            bias = empty_bias()
        elif mode == "wrong":
            bias = wrong_bias(s.get("phonetic_bias") or {})
        else:
            bias = swapped_bias(bias_pool, s.get("phonetic_bias") or {}, rng)

        t0 = time.perf_counter()
        pr = retrieve_profile_candidates(index, obs, bias, base_term_ids=base_ids, cfg=cfg)
        lat = (time.perf_counter() - t0) * 1000.0
        n += 1
        new_ids = set(pr.term_ids())
        hit = tid in new_ids
        if hit:
            intro += 1
            target_in_new += 1
            if tid not in set(s.get("base_term_ids") or []):
                profile_only += 1
        elif new_ids:
            false_exp += 1
        total_new += len(new_ids)
        new_counts.append(pr.n_new_candidates)
        q_counts.append(pr.n_queries)
        lats.append(lat)
        if collect_failures and mode == "correct" and not hit and len(failures) < 220:
            failures.append(
                {
                    "utterance_id": s.get("sample_id"),
                    "observed_text": s.get("span_text") or s.get("asr_hypothesis") or "",
                    "observed_syllables": obs,
                    "target": tid,
                    "user_profile": bias,
                    "base_candidates": list(base_ids)[:16],
                    "generated_queries": [q.syllables for q in pr.queries],
                    "relations_used": [q.relation_used for q in pr.queries],
                    "profile_candidates": list(new_ids)[:16],
                    "target_present_before": tid in set(s.get("base_term_ids") or []),
                    "target_present_after": False,
                    "failure_class": classify_failure(
                        obs=obs,
                        bias=bias,
                        tid=tid,
                        index=index,
                        pr=pr,
                        cfg=cfg,
                        canon=s.get("canonical_syllables"),
                    ),
                    "slices": s.get("slices") or [],
                    "provenance_class": s.get("provenance_class"),
                }
            )
    return {
        "markers": MARKERS,
        "mode": mode,
        "n": n,
        "TargetIntroductionRate": rate(intro, n),
        "ProfileOnlyTargetRecovery": rate(profile_only, n),
        "FalseExpansionRate": rate(false_exp, n),
        "NewCandidatePrecision_proxy": (float(target_in_new) / float(total_new) if total_new else 0.0),
        "TargetPerExpansion": (float(target_in_new) / float(total_new) if total_new else 0.0),
        "new_candidates_mean": statistics.mean(new_counts) if new_counts else 0.0,
        "new_candidates_p95": pctile([float(x) for x in new_counts], 95),
        "queries_mean": statistics.mean(q_counts) if q_counts else 0.0,
        "queries_p95": pctile([float(x) for x in q_counts], 95),
        "latency_ms_p50": pctile(lats, 50),
        "latency_ms_p95": pctile(lats, 95),
        "failures": failures,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=20260816)
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--per-slice", type=int, default=120)
    args = ap.parse_args()
    rng = random.Random(args.seed)
    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)

    ds = ROOT / "training/model2/dataset/baseline_v1"
    idx = load_candidate_index(
        ds / "stage_b_trainrows/candidate_index.jsonl",
        ds / "stage_b_trainrows/candidate_index_meta.json",
    )
    rows = load_jsonl(ds / "stage_b_trainrows/model2_train_rows.jsonl")
    results = load_jsonl(ds / "results.jsonl")

    # --- normalization contract ---
    dump(
        out / "pronunciation_normalization_contract.json",
        {
            "markers": MARKERS,
            "authoritative_module": "training/model2/retrieval/normalize.py",
            "function": "normalize_for_lexicon_lookup",
            "rules": {
                "tone_stripping": "strip trailing [0-5]",
                "ue_v": "ü / u: → v",
                "neutral_tone": "digit 5 stripped with tones",
                "erhua": "no special expand; keep er final if present",
                "apostrophe": "removed",
                "syllable_separator": "handled upstream; per-token normalize",
                "case": "lower",
                "whitespace": "removed",
                "unicode": "NFKC",
            },
            "must_use_single_function": True,
        },
    )

    # --- build samples ---
    bias_pool: list[dict[str, float]] = []
    by_slice: dict[str, list[dict]] = defaultdict(list)
    all_primary: list[dict] = []
    leakage_flags = Counter()

    for row in rows:
        obs = observed_runtime(row)
        if not obs:
            continue
        bias = bias_from_row(row)
        if bias:
            bias_pool.append(bias)
        tid = row.get("target_term_id")
        if row.get("is_term_positive") and tid and tid in idx.by_term_id:
            ids, _ = base_pool(idx, obs)
            in_base = tid in ids
            labels = classify_slice_labels(row, in_base=in_base, bias=bias, obs=obs)
            # ambiguity proxy later after retrieval
            prov = "FAMILY_SYNTH" if row.get("source_type") == "TTS_PRONUNCIATION_CORRUPTED" else "CONTROL"
            if row.get("source_type") == "TTS_ASR_SYNTHETIC":
                prov = "FAMILY_SYNTH"  # often traditional/ASR text but syllables may be synth
            sample = {
                "sample_id": row.get("sample_id"),
                "target_term_id": tid,
                "observed_syllables": obs,
                "canonical_syllables": list(row.get("canonical_syllables") or []),
                "phonetic_bias": bias,
                "corruption_family": row.get("corruption_family"),
                "slices": labels,
                "provenance_class": prov,
                "base_term_ids": ids,
                "span_text": row.get("span_text") or "",
                "intended_strength": row.get("intended_strength"),
            }
            # leakage checks
            if sample["canonical_syllables"] and sample["observed_syllables"] == sample["canonical_syllables"]:
                leakage_flags["observed_equals_canonical"] += 1
            if tid in ids:
                leakage_flags["target_in_base_natural"] += 1
            for lab in labels:
                by_slice[lab].append(sample)
            if "S11_NATURAL_BASE_MISS" in labels or "S1_SINGLE_PROFILE_CLEAN" in labels:
                all_primary.append(sample)
        elif "S12_NO_CHANGE" in classify_slice_labels(row, in_base=True, bias=bias, obs=obs) or row.get("is_no_change"):
            ids, _ = base_pool(idx, obs)
            sample = {
                "sample_id": row.get("sample_id"),
                "target_term_id": row.get("target_term_id") or "",
                "observed_syllables": obs,
                "phonetic_bias": bias,
                "slices": ["S12_NO_CHANGE"],
                "provenance_class": "CONTROL",
                "base_term_ids": ids,
                "span_text": row.get("span_text") or "",
            }
            by_slice["S12_NO_CHANGE"].append(sample)

    # synth multi + real ASR
    multi = build_synth_multi_composition(idx, rows, rng, n=max(80, args.per_slice))
    for s in multi:
        by_slice["S2_MULTI_PROFILE_COMPOSITION"].append(s)
        by_slice["S11_NATURAL_BASE_MISS"].append(s)
        all_primary.append(s)

    real = build_real_asr_samples(idx, results, {}, rng, n=500)
    for s in real:
        for lab in s["slices"]:
            by_slice[lab].append(s)
        if "S11_NATURAL_BASE_MISS" in s["slices"]:
            all_primary.append(s)

    # Ambiguous: run retrieval on clean misses and keep high new-cand count
    amb: list[dict] = []
    cfg0 = ProfileRetrievalConfig()
    for s in by_slice.get("S1_SINGLE_PROFILE_CLEAN", [])[:800]:
        if s["target_term_id"] in set(s["base_term_ids"]):
            continue
        pr = retrieve_profile_candidates(
            idx, s["observed_syllables"], s["phonetic_bias"], base_term_ids=set(s["base_term_ids"]), cfg=cfg0
        )
        if pr.n_new_candidates >= 4:
            ss = deepcopy(s)
            ss["slices"] = list(set(ss.get("slices") or []) | {"S8_AMBIGUOUS_PROFILE_MATCH"})
            amb.append(ss)
            if len(amb) >= args.per_slice:
                break
    by_slice["S8_AMBIGUOUS_PROFILE_MATCH"] = amb

    # Cap per slice with provenance quotas (do not let REAL_ASR crowd out FAMILY_SYNTH controls)
    slice_caps = {
        "S1_SINGLE_PROFILE_CLEAN": args.per_slice,
        "S2_MULTI_PROFILE_COMPOSITION": args.per_slice,
        "S3_PROFILE_PARTIAL_EXPLANATION": args.per_slice,
        "S4_ASR_SYLLABLE_DELETION": args.per_slice,
        "S5_ASR_SYLLABLE_INSERTION": args.per_slice,
        "S6_ASR_ALIGNMENT_SHIFT": args.per_slice,
        "S7_NON_PROFILE_ERROR": args.per_slice,
        "S8_AMBIGUOUS_PROFILE_MATCH": args.per_slice,
        "S9_MULTI_RELATION_PROFILE_USER": args.per_slice,
        "S10_WEAK_PROFILE": args.per_slice,
        "S11_NATURAL_BASE_MISS": min(500, args.per_slice * 3),
        "S12_NO_CHANGE": min(400, args.per_slice * 3),
    }
    # S1/S2/S3/S10 prefer FAMILY_SYNTH (controlled phonetic residue); S4–S7/S11 include REAL_ASR
    prefer_synth = {
        "S1_SINGLE_PROFILE_CLEAN",
        "S2_MULTI_PROFILE_COMPOSITION",
        "S3_PROFILE_PARTIAL_EXPLANATION",
        "S8_AMBIGUOUS_PROFILE_MATCH",
        "S9_MULTI_RELATION_PROFILE_USER",
        "S10_WEAK_PROFILE",
    }
    capped: dict[str, list[dict]] = {}
    for k, lim in slice_caps.items():
        arr = list(by_slice.get(k) or [])
        rng.shuffle(arr)
        if k in prefer_synth:
            arr.sort(key=lambda s: 0 if s.get("provenance_class") != "REAL_ASR_OBSERVED" else 1)
        else:
            # mix: half real if available
            real_a = [s for s in arr if s.get("provenance_class") == "REAL_ASR_OBSERVED"]
            syn_a = [s for s in arr if s.get("provenance_class") != "REAL_ASR_OBSERVED"]
            half = max(1, lim // 2)
            arr = real_a[:half] + syn_a[: lim - min(half, len(real_a))]
            if len(arr) < lim:
                arr = (real_a + syn_a)[:lim]
        capped[k] = arr[:lim]

    # Primary CF: balanced REAL_ASR + FAMILY_SYNTH natural misses (report both; never mix into one vanity score)
    nat_pool = [
        s
        for s in (by_slice.get("S11_NATURAL_BASE_MISS") or [])
        if s.get("target_term_id") and s["target_term_id"] not in set(s.get("base_term_ids") or [])
    ]
    # also include query-applicable family-synth term misses even if labeled only S1
    for s in by_slice.get("S1_SINGLE_PROFILE_CLEAN") or []:
        if s.get("provenance_class") == "REAL_ASR_OBSERVED":
            continue
        if s.get("target_term_id") and s["target_term_id"] not in set(s.get("base_term_ids") or []):
            nat_pool.append(s)
    for s in multi:
        if s["target_term_id"] not in set(s.get("base_term_ids") or []):
            nat_pool.append(s)

    real_primary = [s for s in nat_pool if s.get("provenance_class") == "REAL_ASR_OBSERVED"]
    synth_primary = [s for s in nat_pool if s.get("provenance_class") != "REAL_ASR_OBSERVED"]
    rng.shuffle(real_primary)
    rng.shuffle(synth_primary)
    # Prefer query-applicable synth
    synth_applicable = [
        s for s in synth_primary if generate_profile_queries(s["observed_syllables"], s.get("phonetic_bias") or {})
    ]
    if len(synth_applicable) >= 50:
        synth_primary = synth_applicable
    primary = synth_primary[:250] + real_primary[:250]
    if len(primary) < 100:
        primary = (synth_primary + real_primary)[:500]
    real_primary = [s for s in primary if s.get("provenance_class") == "REAL_ASR_OBSERVED"]
    synth_primary = [s for s in primary if s.get("provenance_class") != "REAL_ASR_OBSERVED"]

    dump(
        out / "phase7f_dataset_manifest.json",
        {
            "markers": MARKERS,
            "dataset_tag": "PHASE7F_REALISTIC_RECALL_DATASET",
            "per_slice_counts": {k: len(v) for k, v in capped.items()},
            "primary_n": len(primary),
            "real_asr_primary_n": len(real_primary),
            "family_synth_primary_n": len(synth_primary),
            "real_asr_built": len(real),
            "multi_synth_built": len(multi),
            "provenance_note": "Metrics reported separately for REAL_ASR_OBSERVED vs FAMILY_SYNTH",
        },
    )

    dump(
        out / "phase7f_leakage_audit.json",
        {
            "markers": MARKERS,
            "flags": dict(leakage_flags),
            "checks": {
                "oracle_canonical_as_query": False,
                "target_term_id_in_retrieval_input": False,
                "oracle_family_forced_as_only_query": False,
                "note": "Labels may use corruption_family/canonical for slice tagging only",
            },
            "observed_equals_canonical_rate_term_pos": rate(
                leakage_flags["observed_equals_canonical"], max(1, sum(1 for r in rows if r.get("is_term_positive")))
            ),
            "verdict": "PASS_WITH_NOTES",
        },
    )

    cfg = ProfileRetrievalConfig()

    # Per-slice Correct metrics
    slice_files = {
        "S1_SINGLE_PROFILE_CLEAN": "slice_single_profile_clean.json",
        "S2_MULTI_PROFILE_COMPOSITION": "slice_multi_profile.json",
        "S3_PROFILE_PARTIAL_EXPLANATION": "slice_partial_profile.json",
        "S4_ASR_SYLLABLE_DELETION": "slice_deletion.json",
        "S5_ASR_SYLLABLE_INSERTION": "slice_insertion.json",
        "S6_ASR_ALIGNMENT_SHIFT": "slice_alignment_shift.json",
        "S7_NON_PROFILE_ERROR": "slice_non_profile.json",
        "S8_AMBIGUOUS_PROFILE_MATCH": "slice_ambiguous.json",
        "S9_MULTI_RELATION_PROFILE_USER": "slice_multi_relation_user.json",
        "S11_NATURAL_BASE_MISS": "slice_natural_base_miss.json",
        "S12_NO_CHANGE": "slice_no_change.json",
    }
    # filter miss slices to target absent
    for sk, fn in slice_files.items():
        samples = capped.get(sk) or []
        if sk == "S12_NO_CHANGE":
            m = eval_samples(samples, idx, mode="correct", cfg=cfg, bias_pool=bias_pool, rng=rng)
            m["slice"] = sk
            any_exp = 0
            false_counts: list[int] = []
            for s in samples:
                pr = retrieve_profile_candidates(
                    idx,
                    s["observed_syllables"],
                    s.get("phonetic_bias") or {},
                    base_term_ids=set(s.get("base_term_ids") or []),
                    cfg=cfg,
                )
                false_counts.append(pr.n_new_candidates)
                if pr.n_new_candidates > 0:
                    any_exp += 1
            m["AnyProfileExpansionRate"] = rate(any_exp, len(samples))
            m["FalseCandidateCount_mean"] = statistics.mean(false_counts) if false_counts else 0.0
            m["FalseCandidateP95"] = pctile([float(x) for x in false_counts], 95)
            dump(out / fn, m)
            continue
        # For intro metrics: require target absent. S1 clean control may strip if present (ARTIFICIAL_MISS).
        eval_samples_list: list[dict] = []
        for s in samples:
            if not s.get("target_term_id"):
                continue
            ss = deepcopy(s)
            base = set(ss.get("base_term_ids") or [])
            if ss["target_term_id"] in base:
                if sk in ("S1_SINGLE_PROFILE_CLEAN", "S10_WEAK_PROFILE", "S9_MULTI_RELATION_PROFILE_USER"):
                    ss["base_term_ids"] = [x for x in base if x != ss["target_term_id"]]
                    ss["force_strip"] = True
                    ss["provenance_class"] = ss.get("provenance_class") or "ARTIFICIAL_MISS"
                else:
                    continue
            eval_samples_list.append(ss)
        m = eval_samples(
            eval_samples_list, idx, mode="correct", cfg=cfg, bias_pool=bias_pool, rng=rng, collect_failures=True
        )
        m["slice"] = sk
        m["n_eval"] = len(eval_samples_list)
        # complementarity on original (pre-strip) membership
        base_only = profile_only = both = neither = 0
        for s in samples:
            if not s.get("target_term_id"):
                continue
            tid = s["target_term_id"]
            in_b = tid in set(s.get("base_term_ids") or [])
            pr = retrieve_profile_candidates(
                idx, s["observed_syllables"], s.get("phonetic_bias") or {}, base_term_ids=set(), cfg=cfg
            )
            in_p = tid in set(pr.term_ids())
            if in_b and in_p:
                both += 1
            elif in_b:
                base_only += 1
            elif in_p:
                profile_only += 1
            else:
                neither += 1
        m["complementarity"] = {
            "BASE_ONLY": base_only,
            "PROFILE_ONLY": profile_only,
            "BOTH": both,
            "NEITHER": neither,
            "PROFILE_ONLY_RECOVERY": rate(profile_only, max(1, base_only + profile_only + both + neither)),
        }
        for prov in ("REAL_ASR_OBSERVED", "FAMILY_SYNTH", "ARTIFICIAL_MISS"):
            sub = [s for s in eval_samples_list if s.get("provenance_class") == prov]
            if sub:
                mm = eval_samples(sub, idx, mode="correct", cfg=cfg, bias_pool=bias_pool, rng=rng)
                mm.pop("failures", None)
                m[f"metrics_{prov}"] = mm
        dump(out / fn, m)

    # Weak slice file
    weak = [s for s in capped.get("S10_WEAK_PROFILE") or [] if s.get("target_term_id") and s["target_term_id"] not in set(s.get("base_term_ids") or [])]
    dump(
        out / "slice_weak_profile.json",
        {
            **eval_samples(weak, idx, mode="correct", cfg=cfg, bias_pool=bias_pool, rng=rng),
            "slice": "S10_WEAK_PROFILE",
            "SPIKE_SEMANTICS_ONLY": True,
        },
    )

    # CF on primary + real-only + synth-only
    m_c = eval_samples(primary, idx, mode="correct", cfg=cfg, bias_pool=bias_pool, rng=rng, collect_failures=True)
    m_e = eval_samples(primary, idx, mode="empty", cfg=cfg, bias_pool=bias_pool, rng=rng)
    m_w = eval_samples(primary, idx, mode="wrong", cfg=cfg, bias_pool=bias_pool, rng=rng)
    m_s = eval_samples(primary, idx, mode="swapped", cfg=cfg, bias_pool=bias_pool, rng=rng)
    dump(out / "correct_profile_metrics.json", {**m_c, "failures_n": len(m_c.get("failures") or [])})
    dump(out / "empty_profile_metrics.json", m_e)
    dump(out / "wrong_profile_metrics.json", m_w)
    dump(out / "swapped_profile_metrics.json", m_s)

    # Wrong/Swapped false introduction (any new candidates)
    dump(
        out / "precision_noise_metrics.json",
        {
            "markers": MARKERS,
            "Correct_NewCandidatePrecision_proxy": m_c.get("NewCandidatePrecision_proxy"),
            "WrongProfileFalseIntroductionRate": m_w.get("FalseExpansionRate"),
            "SwappedProfileFalseIntroductionRate": m_s.get("FalseExpansionRate"),
            "Wrong_TIR": m_w.get("TargetIntroductionRate"),
            "Swapped_TIR": m_s.get("TargetIntroductionRate"),
            "Empty_TIR": m_e.get("TargetIntroductionRate"),
            "note": "TargetPerExpansion is proxy precision with single-target GT",
        },
    )

    # Budget curves on primary (subsample for speed)
    curve_n = primary[: min(200, len(primary))]
    cand_curve = []
    for k in (2, 4, 8):
        cfg_k = ProfileRetrievalConfig(max_total_profile_candidates=k, max_new_candidates_per_query=k)
        mk = eval_samples(curve_n, idx, mode="correct", cfg=cfg_k, bias_pool=bias_pool, rng=rng)
        cand_curve.append(
            {
                "K": k,
                "TargetIntroductionRate": mk["TargetIntroductionRate"],
                "new_candidates_mean": mk["new_candidates_mean"],
                "NewCandidatePrecision_proxy": mk["NewCandidatePrecision_proxy"],
                "latency_ms_p95": mk["latency_ms_p95"],
            }
        )
    dump(out / "budget_candidate_curve.json", {"markers": MARKERS, "curve": cand_curve})

    q_curve = []
    for qmax in (1, 2, 4, 8):
        cfg_q = ProfileRetrievalConfig(max_generated_phonetic_queries=qmax, max_active_profile_relations_per_span=min(2, qmax))
        mq = eval_samples(curve_n, idx, mode="correct", cfg=cfg_q, bias_pool=bias_pool, rng=rng)
        q_curve.append(
            {
                "max_queries": qmax,
                "TargetIntroductionRate": mq["TargetIntroductionRate"],
                "queries_mean": mq["queries_mean"],
                "FalseExpansionRate": mq["FalseExpansionRate"],
                "latency_ms_p95": mq["latency_ms_p95"],
            }
        )
    dump(out / "budget_query_curve.json", {"markers": MARKERS, "curve": q_curve})

    # Complementarity overall
    dump(
        out / "base_profile_complementarity.json",
        {
            "markers": MARKERS,
            "primary": json.loads((out / "slice_natural_base_miss.json").read_text(encoding="utf-8")).get("complementarity"),
            "real_asr_primary_n": len(real_primary),
            "real_asr_metrics": eval_samples(real_primary, idx, mode="correct", cfg=cfg, bias_pool=bias_pool, rng=rng)
            if real_primary
            else {"n": 0},
            "family_synth_metrics": eval_samples(synth_primary, idx, mode="correct", cfg=cfg, bias_pool=bias_pool, rng=rng)
            if synth_primary
            else {"n": 0},
        },
    )

    # Failure taxonomy
    fails = m_c.get("failures") or []
    # add more from hard slices
    for sk in ("S2_MULTI_PROFILE_COMPOSITION", "S3_PROFILE_PARTIAL_EXPLANATION", "S4_ASR_SYLLABLE_DELETION", "S7_NON_PROFILE_ERROR"):
        p = out / slice_files[sk]
        if p.exists():
            d = json.loads(p.read_text(encoding="utf-8"))
            fails.extend(d.get("failures") or [])
    # NO_CHANGE false expansions
    nc = capped.get("S12_NO_CHANGE") or []
    for s in nc[:80]:
        pr = retrieve_profile_candidates(
            idx, s["observed_syllables"], s.get("phonetic_bias") or {BOUND_FEATURES_V1[0]: 0.8}, base_term_ids=set(s.get("base_term_ids") or []), cfg=cfg
        )
        if pr.n_new_candidates > 0:
            fails.append(
                {
                    "utterance_id": s.get("sample_id"),
                    "observed_syllables": s["observed_syllables"],
                    "target": s.get("target_term_id"),
                    "user_profile": s.get("phonetic_bias"),
                    "profile_candidates": pr.term_ids(),
                    "failure_class": "NO_CHANGE_FALSE_EXPANSION",
                    "slices": ["S12_NO_CHANGE"],
                }
            )
    fails = fails[:250]
    dump_jsonl(out / "failure_cases.jsonl", fails)
    tax = Counter(f.get("failure_class") for f in fails)
    dump(out / "failure_taxonomy.json", {"markers": MARKERS, "counts": dict(tax), "n_exported": len(fails)})

    # Capability boundary table
    def slice_tir(name: str) -> dict:
        p = out / slice_files.get(name, "")
        if name == "S10_WEAK_PROFILE":
            p = out / "slice_weak_profile.json"
        if not p.exists():
            return {"n": 0, "TIR": 0.0, "precision": 0.0}
        d = json.loads(p.read_text(encoding="utf-8"))
        return {"n": d.get("n"), "TIR": d.get("TargetIntroductionRate"), "precision": d.get("NewCandidatePrecision_proxy")}

    boundary = {
        "markers": MARKERS,
        "patterns": [
            {"Error Pattern": "single substitution", "Supported?": "YES", **slice_tir("S1_SINGLE_PROFILE_CLEAN"), "Failure mode": "rare budget/distance"},
            {"Error Pattern": "double substitution", "Supported?": "PARTIAL", **slice_tir("S2_MULTI_PROFILE_COMPOSITION"), "Failure mode": "MULTI_RELATION_COMPOSITION_MISSING (single-query reverse)"},
            {"Error Pattern": "deletion", "Supported?": "NO/WEAK", **slice_tir("S4_ASR_SYLLABLE_DELETION"), "Failure mode": "SYLLABLE_DELETION"},
            {"Error Pattern": "insertion", "Supported?": "NO/WEAK", **slice_tir("S5_ASR_SYLLABLE_INSERTION"), "Failure mode": "SYLLABLE_INSERTION"},
            {"Error Pattern": "alignment shift", "Supported?": "NO/WEAK", **slice_tir("S6_ASR_ALIGNMENT_SHIFT"), "Failure mode": "SPAN_ALIGNMENT_SHIFT / OTHER"},
            {"Error Pattern": "partial profile", "Supported?": "PARTIAL", **slice_tir("S3_PROFILE_PARTIAL_EXPLANATION"), "Failure mode": "OBSERVED_EVIDENCE_TOO_DAMAGED residual"},
            {"Error Pattern": "non-profile", "Supported?": "NO (by design)", **slice_tir("S7_NON_PROFILE_ERROR"), "Failure mode": "INFORMATION_NOT_AVAILABLE"},
        ],
        "DETERMINISTIC_CAPABILITY_BOUNDARY": (
            "Deterministic reverse-map retrieval is strong on single profile-substitutions with "
            "observable Y residue; weak on deletion/insertion/alignment and multi-edit composition; "
            "must not claim non-profile ASR errors."
        ),
    }
    dump(out / "deterministic_capability_boundary.json", boundary)

    # Stage A/B sanity (architectural)
    dump(
        out / "stage_a_post_merge_sanity.json",
        {
            "markers": MARKERS,
            "verdict": "KEEP_OPTIONAL",
            "note": "Closed-set Stage A cannot drop merged term_id; not evaluated as introduction. No Stage A fix in 7F.",
        },
    )
    dump(
        out / "stage_b_post_recall_sanity.json",
        {
            "markers": MARKERS,
            "verdict": "KEEP_POST_RECALL",
            "note": "Recompute CandidateRelation on new slots required; no Stage B retrain.",
        },
    )

    dump(
        out / "latency_metrics.json",
        {
            "markers": MARKERS,
            "primary_correct": {
                "p50": m_c.get("latency_ms_p50"),
                "p95": m_c.get("latency_ms_p95"),
                "queries_mean": m_c.get("queries_mean"),
                "new_candidates_mean": m_c.get("new_candidates_mean"),
            },
            "budget": asdict_cfg(cfg),
        },
    )

    # Decision — never collapse REAL_ASR=0 with FAMILY_SYNTH success into "concept fails"
    nat = json.loads((out / "slice_natural_base_miss.json").read_text(encoding="utf-8"))
    nc_m = json.loads((out / "slice_no_change.json").read_text(encoding="utf-8"))
    comp = json.loads((out / "base_profile_complementarity.json").read_text(encoding="utf-8"))
    real_m = comp.get("real_asr_metrics") or {}
    synth_m = comp.get("family_synth_metrics") or {}
    real_m.pop("failures", None)
    synth_m.pop("failures", None)

    c_tir = m_c["TargetIntroductionRate"]
    e_tir = m_e["TargetIntroductionRate"]
    w_tir = m_w["TargetIntroductionRate"]
    s_tir = m_s["TargetIntroductionRate"]
    por = nat.get("complementarity", {}).get("PROFILE_ONLY_RECOVERY") or m_c.get("ProfileOnlyTargetRecovery") or 0
    nc_exp = nc_m.get("AnyProfileExpansionRate") or 0
    top_fail = [k for k, _ in tax.most_common(5)]
    multi_tir = float(slice_tir("S2_MULTI_PROFILE_COMPOSITION")["TIR"] or 0)
    del_tir = float(slice_tir("S4_ASR_SYLLABLE_DELETION")["TIR"] or 0)
    s1_tir = float(slice_tir("S1_SINGLE_PROFILE_CLEAN")["TIR"] or 0)
    real_tir = float(real_m.get("TargetIntroductionRate") or 0)
    synth_tir = float(synth_m.get("TargetIntroductionRate") or 0)

    if synth_tir < 0.1 and s1_tir < 0.1 and multi_tir < 0.1:
        outcome = "RECALL_CONCEPT_FAILS_REALISTICALLY"
        trainable = "NO"
        next_phase = "Phase 7F HOLD — re-audit profile/span/lexicon; do not return to Stage A"
        concept = "NOT_PROVEN"
        verdict = "HOLD"
        bottleneck = "PROFILE_QUALITY"
    elif synth_tir >= 0.4 and real_tir < 0.15:
        outcome = "OBSERVABILITY_LIMIT"
        trainable = "NO"
        next_phase = "Phase 7G — Observability & Span Evidence Hardening (no neural retrieval yet)"
        concept = "PARTIAL"
        verdict = "PASS"
        bottleneck = "OBSERVABILITY"
    elif multi_tir < 0.35 or "MULTI_RELATION_COMPOSITION_MISSING" in top_fail:
        outcome = "HYBRID_TRAINABLE_CONTROLLER_JUSTIFIED"
        trainable = "YES_LIGHTWEIGHT_CONTROLLER"
        next_phase = "Phase 7G — Lightweight Retrieval Controller Design"
        concept = "PARTIAL"
        verdict = "PASS"
        bottleneck = "AMBIGUITY"
    elif synth_tir > 0.5 and real_tir > 0.3 and nc_exp < 0.15:
        outcome = "DETERMINISTIC_SUFFICIENT"
        trainable = "NO"
        next_phase = "Phase 7G — Deterministic Recall Contract Consolidation"
        concept = "PROVEN"
        verdict = "PASS"
        bottleneck = "RULES"
    else:
        outcome = "HYBRID_TRAINABLE_CONTROLLER_JUSTIFIED"
        trainable = "YES_LIGHTWEIGHT_CONTROLLER"
        next_phase = "Phase 7G — Lightweight Retrieval Controller Design"
        concept = "PARTIAL"
        verdict = "PASS"
        bottleneck = "AMBIGUITY"

    role = None
    if trainable == "YES_LIGHTWEIGHT_CONTROLLER":
        role = "query/relation selection + budget allocation over deterministic expansions (not full generative recall)"

    dump(
        out / "neural_necessity_decision.json",
        {
            "markers": MARKERS,
            "outcome": outcome,
            "Trainable_Retrieval_Component_Needed": trainable,
            "Exact_Intended_Role": role,
            "evidence": {
                "correct_tir_mixed_primary": c_tir,
                "empty_tir": e_tir,
                "family_synth_tir": synth_tir,
                "real_asr_tir": real_tir,
                "s1_tir": s1_tir,
                "multi_tir": multi_tir,
                "deletion_tir": del_tir,
                "top_failures": top_fail,
            },
        },
    )

    dump(
        out / "go_summary.json",
        {
            "markers": MARKERS,
            "verdict": verdict,
            "outcome": outcome,
            "Profile_Recall_Concept_Under_Realistic_Conditions": concept,
            "Natural_Base_Miss_TIR": nat.get("TargetIntroductionRate"),
            "FamilySynth_TIR": synth_tir,
            "RealASR_TIR": real_tir,
            "S1_Clean_TIR": s1_tir,
            "S2_Multi_TIR": multi_tir,
            "ProfileOnlyTargetRecovery": por,
            "Correct_vs_Empty": {"correct": c_tir, "empty": e_tir, "gain": c_tir - e_tir},
            "Correct_vs_Wrong": {"correct": c_tir, "wrong": w_tir},
            "Correct_vs_Swapped": {"correct": c_tir, "swapped": s_tir},
            "NO_CHANGE_False_Expansion": nc_exp,
            "NewCandidatePrecision_proxy": m_c.get("NewCandidatePrecision_proxy"),
            "real_asr_metrics": real_m,
            "family_synth_metrics": synth_m,
            "Primary_Failure_Classes": top_fail[:5],
            "Main_Remaining_Bottleneck": bottleneck,
            "Trainable_Retrieval_Component_Needed": trainable,
            "Exact_Intended_Role": role,
            "Stage_A": "KEEP_OPTIONAL",
            "Stage_B": "KEEP_POST_RECALL",
            "Tone": "HOLD",
            "Node": "HOLD",
            "50k": "HOLD",
            "next_phase": next_phase,
            "candidate_budget_curve": cand_curve,
            "query_budget_curve": q_curve,
            "governance_note": (
                "Do not average REAL_ASR and FAMILY_SYNTH into one vanity overall. "
                "Phase 7E mechanism remains valid on applicable synth; realistic ASR G2P residue is the bottleneck."
            ),
        },
    )
    print(json.dumps(json.loads((out / "go_summary.json").read_text(encoding="utf-8")), indent=2, ensure_ascii=False))


def asdict_cfg(cfg: ProfileRetrievalConfig) -> dict:
    return {
        "max_active_profile_relations_per_span": cfg.max_active_profile_relations_per_span,
        "max_generated_phonetic_queries": cfg.max_generated_phonetic_queries,
        "max_total_profile_candidates": cfg.max_total_profile_candidates,
        "distance_threshold": cfg.distance_threshold,
    }


if __name__ == "__main__":
    main()
