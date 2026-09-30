#!/usr/bin/env python3
"""READ-ONLY Model2 E2E architecture conformance — span reference vs Phase7F path.

Markers: E2E_CONFORMANCE_AUDIT / NOT_FOR_RUNTIME / NOT_FROZEN / READ_ONLY
Does not modify production contracts. Diagnostic only.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from training.model2.phonetic.syllables import text_to_syllables
from training.model2.retrieval.normalize import normalize_syllable_sequence_for_lookup
from training.model2.retrieval.profile_query import generate_profile_queries
from training.model2.retrieval.spike_retriever import ProfileRetrievalConfig, retrieve_profile_candidates
from training.model2.stage_b.active_feature_mask import BOUND_FEATURES_V1
from training.model2.stage_b.condition import STRENGTH_TO_PROB
from training.model2.fuzzy.pool import FuzzyPoolRequestV1, build_fuzzy_pool
from training.model2.training.dataset import load_candidate_index, load_jsonl

MARKERS = ["E2E_CONFORMANCE_AUDIT", "NOT_FOR_RUNTIME", "NOT_FROZEN", "READ_ONLY"]
OUT = ROOT / "training" / "model2" / "experiments" / "e2e_conformance_audit"


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


def fine_span_windows(syllables: list[str], min_n: int = 1, max_n: int = 5) -> list[dict]:
    """Executable reference of Lattice FineSpan syllable windows (Architecture 1..5)."""
    syls = normalize_syllable_sequence_for_lookup(syllables)
    out = []
    n = len(syls)
    for L in range(min_n, min(max_n, n) + 1):
        for i in range(0, n - L + 1):
            win = syls[i : i + L]
            out.append({"syllable_start": i, "syllable_end": i + L, "span_syllables": win, "span_len": L})
    return out


def base_ids(index, syls: list[str]) -> set[str]:
    q = normalize_syllable_sequence_for_lookup(syls)
    if not q:
        return set()
    res = build_fuzzy_pool(index, FuzzyPoolRequestV1("", q, len(q), max_pool_size=16))
    return {h.term_id for h in res.hits}


def bias_from_result(res: dict) -> dict[str, float]:
    fam = res.get("family")
    st = str(res.get("intended_strength") or "MEDIUM").upper()
    if not fam or st == "NONE":
        return {}
    return {str(fam): float(STRENGTH_TO_PROB.get(st, 0.5))}


def span_reference_introduce(index, obs_utt_syls: list[str], bias: dict[str, float], tid: str, cfg: ProfileRetrievalConfig) -> dict:
    """INTENDED path: for each FineSpan window, profile expand → lexicon; merge."""
    tgt = index.by_term_id.get(tid)
    tgt_len = len(tgt.syllables) if tgt else 2
    windows = fine_span_windows(obs_utt_syls)
    # Prefer length-compatible windows (Lattice also uses 1..5; prioritize target length)
    windows = sorted(
        windows,
        key=lambda w: (abs(w["span_len"] - tgt_len), w["syllable_start"]),
    )
    introduced = False
    target_query_generated = False
    queries = []
    relations = []
    new_ids: set[str] = set()
    base_all: set[str] = set()
    winning_span = None
    scanned = 0
    for w in windows:
        if scanned >= 24:  # hard budget for audit runtime
            break
        if abs(w["span_len"] - tgt_len) > 1:
            continue
        scanned += 1
        b = base_ids(index, w["span_syllables"])
        base_all |= b
        pr = retrieve_profile_candidates(
            index, w["span_syllables"], bias, base_term_ids=b, cfg=cfg
        )
        for q in pr.queries:
            queries.append({"span": w["span_syllables"], "query": q.syllables, "relation": q.relation_used})
            relations.append(q.relation_used)
            if tgt and list(tgt.syllables) == list(q.syllables):
                target_query_generated = True
        ids = set(pr.term_ids())
        new_ids |= ids
        if tid in ids or tid in b:
            if tid in ids:
                introduced = True
            winning_span = w
            if tid in ids:
                break
    return {
        "introduced": introduced,
        "target_in_any_base_span": tid in base_all,
        "target_in_profile_new": tid in new_ids,
        "target_query_generated": target_query_generated,
        "n_windows_total": len(fine_span_windows(obs_utt_syls)),
        "n_windows_scanned": scanned,
        "n_queries": len(queries),
        "n_new_union": len(new_ids),
        "relations_used": sorted(set(relations)),
        "winning_span": winning_span,
        "queries_head": queries[:12],
    }


def phase7f_whole_utt(index, asr: str, bias: dict[str, float], tid: str, cfg: ProfileRetrievalConfig) -> dict:
    obs = text_to_syllables(asr)
    b = base_ids(index, obs)
    pr = retrieve_profile_candidates(index, obs, bias, base_term_ids=b, cfg=cfg)
    tgt = index.by_term_id.get(tid)
    tqg = False
    for q in pr.queries:
        if tgt and list(tgt.syllables) == list(q.syllables):
            tqg = True
    return {
        "observed_syllables": obs,
        "n_syllables": len(obs),
        "target_in_base": tid in b,
        "target_introduced": tid in set(pr.term_ids()),
        "n_queries": pr.n_queries,
        "n_new": pr.n_new_candidates,
        "target_query_generated": tqg,
        "queries": [q.syllables for q in pr.queries],
        "relations": [q.relation_used for q in pr.queries],
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n-trace", type=int, default=40)
    ap.add_argument("--n-eval", type=int, default=200)
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

    # Build REAL_ASR-like pool (same as 7F construction)
    pool = []
    for res in results:
        asr = (res.get("asr_hypothesis") or "").strip()
        target = (res.get("target_term") or "").strip()
        if not asr or not target:
            continue
        hits = idx.by_surface.get(target) or []
        if not hits:
            continue
        tid = sorted(hits, key=lambda h: -h.prior_score)[0].term_id
        bias = bias_from_result(res)
        # Prefer cases where family is BOUND so profile can fire
        pool.append(
            {
                "sample_plan_id": res.get("sample_plan_id"),
                "asr": asr,
                "gt": res.get("ground_truth_text"),
                "target_term": target,
                "target_term_id": tid,
                "family": res.get("family"),
                "strength": res.get("intended_strength"),
                "bias": bias,
                "eligibility": res.get("eligibility_class"),
            }
        )
    rng.shuffle(pool)
    # Prefer BOUND-active for fair span-reference (profile can activate)
    bound_pool = [p for p in pool if p.get("family") in BOUND_FEATURES_V1 and p.get("bias")]
    other_pool = [p for p in pool if p not in bound_pool]
    eval_set = (bound_pool + other_pool)[: args.n_eval]
    trace_set = eval_set[: args.n_trace]

    # Metrics
    n = 0
    p7f_intro = span_intro = span_recover_from_p7f_fail = 0
    p7f_tqg = span_tqg = 0
    q_p7f = q_span = []
    new_p7f = new_span = []
    false_span_exp = 0

    traces = []
    for p in eval_set:
        tid = p["target_term_id"]
        bias = p["bias"]
        asr = p["asr"]
        obs = text_to_syllables(asr)
        if not obs:
            continue
        n += 1
        a = phase7f_whole_utt(idx, asr, bias, tid, cfg)
        b = span_reference_introduce(idx, obs, bias, tid, cfg)
        q_p7f.append(a["n_queries"])
        q_span.append(b["n_queries"])
        new_p7f.append(a["n_new"])
        new_span.append(b["n_new_union"])
        if a["target_introduced"]:
            p7f_intro += 1
        if a["target_query_generated"]:
            p7f_tqg += 1
        # Span success: profile introduced OR appeared via span-level base+profile merge when absent from whole-utt base
        span_hit = bool(b["target_in_profile_new"] or (b["target_in_any_base_span"] and not a["target_in_base"]))
        # Stricter: introduction means in profile new OR in a span base that whole-utt base missed
        intro_span = bool(b["target_in_profile_new"]) or (
            b["target_in_any_base_span"] and not a["target_in_base"]
        )
        # For Model2 introduction metric: prefer profile_new; also count span-base hit as "span path recovers visibility"
        if b["target_in_profile_new"]:
            span_intro += 1
        if b["target_query_generated"]:
            span_tqg += 1
        if (not a["target_introduced"]) and (b["target_in_profile_new"] or b["target_in_any_base_span"]):
            span_recover_from_p7f_fail += 1
        if b["n_new_union"] > 0 and not b["target_in_profile_new"]:
            false_span_exp += 1

        if len(traces) < args.n_trace and p in trace_set or len(traces) < args.n_trace:
            if len(traces) < args.n_trace:
                # detailed windows for target-containing windows
                windows = fine_span_windows(obs)
                relevant = []
                tgt_syl = list(idx.by_term_id[tid].syllables)
                for w in windows:
                    # keep short windows near target length
                    if abs(w["span_len"] - len(tgt_syl)) > 1 and w["span_len"] > len(tgt_syl) + 1:
                        continue
                    bb = base_ids(idx, w["span_syllables"])
                    pr = retrieve_profile_candidates(idx, w["span_syllables"], bias, base_term_ids=bb, cfg=cfg)
                    relevant.append(
                        {
                            "span_syllables": w["span_syllables"],
                            "span_range": [w["syllable_start"], w["syllable_end"]],
                            "base_has_target": tid in bb,
                            "profile_queries": [q.syllables for q in pr.queries],
                            "relations": [q.relation_used for q in pr.queries],
                            "profile_new_ids_head": pr.term_ids()[:8],
                            "target_recalled": tid in set(pr.term_ids()) or tid in bb,
                        }
                    )
                    if len(relevant) >= 8:
                        break
                traces.append(
                    {
                        "utterance_id": p["sample_plan_id"],
                        "ASR_utterance": asr,
                        "ground_truth": p["gt"],
                        "target_term": p["target_term"],
                        "target_term_id": tid,
                        "target_in_lexicon": True,
                        "UserProfile": bias,
                        "family": p["family"],
                        "FineSpan_window_count": len(windows),
                        "INTENDED_SPAN_PATH": {
                            **b,
                            "relevant_spans": relevant,
                        },
                        "PHASE7F_ACTUAL_PATH": a,
                        "comparison": {
                            "p7f_introduced": a["target_introduced"],
                            "span_profile_introduced": b["target_in_profile_new"],
                            "span_base_visible": b["target_in_any_base_span"],
                            "span_recovers_p7f_miss": (not a["target_introduced"])
                            and (b["target_in_profile_new"] or b["target_in_any_base_span"]),
                        },
                    }
                )

    dump_jsonl(out / "real_asr_span_trace.jsonl", traces)

    # Also eval 7E-like family synth from trainrows (span-level) for control
    rows = load_jsonl(ds / "stage_b_trainrows/model2_train_rows.jsonl")
    synth_n = synth_intro = 0
    for row in rows:
        if not row.get("is_term_positive"):
            continue
        fam = row.get("corruption_family")
        if fam not in BOUND_FEATURES_V1:
            continue
        tid = row.get("target_term_id")
        if not tid or tid not in idx.by_term_id:
            continue
        obs = row.get("observed_syllables") or row.get("observed_syllables_for_relation") or []
        if not obs:
            continue
        snap = row.get("phonetic_bias_snapshot") or {}
        bias = {k: float(v) for k, v in snap.items() if float(v) > 0} or {
            fam: float(STRENGTH_TO_PROB.get(str(row.get("intended_strength") or "MEDIUM").upper(), 0.5))
        }
        bset = base_ids(idx, obs)
        if tid in bset:
            continue  # natural miss only
        pr = retrieve_profile_candidates(idx, obs, bias, base_term_ids=bset, cfg=cfg)
        synth_n += 1
        if tid in set(pr.term_ids()):
            synth_intro += 1
        if synth_n >= 200:
            break

    cmp = {
        "markers": MARKERS,
        "n_real_asr_eval": n,
        "PHASE7F_whole_utterance": {
            "TargetIntroductionRate": rate(p7f_intro, n),
            "target_query_generated_rate": rate(p7f_tqg, n),
            "queries_mean": sum(q_p7f) / n if n else 0,
            "new_candidates_mean": sum(new_p7f) / n if n else 0,
        },
        "SPAN_REFERENCE": {
            "TargetIntroductionRate_profile_new": rate(span_intro, n),
            "target_query_generated_rate": rate(span_tqg, n),
            "span_recovers_visibility_when_p7f_fails_rate": rate(span_recover_from_p7f_fail, n),
            "queries_mean": sum(q_span) / n if n else 0,
            "new_candidates_union_mean": sum(new_span) / n if n else 0,
            "false_expansion_proxy_rate": rate(false_span_exp, n),
        },
        "FAMILY_SYNTH_span_control": {
            "n": synth_n,
            "TargetIntroductionRate": rate(synth_intro, synth_n),
        },
        "verdict_hint": None,
    }
    # Decision hint
    if cmp["SPAN_REFERENCE"]["TargetIntroductionRate_profile_new"] > cmp["PHASE7F_whole_utterance"]["TargetIntroductionRate"] + 0.15:
        cmp["verdict_hint"] = "TEST_PATH_INVALID_OR_DRIFT — span reference recovers where whole-utt fails"
    elif cmp["SPAN_REFERENCE"]["span_recovers_visibility_when_p7f_fails_rate"] > 0.3:
        cmp["verdict_hint"] = "TEST_PATH_INVALID — FineSpan windows restore target visibility / queries"
    elif cmp["SPAN_REFERENCE"]["TargetIntroductionRate_profile_new"] < 0.05 and cmp["FAMILY_SYNTH_span_control"]["TargetIntroductionRate"] > 0.5:
        cmp["verdict_hint"] = "PARTIAL — synth OK; real ASR span still weak (observability residual)"
    else:
        cmp["verdict_hint"] = "INCONCLUSIVE"
    dump(out / "span_reference_vs_phase7f.json", cmp)
    print(json.dumps(cmp, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
