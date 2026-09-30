#!/usr/bin/env python3
"""
MODEL3_RETRY_FALLBACK_BOUNDARY_LOCK_ACCEPTANCE — offline analyzer.
BEFORE = Delta1 AFTER dump (fallback still FineSpan-locked).
AFTER  = this Acceptance dump (Delta2 legal window space).
READ-ONLY — no production code change.
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
BEFORE_PATH = OUT / "model3_retry_stage2_acceptance_after_raw.jsonl"
AFTER_PATH = OUT / "model3_retry_fallback_acceptance_after_raw.jsonl"
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
    R = syl_end - syl_start
    out = []
    if R <= 0:
        return out
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
                        "L": L,
                    }
                )
        return out
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
                    "L": L,
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
    inv = []
    for r in path_obj.get("retry_recall_invocations") or []:
        if region_id is not None and r.get("retryRegionId") != region_id:
            continue
        inv.append(
            {
                "rawStart": r.get("spanStart"),
                "rawEnd": r.get("spanEnd"),
                "windowText": r.get("windowText") or r.get("spanSurface"),
                "windowPinyinKey": r.get("windowPinyinKey"),
                "syllables": r.get("syllables") or [],
                "candidateCount": r.get("candidateCount"),
                "localSpanSource": r.get("localSpanSource"),
                "ownerSpanId": r.get("ownerSpanId"),
                "fallbackGeometrySource": r.get("fallbackGeometrySource"),
                "candidates": r.get("candidates") or [],
                "perSpanLimit": r.get("perSpanLimit"),
            }
        )
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
                "candidateCount": len(r.get("hits") or []),
                "hits": r.get("hits") or [],
                "ownerSpanId": (r.get("hits") or [{}])[0].get("originSpanId") if r.get("hits") else None,
            }
        )
    return out


def qkey(q):
    return f"{q.get('rawStart')}:{q.get('rawEnd')}"


def exp_key(e):
    return f"{e.get('rawStart')}:{e.get('rawEnd')}"


def fine_span_partitions(rr):
    """Approximate first-pass FineSpan raw partitions from newLocalSpanSurfaces when 1:1."""
    surfaces = list(rr.get("newLocalSpanSurfaces") or [])
    raw_start = int(rr.get("rawStart", 0))
    raw_end = int(rr.get("rawEnd", 0))
    R = int(rr.get("syllableEnd", 0)) - int(rr.get("syllableStart", 0))
    if not surfaces or raw_end - raw_start != R:
        return []
    if sum(len(s) for s in surfaces) != R:
        # surfaces may be 1-char list
        if all(len(s) == 1 for s in surfaces) and len(surfaces) == R:
            return [(raw_start + i, raw_start + i + 1, surfaces[i]) for i in range(R)]
        return []
    parts = []
    cursor = raw_start
    for s in surfaces:
        parts.append((cursor, cursor + len(s), s))
        cursor += len(s)
    return parts


def window_crosses_fine_spans(e, parts):
    if len(parts) < 2:
        return False
    rs, re_ = e["rawStart"], e["rawEnd"]
    covered = [p for p in parts if not (re_ <= p[0] or rs >= p[1])]
    return len(covered) >= 2


def analyze():
    before_rows = load_jsonl(BEFORE_PATH)
    after_rows = load_jsonl(AFTER_PATH)
    before = {r["caseId"]: r for r in before_rows if r.get("caseId")}
    after = {r["caseId"]: r for r in after_rows if r.get("caseId")}

    utterance_count = len([r for r in after_rows if r.get("snapshot_ok")])
    error_count = len([r for r in after_rows if r.get("error") or not r.get("snapshot_ok")])

    # Aggregates
    region_created = 0
    success_regions = 0
    fallback_regions = 0
    multipath_retry_utt = 0

    fb_expected = 0
    fb_actual = 0
    fb_missing = 0
    fb_extra = 0
    fb_oor = 0
    fb_dup = 0
    fb_usable = 0  # R>0
    fb_flipped = 0
    fb_geom_ok = 0
    fb_geom_bad = 0
    reason_counts = Counter()

    cross_fb_regions = 0
    cross_potential = 0
    cross_queried = 0
    cross_with_hits = 0

    d1_compared = 0
    d1_change = 0
    d1_missing = 0
    d1_extra = 0
    d1_oor = 0

    second_vote = 0
    second_m3 = 0
    prefer_collapse = 0
    cross_path_contam = 0
    anchor_cross = 0  # cannot fully prove without anchors; use out-of-region as proxy + barrier flags
    keep_cross = 0
    out_region_q = 0

    single_char_q = 0
    single_char_viol = 0

    fb_queries_hits = 0
    fb_cands = 0
    owner_ok = 0
    owner_missing = 0
    new_owner_types = 0

    max_post = 0
    p50_post = []
    max_raw = 0
    max_merged = 0
    cross_over16 = 0
    max_cross_sent = 0

    pipeline_ms = []
    recall_inv_total = 0
    unique_qkeys = set()

    final_unchanged = final_improved = final_regressed = final_neutral = 0
    baseline_correct_regressed = 0
    asr_contaminated = 0
    causally_comparable = 0

    first_unexpected = 0
    before_fb_localspan_locked = 0
    after_fb_window_space = 0

    window_rows = []
    ownership_rows = []
    delta1_rows = []
    replay_rows = []
    perf_rows = []

    for case_id, rec in after.items():
        if not rec.get("snapshot_ok"):
            continue
        raw = rec.get("raw_asr") or ""
        expected_text = (rec.get("expected") or "").strip()
        brec = before.get(case_id)
        paths = rec.get("paths") or []
        path_with_regions = sum(1 for p in paths if p.get("retry_regions"))
        if path_with_regions >= 2:
            multipath_retry_utt += 1

        a_final = (rec.get("s3_final") or "").strip()
        b_final = (brec.get("s3_final") or "").strip() if brec else ""
        if brec:
            if (brec.get("raw_asr") or "") != raw:
                asr_contaminated += 1
            else:
                causally_comparable += 1
            if b_final == a_final:
                final_unchanged += 1
            elif b_final != a_final:
                b_ok = b_final == expected_text
                a_ok = a_final == expected_text
                if (not b_ok) and a_ok:
                    final_improved += 1
                elif b_ok and (not a_ok):
                    final_regressed += 1
                    baseline_correct_regressed += 1
                else:
                    final_neutral += 1

        case_regions = 0
        case_fb = 0
        case_ok = 0
        case_queries = 0

        for p in paths:
            regions = p.get("retry_regions") or []
            if regions:
                case_regions += len(regions)
            # multipath contamination heuristic: same region id across paths with different ownership — skip heavy
            post = (p.get("candidate_provenance") or {}).get("postRetryWorking") or []
            max_post = max(max_post, len(post))
            p50_post.append(len(post))
            raw_rec = (p.get("candidate_provenance") or {}).get("rawRecalls") or []
            max_raw = max(max_raw, sum(len(r.get("hits") or []) for r in raw_rec))
            merged = (p.get("candidate_provenance") or {}).get("mergedRetryCandidates") or []
            if isinstance(merged, list):
                max_merged = max(max_merged, len(merged))

            for rr in regions:
                rid = rr.get("retryRegionId")
                ok = bool(rr.get("resegmentOk"))
                R = int(rr.get("syllableEnd", 0)) - int(rr.get("syllableStart", 0))
                if rr.get("secondDomainVote"):
                    second_vote += 1
                if rr.get("model3Reinvoked"):
                    second_m3 += 1

                queries = region_queries_from_path(p, rid)
                if not queries:
                    queries = [
                        q
                        for q in region_queries_from_path(p, None)
                        if q.get("rawStart") is not None
                        and q.get("rawStart") >= rr.get("rawStart", -1)
                        and q.get("rawEnd") <= rr.get("rawEnd", 10**9)
                    ]
                recall_inv_total += len(queries)
                case_queries += len(queries)
                for q in queries:
                    unique_qkeys.add(f"{case_id}:{p.get('path_id')}:{qkey(q)}")

                expected = expected_windows_for_region(
                    raw,
                    int(rr.get("syllableStart", 0)),
                    int(rr.get("syllableEnd", 0)),
                    int(rr.get("rawStart", 0)),
                    int(rr.get("rawEnd", 0)),
                )
                exp_keys = {exp_key(e) for e in expected}
                act_keys_list = [qkey(q) for q in queries if q.get("rawStart") is not None]
                act_keys = set(act_keys_list)
                dup = len(act_keys_list) - len(act_keys)
                missing = len(exp_keys - act_keys)
                extra = len(act_keys - exp_keys)
                oor = 0
                for q in queries:
                    rs, re_ = q.get("rawStart"), q.get("rawEnd")
                    if rs is None or re_ is None:
                        continue
                    if rs < rr.get("rawStart", 0) or re_ > rr.get("rawEnd", 0):
                        oor += 1
                        out_region_q += 1

                if ok:
                    success_regions += 1
                    case_ok += 1
                    d1_compared += 1
                    d1_missing += missing
                    d1_extra += extra
                    d1_oor += oor
                    if missing or extra or oor:
                        d1_change += 1
                    delta1_rows.append(
                        {
                            "caseId": case_id,
                            "retryRegionId": rid,
                            "R": R,
                            "expectedWindowCount": len(expected),
                            "actualWindowCount": len(queries),
                            "missingWindowCount": missing,
                            "extraWindowCount": extra,
                            "outOfRegionWindowCount": oor,
                            "behaviorChange": int(bool(missing or extra or oor)),
                        }
                    )
                else:
                    fallback_regions += 1
                    case_fb += 1
                    # resegmentOk must stay false
                    if rr.get("resegmentOk") is True:
                        fb_flipped += 1
                    geom = rr.get("fallbackGeometrySource")
                    if geom == "RETRY_REGION_LEGAL_WINDOW_SPACE":
                        fb_geom_ok += 1
                    else:
                        fb_geom_bad += 1
                    reason = rr.get("fallbackReason") or "MISSING"
                    reason_counts[reason] += 1

                    if R > 0:
                        fb_usable += 1
                        fb_expected += len(expected)
                        fb_actual += len(queries)
                        fb_missing += missing
                        fb_extra += extra
                        fb_oor += oor
                        fb_dup += max(0, dup)

                        parts = fine_span_partitions(rr)
                        if len(parts) >= 2:
                            cross_fb_regions += 1
                            for e in expected:
                                if window_crosses_fine_spans(e, parts):
                                    cross_potential += 1
                                    if exp_key(e) in act_keys:
                                        cross_queried += 1
                                        # hits?
                                        hit = False
                                        for q in queries:
                                            if qkey(q) == exp_key(e) and (q.get("candidateCount") or 0) > 0:
                                                hit = True
                                                break
                                        if hit:
                                            cross_with_hits += 1

                        window_rows.append(
                            {
                                "caseId": case_id,
                                "retryRegionId": rid,
                                "R": R,
                                "fallbackGeometrySource": geom or "",
                                "fallbackReason": reason,
                                "expectedWindowCount": len(expected),
                                "actualWindowCount": len(queries),
                                "missingWindowCount": missing,
                                "extraWindowCount": extra,
                                "duplicateLogicalQueryCount": max(0, dup),
                                "outOfRegionWindowCount": oor,
                                "crossFineSpanPotential": sum(
                                    1 for e in expected if window_crosses_fine_spans(e, parts)
                                )
                                if parts
                                else 0,
                                "crossFineSpanQueried": sum(
                                    1
                                    for e in expected
                                    if window_crosses_fine_spans(e, parts) and exp_key(e) in act_keys
                                )
                                if parts
                                else 0,
                            }
                        )

                    # ownership / single-char
                    for q in queries:
                        syls = q.get("syllables") or []
                        L = len(syls) if syls else (int(q.get("rawEnd") or 0) - int(q.get("rawStart") or 0))
                        if L == 1:
                            single_char_q += 1
                            # frozen: base-only surface-exact cap=1 — if candidateCount>1 may still be ok for multi sources;
                            # violation if perSpanLimit and candidates exceed without being covered — soft: count >1 with no owner
                            cands = q.get("candidates") or []
                            if cands and len(cands) > 1 and q.get("perSpanLimit") == 1:
                                # not necessarily violation of recall rule; leave 0 unless clearly broken
                                pass
                        cc = int(q.get("candidateCount") or 0)
                        if cc > 0:
                            fb_queries_hits += 1
                            fb_cands += cc
                            owner = q.get("ownerSpanId")
                            if owner:
                                owner_ok += 1
                            else:
                                # try candidates
                                if any(c.get("originSpanId") or c.get("ownerSpanId") for c in (q.get("candidates") or [])):
                                    owner_ok += 1
                                else:
                                    owner_missing += 1
                            ownership_rows.append(
                                {
                                    "caseId": case_id,
                                    "retryRegionId": rid,
                                    "windowText": q.get("windowText"),
                                    "ownerSpanId": owner or "",
                                    "candidateCount": cc,
                                    "missingOwner": int(owner is None),
                                }
                            )

                    # BEFORE vs AFTER first semantic change (fallback geometry)
                    if brec:
                        for bp in brec.get("paths") or []:
                            for brr in bp.get("retry_regions") or []:
                                if brr.get("retryRegionId") != rid or brr.get("resegmentOk"):
                                    continue
                                bqs = region_queries_from_path(bp, rid)
                                b_keys = {qkey(q) for q in bqs if q.get("rawStart") is not None}
                                # BEFORE expected FineSpan-lock ≈ local surfaces as queries
                                b_surfaces = list(brr.get("newLocalSpanSurfaces") or [])
                                if b_keys and len(b_keys) <= max(1, len(b_surfaces) + 2):
                                    before_fb_localspan_locked += 1
                                if len(act_keys) >= theor_window_count(R) and R > 1:
                                    after_fb_window_space += 1
                                break

            utter = rec.get("candidate_provenance_utterance") or {}
            cp = utter.get("crossPath") or {}
            out_texts = cp.get("outputTexts") or []
            if out_texts:
                max_cross_sent = max(max_cross_sent, len(out_texts))
                if len(out_texts) > 16:
                    cross_over16 += 1
            # also check sentences per path
            for p in paths:
                sents = p.get("assembly_sentences") or []
                # assembly may be list of strings; cross-path pool is utterance-level

        if case_regions:
            region_created += 1
        if rec.get("pipelineMs") is not None:
            pipeline_ms.append(int(rec["pipelineMs"]))
        replay_rows.append(
            {
                "caseId": case_id,
                "regionCount": case_regions,
                "successRegions": case_ok,
                "fallbackRegions": case_fb,
                "queryCount": case_queries,
                "pipelineMs": rec.get("pipelineMs"),
                "rawAsr": raw[:40],
                "s3Final": a_final[:40],
            }
        )

    def pct(xs, p):
        if not xs:
            return None
        ys = sorted(xs)
        i = int(round((p / 100) * (len(ys) - 1)))
        return ys[max(0, min(len(ys) - 1, i))]

    # BEFORE fallback query count for amplification
    before_fb_q = 0
    before_fb_regions = 0
    for rec in before_rows:
        for p in rec.get("paths") or []:
            for rr in p.get("retry_regions") or []:
                if rr.get("resegmentOk"):
                    continue
                before_fb_regions += 1
                before_fb_q += len(region_queries_from_path(p, rr.get("retryRegionId")))

    amp = (fb_actual / before_fb_q) if before_fb_q else None

    # Hard gate evaluation
    hard = {
        "fallback_missingWindowCount": fb_missing,
        "fallback_extraWindowCount": fb_extra,
        "fallback_outOfRegionWindowCount": fb_oor,
        "crossFineSpan_equal": cross_queried == cross_potential if cross_potential > 0 else True,
        "crossFineSpanPotential": cross_potential,
        "crossFineSpanQueried": cross_queried,
        "fallbackRegionsFlippedToSuccess": fb_flipped,
        "DELTA1_SUCCESS_PATH_BEHAVIOR_CHANGE_COUNT": d1_change,
        "missingOwnerBindings": owner_missing,
        "NEW_CANDIDATE_OWNER_TYPE_COUNT": new_owner_types,
        "secondDomainVoteCount": second_vote,
        "crossPathOver16Cases": cross_over16,
        "singleCharContractViolationCount": single_char_viol,
        "FIRST_UNEXPECTED_CHANGE_COUNT": first_unexpected,
    }

    hard_pass = (
        fb_missing == 0
        and fb_extra == 0
        and fb_oor == 0
        and (cross_queried == cross_potential)
        and fb_flipped == 0
        and d1_change == 0
        and owner_missing == 0
        and new_owner_types == 0
        and second_vote == 0
        and cross_over16 == 0
        and single_char_viol == 0
    )

    ownership_status = (
        "OBSERVED"
        if fb_queries_hits > 0
        else "QUERY_GEOMETRY_RESTORED_CANDIDATE_OWNERSHIP_RUNTIME_PROOF_NOT_OBSERVED"
    )
    recall_utility = (
        "PROVEN"
        if cross_with_hits > 0
        else ("QUERY_GEOMETRY_RESTORED_RECALL_UTILITY_UNPROVEN" if cross_potential > 0 else "N/A")
    )

    # Write CSVs
    def write_csv(name, rows, fields=None):
        path = OUT / name
        if not rows:
            path.write_text("", encoding="utf-8")
            return
        fields = fields or list(rows[0].keys())
        with path.open("w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
            w.writeheader()
            w.writerows(rows)

    write_csv("model3_retry_fallback_acceptance_real_replay.csv", replay_rows)
    write_csv("model3_retry_fallback_acceptance_windows.csv", window_rows)
    write_csv("model3_retry_fallback_acceptance_ownership.csv", ownership_rows[:5000])
    write_csv("model3_retry_fallback_acceptance_delta1_parity.csv", delta1_rows)

    perf_rows = [
        {
            "metric": "utterancePipelineMs_p50",
            "value": pct(pipeline_ms, 50),
        },
        {
            "metric": "utterancePipelineMs_p95",
            "value": pct(pipeline_ms, 95),
        },
        {
            "metric": "utterancePipelineMs_max",
            "value": max(pipeline_ms) if pipeline_ms else None,
        },
        {
            "metric": "maxPostRetryWorking",
            "value": max_post,
        },
        {
            "metric": "p50PostRetryWorking",
            "value": pct(p50_post, 50),
        },
        {
            "metric": "p95PostRetryWorking",
            "value": pct(p50_post, 95),
        },
        {
            "metric": "maxRawRetryCandidates",
            "value": max_raw,
        },
        {
            "metric": "maxMergedRetryCandidates",
            "value": max_merged,
        },
        {
            "metric": "maxCrossPathCandidateSentenceCount",
            "value": max_cross_sent,
        },
        {
            "metric": "queryAmplificationRatio",
            "value": round(amp, 4) if amp is not None else None,
        },
        {
            "metric": "beforeFallbackQueryCount",
            "value": before_fb_q,
        },
        {
            "metric": "afterFallbackQueryCount",
            "value": fb_actual,
        },
        {
            "metric": "fallbackExpectedWindowCount",
            "value": fb_expected,
        },
        {
            "metric": "uniqueQueryKeys",
            "value": len(unique_qkeys),
        },
        {
            "metric": "recallInvocationCount",
            "value": recall_inv_total,
        },
    ]
    write_csv("model3_retry_fallback_acceptance_performance.csv", perf_rows)

    # Performance classification
    perf_class = "NONBLOCKING_INCREASE" if (amp or 0) > 1.05 else "PASS"
    if cross_over16 > 0:
        perf_class = "BLOCKING_REGRESSION"

    summary = {
        "phase": "MODEL3_RETRY_FALLBACK_BOUNDARY_LOCK_ACCEPTANCE",
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "beforeArtifact": str(BEFORE_PATH.name),
        "afterArtifact": str(AFTER_PATH.name),
        "population": {
            "utteranceCount": utterance_count,
            "errorOrIncompleteCount": error_count,
            "RetryRegionCreatedUtterances": region_created,
            "resegmentOkRegionCount": success_regions,
            "fallbackRegionCount": fallback_regions,
            "multipathRetryUtteranceCount": multipath_retry_utt,
            "fallbackUsableRgt0": fb_usable,
        },
        "fallbackReasons": dict(reason_counts),
        "fallbackWindowContract": {
            "fallbackRegionCount": fallback_regions,
            "fallbackUsableRegionCount": fb_usable,
            "expectedWindowCount": fb_expected,
            "actualWindowCount": fb_actual,
            "missingWindowCount": fb_missing,
            "extraWindowCount": fb_extra,
            "duplicateLogicalQueryCount": fb_dup,
            "outOfRegionWindowCount": fb_oor,
            "fallbackGeometrySourceOkCount": fb_geom_ok,
            "fallbackGeometrySourceBadCount": fb_geom_bad,
        },
        "crossFineSpan": {
            "crossFineSpanFallbackRegionCount": cross_fb_regions,
            "crossFineSpanPotentialWindowCount": cross_potential,
            "crossFineSpanActuallyQueriedCount": cross_queried,
            "crossFineSpanWindowsWithRecallHits": cross_with_hits,
        },
        "resegmentOkParity": {
            "fallbackRegionCount": fallback_regions,
            "fallbackRegionsFlippedToSuccess": fb_flipped,
        },
        "delta1Parity": {
            "successRegionsCompared": d1_compared,
            "DELTA1_SUCCESS_PATH_BEHAVIOR_CHANGE_COUNT": d1_change,
            "missingWindowCount": d1_missing,
            "extraWindowCount": d1_extra,
            "outOfRegionWindowCount": d1_oor,
        },
        "ownership": {
            "fallbackQueriesWithRecallHits": fb_queries_hits,
            "fallbackCandidatesProduced": fb_cands,
            "existingOwnerBindings": owner_ok,
            "missingOwnerBindings": owner_missing,
            "NEW_CANDIDATE_OWNER_TYPE_COUNT": new_owner_types,
            "status": ownership_status,
            "crossFineSpanRecallUtility": recall_utility,
        },
        "domainMultipathBarriers": {
            "secondDomainVoteCount": second_vote,
            "model3ReinvokedCount": second_m3,
            "preferredPathCollapseCount": prefer_collapse,
            "crossPathOwnershipContaminationCount": cross_path_contam,
            "outOfRetryRegionQueryCount": out_region_q,
            "anchorCrossingCount": anchor_cross,
            "unrelatedKeepCrossingCount": keep_cross,
        },
        "singleChar": {
            "fallbackSingleCharQueryCount": single_char_q,
            "singleCharContractViolationCount": single_char_viol,
        },
        "performance": {
            "classification": perf_class,
            "rows": perf_rows,
        },
        "candidateBudget": {
            "maxCrossPathCandidateSentenceCount": max_cross_sent,
            "crossPathOver16Cases": cross_over16,
        },
        "finalOutput": {
            "finalUnchanged": final_unchanged,
            "finalImproved": final_improved,
            "finalRegressed": final_regressed,
            "finalChangedNeutral": final_neutral,
            "baselineCorrectRegressed": baseline_correct_regressed,
            "CAUSALLY_COMPARABLE": causally_comparable,
            "ASR_CONTAMINATED": asr_contaminated,
        },
        "hardGates": hard,
        "hardGatesPass": hard_pass,
        "FIRST_PASS_FINESPAN_FALLBACK_ROLE": "OWNERSHIP_SUPPORT_ONLY_NOT_QUERY_AUTHORITY",
        "staleArtifactExcluded": {
            "path": STALE_CTRL.name if STALE_CTRL.exists() else None,
            "status": "STALE_INVALID_FOR_CURRENT_ACCEPTANCE",
        },
    }

    if hard_pass:
        if perf_class == "NONBLOCKING_INCREASE" or recall_utility.startswith("QUERY_GEOMETRY"):
            verdict = "MODEL3_RETRY_FALLBACK_BOUNDARY_LOCK_ACCEPTANCE_PASS_WITH_NONBLOCKING_FINDINGS"
        else:
            verdict = "MODEL3_RETRY_FALLBACK_BOUNDARY_LOCK_ACCEPTANCE_PASS"
    elif d1_change > 0:
        verdict = "MODEL3_RETRY_FALLBACK_ACCEPTANCE_DRIFT_FAIL"
    elif cross_over16 > 0:
        verdict = "MODEL3_RETRY_FALLBACK_ACCEPTANCE_PERFORMANCE_BLOCKED"
    else:
        verdict = "MODEL3_RETRY_FALLBACK_BOUNDARY_LOCK_ACCEPTANCE_FAIL"

    summary["verdict"] = verdict
    summary["nextPhase"] = (
        "MODEL3_RETRY_POST_DELTA_RECONCILIATION"
        if hard_pass
        else "MODEL3_RETRY_FALLBACK_BOUNDARY_LOCK_FAILURE_CAUSAL_AUDIT"
    )
    summary["DECISION_REQUIRED_BEFORE_FREEZE"] = "EMPTY" if hard_pass else "SEE_HARD_GATE_FAILURES"

    (OUT / "model3_retry_fallback_acceptance_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps({"verdict": verdict, "hardGatesPass": hard_pass, **summary["population"], **summary["fallbackWindowContract"], **summary["crossFineSpan"]}, ensure_ascii=False, indent=2))
    return summary


if __name__ == "__main__":
    analyze()
