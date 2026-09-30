# -*- coding: utf-8 -*-
"""Phonetic corruption using existing syllable_substitution + ACTIVE families."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

from training.model2.phonetic.syllables import (
    PHONETIC_IMPL_NODE,
    active_phonetic_impl,
    syllables_from_text_tone_num,
)
from training.model2.pronunciation.syllable_substitution import apply_family_to_syllable

from training.model3_error_text.generator.families import ACTIVE_FAMILIES_V1
from training.model3_error_text.generator.lexicon_resolve import LexiconSurfaceResolver

_CJK = re.compile(r"[\u4e00-\u9fff\u3400-\u4dbf]")
_ORTHO = {"的": "地", "地": "得", "得": "的"}


@dataclass
class CharAnno:
    index: int
    surface: str
    source_tone: str  # e.g. rang4
    source_plain: str
    skip_reason: Optional[str] = None


def annotate_sentence(text: str) -> tuple[list[CharAnno], str, dict]:
    """Align CJK chars to Node tone syllables. Skip if counts mismatch."""
    impl = active_phonetic_impl()
    cjk_idxs = [i for i, ch in enumerate(text) if _CJK.match(ch)]
    if not cjk_idxs:
        return [], impl, {"skip": "no_cjk"}
    cjk_text = "".join(text[i] for i in cjk_idxs)
    tones = syllables_from_text_tone_num(cjk_text)
    if impl != PHONETIC_IMPL_NODE:
        # Contract forbids pypinyin authority — treat as unresolved for corruption
        return [], impl, {"skip": "pinyin_ssot_not_node", "impl": impl}
    if len(tones) != len(cjk_idxs):
        return [], impl, {
            "skip": "polyphonic_or_align_mismatch",
            "n_chars": len(cjk_idxs),
            "n_tones": len(tones),
        }
    annos: list[CharAnno] = []
    for i, ch_i in enumerate(cjk_idxs):
        toned = tones[i]
        plain = LexiconSurfaceResolver.strip_tone(toned)
        if not plain or not re.search(r"[0-5]$", toned):
            annos.append(
                CharAnno(ch_i, text[ch_i], toned, plain, skip_reason="missing_tone_digit")
            )
        else:
            annos.append(CharAnno(ch_i, text[ch_i], toned, plain, skip_reason=None))
    return annos, impl, {"ok": True}


def try_phonetic_corruption(
    text: str,
    anno: CharAnno,
    family: str,
    resolver: LexiconSurfaceResolver,
) -> Optional[dict]:
    if family not in ACTIVE_FAMILIES_V1:
        return None
    if anno.skip_reason:
        return None
    corrupted = apply_family_to_syllable(anno.source_tone, family)
    if corrupted is None or corrupted == anno.source_tone:
        return None
    pick = resolver.pick_replacement(corrupted, exclude={anno.surface})
    if not pick:
        return None
    if pick["surface"] == anno.surface:
        return None
    return {
        "spanStart": anno.index,
        "spanEnd": anno.index + 1,
        "referenceSurface": anno.surface,
        "errorSurface": pick["surface"],
        "corruptionFamily": family,
        "sourcePinyin": anno.source_plain,
        "sourceTone": anno.source_tone,
        "targetPinyin": LexiconSurfaceResolver.strip_tone(corrupted),
        "targetTone": corrupted,
        "replacementSource": pick["replacementSource"],
        "isPhonetic": True,
        "isPolyphonic": False,
        "generationReason": f"ACTIVE_SET_V1/{family} via syllable_substitution.apply_family_to_syllable",
        "candidate_count": pick["candidate_count"],
        "selection_provenance": pick["selection_provenance"],
    }


def try_orthographic_de_di_de(text: str, anno: CharAnno) -> Optional[dict]:
    if anno.surface not in _ORTHO:
        return None
    err = _ORTHO[anno.surface]
    return {
        "spanStart": anno.index,
        "spanEnd": anno.index + 1,
        "referenceSurface": anno.surface,
        "errorSurface": err,
        "corruptionFamily": "ORTHOGRAPHIC_DE_DI_DE",
        "sourcePinyin": anno.source_plain or "",
        "sourceTone": anno.source_tone or "",
        "targetPinyin": anno.source_plain or "",
        "targetTone": anno.source_tone or "",
        "replacementSource": "NONE",
        "isPhonetic": False,
        "isPolyphonic": False,
        "generationReason": "orthographic_function_word_swap_research_negative",
        "candidate_count": 1,
        "selection_provenance": "fixed_ortho_map",
    }


def apply_corruptions(reference: str, corruptions: list[dict]) -> str:
    chars = list(reference)
    for c in sorted(corruptions, key=lambda x: x["spanStart"], reverse=True):
        s, e = c["spanStart"], c["spanEnd"]
        if "".join(chars[s:e]) != c["referenceSurface"]:
            raise ValueError("offset_mismatch")
        chars[s:e] = list(c["errorSurface"])
    return "".join(chars)


def reference_reachable(
    resolver: LexiconSurfaceResolver,
    corruption: dict,
) -> str:
    """Prep field only — not Model3 KEEP/RETRY."""
    if not corruption.get("isPhonetic"):
        return "UNKNOWN"
    ref = corruption["referenceSurface"]
    src_tone = corruption["sourceTone"]
    if resolver.has_surface_len1(ref, src_tone):
        return "YES"
    # plain bucket fallback
    plain = corruption["sourcePinyin"]
    rows = resolver.lookup_len1_by_plain(plain)
    if any(w == ref for w, _, _ in rows):
        return "YES"
    if rows:
        return "NO"
    return "UNKNOWN"
