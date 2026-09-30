#!/usr/bin/env python3
"""FW_REPAIR_V4_BIND_MIN_PRIOR_LENGTH1_AUDIT — READ ONLY.

Does not change minPrior, priorScore, collector, FineSpan, Model2, Assembly, or train.
"""
from __future__ import annotations

import csv
import json
import sqlite3
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
LIVE = REPO / "training/model2_v3/experiments/v3_stage_j_live_dialog200/single_char_collector_live_2026_08_18"
OUT = REPO / "training/model2_v3/experiments/v3_stage_j_live_dialog200/bind_minprior_length1_audit_2026_08_19"
SQLITE = REPO / "node_runtime/lexicon/v3/lexicon.sqlite"
TSV = REPO / "docs/pinyin-v2/import/single_char_dictionary.tsv"
REPORT = REPO / "docs/user_correction/Lingua_FW_Repair_V4_Bind_MinPrior_Length1_Audit_2026_08_19.md"
V1_UNITS = LIVE / "materializable_target_v1/dialog200_materializable_target_v1_per_correction_unit.jsonl"
TARGET_UNITS = LIVE / "single_char_target_site_per_unit.jsonl"
WINDOWS = LIVE / "single_char_window_trace.jsonl"
UTTERANCES = LIVE / "dialog200_stagej_per_utterance.jsonl"

MIN_PRIOR = 0.5
ACCEPT = {"ACCEPT_SURFACE_EXACT", "ACCEPT_UNIQUE_TONE_EXACT"}


def write_json(p: Path, obj) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_jsonl(p: Path, rows: list) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + ("\n" if rows else ""),
        encoding="utf-8",
    )


def write_csv(p: Path, rows: list[dict], fieldnames: list[str]) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in fieldnames})


def write_text(p: Path, s: str) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(s if s.endswith("\n") else s + "\n", encoding="utf-8")


def read_jsonl(p: Path) -> list:
    if not p.exists():
        return []
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]


def percentile(xs: list[float], p: float) -> float | None:
    if not xs:
        return None
    s = sorted(xs)
    if len(s) == 1:
        return float(s[0])
    k = (len(s) - 1) * (p / 100.0)
    f = int(k)
    c = min(f + 1, len(s) - 1)
    if f == c:
        return float(s[f])
    return float(s[f] + (s[c] - s[f]) * (k - f))


def dist_stats(xs: list[float]) -> dict:
    if not xs:
        return {
            "n": 0,
            "min": None,
            "p1": None,
            "p5": None,
            "p25": None,
            "p50": None,
            "p75": None,
            "p95": None,
            "p99": None,
            "max": None,
            "unique_values": [],
            "histogram": {},
            "ge_0_5": 0,
            "ge_0_5_rate": None,
        }
    rounded = [round(float(x), 6) for x in xs]
    hist = Counter(rounded)
    ge = sum(1 for x in rounded if x >= MIN_PRIOR)
    return {
        "n": len(rounded),
        "min": min(rounded),
        "p1": percentile(rounded, 1),
        "p5": percentile(rounded, 5),
        "p25": percentile(rounded, 25),
        "p50": percentile(rounded, 50),
        "p75": percentile(rounded, 75),
        "p95": percentile(rounded, 95),
        "p99": percentile(rounded, 99),
        "max": max(rounded),
        "unique_values": sorted(hist.keys()),
        "histogram": {str(k): v for k, v in sorted(hist.items())},
        "ge_0_5": ge,
        "ge_0_5_rate": ge / len(rounded),
    }


def load_sqlite_priors() -> dict:
    db = sqlite3.connect(str(SQLITE))
    db.row_factory = sqlite3.Row
    by_len: dict[str, list[float]] = {"1": [], "2": [], "3": [], "4+": []}
    by_term: dict[str, float] = {}
    rows_1 = []
    for r in db.execute(
        "SELECT id, word, pinyin_key, prior_score, source, enabled, is_alias FROM base_lexicon WHERE enabled=1"
    ):
        n = len(r["word"] or "")
        key = "4+" if n >= 4 else str(n) if n in (1, 2, 3) else "other"
        if key in by_len:
            by_len[key].append(float(r["prior_score"]))
        by_term[r["id"]] = float(r["prior_score"])
        if n == 1 and not r["is_alias"]:
            rows_1.append(
                {
                    "id": r["id"],
                    "word": r["word"],
                    "pinyin_key": r["pinyin_key"],
                    "prior_score": float(r["prior_score"]),
                    "source": r["source"],
                }
            )
    term_len: dict[str, list[float]] = {"1": [], "2": [], "3": [], "4+": []}
    for r in db.execute("SELECT word, prior_score FROM term WHERE enabled=1"):
        n = len(r["word"] or "")
        key = "4+" if n >= 4 else str(n) if n in (1, 2, 3) else None
        if key:
            term_len[key].append(float(r["prior_score"]))
    n1 = db.execute(
        "SELECT COUNT(*) FROM base_lexicon WHERE enabled=1 AND length(word)=1 AND IFNULL(is_alias,0)=0"
    ).fetchone()[0]
    db.close()
    return {
        "base_by_len": by_len,
        "term_by_len": term_len,
        "prior_by_term_id": by_term,
        "len1_rows": rows_1,
        "len1_n": n1,
    }


def load_tsv_weights() -> dict:
    text = TSV.read_text(encoding="utf-8").replace("\ufeff", "")
    lines = [l for l in text.splitlines() if l.strip()]
    header = lines[0].split("\t")
    idx = {h: i for i, h in enumerate(header)}
    weights = []
    ranks = []
    roles = Counter()
    for line in lines[1:]:
        cells = line.split("\t")
        w = float(cells[idx["weight"]]) if cells[idx["weight"]] else None
        if w is not None:
            weights.append(w)
        if "frequency_rank" in idx and cells[idx["frequency_rank"]]:
            try:
                ranks.append(int(cells[idx["frequency_rank"]]))
            except ValueError:
                pass
        if "single_char_role" in idx:
            roles[cells[idx["single_char_role"]]] += 1
    return {
        "header": header,
        "n_rows": len(lines) - 1,
        "has_frequency": "frequency_rank" in idx,
        "has_rank": "frequency_rank" in idx,
        "has_score": "score" in idx,
        "has_prior": "prior" in idx or "prior_score" in idx,
        "has_weight": "weight" in idx,
        "weight_stats": dist_stats(weights),
        "roles": dict(roles),
        "frequency_rank_min": min(ranks) if ranks else None,
        "frequency_rank_max": max(ranks) if ranks else None,
    }


def selected_prior(w: dict) -> float | None:
    sel = w.get("selectedCandidate")
    for h in w.get("sqlHits") or []:
        if h.get("surface") == sel:
            ps = h.get("priorScore")
            if ps is not None:
                return float(ps)
    return None


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    sqlite = load_sqlite_priors()
    tsv = load_tsv_weights()
    windows = read_jsonl(WINDOWS)
    accepts = [w for w in windows if w.get("terminalReason") in ACCEPT]
    target_units = read_jsonl(TARGET_UNITS)
    v1_units = read_jsonl(V1_UNITS)

    # --- 2331 per-candidate ---
    per_cand = []
    by_utt_cf1: dict[str, list] = defaultdict(list)
    identity_n = 0
    subst_n = 0
    mode_priors: dict[str, list[float]] = defaultdict(list)
    for w in accepts:
        prior = selected_prior(w)
        sel = w.get("selectedCandidate")
        wt = w.get("windowText")
        identity = sel == wt
        if identity:
            identity_n += 1
        else:
            subst_n += 1
        would = bool(prior is not None and prior >= MIN_PRIOR)
        rec = {
            "dialog_id": w.get("dialog_id"),
            "utterance_id": w.get("utterance_id"),
            "windowId": w.get("windowId"),
            "rawStart": w.get("rawStart"),
            "rawEnd": w.get("rawEnd"),
            "windowText": wt,
            "selectedCandidate": sel,
            "accept_mode": w.get("terminalReason"),
            "chosenSource": w.get("chosenSource"),
            "priorScore": prior,
            "minPrior": MIN_PRIOR,
            "tone": (w.get("sqlHits") or [{}])[0].get("tone") if w.get("sqlHits") else None,
            "queryTonePinyinKey": w.get("queryTonePinyinKey"),
            "surface_exact": sel == wt,
            "unique_tone_exact": w.get("uniqueToneExact") is True,
            "candidate_length": 1,
            "wouldBindAtCurrentThreshold": would,
            "identity": identity,
            "substitution": not identity,
            "boundCandidateCount": w.get("boundCandidateCount"),
            "candidateScore": w.get("candidateScore"),
        }
        per_cand.append(rec)
        by_utt_cf1[w.get("utterance_id") or w.get("dialog_id")].append(rec)
        if prior is not None:
            mode_priors[w.get("terminalReason")].append(prior)

    write_jsonl(OUT / "bind_single_char_2331_per_candidate.jsonl", per_cand)

    accept_mode_prior = {
        mode: dist_stats(mode_priors.get(mode, []))
        for mode in ("ACCEPT_SURFACE_EXACT", "ACCEPT_UNIQUE_TONE_EXACT")
    }
    accept_mode_prior["n_surface_exact"] = sum(
        1 for r in per_cand if r["accept_mode"] == "ACCEPT_SURFACE_EXACT"
    )
    accept_mode_prior["n_unique_tone"] = sum(
        1 for r in per_cand if r["accept_mode"] == "ACCEPT_UNIQUE_TONE_EXACT"
    )
    write_json(OUT / "bind_single_char_accept_mode_prior.json", accept_mode_prior)

    identity_vs = {
        "collector_accepted": len(per_cand),
        "identity_candidate": identity_n,
        "substitution_candidate": subst_n,
        "identity_of_surface_exact": sum(
            1 for r in per_cand if r["accept_mode"] == "ACCEPT_SURFACE_EXACT" and r["identity"]
        ),
        "substitution_of_surface_exact": sum(
            1 for r in per_cand if r["accept_mode"] == "ACCEPT_SURFACE_EXACT" and r["substitution"]
        ),
        "identity_of_unique_tone": sum(
            1 for r in per_cand if r["accept_mode"] == "ACCEPT_UNIQUE_TONE_EXACT" and r["identity"]
        ),
        "substitution_of_unique_tone": sum(
            1 for r in per_cand if r["accept_mode"] == "ACCEPT_UNIQUE_TONE_EXACT" and r["substitution"]
        ),
        "would_pass_minprior_0_5": sum(1 for r in per_cand if r["wouldBindAtCurrentThreshold"]),
        "note": "identity = selectedCandidate == ASR windowText; substitution = selected != windowText. Surface-exact is expected to be identity; unique-tone may substitute.",
    }
    write_json(OUT / "bind_single_char_identity_vs_substitution.json", identity_vs)

    # --- target sites ---
    # Authoritative unit set: previous live true-recall length-1 rows (MATERIALIZABLE_TARGET_V1).
    # Re-attach priorScore from the matching collector window on the same dialog.
    windows_by_dialog: dict[str, list] = defaultdict(list)
    for w in windows:
        windows_by_dialog[w.get("dialog_id")].append(w)

    target_rows = []
    for u in target_units:
        did = u.get("dialog_id")
        src = u.get("source_text") or ""
        exp = u.get("expected_text") or ""
        sel_prev = u.get("collector_selected")
        match = None
        for w in windows_by_dialog.get(did, []):
            if w.get("windowText") == src and w.get("selectedCandidate") == sel_prev:
                match = w
                break
        if match is None:
            for w in windows_by_dialog.get(did, []):
                if w.get("windowText") == src and w.get("terminalReason") == u.get("terminalReason"):
                    match = w
                    break
        sel = (match or {}).get("selectedCandidate") if match else sel_prev
        prior = selected_prior(match) if match else None
        exp_hit = bool(u.get("expected_surface_accepted")) or (sel == exp and bool(sel))
        target_rows.append(
            {
                "dialog_id": did,
                "stable_id": u.get("stable_id"),
                "asr_character": src,
                "expected_character": exp,
                "in_base": u.get("in_base"),
                "collector_selected": sel,
                "accept_reason": (match or {}).get("terminalReason") or u.get("terminalReason"),
                "priorScore": prior,
                "would_pass_current_bind": bool(prior is not None and prior >= MIN_PRIOR),
                "expected_candidate_selected": exp_hit,
                "valid_1char_path": u.get("valid_1char_path"),
                "cover_window_source": u.get("cover_window_source"),
            }
        )
    expected_from_flag = sum(1 for u in target_units if u.get("expected_surface_accepted"))
    live_expected = sum(1 for r in target_rows if r["expected_candidate_selected"])
    write_json(
        OUT / "bind_single_char_target_site_analysis.json",
        {
            "true_recall_single_char_units": len(target_units),
            "function_word_units_separate": 31,
            "v1_units_total": len(v1_units),
            "collector_selected_expected_previous_flag": expected_from_flag,
            "collector_selected_expected_live_recompute": live_expected,
            "authoritative_expected_target_candidate": expected_from_flag,
            "would_pass_minprior": sum(1 for r in target_rows if r["would_pass_current_bind"]),
            "per_unit": target_rows,
            "note": "Even if all 2331 bind, expected lexical correction coverage is bounded by collector expected-surface accepts (~2/213), not 2331.",
        },
    )

    # --- sqlite / tsv distributions ---
    len1 = sqlite["base_by_len"]["1"]
    sc_dist = dist_stats(len1)
    write_json(OUT / "single_char_prior_distribution.json", {**sc_dist, "source": "base_lexicon enabled length=1"})
    prior_by_len = {
        "1": dist_stats(sqlite["base_by_len"]["1"]),
        "2": dist_stats(sqlite["base_by_len"]["2"]),
        "3": dist_stats(sqlite["base_by_len"]["3"]),
        "4+": dist_stats(sqlite["base_by_len"]["4+"]),
        "term_table": {
            "1": dist_stats(sqlite["term_by_len"]["1"]),
            "2": dist_stats(sqlite["term_by_len"]["2"]),
            "3": dist_stats(sqlite["term_by_len"]["3"]),
            "4+": dist_stats(sqlite["term_by_len"]["4+"]),
        },
    }
    write_json(OUT / "prior_distribution_by_length.json", prior_by_len)
    coverage = {
        "minPrior": MIN_PRIOR,
        "by_length_ge_0_5": {
            k: {"n": prior_by_len[k]["n"], "ge_0_5": prior_by_len[k]["ge_0_5"], "rate": prior_by_len[k]["ge_0_5_rate"]}
            for k in ("1", "2", "3", "4+")
        },
        "single_char_live_accepted_ge_0_5": sum(1 for r in per_cand if r["wouldBindAtCurrentThreshold"]),
        "single_char_live_accepted_n": len(per_cand),
    }

    # --- multi-char bound from live utterances ---
    bound_mc_priors = []
    bound_mc_examples = []
    finespan_1_lex = 0
    finespan_1_fb = 0
    mc_bind_n = 0
    utt_n = 0
    for line in UTTERANCES.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        utt_n += 1
        paths = (rec.get("path_trace") or {}).get("paths") or []
        if not paths:
            continue
        path = paths[0]
        for fs in path.get("finespans") or []:
            st = fs.get("source_text") or ""
            if len(st) == 1:
                src = fs.get("window_source")
                if src == "fallback":
                    finespan_1_fb += 1
                else:
                    finespan_1_lex += 1
        items = []
        items.extend((path.get("base_candidates") or {}).get("items") or [])
        items.extend((path.get("after_model2_candidates") or {}).get("items") or [])
        seen = set()
        for it in items:
            tid = it.get("termId")
            surf = it.get("surface") or ""
            if len(surf) < 2:
                continue
            key = (tid, surf, it.get("rawStart"), it.get("rawEnd"))
            if key in seen:
                continue
            seen.add(key)
            pr = sqlite["prior_by_term_id"].get(tid)
            if pr is None:
                continue
            mc_bind_n += 1
            bound_mc_priors.append(pr)
            if len(bound_mc_examples) < 40:
                bound_mc_examples.append(
                    {
                        "dialog_id": rec.get("dialog_id"),
                        "surface": surf,
                        "termId": tid,
                        "length": len(surf),
                        "priorScore": pr,
                        "minPrior": MIN_PRIOR,
                        "passed_minPrior": pr >= MIN_PRIOR,
                        "source": it.get("source"),
                        "provenance": it.get("provenance"),
                        "hitKind": it.get("hitKind"),
                    }
                )
    bound_mc_stats = dist_stats(bound_mc_priors)
    coverage["bound_multichar_live"] = {
        "n": bound_mc_stats["n"],
        "prior": bound_mc_stats,
        "ge_0_5": bound_mc_stats["ge_0_5"],
    }
    coverage["path0_1char_finespan_lexical"] = finespan_1_lex
    coverage["path0_1char_finespan_fallback"] = finespan_1_fb
    write_json(OUT / "prior_threshold_coverage.json", coverage)
    write_json(
        OUT / "bind_multichar_comparison.json",
        {
            "live_utterances_scanned": utt_n,
            "path0_bound_multichar_with_term_prior": mc_bind_n,
            "prior": bound_mc_stats,
            "examples": bound_mc_examples,
            "minPrior": MIN_PRIOR,
            "note": "Multi-char path candidates joined to sqlite prior_score by termId. Length-1 path FineSpans remain fallback-only in this live run.",
        },
    )

    # --- CF0 / CF1 ---
    utt_edge_counts = [len(v) for v in by_utt_cf1.values()]
    # Include utterances with 0 accepts among those that have windows
    utt_with_windows = sorted({w.get("utterance_id") for w in windows})
    all_utt_counts = []
    acc_by_utt = {k: len(v) for k, v in by_utt_cf1.items()}
    for uid in utt_with_windows:
        all_utt_counts.append(acc_by_utt.get(uid, 0))

    cf0 = {
        "variant": "CF0_CURRENT",
        "minPrior": MIN_PRIOR,
        "lexical_1char_edges": finespan_1_lex,
        "collector_accepted": len(per_cand),
        "would_pass_minPrior": 0,
        "fallback_1char_finespan": finespan_1_fb,
        "note": "Production bind drops all 2331 accepts.",
    }
    write_json(OUT / "bind_length1_counterfactual_current.json", cf0)

    subst_unique = sum(
        1 for r in per_cand if r["accept_mode"] == "ACCEPT_UNIQUE_TONE_EXACT" and r["substitution"]
    )
    ident_unique = sum(
        1 for r in per_cand if r["accept_mode"] == "ACCEPT_UNIQUE_TONE_EXACT" and r["identity"]
    )
    expected_pairs = {
        (u.get("dialog_id"), u.get("expected_text"))
        for u in target_units
        if u.get("collector_selected") == u.get("expected_text") and u.get("expected_text")
    }
    wrong_subst = 0
    expected_subst = 0
    for r in per_cand:
        if not r["substitution"]:
            continue
        if (r["dialog_id"], r["selectedCandidate"]) in expected_pairs:
            expected_subst += 1
        elif r["accept_mode"] == "ACCEPT_UNIQUE_TONE_EXACT":
            wrong_subst += 1

    cf1 = {
        "variant": "CF1_BIND_ACCEPTED_LENGTH1_WITHOUT_CHANGING_PRIOR",
        "production_change": False,
        "minPrior_unchanged": MIN_PRIOR,
        "priorScore_unchanged": True,
        "if_accepted_length1_could_bind": len(per_cand),
        "edge_count_mean": (sum(all_utt_counts) / len(all_utt_counts)) if all_utt_counts else 0,
        "edge_count_p50": percentile(all_utt_counts, 50),
        "edge_count_p95": percentile(all_utt_counts, 95),
        "edge_count_max": max(all_utt_counts) if all_utt_counts else 0,
        "utterances_with_windows": len(utt_with_windows),
        "identity_edges": identity_n,
        "substitution_edges": subst_n,
        "expected_correction_edges_upper_bound": expected_from_flag,
        "potential_wrong_substitution_opportunities": wrong_subst,
        "candidate_explosion": False,
        "candidate_explosion_reason": "Collector cap=1 already; CF1 adds at most 1 lexical edge per accepted 1-char window. Not a fuzzy TopK explosion. Path/sentence explosion not simulated (would require FineSpan/Assembly replay).",
        "new_lattice_path_count": "NOT_SIMULATED",
        "sentence_candidate_count": "NOT_SIMULATED",
        "note": "Offline assumption only: collector-accepted length-1 hits skip generic minPrior. Not a production proposal.",
    }
    write_json(OUT / "bind_length1_counterfactual_allow_accepted.json", cf1)
    write_json(
        OUT / "bind_length1_candidate_volume_impact.json",
        {
            "cf0_lexical_1char_edges": 0,
            "cf1_lexical_1char_edges": len(per_cand),
            "delta": len(per_cand),
            "per_utterance": {
                "mean": cf1["edge_count_mean"],
                "p50": cf1["edge_count_p50"],
                "p95": cf1["edge_count_p95"],
                "max": cf1["edge_count_max"],
                "n_utterances": len(utt_with_windows),
            },
            "candidate_explosion": "NO",
            "path_count_simulated": False,
        },
    )
    write_json(
        OUT / "bind_length1_expected_coverage_upper_bound.json",
        {
            "true_recall_length1_target_sites": len(target_units),
            "collector_expected_surface_selected": expected_from_flag,
            "cf1_expected_lexical_edges_upper_bound": expected_from_flag,
            "cf1_does_not_equal_useful_repairs": True,
            "warning": "Do not interpret 2331 bindable accepts as 2331 repairs. Collector expected-surface accept remains ~2/213.",
        },
    )
    write_json(
        OUT / "bind_length1_substitution_risk.json",
        {
            "substitution_edges_if_cf1": subst_n,
            "identity_edges_if_cf1": identity_n,
            "unique_tone_substitution": subst_unique,
            "unique_tone_identity": ident_unique,
            "potential_wrong_substitution_opportunities": wrong_subst,
            "expected_substitution_among_accepts": expected_subst,
            "examples_wrong_unique_tone": [
                {
                    "dialog_id": r["dialog_id"],
                    "windowText": r["windowText"],
                    "selectedCandidate": r["selectedCandidate"],
                    "priorScore": r["priorScore"],
                }
                for r in per_cand
                if r["accept_mode"] == "ACCEPT_UNIQUE_TONE_EXACT" and r["substitution"]
            ][:25],
        },
    )
    write_json(
        OUT / "bind_length1_downstream_counterfactual.json",
        {
            "status": "NOT_RUN",
            "reason": "Safe Assembly/KenLM replay would require injecting CF1 edges into production lattice without changing production data. This audit does not mutate runtime or re-run ASR. Downstream potential improvements/regressions therefore remain unmeasured.",
            "potential_final_changes": "UNKNOWN",
            "potential_improvements": "UNKNOWN — expected-target upper bound is 2 sites",
            "potential_regressions": "UNKNOWN quantitatively; unique-tone substitutions (e.g. 好→毫, 我→涡) are qualitative wrong-substitution opportunities if they became selected-path edges.",
        },
    )

    # --- static inventories / contracts ---
    code_rows = [
        {
            "file": "electron_node/electron-node/main/src/fw-detector/fw-config.ts",
            "function": "loadFwDetectorRuntimeConfig",
            "value": "cfg.minPrior ?? 0.5",
            "default": "0.5",
            "caller": "fw-detector-orchestrator / v4-path",
            "candidate_lengths_affected": "all (1–5) via bind",
            "runtime_active": "YES",
            "historical": "NO",
            "frozen_evidence": "docs/fw-detector/CONFIG.md operational key; Recall_Subsystem_Frozen_Contract_2026_08_03 forbids changing minPrior without snapshot",
        },
        {
            "file": "electron_node/electron-node/main/src/fw-detector/span-assembly-v4/recall-topk-for-windows.ts",
            "function": "bindLexiconHitsToWindow",
            "value": "hit.hotword.priorScore >= input.minPrior",
            "default": "caller-supplied (0.5)",
            "caller": "recallTopKForWindows after collector/enumerator",
            "candidate_lengths_affected": "all hits, no length branch",
            "runtime_active": "YES",
            "historical": "NO",
            "frozen_evidence": "Recall enumerator freeze 2026-08-03; no length-1 bypass in Lattice CR 1.0.2+",
        },
        {
            "file": "electron_node/electron-node/main/src/fw-detector/fw-detector-orchestrator.ts",
            "function": "orchestrator wiring",
            "value": "config.minPrior",
            "default": "0.5",
            "caller": "FW V4 path",
            "candidate_lengths_affected": "all",
            "runtime_active": "YES",
            "historical": "NO",
            "frozen_evidence": "passes operational minPrior into lattice",
        },
        {
            "file": "electron_node/electron-node/main/src/fw-detector/fw-detector-v4-path.ts",
            "function": "run V4 path",
            "value": "config.minPrior",
            "default": "0.5",
            "caller": "lattice-fine-span-runtime / orchestrator",
            "candidate_lengths_affected": "all",
            "runtime_active": "YES",
            "historical": "NO",
            "frozen_evidence": "passthrough",
        },
        {
            "file": "electron_node/electron-node/main/src/fw-detector/span-assembly-v4/lattice-fine-span-runtime.ts",
            "function": "runLatticeFineSpanGeneration",
            "value": "input.minPrior",
            "default": "0.5",
            "caller": "recallTopKForWindows",
            "candidate_lengths_affected": "all",
            "runtime_active": "YES",
            "historical": "NO",
            "frozen_evidence": "passthrough; FineSpan does not own threshold",
        },
        {
            "file": "electron_node/electron-node/main/src/lexicon/local-span-recall.ts",
            "function": "recallSpanTopK",
            "value": "h.priorScore >= minPrior",
            "default": "caller",
            "caller": "legacy local-span-recall",
            "candidate_lengths_affected": "2–5 only (MIN_SYLLABLES=2)",
            "runtime_active": "NO (lexiconRecall.enabled=false; length-1 never enters)",
            "historical": "YES",
            "frozen_evidence": "legacy enumerator; same numeric gate, not length-1 path",
        },
        {
            "file": "docs/fw-detector/CONFIG.md",
            "function": "features.fwDetector.minPrior",
            "value": "0.5",
            "default": "0.5",
            "caller": "runtime config SSOT",
            "candidate_lengths_affected": "unspecified (all candidates)",
            "runtime_active": "YES (documentation)",
            "historical": "NO",
            "frozen_evidence": "classified as 运营 (lexicon operations), not KenLM-class framework freeze; Recall freeze still treats changing it as recall-contract change",
        },
        {
            "file": "docs/supporting/Recall_Subsystem_Frozen_Contract_2026_08_03.md",
            "function": "Candidate Enumerator pipeline",
            "value": "bindLexiconHitsToWindow (minPrior)",
            "default": "0.5",
            "caller": "frozen recall pipeline",
            "candidate_lengths_affected": "all enumerator hits",
            "runtime_active": "YES (contract)",
            "historical": "NO",
            "frozen_evidence": "Do not change minPrior without Framework Impact Audit + snapshot",
        },
        {
            "file": "docs/archive/HISTORICAL/FW_Repair_V4_Lexical_Connectivity_Repair_V1_Length_1_5_Recall_Consistency_Audit_2026_07_27.md",
            "function": "Prior / Whitelist recommendations",
            "value": "global minPrior 不降; canonical 单字 prior 0.85–0.95",
            "default": "0.5",
            "caller": "connectivity batch design (small whitelist, not 2510 IME TSV)",
            "candidate_lengths_affected": "length-1 connectivity chars + 2–5",
            "runtime_active": "NO (historical recommendation)",
            "historical": "YES",
            "frozen_evidence": "Explicitly forbid lowering minPrior; raise canonical prior instead. Does not authorize length-1 bypass.",
        },
        {
            "file": "electron_node/electron-node/main/src/fw-detector/span-assembly-v4/length1-recall-edge-path.sqlite.integration.test.ts",
            "function": "tests",
            "value": "minPrior: 0.5",
            "default": "0.5",
            "caller": "integration tests",
            "candidate_lengths_affected": "1 (fixtures with high prior)",
            "runtime_active": "NO (test)",
            "historical": "NO",
            "frozen_evidence": "Tests assume length-1 can pass 0.5 when fixture prior is canonical-high",
        },
        {
            "file": "electron_node/electron-node/main/src/fw-detector/span-assembly-v4/domain-presence-vote-acceptance.test.ts",
            "function": "tests",
            "value": "minPrior: 0",
            "default": "0 (test-only bypass)",
            "caller": "domain vote tests",
            "candidate_lengths_affected": "test fixtures",
            "runtime_active": "NO (test)",
            "historical": "NO",
            "frozen_evidence": "Test-only; not production length-1 bypass",
        },
        {
            "file": "electron_node/electron-node/scripts/lexicon/lib/full-rebuild-from-csv.mjs",
            "function": "loadSingleCharRows",
            "value": "prior_score = TSV weight || 0.12",
            "default": "0.12",
            "caller": "lexicon:full-rebuild (bundle 13 / 2510 import)",
            "candidate_lengths_affected": "length-1 inventory only",
            "runtime_active": "YES (data generation)",
            "historical": "NO",
            "frozen_evidence": "Aug-18 inventory import maps IME weight to prior_score; multi-char CSV default 0.9",
        },
    ]
    fields = [
        "file",
        "function",
        "value",
        "default",
        "caller",
        "candidate_lengths_affected",
        "runtime_active",
        "historical",
        "frozen_evidence",
    ]
    write_csv(OUT / "bind_minprior_code_inventory.csv", code_rows, fields)
    write_csv(OUT / "minprior_code_inventory.csv", code_rows, fields)

    write_text(
        OUT / "bind_minprior_frozen_design_reconstruction.md",
        """# minPrior frozen design reconstruction

**Audit date:** 2026-08-19  
**Stage:** FW_REPAIR_V4_BIND_MIN_PRIOR_LENGTH1_AUDIT  
**Type:** READ ONLY

## Owner of the numeric default

- Runtime default: `loadFwDetectorRuntimeConfig` → `cfg.minPrior ?? 0.5` (`fw-config.ts`).
- Config SSOT: `docs/fw-detector/CONFIG.md` lists `features.fwDetector.minPrior` as **运营** (“候选 prior 下限”), not a KenLM-class framework-frozen key.
- Recall freeze: `Recall_Subsystem_Frozen_Contract_2026_08_03.md` places `bindLexiconHitsToWindow (minPrior)` **after** SQLite → merge → score → TopK, and forbids changing minPrior without Framework Impact Audit + new snapshot.

Tension: CONFIG calls it operational; Recall freeze treats changing it as a frozen-recall change. This audit does not resolve that documentation tension and does **not** change the value.

## Original business purpose (from historical records, not reverse-engineered from 2026-08-18 0-yield)

Documented purpose is **low-confidence lexical noise control** on enumerator hits before they become WindowCandidates / FineSpan edges.

Evidence:

- LexicalEdge Quality Audit 2026-07-27: minPrior=0.5 dropped `麻烦` (prior=0.35, `homophone_variant`) and similar low-prior terms. Classified as candidate-filter, not Edge Builder defect. Repair guidance: raise canonical prior or review data; **do not lower global minPrior** as a connectivity workaround.
- Import Interface Audit 2026-07-27: Patch `addTerm` default `prior_score=0.85` so that only **explicitly low** priors are filtered. Semantic: operational lexicon authority / ranking score on a 0–1 scale compatible with 0.5.
- Length 1–5 Consistency Audit 2026-07-27: for **controlled connectivity** single-char, recommended prior **0.85–0.95 (≥ minPrior 0.5)** and **全局 minPrior 不降**. Ambiguity control for single-char was uniqueness / tone / cap=1 / no fuzzy / no domain — not a second prior model.

What it was **not** originally specified as:

- A single-char homophone disambiguator (that is collector uniqueness / tone exact / cap=1).
- An IME frequency cutoff.
- A FineSpan / Vote / Assembly / KenLM gate.
- A length-specific policy with a different threshold for length=1 vs 2+.

## Lattice CR 1.0.2+

Formal length-1 edges **must** come from operational lexicon Recall with a real termId. Collector is base-only, exact-only, no fuzzy, no domain, cap=1.

CR **does not** say “bypass minPrior for length-1”.  
CR **does not** define a length-specific prior threshold.

Length-specific prior policy: **CONTRACT_GAP**.

## 2510 import (2026-08-18)

Foundation report froze **which characters exist** (2510 from IME TSV) and routing (base-only exact). It did **not** freeze a remapping of IME `weight` onto the 0.85 operational prior scale, and it did **not** waive minPrior.

Rebuild code copies TSV `weight` (typically 0.08–0.30) into `prior_score`. Multi-char CSV terms still default to **0.9**.

## Conclusion for design reconstruction

minPrior=0.5 is a **generic bind-layer prior floor** owned by Candidate Binder / Recall pre-filter, designed against low operational priors and homophone_variant noise, historically kept even for length-1 **provided** length-1 operational priors sat at 0.85–0.95.

The 2510 IME-weight passthrough was not that historical prior contract. Combining the two frozen pieces yields zero lexical length-1 edges.
""",
    )

    write_text(
        OUT / "bind_minprior_ownership_matrix.md",
        """# minPrior ownership matrix

| Layer | Owns minPrior=0.5? | Owns length-1 candidate quality? | Notes |
|-------|--------------------|----------------------------------|-------|
| Lexicon Recall / collector | NO | YES | `collectBaseOnlySingleCharCandidate`: SQL, tone, uniqueness, surface exact, cap=1, minCandidateScore (default 0) |
| Candidate Binder `bindLexiconHitsToWindow` | **YES** | Applies same gate to collector output | No length branch |
| Lattice / FineSpan | NO | Consumes bound WindowCandidates | Formal length-1 needs termId from recall |
| Domain Vote | NO | Length-1 does not vote | |
| Assembly / KenLM / Budget / Model2 | NO | Downstream of bound candidates | Model2 **reads** `prior_score` as a feature if a candidate is bound; raising all 2510 priors would affect Model2 if those edges exist |

## OWNERSHIP_DRIFT_POSSIBLE

For length-1, collector already performs conservative noise control (exact-only, unique-or-surface-exact, cap=1, no fuzzy, no domain). Bind then applies a **generic** prior floor calibrated to operational 0.85-scale multi-char terms.

Bind is therefore doing a quality filter whose historical target (low operational prior / homophone_variant) is largely **already excluded** by the length-1 collector contract.

This is **OWNERSHIP_DRIFT_POSSIBLE**, recorded as a **secondary** finding. It is not IMPLEMENTATION_DRIFT: no freeze text required a length-1 minPrior bypass.
""",
    )

    write_json(
        OUT / "bind_length_semantics_audit.json",
        {
            "length_specific_prior_policy_in_frozen_contract": False,
            "length_specific_contract": "NO",
            "contract_gap": True,
            "length_1_minPrior_in_lattice_cr": "UNDEFINED",
            "length_1_minPrior_in_recall_freeze": "YES_UNIFORM_BIND_GATE",
            "length_2_plus_minPrior": "YES",
            "historical_length1_guidance": "Do not lower minPrior; set canonical single-char prior 0.85-0.95 (connectivity whitelist, not 2510 IME TSV)",
            "code_length_branch_in_bind": False,
        },
    )
    write_json(
        OUT / "single_char_bind_contract_evidence.json",
        {
            "lattice_cr_1_0_2_requires_minPrior_for_length1": "NOT_STATED",
            "lattice_cr_1_0_2_requires_bypass_minPrior": "NOT_STATED",
            "collector_frozen": {
                "base_only": True,
                "exact_only": True,
                "no_fuzzy": True,
                "no_domain": True,
                "cap_1": True,
            },
            "collector_already_noise_control": True,
            "extra_generic_minPrior_on_accepted_hits": True,
            "double_filtering": "YES_FOR_LENGTH1_NOISE",
            "implementation_drift_rule_met": False,
            "reason_not_drift": "No freeze evidence of length-1 bypass or length-1 minPrior < 0.5",
        },
    )

    write_text(
        OUT / "single_char_prior_source_audit.md",
        f"""# Single-char priorScore source audit

## Source TSV

Path: `docs/pinyin-v2/import/single_char_dictionary.tsv`

Columns: `{tsv['header']}`

| Field | Present |
|-------|---------|
| weight | {tsv['has_weight']} |
| frequency_rank | {tsv['has_frequency']} |
| score | {tsv['has_score']} |
| prior / prior_score | {tsv['has_prior']} |

TSV **does not** contain an operational `prior` column. It contains IME-layer `weight` plus `frequency_rank` and `single_char_role`.

TSV weight distribution: min={tsv['weight_stats']['min']} p50={tsv['weight_stats']['p50']} max={tsv['weight_stats']['max']} unique={tsv['weight_stats']['unique_values']}

Roles: {tsv['roles']}

## Transformation (full-rebuild-from-csv.mjs `loadSingleCharRows`)

```
weight = Number(cells[weight] || 0.12)
prior_score = finite(weight) && weight > 0 ? weight : 0.12
```

No normalization to 0–1 beyond the TSV's own scale.  
No clamp to ≥ minPrior.  
No remap onto the 0.85 Patch/CSV default.

## Multi-char contrast

CSV review terms: `prior_score` from file, else **0.9**.  
Supplemental terms: **0.9**.  
Idiom JSONL: `parsed.priorScore ?? 0.9`.

## Runtime

`lexicon-runtime-v2.ts` copies `row.prior_score` → `hotword.priorScore`.  
`bindLexiconHitsToWindow` compares that number to `minPrior` (0.5).

## Semantic meaning

| Object | Meaning |
|--------|---------|
| TSV `weight` | IME / frequency-class ranking mass (observed 0.08–0.30) |
| Operational `prior_score` (Patch/CSV) | Lexicon authority / recall ranking on a scale where default 0.85–0.9 ≥ minPrior 0.5 |
| Bind `minPrior` | Floor on operational prior before WindowCandidate materialization |

Storing IME `weight` in `prior_score` **mixes two score meanings**. The 0.08–0.30 band is therefore an **import mapping artifact**, not a sqlite clamp bug and not a hidden runtime rewrite.

## Matches which contract?

- Matches Aug-18 rebuild **code** that produced frozen inventory 2510: **YES**
- Matches July-27 operational canonical single-char prior **0.85–0.95**: **NO** (that contract was for a small connectivity whitelist, later superseded as inventory source by the 2510 TSV without remapping scores)
- Overall frozen-contract match: **UNCLEAR** (two contracts, different eras/inventories)
""",
    )

    write_text(
        OUT / "prior_generation_pipeline.md",
        """# Prior generation pipeline (length-1)

```
single_char_dictionary.tsv
  columns: surface, pinyin, tone_pinyin, weight, frequency_rank, single_char_role, ...
    → loadSingleCharRows (full-rebuild-from-csv.mjs)
        prior_score := weight || 0.12
    → INSERT term / base_lexicon
    → promote _rebuild_candidate → node_runtime/lexicon/v3/lexicon.sqlite (bundle 13)
    → LexiconRuntimeV2 row.prior_score → hotword.priorScore
    → collectBaseOnlySingleCharCandidate (does not gate on 0.5)
    → bindLexiconHitsToWindow: drop if priorScore < minPrior(0.5)
```

Default if weight missing/invalid: **0.12** (still < 0.5).

No training. No runtime normalization. No length-specific remap.
""",
    )

    write_text(
        OUT / "bind_lexicon_hits_decision_tree.md",
        """# bindLexiconHitsToWindow decision tree

Function: `recall-topk-for-windows.ts` `bindLexiconHitsToWindow`

```
for each hit in input.hits:          # length-1: at most 1 collector hit (cap=1)
  minPriorPassed = hit.hotword.priorScore >= input.minPrior   # default 0.5
  toneFields = recallHitToneFields(...)                       # penalty/rank only at this stage
  TRACE: pushRecallHitPreFilter (minPriorPassed, filterStage)
  if !minPriorPassed:
      continue                      # DROP — no WindowCandidate, no FineSpan lexical edge
  rank += 1
  convert hit → WindowCandidate (termId, replacement, score, domains, tone fields, ...)
return candidates
```

## Ordering vs collector

Length-1 path in `recallTopKForWindows`:

1. `collectBaseOnlySingleCharCandidate` (SQL / tone / uniqueness / surface exact / cap=1)
2. `bindLexiconHitsToWindow` (generic minPrior)

minPrior is therefore **after** collector accept, **before** FineSpan edge creation.  
It is **not** length-gated. The same numeric floor applies to 1-char exact hits and 2–5 enumerator hits.

## Semantic of dropping an already-accepted collector hit

Collector has already declared a unique-or-surface-exact base term. Bind then rejects it as “too low operational prior”. For the 2510 set this is a **scale mismatch**, not an additional uniqueness decision.
""",
    )

    write_json(
        OUT / "bind_double_gate_audit.json",
        {
            "gate_stack": [
                {"gate": "SQL match (tone WHERE, length=1, enabled)", "risk": "inventory miss / tone miss", "class": "COMPLEMENTARY"},
                {"gate": "tone ready / pattern present", "risk": "unsafe tone-less recall", "class": "COMPLEMENTARY"},
                {"gate": "tone exact", "risk": "wrong-tone homophone", "class": "COMPLEMENTARY"},
                {"gate": "uniqueness (eligible==1, not truncated)", "risk": "single-char ambiguity / mis-repair", "class": "COMPLEMENTARY"},
                {"gate": "surface exact (after uniqueness fail)", "risk": "identity-only rescue", "class": "COMPLEMENTARY"},
                {"gate": "collector minCandidateScore (default 0)", "risk": "score floor", "class": "COMPLEMENTARY", "live_reject_n": 0},
                {"gate": "cap=1", "risk": "candidate volume", "class": "COMPLEMENTARY"},
                {
                    "gate": "bind minPrior=0.5",
                    "risk": "low operational prior / homophone_variant noise (historical multi-char)",
                    "class": "REDUNDANT",
                    "note": "Redundant with collector noise control for frozen length-1 exact-only path; complementary for 2–5 fuzzy/homophone_variant. Live: drops 2331/2331 accepts.",
                },
                {"gate": "FineSpan bind / path selection", "risk": "graph connectivity", "class": "COMPLEMENTARY"},
            ],
            "double_filtering_length1": True,
            "minPrior_before_or_after_collector_accept": "AFTER",
        },
    )

    # --- decisions ---
    write_json(
        OUT / "bind_minprior_root_cause.json",
        {
            "primary_verdict": "FROZEN_CONTRACT_INCOMPATIBILITY",
            "secondary_finding": [
                "IME TSV weight stored as operational prior_score (semantic mix)",
                "OWNERSHIP_DRIFT_POSSIBLE: bind re-filters collector-accepted length-1 hits",
                "CONTRACT_GAP: no length-specific prior policy in Lattice CR",
            ],
            "not_implementation_drift": "No freeze text required length-1 bypass of minPrior.",
            "not_prior_data_bug": "2510 build matches the Aug-18 rebuild mapping (weight→prior_score). July-27 0.85–0.95 applied to a different (whitelist) inventory and was not the 2510 generation algorithm.",
            "not_working_as_designed_for_zero_lexical_edges": "Lattice 1.0.2 intends formal length-1 edges from operational recall; importing 2510 was to enable that. Zero yield is the combination of two contracts, not an explicit product goal of 0 lexical edges.",
            "evidence": [
                "bindLexiconHitsToWindow has no length branch; minPrior default 0.5",
                "2510 priorScore 0.08–0.30; >=0.5 count = 0",
                "2331/2331 collector accepts unbound",
                "path0 lexical 1-char FineSpan = 0",
                "2/3-char sqlite priors mostly >=0.5; live bound multi-char priors also >=0.5",
                "TSV has weight not prior; rebuild copies weight",
            ],
        },
    )
    write_json(
        OUT / "bind_minprior_change_decision.json",
        {
            "Change_minPrior": "NO / PROPOSAL_REQUIRED",
            "Change_single_char_prior": "NO / PROPOSAL_REQUIRED",
            "Restore_frozen_implementation": "NO",
            "Architecture_Contract_Change_Proposal": "YES",
            "Single_char_Collector_Change": "NO",
            "FineSpan_Change": "NO",
            "Lexicon_Inventory_Change": "NO",
            "Model2_Change": "NO",
            "Assembly_Change": "NO",
            "Budget_Change": "NO",
            "Training": "NO",
            "Recommended_Next_Phase": "ARCHITECTURE_CONTRACT_CHANGE_PROPOSAL_BIND_MINPRIOR_LENGTH1",
            "do_not": [
                "Do not lower 0.5 this round",
                "Do not raise 2510 priors this round (prior_score is also a Model2 feature if edges bind)",
                "Do not ship if length==1 bypass without user confirmation",
            ],
        },
    )
    write_json(
        OUT / "architecture_conformance_check.json",
        {
            "collector_frozen_semantics": "UNCHANGED",
            "bind_minPrior_uniform": "CONFORMING_TO_RECALL_FREEZE",
            "length1_prior_scale": "INCOMPATIBLE_WITH_MINPRIOR",
            "lattice_formal_length1_edges": "INTENDED_BUT_UNREACHABLE_UNDER_COMBINED_CONTRACTS",
            "primary_verdict": "FROZEN_CONTRACT_INCOMPATIBILITY",
        },
    )
    write_json(
        OUT / "frozen_component_change_check.json",
        {
            "minPrior": "UNCHANGED",
            "priorScore": "UNCHANGED",
            "single_char_inventory_2510": "UNCHANGED",
            "single_char_collector": "UNCHANGED",
            "FineSpan": "UNCHANGED",
            "lattice": "UNCHANGED",
            "Model2": "UNCHANGED",
            "Assembly": "UNCHANGED",
            "Domain_Vote": "UNCHANGED",
            "Candidate_Budget": "UNCHANGED",
            "KenLM": "UNCHANGED",
            "Lexicon_schema": "UNCHANGED",
            "Normalization": "UNCHANGED",
            "MATERIALIZABLE_TARGET_V1": "UNCHANGED",
            "Training": "NO",
            "this_round": "READ_ONLY_AUDIT_ARTIFACTS_ONLY",
        },
    )
    write_csv(
        OUT / "modified_file_inventory.csv",
        [
            {
                "path": "docs/user_correction/scripts/bind_minprior_length1_audit.py",
                "role": "read-only audit postprocess",
                "behavior_change": "no",
            },
            {
                "path": "docs/user_correction/Lingua_FW_Repair_V4_Bind_MinPrior_Length1_Audit_2026_08_19.md",
                "role": "audit report",
                "behavior_change": "no",
            },
            {
                "path": "training/model2_v3/experiments/v3_stage_j_live_dialog200/bind_minprior_length1_audit_2026_08_19/",
                "role": "audit artifacts",
                "behavior_change": "no",
            },
        ],
        ["path", "role", "behavior_change"],
    )

    go = {
        "Bind MinPrior Length-1 Audit": "CONTRACT_INCOMPATIBILITY",
        "primary_verdict": "FROZEN_CONTRACT_INCOMPATIBILITY",
        "current_minPrior": MIN_PRIOR,
        "single_char_n": sqlite["len1_n"],
        "single_char_prior_min": sc_dist["min"],
        "single_char_prior_p50": sc_dist["p50"],
        "single_char_prior_p95": sc_dist["p95"],
        "single_char_prior_max": sc_dist["max"],
        "single_char_ge_0_5": sc_dist["ge_0_5"],
        "collector_accepted": len(per_cand),
        "would_pass_minPrior": sum(1 for r in per_cand if r["wouldBindAtCurrentThreshold"]),
        "identity": identity_n,
        "substitution": subst_n,
        "expected_target_candidate": expected_from_flag,
        "cf1_edges": len(per_cand),
        "path0_lexical_1char": finespan_1_lex,
        "next_phase": "ARCHITECTURE_CONTRACT_CHANGE_PROPOSAL_BIND_MINPRIOR_LENGTH1",
        "multichar_bound_prior": bound_mc_stats,
        "len2_p50": prior_by_len["2"]["p50"],
        "len3_p50": prior_by_len["3"]["p50"],
        "cf1": {
            "mean": cf1["edge_count_mean"],
            "p95": cf1["edge_count_p95"],
            "max": cf1["edge_count_max"],
            "wrong_subst": wrong_subst,
        },
    }
    write_json(OUT / "go_summary.json", go)

    # --- report ---
    fmt = lambda x: "n/a" if x is None else (round(x, 6) if isinstance(x, float) else x)
    mc_range = (
        f"{bound_mc_stats['min']}–{bound_mc_stats['max']}" if bound_mc_stats["n"] else "n/a"
    )
    report = f"""# Lingua FW Repair V4 — Bind minPrior Length-1 Audit

**Date:** 2026-08-19  
**Stage:** `FW_REPAIR_V4_BIND_MIN_PRIOR_LENGTH1_AUDIT`  
**Type:** AUDIT ONLY / READ ONLY  
**Artifacts:** `training/model2_v3/experiments/v3_stage_j_live_dialog200/bind_minprior_length1_audit_2026_08_19/`

本轮不改 minPrior、priorScore、collector、FineSpan、库存、Model2、Assembly、Budget、KenLM，也不训练。

权威 live 仍是 2026-08-18 collector 审计：1-char windows **4477**，collector accept **2331**，accept 后 bind **2331/2331** 因 `priorScore < 0.5` 丢弃。dialog_200：**199 INVOKED + d192 pipeline 504**（基础设施，不改业务）。

---

## 0. 五个问题的答案

### A. minPrior=0.5 的设计 owner

**Candidate Binder / Recall pre-filter**，函数 `bindLexiconHitsToWindow`。  
默认来自 `fw-config.ts`：`cfg.minPrior ?? 0.5`。  
CONFIG.md 把它标成词库**运营**键；Recall 冻结合同又规定改 minPrior 必须走 Framework Impact Audit。FineSpan / Vote / Assembly / KenLM **不拥有**该阈值。

### B. 原始针对什么

历史记录（2026-07-27 LexicalEdge / Import / Length-1-5 审计）表明：防止 **低 operational prior 的词库噪声**（例如 `麻烦` prior=0.35、`homophone_variant`），以及默认 Patch/CSV prior **0.85–0.9** 下“只有显式低 prior 才被滤”。

不是：单字歧义闸（那是 uniqueness / tone / cap=1）；不是 fuzzy 爆炸闸（fuzzy min=2）；不是 FineSpan 边质量公式。

### C. 冻结单字设计是否要求同一 minPrior=0.5

代码：**是**，bind **无** length 分支。  
Lattice CR 1.0.2：**未写** bypass，也**未写** length-1 必须用 0.5。  
历史连通性审计：**禁止降 minPrior**，要求受控单字 prior 0.85–0.95。  

冻结 length-specific prior policy：**CONTRACT_GAP**（文档未定义 length=1 与 2+ 是否应不同阈值）。  
因此 “Applies To Length-1 By Frozen Design” = 对 **统一 bind 闸** 为 YES；对 **专门 length-1 政策** 为 UNDEFINED。本报告主字段取统一闸：**YES**（无 bypass 证据）。

### D. 为什么 2510 行全是 0.08–0.30

IME TSV `weight` 被 Full Rebuild **原样写入** `prior_score`（缺省 0.12）。TSV **没有** `prior` 列。  
这符合 Aug-18 导入**实现**，不符合 July-27 运营 prior 0.85 标尺。不是 sqlite 运行时 clamp。

### E. 若只让 2331 个已 accept 的单字进入 bind（不改 prior）

离线 CF1（非提案）：最多 **2331** 条 lexical 1-char 边（每窗 cap=1）。  
每句 mean / P95 / max 见下文。**不是** fuzzy 候选爆炸。  
其中大量是 **identity**（ASR 字→同字）；unique-tone 替换里多数 **不是** expected 修复。  
true-recall 目标位 expected 表面仍约 **2/213**。恢复 materialization ≠ 大规模纠错。

---

## 1. Primary verdict

**FROZEN_CONTRACT_INCOMPATIBILITY**

- minPrior=0.5 用于全部 bind hits：符合 Recall 冻结流水线，且历史明确禁止为了单字连通性去降阈值。  
- 2510 prior=IME `weight`（0.08–0.30）：符合 Aug-18 库存导入算法，并随 bundle 13 冻结。  
- 二者组合：**0** 个单字能过 0.5 → lexical 1-char FineSpan=0。

不是 IMPLEMENTATION_DRIFT（没有“length-1 应绕过 minPrior”的冻结条文）。  
不是 PRIOR_DATA_BUG（2510 生成算法就是 weight 直通，不是相对该算法的 build 错误）。  
不是 WORKING_AS_DESIGNED 去解释“产品故意要 0 条 lexical 单字边”（Lattice 1.0.2 要求正式 length-1 边来自带 termId 的 operational recall；导入 2510 的目的是让这条路径存在）。

次要发现：OWNERSHIP_DRIFT_POSSIBLE；IME weight 与 operational prior **语义混用**。

---

## 2. 产品护栏

Collector 在 213 个 true-recall 单字目标上选出 **expected 表面仅 2**。  
即使未来允许 2331 条边 bind，也只是 **恢复 lexical 1-char edge materialization**。  
不得表述为“修 minPrior 后单字 recall/纠错就解决了”。

---

Bind MinPrior Length-1 Audit:
CONTRACT_INCOMPATIBILITY


================================================
MINPRIOR
================================================

Current minPrior:
0.5


Owner:
Candidate Binder (bindLexiconHitsToWindow) / Recall pre-filter; config default fw-config.ts; CONFIG.md 运营键; Recall freeze 2026-08-03 变更需 snapshot


Original Purpose:
Filter low operational-prior lexical noise (e.g. homophone_variant / 麻烦 0.35) after enumerator, before WindowCandidate. Not a single-char ambiguity gate.


Applies To Length-1 By Frozen Design:
YES


Applies To Length-2+:
YES


Length-Specific Contract:
NO


================================================
PRIOR SCORE
================================================

Single-char N:
{sqlite['len1_n']}


Single-char Prior Min:
{fmt(sc_dist['min'])}


P50:
{fmt(sc_dist['p50'])}


P95:
{fmt(sc_dist['p95'])}


Max:
{fmt(sc_dist['max'])}


>=0.5:
{sc_dist['ge_0_5']} / {sc_dist['n']} ({fmt(sc_dist['ge_0_5_rate'])})


Prior Source:
IME TSV column `weight` copied to sqlite `prior_score` by loadSingleCharRows (default 0.12). Not frequency-normalized operational confidence. Multi-char CSV default remains 0.9.


Prior Generation Matches Frozen Contract:
UNCLEAR


================================================
MULTI-CHAR COMPARISON
================================================

2-char Prior P50:
{fmt(prior_by_len['2']['p50'])}


3-char Prior P50:
{fmt(prior_by_len['3']['p50'])}


Bound Multi-char Prior Range:
{mc_range} (n={bound_mc_stats['n']}; >=0.5: {bound_mc_stats['ge_0_5']})


minPrior Appropriate For Multi-char:
YES


================================================
2331 ACCEPTED
================================================

Collector Accepted:
{len(per_cand)}


Would Pass minPrior=0.5:
{sum(1 for r in per_cand if r['wouldBindAtCurrentThreshold'])}


Surface-Exact:
{accept_mode_prior['n_surface_exact']}


Unique-Tone:
{accept_mode_prior['n_unique_tone']}


Identity Candidate:
{identity_n}


Substitution Candidate:
{subst_n}


Expected Target Candidate:
{expected_from_flag}


================================================
COUNTERFACTUAL
================================================

Current Lexical 1-char Edges:
{finespan_1_lex}


If Accepted Length-1 Could Bind:
{len(per_cand)}


Edge Count Mean:
{fmt(cf1['edge_count_mean'])}


Edge Count P95:
{fmt(cf1['edge_count_p95'])}


Edge Count Max:
{fmt(cf1['edge_count_max'])}


Identity Edges:
{identity_n}


Substitution Edges:
{subst_n}


Expected Correction Edges:
{expected_from_flag}


Potential Wrong Substitution Opportunities:
{wrong_subst}


Candidate Explosion:
NO


================================================
ROOT CAUSE
================================================

Primary Verdict:

FROZEN_CONTRACT_INCOMPATIBILITY


Evidence:
Uniform bind minPrior=0.5 with no length bypass (Recall freeze). 2510 priors are IME TSV weights 0.08–0.30 by Aug-18 rebuild. 0/2510 and 0/2331 pass 0.5. Multi-char operational priors sit at ~0.9 and do pass. Lattice CR never waived minPrior and never redefined IME weight as operational prior.


================================================
DECISION
================================================

Change minPrior:
NO / PROPOSAL_REQUIRED


Change Single-char Prior:
NO / PROPOSAL_REQUIRED


Restore Frozen Implementation:
NO


Architecture / Contract Change Proposal:
YES


Single-char Collector Change:
NO


FineSpan Change:
NO


Lexicon Inventory Change:
NO


Model2 Change:
NO


Assembly Change:
NO


Budget Change:
NO


Training:
NO


Recommended Next Phase:
ARCHITECTURE_CONTRACT_CHANGE_PROPOSAL_BIND_MINPRIOR_LENGTH1 (user confirmation required; do not ship length==1 bypass or global prior lift)

---

## Appendix notes

- Surface-exact accept prior P50: {fmt(accept_mode_prior['ACCEPT_SURFACE_EXACT']['p50'])}; unique-tone P50: {fmt(accept_mode_prior['ACCEPT_UNIQUE_TONE_EXACT']['p50'])}. Both bands remain <0.5; neither accept path is uniquely “too low”.
- Identity edges would add lexical copies of the ASR character; they do not by themselves repair true-recall substitutions.
- Unique-tone substitutions include live examples such as 好→毫 / 我→涡: if bound, they are wrong-substitution opportunities, not expected repairs.
- Downstream Assembly/KenLM CF: **NOT_RUN** (would require lattice mutation or production replay).
- d192: infrastructure-only; this audit reused 4477 windows and did not retry ASR.
"""
    write_text(REPORT, report)
    write_text(OUT / "Lingua_FW_Repair_V4_Bind_MinPrior_Length1_Audit_2026_08_19.md", report)
    print(json.dumps({k: go[k] for k in go if k != "multichar_bound_prior"}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
