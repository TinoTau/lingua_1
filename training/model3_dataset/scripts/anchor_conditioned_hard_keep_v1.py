# -*- coding: utf-8
"""ANCHOR_CONDITIONED_HARD_KEEP_V1 — training category + validator (not runtime)."""
from __future__ import annotations

from collections import Counter
from typing import Any

CATEGORY_ID = "ANCHOR_CONDITIONED_HARD_KEEP_V1"
CATEGORY_VERSION = "1.0.0"

EVIDENCE_MIXED_TARGET = "A_same_target_legal_retry_elsewhere"
EVIDENCE_REACHABLE_ALT = "B_reachable_confusable_alternative"
EVIDENCE_PRON_FAMILY = "C_pronunciation_ambiguity_family"
EVIDENCE_CONTRAST_FAMILY = "D_strict_or_semantic_contrast_family"
EVIDENCE_OTHER = "E_other_auditable_ambiguity"


def has_anchor(sample: dict) -> bool:
    return any(sp.get("isAnchor") for sp in sample.get("spans") or [])


def anchor_surfaces(sample: dict) -> list[str]:
    return [sp.get("surface") or "" for sp in sample.get("spans") or [] if sp.get("isAnchor")]


def eligible_keep_spans(sample: dict) -> list[dict]:
    out = []
    for sp in sample.get("spans") or []:
        if sp.get("targetMask") != 1 or sp.get("label") != "KEEP":
            continue
        if sp.get("isAnchor"):
            continue
        out.append(sp)
    return out


def validate_anchor_conditioned_hard_keep_v1(
    sample: dict,
    *,
    ambiguity_evidence: list[str] | None = None,
    target_surface: str | None = None,
) -> dict[str, Any]:
    """Hard validator for ANCHOR_CONDITIONED_HARD_KEEP training category."""
    reasons: list[str] = []
    if not has_anchor(sample):
        reasons.append("no_anchor")
    keeps = eligible_keep_spans(sample)
    if not keeps:
        reasons.append("no_eligible_keep_target")
    tgt_sp = None
    tgt_spans = keeps
    if target_surface:
        tgt_spans = [sp for sp in keeps if sp.get("surface") == target_surface]
        if not tgt_spans:
            reasons.append("target_surface_not_found")
    if tgt_spans:
        tgt_sp = tgt_spans[0]
        if tgt_sp.get("isAnchor"):
            reasons.append("target_is_anchor")
        ref = tgt_sp.get("referenceSurface")
        surf = tgt_sp.get("surface")
        if ref is not None and surf is not None and ref != surf:
            reasons.append("target_not_keep_semantics")
    if not ambiguity_evidence:
        reasons.append("missing_ambiguity_evidence")
    else:
        allowed = {
            EVIDENCE_MIXED_TARGET,
            EVIDENCE_REACHABLE_ALT,
            EVIDENCE_PRON_FAMILY,
            EVIDENCE_CONTRAST_FAMILY,
            EVIDENCE_OTHER,
        }
        if not any(e in allowed for e in ambiguity_evidence):
            reasons.append("invalid_ambiguity_evidence")
    # generic easy keep heuristic: single-char common with no evidence beyond generic
    if ambiguity_evidence == ["E_other_auditable_ambiguity"] and len(sample.get("currentText") or "") < 12:
        reasons.append("likely_generic_keep")

    ok = len(reasons) == 0
    return {
        "ok": ok,
        "category": CATEGORY_ID,
        "reasons": reasons,
        "reject_code": None if ok else "HARD_KEEP_REJECT",
        "targetSurface": tgt_sp.get("surface") if tgt_sp else target_surface,
        "anchorSurfaces": anchor_surfaces(sample),
        "ambiguityEvidence": ambiguity_evidence or [],
    }
