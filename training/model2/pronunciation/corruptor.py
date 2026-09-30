"""PronunciationCorruptor V1 — GroundTruth → TTSInputText (before Piper)."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Optional

from training.model2.contract import PHONETIC_FEATURE_KEYS
from training.model2.phonetic.syllables import syllables_from_text_tone_num, text_to_syllables
from training.model2.pronunciation.syllable_substitution import (
    corrupt_syllable_sequence,
    families_applicable_to_term,
)
from training.model2.pronunciation.tts_surface_resolver import (
    TtsPronunciationSurfaceMapV1,
    build_reverse_pinyin_index,
    resolve_sequence,
)

CORRUPTOR_VERSION = "pronunciation-corruptor-v1"


@dataclass
class CorruptionPlan:
    ground_truth_text: str
    ground_truth_term: str
    tts_input_text: str
    corruption_family: str
    target_original_syllables: list[str]
    intended_corrupted_syllables: list[str]
    corrupted_positions: list[int]
    tts_surface: str
    tts_surface_resolution_method: str
    tts_surface_resolver_version: str
    realizable: bool
    unrealizable_reason: str = ""
    corruptor_version: str = CORRUPTOR_VERSION

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class PronunciationCorruptorV1:
    def __init__(self, surface_map: TtsPronunciationSurfaceMapV1 | None = None):
        self.surface_map = surface_map or TtsPronunciationSurfaceMapV1()
        self._rev: dict[str, list[str]] | None = None

    @property
    def rev(self) -> dict[str, list[str]]:
        if self._rev is None:
            self._rev = build_reverse_pinyin_index()
        return self._rev

    def term_syllables(self, term: str, raw_pinyin: Optional[str] = None) -> list[str]:
        # Prefer tone-numbered for corruption; fall back to lexicon raw then plain
        toned = syllables_from_text_tone_num(term)
        if toned:
            # Normalize light tone 0 → keep; corruptor preserves tone digit
            return toned
        from training.model2.phonetic.syllables import parse_raw_pinyin

        raw = parse_raw_pinyin(raw_pinyin)
        if raw:
            return raw
        return text_to_syllables(term)

    def applicable_families(self, term: str, raw_pinyin: Optional[str] = None) -> list[str]:
        return families_applicable_to_term(self.term_syllables(term, raw_pinyin))

    def corrupt(
        self,
        *,
        ground_truth_text: str,
        ground_truth_term: str,
        family: str,
        raw_pinyin: Optional[str] = None,
        max_positions: int = 2,
    ) -> CorruptionPlan:
        if family not in PHONETIC_FEATURE_KEYS:
            return CorruptionPlan(
                ground_truth_text=ground_truth_text,
                ground_truth_term=ground_truth_term,
                tts_input_text=ground_truth_text,
                corruption_family=family,
                target_original_syllables=[],
                intended_corrupted_syllables=[],
                corrupted_positions=[],
                tts_surface="",
                tts_surface_resolution_method="UNSUPPORTED_FOR_PROFILE_V1",
                tts_surface_resolver_version=self.surface_map.version,
                realizable=False,
                unrealizable_reason="UNSUPPORTED_FOR_PROFILE_V1",
            )
        if ground_truth_term not in ground_truth_text:
            return CorruptionPlan(
                ground_truth_text=ground_truth_text,
                ground_truth_term=ground_truth_term,
                tts_input_text=ground_truth_text,
                corruption_family=family,
                target_original_syllables=[],
                intended_corrupted_syllables=[],
                corrupted_positions=[],
                tts_surface="",
                tts_surface_resolution_method="TERM_NOT_IN_GT",
                tts_surface_resolver_version=self.surface_map.version,
                realizable=False,
                unrealizable_reason="TERM_NOT_IN_GT",
            )

        orig = self.term_syllables(ground_truth_term, raw_pinyin)
        corrupted, idxs = corrupt_syllable_sequence(orig, family, max_positions=max_positions)
        if not idxs:
            return CorruptionPlan(
                ground_truth_text=ground_truth_text,
                ground_truth_term=ground_truth_term,
                tts_input_text=ground_truth_text,
                corruption_family=family,
                target_original_syllables=orig,
                intended_corrupted_syllables=orig,
                corrupted_positions=[],
                tts_surface="",
                tts_surface_resolution_method="FAMILY_NOT_APPLICABLE",
                tts_surface_resolver_version=self.surface_map.version,
                realizable=False,
                unrealizable_reason="FAMILY_NOT_APPLICABLE",
            )

        # Resolve only changed syllables into a full-term surface
        # For unchanged positions, prefer original GT chars when lengths match
        gt_chars = list(ground_truth_term)
        if len(gt_chars) == len(corrupted):
            surface_chars: list[str] = []
            missing: list[str] = []
            method = "char_replace"
            for i, syl in enumerate(corrupted):
                if i not in idxs:
                    surface_chars.append(gt_chars[i])
                    continue
                # resolve single corrupted syllable
                one, meth, miss = resolve_sequence(
                    [syl], self.rev, self.surface_map.entries
                )
                if one is None:
                    missing.extend(miss or [syl])
                    break
                surface_chars.append(one)
                if meth != "validated_map":
                    method = meth
            if missing:
                return CorruptionPlan(
                    ground_truth_text=ground_truth_text,
                    ground_truth_term=ground_truth_term,
                    tts_input_text=ground_truth_text,
                    corruption_family=family,
                    target_original_syllables=orig,
                    intended_corrupted_syllables=corrupted,
                    corrupted_positions=idxs,
                    tts_surface="",
                    tts_surface_resolution_method="UNREALIZABLE_BY_CURRENT_TTS",
                    tts_surface_resolver_version=self.surface_map.version,
                    realizable=False,
                    unrealizable_reason=f"missing_surfaces:{','.join(missing)}",
                )
            surface = "".join(surface_chars)
        else:
            surface, method, missing = resolve_sequence(
                corrupted, self.rev, self.surface_map.entries
            )
            if surface is None:
                return CorruptionPlan(
                    ground_truth_text=ground_truth_text,
                    ground_truth_term=ground_truth_term,
                    tts_input_text=ground_truth_text,
                    corruption_family=family,
                    target_original_syllables=orig,
                    intended_corrupted_syllables=corrupted,
                    corrupted_positions=idxs,
                    tts_surface="",
                    tts_surface_resolution_method="UNREALIZABLE_BY_CURRENT_TTS",
                    tts_surface_resolver_version=self.surface_map.version,
                    realizable=False,
                    unrealizable_reason=f"missing_surfaces:{','.join(missing)}",
                )

        # Whole-sentence: replace only the target term occurrence (first)
        tts_input = ground_truth_text.replace(ground_truth_term, surface, 1)
        return CorruptionPlan(
            ground_truth_text=ground_truth_text,
            ground_truth_term=ground_truth_term,
            tts_input_text=tts_input,
            corruption_family=family,
            target_original_syllables=orig,
            intended_corrupted_syllables=corrupted,
            corrupted_positions=idxs,
            tts_surface=surface,
            tts_surface_resolution_method=method,
            tts_surface_resolver_version=self.surface_map.version,
            realizable=True,
        )
