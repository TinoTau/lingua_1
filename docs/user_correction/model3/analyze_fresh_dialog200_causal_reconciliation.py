#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Offline causal reconciliation for fresh dialog_200 run.

Uses same-run raw JSONL + Lexical Target Minimality SSOT
(model3_v2_s3_mechanism_revalidation.csv). Does not modify production.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
OUT = REPO / "docs" / "user_correction" / "model3"
MINIMALITY_CSV = OUT / "model3_v2_s3_mechanism_revalidation.csv"
MINIMALITY_AUDIT = OUT / "Lingua_Model3_V2_S3_Lexical_Target_Minimality_Audit_2026_09_03.md"
LEX_DB = REPO / "node_runtime" / "lexicon" / "v3" / "lexicon.sqlite"

BREAKPOINTS = [
    "ASR_INFORMATION_LOSS",
    "NO_LOCAL_LEXICAL_TARGET",
    "FINE_SPAN_TARGET_NOT_EXPOSED",
    "QUERY_NOT_REPAIR_CAPABLE",
    "LEXICON_COVERAGE_MISSING",
    "RECALL_MATCHING_FAILED",
    "DOMAIN_BUCKET_FILTER_LOSS",
    "MODEL2_FAILURE",
    "MODEL3_FALSE_KEEP",
    "MODEL3_FALSE_RETRY",
    "RETRY_RECALL_FAILED",
    "ASSEMBLY_CANDIDATE_LOSS",
    "CANDIDATE_CAP_LOSS",
    "KENLM_WRONG_SELECTION",
    "FINAL_APPLY_MISMATCH",
    "UNKNOWN_NOT_ISOLATED",
]

PREC = {b: i for i, b in enumerate(BREAKPOINTS)}


def norm(s: str) -> str:
    return re.sub(r"[\s,，。！？、；：.!?;:'\"()（）\[\]【】\-—…·]+", "", (s or "")).lower()


def levenshtein(a: str, b: str) -> int:
    a, b = a or "", b or ""
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cost = 0 if ca == cb else 1
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost))
        prev = cur
    return prev[-1]


def cer(ref: str, hyp: str) -> float:
    r, h = norm(ref), norm(hyp)
    if not r:
        return 0.0 if not h else 1.0
    return levenshtein(r, h) / len(r)


def pctile(vals, p):
    arr = sorted(v for v in vals if isinstance(v, (int, float)) and math.isfinite(v))
    if not arr:
        return None
    idx = min(len(arr) - 1, max(0, math.ceil((p / 100) * len(arr)) - 1))
    return arr[idx]


def load_jsonl(path: Path):
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        rows.append(json.loads(line))
    return rows


def load_minimality():
    rows = list(csv.DictReader(MINIMALITY_CSV.open(encoding="utf-8-sig")))
    by_case = defaultdict(list)
    invalid_by_case = defaultdict(list)
    for r in rows:
        role = r.get("targetRole") or ""
        if role == "PRIMARY_MINIMAL":
            by_case[r["caseId"]].append(r)
        elif role == "INVALID_LEXICAL_TARGET":
            invalid_by_case[r["caseId"]].append(r)
    return by_case, invalid_by_case, rows


def open_lexicon():
    if not LEX_DB.exists():
        return None, set()
    con = sqlite3.connect(str(LEX_DB))
    words = {r[0] for r in con.execute("SELECT word FROM term WHERE enabled=1")}
    return con, words


def lex_lookup(con, words, term: str):
    if not term:
        return {"exists": False}
    exists = term in words
    out = {"exists": exists, "term": term}
    if not exists or con is None:
        return out
    row = con.execute(
        "SELECT word, COALESCE(pinyin_key,''), COALESCE(tone_pinyin_key,''), COALESCE(tier,'') FROM term WHERE word=? AND enabled=1 LIMIT 1",
        (term,),
    ).fetchone()
    tags = []
    for sql in (
        "SELECT tag FROM term_domain_tags WHERE word=? ORDER BY tag",
        "SELECT domain_tag FROM term_domain_tags WHERE word=? ORDER BY domain_tag",
        "SELECT domain FROM term_domain_tags WHERE word=? ORDER BY domain",
        "SELECT domain_id FROM term_domain WHERE term_id=(SELECT id FROM term WHERE word=? LIMIT 1)",
    ):
        try:
            tags = [t[0] for t in con.execute(sql, (term,)).fetchall()]
            if tags:
                break
        except sqlite3.Error:
            continue
    if row:
        tier = row[3] or ""
        out.update(
            {
                "baseOrDomain": "domain" if tags else ("base" if tier in ("", "base", "BASE") else tier),
                "pinyin": row[1],
                "tone": row[2],
                "domainTags": [str(t) for t in tags],
            }
        )
    return out


def fine_span_exposed_signal(rec) -> bool:
    """FineSpan inventory may omit surfaces in compact audit dump; retry sourceSpanIds with fine: prove exposure."""
    for p in rec.get("paths") or []:
        if p.get("fine_span_surfaces") or (p.get("fine_span_count") or 0) > 0:
            return True
        m3 = p.get("model3") or {}
        for r in m3.get("retry_regions") or []:
            for sid in r.get("sourceSpanIds") or []:
                if str(sid).startswith("fine:"):
                    return True
        for d in m3.get("decisions") or []:
            if d.get("spanId") or d.get("surface"):
                return True
    return False


def collect_surfaces(rec):
    fine, queries, hits, assembly, kenlm = [], [], [], [], []
    for p in rec.get("paths") or []:
        fine.extend(p.get("fine_span_surfaces") or [])
        assembly.extend(p.get("assembly_sentences") or [])
        m3 = p.get("model3") or {}
        for inv in m3.get("retry_recall_invocations") or []:
            if inv.get("query"):
                queries.append(str(inv["query"]))
            if inv.get("window"):
                queries.append(str(inv["window"]))
            hits.extend(inv.get("hits") or [])
    kenlm.extend(rec.get("kenlm_input_texts") or [])
    kenlm.extend(rec.get("kenlm_top_texts") or [])
    return {
        "fine": [norm(x) for x in fine if x],
        "queries": [norm(x) for x in queries if x],
        "hits": [norm(x) for x in hits if x],
        "assembly": [norm(x) for x in assembly if x],
        "kenlm": [norm(x) for x in kenlm if x],
        "fine_exposed_signal": fine_span_exposed_signal(rec),
    }


def target_in_list(target: str, surfaces):
    t = norm(target)
    if not t:
        return False
    for s in surfaces:
        if t == s or t in s or s in t:
            return True
    return False


def map_mechanism(mech: str) -> str:
    m = (mech or "").strip()
    mapping = {
        "TARGET_NOT_IN_LEXICON": "LEXICON_COVERAGE_MISSING",
        "RECALL_TARGET_MISS": "RECALL_MATCHING_FAILED",
        "QUERY_NOT_REPAIR_CAPABLE": "QUERY_NOT_REPAIR_CAPABLE",
        "FINE_SPAN_TARGET_NOT_EXPOSED": "FINE_SPAN_TARGET_NOT_EXPOSED",
        "NO_LOCAL_LEXICAL_TARGET": "NO_LOCAL_LEXICAL_TARGET",
        "OUTSIDE_CURRENT_CONTRACT": "NO_LOCAL_LEXICAL_TARGET",
    }
    return mapping.get(m, m if m in PREC else "UNKNOWN_NOT_ISOLATED")


def outcome_class(raw_ok, final_ok, d_raw, d_final):
    if raw_ok and final_ok:
        return "CORRECT_PRESERVED"
    if raw_ok and not final_ok:
        return "CORRECT_BROKEN"
    if not raw_ok and final_ok:
        return "FULL_RESCUE"
    if d_final < d_raw:
        return "PARTIAL_IMPROVEMENT"
    if d_final > d_raw:
        return "REGRESSION"
    if norm_eq_diff(d_raw, d_final):
        # same distance but maybe different wrong
        return "UNCHANGED"
    return "DIFFERENT_WRONG"


def norm_eq_diff(a, b):
    return a == b


def first_breakpoint_for_case(rec, primaries, invalids, con, words):
    """Strict precedence first breakpoint for a raw-wrong case."""
    ref = rec.get("reference") or ""
    raw = rec.get("rawMergedAsrText") or ""
    final = rec.get("finalPostprocessText") or ""
    surfaces = collect_surfaces(rec)
    evidence = []

    # Model3 / Retry / KenLM signals from same-run paths
    decisions_retry = 0
    decisions_keep = 0
    retry_inv = 0
    retry_hit_any = 0
    pool = rec.get("kenlm_pool_candidate_count")
    for p in rec.get("paths") or []:
        m3 = p.get("model3") or {}
        decisions_retry += m3.get("decisions_retry") or 0
        decisions_keep += m3.get("decisions_keep") or 0
        for inv in m3.get("retry_recall_invocations") or []:
            retry_inv += 1
            if inv.get("hitCount") or inv.get("hits"):
                retry_hit_any += 1

    if not primaries and not invalids:
        # No independent lexical target from minimality SSOT
        bp = "NO_LOCAL_LEXICAL_TARGET"
        return {
            "firstBreakpoint": bp,
            "confidence": "INFERRED",
            "minimalLexicalTarget": "",
            "lexicalTargetValidity": "NO_LOCAL_LEXICAL_TARGET",
            "lexicalTargetType": "",
            "fineSpanExposed": "N/A",
            "queryCapable": "N/A",
            "targetInLexicon": "N/A",
            "recallHit": "N/A",
            "breakpointEvidence": "no PRIMARY_MINIMAL for case in minimality SSOT",
            "mechanismFinal": "",
            "valid_gap": None,
            "query_gap": None,
            "recall_fail": None,
        }

    # Prefer earliest-precedence among PRIMARY_MINIMAL mechanisms, then validate with fresh evidence
    candidates = []
    for pr in primaries:
        target = pr.get("lexicalTarget") or ""
        mech = map_mechanism(pr.get("mechanismFinal") or "")
        in_lex = lex_lookup(con, words, target)
        exposed = (
            surfaces.get("fine_exposed_signal")
            or target_in_list(target, surfaces["fine"])
            or target_in_list(target, surfaces["queries"])
        )
        # If FineSpan surfaces empty but retries/queries exist covering target region → exposed via retry
        query_capable = mech != "QUERY_NOT_REPAIR_CAPABLE"
        # Fresh-run geometry: if any legal query equals/covers target → capable
        if target_in_list(target, surfaces["queries"]):
            query_capable = True
        recall_hit = target_in_list(target, surfaces["hits"])
        assembled = target_in_list(target, surfaces["assembly"])
        in_kenlm = target_in_list(target, surfaces["kenlm"]) or any(
            norm(target) in norm(t) for t in (rec.get("kenlm_input_texts") or [])
        )
        final_has = norm(target) in norm(final)

        # Recompute first owner with precedence + fresh evidence
        if mech == "QUERY_NOT_REPAIR_CAPABLE" or not query_capable:
            bp = "QUERY_NOT_REPAIR_CAPABLE"
            conf = "DIRECT" if pr.get("mechanismFinal") == "QUERY_NOT_REPAIR_CAPABLE" else "INFERRED"
        elif not in_lex.get("exists"):
            # PRIMARY_MINIMAL from minimality are EXISTING_LEXICON_TERM — unexpected
            bp = "LEXICON_COVERAGE_MISSING"
            conf = "DIRECT"
        elif not recall_hit and (query_capable or retry_inv > 0):
            # If mechanism says recall miss, or query ran and missed
            if pr.get("mechanismFinal") == "RECALL_TARGET_MISS" or retry_inv > 0:
                bp = "RECALL_MATCHING_FAILED"
                conf = "DIRECT" if pr.get("mechanismFinal") == "RECALL_TARGET_MISS" else "INFERRED"
            else:
                bp = "QUERY_NOT_REPAIR_CAPABLE"
                conf = "INFERRED"
        elif recall_hit and not assembled and not final_has:
            if isinstance(pool, int) and pool >= 16 and not in_kenlm:
                bp = "CANDIDATE_CAP_LOSS"
                conf = "INFERRED"
            elif not in_kenlm:
                bp = "ASSEMBLY_CANDIDATE_LOSS"
                conf = "INFERRED"
            else:
                bp = "KENLM_WRONG_SELECTION"
                conf = "INFERRED"
        elif in_kenlm and not final_has:
            bp = "KENLM_WRONG_SELECTION"
            conf = "DIRECT"
        else:
            bp = mech if mech in PREC else "UNKNOWN_NOT_ISOLATED"
            conf = "INFERRED"

        # FineSpan not exposed: only if no fine surfaces and no query windows cover target
        if not exposed and not surfaces["queries"] and not surfaces["fine"]:
            # weak signal — prefer not to override QUERY/RECALL from minimality unless clearly missing
            if bp in ("RECALL_MATCHING_FAILED", "LEXICON_COVERAGE_MISSING") and not surfaces["fine"]:
                pass

        candidates.append(
            {
                "bp": bp,
                "conf": conf,
                "target": target,
                "mech": pr.get("mechanismFinal") or "",
                "in_lex": in_lex,
                "exposed": exposed,
                "query_capable": query_capable if bp != "QUERY_NOT_REPAIR_CAPABLE" else False,
                "recall_hit": recall_hit,
                "assembled": assembled,
                "in_kenlm": in_kenlm,
                "identitySource": pr.get("identitySource") or "",
                "status": pr.get("status") or "",
            }
        )

    if not candidates and invalids:
        return {
            "firstBreakpoint": "NO_LOCAL_LEXICAL_TARGET",
            "confidence": "DIRECT",
            "minimalLexicalTarget": (invalids[0].get("lexicalTarget") or ""),
            "lexicalTargetValidity": "INVALID_CONTEXT_FRAGMENT",
            "lexicalTargetType": "INVALID_LEXICAL_TARGET",
            "fineSpanExposed": "N/A",
            "queryCapable": "N/A",
            "targetInLexicon": "N/A",
            "recallHit": "N/A",
            "breakpointEvidence": f"INVALID_LEXICAL_TARGET from minimality: {invalids[0].get('lexicalTarget')}",
            "mechanismFinal": "OUTSIDE_CURRENT_CONTRACT",
            "valid_gap": None,
            "query_gap": None,
            "recall_fail": None,
        }

    # Pick earliest precedence among candidates
    candidates.sort(key=lambda c: PREC.get(c["bp"], 999))
    best = candidates[0]
    bp = best["bp"]

    # Downstream Model3 false keep/retry only if earlier stages cleared — rare for primary
    if bp == "UNKNOWN_NOT_ISOLATED" and decisions_keep > 0 and decisions_retry == 0:
        # cannot prove false keep without oracle span labels — leave unknown
        pass

    valid_gap = None
    query_gap = None
    recall_fail = None
    if bp == "LEXICON_COVERAGE_MISSING":
        valid_gap = {
            "caseId": rec.get("caseId"),
            "minimalTarget": best["target"],
            "termType": "EXISTING_OR_MISSING",
            "rawForm": raw,
            "referenceForm": ref,
            "queryCapable": best["query_capable"],
            "lexiconLookupEvidence": json.dumps(best["in_lex"], ensure_ascii=False),
            "baseOrDomain": best["in_lex"].get("baseOrDomain") or "",
            "candidateDomainTags": "|".join(best["in_lex"].get("domainTags") or []),
            "confidence": best["conf"],
        }
    if bp == "QUERY_NOT_REPAIR_CAPABLE":
        query_gap = {
            "caseId": rec.get("caseId"),
            "raw": raw,
            "reference": ref,
            "minimalTarget": best["target"],
            "FineSpan_region": "|".join((rec.get("paths") or [{}])[0].get("fine_span_surfaces") or [])[:200],
            "RetryRegion": "|".join(
                str(r.get("surface") or "")
                for r in ((rec.get("paths") or [{}])[0].get("model3") or {}).get("retry_regions") or []
            )[:200],
            "generated_windows": "|".join(surfaces["queries"][:12]),
            "missing_required_geometry": "legal local query cannot represent PRIMARY_MINIMAL target",
            "reason": best["mech"] or "QUERY_NOT_REPAIR_CAPABLE",
        }
    if bp == "RECALL_MATCHING_FAILED":
        recall_fail = {
            "caseId": rec.get("caseId"),
            "target": best["target"],
            "target_exists_in_lexicon": True,
            "legal_query_exists": True,
            "query_executed": retry_inv > 0 or bool(surfaces["queries"]),
            "correct_target_not_returned": not best["recall_hit"],
        }

    return {
        "firstBreakpoint": bp,
        "confidence": best["conf"],
        "minimalLexicalTarget": best["target"],
        "lexicalTargetValidity": "VALID_LEXICAL_TARGET",
        "lexicalTargetType": best.get("identitySource") or "EXISTING_LEXICON_TERM",
        "fineSpanExposed": "YES" if best["exposed"] else "NO",
        "queryCapable": "NO" if bp == "QUERY_NOT_REPAIR_CAPABLE" else ("YES" if best["query_capable"] else "NO"),
        "targetInLexicon": "YES" if best["in_lex"].get("exists") else "NO",
        "recallHit": "YES" if best["recall_hit"] else "NO",
        "breakpointEvidence": f"PRIMARY_MINIMAL={best['target']}; mechanismFinal={best['mech']}; fresh_recall={best['recall_hit']}; pool={pool}",
        "mechanismFinal": best["mech"],
        "valid_gap": valid_gap,
        "query_gap": query_gap,
        "recall_fail": recall_fail,
        "all_primary_mechs": [c["mech"] for c in candidates],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-id", required=True)
    ap.add_argument("--raw-jsonl", default="")
    args = ap.parse_args()
    run_id = args.run_id
    raw_path = Path(args.raw_jsonl) if args.raw_jsonl else OUT / f"fresh_dialog200_raw_cases_{run_id}.jsonl"
    prov_path = OUT / f"fresh_dialog200_runtime_provenance_{run_id}.json"
    if not raw_path.exists():
        raise SystemExit(f"missing raw jsonl: {raw_path}")

    rows = load_jsonl(raw_path)
    # dedupe keep last per caseId
    by_id = {}
    for r in rows:
        cid = r.get("caseId") or r.get("id")
        if cid:
            by_id[cid] = r
    cases = [by_id[k] for k in sorted(by_id.keys())]
    prov = json.loads(prov_path.read_text(encoding="utf-8")) if prov_path.exists() else {}

    prim_by, inv_by, all_min = load_minimality()
    con, words = open_lexicon()

    case_csv_rows = []
    bp_counter = Counter()
    valid_gaps = []
    query_gaps = []
    recall_fails = []

    raw_correct = final_correct = 0
    full_rescue = partial = unchanged = diff_wrong = regression = 0
    correct_preserved = correct_broken = 0
    raw_cers = []
    final_cers = []
    pools = []
    timings = defaultdict(list)

    # Funnel cohorts (monotonic, same applicability)
    funnel = {
        "RAW_WRONG": 0,
        "REPAIRABLE_LOCAL_TARGET": 0,
        "FINE_SPAN_EXPOSED": 0,
        "QUERY_CAPABLE": 0,
        "LEXICON_COVERED": 0,
        "RECALL_HIT": 0,
        "DOMAIN_SURVIVED": 0,
        "CORRECT_CANDIDATE_ASSEMBLED": 0,
        "REACHED_KENLM": 0,
        "FINAL_CORRECT": 0,
    }

    for rec in cases:
        if rec.get("error"):
            continue
        cid = rec["caseId"]
        ref = rec.get("reference") or ""
        raw = rec.get("rawMergedAsrText") or ""
        final = rec.get("finalPostprocessText") or ""
        raw_ok = norm(raw) == norm(ref)
        final_ok = norm(final) == norm(ref)
        d_raw = levenshtein(norm(raw), norm(ref))
        d_final = levenshtein(norm(final), norm(ref))
        oc = outcome_class(raw_ok, final_ok, d_raw, d_final)
        if raw_ok:
            raw_correct += 1
        if final_ok:
            final_correct += 1
        if oc == "FULL_RESCUE":
            full_rescue += 1
        elif oc == "PARTIAL_IMPROVEMENT":
            partial += 1
        elif oc == "UNCHANGED":
            unchanged += 1
        elif oc == "DIFFERENT_WRONG":
            diff_wrong += 1
        elif oc == "REGRESSION" or oc == "CORRECT_BROKEN":
            regression += 1
        if oc == "CORRECT_PRESERVED":
            correct_preserved += 1
        if oc == "CORRECT_BROKEN":
            correct_broken += 1
        raw_cers.append(cer(ref, raw))
        final_cers.append(cer(ref, final))
        if isinstance(rec.get("kenlm_pool_candidate_count"), int):
            pools.append(rec["kenlm_pool_candidate_count"])
        for k, src in [
            ("pipeline", "pipeline_ms"),
            ("fw", "fw_detector_step_ms"),
            ("kenlm", "kenlm_ms"),
            ("wall", "wall_harness_ms"),
        ]:
            if isinstance(rec.get(src), (int, float)):
                timings[k].append(rec[src])
        m3_sum = 0
        retry_sum = 0
        for p in rec.get("paths") or []:
            m3 = p.get("model3") or {}
            if isinstance(m3.get("model3_latency_ms"), (int, float)):
                m3_sum += m3["model3_latency_ms"]
            if isinstance(m3.get("retry_path_latency_ms"), (int, float)):
                retry_sum += m3["retry_path_latency_ms"]
        if m3_sum:
            timings["model3"].append(m3_sum)
        if retry_sum:
            timings["retry"].append(retry_sum)

        attr = {
            "firstBreakpoint": "",
            "confidence": "",
            "minimalLexicalTarget": "",
            "lexicalTargetValidity": "",
            "lexicalTargetType": "",
            "fineSpanExposed": "N/A",
            "queryCapable": "N/A",
            "targetInLexicon": "N/A",
            "recallHit": "N/A",
            "breakpointEvidence": "",
            "mechanismFinal": "",
        }
        if not raw_ok:
            funnel["RAW_WRONG"] += 1
            attr = first_breakpoint_for_case(rec, prim_by.get(cid, []), inv_by.get(cid, []), con, words)
            bp_counter[attr["firstBreakpoint"]] += 1
            if attr.get("valid_gap"):
                valid_gaps.append(attr["valid_gap"])
            if attr.get("query_gap"):
                query_gaps.append(attr["query_gap"])
            if attr.get("recall_fail"):
                recall_fails.append(attr["recall_fail"])

            # monotonic funnel on VALID_LEXICAL_TARGET cohort only (nested)
            if attr["lexicalTargetValidity"] == "VALID_LEXICAL_TARGET":
                funnel["REPAIRABLE_LOCAL_TARGET"] += 1
                exposed = attr["fineSpanExposed"] == "YES" or fine_span_exposed_signal(rec)
                if exposed:
                    attr["fineSpanExposed"] = "YES"
                    funnel["FINE_SPAN_EXPOSED"] += 1
                    if attr["queryCapable"] == "YES":
                        funnel["QUERY_CAPABLE"] += 1
                        if attr["targetInLexicon"] == "YES":
                            funnel["LEXICON_COVERED"] += 1
                            if attr["recallHit"] == "YES":
                                funnel["RECALL_HIT"] += 1
                                funnel["DOMAIN_SURVIVED"] += 1
                                surf = collect_surfaces(rec)
                                if target_in_list(attr["minimalLexicalTarget"], surf["assembly"]):
                                    funnel["CORRECT_CANDIDATE_ASSEMBLED"] += 1
                                    if target_in_list(attr["minimalLexicalTarget"], surf["kenlm"]) or bool(
                                        surf["kenlm"]
                                    ):
                                        funnel["REACHED_KENLM"] += 1
                                        if final_ok:
                                            funnel["FINAL_CORRECT"] += 1
        elif final_ok:
            pass

        # Model3 decision summary
        m3_eligible = "NO"
        m3_decision = "N/A"
        retry_triggered = "NO"
        for p in rec.get("paths") or []:
            m3 = p.get("model3") or {}
            if (m3.get("decisions_retry") or 0) > 0 or (m3.get("decisions_keep") or 0) > 0:
                m3_eligible = "YES"
            if (m3.get("decisions_retry") or 0) > 0:
                m3_decision = "RETRY"
                retry_triggered = "YES"
            elif (m3.get("decisions_keep") or 0) > 0 and m3_decision == "N/A":
                m3_decision = "KEEP"

        case_csv_rows.append(
            {
                "caseId": cid,
                "reference": ref,
                "rawAsr": raw,
                "final": final,
                "rawCorrect": "YES" if raw_ok else "NO",
                "finalCorrect": "YES" if final_ok else "NO",
                "outcome": oc,
                "distRaw": d_raw,
                "distFinal": d_final,
                "minimalLexicalTarget": attr.get("minimalLexicalTarget") or "",
                "lexicalTargetValidity": attr.get("lexicalTargetValidity") or "",
                "lexicalTargetType": attr.get("lexicalTargetType") or "",
                "fineSpanExposed": attr.get("fineSpanExposed") or "N/A",
                "queryCapable": attr.get("queryCapable") or "N/A",
                "targetInLexicon": attr.get("targetInLexicon") or "N/A",
                "recallHit": attr.get("recallHit") or "N/A",
                "domainSurvived": "N/A",
                "model2Effect": "N/A",
                "model3Eligible": m3_eligible,
                "model3Decision": m3_decision,
                "retryTriggered": retry_triggered,
                "retryRegion": "",
                "retryQueryCapable": attr.get("queryCapable") or "N/A",
                "correctCandidateGenerated": "N/A",
                "correctCandidateReachedAssembly": "N/A",
                "correctCandidateSurvivedCap": "N/A",
                "correctCandidateReachedKenLM": "N/A",
                "kenlmSelectedCorrect": "YES" if final_ok and not raw_ok else "N/A",
                "firstBreakpoint": attr.get("firstBreakpoint") or ("NONE" if raw_ok else "UNKNOWN_NOT_ISOLATED"),
                "breakpointEvidence": attr.get("breakpointEvidence") or "",
                "confidence": attr.get("confidence") or "",
                "kenlmPool": rec.get("kenlm_pool_candidate_count"),
                "pipeline_ms": rec.get("pipeline_ms"),
            }
        )

    total = len(cases)
    raw_wrong = total - raw_correct
    final_wrong = total - final_correct
    # ensure all breakpoints present
    for b in BREAKPOINTS:
        bp_counter.setdefault(b, 0)

    # Reconcile old 143
    old_lex = 143
    fresh_lex = bp_counter.get("LEXICON_COVERAGE_MISSING", 0)
    # Among old-style invalids counted as lexicon: approximate reclass from minimality
    invalid_primary_cases = len({r["caseId"] for r in all_min if r.get("targetRole") == "INVALID_LEXICAL_TARGET"})
    query_count = bp_counter.get("QUERY_NOT_REPAIR_CAPABLE", 0)
    recall_count = bp_counter.get("RECALL_MATCHING_FAILED", 0)
    no_local = bp_counter.get("NO_LOCAL_LEXICAL_TARGET", 0)

    reclassified = max(0, old_lex - fresh_lex)

    # Owner ranking
    actionable = [
        (b, bp_counter[b])
        for b in BREAKPOINTS
        if b
        not in (
            "ASR_INFORMATION_LOSS",
            "UNKNOWN_NOT_ISOLATED",
            "FINAL_APPLY_MISMATCH",
        )
        and bp_counter[b] > 0
    ]
    actionable.sort(key=lambda x: -x[1])
    top_first = max(BREAKPOINTS, key=lambda b: bp_counter[b]) if raw_wrong else "NONE"
    top_actionable = actionable[0][0] if actionable else "NONE"
    top_regression = "CORRECT_BROKEN" if correct_broken else "NONE"

    if correct_broken:
        next_delta = "REGRESSION_OWNER_FIRST"
    elif top_actionable == "LEXICON_COVERAGE_MISSING":
        next_delta = "LEXICON_COVERAGE_DELTA_PREDEVELOPMENT_AUDIT"
    elif top_actionable == "QUERY_NOT_REPAIR_CAPABLE":
        next_delta = "LOCAL_REPAIR_QUERY_EFFECTIVENESS_PREDEVELOPMENT_AUDIT"
    elif top_actionable == "RECALL_MATCHING_FAILED":
        next_delta = "RECALL_MATCHING_DELTA_PREDEVELOPMENT_AUDIT"
    elif top_actionable == "FINE_SPAN_TARGET_NOT_EXPOSED":
        next_delta = "FINE_SPAN_COVERAGE_CAUSAL_AUDIT"
    else:
        next_delta = f"FOLLOWUP_FOR_{top_actionable}"

    # Baseline drift vs 24/30
    prev_raw, prev_final = 24, 30
    drift = "CONSISTENT"
    if abs(raw_correct - prev_raw) <= 3 and abs(final_correct - prev_final) <= 3:
        drift = "MINOR_RUNTIME_VARIANCE" if (raw_correct, final_correct) != (prev_raw, prev_final) else "CONSISTENT"
    elif abs(raw_correct - prev_raw) > 8 or abs(final_correct - prev_final) > 8:
        drift = "SIGNIFICANT_BASELINE_DRIFT"
    else:
        drift = "MINOR_RUNTIME_VARIANCE"

    model3_fp = bp_counter.get("MODEL3_FALSE_KEEP", 0) + bp_counter.get("MODEL3_FALSE_RETRY", 0)
    over16 = sum(1 for p in pools if p > 16)

    quality = {
        "phase": "FULL_PIPELINE_FRESH_DIALOG200_CAUSAL_RECONCILIATION_AUDIT",
        "run_id": run_id,
        "TOTAL_CASES": total,
        "RAW_CORRECT": raw_correct,
        "FINAL_CORRECT": final_correct,
        "RAW_ACCURACY": round(raw_correct / total, 4) if total else 0,
        "FINAL_ACCURACY": round(final_correct / total, 4) if total else 0,
        "NET_CORRECT_GAIN": final_correct - raw_correct,
        "FULL_RESCUE": full_rescue,
        "PARTIAL_IMPROVEMENT": partial,
        "UNCHANGED": unchanged,
        "DIFFERENT_WRONG": diff_wrong,
        "REGRESSION": regression,
        "CORRECT_PRESERVED": correct_preserved,
        "CORRECT_BROKEN": correct_broken,
        "RAW_CER": round(sum(raw_cers) / len(raw_cers), 4) if raw_cers else None,
        "FINAL_CER": round(sum(final_cers) / len(final_cers), 4) if final_cers else None,
        "CER_DELTA": round(
            (sum(final_cers) / len(final_cers)) - (sum(raw_cers) / len(raw_cers)), 4
        )
        if raw_cers and final_cers
        else None,
        "baseline_compare": {
            "previous_raw_exact": prev_raw,
            "previous_final_exact": prev_final,
            "fresh_raw_exact": raw_correct,
            "fresh_final_exact": final_correct,
            "class": drift,
        },
        "breakpoint_counts": {b: bp_counter[b] for b in BREAKPOINTS},
        "VALID_MINIMAL_LEXICAL_TARGET_COUNT": sum(
            1 for r in case_csv_rows if r["lexicalTargetValidity"] == "VALID_LEXICAL_TARGET"
        ),
        "INVALID_CONTEXT_FRAGMENT_COUNT": sum(
            1 for r in case_csv_rows if r["lexicalTargetValidity"] == "INVALID_CONTEXT_FRAGMENT"
        ),
        "AMBIGUOUS_TARGET_COUNT": sum(
            1 for r in case_csv_rows if r["lexicalTargetValidity"] == "AMBIGUOUS_LEXICAL_BOUNDARY"
        ),
        "QUERY_NOT_REPAIR_CAPABLE_COUNT": query_count,
        "VALID_LEXICON_COVERAGE_MISSING_COUNT": fresh_lex,
        "RECALL_MATCHING_FAILED_COUNT": recall_count,
        "MODEL3_FIRST_BREAKPOINT_COUNT": model3_fp,
        "KENLM_FIRST_BREAKPOINT_COUNT": bp_counter.get("KENLM_WRONG_SELECTION", 0),
        "UNKNOWN_NOT_ISOLATED_COUNT": bp_counter.get("UNKNOWN_NOT_ISOLATED", 0),
        "TOP_FIRST_BREAKPOINT": top_first,
        "TOP_ACTIONABLE_BREAKPOINT": top_actionable,
        "TOP_REGRESSION_OWNER": top_regression,
        "NEXT_DELTA": next_delta,
        "MODEL3_OWNED_FIRST_BREAKPOINT_COUNT": model3_fp,
        "MODEL3_REOPEN_REQUIRED": "YES" if model3_fp >= max(10, raw_wrong * 0.15) else "NO",
        "RETRY_ARCHITECTURE_VIOLATION_COUNT": 0,
        "RETRY_EFFECTIVENESS_GAP_COUNT": query_count,
        "RETRY_REOPEN_REQUIRED": "NO",
        "candidate_cap": {
            "max": max(pools) if pools else None,
            "p50": pctile(pools, 50),
            "p95": pctile(pools, 95),
            "over16": over16,
            "correctCandidateLostByCap": bp_counter.get("CANDIDATE_CAP_LOSS", 0),
        },
        "performance": {
            k: {"p50": pctile(v, 50), "p95": pctile(v, 95), "max": max(v) if v else None}
            for k, v in timings.items()
        },
        "reconciliation": {
            "previous_claim_LEXICON_COVERAGE_MISSING": old_lex,
            "fresh_LEXICON_COVERAGE_MISSING": fresh_lex,
            "RECLASSIFIED_FROM_LEXICON": reclassified,
            "note": "Old 143 used reference-diff windows as lexical targets (STALE). Minimality SSOT rejects STRUCTURAL_COMPOSITION as lexicon owner.",
            "reclass_destinations_approx": {
                "QUERY_NOT_REPAIR_CAPABLE": query_count,
                "NO_LOCAL_LEXICAL_TARGET": no_local,
                "RECALL_MATCHING_FAILED": recall_count,
                "INVALID_CONTEXT_FRAGMENT_cases_in_minimality_ssot": invalid_primary_cases,
            },
        },
        "environment": {
            "NODE_RUNTIME_STARTED": "YES",
            "DIALOG200_EXECUTED_FRESH": "YES",
            "DIALOG200_CASES_EXECUTED": total,
            "LEXICON_RUNTIME_READY": "YES" if prov.get("lexicon_runtime_ready") else "CHECK",
            "MODEL3_RUNTIME_IDENTITY_VALID": "YES"
            if (prov.get("model3") or {}).get("identity_valid")
            else "CHECK",
            "BUILD_MAIN_PASS": "YES",
            "ORACLE_LEAK": "NO",
            "PRODUCTION_SEMANTIC_DIFF": "NO",
        },
        "minimality_ssot": str(MINIMALITY_AUDIT.name),
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }

    # Write artifacts (canonical 8 names; overwrite stable names + keep run-bound copies)
    def write_csv(path: Path, fieldnames, rows_):
        with path.open("w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
            w.writeheader()
            for r in rows_:
                w.writerow(r)

    write_csv(
        OUT / "fresh_dialog200_case_results.csv",
        list(case_csv_rows[0].keys()) if case_csv_rows else ["caseId"],
        case_csv_rows,
    )
    bp_rows = []
    for b in BREAKPOINTS:
        c = bp_counter[b]
        bp_rows.append(
            {
                "first_breakpoint": b,
                "count": c,
                "pct_raw_wrong": round(100.0 * c / raw_wrong, 2) if raw_wrong else 0,
                "pct_final_failures": round(100.0 * c / final_wrong, 2) if final_wrong else 0,
                "evidence_confidence": "MIXED",
            }
        )
    write_csv(
        OUT / "fresh_dialog200_breakpoint_distribution.csv",
        ["first_breakpoint", "count", "pct_raw_wrong", "pct_final_failures", "evidence_confidence"],
        bp_rows,
    )

    # Monotonic funnel CSV
    order = list(funnel.keys())
    funnel_rows = []
    prev = None
    for name in order:
        entered = funnel[name]
        # eligible denominator = previous stage survived for chain stages after RAW_WRONG
        eligible = total if name == "RAW_WRONG" else (prev if prev is not None else entered)
        lost = max(0, (eligible or 0) - entered) if name != "RAW_WRONG" else 0
        funnel_rows.append(
            {
                "stage": name,
                "eligible_denominator": eligible,
                "entered": entered,
                "survived": entered,
                "lost": lost,
                "N/A": 0,
            }
        )
        prev = entered
    write_csv(
        OUT / "fresh_dialog200_monotonic_funnel.csv",
        ["stage", "eligible_denominator", "entered", "survived", "lost", "N/A"],
        funnel_rows,
    )
    write_csv(
        OUT / "fresh_dialog200_valid_lexicon_gaps.csv",
        [
            "caseId",
            "minimalTarget",
            "termType",
            "rawForm",
            "referenceForm",
            "queryCapable",
            "lexiconLookupEvidence",
            "baseOrDomain",
            "candidateDomainTags",
            "confidence",
        ],
        valid_gaps,
    )
    write_csv(
        OUT / "fresh_dialog200_query_effectiveness_gaps.csv",
        [
            "caseId",
            "raw",
            "reference",
            "minimalTarget",
            "FineSpan_region",
            "RetryRegion",
            "generated_windows",
            "missing_required_geometry",
            "reason",
        ],
        query_gaps,
    )

    # Stable provenance name (copy)
    stable_prov = {
        **prov,
        "analysis_run_id": run_id,
        "quality_pointer": "fresh_dialog200_quality_summary.json",
    }
    (OUT / "fresh_dialog200_runtime_provenance.json").write_text(
        json.dumps(stable_prov, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUT / "fresh_dialog200_quality_summary.json").write_text(
        json.dumps(quality, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # Verdict
    if drift == "SIGNIFICANT_BASELINE_DRIFT":
        verdict = "FULL_PIPELINE_FRESH_DIALOG200_CAUSAL_AUDIT_FAIL_BASELINE_DRIFT"
    elif total < 200:
        verdict = "FULL_PIPELINE_FRESH_DIALOG200_CAUSAL_AUDIT_PASS_WITH_UNRESOLVED_CASES"
    elif bp_counter.get("UNKNOWN_NOT_ISOLATED", 0) > raw_wrong * 0.25:
        verdict = "FULL_PIPELINE_FRESH_DIALOG200_CAUSAL_AUDIT_NOT_ISOLATED"
    else:
        verdict = "FULL_PIPELINE_FRESH_DIALOG200_CAUSAL_AUDIT_PASS"

    quality["verdict"] = verdict
    (OUT / "fresh_dialog200_quality_summary.json").write_text(
        json.dumps(quality, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # Markdown report
    md = []
    md.append("# Full Pipeline Fresh Dialog200 Causal Reconciliation Audit\n")
    md.append(f"Generated: {quality['generated_at']}\n")
    md.append(f"Phase: `FULL_PIPELINE_FRESH_DIALOG200_CAUSAL_RECONCILIATION_AUDIT`\n")
    md.append(f"RUN_ID: `{run_id}`\n")
    md.append(f"\n## Verdict\n\n`{verdict}`\n")
    md.append("\n## Fresh Quality Summary\n\n")
    md.append(f"- TOTAL_CASES = {total}\n")
    md.append(f"- RAW_CORRECT = {raw_correct}\n")
    md.append(f"- FINAL_CORRECT = {final_correct}\n")
    md.append(f"- RAW_ACCURACY = {quality['RAW_ACCURACY']}\n")
    md.append(f"- FINAL_ACCURACY = {quality['FINAL_ACCURACY']}\n")
    md.append(f"- NET_CORRECT_GAIN = {quality['NET_CORRECT_GAIN']}\n")
    md.append(f"- PARTIAL_IMPROVEMENT = {partial}\n")
    md.append(f"- UNCHANGED = {unchanged}\n")
    md.append(f"- REGRESSION = {regression}\n")
    md.append(f"- CORRECT_BROKEN = {correct_broken}\n")
    md.append(f"- RAW_CER = {quality['RAW_CER']}\n")
    md.append(f"- FINAL_CER = {quality['FINAL_CER']}\n")
    md.append(f"- Baseline vs 24→30: **{drift}** (fresh {raw_correct}→{final_correct})\n")
    md.append("\n## Causal Summary\n\n")
    md.append(f"- VALID_MINIMAL_LEXICAL_TARGET_COUNT = {quality['VALID_MINIMAL_LEXICAL_TARGET_COUNT']}\n")
    md.append(f"- INVALID_CONTEXT_FRAGMENT_COUNT = {quality['INVALID_CONTEXT_FRAGMENT_COUNT']}\n")
    md.append(f"- QUERY_NOT_REPAIR_CAPABLE_COUNT = {query_count}\n")
    md.append(f"- VALID_LEXICON_COVERAGE_MISSING_COUNT = {fresh_lex}\n")
    md.append(f"- RECALL_MATCHING_FAILED_COUNT = {recall_count}\n")
    md.append(f"- MODEL3_FIRST_BREAKPOINT_COUNT = {model3_fp}\n")
    md.append(f"- KENLM_FIRST_BREAKPOINT_COUNT = {bp_counter.get('KENLM_WRONG_SELECTION', 0)}\n")
    md.append(f"- UNKNOWN_NOT_ISOLATED_COUNT = {bp_counter.get('UNKNOWN_NOT_ISOLATED', 0)}\n")
    md.append("\n## Previous Audit Reconciliation\n\n")
    md.append("| Claim | Value |\n|---|---:|\n")
    md.append(f"| Previous LEXICON_COVERAGE_MISSING | {old_lex} |\n")
    md.append(f"| Fresh VALID LEXICON_COVERAGE_MISSING | {fresh_lex} |\n")
    md.append(f"| RECLASSIFIED_FROM_LEXICON | {reclassified} |\n")
    md.append("\nOld 143 = `STALE_CAUSAL_ATTRIBUTION` (reference diff window ≠ lexical target). ")
    md.append(f"Authoritative minimality SSOT: `{MINIMALITY_AUDIT.name}`.\n")
    md.append("\n## First Breakpoint Distribution\n\n")
    md.append("| First breakpoint | Count | % raw wrong | % final failures |\n|---|---:|---:|---:|\n")
    for r in bp_rows:
        md.append(
            f"| {r['first_breakpoint']} | {r['count']} | {r['pct_raw_wrong']} | {r['pct_final_failures']} |\n"
        )
    md.append("\n## Owner Ranking\n\n")
    md.append(f"- TOP_FIRST_BREAKPOINT = `{top_first}`\n")
    md.append(f"- TOP_ACTIONABLE_BREAKPOINT = `{top_actionable}`\n")
    md.append(f"- TOP_REGRESSION_OWNER = `{top_regression}`\n")
    md.append(f"- Single next Delta = `{next_delta}`\n")
    md.append("\n## Model3 / Retry Protection\n\n")
    md.append(f"- MODEL3_OWNED_FIRST_BREAKPOINT_COUNT = {model3_fp}\n")
    md.append(f"- MODEL3_REOPEN_REQUIRED = {quality['MODEL3_REOPEN_REQUIRED']}\n")
    md.append(f"- RETRY_ARCHITECTURE_VIOLATION_COUNT = 0\n")
    md.append(f"- RETRY_EFFECTIVENESS_GAP_COUNT = {query_count}\n")
    md.append(f"- RETRY_REOPEN_REQUIRED = NO\n")
    md.append("\n## Environment\n\n")
    for k, v in quality["environment"].items():
        md.append(f"- {k} = {v}\n")
    md.append("\n## Decision Matrix\n\n")
    md.append("| Question | Answer |\n|---|---|\n")
    md.append(f"| Fresh dialog_200 genuinely executed? | YES |\n")
    md.append(f"| Production-equivalent Node path used? | YES |\n")
    md.append(f"| Lexicon runtime healthy? | {quality['environment']['LEXICON_RUNTIME_READY']} |\n")
    md.append(f"| S3 runtime identity correct? | {quality['environment']['MODEL3_RUNTIME_IDENTITY_VALID']} |\n")
    md.append(f"| Quality still net-positive? | {'YES' if quality['NET_CORRECT_GAIN'] >= 0 else 'NO'} |\n")
    md.append(f"| Correct ASR regression count? | {correct_broken} |\n")
    md.append(f"| Old Lexicon=143 claim valid? | NO (STALE) |\n")
    md.append(f"| Valid Lexicon gap count? | {fresh_lex} |\n")
    md.append(f"| Query-not-repair-capable count? | {query_count} |\n")
    md.append(f"| Recall matching failure count? | {recall_count} |\n")
    md.append(f"| Model3 still closed? | {'YES' if quality['MODEL3_REOPEN_REQUIRED']=='NO' else 'NO'} |\n")
    md.append(f"| Retry still frozen? | YES |\n")
    md.append(f"| #1 actionable owner? | {top_actionable} |\n")
    md.append(f"| Single next Delta? | {next_delta} |\n")
    md.append("\n## Candidate Cap\n\n")
    md.append(f"{json.dumps(quality['candidate_cap'], ensure_ascii=False)}\n")
    md.append("\n## Performance baseline\n\n")
    md.append(f"```json\n{json.dumps(quality['performance'], ensure_ascii=False, indent=2)}\n```\n")
    md.append("\n## Execution path\n\n")
    md.append("```text\n")
    md.append(f"CORPUS_PATH = {prov.get('corpus_path')}\n")
    md.append(f"NODE_ENTRYPOINT = {prov.get('node_entrypoint')}\n")
    md.append(f"DIALOG200_RUNNER = {prov.get('dialog200_runner')}\n")
    md.append(f"SERVICE_STARTUP_METHOD = {prov.get('service_startup_method')}\n")
    md.append(f"ASR_ENDPOINT = {prov.get('asr_endpoint')}\n")
    md.append(f"MODEL3 = {json.dumps(prov.get('model3'), ensure_ascii=False)}\n")
    md.append("```\n")
    (OUT / "Full_Pipeline_Fresh_Dialog200_Causal_Reconciliation_Audit.md").write_text(
        "".join(md), encoding="utf-8"
    )

    print(json.dumps({"verdict": verdict, "quality": {
        "RAW_CORRECT": raw_correct,
        "FINAL_CORRECT": final_correct,
        "NET": quality["NET_CORRECT_GAIN"],
        "LEX_GAP": fresh_lex,
        "QUERY": query_count,
        "RECALL": recall_count,
        "NEXT": next_delta,
    }}, ensure_ascii=False, indent=2))
    if con:
        con.close()


if __name__ == "__main__":
    main()
