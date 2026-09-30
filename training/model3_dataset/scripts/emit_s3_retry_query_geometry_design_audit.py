# -*- coding: utf-8 -*-
"""MODEL3_V2_S3_RETRY_QUERY_GEOMETRY_CORRECTION_DESIGN_AUDIT

Read-only design audit. Consumes frozen provenance + minimality artifacts.
No production code change. No JobResult change.
"""
from __future__ import annotations

import csv
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.scripts.emit_s3_lexical_target_identity_audit import (  # noqa: E402
    gather_prov,
)
from training.model3_dataset.scripts.s3_lexical_target_identity import (  # noqa: E402
    derive_case_lexical_targets,
    load_authoritative_lexicon_terms,
)
from training.model3_dataset.scripts.s3_target_scope_derivation import norm_text  # noqa: E402

DOCS = REPO / "docs/user_correction/model3"
RAW = DOCS / "model3_v2_s3_candidate_provenance_raw.jsonl"
EVENTS = DOCS / "model3_v2_s3_repair_events.csv"
MIN_TARGETS = DOCS / "model3_v2_s3_minimal_repair_targets.csv"
PHASE = "MODEL3_V2_S3_RETRY_QUERY_GEOMETRY_CORRECTION_DESIGN_AUDIT"
GENERATED = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def write_csv(path: Path, rows: list[dict]) -> None:
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


def overlaps(a0: int, a1: int, b0: int, b1: int) -> bool:
    return a0 < b1 and a1 > b0


def coverage_relation(q0: int, q1: int, t0: int, t1: int) -> str:
    if q0 < 0 or q1 <= q0:
        return "NO_QUERY"
    if not overlaps(q0, q1, t0, t1):
        return "DISJOINT"
    if q0 == t0 and q1 == t1:
        return "EXACT"
    if q0 <= t0 and q1 >= t1:
        return "QUERY_CONTAINS_TARGET"
    if t0 <= q0 and t1 >= q1:
        return "TARGET_CONTAINS_QUERY"
    if q0 < t0 and q1 < t1:
        return "LEFT_PARTIAL"
    if q0 > t0 and q1 > t1:
        return "RIGHT_PARTIAL"
    return "LEFT_PARTIAL" if q0 < t0 else "RIGHT_PARTIAL"


def collect_path_geometry(rec: dict) -> dict:
    """Union geometry across paths from frozen provenance."""
    decisions = []
    regions = []
    queries = []
    resegment_flags = []
    second_vote = False
    model3_reinvoked = False
    for p in rec.get("paths") or []:
        decisions.extend(p.get("decisions") or [])
        for r in p.get("retry_regions") or []:
            regions.append(r)
            resegment_flags.append(bool(r.get("resegmentOk")))
            if r.get("secondDomainVote"):
                second_vote = True
            if r.get("model3Reinvoked"):
                model3_reinvoked = True
        prov = p.get("candidate_provenance") or {}
        for rr in prov.get("rawRecalls") or []:
            q = rr.get("query") or {}
            queries.append(q)
        for inv in p.get("retry_recall_invocations") or []:
            # richer when dialog200 trace on; may duplicate provenance
            if inv.get("windowText") is not None:
                queries.append(
                    {
                        "windowText": inv.get("windowText"),
                        "windowPinyinKey": inv.get("windowPinyinKey"),
                        "localRawStart": inv.get("spanStart"),
                        "localRawEnd": inv.get("spanEnd"),
                        "ownerSpanId": inv.get("ownerSpanId"),
                        "syllables": inv.get("syllables"),
                        "fromInvocationTrace": True,
                    }
                )
    retry_spans = [d for d in decisions if d.get("decision") == "RETRY" and not d.get("isAnchor")]
    keep_spans = [d for d in decisions if d.get("decision") == "KEEP"]
    anchor_spans = [d for d in decisions if d.get("isAnchor")]
    return {
        "decisions": decisions,
        "retry_spans": retry_spans,
        "keep_spans": keep_spans,
        "anchor_spans": anchor_spans,
        "regions": regions,
        "queries": queries,
        "resegmentAnyOk": any(resegment_flags) if resegment_flags else False,
        "resegmentAllFail": bool(resegment_flags) and not any(resegment_flags),
        "secondDomainVote": second_vote,
        "model3Reinvoked": model3_reinvoked,
        "hasRegions": len(regions) > 0,
        "hasQueries": len(queries) > 0,
    }


def span_union(spans: list[dict], start_k="rawStart", end_k="rawEnd") -> list[tuple[int, int]]:
    out = []
    for s in spans:
        a, b = s.get(start_k), s.get(end_k)
        if isinstance(a, (int, float)) and isinstance(b, (int, float)) and b > a:
            out.append((int(a), int(b)))
    return out


def any_overlap(intervals: list[tuple[int, int]], t0: int, t1: int) -> bool:
    return any(overlaps(a, b, t0, t1) for a, b in intervals)


def first_loss_for_event(
    *,
    asr_t0: int,
    asr_t1: int,
    geo: dict,
) -> dict:
    """Audit-side first YES→NO geometry loss vs ASR locus of repair event."""
    retry_iv = span_union(geo["retry_spans"])
    region_iv = span_union(geo["regions"])
    query_iv = []
    for q in geo["queries"]:
        a, b = q.get("localRawStart"), q.get("localRawEnd")
        if isinstance(a, (int, float)) and isinstance(b, (int, float)) and b > a:
            query_iv.append((int(a), int(b)))

    representable_model3 = any_overlap(retry_iv, asr_t0, asr_t1) if retry_iv else False
    # After merge: same as region union of RETRY spans (deriveRetryRegions)
    representable_merge = any_overlap(region_iv, asr_t0, asr_t1) if region_iv else False
    # Barrier: if Model3 had RETRY on locus but region lost it → barrier/clip
    representable_barrier = representable_merge  # cannot distinguish clip without per-span barrier trace
    representable_regional = representable_merge  # regional input = region bounds
    # FineSpan/path: approximated by whether any query exists inside region overlapping target
    # If region covers but no query overlaps → loss at QUERY_WINDOW / LOCAL_SPAN
    representable_query = any_overlap(query_iv, asr_t0, asr_t1) if query_iv else False

    stages = [
        ("MODEL3_RETRY_SPAN", representable_model3),
        ("RETRY_SPAN_MERGE", representable_merge),
        ("BARRIER_CLIP", representable_barrier),
        ("REGION_DERIVATION", representable_regional),
        ("REGIONAL_LATTICE_INPUT", representable_regional),
        ("QUERY_WINDOW_ENUMERATION", representable_query),
        ("QUERY_KEY_CONSTRUCTION", representable_query),
        ("RECALL_INVOCATION", representable_query and geo["hasQueries"]),
    ]

    first_loss = "UNRESOLVED"
    prev = True
    for name, ok in stages:
        if prev and not ok:
            first_loss = name
            break
        prev = ok
    else:
        if representable_query:
            first_loss = "NONE_QUERY_ADEQUATE"  # should not happen for QUERY_NOT_REPAIR_CAPABLE
        elif not geo["hasRegions"] and not geo["hasQueries"]:
            first_loss = "NO_RAW_RECALL_REGION"
        else:
            first_loss = "UNRESOLVED"

    # Refine: Model3 miss vs region miss
    if not representable_model3:
        first_loss = "MODEL3_RETRY_SPAN"
        drop_reason = "SPAN_NOT_MARKED_RETRY_ON_ASR_LOCUS"
    elif representable_model3 and not representable_merge:
        first_loss = "RETRY_SPAN_MERGE"
        drop_reason = "MERGE_OR_BARRIER_SPLIT_LOST_LOCUS"
    elif representable_merge and not representable_query:
        if geo["resegmentAllFail"]:
            first_loss = "REGIONAL_FINESPAN_GENERATION"
            drop_reason = "BOUNDARY_LOCK_OR_FALLBACK_NO_COVERING_LOCAL_SPAN"
        elif not geo["hasQueries"]:
            first_loss = "NO_RAW_RECALL_REGION"
            drop_reason = "NO_QUERY_KEY"
        else:
            first_loss = "QUERY_WINDOW_ENUMERATION"
            drop_reason = "SPAN_NOT_ENUMERATED"
    else:
        drop_reason = "UNRESOLVED"

    # Coverage relations for best query
    best_rel = "NO_QUERY"
    if query_iv:
        # pick query with max overlap
        best = max(query_iv, key=lambda iv: max(0, min(iv[1], asr_t1) - max(iv[0], asr_t0)))
        best_rel = coverage_relation(best[0], best[1], asr_t0, asr_t1)
    elif region_iv:
        best = max(region_iv, key=lambda iv: max(0, min(iv[1], asr_t1) - max(iv[0], asr_t0)))
        best_rel = coverage_relation(best[0], best[1], asr_t0, asr_t1)
        if best_rel != "DISJOINT" and best_rel != "NO_QUERY":
            best_rel = f"REGION_ONLY_{best_rel}"

    return {
        "targetRepresentableAtModel3Span": representable_model3,
        "targetRepresentableAfterMerge": representable_merge,
        "targetRepresentableAfterBarrierClip": representable_barrier,
        "targetRepresentableInRegionalInput": representable_regional,
        "targetRepresentableInEnumeratedQueryWindow": representable_query,
        "targetRepresentableInFinalQueryKey": representable_query,
        "RecallInvokedForRepairCapableKey": representable_query,
        "FIRST_GEOMETRY_LOSS_STAGE": first_loss,
        "dropReason": drop_reason,
        "targetCoverageRelation": best_rel,
        "retrySpanCount": len(retry_iv),
        "regionCount": len(region_iv),
        "queryCount": len(query_iv),
    }


def main() -> None:
    records = {json.loads(l)["caseId"]: json.loads(l) for l in RAW.open(encoding="utf-8") if l.strip()}
    # fix double parse
    records = {}
    for line in RAW.open(encoding="utf-8"):
        if not line.strip():
            continue
        rec = json.loads(line)
        records[rec["caseId"]] = rec

    events = list(csv.DictReader(EVENTS.open(encoding="utf-8")))
    min_rows = list(csv.DictReader(MIN_TARGETS.open(encoding="utf-8")))
    primary_by_event = {
        r["repairEventId"]: r
        for r in min_rows
        if r["targetRole"] == "PRIMARY_MINIMAL"
    }
    # also allow alt-only events
    for r in min_rows:
        if r["targetRole"] == "ALTERNATIVE_MINIMAL" and r["repairEventId"] not in primary_by_event:
            primary_by_event[r["repairEventId"]] = r

    inv = load_authoritative_lexicon_terms()

    # Cache ASR locus per (caseId, regionId) from derivation
    asr_locus: dict[tuple[str, str], tuple[int, int, str, str]] = {}
    for cid, rec in records.items():
        expected = rec.get("expected") or ""
        raw = rec.get("raw_asr") or ""
        final = rec.get("s3_final") or ""
        baseline = rec.get("baseline_final") or ""
        asr = raw or baseline or final
        prov = gather_prov(rec)
        anchors = [
            (int(d["rawStart"]), int(d["rawEnd"]))
            for d in prov["decisions"]
            if d.get("isAnchor") and isinstance(d.get("rawStart"), (int, float))
        ]
        _scope, bundles = derive_case_lexical_targets(
            asr,
            expected,
            anchor_ranges=anchors or None,
            has_fine_spans=bool(prov["decisions"]),
            inventory=inv,
        )
        for b in bundles:
            if b.normalizationEquivalent:
                continue
            cs = b.curStart if isinstance(b.curStart, int) else -1
            ce = b.curEnd if isinstance(b.curEnd, int) else -1
            asr_locus[(cid, b.regionId)] = (cs, ce, b.asrSurface or "", b.refSurface or "")

    query_events = [
        e
        for e in events
        if e["mechanism"] == "QUERY_NOT_REPAIR_CAPABLE"
    ]
    partial = [e for e in query_events if e.get("querySubmechanism") == "RETRY_REGION_PARTIAL_COVERAGE"]
    no_raw = [e for e in query_events if e.get("querySubmechanism") == "NO_RAW_RECALL_REGION"]
    recall_ctrl = [e for e in events if e["mechanism"] == "RECALL_TARGET_MISS"][:20]
    # successful-query controls: events that are NOT query-fail — use KENLM or SURVIVED or recall
    success_ctrl = [
        e
        for e in events
        if e["mechanism"]
        in ("RECALL_TARGET_MISS", "KENLM_TARGET_NOT_SELECTED", "TARGET_SURVIVED_NO_FINAL_IMPROVEMENT")
    ][:25]

    first_loss_rows = []
    loss_counter = Counter()
    drop_counter = Counter()
    cov_counter = Counter()
    reseg_counter = Counter()
    anchor_cross = 0
    keep_cross_unrelated = 0  # informational: KEEP interrupting vs target in KEEP

    def analyze_cohort(cohort: list[dict], cohort_name: str) -> list[dict]:
        nonlocal anchor_cross
        rows = []
        for e in cohort:
            cid = e["caseId"]
            eid = e["repairEventId"]
            pt = primary_by_event.get(eid) or {}
            region_id = e.get("regionId") or pt.get("regionId") or ""
            locus = asr_locus.get((cid, region_id), (-1, -1, "", ""))
            asr_t0, asr_t1, asr_surf, ref_surf = locus
            rec = records.get(cid) or {}
            geo = collect_path_geometry(rec)
            if asr_t0 < 0 or asr_t1 <= asr_t0:
                fl = {
                    "FIRST_GEOMETRY_LOSS_STAGE": "UNRESOLVED",
                    "dropReason": "UNRESOLVED_ASR_LOCUS",
                    "targetCoverageRelation": "NO_QUERY",
                    "targetRepresentableAtModel3Span": False,
                    "targetRepresentableAfterMerge": False,
                    "targetRepresentableAfterBarrierClip": False,
                    "targetRepresentableInRegionalInput": False,
                    "targetRepresentableInEnumeratedQueryWindow": False,
                    "targetRepresentableInFinalQueryKey": False,
                    "RecallInvokedForRepairCapableKey": False,
                    "retrySpanCount": 0,
                    "regionCount": len(geo["regions"]),
                    "queryCount": len(geo["queries"]),
                }
            else:
                fl = first_loss_for_event(asr_t0=asr_t0, asr_t1=asr_t1, geo=geo)

            # Anchor crossing check: region overlaps anchor span interior improperly
            for r in geo["regions"]:
                rs, re_ = r.get("rawStart"), r.get("rawEnd")
                if not isinstance(rs, (int, float)):
                    continue
                for a in geo["anchor_spans"]:
                    a0, a1 = a.get("rawStart"), a.get("rawEnd")
                    if isinstance(a0, (int, float)) and overlaps(int(rs), int(re_), int(a0), int(a1)):
                        # region overlapping anchor — SSOT forbids including anchor as RETRY source;
                        # overlapping neighbor is OK; count only if region strictly contains anchor span
                        if int(rs) <= int(a0) and int(re_) >= int(a1) and int(a1) > int(a0):
                            # sourceSpanIds should not include anchors by construction
                            pass

            row = {
                "cohort": cohort_name,
                "caseId": cid,
                "repairEventId": eid,
                "regionId": region_id,
                "querySubmechanism": e.get("querySubmechanism") or "",
                "mechanism": e.get("mechanism") or "",
                "minimalTargetSurface": pt.get("lexicalTarget") or e.get("primaryTargets") or "",
                "asrLocusStart": asr_t0,
                "asrLocusEnd": asr_t1,
                "asrSurface": asr_surf,
                "refSurface": ref_surf,
                "resegmentAnyOk": geo["resegmentAnyOk"],
                "resegmentAllFail": geo["resegmentAllFail"],
                "secondDomainVote": geo["secondDomainVote"],
                "model3Reinvoked": geo["model3Reinvoked"],
                "hasRegions": geo["hasRegions"],
                "hasQueries": geo["hasQueries"],
                **fl,
            }
            rows.append(row)
            if cohort_name in ("PARTIAL_COVERAGE_159", "NO_RAW_RECALL_7"):
                loss_counter[fl["FIRST_GEOMETRY_LOSS_STAGE"]] += 1
                drop_counter[fl.get("dropReason", "")] += 1
                cov_counter[fl.get("targetCoverageRelation", "")] += 1
                reseg_counter[
                    "ALL_FAIL" if geo["resegmentAllFail"] else ("ANY_OK" if geo["resegmentAnyOk"] else "NO_REGION")
                ] += 1
        return rows

    first_loss_rows.extend(analyze_cohort(partial, "PARTIAL_COVERAGE_159"))
    first_loss_rows.extend(analyze_cohort(no_raw, "NO_RAW_RECALL_7"))
    control_rows = []
    control_rows.extend(analyze_cohort(success_ctrl, "SUCCESSFUL_OR_RECALL_CONTROL"))
    control_rows.extend(analyze_cohort(recall_ctrl, "RECALL_MISS_CONTROL"))

    # Gap / KEEP-on-locus refinement for partial cohort
    def min_region_gap(cid: str, t0: int, t1: int) -> int | None:
        rec = records.get(cid) or {}
        best = None
        for p in rec.get("paths") or []:
            for r in p.get("retry_regions") or []:
                a, b = r.get("rawStart"), r.get("rawEnd")
                if not isinstance(a, (int, float)):
                    continue
                a, b = int(a), int(b)
                if b <= t0:
                    g = t0 - b
                elif a >= t1:
                    g = a - t1
                else:
                    g = 0
                best = g if best is None else min(best, g)
        return best

    def locus_decision_class(cid: str, t0: int, t1: int) -> str:
        rec = records.get(cid) or {}
        hits = []
        for p in rec.get("paths") or []:
            for d in p.get("decisions") or []:
                a, b = d.get("rawStart"), d.get("rawEnd")
                if isinstance(a, (int, float)) and isinstance(b, (int, float)) and overlaps(int(a), int(b), t0, t1):
                    hits.append("RETRY" if d.get("decision") == "RETRY" and not d.get("isAnchor") else ("ANCHOR" if d.get("isAnchor") else d.get("decision")))
        if not hits:
            return "NO_SPAN_ON_LOCUS"
        if "RETRY" in hits:
            return "RETRY_ON_LOCUS"
        if "ANCHOR" in hits and "KEEP" not in hits:
            return "ANCHOR_ON_LOCUS"
        return "KEEP_ON_LOCUS"

    locus_class_counter = Counter()
    gap_bucket = Counter()
    for row in first_loss_rows:
        if row["cohort"] not in ("PARTIAL_COVERAGE_159", "NO_RAW_RECALL_7"):
            continue
        t0, t1 = int(row["asrLocusStart"]), int(row["asrLocusEnd"])
        lc = locus_decision_class(row["caseId"], t0, t1) if t0 >= 0 else "UNRESOLVED"
        row["locusDecisionClass"] = lc
        locus_class_counter[lc] += 1
        g = min_region_gap(row["caseId"], t0, t1)
        row["nearestRegionGap"] = g if g is not None else ""
        if g is None:
            gap_bucket["NO_REGION"] += 1
        elif g == 0:
            gap_bucket["TOUCHING_OR_OVERLAP"] += 1
        elif g == 1:
            gap_bucket["GAP_1"] += 1
        elif g <= 5:
            gap_bucket["GAP_2_TO_5"] += 1
        else:
            gap_bucket["GAP_GT_5"] += 1

    # Refine dominant narrative (answers/options filled later)
    n_partial = len(partial)
    keep_on = locus_class_counter.get("KEEP_ON_LOCUS", 0)
    dominant_stage = loss_counter.most_common(1)[0][0] if loss_counter else "UNRESOLVED"

    # Architecture drift checklist (static from code audit)
    drift = [
        {"item": "same_boundary_Retry", "status": "PRESENT_ACTIVE_WHEN_FALLBACK", "notes": "fallbackRegionLocalSpans copies first-pass FineSpan bounds"},
        {"item": "hard_FineSpan_boundary", "status": "PRESENT_ACTIVE_WHEN_FALLBACK", "notes": "Stage-2 queries = localSpan bounds only; no sliding on Stage-2"},
        {"item": "hard_coarse_span_boundary", "status": "ABSENT", "notes": "coarse remapped soft into regional lattice"},
        {"item": "single_preferred_regional_path", "status": "ABSENT", "notes": "collectLocalSpansFromRetainedPathViews unions all views"},
        {"item": "utterance_singleton_Domain_Vote", "status": "ABSENT", "notes": "path-local vote retained"},
        {"item": "second_Domain_Vote_during_Retry", "status": "ABSENT", "notes": "trace secondDomainVote=false"},
        {"item": "second_Model3_invocation", "status": "ABSENT", "notes": "routeModel3Retry does not re-infer"},
        {"item": "recursive_Retry", "status": "ABSENT", "notes": "attemptedSpanIds guards; one pass"},
        {"item": "ASR_rerun", "status": "ABSENT", "notes": ""},
        {"item": "parallel_repair_chain", "status": "ABSENT", "notes": ""},
        {"item": "Retry_specific_alternate_Recall_engine", "status": "ABSENT", "notes": "reuses recallSpanTopKV2"},
        {"item": "Stage2_no_sliding_windows", "status": "PRESENT_ACTIVE", "notes": "ARCHITECTURE_DRIFT vs lattice Stage-1 1..5 sliding; Stage-2 one query per localSpan"},
        {"item": "deriveRetryRegions_RETRY_only_union", "status": "PRESENT_ACTIVE", "notes": "SSOT-compliant barrier; causes REGION_DISJOINT when Model3 misses locus"},
    ]

    # Call graph rows
    call_graph = [
        {
            "node": "Model3 decision output",
            "file": "model3-inference-client.ts / run-model3-path-step.ts",
            "function": "inferPath → Model3SpanDecision KEEP|RETRY",
            "input": "PathFineSpan + Anchor context",
            "output": "KEEP|RETRY per span",
            "owner": "Model3",
            "ssotCompliant": "YES",
            "altersGeometry": "YES_indirect",
        },
        {
            "node": "Retry consumer entry",
            "file": "model3-retry-router.ts",
            "function": "routeModel3Retry",
            "input": "decisions, anchors, pathFineSpans, candidates",
            "output": "mutated candidates + traces",
            "owner": "RetryRouter",
            "ssotCompliant": "YES",
            "altersGeometry": "YES",
        },
        {
            "node": "RETRY span collection + merge",
            "file": "model3-retry-region.ts",
            "function": "deriveRetryRegions / buildRegionFromSpans",
            "input": "RETRY PathFineSpans",
            "output": "Model3RetryRegion[]",
            "owner": "RetryRegion",
            "ssotCompliant": "YES_barriers; PARTIAL_vs_frozen_widen_clause",
            "altersGeometry": "YES",
        },
        {
            "node": "Barrier enforcement",
            "file": "model3-retry-region.ts + run-model3-path-step.ts",
            "function": "isRetryEligible / maskAnchorDecisions",
            "input": "Anchor + KEEP decisions",
            "output": "RETRY eligibility mask",
            "owner": "RetryRegion+Model3PathStep",
            "ssotCompliant": "YES",
            "altersGeometry": "YES",
        },
        {
            "node": "Regional lattice / FineSpan",
            "file": "model3-retry-region-resegment.ts + lattice-fine-span-runtime.ts",
            "function": "resegmentRetryRegionWithLattice / runLatticeFineSpanGeneration",
            "input": "region slice + acoustic/wordTime",
            "output": "pathFineSpanViews",
            "owner": "RegionalResegment",
            "ssotCompliant": "YES_when_ok",
            "altersGeometry": "YES",
        },
        {
            "node": "Regional path retention",
            "file": "model3-retry-region-resegment.ts",
            "function": "collectLocalSpansFromRetainedPathViews + dedupRetryRegionLocalSpans",
            "input": "all pathFineSpanViews",
            "output": "RetryRegionLocalSpan[]",
            "owner": "RegionalResegment",
            "ssotCompliant": "YES_multipath",
            "altersGeometry": "YES",
        },
        {
            "node": "Fallback local spans",
            "file": "model3-retry-region-resegment.ts",
            "function": "fallbackRegionLocalSpans",
            "input": "region.sourceSpanIds",
            "output": "first-pass FineSpan bounds",
            "owner": "RegionalResegment",
            "ssotCompliant": "NO_DRIFT_vs_sliding_window_SSOT",
            "altersGeometry": "YES",
        },
        {
            "node": "Query window enumeration (Stage-2)",
            "file": "model3-retry-router.ts",
            "function": "for local of localSpans → one query",
            "input": "RetryRegionLocalSpan",
            "output": "windowText / pinyin / syllables",
            "owner": "RetryRouter",
            "ssotCompliant": "NO_DRIFT_missing_sliding_reuse",
            "altersGeometry": "YES",
        },
        {
            "node": "Query key construction",
            "file": "model3-retry-router.ts",
            "function": "rawText.slice + syllables.join('|')",
            "input": "local offsets",
            "output": "windowText, windowPinyinKey",
            "owner": "RetryRouter",
            "ssotCompliant": "YES_formula",
            "altersGeometry": "YES",
        },
        {
            "node": "Recall API",
            "file": "recall-span-topk-v2.ts via run-model3-path-step recall closure",
            "function": "recallSpanTopKV2",
            "input": "query key + domains + tone",
            "output": "RAW_RECALL hits",
            "owner": "Recall",
            "ssotCompliant": "YES",
            "altersGeometry": "NO",
        },
    ]

    # Design options (max 3)
    options = [
        {
            "optionId": "OPT1_RESTORE_STAGE2_SLIDING_WITHIN_REGION",
            "title": "Reuse buildLexicalWindowQueries inside Retry region for Stage-2 RAW_RECALL",
            "faultyCondition": "Stage-2 emits one query per localSpan only; multi-char lexical units spanning adjacent FineSpans / alternate segmentations are not enumerated even when inside region bounds",
            "ssotConflict": "YES — frozen Retry must reuse FineSpan/phonetic sliding windows; Stage-1 already has buildLexicalWindowQueries(1..5); Stage-2 dropped it",
            "minimalChange": "In routeModel3Retry (or resegment result consumer), enumerate syllable windows 1..MAX inside region using existing buildLexicalWindowQueries / buildWindowDescriptorForRange; dedup by utterance cache; still one Retry operation",
            "files": "model3-retry-router.ts; optionally thin wrapper in model3-retry-region-resegment.ts; reuse build-lexical-window-queries.ts",
            "logicRemoved": "Implicit assumption that localSpan set == complete query set",
            "logicAdded": "Bounded sliding window enumeration WITHIN existing Model3RetryRegion only",
            "traceImpact": "record each enumerated queryId; dropReason SPAN_NOT_ENUMERATED when skipped by length/barrier",
            "queryCountImpact": "O(regionSyllables * maxLen) per region; typically small (region << utterance); cache absorbs dupes",
            "candidateCountImpact": "bounded by existing perSpanCap + utterance pool <=16",
            "latencyRisk": "LOW_MODERATE — local regions only; utterance recall cache",
            "regressionRisk": "LOW if limited to region interior; successful controls already covered by localSpans remain subset",
            "architectureChange": "NO — restores frozen sliding-window reuse",
            "simplicityBranches": 1,
            "newConfig": 0,
            "newDTO": 0,
            "newJobResultFields": 0,
            "preferred": "CANDIDATE",
        },
        {
            "optionId": "OPT2_DELETE_FALLBACK_BOUNDARY_LOCK",
            "title": "On lattice failure, delete fallbackRegionLocalSpans lock; synthesize sliding windows from region syllable slice",
            "faultyCondition": "fallbackRegionLocalSpans copies first-pass FineSpan boundaries (OLD_BOUNDARY_LOCK)",
            "ssotConflict": "YES — FineSpan soft boundaries; Retry must not lock to original incorrect boundary",
            "minimalChange": "Replace fallback path with region-slice window enumeration (same helper as OPT1) without requiring successful lattice paths",
            "files": "model3-retry-region-resegment.ts fallbackRegionLocalSpans call sites",
            "logicRemoved": "fallbackRegionLocalSpans as Stage-2 query source",
            "logicAdded": "same window enum as OPT1 on EMPTY/NO_PATH",
            "traceImpact": "localSpanSource=SLICE_WINDOWS",
            "queryCountImpact": "similar to OPT1 when lattice fails",
            "candidateCountImpact": "bounded",
            "latencyRisk": "LOW",
            "regressionRisk": "LOW_MODERATE",
            "architectureChange": "NO — SSOT restoration",
            "simplicityBranches": 1,
            "newConfig": 0,
            "newDTO": 0,
            "newJobResultFields": 0,
            "preferred": "CANDIDATE_COMPLEMENT",
        },
        {
            "optionId": "OPT3_WIDEN_REGION_INTO_KEEP",
            "title": "Expand deriveRetryRegions into adjacent KEEP to cover soft lexical neighborhood",
            "faultyCondition": "deriveRetryRegions RETRY-only union → REGION_DISJOINT / TOO_NARROW when Model3 RETRY misses part of lexical unit",
            "ssotConflict": "CONFLICT — frozen SSOT says do not cross unrelated KEEP by default; widening into KEEP needs structural proof not gold-aware expansion",
            "minimalChange": "Would alter barrier policy",
            "files": "model3-retry-region.ts",
            "logicRemoved": "strict KEEP flush barrier",
            "logicAdded": "limited soft expansion — HIGH RISK of Anchor/KEEP violation",
            "traceImpact": "barrier clip reasons",
            "queryCountImpact": "higher",
            "candidateCountImpact": "higher",
            "latencyRisk": "MODERATE",
            "regressionRisk": "HIGH",
            "architectureChange": "MAYBE — if KEEP barrier redefined",
            "simplicityBranches": 2,
            "newConfig": 0,
            "newDTO": 0,
            "newJobResultFields": 0,
            "preferred": "REJECT_DEFAULT",
        },
    ]

    # Preferred design: KEEP_ON_LOCUS dominates → owner not isolated between Model3 trigger and Retry geometry
    if keep_on >= int(0.7 * max(n_partial, 1)):
        preferred_id = "NO_DESIGN_SELECTION_YET"
        preferred_note = (
            f"KEEP_ON_LOCUS dominates ({keep_on}/{n_partial}). OPT1/OPT2 only enumerate windows "
            "inside existing RETRY regions and cannot reach KEEP-marked loci. OPT3 (widen into KEEP) "
            "violates frozen 'no unrelated KEEP crossing by default'. Model3 change is out of this "
            "phase's Query Geometry ownership. Next: causal localization completion separating "
            "MODEL3_TRIGGER_KEEP_ON_LOCUS vs in-region Stage-2 SSOT drift (OPT1+OPT2 secondary)."
        )
        for o in options:
            if o["optionId"] in ("OPT1_RESTORE_STAGE2_SLIDING_WITHIN_REGION", "OPT2_DELETE_FALLBACK_BOUNDARY_LOCK"):
                o["preferred"] = "SECONDARY_SSOT_RESTORATION_NOT_SUFFICIENT_FOR_159"
            else:
                o["preferred"] = "REJECT_KEEP_CROSSING"
        verdict = "MODEL3_S3_RETRY_QUERY_GEOMETRY_OWNER_NOT_ISOLATED"
        next_phase = "MODEL3_V2_S3_RETRY_QUERY_GEOMETRY_CAUSAL_LOCALIZATION_COMPLETION"
        implementation_ready = False
        acp = False
    else:
        preferred_id = "OPT1_PLUS_OPT2"
        preferred_note = "Restore Stage-2 sliding within region + remove fallback boundary lock"
        options[0]["preferred"] = "YES_PART_OF_PREFERRED"
        options[1]["preferred"] = "YES_PART_OF_PREFERRED"
        options[2]["preferred"] = "REJECT"
        verdict = "MODEL3_S3_RETRY_QUERY_GEOMETRY_SSOT_DRIFT_FOUND"
        next_phase = "MODEL3_V2_S3_RETRY_QUERY_GEOMETRY_SSOT_RESTORATION_DESIGN"
        implementation_ready = False
        acp = False

    ssot_drift_found = True

    # Controls safety for OPT1
    ctrl_summary = []
    for row in control_rows:
        ctrl_summary.append(
            {
                "cohort": row["cohort"],
                "caseId": row["caseId"],
                "repairEventId": row["repairEventId"],
                "mechanism": row["mechanism"],
                "firstLoss": row["FIRST_GEOMETRY_LOSS_STAGE"],
                "queryAdequate": row["FIRST_GEOMETRY_LOSS_STAGE"] == "NONE_QUERY_ADEQUATE"
                or row.get("targetRepresentableInFinalQueryKey"),
                "opt1WouldChangeKeysIfAppliedBlindly": "UNKNOWN_NEEDS_TRACE",
            }
        )

    # Trace contract
    trace_contract = [
        {"field": "utteranceTraceId", "required": True, "presentInFrozen": "partial_caseId"},
        {"field": "pathId", "required": True, "presentInFrozen": "YES"},
        {"field": "model3DecisionId", "required": True, "presentInFrozen": "NO_use_spanId"},
        {"field": "retryOperationId", "required": True, "presentInFrozen": "NO"},
        {"field": "retryRegionId", "required": True, "presentInFrozen": "YES"},
        {"field": "regionalPathId", "required": True, "presentInFrozen": "NO"},
        {"field": "queryId", "required": True, "presentInFrozen": "NO_implicit"},
        {"field": "rawRecallInvocationId", "required": True, "presentInFrozen": "partial"},
        {"field": "model3RetrySpanIds", "required": True, "presentInFrozen": "YES_via_decisions"},
        {"field": "mergedRetryRegion", "required": True, "presentInFrozen": "YES"},
        {"field": "anchorBarrierLeft/Right", "required": True, "presentInFrozen": "NO"},
        {"field": "keepBarrierLeft/Right", "required": True, "presentInFrozen": "NO"},
        {"field": "regionalFineSpans", "required": True, "presentInFrozen": "NO"},
        {"field": "enumeratedQueryWindows", "required": True, "presentInFrozen": "partial_rawRecalls"},
        {"field": "dropReason", "required": True, "presentInFrozen": "NO"},
    ]
    missing_trace = [t for t in trace_contract if t["presentInFrozen"].startswith("NO")]

    answers = {
        "D1": "deriveRetryRegions (model3-retry-region.ts)",
        "D2": "isRetryEligible + KEEP flush in deriveRetryRegions; maskAnchorDecisions in run-model3-path-step.ts",
        "D3": "resegmentRetryRegionWithLattice → runLatticeFineSpanGeneration",
        "D4": "collectLocalSpansFromRetainedPathViews (all views; preferred-path removed)",
        "D5": "routeModel3Retry loop over localSpans — NOT buildLexicalWindowQueries (Stage-2 gap)",
        "D6": "routeModel3Retry: windowText=rawText.slice; windowPinyinKey=syllables.join('|')",
        "D7": "PARTIAL — query key formula duplicated vs window-construction-core; barrier ownership split path-step+region",
        "D8": "see call_graph artifact",
        "D9": (
            f"FIRST_GEOMETRY_LOSS_STAGE={dominant_stage} for query fails; "
            f"locusDecisionClass={dict(locus_class_counter)}; gapBuckets={dict(gap_bucket)}"
        ),
        "D10": dict(loss_counter),
        "D11": (
            f"Exact condition: PathFineSpans overlapping ASR repair locus are KEEP "
            f"({keep_on}/{n_partial + len(no_raw)} query fails). isRetryEligible requires decision==='RETRY'; "
            f"KEEP flush in deriveRetryRegions excludes locus; Stage-2 never queries it. "
            f"Not merely 'region too short'."
        ),
        "D12": (
            "RETRY-only region union IS required by barrier SSOT; "
            "but Stage-2 omitting sliding windows is NOT required by SSOT"
        ),
        "D13": "Stage-2 missing sliding windows = obsolete/accidental vs FineSpan soft-boundary SSOT; Model3 miss is model/trigger issue not obsolete barrier",
        "D14": "YES when fallbackRegionLocalSpans used; NO when lattice succeeds (resegmentOk)",
        "D15": "NO evidence of hard coarse lock in Retry path",
        "D16": "YES inside regional lattice Stage-1; NO at Stage-2 RAW_RECALL enumeration",
        "D17": "YES — collectLocalSpansFromRetainedPathViews unions all retained views",
        "D18": "Only if some retained localSpan (or Stage-1 window during lattice) equals that unit; Stage-2 does not re-enumerate cross-span windows",
        "D19": "Stage-2 query set == localSpans after resegment/fallback; no cross-FineSpan sliding at RAW_RECALL",
        "D20": "No overlapping Retry region and/or no rawRecalls for the ASR locus (often zero RETRY spans on locus)",
        "D21": "Structurally related to Model3/region miss subclass; not identical to PARTIAL when regions exist elsewhere",
        "D22": "NO (deriveRetryRegions skips anchors; maskAnchorDecisions)",
        "D23": "NO by construction (KEEP breaks merge); unrelated KEEP not entered",
        "D24": "NO",
        "D25": "NO",
        "D26": "NO",
        "D27": "NO",
        "D28": "NO (preferredPathFineSpanView removed)",
        "D29": "YES for lattice success path",
        "D30": "YES — key construction duplicated; Stage-1 vs Stage-2 window enum diverged",
        "D31": "YES for fallback boundary lock; YES for Stage-2 missing sliding (delete localSpan-only assumption)",
        "D32": "YES — buildLexicalWindowQueries / buildWindowDescriptorForRange",
        "D33": "YES",
        "D34": "YES (trace side-channel only)",
        "D35": "YES",
        "D36": "YES",
        "D37": "YES for geometry correction inside region; Model3 trigger quality out of scope",
        "D38": "YES",
        "D39": "YES",
        "D40": "Per region: ~sum_{L=1..5}(sylLen-L+1) windows; only within region syl length",
        "D41": "Same order as D40 before utterance cache dedup",
        "D42": "YES for identical keys; Stage-2 currently sets enableUtteranceRecallCache=false on regional lattice — Stage-2 recall closure uses runtime cache if configured",
        "D43": "LOW_MODERATE for OPT1/2; HIGH for OPT3",
        "D44": "LOW if perSpanCap + pool<=16 preserved",
        "D45": "Controls with NONE_QUERY_ADEQUATE should remain supersets; OPT1 adds windows but should not remove existing keys",
        "D46": "Should not — existing localSpan queries remain; additive enum",
        "D47": (
            "NO Query-Geometry-only fix for KEEP_ON_LOCUS majority; "
            "secondary SSOT restore OPT1+OPT2 for in-region cases only"
        ),
        "D48": "fallbackRegionLocalSpans as Stage-2 authority (secondary); cannot delete KEEP barrier",
        "D49": "Bounded buildLexicalWindowQueries on region slice (secondary only)",
        "D50": "lattice window builders; recallSpanTopKV2; multipath collect",
        "D51": "OPT1/OPT2 restore SSOT but do not solve KEEP_ON_LOCUS majority",
        "D52": "NO",
        "D53": "NO",
        "D54": verdict,
        "D55": next_phase,
        "locusDecisionClass": dict(locus_class_counter),
        "nearestRegionGapBuckets": dict(gap_bucket),
        "rootCauseExact": (
            "isRetryEligible requires decision==='RETRY'; locus spans have decision==='KEEP'; "
            "flush() breaks pending before KEEP → region excludes locus"
        ),
        "measuredShareCaveat": "166/237 is among lexically-evaluable repair events only — NOT overall system prevalence",
        "lexiconPrevalence": "UNRESOLVED — do not treat as zero",
    }

    summary = {
        "phase": PHASE,
        "generatedAt": GENERATED,
        "verdict": verdict,
        "nextPhase": next_phase,
        "preferredDesign": preferred_id,
        "preferredNote": preferred_note,
        "implementationReady": implementation_ready,
        "acp": False,
        "locusDecisionClass": dict(locus_class_counter),
        "nearestRegionGapBuckets": dict(gap_bucket),
        "rootCauseExact": answers["rootCauseExact"],
        "measured": {
            "eligibleRepairEvents": 237,
            "queryNotRepairCapable": 166,
            "shareAmongLexicalEvents": 0.7004,
            "partialCoverage": 159,
            "noRawRecallRegion": 7,
            "shareCaveat": "NOT overall system causal prevalence",
        },
        "firstLossAggregate": dict(loss_counter),
        "dropReasonAggregate": dict(drop_counter),
        "coverageRelationAggregate": dict(cov_counter),
        "resegmentAggregate": dict(reseg_counter),
        "ssotDriftFound": ssot_drift_found,
        "missingTraceFields": [t["field"] for t in missing_trace],
        "architectureDrift": drift,
        "answers": answers,
        "options": options,
    }

    write_csv(DOCS / "model3_v2_s3_retry_query_call_graph.csv", call_graph)
    write_csv(DOCS / "model3_v2_s3_retry_query_first_loss.csv", first_loss_rows)
    write_csv(DOCS / "model3_v2_s3_retry_query_controls.csv", control_rows)
    write_csv(DOCS / "model3_v2_s3_retry_query_design_options.csv", options)
    write_csv(DOCS / "model3_v2_s3_retry_query_trace_contract.csv", trace_contract)

    freeze = [
        {"key": "phase", "value": PHASE, "status": "AUTHORITATIVE"},
        {"key": "TRACE_RUNTIME_PROVENANCE", "value": "COMPLETE_200_OF_200", "status": "FROZEN"},
        {"key": "TARGET_MINIMALITY_MODEL", "value": "ACCEPTED", "status": "FROZEN"},
        {"key": "REPAIR_EVENT_MODEL", "value": "ACCEPTED", "status": "FROZEN"},
        {"key": "RETRY_QUERY_GEOMETRY_EXISTENCE", "value": "PROVEN_GENERAL", "status": "FROZEN"},
        {"key": "RETRY_QUERY_GEOMETRY_MEASURED_SHARE", "value": "166/237_lexical_events_only", "status": "FROZEN"},
        {"key": "RETRY_REGION_PARTIAL_COVERAGE", "value": "DOMINANT_OBSERVED_QUERY_SUBMECHANISM", "status": "FROZEN"},
        {"key": "FIRST_LOSS_DOMINANT", "value": dominant_stage, "status": "RECORDED"},
        {"key": "STAGE2_SLIDING_WINDOW", "value": "ABSENT_SSOT_DRIFT", "status": "RECORDED"},
        {"key": "FALLBACK_OLD_BOUNDARY_LOCK", "value": "PRESENT_ACTIVE_WHEN_LATTICE_FAILS", "status": "RECORDED"},
        {"key": "KEEP_ON_LOCUS_PARTIAL", "value": str(keep_on), "status": "RECORDED"},
        {"key": "PREFERRED_DESIGN", "value": preferred_id, "status": "RECORDED"},
        {"key": "LEXICON_COVERAGE_PREVALENCE", "value": "UNRESOLVED", "status": "FROZEN"},
        {"key": "FIRST_CAUSAL_OWNER", "value": "NOT_YET_ISOLATED", "status": "FROZEN"},
        {"key": "A1_PROMOTION_READY", "value": "FALSE", "status": "FROZEN"},
        {"key": "ACP", "value": "FALSE", "status": "FROZEN"},
        {"key": "verdict", "value": verdict, "status": "RECORDED"},
        {"key": "NEXT_PHASE", "value": next_phase, "status": "RECORDED"},
    ]
    write_csv(DOCS / "model3_v2_s3_retry_query_freeze_state.csv", freeze)
    write_csv(DOCS / "model3_v2_s3_retry_query_first_loss.csv", first_loss_rows)
    write_csv(DOCS / "model3_v2_s3_retry_query_design_options.csv", options)
    (DOCS / "model3_v2_s3_retry_query_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # Markdown report
    report = f"""# Lingua Model3 V2 S3 — Retry Query Geometry Correction Design Audit

Generated: {GENERATED}  
Phase: `{PHASE}`

================================
EXECUTIVE VERDICT
=================

**{verdict}**

Next phase: `{next_phase}`

Preferred design: **{preferred_id}**

{preferred_note}

Measured Query share **166/237 = 70.04%** applies only among **lexically-evaluable repair events** — **not** overall system error prevalence. Lexicon prevalence remains **UNRESOLVED**.

================================
SSOT AUTHORITY MAP
==================

| Domain | Authority |
|--------|-----------|
| FineSpan | Frozen soft overlapping windows; NOT hard lexical boundary |
| Domain Vote | ONE per retained path; Retry MUST NOT re-vote |
| Model3 | KEEP/RETRY only; one decision stage |
| Retry | ONE bounded operation; barriers; reuse FineSpan/Recall |
| Recall | Existing recallSpanTopKV2; no threshold tuning this phase |
| Candidate pool | ≤16 |
| JobResult | Transport only — no audit fields |

Stale docs that treat FineSpan as hard Retry boundary or Stage-2 as same-boundary Recall: **SUPERSEDED**.

================================
FROZEN ARCHITECTURE CHECK
=========================

Mainline singular. No second Domain Vote / Model3 / recursive Retry / ASR rerun observed in frozen traces (`secondDomainVote=false`, `model3Reinvoked=false`).

**SSOT drift found:** Stage-2 RAW_RECALL does **not** reuse `buildLexicalWindowQueries` sliding windows; fallback may lock to first-pass FineSpan bounds.

================================
CURRENT RETRY CALL GRAPH
========================

See `model3_v2_s3_retry_query_call_graph.csv`.

```
Model3 KEEP|RETRY
 → maskAnchorDecisions
 → routeModel3Retry
    → deriveRetryRegions (RETRY-only adjacent merge; KEEP/Anchor break)
    → resegmentRetryRegionWithLattice
         → runLatticeFineSpanGeneration (Stage-1 windows 1..5)
         → collectLocalSpansFromRetainedPathViews (multipath union)
         OR fallbackRegionLocalSpans (OLD_BOUNDARY_LOCK)
    → for each localSpan: windowText/pinyin → recallSpanTopKV2  (Stage-2)
 → RAW_RECALL_OUTPUT
```

================================
RESPONSIBILITY / OWNERSHIP MAP
==============================

| Responsibility | Owner function | Duplicated? |
|----------------|----------------|-------------|
| RETRY decision | Model3 inferPath | NO |
| Retry region | deriveRetryRegions | NO |
| Barrier | isRetryEligible + maskAnchorDecisions | SPLIT (path-step + region) |
| Local re-segmentation | resegmentRetryRegionWithLattice | NO |
| Regional path enum | collectLocalSpansFromRetainedPathViews | NO |
| Query surface/pinyin/tone | routeModel3Retry Stage-2 loop | YES vs window-construction-core formula |
| Recall lookup | recallSpanTopKV2 | NO |

**DUPLICATED_OWNERSHIP:** barrier split; query-key formula copy; Stage-1 vs Stage-2 window enumeration divergence.

================================
TRACE CONTRACT
==============

Frozen provenance has regions + rawRecalls + decisions, but **missing** barrier edge fields, regional FineSpan dumps, queryId, dropReason, retryOperationId.

See `model3_v2_s3_retry_query_trace_contract.csv`.

Runtime instrumentation for this design audit: **not newly added** — consumed existing frozen candidate provenance. TRACE_ON/OFF parity for new fields: **deferred to TRACE_COMPLETION**.

================================
159 PARTIAL-COVERAGE FIRST-LOSS ANALYSIS
========================================

Aggregate FIRST_GEOMETRY_LOSS_STAGE: `{dict(loss_counter)}`

Drop reasons: `{dict(drop_counter)}`

Coverage relations: `{dict(cov_counter)}`

Resegment: `{dict(reseg_counter)}`

**Dominant code condition (not merely "region too short"):**
{answers['D11']}

locusDecisionClass: `{dict(locus_class_counter)}`  
nearestRegionGap: `{dict(gap_bucket)}`

Exact condition in code:
- `isRetryEligible` requires `decision === 'RETRY'` and non-Anchor
- KEEP/Anchor flush breaks merge groups (`model3-retry-region.ts`)
- ASR locus spans are **KEEP** → region cannot include them → Stage-2 never queries the locus
- Audit label `RETRY_REGION_PARTIAL_COVERAGE` = regions exist elsewhere but **none overlap** the ASR locus

================================
7 NO-RAW-RECALL-REGION ANALYSIS
===============================

Typically: no repair-capable query recorded for the locus — often zero RETRY on locus and/or empty rawRecalls. Structurally related to region miss; not a separate Recall-threshold problem.

================================
SUCCESSFUL QUERY CONTROLS
=========================

See `model3_v2_s3_retry_query_controls.csv` (Recall-miss / KenLM / survived cohorts).  
OPT1 must remain **additive** inside existing regions so currently adequate keys are preserved.

================================
ARCHITECTURE DRIFT AUDIT
========================

| Item | Status |
|------|--------|
| same-boundary Retry (fallback) | PRESENT_ACTIVE |
| Stage-2 no sliding windows | PRESENT_ACTIVE (**SSOT drift**) |
| single preferred regional path | ABSENT |
| second Domain Vote | ABSENT |
| second Model3 | ABSENT |
| recursive Retry | ABSENT |
| ASR rerun | ABSENT |

================================
ROOT CAUSE
==========

Two coupled mechanisms:

1. **KEEP_ON_LOCUS / Model3 trigger + region exclusion (DOMINANT for 159):**  
   PathFineSpans on the ASR repair locus are decided **KEEP**. `deriveRetryRegions` correctly refuses to include them (SSOT barrier). No Stage-2 query can cover the locus. Owner is **split**: Model3 decision vs Retry region contract — **not isolated** to a Stage-2 query bug.

2. **Stage-2 query enumeration SSOT drift (SECONDARY):**  
   Even when a region exists, Stage-2 does not reuse `buildLexicalWindowQueries`; fallback may lock to first-pass FineSpan bounds. Real drift, but **insufficient** to explain the KEEP_ON_LOCUS majority.

Mechanism (1) is **not** fixed by Recall tuning, blind ±N, or in-region sliding alone. Mechanism (2) is SSOT restoration without ACP but secondary for this cohort.

================================
CORRECTION OPTIONS
==================

See `model3_v2_s3_retry_query_design_options.csv` (OPT1, OPT2, OPT3).

================================
PREFERRED MINIMAL DESIGN
========================

**{preferred_id}**

{preferred_note}

================================
SIMPLICITY / PERFORMANCE IMPACT
===============================

Preferred path targets: new config=0, new JobResult fields=0, new mainline=0, new fallback=0.  
Query delta bounded by region syllable length × max window 5; utterance cache absorbs duplicates. Candidate pool ≤16 unchanged.

================================
TARGET LIST
===========

Future development only (do not implement now):

1. `model3-retry-router.ts` — Stage-2 query enumeration owner
2. `model3-retry-region-resegment.ts` — fallback lock removal / slice windows
3. `build-lexical-window-queries.ts` / `window-construction-core.ts` — reuse
4. `model3-candidate-provenance-trace.ts` — RetryEventTrace stage fields (side-channel)
5. Controlled validation harness + TRACE_ON/OFF parity tests

================================
CHECK LIST
==========

- [ ] one Retry operation only
- [ ] no recursive Retry
- [ ] no ASR rerun
- [ ] no second Model3 stage
- [ ] no second Domain Vote
- [ ] no Anchor crossing
- [ ] no unrelated KEEP crossing
- [ ] multipath preserved
- [ ] existing FineSpan architecture preserved
- [ ] existing Recall API preserved
- [ ] Model2 ownership unchanged
- [ ] single-character contract unchanged
- [ ] candidate sentence cap <=16
- [ ] JobResult unchanged
- [ ] no test-specific branches
- [ ] no reference leakage
- [ ] TRACE_ON/OFF parity
- [ ] raw Recall trace preserved
- [ ] performance bounded

================================
FUTURE ACCEPTANCE DESIGN
========================

Cohorts A–G as specified (159 partial, 7 no-raw, success controls, recall-miss, Anchor-adjacent, KEEP-adjacent, multipath).

Architectural thresholds (frozen):  
`anchorCrossingCount=0`, `secondDomainVoteCount=0`, `secondModel3StageCount=0`, `recursiveRetryCount=0`, `asrRerunCount=0`, `candidatePoolMax<=16`.

Utility metrics: repairCapableQueryRate before/after; partialCoverageCount before/after; queryCountDelta; rawRecallInvocationDelta; then **downstream replay** (Assembly/KenLM/final text) — required for acceptance, not executed in this design audit.

================================
FREEZE / SUPERSEDE PROPOSAL
===========================

| Item | Action |
|------|--------|
| Measured 70.04% | FROZEN as lexical-event share only |
| Stage-2 sliding absent | RECORD as SSOT_DRIFT |
| Surface families | remain RETIRED |
| Lexicon prevalence 0 | FORBIDDEN conclusion |
| FIRST_CAUSAL_OWNER | still NOT_YET_ISOLATED |

================================
NEXT PHASE
==========

`{next_phase}`

Exactly one.

---

## D1–D55

{json.dumps(answers, ensure_ascii=False, indent=2)}
"""
    (DOCS / "Lingua_Model3_V2_S3_Retry_Query_Geometry_Design_Audit_2026_09_03.md").write_text(
        report, encoding="utf-8"
    )

    print(
        json.dumps(
            {
                "verdict": verdict,
                "nextPhase": next_phase,
                "preferred": preferred_id,
                "firstLoss": dict(loss_counter),
                "dropReasons": dict(drop_counter),
                "coverage": dict(cov_counter),
                "resegment": dict(reseg_counter),
                "partialN": n_partial,
                "noRawN": len(no_raw),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
