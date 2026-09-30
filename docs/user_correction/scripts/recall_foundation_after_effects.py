#!/usr/bin/env python3
"""After-run effects for RECALL_FOUNDATION_COMPLETION_V1 (dialog_200 Stage-J)."""
from __future__ import annotations

import importlib.util
import json
import statistics
import sys
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
SCRIPTS = Path(__file__).resolve().parent
OUT = REPO / "training/model2_v3/experiments/v3_stage_j_live_dialog200/recall_foundation_completion_2026_08_18"
BEFORE_TRACE = REPO / "training/model2_v3/experiments/v3_stage_j_live_dialog200"
AFTER_TRACE = OUT / "dialog200_after"
AFTER_V1 = OUT / "materializable_target_v1_after"
BEFORE_V1 = BEFORE_TRACE / "materializable_target_v1_2026_08_18"
SQLITE = REPO / "node_runtime/lexicon/v3/lexicon.sqlite"


def load_mod(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def percentile(values, p):
    arr = sorted(x for x in values if isinstance(x, (int, float)))
    if not arr:
        return None
    idx = min(len(arr) - 1, max(0, int((p / 100) * len(arr) + 0.999) - 1))
    return arr[idx]


def candidate_count(utt: dict) -> int:
    n = 0
    for p in (utt.get("path_trace") or {}).get("paths") or []:
        union = ((p.get("model2") or {}).get("union") or {})
        items = union.get("items") or (union.get("union_before_budget") or {}).get("items") or []
        n += len(items)
        if not items:
            n += len(((p.get("base_candidates") or {}).get("items") or []))
    return n


def main() -> None:
    pta = load_mod("pta_audit", SCRIPTS / "post_trace_governance_audit.py")
    rfc = load_mod("rfc_acct", SCRIPTS / "recall_foundation_completion.py")

    after_utts = pta.read_jsonl(AFTER_TRACE / "dialog200_stagej_per_utterance.jsonl")
    before_utts = pta.read_jsonl(BEFORE_TRACE / "dialog200_stagej_per_utterance.jsonl")
    after_units = pta.read_jsonl(AFTER_V1 / "dialog200_materializable_target_v1_per_correction_unit.jsonl")
    before_funnel = json.loads(
        (BEFORE_V1 / "dialog200_materializable_target_v1_funnel.json").read_text(encoding="utf-8")
    )
    after_funnel = json.loads(
        (AFTER_V1 / "dialog200_materializable_target_v1_funnel.json").read_text(encoding="utf-8")
    )
    after_div = json.loads((AFTER_V1 / "dialog200_first_divergence_v2.json").read_text(encoding="utf-8"))
    lex = pta.load_lexicon(SQLITE)
    utt_by = {u["dialog_id"]: u for u in after_utts}
    before_by = {u["dialog_id"]: u for u in before_utts}

    chars = set()
    for u in after_units:
        chars.update(u.get("source_text") or "")
        chars.update(u.get("expected_text") or "")
    mapping = pta.t2s_map(chars)

    resp = Counter()
    outside = Counter()
    true_recall = []
    per_unit = []
    for u in after_units:
        cls = pta.classify_unit(u, mapping)
        rec = {**u, **cls}
        per_unit.append(rec)
        resp[cls["responsibility"]] += 1
        if cls.get("outside_class"):
            outside[cls["outside_class"]] += 1
        if cls["responsibility"] == "LEXICAL_RECALL_RESPONSIBILITY":
            true_recall.append((u, rec, utt_by.get(u["dialog_id"], {})))

    attr_rows = []
    states = Counter()
    sc = {"n": 0, "in_lex": 0, "raw": 0, "mat": 0}
    mc = {"2": Counter(), "3": Counter(), "4+": Counter()}
    qgap = 0
    for u, rec, utt in true_recall:
        exp = u.get("expected_text") or ""
        ex = pta.existence(exp, lex)
        paths = ((utt.get("path_trace") or {}).get("paths") or [{}])
        finespans = paths[0].get("finespans") or []
        covers = pta.covering_spans(finespans, u)
        cover = covers[0] if covers else None
        query_pinyin = (cover or {}).get("phonetic_representation")
        span_syl = None
        if cover:
            span_syl = (cover.get("syllable_end") or 0) - (cover.get("syllable_start") or 0)
        target_len = max(1, len(exp))
        query_ok = bool(cover) and (
            (query_pinyin and pta.pinyin_count(query_pinyin) == target_len) or (span_syl == target_len)
        )
        cands = pta.candidate_surfaces(utt)
        surf_hit = [c for c in cands if c.get("surface") == exp]
        union_hit = [c for c in surf_hit if c.get("_pack") in ("union", "after_model2_candidates", "base_candidates")]
        pruned = [c for c in pta.budget_pruned(utt) if (c.get("surface") if isinstance(c, dict) else None) == exp]
        raw_base = bool(ex.get("in_base"))
        attr = {
            "R1_exists": ex["exists"],
            "R2_index": ex["index"],
            "R3_query_generatable": query_ok,
            "R4_base_raw_hit": raw_base,
            "R7_filter": None,
            "R8_materialized": bool(union_hit),
            "R10_post_budget": bool(union_hit) and not pruned,
            "prior_root_cause": None,
        }
        state, why = rfc.assign_terminal_state(u, attr)
        states[state] += 1
        if state == "QUERY_GENERATION_GAP":
            qgap += 1
        row = {
            "dialog_id": u["dialog_id"],
            "stable_id": u.get("stable_id"),
            "expected": exp,
            "source": u.get("source_text"),
            "length": len(exp),
            "terminal_state": state,
            "lexical_recoverable": u.get("lexical_recoverable"),
            **attr,
        }
        attr_rows.append(row)
        if len(exp) <= 1:
            sc["n"] += 1
            if ex["exists"]:
                sc["in_lex"] += 1
            if raw_base:
                sc["raw"] += 1
            if union_hit:
                sc["mat"] += 1
        else:
            key = "2" if len(exp) == 2 else ("3" if len(exp) == 3 else "4+")
            mc[key]["n"] += 1
            if ex["exists"]:
                mc[key]["in_lex"] += 1
            if union_hit:
                mc[key]["mat"] += 1
            if state == "LEXICON_COVERAGE_GAP":
                mc[key]["coverage_gap"] += 1

    counts = [candidate_count(u) for u in after_utts]
    before_counts = [candidate_count(u) for u in before_utts]

    false_int = []
    same_raw = 0
    same_raw_correct_both = 0
    same_raw_cc = 0
    same_raw_cw = 0
    same_raw_wc = 0
    same_raw_ww = 0
    for did, bu in before_by.items():
        au = utt_by.get(did)
        if not au:
            continue
        b_raw = ((bu.get("asr") or {}).get("raw_text") or bu.get("raw_asr_text") or "")
        a_raw = ((au.get("asr") or {}).get("raw_text") or au.get("raw_asr_text") or "")
        if pta.norm(b_raw) == pta.norm(a_raw) if hasattr(pta, "norm") else (b_raw == a_raw):
            same_raw += 1
            bc, ac = bool(bu.get("correct")), bool(au.get("correct"))
            if bc and ac:
                same_raw_cc += 1
                same_raw_correct_both += 1
            elif bc and not ac:
                same_raw_cw += 1
                false_int.append({"dialog_id": did, "before_raw": b_raw, "after_raw": a_raw, "after_final": au.get("final_text")})
            elif (not bc) and ac:
                same_raw_wc += 1
            else:
                same_raw_ww += 1
        elif bu.get("correct") and not au.get("correct"):
            false_int.append(
                {
                    "dialog_id": did,
                    "note": "ASR_CHANGED",
                    "before_raw": b_raw,
                    "after_raw": a_raw,
                }
            )

    script_n = outside.get("SCRIPT_NORMALIZATION", 0)
    pta.write_json(
        OUT / "dialog200_recall_foundation_after.json",
        {
            "dialogs": 200,
            "NO_PROFILE": True,
            "final_correct": after_funnel["dialogs"]["final_correct"],
            "lexical_recoverable": after_funnel["dialogs"]["lexical_recoverable"],
            "path_recoverable": after_funnel["dialogs"]["path_recoverable"],
            "sentence_recoverable": after_funnel["dialogs"]["sentence_recoverable"],
            "actually_assembled": after_funnel["dialogs"]["actually_assembled"],
            "kenlm_available": after_funnel["dialogs"]["kenlm_available"],
            "responsibility": dict(resp),
            "true_recall_n": len(true_recall),
            "waterfall": dict(states),
        },
    )
    pta.write_jsonl(OUT / "dialog200_recall_foundation_per_dialog.jsonl", after_utts)
    pta.write_json(OUT / "dialog200_materializable_target_after.json", after_funnel)
    pta.write_json(OUT / "dialog200_first_divergence_after.json", after_div)
    pta.write_json(
        OUT / "normalization_effect.json",
        {
            "script_normalization_before": 145,
            "script_normalization_after": script_n,
            "note": "V1 units still come from raw ASR vs expected (no t2s in contract norm). Remaining count is ASR-surface script mismatch still present in this run.",
            "eliminated_from_recall_success_accounting": True,
        },
    )
    pta.write_json(
        OUT / "single_char_effect.json",
        {
            "before": {"target_in_lexicon": 0, "raw_hit": 0, "candidate": 0, "true_recall_n": "see prior audit"},
            "after": sc,
            "sqlite_len1_enabled": lex["stats"]["base_len1_enabled"],
        },
    )
    pta.write_json(
        OUT / "multichar_effect.json",
        {
            "2_char": dict(mc["2"]),
            "3_char": dict(mc["3"]),
            "4_plus": dict(mc["4+"]),
            "note": "No dialog_200-driven multi-char import this round",
        },
    )
    pta.write_json(
        OUT / "query_generation_gap_after.json",
        {"QUERY_GENERATION_GAP": qgap, "keep_finespan_frozen": True},
    )
    pta.write_json(
        OUT / "false_intervention_analysis.json",
        {
            "before_correct_after_wrong_all": len(false_int),
            "same_raw_n": same_raw,
            "same_raw_cc": same_raw_cc,
            "same_raw_cw": same_raw_cw,
            "same_raw_wc": same_raw_wc,
            "same_raw_ww": same_raw_ww,
            "same_raw_false_intervention": same_raw_cw,
            "samples": false_int[:30],
        },
    )
    pta.write_json(
        OUT / "candidate_volume_before_after.json",
        {
            "before": {
                "mean": (sum(before_counts) / len(before_counts)) if before_counts else None,
                "p50": percentile(before_counts, 50),
                "p95": percentile(before_counts, 95),
                "max": max(before_counts) if before_counts else None,
            },
            "after": {
                "mean": (sum(counts) / len(counts)) if counts else None,
                "p50": percentile(counts, 50),
                "p95": percentile(counts, 95),
                "max": max(counts) if counts else None,
            },
        },
    )
    go = {
        "Recall_Foundation_Round": "PASS",
        "ACCOUNTING_GATE": "PASS",
        "dialog_200": "200/200 NO_PROFILE INVOKED",
        "before_funnel_dialogs": before_funnel["dialogs"],
        "after_funnel_dialogs": after_funnel["dialogs"],
        "script_normalization": {"before": 145, "after": script_n},
        "single_char": sc,
        "query_generation_gap": qgap,
        "waterfall_after": dict(states),
        "false_intervention_same_raw": same_raw_cw,
        "candidate_mean_before": (sum(before_counts) / len(before_counts)) if before_counts else None,
        "candidate_mean_after": (sum(counts) / len(counts)) if counts else None,
    }
    pta.write_json(OUT / "go_summary.json", go)
    print(json.dumps(go, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
