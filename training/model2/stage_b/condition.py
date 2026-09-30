"""Stage B phonetic condition contracts and profile variants."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

from training.model2.contract import (
    PHONETIC_DIM,
    PHONETIC_FEATURE_INDEX_V1,
    PHONETIC_FEATURE_KEYS,
    TONE_DIM,
    DOMAIN_DIM,
)

# Re-export stable index
assert PHONETIC_FEATURE_INDEX_V1["n_l"] == 0

STRENGTH_TO_PROB: dict[str, float] = {
    "NONE": 0.0,
    "LOW": 0.2,
    "MEDIUM": 0.5,
    "HIGH": 0.8,
}

OPPOSITE_DIRECTION: dict[str, str] = {
    "n_l": "l_n",
    "l_n": "n_l",
    "zh_z": "z_zh",
    "z_zh": "zh_z",
    "ch_c": "c_ch",
    "c_ch": "ch_c",
    "sh_s": "s_sh",
    "s_sh": "sh_s",
    "an_ang": "ang_an",
    "ang_an": "an_ang",
    "en_eng": "eng_en",
    "eng_en": "en_eng",
    "in_ing": "ing_in",
    "ing_in": "in_ing",
    "f_h": "h_f",
    "h_f": "f_h",
}

FIDELITY_WEIGHT: dict[str, float] = {
    "GOOD": 1.0,
    "USABLE": 0.8,
    "WEAK": 0.0,
    "UNUSABLE": 0.0,
}


def strength_to_prob(strength: Optional[str]) -> float:
    if not strength:
        return 0.0
    return float(STRENGTH_TO_PROB.get(str(strength).upper(), 0.0))


def fidelity_supervision_weight(fidelity: str, *, base_realization: float = 1.0) -> float:
    """Bounded loss weight — not a runtime UserProfile feature."""
    w = FIDELITY_WEIGHT.get(fidelity, 0.0)
    if w <= 0:
        return 0.0
    # Softly down-weight very weak realization (e.g. ing_in ~0.235)
    if base_realization < 0.35:
        w = min(w, 0.55)
    elif base_realization < 0.5:
        w = min(w, 0.85)
    return float(max(0.0, min(1.0, w)))


def load_fidelity_weights(path: Path) -> dict[str, float]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    out: dict[str, float] = {}
    for fam in PHONETIC_FEATURE_KEYS:
        m = raw.get(fam) or {}
        out[fam] = fidelity_supervision_weight(
            str(m.get("fidelity") or "UNUSABLE"),
            base_realization=float(m.get("base_realization_rate") or 0.0),
        )
    return out


def load_trainable_mask(matrix_path: Path) -> list[int]:
    """phonetic_mask defaults from condition_supervision_matrix (tone/domain stay 0)."""
    data = json.loads(matrix_path.read_text(encoding="utf-8"))
    by_cond = {row["condition"]: row for row in data.get("matrix") or []}
    mask = [0] * PHONETIC_DIM
    for i, key in enumerate(PHONETIC_FEATURE_KEYS):
        row = by_cond.get(key) or {}
        if row.get("reliable_supervision") and int(row.get("mask_default") or 0) == 1:
            mask[i] = 1
    return mask


def empty_phonetic() -> tuple[list[float], list[int]]:
    return [0.0] * PHONETIC_DIM, [0] * PHONETIC_DIM


def profile_vectors_from_bias(
    phonetic_bias: Optional[dict[str, float]],
    *,
    trainable_mask: list[int],
    mode: str = "correct",
) -> dict[str, Any]:
    """
    mode:
      correct | neutral | unavailable | relevant_only | wrong_irrelevant | wrong_opposite
    """
    bias = dict(phonetic_bias or {})
    cond = [0.0] * PHONETIC_DIM
    mask = [0] * PHONETIC_DIM
    tone_c = [0.0] * TONE_DIM
    tone_m = [0] * TONE_DIM
    dom_c = [0.0] * DOMAIN_DIM
    dom_m = [0] * DOMAIN_DIM

    if mode == "unavailable":
        # PROFILE_UNAVAILABLE — no personalization available
        return {
            "phonetic_condition": cond,
            "phonetic_mask": mask,
            "tone_condition": tone_c,
            "tone_mask": tone_m,
            "domain_prior": dom_c,
            "domain_mask": dom_m,
            "profile_available": 0,
            "phonetic_profile_acoustically_realized": 0,
            "profile_mode": mode,
        }

    if mode == "neutral":
        # PROFILE_NEUTRAL — known NONE (mask=1, value=0)
        mask = list(trainable_mask)
        return {
            "phonetic_condition": cond,
            "phonetic_mask": mask,
            "tone_condition": tone_c,
            "tone_mask": tone_m,
            "domain_prior": dom_c,
            "domain_mask": dom_m,
            "profile_available": 1,
            "phonetic_profile_acoustically_realized": 1,
            "profile_mode": mode,
        }

    # Fill from bias using stable index
    for key, val in bias.items():
        if key not in PHONETIC_FEATURE_INDEX_V1:
            continue
        i = PHONETIC_FEATURE_INDEX_V1[key]
        cond[i] = float(val)

    if mode == "correct":
        mask = list(trainable_mask)
    elif mode == "relevant_only":
        # caller should zero others — kept for ablation API
        mask = list(trainable_mask)
    else:
        mask = list(trainable_mask)

    return {
        "phonetic_condition": cond,
        "phonetic_mask": mask,
        "tone_condition": tone_c,
        "tone_mask": tone_m,
        "domain_prior": dom_c,
        "domain_mask": dom_m,
        "profile_available": 1,
        "phonetic_profile_acoustically_realized": 1,
        "profile_mode": mode,
    }


def make_wrong_profiles(
    phonetic_bias: dict[str, float],
    *,
    family: Optional[str],
    trainable_mask: list[int],
    other_user_bias: Optional[dict[str, float]] = None,
    strength: float = 0.8,
) -> dict[str, dict[str, Any]]:
    """WP1 irrelevant / WP2 opposite / WP3 other user."""
    out: dict[str, dict[str, Any]] = {}
    fam = family if family in PHONETIC_FEATURE_INDEX_V1 else None

    # WP1 — single irrelevant HIGH
    irr_key = "zh_z"
    if fam:
        for k in PHONETIC_FEATURE_KEYS:
            if k != fam and k != OPPOSITE_DIRECTION.get(fam):
                irr_key = k
                break
    wp1_bias = {irr_key: strength}
    out["wp_irrelevant"] = profile_vectors_from_bias(wp1_bias, trainable_mask=trainable_mask)

    # WP2 — opposite direction
    if fam and fam in OPPOSITE_DIRECTION:
        wp2_bias = {OPPOSITE_DIRECTION[fam]: strength}
    else:
        wp2_bias = {"l_n": strength}
    out["wp_opposite"] = profile_vectors_from_bias(wp2_bias, trainable_mask=trainable_mask)

    # WP3 — another user
    out["wp_other_user"] = profile_vectors_from_bias(
        other_user_bias or {"sh_s": strength, "en_eng": 0.5},
        trainable_mask=trainable_mask,
    )
    return out


def apply_profile_to_row(row: dict[str, Any], profile: dict[str, Any]) -> dict[str, Any]:
    r = dict(row)
    for k in (
        "phonetic_condition",
        "phonetic_mask",
        "tone_condition",
        "tone_mask",
        "domain_prior",
        "domain_mask",
        "profile_available",
        "phonetic_profile_acoustically_realized",
    ):
        if k in profile:
            r[k] = profile[k]
    r["profile_mode"] = profile.get("profile_mode")
    return r


def relevant_only_profile(
    phonetic_bias: dict[str, float],
    family: str,
    trainable_mask: list[int],
) -> dict[str, Any]:
    bias = {}
    if family in phonetic_bias:
        bias[family] = float(phonetic_bias[family])
    elif family in PHONETIC_FEATURE_INDEX_V1:
        # fall back to max non-zero if family missing
        bias[family] = max((float(v) for v in phonetic_bias.values()), default=0.8) or 0.8
    p = profile_vectors_from_bias(bias, trainable_mask=trainable_mask, mode="relevant_only")
    # mask only the relevant slot among trainable
    mask = [0] * PHONETIC_DIM
    if family in PHONETIC_FEATURE_INDEX_V1 and trainable_mask[PHONETIC_FEATURE_INDEX_V1[family]]:
        mask[PHONETIC_FEATURE_INDEX_V1[family]] = 1
    p["phonetic_mask"] = mask
    return p
