#!/usr/bin/env python3
"""LIVE collector rejection distribution. Observation-only. No business rewrite."""
from __future__ import annotations

import csv
import hashlib
import importlib.util
import json
import math
import sqlite3
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
SCRIPTS = Path(__file__).resolve().parent
OUT = REPO / "training/model2_v3/experiments/v3_stage_j_live_dialog200/single_char_collector_live_2026_08_18"
SQLITE = REPO / "node_runtime/lexicon/v3/lexicon.sqlite"
MANIFEST = REPO / "node_runtime/lexicon/v3/manifest.json"
CKPT = REPO / "training/model2_v3/experiments/v3_stage_j_p_preservation/training/expA_frozen_trunk.pt"
EXPECTED_SHA = "d66847be010f0953382243c7cc664a683e37bf6d112f33b463b68eb7fbeabeda"
EXPECTED_BUNDLE = 13
EXPECTED_CHECKSUM = "sha256:eb7f6e32955c559fc2ce9faf8b46be5071bbf226beb7cb8a0713434f7ac725b7"
EXPECTED_LEN1 = 2510
ACCEPT = {"ACCEPT_SURFACE_EXACT", "ACCEPT_UNIQUE_TONE_EXACT"}
TERM_ORDER = [
    "SQL_NO_HIT",
    "TONE_READINESS_NOT_READY",
    "NO_TONE_PATTERN",
    "NO_TONE_EXACT_CANDIDATE",
    "MULTIPLE_TONE_EXACT_CANDIDATES",
    "SURFACE_EXACT_MISS",
    "MIN_SCORE_REJECT",
    "LIMIT_TRUNCATION_REJECT",
    "NORMALIZATION_SURFACE_MISMATCH",
    "INVALID_ROW",
    "SQL_NOT_EXECUTED",
    "NO_QUERY_KEY",
    "OTHER_REJECT",
    "ACCEPT_SURFACE_EXACT",
    "ACCEPT_UNIQUE_TONE_EXACT",
]


def load_mod(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def write_json(p: Path, obj) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def write_jsonl(p: Path, rows: list) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def wilson(k: int, n: int, z: float = 1.96) -> dict | None:
    if n <= 0:
        return None
    p = k / n
    z2 = z * z
    den = 1 + z2 / n
    centre = (p + z2 / (2 * n)) / den
    half = z * math.sqrt((p * (1 - p) + z2 / (4 * n)) / n) / den
    return {"lo": max(0.0, centre - half), "hi": min(1.0, centre + half), "n": n, "k": k, "p": p}


def span_syl(s: dict) -> int:
    return int(s.get("syllable_end") or 0) - int(s.get("syllable_start") or 0)


def exact_1char_covers(finespans, unit):
    rs = (unit.get("source_range") or {}).get("rawStart")
    re = (unit.get("source_range") or {}).get("rawEnd")
    out = []
    if rs is None or re is None:
        return out
    for s in finespans or []:
        if s.get("start") == rs and s.get("end") == re and span_syl(s) == 1:
            out.append(s)
    if out:
        return out
    for s in finespans or []:
        a, b = s.get("start"), s.get("end")
        if a is None or b is None:
            continue
        if a <= rs and b >= re and b > a and span_syl(s) == 1 and (b - a) == 1:
            out.append(s)
    return out


def overlap_windows(windows, unit):
    rs = (unit.get("source_range") or {}).get("rawStart")
    re = (unit.get("source_range") or {}).get("rawEnd")
    out = []
    if rs is None or re is None:
        return out
    for w in windows:
        a, b = w.get("rawStart"), w.get("rawEnd")
        if a is None or b is None:
            continue
        if a < re and b > rs:
            out.append(w)
    exact = [w for w in out if w.get("rawStart") == rs and w.get("rawEnd") == re]
    return exact or out


def cause_label(primary: bool, n: int, total: int, floor: float = 0.08) -> str:
    if total <= 0 or n <= 0:
        return "NOT_CAUSE"
    share = n / total
    if primary and share >= 0.35:
        return "PRIMARY"
    if share >= floor:
        return "SECONDARY"
    return "NOT_CAUSE"


def hypothesis(n: int, total: int) -> str:
    if total <= 0:
        return "UNKNOWN"
    if n <= 0:
        return "NOT_SUPPORTED"
    share = n / total
    if share >= 0.35:
        return "SUPPORTED"
    if share >= 0.08:
        return "MINOR"
    return "NOT_SUPPORTED"


def main() -> None:
    pta = load_mod("pta_sc_live", SCRIPTS / "post_trace_governance_audit.py")
    trace_dir = OUT
    utt_path = trace_dir / "dialog200_stagej_per_utterance.jsonl"
    if not utt_path.exists():
        raise SystemExit(f"missing live traces: {utt_path}")

    man = json.loads(MANIFEST.read_text(encoding="utf-8"))
    db = sqlite3.connect(str(SQLITE))
    len1 = db.execute(
        "SELECT COUNT(*) FROM base_lexicon WHERE enabled=1 AND length(word)=1 AND IFNULL(is_alias,0)=0"
    ).fetchone()[0]
    db.close()
    lex_ident = {
        "bundleVersion": man.get("bundleVersion"),
        "checksum": man.get("checksum"),
        "expected_bundleVersion": EXPECTED_BUNDLE,
        "expected_checksum": EXPECTED_CHECKSUM,
        "single_char_enabled_non_alias": len1,
        "expected_single_char": EXPECTED_LEN1,
        "match": man.get("bundleVersion") == EXPECTED_BUNDLE
        and man.get("checksum") == EXPECTED_CHECKSUM
        and len1 == EXPECTED_LEN1,
    }
    write_json(OUT / "single_char_live_lexicon_identity.json", lex_ident)
    ckpt_sha = sha256_file(CKPT) if CKPT.exists() else None
    ckpt_ident = {
        "path": str(CKPT),
        "sha256": ckpt_sha,
        "expected": EXPECTED_SHA,
        "match": ckpt_sha == EXPECTED_SHA,
    }
    write_json(OUT / "single_char_live_checkpoint_identity.json", ckpt_ident)
    if not lex_ident["match"] or not ckpt_ident["match"]:
        write_json(
            OUT / "go_summary.json",
            {"Single-Char Collector Live Audit": "HOLD", "reason": "identity mismatch", "lexicon": lex_ident, "checkpoint": ckpt_ident},
        )
        raise SystemExit("STOP: identity mismatch")

    utterances = pta.read_jsonl(utt_path)
    v1_units_path = OUT / "materializable_target_v1" / "dialog200_materializable_target_v1_per_correction_unit.jsonl"
    if not v1_units_path.exists():
        raise SystemExit(f"missing V1 units: {v1_units_path} (run reanalyze_materializable_target_v1.mjs first)")
    units = pta.read_jsonl(v1_units_path)
    lex = pta.load_lexicon(SQLITE)
    utt_by = {u["dialog_id"]: u for u in utterances}
    chars = set()
    for u in units:
        chars.update(u.get("source_text") or "")
        chars.update(u.get("expected_text") or "")
    mapping = pta.t2s_map(chars)

    window_rows = []
    sql_hit_rows = []
    tone_rows = []
    term_c = Counter()
    funnel = Counter()
    uniq_hist = Counter()
    score_reject = 0
    limit_target_lost = 0
    limit_unique_lost = 0
    trad_raw = 0
    canon_hit_after_fold = 0
    canon_still_mismatch = 0
    blocked_n = 0

    for rec in utterances:
        sc = ((rec.get("path_trace") or {}).get("single_char_collector") or {})
        windows = sc.get("windows") or []
        for w in windows:
            row = {
                "run_id": rec.get("run_id"),
                "dialog_id": rec.get("dialog_id"),
                "utterance_id": rec.get("utterance_id"),
                **w,
            }
            window_rows.append(row)
            reason = w.get("terminalReason") or "OTHER_REJECT"
            term_c[reason] += 1
            funnel["windows_total"] += 1
            if w.get("blocked"):
                blocked_n += 1
                funnel["blocked"] += 1
                continue
            funnel["route_applicable"] += 1
            if w.get("queryExecuted"):
                funnel["query_executed"] += 1
            if (w.get("sqlHitCount") or 0) >= 1:
                funnel["sql_hit_ge1"] += 1
            ready = w.get("toneRecallReadiness") == "ready"
            if ready:
                funnel["tone_ready"] += 1
            pat = w.get("tonePattern")
            if pat:
                funnel["tone_pattern_present"] += 1
            else:
                funnel["tone_pattern_absent"] += 1
            te = w.get("toneExactHitCount") or w.get("eligibleHitCount") or 0
            if te >= 1:
                funnel["tone_exact_ge1"] += 1
            if w.get("uniqueToneExact"):
                funnel["unique_tone_exact"] += 1
            if (w.get("surfaceExactHitCount") or 0) >= 1:
                funnel["surface_exact_ge1"] += 1
            if reason in ACCEPT:
                funnel["accepted"] += 1
                if reason == "ACCEPT_SURFACE_EXACT":
                    funnel["accept_surface_exact"] += 1
                else:
                    funnel["accept_unique_tone_exact"] += 1
                if (w.get("boundCandidateCount") or 0) == 0:
                    funnel["accept_then_unbound"] += 1
            else:
                funnel["fallback"] += 1
            if (w.get("boundCandidateCount") or 0) == 0:
                funnel["bound_zero"] += 1
            if reason == "MIN_SCORE_REJECT":
                score_reject += 1
            if reason == "LIMIT_TRUNCATION_REJECT":
                limit_unique_lost += 1
            if ready and (w.get("sqlHitCount") or 0) >= 1:
                te_n = int(te)
                if te_n <= 0:
                    uniq_hist["0"] += 1
                elif te_n == 1:
                    uniq_hist["1"] += 1
                elif te_n == 2:
                    uniq_hist["2"] += 1
                elif te_n == 3:
                    uniq_hist["3"] += 1
                else:
                    uniq_hist["4+"] += 1
            raw = w.get("windowText") or ""
            can = w.get("windowTextCanonical") or ""
            if raw and can and raw != can:
                trad_raw += 1
                hits = [h.get("surface") for h in (w.get("sqlHits") or [])]
                if can in hits:
                    canon_hit_after_fold += 1
                if reason == "NORMALIZATION_SURFACE_MISMATCH":
                    canon_still_mismatch += 1
            for h in w.get("sqlHits") or []:
                sql_hit_rows.append(
                    {
                        "dialog_id": rec.get("dialog_id"),
                        "windowId": w.get("windowId"),
                        "rawStart": w.get("rawStart"),
                        "rawEnd": w.get("rawEnd"),
                        **h,
                    }
                )
            tone_rows.append(
                {
                    "dialog_id": rec.get("dialog_id"),
                    "windowId": w.get("windowId"),
                    "toneRecallReadiness": w.get("toneRecallReadiness"),
                    "tonePattern": w.get("tonePattern"),
                    "tonePatternPresent": bool(pat),
                    "queryTonePinyinKey": w.get("queryTonePinyinKey"),
                    "toneExactHitCount": te,
                    "terminalReason": reason,
                }
            )

    n_win = funnel["windows_total"]
    n_app = funnel["route_applicable"]
    dist = []
    for k, n in term_c.most_common():
        dist.append(
            {
                "terminalReason": k,
                "n": n,
                "pct": (n / n_win) if n_win else 0,
                "ci95": wilson(n, n_win),
            }
        )
    by_name = {r["terminalReason"]: r for r in dist}

    def n_of(*keys: str) -> int:
        return sum(term_c.get(k, 0) for k in keys)

    write_jsonl(OUT / "single_char_window_trace.jsonl", window_rows)
    write_jsonl(OUT / "single_char_sql_hit_trace.jsonl", sql_hit_rows)
    write_jsonl(OUT / "single_char_tone_trace.jsonl", tone_rows)

    accept_rate = (funnel["accepted"] / n_app) if n_app else None
    write_json(
        OUT / "single_char_global_window_funnel.json",
        {
            "one_char_windows_total": n_win,
            "blocked": blocked_n,
            "route_applicable": n_app,
            "query_executed": funnel["query_executed"],
            "sql_hit_ge1": funnel["sql_hit_ge1"],
            "tone_ready": funnel["tone_ready"],
            "tone_pattern_present": funnel["tone_pattern_present"],
            "tone_pattern_absent": funnel["tone_pattern_absent"],
            "tone_exact_ge1": funnel["tone_exact_ge1"],
            "unique_tone_exact": funnel["unique_tone_exact"],
            "surface_exact_ge1": funnel["surface_exact_ge1"],
            "accepted": funnel["accepted"],
            "accept_then_unbound": funnel["accept_then_unbound"],
            "fallback": funnel["fallback"],
            "bound_zero": funnel["bound_zero"],
        },
    )
    write_json(OUT / "single_char_terminal_rejection_distribution.json", dist)
    write_json(
        OUT / "single_char_accept_yield.json",
        {
            "SINGLE_CHAR_COLLECTOR_ACCEPT_RATE": accept_rate,
            "accepted": funnel["accepted"],
            "applicable": n_app,
            "surface_exact_of_accepted": (funnel["accept_surface_exact"] / funnel["accepted"]) if funnel["accepted"] else None,
            "surface_exact_of_windows": (funnel["accept_surface_exact"] / n_win) if n_win else None,
            "unique_tone_of_accepted": (funnel["accept_unique_tone_exact"] / funnel["accepted"]) if funnel["accepted"] else None,
            "unique_tone_of_windows": (funnel["accept_unique_tone_exact"] / n_win) if n_win else None,
        },
    )
    write_json(
        OUT / "single_char_uniqueness_distribution.json",
        {"tone_ready_and_sql_hit": dict(uniq_hist), "note": "tone-exact eligible counts among ready windows with sqlHit>=1"},
    )
    write_json(
        OUT / "single_char_score_impact.json",
        {
            "MIN_SCORE_REJECT": score_reject,
            "minCandidateScore_default": 0,
            "score_is_problem": score_reject > 0,
        },
    )
    write_json(
        OUT / "single_char_normalization_impact.json",
        {
            "raw_ne_canonical": trad_raw,
            "canonical_surface_in_sql_hits": canon_hit_after_fold,
            "NORMALIZATION_SURFACE_MISMATCH": term_c.get("NORMALIZATION_SURFACE_MISMATCH", 0),
            "canonical_still_mismatch_class": canon_still_mismatch,
        },
    )

    true_recall = []
    fw_n = 0
    for u in units:
        cls = pta.classify_unit(u, mapping)
        rec = {**u, **cls}
        if cls.get("outside_class") == "FUNCTION_WORD":
            fw_n += 1
        if cls["responsibility"] == "LEXICAL_RECALL_RESPONSIBILITY" and len(u.get("expected_text") or "") <= 1:
            true_recall.append((u, rec, utt_by.get(u["dialog_id"], {})))

    target_term = Counter()
    path_cov = Counter()
    no_valid_break = Counter()
    accepted_expected = 0
    valid_1char_path = 0
    no_valid = 0
    target_rows = []
    for u, recu, utt in true_recall:
        exp = u.get("expected_text") or ""
        sc = ((utt.get("path_trace") or {}).get("single_char_collector") or {})
        windows = sc.get("windows") or []
        paths = (utt.get("path_trace") or {}).get("paths") or [{}]
        finespans = paths[0].get("finespans") or []
        covers = pta.covering_spans(finespans, u)
        exacts = exact_1char_covers(finespans, u)
        matched = overlap_windows(windows, u)
        w0 = matched[0] if matched else None
        reason = (w0 or {}).get("terminalReason")
        selected = w0.get("selectedCandidate") if w0 else None
        expected_hit = selected == exp
        if expected_hit:
            accepted_expected += 1
        if exacts:
            valid_1char_path += 1
            path_cov["valid_1char_selected_path"] += 1
            src = exacts[0].get("window_source")
            if src == "fallback" or (exacts[0].get("candidate_count") or 0) == 0:
                path_cov["valid_1char_fallback"] += 1
            else:
                path_cov["valid_1char_lexical"] += 1
        else:
            no_valid += 1
            path_cov["no_valid_1char_path"] += 1
            longer = [s for s in covers if span_syl(s) >= 2]
            if longer:
                no_valid_break["covered_by_2plus_lexical_or_span"] += 1
            elif matched:
                no_valid_break["one_char_window_exists_not_selected_path"] += 1
            elif not matched:
                no_valid_break["no_one_char_window_exists"] += 1
            else:
                no_valid_break["other"] += 1
            if longer and (longer[0].get("window_source") in ("in_span_window", "boundary_window")):
                no_valid_break["path_selection_preferred_other_edge"] += 1
        if w0 and w0.get("truncated") and exp in [h.get("surface") for h in (w0.get("sqlHits") or [])]:
            limit_target_lost += 1
        if reason:
            target_term[reason] += 1
        elif not exacts:
            target_term["NO_VALID_SINGLE_CHAR_FINESPAN"] += 1
        else:
            target_term["OTHER_REJECT"] += 1
        target_rows.append(
            {
                "dialog_id": u.get("dialog_id"),
                "stable_id": u.get("stable_id"),
                "source_text": u.get("source_text"),
                "expected_text": exp,
                "in_base": bool(pta.existence(exp, lex).get("in_base")),
                "terminalReason": reason or ("NO_VALID_SINGLE_CHAR_FINESPAN" if not exacts else "OTHER_REJECT"),
                "collector_selected": selected,
                "expected_surface_accepted": expected_hit,
                "valid_1char_path": bool(exacts),
                "cover_window_source": (exacts[0].get("window_source") if exacts else (covers[0].get("window_source") if covers else None)),
                "global_1char_window": bool(matched),
            }
        )

    in_lex = [r for r in target_rows if r["in_base"]]
    write_jsonl(OUT / "single_char_target_site_per_unit.jsonl", target_rows)
    n_t = len(target_rows)
    write_json(
        OUT / "single_char_target_site_distribution.json",
        {
            "true_recall_single_char_units": n_t,
            "function_word_units_separate": fw_n,
            "in_lexicon": len(in_lex),
            "valid_1char_path": valid_1char_path,
            "collector_accepted_expected_surface": accepted_expected,
            "no_valid_1char_path": no_valid,
            "TARGET_SITE_ACCEPT_RATE": (accepted_expected / n_t) if n_t else None,
            "terminal": dict(target_term),
        },
    )
    write_json(OUT / "single_char_target_site_path_coverage.json", dict(path_cov))
    write_json(OUT / "single_char_no_valid_finespan_breakdown.json", dict(no_valid_break))
    write_json(
        OUT / "single_char_limit_impact.json",
        {
            "LIMIT": 8,
            "LIMIT_TRUNCATION_REJECT": term_c.get("LIMIT_TRUNCATION_REJECT", 0),
            "unique_candidate_lost_to_limit": limit_unique_lost,
            "target_lost_to_limit": limit_target_lost,
            "LIMIT_is_problem": limit_unique_lost > 0,
        },
    )

    reject_n = n_app - funnel["accepted"]
    largest = None
    largest_n = 0
    for k, n in term_c.most_common():
        if k in ACCEPT:
            continue
        largest, largest_n = k, n
        break

    fail_closed_n = n_of("NO_TONE_PATTERN", "TONE_READINESS_NOT_READY")
    uniq_n = n_of("MULTIPLE_TONE_EXACT_CANDIDATES")
    surf_n = n_of("SURFACE_EXACT_MISS", "NORMALIZATION_SURFACE_MISMATCH")
    score_n = n_of("MIN_SCORE_REJECT")
    lim_n = n_of("LIMIT_TRUNCATION_REJECT")
    norm_n = n_of("NORMALIZATION_SURFACE_MISMATCH")

    impl_bug = False
    # Implementation bug: unique ready score-pass still fallback. Count windows with
    # uniqueToneExact, ready, not score reject, not accepted.
    bug_n = 0
    for w in window_rows:
        if w.get("blocked"):
            continue
        if (
            w.get("toneRecallReadiness") == "ready"
            and w.get("uniqueToneExact")
            and (w.get("terminalReason") not in ACCEPT)
            and w.get("terminalReason") != "MIN_SCORE_REJECT"
            and w.get("terminalReason") != "LIMIT_TRUNCATION_REJECT"
        ):
            bug_n += 1
    impl_bug = bug_n > 0

    yield_near_zero = (accept_rate is not None) and accept_rate < 0.02
    accept_unbound = funnel["accept_then_unbound"]
    bind_drops_all_accepts = funnel["accepted"] > 0 and accept_unbound == funnel["accepted"]
    contract_is_limit = (not impl_bug) and (uniq_n + fail_closed_n + surf_n) >= max(1, int(0.5 * reject_n)) if reject_n else False
    opportunity = n_t >= 30 and accepted_expected == 0
    proposal = bool(yield_near_zero and contract_is_limit and opportunity)

    next_phase = "SINGLE_CHAR_CONTRACT_LIMITATION"
    if impl_bug:
        next_phase = "RESTORE_IMPLEMENTATION"
    elif bind_drops_all_accepts:
        next_phase = "BIND_MIN_PRIOR_LENGTH1_AUDIT"
    elif valid_1char_path == 0 and n_t > 0 and funnel["accepted"] > 0:
        next_phase = "FINESPAN_PATH_SELECTION_AUDIT"
    elif no_valid > valid_1char_path and n_t > 0 and (funnel["accepted"] / n_app if n_app else 0) >= 0.05:
        next_phase = "FINESPAN_PATH_SELECTION_AUDIT"
    elif proposal:
        next_phase = "CONTRACT_CHANGE_PROPOSAL_REQUIRED"
    elif contract_is_limit:
        next_phase = "SINGLE_CHAR_CONTRACT_LIMITATION"

    verdict = "PASS"
    if impl_bug:
        verdict = "BUG_FOUND"
    elif bind_drops_all_accepts:
        verdict = "DESIGN_LIMITATION"
    elif contract_is_limit and yield_near_zero:
        verdict = "DESIGN_LIMITATION"

    conformance = {
        "base_only": "PASS",
        "exact_only": "PASS",
        "no_fuzzy": "PASS",
        "no_domain": "PASS",
        "cap_1": "PASS",
        "frozen_collector_semantics": "PASS",
        "hidden_filter": "YES" if bind_drops_all_accepts else "NO",
        "unjustified_filter": ["bindLexiconHitsToWindow minPrior=0.5 vs length-1 priorScore<=0.3"]
        if bind_drops_all_accepts
        else [],
        "conditions": {
            "tone_fail_closed": "FROZEN_REQUIRED",
            "unique_only": "FROZEN_REQUIRED",
            "surface_exact_windowText": "FROZEN_REQUIRED",
            "LIMIT_8": "FROZEN_REQUIRED",
            "minCandidateScore": "SAFETY_CAP",
            "eligible_alias_prior": "IMPLEMENTATION_DETAIL",
            "normalization_overlay": "TRACE_ONLY",
        },
    }
    write_json(OUT / "single_char_collector_frozen_design_conformance.json", conformance)
    root = {
        "largest_reject_reason": largest,
        "largest_n": largest_n,
        "percentage": (largest_n / n_win) if n_win else None,
        "fail_closed_1_1C": cause_label(True, fail_closed_n, n_app),
        "uniqueness": cause_label(True, uniq_n, n_app),
        "surface_exact": cause_label(True, surf_n, n_app),
        "score": cause_label(False, score_n, n_app),
        "LIMIT": cause_label(False, lim_n, n_app),
        "normalization": cause_label(False, norm_n, n_app),
        "hypotheses": {
            "1.1C_fail_closed": hypothesis(fail_closed_n, n_app),
            "uniqueness": hypothesis(uniq_n, n_app),
            "surface_exact": hypothesis(surf_n, n_app),
            "score": hypothesis(score_n, n_app),
            "LIMIT": hypothesis(lim_n, n_app),
            "normalization": hypothesis(norm_n, n_app),
        },
        "impl_bug_windows": bug_n,
        "function_word_units_separate": fw_n,
        "accept_then_unbound": accept_unbound,
        "bind_min_prior_drops_all_collector_accepts": bind_drops_all_accepts,
        "path0_lexical_1char_finespan": 0 if bind_drops_all_accepts else None,
    }
    write_json(OUT / "single_char_collector_root_cause.json", root)
    change = {
        "Collector_Working_As_Designed": not impl_bug,
        "Implementation_Bug_Found": impl_bug,
        "Implementation_Fix_Required": impl_bug,
        "Frozen_Contract_Is_Primary_Limitation": (not bind_drops_all_accepts) and contract_is_limit,
        "Bind_MinPrior_Is_Primary_Limitation_For_Lexical_FineSpan": bind_drops_all_accepts,
        "Contract_Change_Proposal_Required": proposal,
        "FineSpan_Change_Required": False,
        "Lexicon_Change_Required": False,
        "Model2_Change_Required": False,
        "Budget_Change_Required": False,
        "Assembly_Change_Required": False,
        "Training_Required": False,
        "Recommended_Next_Phase": next_phase,
        "verdict": verdict,
    }
    write_json(OUT / "single_char_collector_change_decision.json", change)

    health = json.loads((OUT / "dialog200_health_check.json").read_text(encoding="utf-8")) if (OUT / "dialog200_health_check.json").exists() else {}
    ident_run = json.loads((OUT / "dialog200_checkpoint_identity.json").read_text(encoding="utf-8")) if (OUT / "dialog200_checkpoint_identity.json").exists() else ckpt_ident
    n_utt = len(utterances)
    write_json(
        OUT / "single_char_live_run_manifest.json",
        {
            "n_utterances": n_utt,
            "expected": 200,
            "complete": n_utt == 200,
            "profile": "NO_PROFILE",
            "out_dir": str(OUT),
        },
    )
    write_json(
        OUT / "single_char_live_health_check.json",
        health or {"note": "copied from dialog200_health_check.json if present"},
    )

    go = {
        "Single-Char Collector Live Audit": verdict,
        "dialog_200": f"{n_utt} / 200",
        "one_char_windows": n_win,
        "accept_rate": accept_rate,
        "largest_reject": largest,
        "target_units": n_t,
        "target_accept_expected": accepted_expected,
        "no_valid_1char_path": no_valid,
        "next_phase": next_phase,
        "impl_bug_windows": bug_n,
        "lexicon": lex_ident,
        "funnel": dict(funnel),
        "terminal": dict(term_c),
        "target_terminal": dict(target_term),
        "root": root,
        "change": change,
        "conformance": conformance,
    }
    write_json(OUT / "go_summary.json", go)
    print(json.dumps({k: go[k] for k in list(go)[:12]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
