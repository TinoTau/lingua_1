# -*- coding: utf-8 -*-
"""LINGUA_DIALOG2000_V2_PILOT200 Block A — Pilot Dataset Builder (offline tooling)."""

from __future__ import annotations

GENERATOR_VERSION = "pilot200-builder-v1.1-freeze-correction"
DATASET_ID = "LINGUA_DIALOG2000_V2_PILOT200"
DATASET_VERSION = "V1"
MASTER_SEED = 20260911
ACTIVE_RELATIONS = ("n_l", "z_zh", "ch_c", "sh_s", "eng_en", "in_ing", "h_f")
DEFERRED_RELATIONS = ("tone", "elision", "connected_speech")

USER_ASSIGNMENTS = {
    "U001": {"n_l": "moderate", "in_ing": "mild"},
    "U002": {"z_zh": "strong", "sh_s": "moderate"},
    "U003": {"eng_en": "strong", "h_f": "mild"},
    "U004": {"ch_c": "moderate", "n_l": "mild"},
    "U005": {"sh_s": "mild"},
}

STRENGTH_TO_WEIGHT = {"mild": 0.40, "moderate": 0.70, "strong": 1.00}
STRENGTH_TO_SEVERITY = {
    "mild": "MILD",
    "moderate": "MODERATE",
    "strong": "MODERATE",  # STRONG reserved for rare optional cases
}

DOMAINS = (
    "general_daily",
    "software_meeting",
    "travel_hotel",
    "food_cafe",
    "medical",
    "retail_service",
)

TTS_URL = "http://127.0.0.1:5009"
TTS_VOICE = "zh_CN-huayan-medium"
SPEAKER_ID = "piper_huayan_medium_01"
TARGET_SR = 16000

FORBIDDEN_CASE_FIELDS = (
    "expectedWrongAsrText",
    "expectedReplacement",
    "expectedFinalText",
    "knownAnswerMap",
    "lexiconPatch",
)
