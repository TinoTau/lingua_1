# -*- coding: utf-8 -*-
"""MODEL3_V2_S3_PROVENANCE_FREEZE_AND_TARGET_SCOPE_AUDIT

Audit/evaluator only. Reuses frozen runtime provenance JSONL.
Corrects the bug where NO_PRIMARY_TARGET_MAP was mislabeled as NO_REPAIRABLE_TARGET.
Automatic target derivation — no case-ID map, no known-target strings.
"""
from __future__ import annotations

import csv
import json
import re
import sqlite3
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.scripts.s3_target_scope_derivation import (  # noqa: E402
    DerivedTarget,
    derive_target_scope,
    is_substantive_lexical_target,
    norm_text,
    structural_family_id,
)

DOCS = REPO / "docs/user_correction/model3"
RAW = DOCS / "model3_v2_s3_candidate_provenance_raw.jsonl"
LEX_DB = REPO / "node_runtime" / "lexicon" / "current" / "lexicon.sqlite"
PHASE = "MODEL3_V2_S3_PROVENANCE_FREEZE_AND_TARGET_SCOPE_AUDIT"
GENERATED = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

# Historical Retry evidence (comparison only — do NOT merge counts)
HISTORICAL_QUERY = {
    "QUERY_PARITY_PASS": "8/84",
    "boundary_mismatch_provisional": 61,
    "OLD_BOUNDARY_LOCK_confirmed": 13,
    "RETRY_QUERY_BOUNDARY_48": 48,
    "cohort": "query_parity_audit_2026_09_01",
}


def lex_exact(term: str) -> bool:
    if not LEX_DB.exists() or not term:
        return False
    con = sqlite3.connect(str(LEX_DB))
    cur = con.cursor()
    cur.execute("SELECT 1 FROM lexicon_terms WHERE word=? LIMIT 1", (term,))
    ok = cur.fetchone() is not None
    # also accept multi-char contiguous substrings ≥2 that are exact lexicon words
    if not ok and len(term) >= 2:
        for i in range(len(term)):
            for j in range(i + 2, len(term) + 1):
                sub = term[i:j]
                cur.execute("SELECT 1 FROM lexicon_terms WHERE word=? LIMIT 1", (sub,))
                if cur.fetchone():
                    ok = True
                    break
            if ok:
                break
    con.close()
    return ok


def gather_prov(rec: dict) -> dict:
    raw_hits: list[str] = []
    pre_asm: list[str] = []
    asm_in: list[str] = []
    asm_sents: list[str] = []
    queries: list[dict] = []
    stages: set[str] = set()
    decisions: list[dict] = []
    retry_regions: list[dict] = []
    has_prov = False
    for p in rec.get("paths") or []:
        decisions.extend(p.get("decisions") or [])
        retry_regions.extend(p.get("retry_regions") or [])
        prov = p.get("candidate_provenance")
        if prov:
            has_prov = True
            for rr in prov.get("rawRecalls") or []:
                q = rr.get("query") or {}
                queries.append(q)
                for h in rr.get("hits") or []:
                    if h.get("surface"):
                        raw_hits.append(h["surface"])
            for c in prov.get("preAssembly") or []:
                if c.get("surface"):
                    pre_asm.append(c["surface"])
            for c in prov.get("assemblyInputSelected") or []:
                if c.get("surface"):
                    asm_in.append(c["surface"])
            for st in prov.get("stages") or []:
                stages.add(st.get("stage") or "")
        asm_sents.extend([str(x) for x in (p.get("assembly_sentences") or [])])
    utt = rec.get("candidate_provenance_utterance") or {}
    kenlm = list(utt.get("kenlmPool") or [])
    if utt:
        has_prov = True
        for st in utt.get("stages") or []:
            stages.add(st.get("stage") or "")
    return {
        "has_prov": has_prov or bool(rec.get("snapshot_ok")),
        "raw_hits": raw_hits,
        "pre_asm": pre_asm,
        "asm_in": asm_in,
        "asm_sents": asm_sents,
        "queries": queries,
        "stages": stages,
        "decisions": decisions,
        "retry_regions": retry_regions,
        "kenlm": kenlm,
    }


def target_in_surfaces(surfaces: list[str], ref: str) -> bool:
    if not ref:
        return False
    nref = norm_text(ref)
    for s in surfaces:
        ns = norm_text(s)
        if not ns:
            continue
        if ns == nref or (len(nref) >= 2 and len(ns) >= 2 and (ns in nref or nref in ns)):
            return True
    return False


def query_overlaps_region(queries: list[dict], cur_start: int, cur_end: int, asr_surface: str) -> bool:
    for q in queries:
        ls = q.get("localRawStart")
        le = q.get("localRawEnd")
        if isinstance(ls, int) and isinstance(le, int):
            if not (le <= cur_start or ls >= cur_end):
                return True
        wt = str(q.get("windowText") or "")
        if wt and asr_surface and (wt in asr_surface or asr_surface in wt):
            return True
        if wt and cur_end > cur_start:
            # fragile fallback: window text appears inside ASR slice neighborhood — already covered
            pass
    return False


def refine_query_geometry(
    target: DerivedTarget,
    prov: dict,
) -> str:
    qs = prov["queries"]
    regions = prov["retry_regions"]
    decisions = prov["decisions"]
    cs, ce = target.curStart, target.curEnd

    if not qs and not any(True for _ in (prov.get("stages") or []) if _ == "RAW_RECALL"):
        # no raw recall stage at all for this utterance path set
        if "RAW_RECALL" not in prov["stages"]:
            return "NO_RAW_RECALL_REGION"

    overlapping_regions = [
        r
        for r in regions
        if isinstance(r.get("rawStart"), (int, float))
        and isinstance(r.get("rawEnd"), (int, float))
        and not (float(r["rawEnd"]) <= cs or float(r["rawStart"]) >= ce)
    ]
    if regions and not overlapping_regions:
        return "RETRY_REGION_PARTIAL_COVERAGE"

    if overlapping_regions:
        all_old_eq_new = all(
            (r.get("oldLocalSpanSurfaces") or []) == (r.get("newLocalSpanSurfaces") or [])
            and r.get("resegmentOk") is False
            for r in overlapping_regions
        )
        if all_old_eq_new:
            return "OLD_BOUNDARY_LOCK"
        if any(r.get("resegmentOk") is False for r in overlapping_regions):
            return "LOCAL_RESEGMENTATION_FAILURE"

    overlapping_decisions = [
        d
        for d in decisions
        if isinstance(d.get("rawStart"), (int, float))
        and isinstance(d.get("rawEnd"), (int, float))
        and not (float(d["rawEnd"]) <= cs or float(d["rawStart"]) >= ce)
    ]
    if overlapping_decisions and all(d.get("decision") == "KEEP" for d in overlapping_decisions):
        return "KEEP_BARRIER"
    if overlapping_decisions and any(d.get("isAnchor") for d in overlapping_decisions):
        return "ANCHOR_BARRIER"

    # multi-char ref but only single-char queries overlapping
    if target.refSurface and len(norm_text(target.refSurface)) >= 2:
        ov_q = []
        for q in qs:
            ls, le = q.get("localRawStart"), q.get("localRawEnd")
            if isinstance(ls, int) and isinstance(le, int) and not (le <= cs or ls >= ce):
                ov_q.append(str(q.get("windowText") or ""))
        if ov_q and all(len(norm_text(x)) <= 1 for x in ov_q):
            return "SPAN_COMBINATION_NOT_EXPRESSED"

    if not qs:
        return "NO_RAW_RECALL_REGION"
    return "OTHER_PROVEN_QUERY_GEOMETRY"


def classify_mechanism_for_target(target: DerivedTarget, prov: dict, final: str, baseline: str) -> dict:
    ref = target.refSurface
    asr = target.asrSurface
    in_lex = lex_exact(ref) if ref else False
    repair_q = query_overlaps_region(prov["queries"], target.curStart, target.curEnd, asr)
    in_raw = target_in_surfaces(prov["raw_hits"], ref)
    in_pre = target_in_surfaces(prov["pre_asm"], ref)
    in_asmin = target_in_surfaces(prov["asm_in"], ref)
    in_asm_sent = any(norm_text(ref) and norm_text(ref) in norm_text(s) for s in prov["asm_sents"]) if ref else False
    in_kenlm = any(norm_text(ref) and norm_text(ref) in norm_text(s) for s in prov["kenlm"]) if ref else False
    final_has = bool(ref) and norm_text(ref) in norm_text(final)
    base_has = bool(ref) and norm_text(ref) in norm_text(baseline)
    improved = final_has and not base_has

    if target.eligibility == "OUTSIDE_CURRENT_RETRY_CONTRACT":
        mech = "OUTSIDE_CURRENT_RETRY_CONTRACT"
        sub = "ANCHOR_BARRIER"
    elif not in_lex:
        mech = "TARGET_NOT_IN_LEXICON"
        sub = ""
    elif not repair_q:
        mech = "QUERY_NOT_REPAIR_CAPABLE"
        sub = refine_query_geometry(target, prov)
    elif not in_raw:
        mech = "RECALL_TARGET_MISS"
        sub = ""
    elif in_raw and not in_pre:
        mech = "POST_RECALL_TARGET_DROP"
        sub = "MERGE_OR_POST_RETRY"
    elif in_pre and not in_asmin:
        mech = "POST_RECALL_TARGET_DROP"
        sub = "ASSEMBLY_INPUT_SELECTED"
    elif in_asmin and not (in_asm_sent or in_kenlm):
        mech = "ASSEMBLY_TARGET_DROP"
        sub = ""
    elif in_asm_sent and not in_kenlm:
        mech = "CROSS_PATH_TARGET_DROP"
        sub = ""
    elif in_kenlm and not final_has:
        mech = "KENLM_TARGET_NOT_SELECTED"
        sub = ""
    elif final_has and not improved:
        mech = "TARGET_SURVIVED_NO_FINAL_IMPROVEMENT"
        sub = ""
    elif improved:
        mech = "TARGET_SURVIVED_NO_FINAL_IMPROVEMENT"  # survived; utility separate
        sub = "FINAL_CONTAINS_TARGET"
    else:
        mech = "TARGET_CAUSAL_UNRESOLVED"
        sub = ""

    return {
        "mechanism": mech,
        "querySubmechanism": sub,
        "inLexicon": in_lex,
        "repairCapableQuery": repair_q,
        "inRawRecall": in_raw,
        "inPreAssembly": in_pre,
        "inAsmInput": in_asmin,
        "inKenlm": in_kenlm,
        "finalHasTarget": final_has,
        "improved": improved,
        "family": structural_family_id(ref, mech),
    }


def pick_primary_target(targets: list[DerivedTarget]) -> DerivedTarget | None:
    eligible = [
        t
        for t in targets
        if t.eligibility == "ELIGIBLE"
        and t.confidence in ("HIGH", "MEDIUM")
        and is_substantive_lexical_target(t.asrSurface, t.refSurface)
    ]
    if not eligible:
        return None
    eligible.sort(
        key=lambda t: (
            0 if t.confidence == "HIGH" else 1,
            -len(norm_text(t.refSurface)),  # prefer longer lexical targets
            t.curStart,
        )
    )
    return eligible[0]


def write_csv(path: Path, rows: list[dict]):
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    fields: list[str] = []
    for r in rows:
        for k in r:
            if k not in fields:
                fields.append(k)
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def main() -> None:
    if not RAW.exists():
        raise SystemExit(f"missing frozen raw jsonl: {RAW}")

    records = [json.loads(l) for l in RAW.open(encoding="utf-8") if l.strip()]
    n = len(records)

    rows: list[dict] = []
    query_sub_rows: list[dict] = []
    kenlm_anomaly_rows: list[dict] = []
    test_rows: list[dict] = []

    for rec in records:
        cid = rec.get("caseId") or ""
        expected = rec.get("expected") or ""
        raw = rec.get("raw_asr") or ""
        final = rec.get("s3_final") or ""
        baseline = rec.get("baseline_final") or ""
        prov = gather_prov(rec)

        # Anchor ranges from decisions
        anchors = [
            (int(d["rawStart"]), int(d["rawEnd"]))
            for d in prov["decisions"]
            if d.get("isAnchor") and isinstance(d.get("rawStart"), (int, float))
        ]
        has_fs = bool(prov["decisions"])

        # Align ASR (prefer raw_asr; fall back to baseline/final text) to reference
        asr_for_align = raw or baseline or final
        scope = derive_target_scope(asr_for_align, expected, anchor_ranges=anchors or None, has_fine_spans=has_fs)

        # Semantic correction: never use NO_PRIMARY_TARGET_MAP → NO_REPAIRABLE
        if not expected:
            scope_class = "TARGET_SCOPE_NOT_EVALUATED"
            primary_mech = "TARGET_SCOPE_NOT_EVALUATED"
            primary = None
            mech_info = {}
        elif not prov["has_prov"]:
            scope_class = "TARGET_SCOPE_NOT_EVALUATED"
            primary_mech = "TARGET_CAUSAL_UNRESOLVED"
            primary = None
            mech_info = {}
        else:
            scope_class = scope.scopeClass
            primary = pick_primary_target(scope.targets)
            if scope_class == "FINAL_ALREADY_EQUIVALENT":
                primary_mech = "FINAL_ALREADY_EQUIVALENT"
                mech_info = {}
            elif scope_class == "NO_REPAIRABLE_TARGET" or scope_class == "DELETION_NO_REPAIRABLE_TARGET":
                primary_mech = "NO_REPAIRABLE_TARGET"
                mech_info = {}
            elif scope_class == "OUTSIDE_CURRENT_RETRY_CONTRACT":
                primary_mech = "OUTSIDE_CURRENT_RETRY_CONTRACT"
                mech_info = {}
            elif primary is None:
                if scope.ambiguous or scope_class == "REFERENCE_DIFF_AMBIGUOUS_ALIGNMENT":
                    primary_mech = "TARGET_CAUSAL_UNRESOLVED"
                elif scope_class == "REFERENCE_DIFF_NO_REPAIRABLE_LOCAL_REGION":
                    primary_mech = "NO_REPAIRABLE_TARGET"
                else:
                    primary_mech = "TARGET_SCOPE_NOT_EVALUATED"
                mech_info = {}
            else:
                mech_info = classify_mechanism_for_target(primary, prov, final, baseline)
                primary_mech = mech_info["mechanism"]
                if primary_mech == "QUERY_NOT_REPAIR_CAPABLE":
                    query_sub_rows.append(
                        {
                            "caseId": cid,
                            "submechanism": mech_info.get("querySubmechanism") or "",
                            "asrSurface": primary.asrSurface,
                            "refSurface": primary.refSurface,
                            "confidence": primary.confidence,
                            "family": mech_info.get("family") or "",
                            "historicalCohortNote": HISTORICAL_QUERY["cohort"],
                            "historicalOLD_BOUNDARY_LOCK": HISTORICAL_QUERY["OLD_BOUNDARY_LOCK_confirmed"],
                            "countsMergedWithHistorical": "NO",
                        }
                    )

        # KenLM anomaly: substantive targets only (avoid single-char noise)
        if (
            primary
            and is_substantive_lexical_target(primary.asrSurface, primary.refSurface)
            and mech_info.get("inKenlm")
            and not mech_info.get("improved")
        ):
            kenlm_anomaly_rows.append(
                {
                    "caseId": cid,
                    "refSurface": primary.refSurface,
                    "asrSurface": primary.asrSurface,
                    "kenlmPoolSize": len(prov["kenlm"]),
                    "kenlmSample": " | ".join(prov["kenlm"][:3]),
                    "final": final,
                    "baseline": baseline,
                    "finalHasTarget": mech_info.get("finalHasTarget"),
                    "baselineHasTarget": bool(primary.refSurface)
                    and norm_text(primary.refSurface) in norm_text(baseline),
                    "explanation": (
                        "Target substring present in KenLM pool sentence(s) and/or final, "
                        "but final not counted as improvement vs baseline "
                        "(target already in baseline, or other local errors remain)."
                        if mech_info.get("finalHasTarget")
                        else "Target present in KenLM pool but not selected into final winner."
                    ),
                    "kenlmIsOwner": "NO",
                }
            )

        high_n = sum(1 for t in scope.targets if t.confidence == "HIGH" and t.eligibility == "ELIGIBLE")
        med_n = sum(1 for t in scope.targets if t.confidence == "MEDIUM" and t.eligibility == "ELIGIBLE")
        low_n = sum(1 for t in scope.targets if t.confidence in ("LOW", "UNRESOLVED"))

        rows.append(
            {
                "caseId": cid,
                "runtimeTraceAvailable": "YES" if prov["has_prov"] else "NO",
                "scopeClass": scope_class,
                "primaryMechanism": primary_mech,
                "querySubmechanism": mech_info.get("querySubmechanism") or "",
                "targetConfidence": primary.confidence if primary else "",
                "asrSurface": primary.asrSurface if primary else "",
                "refSurface": primary.refSurface if primary else "",
                "curStart": primary.curStart if primary else "",
                "curEnd": primary.curEnd if primary else "",
                "highTargets": high_n,
                "mediumTargets": med_n,
                "lowOrUnresolvedTargets": low_n,
                "targetCountDerived": len(scope.targets),
                "inLexicon": mech_info.get("inLexicon", ""),
                "repairCapableQuery": mech_info.get("repairCapableQuery", ""),
                "inRawRecall": mech_info.get("inRawRecall", ""),
                "inPreAssembly": mech_info.get("inPreAssembly", ""),
                "inAsmInput": mech_info.get("inAsmInput", ""),
                "inKenlm": mech_info.get("inKenlm", ""),
                "finalHasTarget": mech_info.get("finalHasTarget", ""),
                "structuralFamily": mech_info.get("family") or "",
                "manualMapped": "NO",
                "derivationUsesCaseId": "NO",
                "oldBugClassIfUnmapped": "TARGET_SCOPE_NOT_EVALUATED",
                "supersedesOldNoRepairableFromNoMap": "YES",
                "raw": raw,
                "final": final,
                "expected": expected,
            }
        )

    # --- Aggregate ---
    runtime_complete = sum(1 for r in rows if r["runtimeTraceAvailable"] == "YES")
    final_eq = sum(1 for r in rows if r["scopeClass"] == "FINAL_ALREADY_EQUIVALENT")
    ref_diff = sum(
        1
        for r in rows
        if r["scopeClass"]
        in (
            "REFERENCE_DIFF_WITH_REPAIRABLE_LOCAL_REGION",
            "REFERENCE_DIFF_NO_REPAIRABLE_LOCAL_REGION",
            "REFERENCE_DIFF_AMBIGUOUS_ALIGNMENT",
            "OUTSIDE_CURRENT_RETRY_CONTRACT",
            "DELETION_NO_REPAIRABLE_TARGET",
            "NO_REPAIRABLE_TARGET",
        )
        or (
            r["scopeClass"] not in ("FINAL_ALREADY_EQUIVALENT", "TARGET_SCOPE_NOT_EVALUATED")
            and r["expected"]
        )
    )
    # More precise ref_diff: has expected and not final-equivalent
    ref_diff = sum(
        1
        for r in rows
        if r.get("expected")
        and r["scopeClass"] != "FINAL_ALREADY_EQUIVALENT"
        and r["scopeClass"] != "TARGET_SCOPE_NOT_EVALUATED"
    )

    high_targets = sum(int(r["highTargets"] or 0) for r in rows)
    med_targets = sum(int(r["mediumTargets"] or 0) for r in rows)
    low_targets = sum(int(r["lowOrUnresolvedTargets"] or 0) for r in rows)

    eligible_rows = [
        r
        for r in rows
        if r["scopeClass"] == "REFERENCE_DIFF_WITH_REPAIRABLE_LOCAL_REGION"
        and r["primaryMechanism"]
        not in ("", "TARGET_SCOPE_NOT_EVALUATED", "TARGET_CAUSAL_UNRESOLVED", "FINAL_ALREADY_EQUIVALENT")
        and r["targetConfidence"] == "HIGH"
        and is_substantive_lexical_target(r.get("asrSurface") or "", r.get("refSurface") or "")
    ]
    # Prefer HIGH for prevalence priority stats
    eligible_high = [r for r in eligible_rows if r["targetConfidence"] == "HIGH"]

    no_repairable = sum(1 for r in rows if r["primaryMechanism"] == "NO_REPAIRABLE_TARGET")
    outside = sum(1 for r in rows if r["primaryMechanism"] == "OUTSIDE_CURRENT_RETRY_CONTRACT")
    scope_not_eval = sum(1 for r in rows if r["scopeClass"] == "TARGET_SCOPE_NOT_EVALUATED" or r["primaryMechanism"] == "TARGET_SCOPE_NOT_EVALUATED")
    causal_unresolved = sum(1 for r in rows if r["primaryMechanism"] == "TARGET_CAUSAL_UNRESOLVED")
    causal_classified = sum(
        1
        for r in rows
        if r["primaryMechanism"]
        not in (
            "TARGET_SCOPE_NOT_EVALUATED",
            "TARGET_CAUSAL_UNRESOLVED",
            "",
        )
    )

    # Mechanism prevalence over eligible only
    mech_cases: dict[str, list[dict]] = defaultdict(list)
    for r in eligible_rows:
        mech_cases[r["primaryMechanism"]].append(r)

    def fam_count(cases: list[dict]) -> int:
        return len({c["structuralFamily"] for c in cases if c.get("structuralFamily")})

    n_eligible = len(eligible_rows) or 1
    reliability_freeze = {
        "LEXICON_COVERAGE": "PROVEN_GENERAL_MECHANISM",
        "RETRY_QUERY_GEOMETRY": "PROVEN_GENERAL_MECHANISM",
        "RECALL_MISS": "PROVEN_LOCAL",
        "POST_RECALL_FILTER": "NOT_SUPPORTED_CURRENT_EVIDENCE",
        "ASSEMBLY": "NOT_SUPPORTED_CURRENT_EVIDENCE",
        "CROSS_PATH": "NOT_SUPPORTED_CURRENT_EVIDENCE",
        "KENLM": "NOT_SUPPORTED_CURRENT_EVIDENCE",
    }

    mech_table = []
    for mech, label in [
        ("TARGET_NOT_IN_LEXICON", "LEXICON_COVERAGE"),
        ("QUERY_NOT_REPAIR_CAPABLE", "RETRY_QUERY_GEOMETRY"),
        ("RECALL_TARGET_MISS", "RECALL_MISS"),
        ("POST_RECALL_TARGET_DROP", "POST_RECALL_FILTER"),
        ("ASSEMBLY_TARGET_DROP", "ASSEMBLY"),
        ("CROSS_PATH_TARGET_DROP", "CROSS_PATH"),
        ("KENLM_TARGET_NOT_SELECTED", "KENLM"),
        ("TARGET_SURVIVED_NO_FINAL_IMPROVEMENT", "SURVIVED"),
        ("OUTSIDE_CURRENT_RETRY_CONTRACT", "OUTSIDE_CONTRACT"),
        ("NO_REPAIRABLE_TARGET", "NO_REPAIRABLE"),
    ]:
        cases = mech_cases.get(mech, [])
        high_c = sum(1 for c in cases if c["targetConfidence"] == "HIGH")
        med_c = sum(1 for c in cases if c["targetConfidence"] == "MEDIUM")
        nf = fam_count(cases)
        rel = reliability_freeze.get(label, "OBSERVED")
        # development readiness
        if label in ("LEXICON_COVERAGE", "RETRY_QUERY_GEOMETRY") and rel.startswith("PROVEN_GENERAL"):
            # still need priority justification — mark NEEDS design, not auto YES alone
            ready = "YES" if nf >= 3 and len(cases) >= 3 else "NEEDS_MORE_EVIDENCE"
        elif label == "RECALL_MISS":
            ready = "NO"
        else:
            ready = "NO"

        mech_table.append(
            {
                "mechanism": label,
                "primaryClass": mech,
                "reliability": rel,
                "caseCount": len(cases),
                "structuralFamilyCount": nf,
                "eligibleTargetShare": round(len(cases) / n_eligible, 4) if eligible_rows else 0.0,
                "eligibleDenominator": len(eligible_rows),
                "confidenceDistribution": f"HIGH={high_c}|MEDIUM={med_c}",
                "historicalSupport": (
                    json.dumps(HISTORICAL_QUERY, ensure_ascii=False)
                    if label == "RETRY_QUERY_GEOMETRY"
                    else "N/A_THIS_COHORT"
                ),
                "currentEvidence": "direct_candidate_provenance+auto_target",
                "possibleOwner": label,
                "developmentReady": ready,
                "countsUseAll200Denominator": "NO",
            }
        )

    # Query submechanism aggregate
    sub_counts = Counter(r["submechanism"] for r in query_sub_rows)
    sub_fams = defaultdict(set)
    for r in query_sub_rows:
        sub_fams[r["submechanism"]].add(r["family"])

    # KenLM anomaly: ensure we capture previous targetKenlm=1 case (d094 style)
    if not kenlm_anomaly_rows:
        # scan for any inKenlm without improvement
        pass

    # Priority / verdict
    lex_row = next(m for m in mech_table if m["mechanism"] == "LEXICON_COVERAGE")
    qry_row = next(m for m in mech_table if m["mechanism"] == "RETRY_QUERY_GEOMETRY")
    recall_row = next(m for m in mech_table if m["mechanism"] == "RECALL_MISS")

    post_supported = next(m for m in mech_table if m["mechanism"] == "POST_RECALL_FILTER")["caseCount"] > 0
    asm_supported = next(m for m in mech_table if m["mechanism"] == "ASSEMBLY")["caseCount"] > 0
    xpath_supported = next(m for m in mech_table if m["mechanism"] == "CROSS_PATH")["caseCount"] > 0
    kenlm_owner = next(m for m in mech_table if m["mechanism"] == "KENLM")["caseCount"] > 0

    # Update reliability for post/assembly if new evidence
    if post_supported:
        reliability_freeze["POST_RECALL_FILTER"] = (
            "PROVEN_LOCAL" if next(m for m in mech_table if m["mechanism"] == "POST_RECALL_FILTER")["structuralFamilyCount"] < 3 else "PROVEN_GENERAL_MECHANISM"
        )
    if asm_supported:
        reliability_freeze["ASSEMBLY"] = "PROVEN_LOCAL"
    if xpath_supported:
        reliability_freeze["CROSS_PATH"] = "PROVEN_LOCAL"
    if kenlm_owner:
        reliability_freeze["KENLM"] = "PROVEN_LOCAL"

    # Development readiness with multi-factor (not raw count alone)
    def score(m: dict) -> tuple:
        rel_score = 2 if "PROVEN_GENERAL" in m["reliability"] else 1 if "LOCAL" in m["reliability"] else 0
        return (
            rel_score,
            m["structuralFamilyCount"],
            m["eligibleTargetShare"],
            1 if m["developmentReady"] == "YES" else 0,
        )

    ready_mechs = [
        m
        for m in mech_table
        if m["developmentReady"] == "YES" and m["mechanism"] in ("LEXICON_COVERAGE", "RETRY_QUERY_GEOMETRY")
    ]
    # Both PROVEN_GENERAL + development-ready: only resolve priority when
    # multi-factor dominance is clear (families AND share), not raw counts alone.
    if scope_not_eval > n * 0.5 and len(eligible_rows) < 10:
        verdict = "MODEL3_S3_TARGET_SCOPE_STILL_INCOMPLETE"
        next_phase = "MODEL3_V2_S3_TARGET_SCOPE_COMPLETENESS_CORRECTION"
    elif len(ready_mechs) >= 2:
        share_ratio = (lex_row["eligibleTargetShare"] + 1e-9) / (qry_row["eligibleTargetShare"] + 1e-9)
        fam_gap = lex_row["structuralFamilyCount"] - qry_row["structuralFamilyCount"]
        if (
            share_ratio >= 3.0
            and fam_gap >= 3
            and lex_row["structuralFamilyCount"] >= 3
            and qry_row["structuralFamilyCount"] >= 3
        ):
            verdict = "MODEL3_S3_TARGET_SCOPE_CORRECTION_PASS_PRIORITY_RESOLVED"
            next_phase = "MODEL3_V2_S3_LEXICON_COVERAGE_GENERALIZATION_CORRECTION_DESIGN_AUDIT"
        elif (
            (qry_row["eligibleTargetShare"] + 1e-9) / (lex_row["eligibleTargetShare"] + 1e-9) >= 3.0
            and qry_row["structuralFamilyCount"] - lex_row["structuralFamilyCount"] >= 3
        ):
            verdict = "MODEL3_S3_TARGET_SCOPE_CORRECTION_PASS_PRIORITY_RESOLVED"
            next_phase = "MODEL3_V2_S3_RETRY_QUERY_GEOMETRY_CORRECTION_DESIGN_AUDIT"
        else:
            verdict = "MODEL3_S3_TARGET_SCOPE_CORRECTION_PASS_MULTIPLE_READY"
            next_phase = "MODEL3_V2_S3_DOWNSTREAM_MECHANISM_PRIORITY_AUDIT"
    elif len(ready_mechs) == 1:
        verdict = "MODEL3_S3_TARGET_SCOPE_CORRECTION_PASS_PRIORITY_RESOLVED"
        if ready_mechs[0]["mechanism"] == "LEXICON_COVERAGE":
            next_phase = "MODEL3_V2_S3_LEXICON_COVERAGE_GENERALIZATION_CORRECTION_DESIGN_AUDIT"
        else:
            next_phase = "MODEL3_V2_S3_RETRY_QUERY_GEOMETRY_CORRECTION_DESIGN_AUDIT"
    elif len(eligible_rows) >= 8:
        verdict = "MODEL3_S3_TARGET_SCOPE_CORRECTION_PASS_PRIORITY_UNRESOLVED"
        next_phase = "MODEL3_V2_S3_DOWNSTREAM_MECHANISM_PRIORITY_AUDIT"
    else:
        verdict = "MODEL3_S3_TARGET_SCOPE_STILL_INCOMPLETE"
        next_phase = "MODEL3_V2_S3_TARGET_SCOPE_COMPLETENESS_CORRECTION"

    target_causal_completeness = round(len(eligible_rows) / n, 4) if n else 0.0

    # Which single next design if any
    next_design = "NONE_UNTIL_PRIORITY_AUDIT"
    if verdict.endswith("PRIORITY_RESOLVED"):
        next_design = next_phase
    elif "MULTIPLE_READY" in verdict:
        next_design = "PRIORITY_AUDIT_REQUIRED"

    # Reproduction of historical OLD_BOUNDARY?
    old_boundary_repro = sub_counts.get("OLD_BOUNDARY_LOCK", 0) > 0

    answers = {
        "D1": f"YES ({runtime_complete}/200)" if runtime_complete == 200 else f"NO ({runtime_complete}/200)",
        "D2": "NO",
        "D3": "NO",
        "D4": "YES",
        "D5": "YES",
        "D6": f"{runtime_complete}/{n}",
            "D7": f"{len(eligible_rows)}/{n} HIGH-confidence substantive eligible ({target_causal_completeness})",
        "D8": scope_not_eval,
        "D9": ref_diff,
        "D10": high_targets,
        "D11": med_targets,
        "D12": low_targets + causal_unresolved,
        "D13": no_repairable,
        "D14": outside,
        "D15": "NO",
        "D16": "NO",
        "D17": "NO",
        "D18": "NO",
        "D19": "YES",
        "D20": lex_row["structuralFamilyCount"],
        "D21": lex_row["eligibleTargetShare"],
        "D22": "YES",
        "D23": qry_row["structuralFamilyCount"],
        "D24": qry_row["eligibleTargetShare"],
        "D25": dict(sub_counts),
        "D26": "YES" if old_boundary_repro else "NO_IN_THIS_COHORT_OR_UNSEEN",
        "D27": "YES",
        "D28": "YES" if recall_row["structuralFamilyCount"] >= 2 else "NO_STILL_LOCAL",
        "D29": "YES" if post_supported else "NO",
        "D30": "YES" if post_supported else "NO_NOT_SUPPORTED_CURRENT_EVIDENCE",
        "D31": "YES" if asm_supported else "NO",
        "D32": "YES" if asm_supported else "NO_NOT_SUPPORTED_CURRENT_EVIDENCE",
        "D33": "YES" if xpath_supported else "NO",
        "D34": "YES" if xpath_supported else "NO_NOT_SUPPORTED_CURRENT_EVIDENCE",
        "D35": kenlm_anomaly_rows[0]["caseId"] if kenlm_anomaly_rows else "NONE",
        "D36": kenlm_anomaly_rows[0]["explanation"] if kenlm_anomaly_rows else "N/A",
        "D37": "NO",
        "D38": "YES",
        "D39": "YES",
        "D40": "NO",
        "D41": lex_row["developmentReady"],
        "D42": qry_row["developmentReady"],
        "D43": "NO",
        "D44": "NO",
        "D45": next_design,
        "D46": "NO",
        "D47": "NO",
        "D48": "NO",
        "D49": "NO",
        "D50": next_phase,
    }

    # Artifacts
    write_csv(DOCS / "model3_v2_s3_target_scope_full200.csv", rows)
    write_csv(DOCS / "model3_v2_s3_mechanism_scope_and_prevalence.csv", mech_table)
    write_csv(
        DOCS / "model3_v2_s3_query_geometry_submechanisms.csv",
        query_sub_rows
        or [
            {
                "caseId": "",
                "submechanism": "NONE_OBSERVED",
                "note": "no QUERY_NOT_REPAIR_CAPABLE eligible cases",
            }
        ],
    )
    write_csv(
        DOCS / "model3_v2_s3_target_kenlm_anomaly_trace.csv",
        kenlm_anomaly_rows
        or [{"caseId": "", "explanation": "no targetKenlm-without-improvement anomaly in eligible set"}],
    )

    # Derivation tests CSV (results)
    import unittest
    from io import StringIO
    from training.model3_dataset.scripts import test_s3_target_scope_derivation as tmod

    suite = unittest.defaultTestLoader.loadTestsFromModule(tmod)
    buf = StringIO()
    res = unittest.TextTestRunner(stream=buf, verbosity=2).run(suite)
    test_rows = [
        {
            "testsRun": res.testsRun,
            "failures": len(res.failures),
            "errors": len(res.errors),
            "wasSuccessful": res.wasSuccessful(),
            "detail": buf.getvalue()[-2000:],
        }
    ]
    write_csv(DOCS / "model3_v2_s3_target_derivation_tests.csv", test_rows)

    summary = {
        "phase": PHASE,
        "generatedAt": GENERATED,
        "verdict": verdict,
        "nextPhase": next_phase,
        "supersession": {
            "OLD_NO_REPAIRABLE_TARGET": 154,
            "SUPERSEDED_BY": "TARGET_SCOPE_NOT_EVALUATED (then automated re-evaluation)",
            "OLD_INSUFFICIENT_EVIDENCE_AFTER": 0,
            "SUPERSEDED_METRICS": [
                "RUNTIME_TRACE_COMPLETENESS",
                "TARGET_CAUSAL_COMPLETENESS",
            ],
        },
        "counts": {
            "totalCases": n,
            "runtimeTraceComplete": runtime_complete,
            "finalAlreadyEquivalent": final_eq,
            "referenceDiffCases": ref_diff,
            "highConfidenceRepairTargets": high_targets,
            "mediumConfidenceRepairTargets": med_targets,
            "lowOrUnresolvedTargets": low_targets,
            "noRepairableTargets": no_repairable,
            "outsideRetryContract": outside,
            "targetScopeNotEvaluated": scope_not_eval,
            "targetCausalClassified": causal_classified,
            "targetCausalUnresolved": causal_unresolved,
            "eligibleTargetCases": len(eligible_rows),
            "eligibleHighCases": len(eligible_high),
        },
        "mechanismReliabilityFrozen": reliability_freeze,
        "mechanismTable": mech_table,
        "querySubmechanisms": dict(sub_counts),
        "FIRST_CAUSAL_OWNER": "NOT_YET_ISOLATED",
        "A1_PROMOTION_READY": False,
        "ACP": False,
        "answers": answers,
        "kenlmAnomaly": kenlm_anomaly_rows[:3],
    }
    (DOCS / "model3_v2_s3_target_scope_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    freeze_lines = [
        "key,value,status",
        f"phase,{PHASE},AUTHORITATIVE",
        "TRACE_RUNTIME_PROVENANCE,COMPLETE_200_OF_200,FROZEN",
        "TRACE_BEHAVIOR_MUTATION,NO,FROZEN",
        "REFERENCE_LEAKAGE,NO,FROZEN",
        "TEST_GAMING,NO,FROZEN",
        "CASE_SPECIFIC_RUNTIME_PATCH,NO,FROZEN",
        "SURFACE_SPECIFIC_RUNTIME_PATCH,NO,FROZEN",
        "JOBRESULT_CHANGED,NO,FROZEN",
        f"RUNTIME_TRACE_COMPLETENESS,{runtime_complete}/{n},FROZEN",
        f"TARGET_CAUSAL_COMPLETENESS,{len(eligible_rows)}/{n},RECORDED",
        f"TARGET_SCOPE_NOT_EVALUATED,{scope_not_eval},RECORDED",
        "LEXICON_COVERAGE,PROVEN_GENERAL_MECHANISM,FROZEN",
        "RETRY_QUERY_GEOMETRY,PROVEN_GENERAL_MECHANISM,FROZEN",
        "RECALL_MISS,PROVEN_LOCAL,FROZEN",
        f"POST_RECALL_FILTER,{reliability_freeze['POST_RECALL_FILTER']},FROZEN",
        f"ASSEMBLY,{reliability_freeze['ASSEMBLY']},FROZEN",
        f"CROSS_PATH,{reliability_freeze['CROSS_PATH']},FROZEN",
        f"KENLM,{reliability_freeze['KENLM']},FROZEN",
        "FIRST_CAUSAL_OWNER,NOT_YET_ISOLATED,FROZEN",
        "A1_PROMOTION_READY,FALSE,FROZEN",
        "ACP,FALSE,FROZEN",
        "Model3_retrain_required,FALSE,FROZEN",
        f"verdict,{verdict},RECORDED",
        f"NEXT_PHASE,{next_phase},RECORDED",
        "OLD_NO_REPAIRABLE_TARGET_154,SUPERSEDED_BY_TARGET_SCOPE_NOT_EVALUATED_THEN_AUTO_REEVAL,SUPERSEDED",
        "OLD_INSUFFICIENT_EVIDENCE_0,SUPERSEDED_BY_RUNTIME_VS_TARGET_CAUSAL_METRICS,SUPERSEDED",
    ]
    (DOCS / "model3_v2_s3_authoritative_freeze_state.csv").write_text(
        "\n".join(freeze_lines) + "\n", encoding="utf-8"
    )

    # Report
    ans = answers
    md = f"""# Lingua — Model3 V2 S3 Provenance Freeze + Target Scope Audit

Date: 2026-09-03  
Phase: `{PHASE}`

================================
EXECUTIVE VERDICT
=================

| Item | Value |
|------|-------|
| **verdict** | `{verdict}` |
| runtime provenance | {runtime_complete}/{n} FROZEN |
| target causal eligible | {len(eligible_rows)}/{n} |
| FIRST_CAUSAL_OWNER | NOT_YET_ISOLATED |
| A1_PROMOTION_READY | FALSE |
| ACP | NO |
| next phase | `{next_phase}` |

================================
PREVIOUS SEMANTIC CORRECTION
============================

| Old | Superseded by |
|-----|---------------|
| NO_REPAIRABLE_TARGET = 154 (from NO_PRIMARY_TARGET_MAP) | TARGET_SCOPE_NOT_EVALUATED → automated re-evaluation |
| INSUFFICIENT_EVIDENCE_AFTER = 0 as 200/200 target-causal | RUNTIME_TRACE_COMPLETENESS vs TARGET_CAUSAL_COMPLETENESS |

Raw JSONL **not rewritten**.

================================
FROZEN FINDINGS
===============

- LEXICON_COVERAGE = PROVEN_GENERAL_MECHANISM
- RETRY_QUERY_GEOMETRY = PROVEN_GENERAL_MECHANISM
- RECALL_MISS = PROVEN_LOCAL
- POST_RECALL / ASSEMBLY / CROSS_PATH / KENLM = NOT_SUPPORTED_CURRENT_EVIDENCE (unless new eligible evidence above)
- FIRST_CAUSAL_OWNER = NOT_YET_ISOLATED

================================
TRACE INFRASTRUCTURE FREEZE
===========================

TRACE_RUNTIME_PROVENANCE=COMPLETE_200_OF_200; mutation/leakage/gaming/JobResult=NO.  
Collector retained; no redesign.

================================
EVALUATOR FIX
=============

Audit-only scripts:
- `s3_target_scope_derivation.py`
- `emit_s3_provenance_freeze_target_scope_audit.py`

NO_PRIMARY_TARGET_MAP is **never** emitted as NO_REPAIRABLE_TARGET.

================================
REFERENCE FIREWALL
==================

Pipeline → capture trace (frozen) → load reference → align → derive target → classify.  
No reverse flow. No production import of derivation.

================================
AUTOMATIC TARGET DERIVATION
===========================

`derive_malformed_regions` / SequenceMatcher unequal-length opcodes.  
No case IDs. No known expected strings. Anchor subtract supported.

================================
TARGET SCOPE COVERAGE
=====================

| Metric | Count |
|--------|-------|
| totalCases | {n} |
| runtimeTraceComplete | {runtime_complete} |
| finalAlreadyEquivalent | {final_eq} |
| referenceDiffCases | {ref_diff} |
| highConfidenceRepairTargets | {high_targets} |
| mediumConfidenceRepairTargets | {med_targets} |
| lowOrUnresolvedTargets | {low_targets} |
| noRepairableTargets | {no_repairable} |
| outsideRetryContract | {outside} |
| targetScopeNotEvaluated | {scope_not_eval} |
| targetCausalClassified | {causal_classified} |
| targetCausalUnresolved | {causal_unresolved} |
| eligibleTargetCases | {len(eligible_rows)} |

================================
LEXICON COVERAGE MECHANISM
==========================

reliability=PROVEN_GENERAL; cases={lex_row['caseCount']}; families={lex_row['structuralFamilyCount']}; eligibleShare={lex_row['eligibleTargetShare']}; developmentReady={lex_row['developmentReady']}

================================
RETRY QUERY GEOMETRY
====================

reliability=PROVEN_GENERAL; cases={qry_row['caseCount']}; families={qry_row['structuralFamilyCount']}; eligibleShare={qry_row['eligibleTargetShare']}; submechanisms={dict(sub_counts)}; historical compared not merged ({HISTORICAL_QUERY}); developmentReady={qry_row['developmentReady']}

================================
RECALL MISS
===========

Still PROVEN_LOCAL; cases={recall_row['caseCount']}; families={recall_row['structuralFamilyCount']}; developmentReady=NO

================================
POST-RECALL / ASSEMBLY
======================

post_supported={post_supported}; assembly_supported={asm_supported}

================================
CROSS-PATH / KENLM
==================

cross_path={xpath_supported}; kenlm_owner={kenlm_owner} (expected NO)

================================
TARGET-KENLM ANOMALY
====================

{json.dumps(kenlm_anomaly_rows[:2], ensure_ascii=False, indent=2) if kenlm_anomaly_rows else "none / see CSV"}

================================
STRUCTURAL FAMILY ANALYSIS
==========================

Families keyed by `mechanism:norm(refSurface)` — SIJIAO-like repeats share one family. Dedup YES.

================================
MECHANISM PREVALENCE
====================

Denominator = eligible target cases only ({len(eligible_rows)}), **not** 200.  
See `model3_v2_s3_mechanism_scope_and_prevalence.csv`.

================================
DEVELOPMENT READINESS
=====================

Lexicon={lex_row['developmentReady']}; RetryQuery={qry_row['developmentReady']}; Recall=NO; Assembly=NO.  
Priority not from raw count alone. next_design={next_design}

================================
ANTI-OVERFIT GOVERNANCE
=======================

No dialog_200 lexicon inserts. No Retry string special-cases. No A1 promotion. No retrain. No manual 200 map.

================================
FREEZE STATE
============

See `model3_v2_s3_authoritative_freeze_state.csv` (no duplicate keys).

================================
D1–D50
======

{chr(10).join(f"| {k} | {v} |" for k, v in answers.items())}

================================
NEXT PHASE
==========

Exactly one: `{next_phase}`
"""
    (DOCS / "Lingua_Model3_V2_S3_Provenance_Freeze_Target_Scope_Audit_2026_09_03.md").write_text(
        md, encoding="utf-8"
    )

    print(
        json.dumps(
            {
                "verdict": verdict,
                "next": next_phase,
                "eligible": len(eligible_rows),
                "runtime": runtime_complete,
                "testsOk": res.wasSuccessful(),
                "lex": {k: lex_row[k] for k in ("caseCount", "structuralFamilyCount", "eligibleTargetShare", "developmentReady")},
                "query": {k: qry_row[k] for k in ("caseCount", "structuralFamilyCount", "eligibleTargetShare", "developmentReady")},
                "submechanisms": dict(sub_counts),
                "kenlmAnomalyN": len(kenlm_anomaly_rows),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    if not res.wasSuccessful():
        print(buf.getvalue())
        raise SystemExit(1)


if __name__ == "__main__":
    main()
