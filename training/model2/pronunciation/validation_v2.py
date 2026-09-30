"""Realization Validation V2 — base / tone / full."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Optional

from training.model2.phonetic.syllables import syllables_from_text_tone_num, text_to_syllables
from training.model2.pronunciation.pronunciation_syllable import PronunciationSyllable
from training.model2.pronunciation.syllable_substitution import parse_syllable


@dataclass
class RealizationV2:
    base_realized: bool
    tone_realized: bool
    full_realized: bool
    differently_realized: bool
    no_asr_effect: bool
    status: str
    observed_base_syllables: list[str]
    observed_tones: list[Optional[int]]
    intended_compact: list[str]
    asr_hypothesis: str
    notes: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def classify_realization_v2(
    *,
    ground_truth_term: str,
    intended: list[PronunciationSyllable],
    asr_hypothesis: str,
    family: str,
) -> RealizationV2:
    asr = (asr_hypothesis or "").strip()
    intended_compact = [s.compact for s in intended]
    if not asr:
        return RealizationV2(
            False, False, False, False, False, "TTS_REALIZATION_FAILED", [], [], intended_compact, asr, "empty"
        )

    tone_syls = syllables_from_text_tone_num(asr) or []
    plain = text_to_syllables(asr)
    observed_base = []
    observed_tones: list[Optional[int]] = []
    for t in tone_syls:
        p = PronunciationSyllable.from_compact(t)
        if p:
            observed_base.append(p.base)
            observed_tones.append(p.tone)
        else:
            observed_base.append(t)
            observed_tones.append(None)
    if not observed_base:
        observed_base = list(plain)
        observed_tones = [None] * len(plain)

    want_bases = [s.base for s in intended]
    want_tones = [s.tone for s in intended]
    base_hit = _contains_seq(observed_base, want_bases) or _contains_seq(plain, want_bases)
    # tone match only if we have tone digits on ASR side
    tone_hit = False
    if base_hit and any(t is not None for t in observed_tones):
        # find window
        for i in range(0, max(0, len(observed_base) - len(want_bases) + 1)):
            if observed_base[i : i + len(want_bases)] == want_bases:
                window_tones = observed_tones[i : i + len(want_tones)]
                if all(
                    wt is None or wt == want_tones[j] for j, wt in enumerate(window_tones)
                ):
                    tone_hit = all(wt is not None for wt in window_tones)
                break

    full = base_hit and tone_hit
    gt_in = ground_truth_term in asr or _contains_seq(plain, text_to_syllables(ground_truth_term))
    no_effect = gt_in and not base_hit

    # family evidence
    fam_dst = family.split("_", 1)[1]
    fam_ev = False
    for b in observed_base + plain:
        p = PronunciationSyllable.from_compact(b if b[-1:].isdigit() else b + "0")
        if not p:
            continue
        if fam_dst in ("n", "l", "zh", "z", "ch", "c", "sh", "s", "f", "h"):
            if p.initial == fam_dst:
                fam_ev = True
                break
        elif p.final == fam_dst:
            fam_ev = True
            break

    differently = (not base_hit) and (fam_ev or (not gt_in and bool(asr)))
    if full:
        status = "FULL_REALIZED"
    elif base_hit and not tone_hit:
        status = "BASE_REALIZED"
    elif differently:
        status = "DIFFERENTLY_REALIZED"
    elif no_effect:
        status = "NO_ASR_EFFECT"
    else:
        status = "DIFFERENTLY_REALIZED"

    return RealizationV2(
        base_realized=base_hit,
        tone_realized=tone_hit,
        full_realized=full,
        differently_realized=differently,
        no_asr_effect=no_effect,
        status=status,
        observed_base_syllables=observed_base,
        observed_tones=observed_tones,
        intended_compact=intended_compact,
        asr_hypothesis=asr,
    )


def _contains_seq(hay: list[str], needle: list[str]) -> bool:
    if not needle:
        return False
    n = len(needle)
    for i in range(0, max(0, len(hay) - n + 1)):
        if hay[i : i + n] == needle:
            return True
    return False
