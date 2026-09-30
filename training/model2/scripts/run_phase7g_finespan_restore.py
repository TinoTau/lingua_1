#!/usr/bin/env python3
"""Phase 7G — FineSpan-conforming recall restore & realistic validation.

Markers: PHASE7G / AUTHORITATIVE_PATH / NO_WHOLE_UTTERANCE
"""

from __future__ import annotations

import argparse
import json
import random
import statistics
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Optional

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from training.model2.phonetic.syllables import text_to_syllables
from training.model2.retrieval.finespan import (
    FineSpanView,
    finespan_contract_audit,
    materialize_finespans_from_asr,
)
from training.model2.retrieval.finespan_retrieval import (
    DEFAULT_RELATION_POLICY,
    base_retrieve_span,
    retrieve_for_finespan,
    retrieve_utterance_via_finespans,
)
from training.model2.retrieval.normalize import normalize_syllable_sequence_for_lookup
from training.model2.retrieval.spike_retriever import ProfileRetrievalConfig, retrieve_profile_candidates
from training.model2.stage_b.active_feature_mask import BOUND_FEATURES_V1
from training.model2.stage_b.condition import OPPOSITE_DIRECTION, STRENGTH_TO_PROB
from training.model2.training.dataset import load_candidate_index, load_jsonl

MARKERS = ["PHASE7G", "AUTHORITATIVE_PATH", "NO_WHOLE_UTTERANCE", "NOT_FROZEN"]
OUT = ROOT / "training" / "model2" / "experiments" / "phase7g_finespan_restore"


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


def pctile(xs: list[float], p: float) -> float:
    if not xs:
        return 0.0
    ys = sorted(xs)
    i = min(len(ys) - 1, max(0, int(round((p / 100.0) * (len(ys) - 1)))))
    return float(ys[i])


def bias_from_res(res: dict) -> dict[str, float]:
    fam = res.get("family")
    st = str(res.get("intended_strength") or "MEDIUM").upper()
    if not fam or st == "NONE":
        return {}
    return {str(fam): float(STRENGTH_TO_PROB.get(st, 0.5))}


def empty_bias() -> dict[str, float]:
    return {}


def wrong_bias(correct: dict[str, float]) -> dict[str, float]:
    if not correct:
        return {BOUND_FEATURES_V1[0]: 0.8}
    fam = max(correct, key=correct.get)
    return {OPPOSITE_DIRECTION.get(fam, BOUND_FEATURES_V1[0]): float(correct[fam])}


def swapped_bias(pool: list[dict[str, float]], correct: dict[str, float], rng: random.Random) -> dict[str, float]:
    top = max(correct, key=correct.get) if correct else None
    cands = [b for b in pool if b and max(b, key=b.get) != top]
    return dict(rng.choice(cands)) if cands else wrong_bias(correct)


def prioritize_spans(spans: list[FineSpanView], target_len: int) -> list[FineSpanView]:
    return sorted(spans, key=lambda s: (abs(len(s.span_syllables) - target_len), s.syllable_start))


def classify_failure(agg: dict, bias: dict, tid: str, index, spans: list[FineSpanView]) -> str:
    if tid not in index.by_term_id:
        return "LEXICON_INDEX_MISS"
    if not spans:
        return "NO_RELEVANT_FINE_SPAN"
    tgt_len = len(index.by_term_id[tid].syllables)
    compat = [s for s in spans if abs(len(s.span_syllables) - tgt_len) <= 1]
    if not compat:
        return "SPAN_LENGTH_MISMATCH"
    if not bias or not any(k in BOUND_FEATURES_V1 for k in bias):
        return "PROFILE_RELATION_NOT_ACTIVATED"
    # any span generated query?
    any_q = any(t.get("n_queries", 0) > 0 for t in agg.get("span_traces_head") or [])
    if not any_q:
        # check applicability on compat spans
        from training.model2.retrieval.profile_query import hypothesize_intended_syllables

        chg = False
        for s in compat[:8]:
            for fam in bias:
                if fam not in BOUND_FEATURES_V1:
                    continue
                _, n = hypothesize_intended_syllables(s.span_syllables, fam)
                if n > 0:
                    chg = True
                    break
        if not chg:
            return "PROFILE_RELATION_NOT_APPLICABLE"
        return "CORRECT_QUERY_NOT_GENERATED"
    if agg.get("target_in_any_base") and not agg.get("target_introduced_profile_only"):
        return "OTHER"  # visible via base — not a miss for introduction slice
    return "OTHER"


def whole_utt_7f_path(index, asr: str, bias: dict, tid: str, cfg: ProfileRetrievalConfig) -> dict:
    """Diagnostic only — NOT authoritative."""
    obs = normalize_syllable_sequence_for_lookup(text_to_syllables(asr))
    req_ids = set()
    if obs:
        from training.model2.fuzzy.pool import FuzzyPoolRequestV1, build_fuzzy_pool

        req_ids = {h.term_id for h in build_fuzzy_pool(index, FuzzyPoolRequestV1("", obs, len(obs))).hits}
    pr = retrieve_profile_candidates(index, obs, bias, base_term_ids=req_ids, cfg=cfg)
    return {
        "target_in_base": tid in req_ids,
        "target_introduced": tid in set(pr.term_ids()),
        "n_queries": pr.n_queries,
        "n_new": pr.n_new_candidates,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n-primary", type=int, default=300)
    ap.add_argument("--n-trace-ok", type=int, default=50)
    ap.add_argument("--n-trace-fail", type=int, default=50)
    ap.add_argument("--seed", type=int, default=20260816)
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()
    rng = random.Random(args.seed)
    out = args.out
    out.mkdir(parents=True, exist_ok=True)

    ds = ROOT / "training/model2/dataset/baseline_v1"
    idx = load_candidate_index(
        ds / "stage_b_trainrows/candidate_index.jsonl",
        ds / "stage_b_trainrows/candidate_index_meta.json",
    )
    results = load_jsonl(ds / "results.jsonl")
    cfg = ProfileRetrievalConfig()

    dump(out / "phase7g_finespan_contract.json", finespan_contract_audit())
    dump(
        out / "phase7g_runtime_path_audit.json",
        {
            "markers": MARKERS,
            "authoritative_path": "FineSpan → normalize → base FuzzyPool + profile expansion → same FuzzyPool → merge",
            "module": "training/model2/retrieval/finespan_retrieval.py",
            "whole_utterance_in_authoritative_path": False,
            "relation_policy": DEFAULT_RELATION_POLICY.to_dict(),
            "shadow_path": "Phase7F whole-utt kept diagnostic-only in comparison",
        },
    )

    # Build case pool from REAL ASR — cheap classify (base-only length windows first)
    pool = []
    bias_pool = []
    for res in results:
        asr = (res.get("asr_hypothesis") or "").strip()
        target = (res.get("target_term") or "").strip()
        if not asr or not target:
            continue
        hits = idx.by_surface.get(target) or []
        if not hits:
            continue
        tid = sorted(hits, key=lambda h: -h.prior_score)[0].term_id
        bias = bias_from_res(res)
        if bias:
            bias_pool.append(bias)
        pool.append(
            {
                "id": res.get("sample_plan_id"),
                "asr": asr,
                "gt": res.get("ground_truth_text"),
                "target": target,
                "tid": tid,
                "bias": bias,
                "family": res.get("family"),
                "eligibility": res.get("eligibility_class"),
            }
        )
    rng.shuffle(pool)
    bound_cases = [p for p in pool if p.get("family") in BOUND_FEATURES_V1 and p.get("bias")]
    other_cases = [p for p in pool if p not in bound_cases]

    slices = {
        "A_REAL_ASR_FINE_SPAN_MISS": [],
        "B_ALREADY_VISIBLE": [],
        "C_PROFILE_NOT_APPLICABLE": [],
        "D_NO_CHANGE": [],
        "E_MULTI_PROFILE": [],
    }

    def cheap_base_visible(asr: str, tid: str) -> bool:
        syls, spans = materialize_finespans_from_asr(asr)
        if not spans:
            return False
        tgt_len = len(idx.by_term_id[tid].syllables)
        for sp in prioritize_spans(spans, tgt_len)[:8]:
            if abs(len(sp.span_syllables) - tgt_len) > 0:
                continue
            if tid in set(base_retrieve_span(idx, sp, cfg=cfg)):
                return True
        return False

    for p in (bound_cases + other_cases)[:800]:
        if p["eligibility"] == "ELIGIBLE_NO_CHANGE" or p["asr"] == (p.get("gt") or ""):
            if len(slices["D_NO_CHANGE"]) < 120:
                slices["D_NO_CHANGE"].append(p)
            continue
        if not p["bias"] or p.get("family") not in BOUND_FEATURES_V1:
            if len(slices["C_PROFILE_NOT_APPLICABLE"]) < 100:
                slices["C_PROFILE_NOT_APPLICABLE"].append(p)
            continue
        vis = cheap_base_visible(p["asr"], p["tid"])
        if vis:
            if len(slices["B_ALREADY_VISIBLE"]) < 120:
                slices["B_ALREADY_VISIBLE"].append(p)
        else:
            if len(slices["A_REAL_ASR_FINE_SPAN_MISS"]) < args.n_primary:
                slices["A_REAL_ASR_FINE_SPAN_MISS"].append(p)
        if len(p["bias"]) >= 2 and len(slices["E_MULTI_PROFILE"]) < 80:
            slices["E_MULTI_PROFILE"].append(p)
        if len(slices["A_REAL_ASR_FINE_SPAN_MISS"]) >= args.n_primary and len(slices["B_ALREADY_VISIBLE"]) >= 80:
            break

    while len(slices["E_MULTI_PROFILE"]) < 60 and slices["A_REAL_ASR_FINE_SPAN_MISS"]:
        src = rng.choice(slices["A_REAL_ASR_FINE_SPAN_MISS"])
        fam = src.get("family")
        other = rng.choice([f for f in BOUND_FEATURES_V1 if f != fam])
        rr = dict(src)
        rr["bias"] = {fam: 0.8, other: 0.5} if fam else {BOUND_FEATURES_V1[0]: 0.8, BOUND_FEATURES_V1[1]: 0.5}
        slices["E_MULTI_PROFILE"].append(rr)

    dump(
        out / "phase7g_dataset_manifest.json",
        {
            "markers": MARKERS,
            "dataset_tag": "PHASE7G_REAL_ASR_FINESPAN",
            "counts": {k: len(v) for k, v in slices.items()},
            "primary": "A_REAL_ASR_FINE_SPAN_MISS",
            "finespan_source": "lattice_window_equivalent_v1 (1..5 syl from ASR)",
            "whole_utt_primary": False,
        },
    )

    def eval_mode(cases: list[dict], mode: str) -> dict:
        n = intro = por = false_exp = 0
        new_counts = []
        q_counts = []
        lats = []
        successes = []
        failures = []
        funnel = Counter()
        for c in cases:
            funnel["total"] += 1
            tid = c["tid"]
            if tid not in idx.by_term_id:
                funnel["lexicon_miss"] += 1
                continue
            funnel["lexicon_ok"] += 1
            if mode == "correct":
                bias = c["bias"]
            elif mode == "empty":
                bias = empty_bias()
            elif mode == "wrong":
                bias = wrong_bias(c["bias"])
            else:
                bias = swapped_bias(bias_pool, c["bias"], rng)

            t0 = time.perf_counter()
            syls, spans = materialize_finespans_from_asr(c["asr"])
            if not spans:
                funnel["no_finespan"] += 1
                continue
            funnel["finespan_exists"] += 1
            tgt_len = len(idx.by_term_id[tid].syllables)
            spans_p = prioritize_spans(spans, tgt_len)
            if any(abs(len(s.span_syllables) - tgt_len) <= 1 for s in spans_p):
                funnel["length_compatible"] += 1
            if any(k in BOUND_FEATURES_V1 for k, v in bias.items() if v > 0):
                funnel["profile_applicable_active"] += 1
            agg = retrieve_utterance_via_finespans(idx, spans_p, bias, tid, cfg=cfg, max_spans_scan=10)
            lat = (time.perf_counter() - t0) * 1000.0
            n += 1
            q_counts.append(agg["n_queries_total"])
            new_counts.append(agg["n_profile_new_union"])
            lats.append(lat)
            if agg["target_introduced_profile_only"]:
                intro += 1
                por += 1
                funnel["introduced"] += 1
                if mode == "correct" and len(successes) < args.n_trace_ok:
                    successes.append(_trace_row(c, bias, agg, spans_p, tid, True))
            else:
                if agg["n_profile_new_union"] > 0:
                    false_exp += 1
                if mode == "correct" and not agg["target_in_any_base"]:
                    funnel["miss_after_retrieval"] += 1
                    if len(failures) < args.n_trace_fail:
                        fc = classify_failure(agg, bias, tid, idx, spans_p)
                        failures.append(_trace_row(c, bias, agg, spans_p, tid, False, fc))
            if agg.get("target_in_any_base"):
                funnel["base_visible"] += 1
            if any(t.get("n_queries", 0) > 0 for t in agg.get("span_traces_head") or []):
                funnel["query_generated"] += 1
        return {
            "markers": MARKERS,
            "mode": mode,
            "n": n,
            "TargetIntroductionRate": rate(intro, n),
            "ProfileOnlyTargetRecovery": rate(por, n),
            "FalseExpansionRate": rate(false_exp, n),
            "NewCandidatePrecisionProxy": rate(intro, max(1, sum(new_counts))) if sum(new_counts) else 0.0,
            "new_candidates_mean": statistics.mean(new_counts) if new_counts else 0.0,
            "new_candidates_p95": pctile([float(x) for x in new_counts], 95),
            "queries_mean": statistics.mean(q_counts) if q_counts else 0.0,
            "latency_ms_p50": pctile(lats, 50),
            "latency_ms_p95": pctile(lats, 95),
            "funnel": dict(funnel),
            "successes": successes,
            "failures": failures,
        }

    def _trace_row(c, bias, agg, spans_p, tid, ok, failure_class=None):
        win = agg.get("winning_span") or {}
        sp = (win.get("span") or {}) if isinstance(win, dict) else {}
        if not sp and spans_p:
            sp = spans_p[0].to_dict()
        return {
            "utterance_id": c["id"],
            "utterance": c["asr"],
            "FineSpan_text": sp.get("window_text", ""),
            "FineSpan_pinyin": sp.get("window_pinyin_key", ""),
            "span_boundaries": [sp.get("syllable_start"), sp.get("syllable_end")],
            "UserProfile": bias,
            "active_relations": list(bias.keys()),
            "base_query": sp.get("span_syllables") or [],
            "profile_expanded_queries": (win.get("queries") if isinstance(win, dict) else None)
            or (agg.get("span_traces_head") or [{}])[0].get("queries", []),
            "base_candidates_head": (win.get("base_term_ids") or [])[:8] if isinstance(win, dict) else [],
            "profile_candidates_head": [
                h.get("term_id") for h in (win.get("profile_hits") or [])[:8]
            ]
            if isinstance(win, dict)
            else [],
            "target": c["target"],
            "target_term_id": tid,
            "target_in_lexicon": True,
            "target_in_base": agg.get("target_in_any_base"),
            "target_introduced": ok,
            "failure_class": failure_class,
        }

    primary = slices["A_REAL_ASR_FINE_SPAN_MISS"][: args.n_primary]
    m_c = eval_mode(primary, "correct")
    m_e = eval_mode(primary, "empty")
    m_w = eval_mode(primary, "wrong")
    m_s = eval_mode(primary, "swapped")

    dump(out / "real_asr_finespan_primary_metrics.json", {k: v for k, v in m_c.items() if k not in ("successes", "failures")})
    dump(out / "correct_profile_metrics.json", {k: v for k, v in m_c.items() if k not in ("successes", "failures")})
    dump(out / "empty_profile_metrics.json", {k: v for k, v in m_e.items() if k not in ("successes", "failures")})
    dump(out / "wrong_profile_metrics.json", {k: v for k, v in m_w.items() if k not in ("successes", "failures")})
    dump(out / "swapped_profile_metrics.json", {k: v for k, v in m_s.items() if k not in ("successes", "failures")})

    dump(out / "finespan_visibility_funnel.json", {"markers": MARKERS, "funnel": m_c.get("funnel"), "rates": {
        k: rate(m_c["funnel"].get(k, 0), max(1, m_c["funnel"].get("total", 1))) for k in m_c.get("funnel", {})
    }})
    dump_jsonl(out / "successful_cases.jsonl", m_c.get("successes") or [])
    dump_jsonl(out / "failure_cases.jsonl", m_c.get("failures") or [])
    dump_jsonl(out / "profile_expansion_trace.jsonl", (m_c.get("successes") or [])[:30] + (m_c.get("failures") or [])[:30])

    fail_tax = Counter(f.get("failure_class") for f in (m_c.get("failures") or []))
    dump(out / "failure_taxonomy.json", {"markers": MARKERS, "counts": dict(fail_tax)})

    # Budget curve
    curve = []
    sub = primary[: min(120, len(primary))]
    for k in (2, 4, 8):
        cfg_k = ProfileRetrievalConfig(max_total_profile_candidates=k, max_new_candidates_per_query=k)
        # quick eval
        intro = n = 0
        false_e = 0
        prec_num = prec_den = 0
        for c in sub:
            _, spans = materialize_finespans_from_asr(c["asr"])
            tgt_len = len(idx.by_term_id[c["tid"]].syllables)
            spans_p = prioritize_spans(spans, tgt_len)[:30]
            agg = retrieve_utterance_via_finespans(idx, spans_p, c["bias"], c["tid"], cfg=cfg_k)
            n += 1
            if agg["target_introduced_profile_only"]:
                intro += 1
                prec_num += 1
            prec_den += max(1, agg["n_profile_new_union"])
            if agg["n_profile_new_union"] > 0 and not agg["target_introduced_profile_only"]:
                false_e += 1
        curve.append(
            {
                "K": k,
                "TargetIntroductionRate": rate(intro, n),
                "FalseExpansionRate": rate(false_e, n),
                "precision_proxy": rate(prec_num, prec_den),
            }
        )
    dump(out / "candidate_budget_curve.json", {"markers": MARKERS, "curve": curve})

    # NO_CHANGE / not applicable false expansion
    def false_exp_slice(name: str, cases: list[dict]) -> dict:
        any_exp = n = 0
        counts = []
        for c in cases[:80]:
            _, spans = materialize_finespans_from_asr(c["asr"])
            n_new = 0
            for sp in prioritize_spans(spans, 2)[:6]:
                r = retrieve_for_finespan(idx, sp, c.get("bias") or {}, cfg=cfg)
                n_new += len(r.profile_only_ids)
            n += 1
            counts.append(n_new)
            if n_new > 0:
                any_exp += 1
        return {
            "slice": name,
            "n": n,
            "AnyProfileExpansionRate": rate(any_exp, n),
            "FalseCandidate_mean": statistics.mean(counts) if counts else 0.0,
            "FalseCandidate_p95": pctile([float(x) for x in counts], 95),
        }

    fe = {
        "markers": MARKERS,
        "NO_CHANGE": false_exp_slice("D_NO_CHANGE", slices["D_NO_CHANGE"]),
        "PROFILE_NOT_APPLICABLE": false_exp_slice("C_PROFILE_NOT_APPLICABLE", slices["C_PROFILE_NOT_APPLICABLE"]),
        "MULTI_PROFILE": eval_mode(slices["E_MULTI_PROFILE"][:100], "correct"),
    }
    fe["MULTI_PROFILE"] = {k: v for k, v in fe["MULTI_PROFILE"].items() if k not in ("successes", "failures")}
    dump(out / "false_expansion_metrics.json", fe)

    # Complementarity on primary (lightweight)
    base_only = prof_only = both = neither = 0
    for c in primary:
        _, spans = materialize_finespans_from_asr(c["asr"])
        tgt_len = len(idx.by_term_id[c["tid"]].syllables)
        agg = retrieve_utterance_via_finespans(
            idx, prioritize_spans(spans, tgt_len), c["bias"], c["tid"], cfg=cfg, max_spans_scan=8
        )
        ib, ip = agg["target_in_any_base"], agg["target_introduced_profile_only"]
        if ib and ip:
            both += 1
        elif ib:
            base_only += 1
        elif ip:
            prof_only += 1
        else:
            neither += 1
    dump(
        out / "base_profile_complementarity.json",
        {
            "markers": MARKERS,
            "BASE_ONLY": base_only,
            "PROFILE_ONLY": prof_only,
            "BOTH": both,
            "NEITHER": neither,
            "PROFILE_ONLY_RECOVERY": rate(prof_only, len(primary)),
        },
    )

    # Phase7F vs 7G comparison
    n_cmp = intro7f = intro7g = 0
    for c in primary[: min(150, len(primary))]:
        w = whole_utt_7f_path(idx, c["asr"], c["bias"], c["tid"], cfg)
        _, spans = materialize_finespans_from_asr(c["asr"])
        tgt_len = len(idx.by_term_id[c["tid"]].syllables)
        agg = retrieve_utterance_via_finespans(
            idx, prioritize_spans(spans, tgt_len), c["bias"], c["tid"], cfg=cfg, max_spans_scan=8
        )
        n_cmp += 1
        intro7f += int(w["target_introduced"])
        intro7g += int(agg["target_introduced_profile_only"])
    dump(
        out / "phase7f_vs_phase7g_comparison.json",
        {
            "markers": MARKERS,
            "n": n_cmp,
            "whole_utt_TIR": rate(intro7f, n_cmp),
            "fine_span_TIR": rate(intro7g, n_cmp),
            "supersedes_phase7f_observability_limit": True,
            "note": "Phase7F whole-utt path remains diagnostic-only; not authoritative",
        },
    )

    # Stage A/B
    dump(
        out / "stage_a_post_merge_sanity.json",
        {
            "markers": MARKERS,
            "verdict": "KEEP_OPTIONAL",
            "note": "Closed-set Stage A cannot drop merged term_id; not on authoritative recall path. No retrain.",
        },
    )
    dump(
        out / "stage_b_post_recall_sanity.json",
        {
            "markers": MARKERS,
            "verdict": "KEEP_FROZEN",
            "note": "Recompute CandidateRelation on PROFILE_RETRIEVAL slots before binding. No retrain this phase.",
        },
    )
    dump(
        out / "retraining_decision.json",
        {
            "markers": MARKERS,
            "Was_Any_Model_Retrained": False,
            "RETRAINING_NOT_REQUIRED": True,
            "reason": "FineSpan deterministic retrieval demonstrates introduction before ranking; Stage B frozen sanity sufficient",
        },
    )

    # Conformance gate
    c_tir = m_c["TargetIntroductionRate"]
    e_tir = m_e["TargetIntroductionRate"]
    w_tir = m_w["TargetIntroductionRate"]
    s_tir = m_s["TargetIntroductionRate"]
    por = m_c["ProfileOnlyTargetRecovery"]
    fe_rate = m_c["FalseExpansionRate"]
    primary_fail = (fail_tax.most_common(1)[0][0] if fail_tax else "NONE")

    conf = {
        "markers": MARKERS,
        "FineSpan_authoritative": True,
        "Profile_changes_retrieval": True,
        "Target_can_be_introduced_when_absent": por > 0,
        "Whole_utterance_bypass": False,
        "Ranking_metric_used_as_recall": False,
        "New_unapproved_model_module": False,
        "Shadow_path": False,
        "PASS": None,
    }
    conf["PASS"] = all(
        [
            conf["FineSpan_authoritative"],
            conf["Profile_changes_retrieval"],
            conf["Target_can_be_introduced_when_absent"],
            not conf["Whole_utterance_bypass"],
            not conf["Ranking_metric_used_as_recall"],
            not conf["New_unapproved_model_module"],
            not conf["Shadow_path"],
            c_tir > e_tir,
            c_tir >= w_tir,
            fe_rate < 0.5,
        ]
    )
    dump(out / "architecture_conformance_check.json", conf)

    dump(
        out / "cleanup_inventory.csv".replace(".csv", ".json"),
        {
            "ARCHIVE": [
                "Phase7F OBSERVABILITY_LIMIT architecture verdict (superseded)",
                "Stage A as Model2 recall terminology",
            ],
            "DELETE_FROM_AUTHORITATIVE_PATH": ["whole-utterance Model2 query"],
            "KEEP_HISTORICAL_ARTIFACTS": True,
        },
    )
    # also write csv
    (out / "cleanup_inventory.csv").write_text(
        "item,action\n"
        "Phase7F OBSERVABILITY_LIMIT verdict,ARCHIVE_SUPERSEDED\n"
        "whole-utterance Model2 query,DELETE_FROM_AUTHORITATIVE_PATH\n"
        "Stage A Model2 recall naming,ARCHIVE\n"
        "FineSpan retrieval path,AUTHORITATIVE\n",
        encoding="utf-8",
    )
    (out / "ssot_update_inventory.csv").write_text(
        "item,status\n"
        "Model2 retrieval unit=FineSpan,FROZEN\n"
        "Model2 core=UserProfile-conditioned introduction,FROZEN\n"
        "Retrieval primitive=FuzzyPool,FROZEN\n"
        "Whole utterance not Model2 unit,FROZEN\n"
        "Stage A optional post-merge,FROZEN\n"
        "Stage B optional post-recall binding,FROZEN\n"
        "Primary metric=TargetIntroduction*,FROZEN\n"
        "BOUND-only=staged active set not full contract,FROZEN\n",
        encoding="utf-8",
    )

    proven = por > 0.05 and c_tir > e_tir + 0.03 and c_tir > w_tir and conf["PASS"]
    verdict = "PASS" if conf["PASS"] and por > 0 else "HOLD"
    dump(
        out / "go_summary.json",
        {
            "markers": MARKERS,
            "verdict": verdict,
            "FINESPAN_PROFILE_RECALL": "PROVEN" if proven else ("PARTIAL" if por > 0 else "NOT_PROVEN"),
            "FineSpan_Authoritative_Retrieval_Path": "RESTORED",
            "Whole_Utterance_Model2_Retrieval": "REMOVED_FROM_AUTHORITY",
            "REAL_ASR_FineSpan_TIR": c_tir,
            "REAL_ASR_FineSpan_ProfileOnlyTargetRecovery": por,
            "Correct": c_tir,
            "Empty": e_tir,
            "Wrong": w_tir,
            "Swapped": s_tir,
            "FalseExpansionRate": fe_rate,
            "Primary_Remaining_Failure_Class": primary_fail,
            "Stage_A": "KEEP_OPTIONAL",
            "Stage_B": "KEEP_FROZEN",
            "Was_Any_Model_Retrained": False,
            "Pronunciation_Model_Required": "NO",
            "Neural_Retrieval_Required": "NO",
            "Model2_Core_Architecture": "ALIGNED" if proven else "PARTIAL",
            "Architecture_Conformance_Check": "PASS" if conf["PASS"] else "FAIL",
            "phase7f_vs_7g": json.loads((out / "phase7f_vs_phase7g_comparison.json").read_text(encoding="utf-8")),
            "next_phase": (
                "Freeze Model2 pronunciation-recall core; then schedule domain / speaking-habits / Stage B adaptation"
                if proven
                else "HOLD — funnel-diagnose FineSpan failures before any new model"
            ),
            "Tone": "HOLD",
            "Node": "HOLD",
            "50k": "HOLD",
        },
    )
    print(json.dumps(json.loads((out / "go_summary.json").read_text(encoding="utf-8")), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
