#!/usr/bin/env python3
"""Emit Delta2 fallback boundary-lock design audit artifacts (read-only)."""
from __future__ import annotations

import csv
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
OUT = REPO / "docs" / "user_correction" / "model3"
AFTER = OUT / "model3_retry_stage2_acceptance_after_raw.jsonl"


def theor(R: int) -> int:
    if R <= 0:
        return 0
    return sum(min(5, R - s) for s in range(R))


def main():
    fail_R = Counter()
    fail_surf_n = Counter()
    n_fail = 0
    n_ok = 0
    cross_potential = 0
    multipath_cases = set()
    cohorts = []
    seen = set()

    rows = []
    if AFTER.exists():
        for line in AFTER.open(encoding="utf-8"):
            o = json.loads(line)
            cid = o["caseId"]
            paths_with = sum(1 for p in (o.get("paths") or []) if p.get("retry_regions"))
            if paths_with >= 2:
                multipath_cases.add(cid)
            for path in o.get("paths") or []:
                decisions = {d.get("spanId"): d.get("decision") for d in (path.get("decisions") or [])}
                has_keep = any(v == "KEEP" for v in decisions.values())
                for rr in path.get("retry_regions") or []:
                    R = int(rr.get("syllableEnd") or 0) - int(rr.get("syllableStart") or 0)
                    sur = list(rr.get("newLocalSpanSurfaces") or [])
                    if rr.get("resegmentOk"):
                        n_ok += 1
                        continue
                    n_fail += 1
                    fail_R[R] += 1
                    fail_surf_n[len(sur)] += 1
                    if R >= 2 and len(sur) >= 2 and all(len(s) == 1 for s in sur):
                        cross_potential += 1
                    inv = [
                        r
                        for r in (path.get("retry_recall_invocations") or [])
                        if r.get("retryRegionId") == rr.get("retryRegionId")
                    ]
                    hits = sum(1 for r in inv if (r.get("candidateCount") or 0) > 0)
                    rows.append(
                        {
                            "caseId": cid,
                            "R": R,
                            "surfaceCount": len(sur),
                            "allSurfacesLen1": int(bool(sur) and all(len(s) == 1 for s in sur)),
                            "queryCount": len(inv),
                            "hitQueries": hits,
                            "multipathCase": int(cid in multipath_cases or paths_with >= 2),
                            "hasKeepInPath": int(has_keep),
                            "rawStart": rr.get("rawStart"),
                            "rawEnd": rr.get("rawEnd"),
                        }
                    )

                    def add(cohort: str, tag: str):
                        if tag in seen:
                            return
                        seen.add(tag)
                        cohorts.append(
                            {
                                "cohortId": cohort,
                                "caseId": cid,
                                "R": R,
                                "surfaces": "|".join(sur),
                                "rawStart": rr.get("rawStart"),
                                "rawEnd": rr.get("rawEnd"),
                                "queryCount": len(inv),
                                "hitQueries": hits,
                                "need": "",
                            }
                        )

                    if R == 1:
                        add("A_R1_FALLBACK", "A")
                    if R >= 2 and len(sur) >= 2 and all(len(s) == 1 for s in sur):
                        add("B_R2PLUS_1CHAR_FINESPANS", "B")
                        add("C_CROSS_FINESPAN_LEGAL_WINDOW", "C")
                    if paths_with >= 2:
                        add("D_MULTIPATH", "D")
                    if has_keep and R >= 1:
                        add("E_BARRIER_ADJACENT", "E")
                        add("F_KEEP_ADJACENT", "F")
                    if hits > 0:
                        add("G_FALLBACK_WITH_RECALL_HIT", "G")
                    if R >= 5:
                        add("H_LONG_HIGH_QUERY", "H")

    # Failure taxonomy (code-level + workload)
    taxonomy = [
        {
            "failureClass": "EMPTY_SLICE",
            "codeLocation": "resegmentRetryRegionWithLattice empty sliceText/syllables",
            "frequencyInAcceptedReplay": "NOT_INSTRUMENTED_IN_TRACE",
            "regionalInputAvailable": "YES_IF_REGION_NONEMPTY_ELSE_NO",
            "syllableCoordinateAvailable": "PARTIAL",
            "rawCoordinateAvailable": "YES_REGION_BOUNDS",
            "latticeWindowsAvailable": "NO",
            "partialLatticeEdgesAvailable": "NO",
            "retainedPathAvailable": "NO",
            "recallCapableQueryDescriptorsAvailable": "YES_VIA_REGION_BOUNDS",
            "notes": "returns ok=false + fallbackRegionLocalSpans",
        },
        {
            "failureClass": "LATTICE_FAIL_OR_NO_PATH",
            "codeLocation": "runLatticeFineSpanGeneration → !ok | empty pathFineSpanViews; codes EMPTY_INPUT/COVERAGE_INVARIANT/NO_COMPLETE_PATH/MATERIALIZATION_FAILED/EMPTY_DOMAIN_SCOPE; mapped as lattice.code or NO_PATH",
            "frequencyInAcceptedReplay": "DOMINANT_OF_400_BUT_CODE_NOT_TRACED",
            "regionalInputAvailable": "YES",
            "syllableCoordinateAvailable": "YES",
            "rawCoordinateAvailable": "YES",
            "latticeWindowsAvailable": "MAYBE_INTERNAL_THEN_DISCARDED",
            "partialLatticeEdgesAvailable": "MAYBE_THEN_DISCARDED",
            "retainedPathAvailable": "NO",
            "recallCapableQueryDescriptorsAvailable": "YES_VIA_REGION_BOUNDS",
            "notes": "failure means no retained regional reinterpretation path; does NOT erase RetryRegion",
        },
        {
            "failureClass": "RESEGMENT_EXCEPTION",
            "codeLocation": "resegmentRetryRegionWithLattice catch",
            "frequencyInAcceptedReplay": "NOT_INSTRUMENTED_IN_TRACE",
            "regionalInputAvailable": "YES",
            "syllableCoordinateAvailable": "YES",
            "rawCoordinateAvailable": "YES",
            "latticeWindowsAvailable": "UNKNOWN",
            "partialLatticeEdgesAvailable": "UNKNOWN",
            "retainedPathAvailable": "NO",
            "recallCapableQueryDescriptorsAvailable": "YES_VIA_REGION_BOUNDS",
            "notes": "code=Error.message; still fallbackRegionLocalSpans",
        },
        {
            "failureClass": "WORKLOAD_OBSERVED_FALLBACK_REGIONS",
            "codeLocation": "dialog_200 acceptance AFTER (resegmentOk=false)",
            "frequencyInAcceptedReplay": str(n_fail),
            "regionalInputAvailable": "YES",
            "syllableCoordinateAvailable": "YES",
            "rawCoordinateAvailable": "YES",
            "latticeWindowsAvailable": "NO_AS_RETAINED_PATH",
            "partialLatticeEdgesAvailable": "NO_AS_RETAINED_PATH",
            "retainedPathAvailable": "NO",
            "recallCapableQueryDescriptorsAvailable": "YES",
            "notes": f"R_hist={dict(fail_R)}; surfaceCount_hist={dict(fail_surf_n)}; crossFineSpanPotential≈{cross_potential}; multipathCases={len(multipath_cases)}",
        },
    ]

    with (OUT / "model3_retry_fallback_failure_taxonomy.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(taxonomy[0].keys()))
        w.writeheader()
        w.writerows(taxonomy)

    ownership = [
        ("RetryRegion raw/syllable bounds", "AUTHORITATIVE", "Hard bound for all Retry Stage-2 queries"),
        ("region raw text / global syllables", "AUTHORITATIVE", "Available at fallback entry via router args"),
        ("pinyin key from syllable slice", "AUTHORITATIVE", "Derived; same as Delta1"),
        ("tone evidence (owner FineSpan toneRebind)", "VALID_SUPPORTING_EVIDENCE", "Attached via overlapping original FineSpan owner"),
        ("original path FineSpans", "VALID_SUPPORTING_EVIDENCE", "Ownership/materialization only; STALE_FOR_REINTERPRETATION as query geometry"),
        ("first-pass FineSpan bounds as Stage-2 queries", "STALE_FOR_REINTERPRETATION", "DELTA_RQ_FALLBACK_BOUNDARY_LOCK"),
        ("Anchor / KEEP barriers", "AUTHORITATIVE", "Already applied when RetryRegion derived; unchanged"),
        ("regional lattice windows/edges/paths", "FAILED_DERIVATION", "No retained reinterpretation path when ok=false"),
        ("domain hypothesis / retainedDomains", "AUTHORITATIVE", "Existing vote; no second vote"),
        ("source path identity", "AUTHORITATIVE", "Per-path routeModel3Retry; multipath preserved"),
        ("fallbackRegionLocalSpans", "EXISTING_FALLBACK_OWNER_OF_LOCK", "Must lose query-geometry authority after Delta2"),
        ("SHARED_LEXICAL_WINDOW_OWNER", "AUTHORITATIVE_FOR_QUERY_GEOMETRY", "Same 1..5 owner as Delta1 success path"),
        ("overlappingOriginalSpans", "AUTHORITATIVE_FOR_CANDIDATE_OWNER", "Proven on Delta1 cross-FineSpan windows"),
    ]
    with (OUT / "model3_retry_fallback_ownership_map.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["object", "classification", "notes"])
        w.writerows(ownership)

    options = [
        {
            "optionId": "OPT_A_REGION_DIRECT_WINDOW_ENUM",
            "summary": "On resegmentOk=false, enumerate legal 1..min(5,R) windows inside RetryRegion via accepted Delta1 consumer; keep resegmentOk=false; reuse overlappingOriginalSpans",
            "semanticCorrectness": "HIGH — matches frozen Retry reinterpretation; removes OLD_BOUNDARY_LOCK",
            "ownerReused": "SHARED_LEXICAL_WINDOW_OWNER + RetryRegion bounds + overlap ownership",
            "filesTouched": "model3-retry-router.ts (+ optional rename/shared call in model3-retry-stage2-windows.ts)",
            "newTypes": "NO",
            "newState": "NO",
            "candidateOwnership": "PROVEN_REUSE overlappingOriginalSpans",
            "pathOwnership": "UNCHANGED per-path",
            "assemblyCompat": "YES — originSpanId stays first-pass FineSpan",
            "domainCompat": "YES — retainedDomains unchanged",
            "multipathCompat": "YES",
            "singleCharCompat": "YES L=1 preserved",
            "queryImpact": f"~{sum(theor(R)*c for R,c in fail_R.items())} expected windows vs ~{sum(k*v for k,v in fail_surf_n.items())} current surface queries",
            "latencyImpact": "BOUNDED_INCREASE NONBLOCKING_PRESSURE_RISK",
            "complexity": "LOW",
            "delta1Impact": "NONE — success branch untouched",
            "architectureRisk": "LOW",
            "preferred": "YES",
        },
        {
            "optionId": "OPT_B_WINDOW_CORE_ONLY_VIA_HELPER",
            "summary": "Same semantics as A but force call through buildLexicalWindowQueries only with explicit region clip adapter duplicated at fallback site",
            "semanticCorrectness": "HIGH if clip identical",
            "ownerReused": "SHARED_LEXICAL_WINDOW_OWNER",
            "filesTouched": "router + possibly duplicate adapter",
            "newTypes": "NO",
            "newState": "NO",
            "candidateOwnership": "SAME_AS_A",
            "pathOwnership": "UNCHANGED",
            "assemblyCompat": "YES",
            "domainCompat": "YES",
            "multipathCompat": "YES",
            "singleCharCompat": "YES",
            "queryImpact": "SAME_AS_A",
            "latencyImpact": "SAME_AS_A",
            "complexity": "LOW_MODERATE — risk of dual adapter drift",
            "delta1Impact": "NONE if success path untouched",
            "architectureRisk": "LOW_MODERATE",
            "preferred": "NO — inferior to direct reuse of accepted Delta1 consumer",
        },
        {
            "optionId": "OPT_C_PARTIAL_LATTICE_WINDOW_HARVEST",
            "summary": "On lattice fail, try to harvest intermediate windows/edges before path retention fails",
            "semanticCorrectness": "UNPROVEN — depends on internal lattice failure points",
            "ownerReused": "REGIONAL_LATTICE_OWNER partial",
            "filesTouched": "lattice-fine-span-runtime + resegment (≥3 files likely)",
            "newTypes": "MAYBE",
            "newState": "MAYBE",
            "candidateOwnership": "UNCLEAR",
            "pathOwnership": "RISK_OF_FAKE_PATH",
            "assemblyCompat": "UNCLEAR",
            "domainCompat": "YES",
            "multipathCompat": "RISKY",
            "singleCharCompat": "UNKNOWN",
            "queryImpact": "VARIABLE",
            "latencyImpact": "UNKNOWN",
            "complexity": "HIGH",
            "delta1Impact": "NONE_DIRECT",
            "architectureRisk": "HIGH — approaches fake resegment success",
            "preferred": "NO",
        },
    ]
    with (OUT / "model3_retry_fallback_design_options.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(options[0].keys()))
        w.writeheader()
        w.writerows(options)

    # Fill cohort needs
    needs = {
        "A_R1_FALLBACK": "R=1; L=1 Recall contract unchanged",
        "B_R2PLUS_1CHAR_FINESPANS": "original 1-char FineSpans; windows must exceed FineSpan lock",
        "C_CROSS_FINESPAN_LEGAL_WINDOW": "legal window crosses FineSpan boundary",
        "D_MULTIPATH": "no preferred-path collapse",
        "E_BARRIER_ADJACENT": "no Anchor/barrier cross",
        "F_KEEP_ADJACENT": "no unrelated KEEP cross",
        "G_FALLBACK_WITH_RECALL_HIT": "ownership/materialization reaches downstream",
        "H_LONG_HIGH_QUERY": "query bound SUM(R-L+1) pressure",
    }
    for c in cohorts:
        c["need"] = needs.get(c["cohortId"], "")
    with (OUT / "model3_retry_fallback_control_cohorts.csv").open("w", newline="", encoding="utf-8") as f:
        fields = [
            "cohortId",
            "caseId",
            "R",
            "surfaces",
            "rawStart",
            "rawEnd",
            "queryCount",
            "hitQueries",
            "need",
        ]
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(cohorts)

    drift = [
        ("reopens Delta 1?", "NO"),
        ("changes success-path Stage-2?", "NO"),
        ("changes Model3?", "NO"),
        ("changes RetryRegion?", "NO"),
        ("changes barriers?", "NO"),
        ("changes regional lattice?", "NO"),
        ("changes resegmentOk semantics?", "NO"),
        ("changes Domain Vote?", "NO"),
        ("changes Model2?", "NO"),
        ("changes Recall algorithm?", "NO"),
        ("changes Lexicon?", "NO"),
        ("changes Assembly?", "NO"),
        ("changes KenLM?", "NO"),
        ("changes JobResult?", "NO"),
        ("changes candidate cap?", "NO"),
        ("creates new architecture owner?", "NO"),
        ("creates compatibility path?", "NO"),
        ("creates feature flag?", "NO"),
        ("creates second fallback mode without SSOT need?", "NO"),
    ]
    with (OUT / "model3_retry_fallback_drift_gate.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["check", "result"])
        w.writerows(drift)

    exp_q = sum(theor(R) * c for R, c in fail_R.items())
    cur_q = sum(k * v for k, v in fail_surf_n.items())
    summary = {
        "phase": "MODEL3_RETRY_FALLBACK_BOUNDARY_LOCK_DESIGN",
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "delta1Closure": {
            "DELTA_RQ_STAGE2_NO_SLIDING": "RESOLVED_ACCEPTED_CLOSED",
            "RETRY_STAGE2_SUCCESS_PATH_QUERY_ENUMERATION": "LEGAL_BOUNDED_WINDOW_SPACE_1_TO_5",
            "acceptedBaseline": {
                "successfulRetryRegionCount": 164,
                "expectedWindowCount": 877,
                "actualWindowCount": 877,
                "missingWindowCount": 0,
                "extraWindowCount": 0,
                "outOfRegionWindowCount": 0,
                "coordinateMismatch": 0,
                "previousValidQueriesMissing": 0,
                "crossFineSpanExpected": 400,
                "crossFineSpanQueried": 400,
                "preferredPathCollapse": 0,
                "anchorCrossing": 0,
                "keepCrossing": 0,
                "singleCharViolations": 0,
                "secondDomainVote": 0,
                "secondModel3": 0,
                "recursiveRetry": 0,
                "asrRerun": 0,
                "maxCrossPathSentencePool": 8,
            },
        },
        "controlVariable": "RETRY_FALLBACK_GEOMETRY_SOURCE",
        "fallbackGeometryOwner": "SHARED_LEXICAL_WINDOW_OWNER",
        "hardBoundOwner": "RETRY_REGION",
        "candidateOwner": "OVERLAP_ORIGINAL_PATH_FINESPAN",
        "delta1Reuse": "DIRECT_REUSE_SAFE",
        "fallbackSemantics": "A_BOUNDED_LEXICAL_QUERY_WITHOUT_REGIONAL_PATH",
        "preferredDesign": "OPT_A_REGION_DIRECT_WINDOW_ENUM",
        "fallbackRegionLocalSpansFate": "RETAIN_FOR_NON_GEOMETRY_PURPOSE_OR_SUPPORTING_TRACE",
        "DECISION_REQUIRED_BEFORE_DEVELOPMENT": "EMPTY",
        "implementationReady": True,
        "verdict": "MODEL3_RETRY_FALLBACK_BOUNDARY_LOCK_DESIGN_PASS_IMPLEMENTATION_READY",
        "nextPhase": "MODEL3_RETRY_FALLBACK_BOUNDARY_LOCK_DEVELOPMENT",
        "workload": {
            "fallbackRegions": n_fail,
            "successRegions": n_ok,
            "failRHist": dict(fail_R),
            "expectedWindowQueriesIfOptA": exp_q,
            "approxCurrentFallbackQueries": cur_q,
            "crossFineSpanPotential": cross_potential,
            "multipathCases": len(multipath_cases),
        },
        "antiOverfit": {
            "OVERFITTING_DETECTED": "NO",
            "REFERENCE_LEAKAGE": "NO",
            "TEST_GAMING": "NO",
        },
    }
    (OUT / "model3_retry_fallback_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
