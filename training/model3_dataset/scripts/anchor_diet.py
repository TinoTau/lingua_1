# -*- coding: utf-8 -*-
"""Anchor-conditioned training diet: REAL_DOMAIN, SIMULATED_TRAINING, NO_ANCHOR."""
from __future__ import annotations

import random
from typing import Any


def strip_anchors(mat_spans: list[dict]) -> None:
    for s in mat_spans:
        s["isAnchor"] = False
        s["anchorSource"] = "NONE"


def _span_correct(s: dict, current: str, reference: str) -> bool:
    ref = s.get("referenceSurface")
    if ref is None:
        if len(reference) == len(current):
            ref = reference[s["rawStart"] : s["rawEnd"]]
        else:
            ref = s.get("surface")
    return ref == s.get("surface")


def pick_simulated_anchor_spans(
    spans: list[dict],
    current: str,
    reference: str,
    rng: random.Random,
    max_anchors: int = 1,
) -> list[dict]:
    eligible = [
        s
        for s in spans
        if _span_correct(s, current, reference)
        and (s["rawEnd"] - s["rawStart"]) >= 1
    ]
    if not eligible:
        return []
    eligible.sort(
        key=lambda s: (
            -(s["rawEnd"] - s["rawStart"]),
            -((s.get("recallEvidence") or {}).get("firstPassCandidateCount") or 0),
            s["rawStart"],
        )
    )
    k = 1
    if len(eligible) >= 3 and rng.random() < 0.15:
        k = 2
    k = min(k, max_anchors, len(eligible))
    pool = eligible[: min(6, len(eligible))]
    rng.shuffle(pool)
    return pool[:k]


def apply_anchor_diet(
    mat: dict,
    intended: str,
    rng: random.Random,
) -> dict[str, Any]:
    """
    intended: NO_ANCHOR | ANCHOR_CONDITIONED
    Returns sidecar provenance dict (training-only; not model feature).
    """
    spans = mat.get("spans") or []
    current = mat.get("currentText") or ""
    reference = mat.get("referenceText") or ""
    retained = (mat.get("domainEvidence") or {}).get("retainedDomains") or []

    sidecar: dict[str, Any] = {
        "intendedDiet": intended,
        "retainedDomains": list(retained),
        "simulatedAnchorSpanIds": [],
        "realDomainAnchorSpanIds": [],
        "anchorDietBucket": "NO_ANCHOR",
        "trainingAnchorEvidence": "NONE",
    }

    real_ids = [s["spanId"] for s in spans if s.get("isAnchor")]
    if real_ids:
        sidecar["realDomainAnchorSpanIds"] = real_ids

    if intended == "NO_ANCHOR":
        strip_anchors(spans)
        sidecar["anchorDietBucket"] = "NO_ANCHOR"
        sidecar["trainingAnchorEvidence"] = "NONE"
        return sidecar

    has_real = bool(real_ids)
    if has_real:
        sidecar["anchorDietBucket"] = "REAL_DOMAIN"
        sidecar["trainingAnchorEvidence"] = "REAL_DOMAIN"
        return sidecar

    picks = pick_simulated_anchor_spans(spans, current, reference, rng)
    if not picks:
        strip_anchors(spans)
        sidecar["anchorDietBucket"] = "NO_ANCHOR_FALLBACK"
        sidecar["trainingAnchorEvidence"] = "NONE"
        return sidecar

    strip_anchors(spans)
    sim_ids = []
    for s in picks:
        s["isAnchor"] = True
        # Schema allows DOMAIN|MODEL2|DOMAIN_AND_MODEL2 only — provenance in sidecar.
        s["anchorSource"] = "DOMAIN"
        sim_ids.append(s["spanId"])
    sidecar["simulatedAnchorSpanIds"] = sim_ids
    sidecar["anchorDietBucket"] = "SIMULATED_TRAINING"
    sidecar["trainingAnchorEvidence"] = "SIMULATED_TRAINING_ANCHOR"
    return sidecar


def overlaps_char_range(span: dict, start: int, end: int) -> bool:
    return not (span["rawEnd"] <= start or span["rawStart"] >= end)


def overlaps_char_index(index: int, start: int, end: int) -> bool:
    return start <= index < end


def reserved_anchor_char_range(text: str, annos: list, rng: random.Random) -> tuple[int, int] | None:
    """Heuristic reserve zone for simulated anchor before corruption."""
    good = [a for a in annos if not a.skip_reason]
    if not good:
        return None
    good.sort(key=lambda a: (-len(a.surface), a.index))
    pool = good[: min(4, len(good))]
    a = rng.choice(pool)
    idx = a.index
    return idx, idx + 1
