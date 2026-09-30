"""Phase 6C active phonetic supervision mask (BOUND-only primary)."""

from __future__ import annotations

from training.model2.contract import PHONETIC_DIM, PHONETIC_FEATURE_INDEX_V1, PHONETIC_FEATURE_KEYS

# From Phase 6B binding_quality (ranking-based labels)
BOUND_FEATURES_V1: tuple[str, ...] = (
    "n_l",
    "z_zh",
    "ch_c",
    "sh_s",
    "eng_en",
    "in_ing",
    "h_f",
)

WEAK_FEATURES_V1: tuple[str, ...] = (
    "s_sh",
    "en_eng",
)

REVERSED_FEATURES_V1: tuple[str, ...] = (
    "l_n",
    "zh_z",
    "c_ch",
    "an_ang",
    "ang_an",
    "ing_in",
    "f_h",
)


def active_mask_bound_only() -> list[int]:
    m = [0] * PHONETIC_DIM
    for f in BOUND_FEATURES_V1:
        m[PHONETIC_FEATURE_INDEX_V1[f]] = 1
    return m


def active_mask_bound_plus_weak() -> list[int]:
    m = active_mask_bound_only()
    for f in WEAK_FEATURES_V1:
        m[PHONETIC_FEATURE_INDEX_V1[f]] = 1
    return m


def intersect_with_schema_mask(active: list[int], schema_mask: list[int]) -> list[int]:
    return [int(a and s) for a, s in zip(active, schema_mask)]


def feature_policy_table() -> dict:
    return {
        "BOUND": list(BOUND_FEATURES_V1),
        "WEAK": list(WEAK_FEATURES_V1),
        "REVERSED": list(REVERSED_FEATURES_V1),
        "schema_keys": list(PHONETIC_FEATURE_KEYS),
        "note": "Runtime schema stays 16D; Phase6C primary trains BOUND only.",
    }
