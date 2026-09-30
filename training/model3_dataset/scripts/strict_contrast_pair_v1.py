# -*- coding: utf-8 -*-
"""STRICT_ANCHOR_CONTRAST_PAIR_V1 — training-data construction contract + validator.

Not a runtime contract. Formal Anchors remain DOMAIN / MODEL2 / DOMAIN_AND_MODEL2.
"""
from __future__ import annotations

from copy import deepcopy
from typing import Any

from training.model3_dataset.train.bigru_v1 import FEAT_NAMES, sample_to_tensors

CONTRACT_ID = "STRICT_ANCHOR_CONTRAST_PAIR_V1"
CONTRACT_VERSION = "1.0.0"

# Strength taxonomy (training-only classification)
STRICT = "STRICT_ANCHOR_CONTRAST"
SEMANTIC = "SEMANTIC_CONTRAST"
WEAK = "WEAK_CONTRAST"
INVALID = "INVALID_CONTRAST"


def force_anchor_on_surface(spans: list[dict], anchor_surface: str, current_text: str = "") -> list[str]:
    for s in spans:
        s["isAnchor"] = False
        s["anchorSource"] = "NONE"
    if not anchor_surface:
        return []
    text = current_text or ""
    pos = text.find(anchor_surface)
    if pos < 0:
        for s in spans:
            if s.get("surface") == anchor_surface:
                s["isAnchor"] = True
                s["anchorSource"] = "DOMAIN"
                return [s["spanId"]]
        return []
    end = pos + len(anchor_surface)
    best = None
    best_ov = 0
    for s in spans:
        a, b = int(s["rawStart"]), int(s["rawEnd"])
        ov = max(0, min(b, end) - max(a, pos))
        if ov > best_ov:
            best_ov = ov
            best = s
    if best and best_ov > 0:
        best["isAnchor"] = True
        best["anchorSource"] = "DOMAIN"
        return [best["spanId"]]
    return []


def find_target_span(sample: dict, target: str, want: str | None = None) -> tuple[int | None, dict | None]:
    for i, sp in enumerate(sample.get("spans") or []):
        if sp.get("targetMask") != 1:
            continue
        if want and sp.get("label") != want:
            continue
        if target and sp.get("surface") != target:
            continue
        return i, sp
    return None, None


def non_anchor_surfaces(sample: dict) -> list[str]:
    out = []
    for sp in sample.get("spans") or []:
        if sp.get("isAnchor"):
            continue
        out.append(sp.get("surface") or "")
    return out


def zero_anchor_feats(feats_row: list[float]) -> list[float]:
    row = list(feats_row)
    # isAnchor is index 0
    row[0] = 0.0
    return row


def validate_strict_anchor_contrast_pair_v1(
    keep_sample: dict,
    retry_sample: dict,
    *,
    target_surface: str,
    vocab: dict[str, int] | None = None,
    require_tensor: bool = True,
) -> dict[str, Any]:
    """Hard validator. Any fail → reject from STRICT bucket."""
    reasons: list[str] = []
    k_text = keep_sample.get("currentText") or ""
    r_text = retry_sample.get("currentText") or ""
    if k_text != r_text:
        reasons.append("currentText_mismatch")
    if not target_surface:
        reasons.append("missing_target")

    ki, ksp = find_target_span(keep_sample, target_surface, "KEEP")
    ri, rsp = find_target_span(retry_sample, target_surface, "RETRY")
    if ksp is None:
        reasons.append("keep_target_missing")
    if rsp is None:
        reasons.append("retry_target_missing")

    if ksp and rsp:
        if (ksp.get("surface") or "") != (rsp.get("surface") or ""):
            reasons.append("target_surface_mismatch")
        if int(ksp.get("rawStart", -1)) != int(rsp.get("rawStart", -2)):
            reasons.append("target_offset_mismatch")
        if int(ksp.get("rawEnd", -1)) != int(rsp.get("rawEnd", -2)):
            reasons.append("target_end_mismatch")
        kp = ksp.get("pinyinEvidence") or ksp.get("pinyin")
        rp = rsp.get("pinyinEvidence") or rsp.get("pinyin")
        if kp is not None and rp is not None and kp != rp:
            reasons.append("target_pinyin_mismatch")
        if (ksp.get("rawEnd", 0) - ksp.get("rawStart", 0)) != (rsp.get("rawEnd", 0) - rsp.get("rawStart", 0)):
            reasons.append("target_span_len_mismatch")
        reach = (rsp.get("repairability") or {}).get("referenceReachable")
        if reach != "YES":
            reasons.append("retry_not_reachable")
        if rsp.get("isAnchor"):
            reasons.append("retry_target_is_anchor")
        if ksp.get("isAnchor"):
            reasons.append("keep_target_is_anchor")

    k_spans = keep_sample.get("spans") or []
    r_spans = retry_sample.get("spans") or []
    if len(k_spans) != len(r_spans):
        reasons.append("sequence_len_mismatch")
    else:
        for i, (a, b) in enumerate(zip(k_spans, r_spans)):
            if (a.get("surface") or "") != (b.get("surface") or ""):
                reasons.append(f"span_surface_mismatch@{i}")
                break
            if int(a.get("rawStart", -1)) != int(b.get("rawStart", -2)) or int(a.get("rawEnd", -1)) != int(
                b.get("rawEnd", -2)
            ):
                reasons.append(f"span_offset_mismatch@{i}")
                break

    # Full span surface/offset identity already checked above.
    # Do NOT compare non-anchor-only surface lists: different Anchor placement
    # removes different spans from that list by construction.

    k_anch = [(i, sp.get("surface")) for i, sp in enumerate(k_spans) if sp.get("isAnchor")]
    r_anch = [(i, sp.get("surface")) for i, sp in enumerate(r_spans) if sp.get("isAnchor")]
    if not k_anch or not r_anch:
        reasons.append("anchor_missing")
    elif {a[1] for a in k_anch} == {a[1] for a in r_anch} and {a[0] for a in k_anch} == {a[0] for a in r_anch}:
        reasons.append("anchor_identical")
    # Anchor must not equal target
    if any(surf == target_surface for _, surf in k_anch + r_anch):
        reasons.append("anchor_equals_target")

    # Anchor RETRY forbidden
    for sp in k_spans + r_spans:
        if sp.get("isAnchor") and sp.get("label") == "RETRY":
            reasons.append("anchor_retry")
            break

    tensor_identical = None
    if require_tensor and vocab is not None and not reasons and ki is not None and ri is not None:
        tk = sample_to_tensors(keep_sample, vocab)
        tr = sample_to_tensors(retry_sample, vocab)
        if len(tk["tokens"]) != len(tr["tokens"]):
            reasons.append("tensor_seq_len_mismatch")
        else:
            diffs = []
            for i in range(len(tk["feats"])):
                fk = zero_anchor_feats(tk["feats"][i])
                fr = zero_anchor_feats(tr["feats"][i])
                if fk != fr:
                    diffs.append(f"feat@{i}")
                if tk["tokens"][i] != tr["tokens"][i]:
                    diffs.append(f"tok@{i}")
            tensor_identical = len(diffs) == 0
            if not tensor_identical:
                reasons.append("anchor_removed_tensor_diff:" + ",".join(diffs[:6]))

    ok = len(reasons) == 0
    return {
        "ok": ok,
        "contract": CONTRACT_ID,
        "reasons": reasons,
        "reject_code": None if ok else "STRICT_REJECT",
        "anchor_removed_tensor_identical": tensor_identical if tensor_identical is not None else (ok and not require_tensor),
        "keep_span_i": ki,
        "retry_span_i": ri,
        "feat_names": list(FEAT_NAMES),
    }


def materialize_keep_clone_from_retry(
    mat_retry: dict,
    *,
    target_surface: str,
    anchor_keep: str,
    harness_id: str,
) -> dict:
    """Reuse RETRY FineSpan geometry once; apply KEEP label-side + keep-side Anchor.

    Does not re-run production FineSpan. Preserves model-visible non-anchor channels.
    """
    mat = deepcopy(mat_retry)
    mat["id"] = harness_id
    mat["referenceText"] = mat.get("currentText") or ""
    cur = mat.get("currentText") or ""
    for s in mat.get("spans") or []:
        s["isAnchor"] = False
        s["anchorSource"] = "NONE"
        if s.get("surface") == target_surface:
            # label-side KEEP interpretation (supervision only; not model-visible)
            s["referenceSurface"] = s.get("surface")
            # leave recallEvidence / pinyinEvidence / offsets untouched
    ids = force_anchor_on_surface(mat.get("spans") or [], anchor_keep, cur)
    mat["_simulatedAnchorSpanIds"] = ids
    return mat


def apply_retry_anchor(mat_retry: dict, anchor_retry: str) -> dict:
    mat = deepcopy(mat_retry)
    cur = mat.get("currentText") or ""
    for s in mat.get("spans") or []:
        s["isAnchor"] = False
        s["anchorSource"] = "NONE"
    ids = force_anchor_on_surface(mat.get("spans") or [], anchor_retry, cur)
    mat["_simulatedAnchorSpanIds"] = ids
    return mat
