"""Unified PronunciationRealizer — Surface first, then Phoneme."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

from training.model2.pronunciation.phoneme_realizer import PhonemeRealization, PhonemeRealizer
from training.model2.pronunciation.pronunciation_syllable import (
    LEXICAL_STATUS_LEXICAL,
    LEXICAL_STATUS_NON_LEXICAL,
    PronunciationSyllable,
)
from training.model2.pronunciation.surface_realizer import ChineseSurfaceRealizer, SurfaceRealization
from training.model2.pronunciation.transform_engine import PronunciationTransformEngineV1

REALIZER_VERSION = "pronunciation-realizer-v1"


@dataclass
class RealizationPlan:
    ground_truth_text: str
    ground_truth_term: str
    tts_input_text: str  # surface path only; phoneme path may equal GT for text field
    backend: str  # CHINESE_SURFACE | PHONEME | UNREALIZABLE
    family: str
    canonical_syllables: list[PronunciationSyllable]
    corrupted_syllables: list[PronunciationSyllable]
    corrupted_positions: list[int]
    surface: SurfaceRealization | None = None
    phonemes: list[str] = field(default_factory=list)
    phoneme_result: PhonemeRealization | None = None
    lexical_corrupted: bool = True
    notes: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "ground_truth_text": self.ground_truth_text,
            "ground_truth_term": self.ground_truth_term,
            "tts_input_text": self.tts_input_text,
            "backend": self.backend,
            "family": self.family,
            "canonical_syllables": [s.to_dict() for s in self.canonical_syllables],
            "corrupted_syllables": [s.to_dict() for s in self.corrupted_syllables],
            "corrupted_positions": self.corrupted_positions,
            "surface": self.surface.to_dict() if self.surface else None,
            "phonemes": self.phonemes,
            "phoneme_result": self.phoneme_result.to_dict() if self.phoneme_result else None,
            "lexical_corrupted": self.lexical_corrupted,
            "notes": self.notes,
            "realizer_version": REALIZER_VERSION,
        }


class PronunciationRealizer:
    def __init__(
        self,
        surface: ChineseSurfaceRealizer | None = None,
        phoneme: PhonemeRealizer | None = None,
        engine: PronunciationTransformEngineV1 | None = None,
    ):
        self.surface = surface or ChineseSurfaceRealizer()
        self.phoneme = phoneme or PhonemeRealizer()
        self.engine = engine or PronunciationTransformEngineV1()

    def realize_term_corruption(
        self,
        *,
        ground_truth_text: str,
        ground_truth_term: str,
        family: str,
        canonical_syllables: list[PronunciationSyllable],
        apply_mask: list[bool],
        force_phoneme: bool = False,
    ) -> RealizationPlan:
        corrupted, idxs, _ = self.engine.transform_sequence(
            canonical_syllables, family, apply_mask=apply_mask
        )
        if not idxs:
            return RealizationPlan(
                ground_truth_text=ground_truth_text,
                ground_truth_term=ground_truth_term,
                tts_input_text=ground_truth_text,
                backend="UNREALIZABLE",
                family=family,
                canonical_syllables=canonical_syllables,
                corrupted_syllables=corrupted,
                corrupted_positions=[],
                notes="NO_APPLICABLE_POSITION",
            )

        # Try surface for each corrupted position if lengths match chars
        chars = list(ground_truth_term)
        surface_ok = (not force_phoneme) and len(chars) == len(corrupted)
        surface_chars: list[str] = []
        last_surface: SurfaceRealization | None = None
        if surface_ok:
            for i, syl in enumerate(corrupted):
                if i not in idxs:
                    surface_chars.append(chars[i])
                    continue
                sr = self.surface.realize(syl)
                last_surface = sr
                if not sr.ok:
                    surface_ok = False
                    break
                # mark lexical if surface found
                corrupted[i] = PronunciationSyllable(
                    initial=syl.initial,
                    final=syl.final,
                    tone=syl.tone,
                    lexical_status=LEXICAL_STATUS_LEXICAL,
                )
                surface_chars.append(sr.surface)

        lexical = True
        if surface_ok and surface_chars:
            tts_surface = "".join(surface_chars)
            tts_input = ground_truth_text.replace(ground_truth_term, tts_surface, 1)
            return RealizationPlan(
                ground_truth_text=ground_truth_text,
                ground_truth_term=ground_truth_term,
                tts_input_text=tts_input,
                backend="CHINESE_SURFACE",
                family=family,
                canonical_syllables=canonical_syllables,
                corrupted_syllables=corrupted,
                corrupted_positions=idxs,
                surface=last_surface,
                lexical_corrupted=True,
                notes="surface_backend",
            )

        # Phoneme backend — non-lexical allowed
        for i in idxs:
            corrupted[i] = PronunciationSyllable(
                initial=corrupted[i].initial,
                final=corrupted[i].final,
                tone=corrupted[i].tone,
                lexical_status=LEXICAL_STATUS_NON_LEXICAL,
            )
            lexical = False
        phonemes = self.phoneme.build_sentence_phonemes(
            ground_truth_text=ground_truth_text,
            ground_truth_term=ground_truth_term,
            canonical_syllables=canonical_syllables,
            corrupted_syllables=corrupted,
            family=family,
            corrupted_positions=idxs,
        )
        pr = self.phoneme.synthesize_phonemes(phonemes)
        if not pr.ok:
            return RealizationPlan(
                ground_truth_text=ground_truth_text,
                ground_truth_term=ground_truth_term,
                tts_input_text=ground_truth_text,
                backend="UNREALIZABLE",
                family=family,
                canonical_syllables=canonical_syllables,
                corrupted_syllables=corrupted,
                corrupted_positions=idxs,
                surface=last_surface,
                phonemes=phonemes,
                phoneme_result=pr,
                lexical_corrupted=lexical,
                notes="UNREALIZABLE_BY_CURRENT_BACKEND",
            )
        return RealizationPlan(
            ground_truth_text=ground_truth_text,
            ground_truth_term=ground_truth_term,
            tts_input_text=ground_truth_text,  # text field unchanged; audio from phonemes
            backend="PHONEME",
            family=family,
            canonical_syllables=canonical_syllables,
            corrupted_syllables=corrupted,
            corrupted_positions=idxs,
            surface=last_surface,
            phonemes=phonemes,
            phoneme_result=pr,
            lexical_corrupted=False,
            notes="phoneme_backend",
        )
