# -*- coding: utf-8 -*-
"""Model3 V2 training-only label contract: region supervision + FineSpan projection."""
from __future__ import annotations

import difflib
from collections import Counter
from typing import Any

LABEL_CONTRACT_VERSION = "MODEL3_LABEL_CONTRACT_V2_20260829"
ORTHO_FAMILIES = frozenset({"ORTHOGRAPHIC_DE_DI_DE", "orthographic_de_di_de"})


def _span_tuple(span: dict) -> tuple[int, int]:
    return int(span["rawStart"]), int(span["rawEnd"])


def _overlaps(a_start: int, a_end: int, b_start: int, b_end: int) -> bool:
    return not (a_end <= b_start or b_end <= a_start)


def anchor_ranges(spans: list[dict]) -> list[tuple[int, int]]:
    return [_span_tuple(s) for s in spans if s.get("isAnchor")]


def subtract_anchors(start: int, end: int, anchors: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Return sub-intervals of [start,end) not overlapping any anchor range."""
    if end <= start:
        return []
    parts = [(start, end)]
    for a0, a1 in sorted(anchors):
        nxt: list[tuple[int, int]] = []
        for s, e in parts:
            if a1 <= s or a0 >= e:
                nxt.append((s, e))
                continue
            if s < a0:
                nxt.append((s, a0))
            if a1 < e:
                nxt.append((a1, e))
        parts = nxt
    return [(s, e) for s, e in parts if e > s]


def merge_cur_intervals(intervals: list[tuple[int, int]]) -> list[tuple[int, int]]:
    if not intervals:
        return []
    intervals = sorted(intervals)
    merged: list[list[int]] = []
    for s, e in intervals:
        if e <= s:
            continue
        if not merged or s > merged[-1][1]:
            merged.append([s, e])
        else:
            merged[-1][1] = max(merged[-1][1], e)
    return [(a, b) for a, b in merged]


def derive_malformed_regions(
    current: str,
    reference: str,
    corruptions: list[dict] | None = None,
    anchors: list[tuple[int, int]] | None = None,
) -> list[dict[str, Any]]:
    """Training-only malformed regions in current-text coordinates."""
    regions: list[dict[str, Any]] = []
    if not current or reference is None:
        return regions

    sm = difflib.SequenceMatcher(a=current, b=reference, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue
        if tag == "replace" and i2 > i1:
            regions.append(
                {
                    "curStart": i1,
                    "curEnd": i2,
                    "refStart": j1,
                    "refEnd": j2,
                    "tag": tag,
                    "lengthChanging": (i2 - i1) != (j2 - j1),
                }
            )
        elif tag == "delete" and i2 > i1:
            regions.append(
                {
                    "curStart": i1,
                    "curEnd": i2,
                    "refStart": j1,
                    "refEnd": j2,
                    "tag": tag,
                    "lengthChanging": True,
                }
            )
        elif tag == "insert":
            regions.append(
                {
                    "curStart": i1,
                    "curEnd": i1,
                    "refStart": j1,
                    "refEnd": j2,
                    "tag": tag,
                    "deletionGap": True,
                    "lengthChanging": True,
                }
            )

    for corr in corruptions or []:
        cs = corr.get("spanStart")
        ce = corr.get("spanEnd")
        if not isinstance(cs, int) or not isinstance(ce, int) or ce <= cs:
            continue
        rs = corr.get("referenceSurface") or ""
        es = corr.get("errorSurface") or ""
        regions.append(
            {
                "curStart": cs,
                "curEnd": ce,
                "refStart": None,
                "refEnd": None,
                "tag": "corruption",
                "lengthChanging": len(rs) != len(es),
                "corruptionFamily": corr.get("corruptionFamily"),
            }
        )

    cur_ivals = merge_cur_intervals([(r["curStart"], r["curEnd"]) for r in regions if r["curEnd"] > r["curStart"]])
    out: list[dict[str, Any]] = []
    for s, e in cur_ivals:
        meta = next((r for r in regions if r["curStart"] <= s and r["curEnd"] >= e and r["curEnd"] > r["curStart"]), {})
        out.append(
            {
                "curStart": s,
                "curEnd": e,
                "refStart": meta.get("refStart"),
                "refEnd": meta.get("refEnd"),
                "tag": meta.get("tag", "merged"),
                "lengthChanging": meta.get("lengthChanging", False),
                "deletionGap": False,
            }
        )

    if anchors:
        clipped: list[dict[str, Any]] = []
        for r in out:
            for s, e in subtract_anchors(r["curStart"], r["curEnd"], anchors):
                clipped.append({**r, "curStart": s, "curEnd": e, "deletionGap": False})
        out = clipped

    return [r for r in out if r["curEnd"] > r["curStart"]]


def span_in_malformed_region(span: dict, region: dict) -> bool:
    s0, s1 = _span_tuple(span)
    return _overlaps(s0, s1, region["curStart"], region["curEnd"])


def region_retry_applicable(span: dict, regions: list[dict]) -> bool:
    if span.get("isAnchor"):
        return False
    return any(span_in_malformed_region(span, r) for r in regions if not r.get("deletionGap"))


def _is_orthographic(family: str | None) -> bool:
    fam = (family or "").upper()
    return fam in ORTHO_FAMILIES or fam.startswith("ORTHOGRAPHIC")


def _training_family(span: dict, regions: list[dict], sample_meta: dict | None) -> str:
    meta = sample_meta or {}
    pm = meta.get("pilotMeta") or {}
    shape = pm.get("ERROR_SHAPE") or ""
    fam = span.get("corruptionFamily") or pm.get("corruptionFamily") or ""
    fam_l = (fam or "").lower()
    if span.get("label") == "EXCLUDE_FROM_SUPERVISED":
        return "EXCLUDE"
    if span.get("label") == "MASKED":
        return "ANCHOR"
    if span.get("labelClass") == "HARD_KEEP" or meta.get("trainingBucket") == "HARD_KEEP":
        return "HARD_KEEP"
    if span.get("label") != "RETRY":
        return "CLEAN_KEEP" if shape in ("", "CLEAN") else "KEEP_OTHER"
    if "tone" in fam_l:
        return "TONE_RETRY"
    if shape == "MULTI_CHAR" or any(r.get("lengthChanging") for r in regions):
        return "MALFORMED_REGION_RETRY"
    anchors = anchor_ranges(meta.get("_spans_for_adjacency") or [])
    s0, s1 = _span_tuple(span)
    for a0, a1 in anchors:
        if s1 == a0 or s0 == a1:
            return "ANCHOR_ADJACENT_RETRY"
    if "phonetic" in fam_l or pm.get("ERROR_RELATION") == "PHONETIC":
        return "PHONETIC_RETRY"
    return "PHONETIC_RETRY"


def label_spans_v2(mat: dict) -> tuple[list[dict], Counter, list[dict]]:
    """V2 KEEP/RETRY/EXCLUDE labeling with region projection."""
    current = mat.get("currentText") or ""
    reference = mat.get("referenceText") or ""
    raw_spans = mat.get("spans") or []
    corruptions = mat.get("corruptions") or []
    anchors = anchor_ranges(raw_spans)
    regions = derive_malformed_regions(current, reference, corruptions, anchors)

    spans_out: list[dict] = []
    stats: Counter = Counter()

    if current == reference and not corruptions:
        regions = []

    for s in raw_spans:
        is_anchor = bool(s.get("isAnchor"))
        surface = s.get("surface") or ""
        ref = s.get("referenceSurface")
        if ref is None:
            ref = current[s["rawStart"] : s["rawEnd"]] if current else surface
        reach = (s.get("repairability") or {}).get("referenceReachable", "UNKNOWN")
        phonetic = bool(s.get("phoneticCompatible"))
        family = s.get("corruptionFamily") or ""
        ortho = _is_orthographic(family)

        rra = region_retry_applicable(s, regions)

        if is_anchor:
            label, tm, lc, reason = "MASKED", 0, None, "ANCHOR_KEEP"
        elif ortho:
            label, tm, lc, reason = "KEEP", 1, "UNREPAIRABLE_KEEP", "ORTHOGRAPHIC"
        elif rra:
            label, tm, lc, reason = "RETRY", 1, "RETRY", "NON_ANCHOR_ERROR_RETRY"
        elif regions and any(span_in_malformed_region(s, r) for r in regions if r.get("deletionGap")):
            label, tm, lc, reason = "EXCLUDE_FROM_SUPERVISED", 0, None, "DELETION_GAP"
        elif ref == surface:
            label, tm, lc, reason = "KEEP", 1, "A", "NON_ANCHOR_VALID_KEEP"
        elif not regions and ref != surface:
            if reach == "UNKNOWN":
                label, tm, lc, reason = "EXCLUDE_FROM_SUPERVISED", 0, None, "AMBIGUOUS_EXCLUDE"
            elif reach == "NO" and not phonetic:
                label, tm, lc, reason = "KEEP", 1, "UNREPAIRABLE_KEEP", "UNREPAIRABLE_KEEP"
            else:
                label, tm, lc, reason = "KEEP", 1, "HARD_KEEP", "HARD_KEEP"
        elif regions:
            label, tm, lc, reason = "KEEP", 1, "A", "REGION_NEIGHBOR_KEEP"
        elif reach == "UNKNOWN" and ref != surface:
            label, tm, lc, reason = "EXCLUDE_FROM_SUPERVISED", 0, None, "AMBIGUOUS_EXCLUDE"
        else:
            label, tm, lc, reason = "KEEP", 1, "B", "LEGACY_KEEP"

        stats[label] += 1
        spans_out.append(
            {
                "spanId": s["spanId"],
                "surface": surface,
                "rawStart": s["rawStart"],
                "rawEnd": s["rawEnd"],
                "syllableStart": s.get("syllableStart"),
                "syllableEnd": s.get("syllableEnd"),
                "isAnchor": is_anchor,
                "anchorSource": s.get("anchorSource") or "NONE",
                "targetMask": tm,
                "label": label,
                "labelClass": lc,
                "labelReason": reason,
                "referenceSurface": ref,
                "pinyinEvidence": s.get("pinyinEvidence"),
                "toneEvidence": s.get("toneEvidence"),
                "acousticEvidence": s.get("acousticEvidence"),
                "pronunciationEvidence": s.get("pronunciationEvidence"),
                "recallEvidence": s.get("recallEvidence"),
                "repairability": s.get("repairability"),
                "phoneticCompatible": phonetic,
                "corruptionFamily": family or None,
                "regionRetryApplicable": rra,
            }
        )

    return spans_out, stats, regions


def relabel_sample_v2(sample: dict) -> tuple[dict, dict]:
    """Relabel an existing MODEL3_TRAINING_SAMPLE_V1 row under V2 contract."""
    mat = {
        "referenceText": sample.get("referenceText") or "",
        "currentText": sample.get("currentText") or "",
        "spans": sample.get("spans") or [],
        "corruptions": (sample.get("pilotMeta") or {}).get("corruptions")
        or (sample.get("provenance") or {}).get("corruptions")
        or [],
    }
    old_by_id = {s["spanId"]: s.get("label") for s in sample.get("spans") or []}
    spans, stats, regions = label_spans_v2(mat)
    changed = sum(1 for s in spans if old_by_id.get(s["spanId"]) != s["label"])

    out = dict(sample)
    out["spans"] = spans
    prov = dict(out.get("provenance") or {})
    prov["labelContractVersion"] = LABEL_CONTRACT_VERSION
    prov["labelMaterializerVersion"] = "model3-v2-label-materializer-1.0.0"
    prov["malformedRegions"] = regions
    out["provenance"] = prov
    meta = {
        "changed_span_labels": changed,
        "total_spans": len(spans),
        "stats": dict(stats),
        "regions": regions,
        "old_labels": dict(old_by_id),
    }
    return out, meta
