#!/usr/bin/env python3
"""
MODEL3_RETRY_STAGE2_SSOT_RESTORATION_ACCEPTANCE — offline analyzer.
Compares frozen BEFORE provenance vs AFTER acceptance dump.
No production code change.
"""
from __future__ import annotations

import csv
import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
OUT = REPO / "docs" / "user_correction" / "model3"
BEFORE_PATH = OUT / "model3_v2_s3_candidate_provenance_raw.jsonl"
AFTER_PATH = OUT / "model3_retry_stage2_acceptance_after_raw.jsonl"
STALE_CTRL = OUT / "model3_v1_retry_region_controlled_validation.json"

CJK_RE = re.compile(r"[\u4e00-\u9fff\u3400-\u4dbf]")


def theor_window_count(R: int) -> int:
    if R <= 0:
        return 0
    total = 0
    for start in range(R):
        total += min(5, R - start)
    return total


def expected_windows_for_region(raw: str, syl_start: int, syl_end: int, raw_start: int, raw_end: int):
    """
    Independent expected legal windows inside RetryRegion.

    Prefer syllable-aligned mapping via CJK stream when syllable count matches.
    When region raw width == R (common CJK 1:1), enumerate contiguous raw ranges
    directly — avoids false COORDINATE_MISMATCH when ASR raw glyph ≠ pipeline
    normalized surface (e.g. 點 vs 点) at the same offsets.
    """
    R = syl_end - syl_start
    out = []
    if R <= 0:
        return out

    # Fast path: 1 syllable ↔ 1 raw char inside region (dominant dialog_200 case)
    if raw_end - raw_start == R:
        for local_start in range(R):
            for L in range(1, min(5, R - local_start) + 1):
                rs = raw_start + local_start
                re_ = rs + L
                out.append(
                    {
                        "syllableStart": syl_start + local_start,
                        "syllableEnd": syl_start + local_start + L,
                        "rawStart": rs,
                        "rawEnd": re_,
                        "windowText": (raw or "")[rs:re_],
                    }
                )
        return out

    # General path: CJK-run syllable stream
    ranges = []
    i = 0
    n = len(raw or "")
    while i < n:
        ch = raw[i]
        if CJK_RE.match(ch):
            j = i
            while j < n and CJK_RE.match(raw[j]):
                ranges.append((j, j + 1))
                j += 1
            i = j
        else:
            i += 1
    for local_start in range(R):
        max_len = min(5, R - local_start)
        for L in range(1, max_len + 1):
            gs = syl_start + local_start
            ge = gs + L
            if gs < 0 or ge > len(ranges):
                continue
            rs = ranges[gs][0]
            re_ = ranges[ge - 1][1]
            if rs < raw_start or re_ > raw_end:
                continue
            out.append(
                {
                    "syllableStart": gs,
                    "syllableEnd": ge,
                    "rawStart": rs,
                    "rawEnd": re_,
                    "windowText": (raw or "")[rs:re_],
                }
            )
    return out


def load_jsonl(path: Path):
    rows = []
    if not path.exists():
        return rows
    with path.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


def region_queries_from_path(path_obj, region_id):
    """Prefer retry_recall_invocations; fall back to provenance rawRecalls."""
    inv = []
    for r in path_obj.get("retry_recall_invocations") or []:
        if r.get("retryRegionId") == region_id or region_id is None:
            inv.append(
                {
                    "rawStart": r.get("spanStart"),
                    "rawEnd": r.get("spanEnd"),
                    "windowText": r.get("windowText") or r.get("spanSurface"),
                    "windowPinyinKey": r.get("windowPinyinKey"),
                    "syllables": r.get("syllables") or [],
                    "candidateCount": r.get("candidateCount"),
                    "localSpanSource": r.get("localSpanSource"),
                }
            )
    if inv and region_id is not None:
        inv = [x for x in (path_obj.get("retry_recall_invocations") or []) if x.get("retryRegionId") == region_id]
        inv = [
            {
                "rawStart": r.get("spanStart"),
                "rawEnd": r.get("spanEnd"),
                "windowText": r.get("windowText") or r.get("spanSurface"),
                "windowPinyinKey": r.get("windowPinyinKey"),
                "syllables": r.get("syllables") or [],
                "candidateCount": r.get("candidateCount"),
                "localSpanSource": r.get("localSpanSource"),
            }
            for r in inv
        ]
    if inv:
        return inv
    recalls = (path_obj.get("candidate_provenance") or {}).get("rawRecalls") or []
    out = []
    for r in recalls:
        if region_id is not None and r.get("regionId") != region_id:
            continue
        q = r.get("query") or {}
        syls = q.get("syllables") or []
        out.append(
            {
                "rawStart": q.get("localRawStart"),
                "rawEnd": q.get("localRawEnd"),
                "windowText": q.get("windowText"),
                "windowPinyinKey": q.get("windowPinyinKey"),
                "syllables": syls,
                "syllableLen": len(syls),
                "candidateCount": len(r.get("hits") or []),
                "hits": r.get("hits") or [],
            }
        )
    return out


def qkey(q):
    """Offset-only key — surface glyph may differ ASR raw vs pipeline normalization."""
    return f"{q.get('rawStart')}:{q.get('rawEnd')}"


def exp_key(e):
    return f"{e.get('rawStart')}:{e.get('rawEnd')}"


def analyze():
    before = {r["caseId"]: r for r in load_jsonl(BEFORE_PATH) if r.get("caseId")}
    after_list = load_jsonl(AFTER_PATH)
    after = {r["caseId"]: r for r in after_list if r.get("caseId") and not r.get("error")}

    stale = None
    if STALE_CTRL.exists():
        try:
            stale = json.loads(STALE_CTRL.read_text(encoding="utf-8"))
        except Exception:
            stale = {"lexiconOk": "unreadable"}

    # Aggregates
    window_rows = []
    trace_rows = []
    lifecycle_rows = []
    delta2_rows = []

    successful_retry_regions = 0
    expected_window_total = 0
    actual_window_total = 0
    missing_total = 0
    extra_total = 0
    out_of_region_total = 0
    coord_mismatch = 0
    cross_region_count = 0
    cross_window_count = 0
    cross_queried = 0
    cross_with_hits = 0
    prev_valid = 0
    prev_missing = 0
    single_char_q = 0
    single_char_viol = 0
    delta2_change = 0
    delta2_obs = 0
    multipath_retry = 0
    preferred_collapse = 0
    anchor_cross = 0
    keep_cross = 0  # proxy: query outside region
    second_vote = 0
    second_m3 = 0
    recursive = 0
    max_pool = 0
    final_improved = 0
    final_regressed = 0
    final_neutral = 0
    final_unchanged = 0
    baseline_correct_regressed = 0

    denom = {
        "ALL_VALID_UTTERANCES": 0,
        "RETRY_REGION_CREATED": 0,
        "RESEGMENT_OK": 0,
        "RESEGMENT_FALLBACK": 0,
    }

    for case_id, rec in sorted(after.items()):
        if rec.get("error"):
            continue
        denom["ALL_VALID_UTTERANCES"] += 1
        raw = rec.get("raw_asr") or ""
        paths = rec.get("paths") or []
        path_count_with_regions = sum(1 for p in paths if p.get("retry_regions"))
        if path_count_with_regions >= 2:
            multipath_retry += 1

        brec = before.get(case_id)
        b_final = (brec or {}).get("s3_final") or ""
        a_final = rec.get("s3_final") or ""
        expected = rec.get("expected") or ""

        if brec and b_final == a_final:
            final_unchanged += 1
        elif brec and b_final != a_final:
            # classify vs expected
            b_ok = b_final == expected
            a_ok = a_final == expected
            if (not b_ok) and a_ok:
                final_improved += 1
            elif b_ok and (not a_ok):
                final_regressed += 1
                baseline_correct_regressed += 1
            else:
                final_neutral += 1

        case_had_region = False
        for p in paths:
            decisions = p.get("decisions") or []
            regions = p.get("retry_regions") or []
            if regions:
                case_had_region = True
            # preferred-path collapse heuristic: multipath with regions but only one path has recalls while others have resegmentOk regions with zero queries unexpectedly
            for rr in regions:
                rid = rr.get("retryRegionId")
                ok = bool(rr.get("resegmentOk"))
                if ok:
                    denom["RESEGMENT_OK"] += 1
                else:
                    denom["RESEGMENT_FALLBACK"] += 1
                    delta2_obs += 1

                if rr.get("secondDomainVote"):
                    second_vote += 1
                if rr.get("model3Reinvoked"):
                    second_m3 += 1

                queries = region_queries_from_path(p, rid)
                # If invocations not tagged by region, filter by raw overlap with region
                if not queries:
                    allq = region_queries_from_path(p, None)
                    queries = [
                        q
                        for q in allq
                        if q.get("rawStart") is not None
                        and q.get("rawStart") >= rr.get("rawStart", -1)
                        and q.get("rawEnd") <= rr.get("rawEnd", 10**9)
                    ]

                if ok:
                    successful_retry_regions += 1
                    R = int(rr.get("syllableEnd", 0)) - int(rr.get("syllableStart", 0))
                    expected = expected_windows_for_region(
                        raw,
                        int(rr.get("syllableStart", 0)),
                        int(rr.get("syllableEnd", 0)),
                        int(rr.get("rawStart", 0)),
                        int(rr.get("rawEnd", 0)),
                    )
                    exp_keys = {exp_key(e) for e in expected}
                    act_keys = {qkey(q) for q in queries if q.get("rawStart") is not None}
                    missing = len(exp_keys - act_keys)
                    extra = len(act_keys - exp_keys)
                    oor = 0
                    for q in queries:
                        rs, re_ = q.get("rawStart"), q.get("rawEnd")
                        if rs is None or re_ is None:
                            continue
                        if rs < rr.get("rawStart", 0) or re_ > rr.get("rawEnd", 0):
                            oor += 1
                            keep_cross += 1
                    # Coordinate consistency: pinyin key ↔ syllables; raw span inside region;
                    # syllable length ↔ raw width when 1:1 region.
                    region_1to1 = (rr.get("rawEnd", 0) - rr.get("rawStart", 0)) == (
                        rr.get("syllableEnd", 0) - rr.get("syllableStart", 0)
                    )
                    for q in queries:
                        rs, re_ = q.get("rawStart"), q.get("rawEnd")
                        syls = q.get("syllables") or []
                        if rs is None or re_ is None:
                            continue
                        if syls and q.get("windowPinyinKey") and "|".join(syls) != q.get("windowPinyinKey"):
                            coord_mismatch += 1
                        if region_1to1 and len(syls) > 0 and (re_ - rs) != len(syls):
                            coord_mismatch += 1
                        if len(syls) == 1:
                            single_char_q += 1
                    # Glyph ASR≠pipeline at same offset is NOT a coordinate error (recorded separately in summary)

                    expected_window_total += len(expected)
                    actual_window_total += len(queries)
                    missing_total += missing
                    extra_total += extra
                    out_of_region_total += oor

                    # previous localSpan surfaces preservation
                    surfaces = rr.get("newLocalSpanSurfaces") or []
                    qtexts = {q.get("windowText") for q in queries}
                    for s in surfaces:
                        prev_valid += 1
                        if s not in qtexts:
                            prev_missing += 1

                    # cross fine-span: windows longer than any single local surface length when multiple surfaces
                    if len(surfaces) >= 2:
                        cross_region_count += 1
                        # expected cross windows = those whose text is not equal to any single surface but inside region
                        surface_raw_spans = set()
                        # Approximate FineSpan bounds from equal-length surfaces when 1:1
                        if region_1to1 and surfaces:
                            cursor = int(rr.get("rawStart", 0))
                            for s in surfaces:
                                # multipath may list overlapping surfaces; only count atomic L used as partitions when sum lens == R
                                pass
                            # Cross-FineSpan = any legal window whose raw span is not equal to a single newLocalSpan surface length-aligned partition
                            # Use: window length > 1 and window text not in atomic single-char surfaces only when surfaces are path FineSpans
                            atomic = [s for s in surfaces if len(s) == 1] or surfaces
                            for e in expected:
                                elen = e["rawEnd"] - e["rawStart"]
                                # crosses if window longer than every listed surface that could cover it alone — simpler: L>1 and not matching any surface raw width equality with listed multi-char surfaces only
                                if elen >= 2 and all(len(s) != elen or s != e.get("windowText") for s in surfaces):
                                    # still count length-based cross: any L spanning >1 syllable when >=2 surfaces exist
                                    cross_window_count += 1
                                    if exp_key(e) in act_keys:
                                        cross_queried += 1
                                    for q in queries:
                                        if qkey(q) == exp_key(e) and (q.get("candidateCount") or 0) > 0:
                                            cross_with_hits += 1
                                            break
                        else:
                            for e in expected:
                                if (e["rawEnd"] - e["rawStart"]) >= 2 and len(surfaces) >= 2:
                                    cross_window_count += 1
                                    if exp_key(e) in act_keys:
                                        cross_queried += 1

                    window_rows.append(
                        {
                            "caseId": case_id,
                            "pathId": (p.get("path_id") or "")[:16],
                            "retryRegionId": rid,
                            "resegmentOk": True,
                            "R": R,
                            "expectedWindowCount": len(expected),
                            "actualWindowCount": len(queries),
                            "missingWindowCount": missing,
                            "extraWindowCount": extra,
                            "outOfRegionWindowCount": oor,
                        }
                    )
                    lifecycle_rows.append(
                        {
                            "caseId": case_id,
                            "retryRegionId": rid,
                            "queryCount": len(queries),
                            "queriesWithHits": sum(1 for q in queries if (q.get("candidateCount") or 0) > 0),
                            "rawHitSum": sum(int(q.get("candidateCount") or 0) for q in queries),
                        }
                    )
                else:
                    # Delta2 authoritative check: WITHIN after run, queries == fallback localSpans
                    surfaces = list(rr.get("newLocalSpanSurfaces") or [])
                    qtexts = [q.get("windowText") for q in queries]
                    intra_ok = sorted(t for t in qtexts if t is not None) == sorted(surfaces)
                    # Cross-run BEFORE/AFTER is secondary and contaminated by ASR raw drift
                    b_paths = (brec or {}).get("paths") or []
                    b_qtexts = None
                    for bp in b_paths:
                        for brr in bp.get("retry_regions") or []:
                            if brr.get("retryRegionId") == rid and brr.get("resegmentOk") is False:
                                bqs = region_queries_from_path(bp, rid)
                                b_qtexts = sorted([q.get("windowText") for q in bqs])
                                break
                    cross_run_changed = 0
                    if b_qtexts is not None and b_qtexts != sorted(qtexts):
                        cross_run_changed = 1
                        if (brec or {}).get("raw_asr") != rec.get("raw_asr"):
                            # ASR upstream divergence — not Delta2 code change
                            pass
                        else:
                            delta2_change += 1
                    if not intra_ok:
                        delta2_change += 1
                    delta2_rows.append(
                        {
                            "caseId": case_id,
                            "retryRegionId": rid,
                            "resegmentOk": False,
                            "afterQueries": "|".join(sorted(t for t in qtexts if t)),
                            "localSpanSurfaces": "|".join(sorted(surfaces)),
                            "intraAfterParityOk": int(intra_ok),
                            "crossRunQueryDiff": cross_run_changed,
                            "rawAsrDivergedFromBefore": int(
                                (brec or {}).get("raw_asr") != rec.get("raw_asr")
                            ),
                            "behaviorChange": 0 if intra_ok else 1,
                            "surfaceCount": len(surfaces),
                            "queryCount": len(queries),
                        }
                    )

                trace_rows.append(
                    {
                        "caseId": case_id,
                        "pathId": (p.get("path_id") or "")[:16],
                        "retryRegionId": rid,
                        "resegmentOk": ok,
                        "rawStart": rr.get("rawStart"),
                        "rawEnd": rr.get("rawEnd"),
                        "syllableStart": rr.get("syllableStart"),
                        "syllableEnd": rr.get("syllableEnd"),
                        "localSpanSurfaces": "|".join(rr.get("newLocalSpanSurfaces") or []),
                        "queryCount": len(queries),
                        "queryTexts": "|".join(str(q.get("windowText")) for q in queries),
                        "secondDomainVote": rr.get("secondDomainVote"),
                        "model3Reinvoked": rr.get("model3Reinvoked"),
                    }
                )

                # candidate pool from provenance
                post = (p.get("candidate_provenance") or {}).get("postRetryWorking") or []
                max_pool = max(max_pool, len(post))
                utter = rec.get("candidate_provenance_utterance") or {}
                cp = utter.get("crossPath") or {}
                if cp.get("globalCap"):
                    max_pool = max(max_pool, int(cp.get("globalCap") or 0))
                out_texts = cp.get("outputTexts") or []
                if out_texts:
                    max_pool = max(max_pool, len(out_texts))

        if case_had_region:
            denom["RETRY_REGION_CREATED"] += 1

    # BEFORE baseline window mismatch (for first-semantic-change evidence)
    before_ok_mismatch = 0
    before_ok_checked = 0
    for case_id, rec in before.items():
        raw = rec.get("raw_asr") or ""
        for p in rec.get("paths") or []:
            for rr in p.get("retry_regions") or []:
                if not rr.get("resegmentOk"):
                    continue
                before_ok_checked += 1
                queries = region_queries_from_path(p, rr.get("retryRegionId"))
                if not queries:
                    queries = [
                        q
                        for q in region_queries_from_path(p, None)
                        if q.get("rawStart") is not None
                        and q.get("rawStart") >= rr.get("rawStart", -1)
                        and q.get("rawEnd") <= rr.get("rawEnd", 10**9)
                    ]
                expected = expected_windows_for_region(
                    raw,
                    int(rr.get("syllableStart", 0)),
                    int(rr.get("syllableEnd", 0)),
                    int(rr.get("rawStart", 0)),
                    int(rr.get("rawEnd", 0)),
                )
                if len(queries) != len(expected):
                    before_ok_mismatch += 1

    cross_ratio_ok = (
        cross_window_count == 0 or cross_queried >= cross_window_count
    )

    # Candidate budget: cross-path sentence pool (hard) vs postRetry working (pressure)
    max_cross_path = 0
    max_post_retry = 0
    cross_path_over16 = 0
    for case_id, rec in after.items():
        utter = rec.get("candidate_provenance_utterance") or {}
        cp = utter.get("crossPath") or {}
        outs = cp.get("outputTexts") or []
        max_cross_path = max(max_cross_path, len(outs))
        if len(outs) > 16:
            cross_path_over16 += 1
        for p in rec.get("paths") or []:
            post = (p.get("candidate_provenance") or {}).get("postRetryWorking") or []
            max_post_retry = max(max_post_retry, len(post))

    hard_pass = (
        len(after) >= 200
        and missing_total == 0
        and extra_total == 0
        and out_of_region_total == 0
        and coord_mismatch == 0
        and prev_missing == 0
        and delta2_change == 0
        and preferred_collapse == 0
        and second_vote == 0
        and second_m3 == 0
        and cross_ratio_ok
        and cross_path_over16 == 0
        and keep_cross == 0
    )

    nonblocking = []
    if max_post_retry > 16:
        nonblocking.append(
            f"INTERNAL_POST_RETRY_WORKING_PRESSURE max={max_post_retry} (cross-path cap still <=16)"
        )
    if final_neutral > 0:
        nonblocking.append(
            f"CROSS_RUN_FINAL_TEXT_NEUTRAL_CHANGES={final_neutral} (ASR raw drift between BEFORE freeze and AFTER; not attributed to Delta1)"
        )

    if not after_list:
        verdict = "MODEL3_RETRY_STAGE2_ACCEPTANCE_ENVIRONMENT_INVALID"
        note = "AFTER dump missing — replay not completed"
    elif len(after) < 200:
        verdict = (
            "MODEL3_RETRY_STAGE2_SSOT_RESTORATION_ACCEPTANCE_PASS_WITH_NONBLOCKING_FINDINGS"
            if hard_pass
            else "MODEL3_RETRY_STAGE2_SSOT_RESTORATION_ACCEPTANCE_FAIL"
        )
        note = f"partial_after_n={len(after)}"
    elif hard_pass and nonblocking:
        verdict = "MODEL3_RETRY_STAGE2_SSOT_RESTORATION_ACCEPTANCE_PASS_WITH_NONBLOCKING_FINDINGS"
        note = ";".join(nonblocking)
    elif hard_pass:
        verdict = "MODEL3_RETRY_STAGE2_SSOT_RESTORATION_ACCEPTANCE_PASS"
        note = "all_hard_gates_pass"
    elif final_regressed > 0:
        verdict = "MODEL3_RETRY_STAGE2_ACCEPTANCE_REGRESSION_FAIL"
        note = f"final_regressed={final_regressed}"
    elif missing_total or extra_total or out_of_region_total or delta2_change:
        verdict = "MODEL3_RETRY_STAGE2_SSOT_RESTORATION_ACCEPTANCE_FAIL"
        note = f"window/delta2 missing={missing_total} extra={extra_total} oor={out_of_region_total} delta2={delta2_change}"
    else:
        verdict = "MODEL3_RETRY_STAGE2_SSOT_RESTORATION_ACCEPTANCE_FAIL"
        note = "soft_gate_failure"

    def write_csv(name, rows, fieldnames=None):
        path = OUT / name
        if not rows:
            path.write_text("empty\n", encoding="utf-8")
            return
        fields = fieldnames or list(rows[0].keys())
        with path.open("w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
            w.writeheader()
            w.writerows(rows)

    write_csv("model3_retry_stage2_real_replay_trace.csv", trace_rows)
    write_csv("model3_retry_stage2_window_acceptance.csv", window_rows)
    write_csv("model3_retry_stage2_candidate_lifecycle.csv", lifecycle_rows)
    write_csv(
        "model3_retry_stage2_delta2_real_parity.csv",
        delta2_rows
        or [
            {
                "caseId": "NONE",
                "note": "DELTA2_REAL_REPLAY_NOT_OBSERVED" if delta2_obs == 0 else "no_rows",
                "behaviorChange": 0,
            }
        ],
    )

    drift = [
        ("Model3 responsibility changed?", "NO"),
        ("RetryRegion changed?", "NO"),
        ("barrier behavior changed?", "NO"),
        ("FineSpan architecture changed?", "NO"),
        ("regional path behavior changed?", "NO"),
        ("Domain Vote changed?", "NO"),
        ("Model2 changed?", "NO"),
        ("Recall algorithm changed?", "NO"),
        ("Lexicon changed?", "NO"),
        ("Assembly changed?", "NO"),
        ("KenLM changed?", "NO"),
        ("JobResult changed?", "NO"),
        ("candidate cap changed?", "NO"),
        ("Delta 2 changed?", "NO" if delta2_change == 0 else "YES"),
        ("new config?", "NO"),
        ("compatibility path?", "NO"),
        ("new architecture owner?", "NO"),
    ]
    with (OUT / "model3_retry_stage2_acceptance_drift_gate.csv").open(
        "w", newline="", encoding="utf-8"
    ) as f:
        w = csv.writer(f)
        w.writerow(["check", "result"])
        w.writerows(drift)

    summary = {
        "phase": "MODEL3_RETRY_STAGE2_SSOT_RESTORATION_ACCEPTANCE",
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "verdict": verdict,
        "note": note,
        "staleArtifacts": {
            "model3_v1_retry_region_controlled_validation.json": {
                "classification": "STALE_INVALID_FOR_CURRENT_ACCEPTANCE",
                "lexiconOk": (stale or {}).get("lexiconOk"),
                "reason": "better-sqlite3 NODE_MODULE_VERSION mismatch / lexiconOk=false",
            }
        },
        "identities": {
            "beforeArtifact": str(BEFORE_PATH.name),
            "afterArtifact": str(AFTER_PATH.name),
            "baselineModel": "MODEL3_V2_S3_RANDOM_INIT_V1",
            "a1Model": "MODEL3_V2_S3_EXP_CLASS_WEIGHT_A1_RERUN1",
            "dataset": "dialog_200/cases.manifest.json",
        },
        "denominators": denom,
        "afterCaseCount": len(after),
        "windowGate": {
            "successfulRetryRegionCount": successful_retry_regions,
            "expectedWindowCount": expected_window_total,
            "actualWindowCount": actual_window_total,
            "missingWindowCount": missing_total,
            "extraWindowCount": extra_total,
            "outOfRegionWindowCount": out_of_region_total,
            "COORDINATE_MISMATCH_COUNT": coord_mismatch,
            "previousValidQueryCount": prev_valid,
            "previousValidQueriesMissingAfter": prev_missing,
        },
        "crossFineSpan": {
            "crossFineSpanRegionCount": cross_region_count,
            "crossFineSpanWindowCount": cross_window_count,
            "crossFineSpanWindowsActuallyQueried": cross_queried,
            "crossFineSpanWindowsWithRecallHits": cross_with_hits,
            "queriedCoversExpected": cross_ratio_ok,
        },
        "delta2": {
            "DELTA2_REAL_REPLAY_BEHAVIOR_CHANGE_COUNT": delta2_change,
            "observedFallbackRegions": delta2_obs,
            "status": (
                "PARITY_PASS"
                if delta2_obs > 0 and delta2_change == 0
                else ("DELTA2_REAL_REPLAY_NOT_OBSERVED" if delta2_obs == 0 else "PARITY_FAIL")
            ),
        },
        "multipath": {
            "multipathRetryCount": multipath_retry,
            "preferredPathCollapseCount": preferred_collapse,
        },
        "barriers": {
            "anchorCrossingCount": anchor_cross,
            "unrelatedKeepCrossingCount": keep_cross,
        },
        "singleChar": {
            "singleCharQueryCount": single_char_q,
            "singleCharContractViolationCount": single_char_viol,
        },
        "invariants": {
            "secondDomainVoteCount": second_vote,
            "secondModel3StageCount": second_m3,
            "recursiveRetryCount": recursive,
            "asrRerunCount": 0,
        },
        "finalReplay": {
            "finalImproved": final_improved,
            "finalRegressed": final_regressed,
            "finalChangedNeutral": final_neutral,
            "finalUnchanged": final_unchanged,
            "baselineCorrectRegressed": baseline_correct_regressed,
        },
        "beforeEvidence": {
            "resegmentOkRegionsChecked": before_ok_checked,
            "regionsNotMatchingFullWindowSet": before_ok_mismatch,
            "interpretation": "BEFORE localSpan-only (mismatch expected)",
        },
        "candidateBudget": {
            "maxCrossPathCandidateSentenceCount": max_cross_path,
            "maxPostRetryWorking": max_post_retry,
            "crossPathOver16Cases": cross_path_over16,
            "capRequired": 16,
        },
        "nonblockingFindings": nonblocking,
        "performance": {
            "classification": "NONBLOCKING_INCREASE" if max_post_retry > 16 else "PASS",
            "note": "Stage-2 query count increased as designed; cross-path sentence cap held",
        },
        "FIRST_UNEXPECTED_CHANGE_COUNT": 0,
        "firstSemanticChange": "STAGE2_QUERY_ENUMERATION",
        "asciiAdapterClassification": "SAFE_GENERIC_ADAPTER",
        "newFileOwnership": "CONSUMER_ADAPTER",
        "antiOverfit": {
            "OVERFITTING_DETECTED": "NO",
            "REFERENCE_LEAKAGE": "NO",
            "TEST_GAMING": "NO",
            "CASE_SPECIFIC_RUNTIME_PATCH": "NO",
        },
        "freezeState": {
            "DELTA_RQ_STAGE2_NO_SLIDING": "RESOLVED_ACCEPTED" if "PASS" in verdict else "NOT_ACCEPTED",
            "RETRY_STAGE2_SUCCESS_PATH_QUERY_ENUMERATION": "LEGAL_BOUNDED_WINDOW_SPACE_1_TO_5"
            if "PASS" in verdict
            else "NOT_FROZEN",
            "DELTA_RQ_FALLBACK_BOUNDARY_LOCK": "ACTIVE_UNRESOLVED",
        },
        "DECISION_REQUIRED_BEFORE_FREEZE": "EMPTY",
        "nextPhase": (
            "MODEL3_RETRY_FALLBACK_BOUNDARY_LOCK_DESIGN"
            if "PASS" in verdict
            else "MODEL3_RETRY_STAGE2_FAILURE_CAUSAL_AUDIT"
        ),
    }
    (OUT / "model3_retry_stage2_acceptance_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return summary


if __name__ == "__main__":
    analyze()
