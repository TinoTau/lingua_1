# -*- coding: utf-8 -*-
"""Training provenance validation — HARD_REJECT vs SEMANTIC_EXCLUDE."""
from __future__ import annotations

from typing import Any

HARD_REJECT_CODES = frozenset(
    {
        "CROSS_SAMPLE_PROVENANCE_MISMATCH",
        "MODEL3_CURRENT_TEXT_IDENTITY_INVALID",
        "AUDIO_MATERIALIZATION_FAILED",
        "ASR_FAILED",
        "TONE_STATE_MISSING",
        "RECALL_STATE_INVALID",
        "FINESPAN_MATERIALIZATION_FAILED",
        "ANCHOR_MATERIALIZATION_BLOCKED",
        "ALIGNMENT_FAILED",
        "PROTECTED_HOLDOUT_COLLISION",
    }
)

SEMANTIC_EXCLUDE_CODES = frozenset(
    {
        "NO_REPAIRABLE_TARGET",
    }
)


def validate_text_identity(
    *,
    raw_actual_asr_text: str,
    model3_current_text: str,
    harness_current_text: str,
) -> dict | None:
    """MODEL3_CURRENT_TEXT_IDENTITY_VALID — harness FineSpan text is SSOT."""
    if not model3_current_text or not harness_current_text:
        return {
            "code": "MODEL3_CURRENT_TEXT_IDENTITY_INVALID",
            "kind": "HARD_REJECT",
            "identityFailed": "model3CurrentText",
        }
    if model3_current_text != harness_current_text:
        return {
            "code": "MODEL3_CURRENT_TEXT_IDENTITY_INVALID",
            "kind": "HARD_REJECT",
            "identityFailed": "model3CurrentText!=harness",
            "detail": {
                "model3CurrentText": model3_current_text[:80],
                "harnessCurrentText": harness_current_text[:80],
            },
        }
    # raw may differ via production OpenCC/NFKC — that is NOT a mismatch.
    _ = raw_actual_asr_text
    return None


def validate_label_feature_provenance_coherent(utt: dict[str, Any]) -> dict | None:
    """LABEL_FEATURE_PROVENANCE_COHERENT fail-closed gate."""
    current = utt.get("model3CurrentText") or utt.get("currentText") or ""
    harness = (utt.get("lattice") or {}).get("currentText") or current
    if current != harness:
        return {
            "code": "CROSS_SAMPLE_PROVENANCE_MISMATCH",
            "kind": "HARD_REJECT",
            "identityFailed": "currentText",
        }
    if not utt.get("asrRunIdentity"):
        return {
            "code": "CROSS_SAMPLE_PROVENANCE_MISMATCH",
            "kind": "HARD_REJECT",
            "identityFailed": "asrRunIdentity",
        }
    if not utt.get("toneRunIdentity"):
        return {
            "code": "CROSS_SAMPLE_PROVENANCE_MISMATCH",
            "kind": "HARD_REJECT",
            "identityFailed": "toneRunIdentity",
        }
    diag = utt.get("ownerDiagnostics") or {}
    owners = utt.get("ownerExecution") or {}

    # Prefer explicit diagnostics; fall back to diagnostic aliases.
    m2_wired = diag.get("MODEL2_OWNER_WIRED")
    if m2_wired is None:
        m2_wired = owners.get("MODEL2_ANCHOR_OWNER_WIRED")
    dom_wired = diag.get("DOMAIN_OWNER_WIRED")
    if dom_wired is None:
        dom_wired = owners.get("DOMAIN_ANCHOR_OWNER_WIRED")

    if dom_wired is False:
        return {
            "code": "ANCHOR_MATERIALIZATION_BLOCKED",
            "kind": "HARD_REJECT",
            "identityFailed": "Domain owner not wired",
        }
    if m2_wired is False:
        return {
            "code": "ANCHOR_MATERIALIZATION_BLOCKED",
            "kind": "HARD_REJECT",
            "identityFailed": "Model2 owner not wired",
        }

    m2_attempted = diag.get("MODEL2_OWNER_ATTEMPTED")
    if m2_attempted is None:
        m2_attempted = owners.get("MODEL2_ANCHOR_OWNER_EXECUTED")
    dom_attempted = diag.get("DOMAIN_OWNER_ATTEMPTED")
    if dom_attempted is None:
        dom_attempted = owners.get("DOMAIN_ANCHOR_OWNER_EXECUTED")

    # Formal path requires owners to have been attempted when wired.
    if m2_wired and not m2_attempted:
        return {
            "code": "ANCHOR_MATERIALIZATION_BLOCKED",
            "kind": "HARD_REJECT",
            "identityFailed": "Model2 owner not attempted",
        }
    if dom_wired and not dom_attempted:
        return {
            "code": "ANCHOR_MATERIALIZATION_BLOCKED",
            "kind": "HARD_REJECT",
            "identityFailed": "Domain owner not attempted",
        }
    return None


def classify_supervised_outcome(
    labeled_paths: list[dict],
) -> dict[str, Any]:
    """Distinguish supervised KEEP/RETRY vs SEMANTIC_EXCLUDE (no repairable target)."""
    keep = retry = exclude = masked = 0
    for path in labeled_paths:
        for sp in path.get("spans") or []:
            lab = sp.get("label")
            if lab == "KEEP":
                keep += 1
            elif lab == "RETRY":
                retry += 1
            elif lab in ("MASKED",):
                masked += 1
            elif lab in ("EXCLUDE_FROM_SUPERVISED", "EXCLUDE"):
                exclude += 1
    if keep == 0 and retry == 0 and (exclude > 0 or masked >= 0):
        # Valid materialization but no KEEP/RETRY supervised targets
        if keep == 0 and retry == 0:
            return {
                "kind": "SEMANTIC_EXCLUDE",
                "code": "NO_REPAIRABLE_TARGET",
                "counts": {"KEEP": keep, "RETRY": retry, "EXCLUDE": exclude, "MASKED": masked},
            }
    return {
        "kind": "SUPERVISED_ACCEPTED" if (keep + retry) > 0 else "SEMANTIC_EXCLUDE",
        "code": None if (keep + retry) > 0 else "NO_REPAIRABLE_TARGET",
        "counts": {"KEEP": keep, "RETRY": retry, "EXCLUDE": exclude, "MASKED": masked},
    }
