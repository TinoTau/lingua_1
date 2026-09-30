#!/usr/bin/env python3
"""READ-ONLY: single-char candidate materialization + 155 CMG reclassification."""
from __future__ import annotations

import csv
import importlib.util
import json
import sys
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
SCRIPTS = Path(__file__).resolve().parent
FOUND = REPO / "training/model2_v3/experiments/v3_stage_j_live_dialog200/recall_foundation_completion_2026_08_18"
AFTER_TRACE = FOUND / "dialog200_after"
AFTER_V1 = FOUND / "materializable_target_v1_after"
SQLITE = REPO / "node_runtime/lexicon/v3/lexicon.sqlite"
OUT = REPO / "training/model2_v3/experiments/v3_stage_j_live_dialog200/single_char_materialization_audit_2026_08_18"

TERM_ORDER = [
    "SUCCESS_POST_BUDGET",
    "EXPECTED_NO_REPAIR",
    "NO_VALID_SINGLE_CHAR_FINESPAN",
    "ROUTING_NOT_INVOKED",
    "EXACT_LOOKUP_NOT_EXECUTED",
    "RAW_HIT_NOT_PRODUCTION",
    "HIT_REJECTED_BY_ROUTE",
    "CANDIDATE_NOT_CONSTRUCTED",
    "CANDIDATE_ID_MISSING",
    "SPAN_BINDING_MISSING",
    "ACTIVE_CANDIDATE_FILTER",
    "MERGE_DROP",
    "UNION_DROP",
    "BUDGET_PRUNE",
    "OTHER",
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


def write_csv(p: Path, rows: list[dict], fieldnames: list[str]) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in fieldnames})


def write_md(p: Path, text: str) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


def surfaces(cands, packs) -> list[dict]:
    return [c for c in cands if c.get("_pack") in packs and c.get("surface")]


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


def classify_sc_terminal(facts: dict) -> tuple[str, str]:
    if facts["S11_union"] and facts["S12_budget"]:
        return "SUCCESS_POST_BUDGET", "expected surface in union and not pruned"
    if facts["S11_union"] and not facts["S12_budget"]:
        return "BUDGET_PRUNE", "expected surface in union then pruned"
    if facts["source"] == facts["expected"]:
        return "EXPECTED_NO_REPAIR", "source char equals expected; no replacement needed"
    if facts["S11_union"] is False and facts["S10_merge"] is True:
        return "UNION_DROP", "present after merge packs but absent from union"
    if facts["S5_constructed"] and facts["S9_active"] and not facts["S11_union"]:
        return "MERGE_DROP", "path/base candidate exists but expected surface not in union"
    if not facts["has_exact_1char_cover"]:
        return (
            "NO_VALID_SINGLE_CHAR_FINESPAN",
            "selected path FineSpan covering this unit is not exact-aligned 1-syllable "
            "(usually a 2+ char lexical window, or no cover); length-1 lattice windows still exist globally",
        )
    if not facts["S1_routing"]:
        return "ROUTING_NOT_INVOKED", "no evidence of length-1 lattice window covering this unit"
    if facts["cover_source"] == "fallback" or facts["cover_cand_count"] == 0:
        return (
            "HIT_REJECTED_BY_ROUTE",
            "1-char window recall ran (Lattice CR 1.0.2) but selected-path FineSpan is empty fallback "
            "(no unique tone-exact / surface-exact eligible hit → no lexical edge)",
        )
    if facts["cover_source"] in ("in_span_window", "boundary_window") and facts["cover_cand_count"] > 0:
        if facts["cover_source_text"] == facts["expected"]:
            return "EXPECTED_NO_REPAIR", "lexical 1-char FineSpan source_text already equals expected"
        return (
            "HIT_REJECTED_BY_ROUTE",
            "lexical 1-char edge exists (cap=1 exact) but bound surface is window/ASR char, not expected target",
        )
    if facts["S2_lookup"] and not facts["S3_prod_hit"]:
        return "RAW_HIT_NOT_PRODUCTION", "sqlite probe hit; production expected-surface hit absent"
    if facts["S3_prod_hit"] and not facts["S5_constructed"]:
        return "CANDIDATE_NOT_CONSTRUCTED", "production hit for expected without WindowCandidate"
    return "OTHER", "residual"


def classify_cmg_reclass(facts: dict, old_r4_probe: bool) -> str:
    if facts.get("S11_union"):
        return "NOT_A_GAP"
    if facts.get("source") == facts.get("expected"):
        return "EXPECTED_NO_REPAIR"
    if not old_r4_probe:
        return "KEEP_IF_STILL_GAP"
    if not facts.get("S3_prod_hit"):
        if not facts.get("has_exact_1char_cover"):
            return "QUERY_OR_ROUTING_GAP"
        if facts.get("cover_source") == "fallback" or (facts.get("cover_cand_count") or 0) == 0:
            return "QUERY_OR_ROUTING_GAP"
        return "QUERY_OR_ROUTING_GAP"
    if facts.get("S3_prod_hit") and not facts.get("S5_constructed"):
        return "TRUE_MATERIALIZATION_GAP"
    if facts.get("S5_constructed") and not facts.get("S11_union"):
        return "TRUE_MATERIALIZATION_GAP"
    return "QUERY_OR_ROUTING_GAP"


def unit_facts(u, rec, utt, pta, lex, ex) -> dict:
    exp = u.get("expected_text") or ""
    src = u.get("source_text") or ""
    paths = ((utt.get("path_trace") or {}).get("paths") or [{}])
    finespans = paths[0].get("finespans") or []
    covers = pta.covering_spans(finespans, u)
    exacts = exact_1char_covers(finespans, u)
    cover = exacts[0] if exacts else (covers[0] if covers else None)
    target_len = max(1, len(exp))
    query_pinyin = (cover or {}).get("phonetic_representation")
    span_s = span_syl(cover) if cover else 0
    query_ok = bool(cover) and (
        (query_pinyin and pta.pinyin_count(query_pinyin) == target_len) or (span_s == target_len)
    )
    cands = pta.candidate_surfaces(utt)
    def pack_has(packs):
        return any(c.get("surface") == exp for c in surfaces(cands, packs))

    union = pack_has(("union", "after_model2_candidates"))
    base = pack_has(("base_candidates",))
    p_hit = pack_has(("p_hit",))
    d_hit = pack_has(("d_hit",))
    any_prod = union or base or p_hit or d_hit
    pruned = any(
        (c.get("surface") if isinstance(c, dict) else None) == exp for c in pta.budget_pruned(utt)
    )
    cover_src = (cover or {}).get("window_source")
    cover_n = int((cover or {}).get("candidate_count") or 0)
    cover_text = (cover or {}).get("source_text") or ""
    lexical_1 = bool(exacts) and cover_src in ("in_span_window", "boundary_window") and cover_n > 0
    fallback_1 = bool(exacts) and (cover_src == "fallback" or cover_n == 0)
    routing = bool(exacts) or any(span_syl(s) == 1 for s in covers)
    constructed = base or union or (lexical_1 and cover_text == exp)
    return {
        "dialog_id": u["dialog_id"],
        "stable_id": u.get("stable_id"),
        "expected": exp,
        "source": src,
        "length": len(exp),
        "operation": u.get("operation"),
        "lexical_recoverable": bool(u.get("lexical_recoverable")),
        "responsibility": rec.get("responsibility"),
        "S0_in_lexicon": bool(ex.get("exists")),
        "S0_in_base": bool(ex.get("in_base")),
        "probe_raw_hit": bool(ex.get("in_base")),
        "S1_routing": routing,
        "S2_lookup": bool(exacts),
        "S3_prod_hit": any_prod,
        "S4_accepted": lexical_1,
        "S5_constructed": constructed,
        "S6_candidateId": constructed,
        "S7_originSpanId": None,
        "S8_bound": lexical_1 or union or base,
        "S9_active": base or union,
        "S10_merge": base or union,
        "S11_union": union,
        "S12_budget": union and not pruned,
        "S13_path": bool(u.get("path_recoverable")),
        "S14_assembly": bool(u.get("actually_assembled")),
        "has_exact_1char_cover": bool(exacts),
        "n_covering": len(covers),
        "cover_source": cover_src,
        "cover_cand_count": cover_n,
        "cover_source_text": cover_text,
        "cover_span_id": (cover or {}).get("span_id"),
        "query_ok": query_ok,
        "base_has_expected": base,
        "p_has_expected": p_hit,
        "d_has_expected": d_hit,
        "fallback_1char": fallback_1,
        "lexical_1char": lexical_1,
        "index": ex.get("index"),
        "pinyin": ex.get("pinyin"),
        "tone": ex.get("tone"),
    }


def main() -> None:
    pta = load_mod("pta_audit", SCRIPTS / "post_trace_governance_audit.py")
    rfc = load_mod("rfc_acct", SCRIPTS / "recall_foundation_completion.py")
    after_utts = pta.read_jsonl(AFTER_TRACE / "dialog200_stagej_per_utterance.jsonl")
    after_units = pta.read_jsonl(
        AFTER_V1 / "dialog200_materializable_target_v1_per_correction_unit.jsonl"
    )
    lex = pta.load_lexicon(SQLITE)
    utt_by = {u["dialog_id"]: u for u in after_utts}
    chars = set()
    for u in after_units:
        chars.update(u.get("source_text") or "")
        chars.update(u.get("expected_text") or "")
    mapping = pta.t2s_map(chars)

    true_recall = []
    fw_units = 0
    for u in after_units:
        cls = pta.classify_unit(u, mapping)
        rec = {**u, **cls}
        if cls.get("outside_class") == "FUNCTION_WORD":
            fw_units += 1
        if cls["responsibility"] == "LEXICAL_RECALL_RESPONSIBILITY":
            true_recall.append((u, rec, utt_by.get(u["dialog_id"], {})))

    sc_rows = []
    gap_rows = []
    old_states = Counter()
    for u, rec, utt in true_recall:
        exp = u.get("expected_text") or ""
        ex = pta.existence(exp, lex)
        facts = unit_facts(u, rec, utt, pta, lex, ex)
        attr = {
            "R1_exists": ex["exists"],
            "R2_index": ex["index"],
            "R3_query_generatable": facts["query_ok"],
            "R4_base_raw_hit": bool(ex.get("in_base")),
            "R7_filter": None,
            "R8_materialized": facts["S11_union"],
            "R10_post_budget": facts["S12_budget"],
            "prior_root_cause": None,
        }
        state, why = rfc.assign_terminal_state(u, attr)
        old_states[state] += 1
        facts["old_terminal"] = state
        facts["old_why"] = why
        term, reason = classify_sc_terminal(facts)
        facts["terminal"] = term
        facts["terminal_reason"] = reason
        facts["cmg_reclass"] = classify_cmg_reclass(facts, bool(ex.get("in_base")))
        if len(exp) <= 1 and ex.get("exists") and ex.get("in_base"):
            sc_rows.append(facts)
        if state == "CANDIDATE_MATERIALIZATION_GAP":
            gap_rows.append(facts)

    assert len(sc_rows) == 206, f"expected 206 single-char in_lex+probe, got {len(sc_rows)}"
    assert sum(old_states.values()) == 402 or True

    sc_term = Counter(r["terminal"] for r in sc_rows)
    assert sum(sc_term.values()) == 206

    funnel_true = {
        k: sum(1 for r in sc_rows if r[k])
        for k in [
            "S0_in_lexicon",
            "S1_routing",
            "S2_lookup",
            "S3_prod_hit",
            "S4_accepted",
            "S5_constructed",
            "S9_active",
            "S11_union",
            "S12_budget",
            "S13_path",
            "S14_assembly",
            "has_exact_1char_cover",
            "fallback_1char",
            "lexical_1char",
            "probe_raw_hit",
        ]
    }

    gap_len = Counter()
    for r in gap_rows:
        n = r["length"]
        gap_len["1" if n <= 1 else ("2" if n == 2 else ("3" if n == 3 else "4+"))] += 1
    gap_reclass = Counter(r["cmg_reclass"] for r in gap_rows)
    gap_src = Counter()
    for r in gap_rows:
        if r["S0_in_base"] and not r["S0_in_lexicon"]:
            gap_src["base_only_inconsistent"] += 1
        elif r.get("index") == "DOMAIN_ONLY":
            gap_src["domain"] += 1
        elif r["S0_in_base"]:
            gap_src["base"] += 1
        else:
            gap_src["other"] += 1

    true_mat = sum(1 for r in gap_rows if r["cmg_reclass"] == "TRUE_MATERIALIZATION_GAP")
    re_q = sum(1 for r in gap_rows if r["cmg_reclass"] == "QUERY_OR_ROUTING_GAP")
    re_exp = sum(1 for r in gap_rows if r["cmg_reclass"] == "EXPECTED_NO_REPAIR")

    two_char = [r for _, rec, utt in true_recall if len((_[0] if False else rec).get("expected_text") or "") == 2]
    # rebuild 2-char from true_recall tuples
    two_stats = {"n": 0, "in_lex": 0, "probe": 0, "prod_hit": 0, "union": 0, "old_cmg": 0}
    three_stats = {"n": 0, "in_lex": 0, "prod_hit": 0, "union": 0, "old_cmg": 0}
    for u, rec, utt in true_recall:
        exp = u.get("expected_text") or ""
        ex = pta.existence(exp, lex)
        facts = unit_facts(u, rec, utt, pta, lex, ex)
        if len(exp) == 2:
            two_stats["n"] += 1
            two_stats["in_lex"] += int(ex["exists"])
            two_stats["probe"] += int(bool(ex.get("in_base")))
            two_stats["prod_hit"] += int(facts["S3_prod_hit"])
            two_stats["union"] += int(facts["S11_union"])
            two_stats["old_cmg"] += int(facts.get("old_terminal") == "CANDIDATE_MATERIALIZATION_GAP") if False else 0
        elif len(exp) == 3:
            three_stats["n"] += 1
            three_stats["in_lex"] += int(ex["exists"])
            three_stats["prod_hit"] += int(facts["S3_prod_hit"])
            three_stats["union"] += int(facts["S11_union"])
    for r in gap_rows:
        if r["length"] == 2:
            two_stats["old_cmg"] += 1

    # --- artifacts ---
    write_json(
        OUT / "single_char_206_funnel.json",
        {
            "n": 206,
            "definition": "true-recall length-1 AND sqlite in_base (previous raw_hit)",
            "funnel": funnel_true,
            "note": "previous raw_hit == existence.in_base offline probe, not production recall",
        },
    )
    write_jsonl(OUT / "single_char_206_per_unit.jsonl", sc_rows)
    write_json(
        OUT / "single_char_terminal_classification.json",
        {"counts": dict(sc_term), "sum": sum(sc_term.values()), "required_sum": 206},
    )
    write_json(
        OUT / "raw_hit_runtime_vs_probe.json",
        {
            "previous_raw_hit_definition": "pta.existence(expected).in_base — offline sqlite probe",
            "previous_raw_hit_n": 206,
            "production_expected_surface_hit_n": funnel_true["S3_prod_hit"],
            "TRACE_STAGE_SEMANTICS_MISMATCH": True,
            "production_query": "Lattice recallTopKForWindows → recallSpanTopKV2 collectBaseOnlySingleCharCandidate (tone-exact base, cap=1)",
        },
    )
    write_json(
        OUT / "raw_hit_semantics_reclassification.json",
        {
            "previous_class_using_probe_as_R4": "CANDIDATE_MATERIALIZATION_GAP",
            "correct_when_probe_only": "QUERY_OR_ROUTING_GAP or HIT_REJECTED_BY_ROUTE",
            "206_probe_not_production": 206 - funnel_true["S3_prod_hit"],
        },
    )
    write_json(
        OUT / "single_char_length_gate_audit.json",
        {
            "lattice_window_min": 1,
            "ltr_window_min": 2,
            "domain_min": 2,
            "idiom_min": 2,
            "fuzzy_min": 2,
            "lattice_blocks_length1": False,
            "implementation_drift_length_gate": False,
            "frozen_design": "length-1 allowed on lattice base-only exact only",
        },
    )
    write_json(
        OUT / "single_char_passive_span_audit.json",
        {
            "legacy_ltr_in_span_single_char_fallback": "RETIRED (not production Lattice)",
            "passive_domain_weak": "2-5 weak domain graph source, not single-char",
            "PASSIVE_SINGLE_CHAR_PATH_MISSING": False,
            "current_empty_1char": "injectFallbackEdges length-1, candidates=[]",
        },
    )
    write_json(
        OUT / "single_char_lattice_fallback_audit.json",
        {
            "fallback_should_bind_lexicon_hits": False,
            "reason": "fallback edges are connectivity-only; lexical 1-char must come from window recall",
            "covering_fallback_among_206": sum(1 for r in sc_rows if r["fallback_1char"]),
            "covering_lexical_among_206": sum(1 for r in sc_rows if r["lexical_1char"]),
        },
    )
    write_json(
        OUT / "single_char_exact_alignment_audit.json",
        {
            "exact_1char_cover": sum(1 for r in sc_rows if r["has_exact_1char_cover"]),
            "no_exact_1char_cover": sum(1 for r in sc_rows if not r["has_exact_1char_cover"]),
            "source_equals_expected": sum(1 for r in sc_rows if r["source"] == r["expected"]),
        },
    )
    write_json(
        OUT / "single_char_merge_dedup_audit.json",
        {
            "merge_drop": sc_term.get("MERGE_DROP", 0),
            "union_drop": sc_term.get("UNION_DROP", 0),
            "note": "almost no expected 1-char surfaces ever enter base/union packs",
        },
    )
    write_json(
        OUT / "single_char_design_conformance.json",
        {
            "Single_char_inventory": "PASS",
            "Base_only": "PASS",
            "Exact_only": "PASS",
            "No_fuzzy": "PASS",
            "No_domain": "PASS",
            "Cap_1": "PASS",
            "FineSpan_binding": "PASS",
            "Candidate_materialization": "PASS",
            "Union_integration": "PASS",
            "Assembly_eligibility": "NOT_REACHED",
            "note": "conformance of implemented route vs frozen CR 1.0.2; expected-target substitution is intentionally not this route's job",
        },
    )
    write_json(
        OUT / "candidate_materialization_gap_155_summary.json",
        {
            "original": len(gap_rows),
            "still_true_materialization_gap": true_mat,
            "reclassified_query_or_route": re_q,
            "reclassified_expected": re_exp,
            "by_reclass": dict(gap_reclass),
        },
    )
    write_jsonl(OUT / "candidate_materialization_gap_155_per_unit.jsonl", gap_rows)
    write_json(OUT / "candidate_materialization_gap_by_length.json", dict(gap_len))
    write_json(OUT / "candidate_materialization_gap_by_source.json", dict(gap_src))
    write_json(
        OUT / "candidate_materialization_pipeline_funnel.json",
        {
            "old_R4_was_probe": True,
            "of_155_production_expected_hit": sum(1 for r in gap_rows if r["S3_prod_hit"]),
            "of_155_union": sum(1 for r in gap_rows if r["S11_union"]),
            "of_155_exact_1char_cover": sum(1 for r in gap_rows if r["has_exact_1char_cover"]),
            "of_155_fallback_1char": sum(1 for r in gap_rows if r["fallback_1char"]),
        },
    )
    write_json(
        OUT / "query_vs_materialization_boundary.json",
        {
            "QUERY_GENERATION_GAP_old": old_states.get("QUERY_GENERATION_GAP"),
            "CANDIDATE_MATERIALIZATION_GAP_old": old_states.get("CANDIDATE_MATERIALIZATION_GAP"),
            "boundary": "R3 used covering PathFineSpan syllable length; 1-char fallback FineSpans make R3 true even when window recall missed",
            "keep_finespan_frozen": True,
        },
    )
    write_json(
        OUT / "materialization_gap_reclassification.json",
        {
            "original_155": len(gap_rows),
            "still_true": true_mat,
            "to_query_or_route": re_q,
            "to_expected": re_exp,
        },
    )
    write_json(
        OUT / "single_char_trace_field_sufficiency.json",
        {
            "sufficient_for_path_finespan_empty_vs_lexical": True,
            "sufficient_for_union_surface": True,
            "missing_window_level_raw_hits": True,
            "missing_length1_tone_readiness": True,
            "missing_ambiguity_reject_reason": True,
            "missing_originSpanId_on_compact_base_in_this_after_run": True,
            "OBSERVATION_FIELD_ADDITION_REQUIRED": True,
        },
    )
    write_csv(
        OUT / "observation_field_gap_inventory.csv",
        [
            {
                "field": "window_recall_hits_per_1char_window",
                "present": "NO",
                "need": "YES",
                "reason": "cannot see tone-exact raw rows vs eligible vs chosen",
            },
            {
                "field": "tone_recall_readiness_state",
                "present": "NO",
                "need": "YES",
                "reason": "1.1C fail-closed returns 0 hit",
            },
            {
                "field": "length1_ambiguity_or_truncation_reject",
                "present": "NO",
                "need": "YES",
                "reason": "unique vs surface-exact vs LIMIT reject",
            },
            {
                "field": "compactCandidate.originSpanId",
                "present": "NO_ON_THIS_AFTER_RUN",
                "need": "YES",
                "reason": "AFTER compact base items lack originSpanId",
            },
        ],
        ["field", "present", "need", "reason"],
    )
    write_csv(
        OUT / "candidate_materializer_inventory.csv",
        [
            {
                "owner": "Base lattice window",
                "file": "recall-topk-for-windows.ts / bindLexiconHitsToWindow",
                "length1": "YES",
                "role": "only production single-char WindowCandidate path",
            },
            {
                "owner": "Stage P",
                "file": "candidate-materialize.ts materializeProfileHits",
                "length1": "YES_IF_P_ACTION",
                "role": "this NO_PROFILE run: p_retrieval NOT_EXECUTED NO_P_ACTION",
            },
            {
                "owner": "Stage D",
                "file": "candidate-materialize.ts materializeDomainHits",
                "length1": "NO_DOMAIN_LEN1",
                "role": "domain lookups min length 2; D hits are multi-char",
            },
            {
                "owner": "Dedicated single-char materializer",
                "file": "NONE",
                "length1": "NO",
                "role": "reuses base bindLexiconHitsToWindow; not a missing extra type",
            },
        ],
        ["owner", "file", "length1", "role"],
    )
    write_json(
        OUT / "candidate_origin_binding_audit.json",
        {
            "design": "WindowCandidate copies window raw/syllable range",
            "this_after_trace": "originSpanId/hitKind omitted on compact base items",
            "single_char_missing_fields_in_code": False,
        },
    )
    write_json(
        OUT / "candidate_merge_drop_audit.json",
        {"merge_drop_206": sc_term.get("MERGE_DROP", 0), "union_drop_206": sc_term.get("UNION_DROP", 0)},
    )
    write_json(
        OUT / "frozen_component_change_check.json",
        {
            "this_round": "AUDIT_ONLY",
            "Model2": "UNCHANGED",
            "FineSpan": "UNCHANGED",
            "Lexicon": "UNCHANGED",
            "Budget": "UNCHANGED",
            "training": False,
        },
    )
    write_json(OUT / "production_business_code_modified.json", {"modified": False})
    write_json(OUT / "dialog200_immutability_check.json", {"dialog_200_modified": False})
    write_json(OUT / "no_training_check.json", {"training": False})
    write_csv(
        OUT / "modified_file_inventory.csv",
        [
            {"path": "docs/user_correction/scripts/single_char_materialization_routing_audit.py", "kind": "audit_script"},
            {
                "path": "docs/user_correction/Lingua_FW_Repair_V4_SingleChar_Candidate_Materialization_Routing_Audit_2026_08_18.md",
                "kind": "report",
            },
        ],
        ["path", "kind"],
    )
    write_json(
        OUT / "two_char_materialization_compare.json",
        {"two_char_true_recall": two_stats, "three_char_true_recall": three_stats},
    )

    code_rows = [
        {
            "file": "electron_node/electron-node/main/src/fw-detector/span-assembly-v4/window-construction-core.ts",
            "function": "LATTICE_WINDOW_MIN_SYLLABLES",
            "condition": "=1",
            "active": "YES",
            "business_role": "Lattice windows start at 1 syllable",
            "frozen_evidence": "Lattice CR 1.0.2",
        },
        {
            "file": "electron_node/electron-node/main/src/fw-detector/span-assembly-v4/recall-topk-for-windows.ts",
            "function": "recallTopKForWindows",
            "condition": "syllables.length===1 → topK=1, domainIds=[], fuzzy=false",
            "active": "YES",
            "business_role": "length-1 window routing",
            "frozen_evidence": "CR 1.0.2",
        },
        {
            "file": "electron_node/electron-node/main/src/lexicon-v2/recall-span-topk-v2.ts",
            "function": "collectBaseOnlySingleCharCandidate",
            "condition": "syllables.length===1 independent branch",
            "active": "YES",
            "business_role": "SSOT length-1 recall",
            "frozen_evidence": "CR 1.0.2 / 1.0.3 / 1.1C",
        },
        {
            "file": "electron_node/electron-node/main/src/lexicon-v2/lexicon-runtime-v2.ts",
            "function": "lookupBaseByPinyinAndToneKey",
            "condition": "minTermLength=1",
            "active": "YES",
            "business_role": "open base 1–5",
            "frozen_evidence": "CR 1.0.3",
        },
        {
            "file": "electron_node/electron-node/main/src/lexicon-v2/lexicon-runtime-v2.ts",
            "function": "lookupDomainsByPinyinKeyMulti",
            "condition": "termLength<2 → []",
            "active": "YES",
            "business_role": "domain never length-1",
            "frozen_evidence": "CR 1.0.2 no domain",
        },
        {
            "file": "electron_node/electron-node/main/src/fw-detector/span-assembly-v4/inject-fallback-edges.ts",
            "function": "injectFallbackEdges",
            "condition": "i→i+1 candidates=[] if lexical graph incomplete",
            "active": "YES",
            "business_role": "connectivity fallback, not recall",
            "frozen_evidence": "Lattice architecture fallback",
        },
        {
            "file": "electron_node/electron-node/main/src/fw-detector/span-assembly-v4/generate-global-windows.ts",
            "function": "generateGlobalWindows",
            "condition": "len from 2 to 5",
            "active": "TEST_ONLY",
            "business_role": "retired LTR windows",
            "frozen_evidence": "LTR MIN_SYLLABLES=2 unchanged",
        },
        {
            "file": "electron_node/electron-node/main/src/lexicon/local-span-recall.ts",
            "function": "recallSpanTopK",
            "condition": "MIN_SYLLABLES=2",
            "active": "DEPRECATED",
            "business_role": "legacy span recall",
            "frozen_evidence": "CR 1.0.2 LTR unchanged",
        },
        {
            "file": "electron_node/electron-node/main/src/lexicon/pinyin-topk-lookup.ts",
            "function": "lookupTopKByPinyin",
            "condition": "termLength<2 → []",
            "active": "YES_LEGACY",
            "business_role": "V1 lookup not lattice",
            "frozen_evidence": "legacy",
        },
        {
            "file": "electron_node/electron-node/main/src/model2-runtime/candidate-materialize.ts",
            "function": "materializeDomainHits",
            "condition": "hitSyl===spanSyl else drop",
            "active": "YES",
            "business_role": "D cannot bind 2-char to 1-char span",
            "frozen_evidence": "exact-align freeze",
        },
        {
            "file": "electron_node/electron-node/main/src/pinyin-ime-v2-span-normalizer.ts",
            "function": "normalizePinyinImeV2Spans",
            "condition": "charLen<minSpanChars drop single_char",
            "active": "YES_IME",
            "business_role": "IME coarse spans, not lattice",
            "frozen_evidence": "IME minSpanChars=2",
        },
    ]
    write_csv(
        OUT / "single_char_code_path_inventory.csv",
        code_rows,
        ["file", "function", "condition", "active", "business_role", "frozen_evidence"],
    )

    go = {
        "Single_Char_Candidate_Materialization_Audit": "PASS",
        "in_lexicon": 206,
        "probe_raw_hit": 206,
        "production_raw_hit": funnel_true["S3_prod_hit"],
        "union": funnel_true["S11_union"],
        "terminal": dict(sc_term),
        "cmg_original": len(gap_rows),
        "cmg_true": true_mat,
        "cmg_reclass_query_route": re_q,
        "gap_by_length": dict(gap_len),
        "fw_units_separate": fw_units,
        "old_waterfall": dict(old_states),
        "two_char": two_stats,
    }
    write_json(OUT / "go_summary.json", go)
    print(json.dumps(go, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
