# -*- coding: utf-8 -*-
"""Hard validators for ERROR_TEXT_SAMPLE_V1 pilot records."""

from __future__ import annotations

import re
from typing import Any

from training.model2.pronunciation.syllable_substitution import apply_family_to_syllable

from training.model3_error_text.generator.corrupt import apply_corruptions
from training.model3_error_text.generator.families import ACTIVE_FAMILIES_V1
from training.model3_error_text.generator.lexicon_resolve import LexiconSurfaceResolver

_KNOWN_FAMILIES = set(ACTIVE_FAMILIES_V1) | {"ORTHOGRAPHIC_DE_DI_DE"}


def validate_sample(sample: dict[str, Any], resolver: LexiconSurfaceResolver) -> list[str]:
    errs: list[str] = []
    required = [
        "sampleId",
        "generatorVersion",
        "generationSeed",
        "sourceCorpus",
        "sourceSentenceId",
        "referenceText",
        "errorText",
        "corruptionCount",
        "corruptions",
        "evidenceLevel",
        "splitGroupKey",
    ]
    for k in required:
        if k not in sample:
            errs.append(f"missing:{k}")
    if sample.get("evidenceLevel") != "SYNTHETIC_TEXT":
        errs.append("evidenceLevel")
    if sample.get("sourceCorpus") == "dialog_200":
        errs.append("dialog_200_forbidden")
    ref = sample.get("referenceText") or ""
    err = sample.get("errorText") or ""
    corrs = sample.get("corruptions") or []
    if sample.get("corruptionCount") != len(corrs):
        errs.append("corruptionCount_mismatch")
    if sample.get("corruptionCount", 0) > 2:
        errs.append("corruptionCount_gt_2")
    if sample.get("corruptionCount") == 0:
        if ref != err:
            errs.append("clean_text_mismatch")
        if corrs:
            errs.append("clean_has_corruptions")
    else:
        try:
            rebuilt = apply_corruptions(ref, corrs)
            if rebuilt != err:
                errs.append("offset_replay_fail")
        except Exception as e:
            errs.append(f"offset_apply:{e}")
    for c in corrs:
        errs.extend(_validate_corruption(c, resolver))
    if re.search(r"[\ud800-\udfff]", ref + err):
        errs.append("broken_surrogate")
    return errs


def _validate_corruption(c: dict, resolver: LexiconSurfaceResolver) -> list[str]:
    errs: list[str] = []
    for k in (
        "spanStart",
        "spanEnd",
        "referenceSurface",
        "errorSurface",
        "corruptionFamily",
        "sourcePinyin",
        "sourceTone",
        "targetPinyin",
        "targetTone",
        "replacementSource",
        "isPhonetic",
        "isPolyphonic",
        "generationReason",
    ):
        if k not in c:
            errs.append(f"corr_missing:{k}")
    if c.get("referenceSurface") == c.get("errorSurface"):
        errs.append("same_surface")
    fam = c.get("corruptionFamily")
    if fam not in _KNOWN_FAMILIES:
        errs.append(f"unknown_family:{fam}")
    if c.get("isPhonetic"):
        if fam not in ACTIVE_FAMILIES_V1:
            errs.append("phonetic_family_not_active")
        replay = apply_family_to_syllable(c.get("sourceTone") or "", fam or "")
        if replay is None or LexiconSurfaceResolver.strip_tone(replay) != c.get("targetPinyin"):
            # allow tone digit match on full key
            if replay != c.get("targetTone"):
                errs.append("phonetic_replay_fail")
        if c.get("replacementSource") != "BASE_LEXICON":
            errs.append("lexicon_provenance")
        # error surface must exist under target tone key
        hits = resolver.lookup_len1_by_tone_key(c.get("targetTone") or "")
        if not any(w == c.get("errorSurface") for w, _, _ in hits):
            errs.append("error_surface_not_in_lexicon")
    else:
        if fam != "ORTHOGRAPHIC_DE_DI_DE":
            errs.append("non_phonetic_family")
        if c.get("isPhonetic") is not False:
            errs.append("isPhonetic_flag")
    return errs
