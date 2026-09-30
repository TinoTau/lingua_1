# -*- coding: utf-8 -*-
"""Reuse Model2 BOUND / ACTIVE_SET_V1 — do not redefine families."""

from __future__ import annotations

from training.model2.stage_b.active_feature_mask import BOUND_FEATURES_V1

# Authoritative V1 pilot families (= ACTIVE_SET_V1 / BOUND_FEATURES_V1)
ACTIVE_FAMILIES_V1: tuple[str, ...] = tuple(BOUND_FEATURES_V1)

assert ACTIVE_FAMILIES_V1 == (
    "n_l",
    "z_zh",
    "ch_c",
    "sh_s",
    "eng_en",
    "in_ing",
    "h_f",
)
