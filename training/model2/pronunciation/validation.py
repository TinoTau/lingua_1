"""Piper realization validation + realization status classification."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

from training.model2.adapters.faster_whisper_client import FasterWhisperClient
from training.model2.adapters.piper_tts_client import PiperTtsClient
from training.model2.corruption.bank import read_wav_pcm16, resample_audio, wav_bytes_pcm16
from training.model2.constants import DEFAULT_ASR_SAMPLE_RATE
from training.model2.phonetic.syllables import syllables_from_text_tone_num, text_to_syllables
from training.model2.pronunciation.syllable_substitution import parse_syllable


REALIZATION_STATUSES = (
    "REALIZED_AS_INTENDED",
    "REALIZED_DIFFERENTLY",
    "NO_ASR_EFFECT",
    "TTS_REALIZATION_FAILED",
)


@dataclass
class RealizationResult:
    status: str
    asr_hypothesis: str
    asr_syllables: list[str]
    intended: list[str]
    notes: str = ""


def _norm_syl(s: str) -> str:
    p = parse_syllable(s)
    return p.with_tone() if p else s.lower()


def classify_realization(
    *,
    ground_truth_term: str,
    intended_corrupted_syllables: list[str],
    asr_hypothesis: str,
    corruption_family: str,
) -> RealizationResult:
    """Classify whether ASR evidence reflects the intended corruption family."""
    asr = (asr_hypothesis or "").strip()
    if not asr:
        return RealizationResult("TTS_REALIZATION_FAILED", asr, [], intended_corrupted_syllables, "empty ASR")

    # Prefer tone-bearing if available for matching base+tone; also compare tone-less
    asr_tone = syllables_from_text_tone_num(asr) or []
    asr_plain = text_to_syllables(asr)
    intended = [_norm_syl(x) for x in intended_corrupted_syllables]
    intended_plain = [parse_syllable(x).base if parse_syllable(x) else x for x in intended]

    asr_tone_n = [_norm_syl(x) for x in asr_tone]
    asr_plain_n = [parse_syllable(x).base if parse_syllable(x) else x for x in asr_plain]

    # Exact intended sequence appears in ASR syllables
    if _contains_seq(asr_tone_n, intended) or _contains_seq(asr_plain_n, intended_plain):
        return RealizationResult("REALIZED_AS_INTENDED", asr, asr_plain, intended)

    # Ground truth recovered by ASR despite corruption attempt
    gt_plain = text_to_syllables(ground_truth_term)
    if ground_truth_term in asr or _contains_seq(asr_plain_n, gt_plain):
        # May still have local corruption elsewhere — treat as no effect on target
        return RealizationResult("NO_ASR_EFFECT", asr, asr_plain, intended, "ASR recovered GT term")

    # Family-level evidence: at least one syllable shows the destination component
    fam_dst = corruption_family.split("_", 1)[1]
    evidence = False
    for syl in asr_plain_n + asr_tone_n:
        p = parse_syllable(syl)
        if not p:
            continue
        if fam_dst in ("n", "l", "zh", "z", "ch", "c", "sh", "s", "f", "h"):
            if p.initial == fam_dst:
                evidence = True
                break
        else:
            if p.final == fam_dst:
                evidence = True
                break
    if evidence:
        return RealizationResult("REALIZED_DIFFERENTLY", asr, asr_plain, intended, "family evidence without exact sequence")
    return RealizationResult("REALIZED_DIFFERENTLY", asr, asr_plain, intended, "ASR changed but family unclear")


def _contains_seq(hay: list[str], needle: list[str]) -> bool:
    if not needle:
        return False
    n = len(needle)
    for i in range(0, max(0, len(hay) - n + 1)):
        if hay[i : i + n] == needle:
            return True
    return False


def validate_char_with_piper_asr(
    *,
    surface_char: str,
    intended_syllable: str,
    tts: PiperTtsClient,
    asr: FasterWhisperClient,
    carrier: str = "请读{CHAR}",
) -> dict[str, Any]:
    """Short carrier TTS→ASR check that a char realizes intended syllable (base match)."""
    text = carrier.replace("{CHAR}", surface_char)
    try:
        synth = tts.synthesize(text)
        audio, sr = read_wav_pcm16(synth.wav_bytes)
        audio16 = resample_audio(audio, sr, DEFAULT_ASR_SAMPLE_RATE)
        hyp = asr.transcribe_wav(wav_bytes_pcm16(audio16, DEFAULT_ASR_SAMPLE_RATE), job_id=f"val-{surface_char}")
    except Exception as e:
        return {"ok": False, "reason": str(e), "asr": "", "surface": surface_char}

    asr_text = hyp.text or ""
    asr_syl = text_to_syllables(asr_text)
    want = parse_syllable(intended_syllable)
    want_base = want.base if want else intended_syllable
    got_bases = [(parse_syllable(s).base if parse_syllable(s) else s) for s in asr_syl]
    ok = want_base in got_bases or surface_char in asr_text
    return {
        "ok": bool(ok),
        "asr": asr_text,
        "asr_syllables": asr_syl,
        "intended": intended_syllable,
        "surface": surface_char,
        "carrier": text,
    }
