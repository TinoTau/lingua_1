"""CorruptionSpanAlignment V1 — GT / TTS / ASR span association."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Optional

from training.model2.alignment.align import align_codepoints


@dataclass
class CorruptionSpanAlignment:
    gt_span: str
    tts_span: str
    asr_span: str
    alignment_confidence: float
    associated_with_corruption: bool
    model2_term_training_eligible: bool
    reason: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def align_corruption_spans(
    *,
    ground_truth_text: str,
    ground_truth_term: str,
    tts_input_text: str,
    tts_surface: str,
    asr_hypothesis: str,
    backend: str,
) -> CorruptionSpanAlignment:
    """Associate ASR error span with the corrupted term when possible."""
    gt_span = ground_truth_term
    tts_span = tts_surface if backend == "CHINESE_SURFACE" else ground_truth_term

    # Prefer exact surface/term presence
    if tts_span and tts_span in asr_hypothesis and tts_span != gt_span:
        return CorruptionSpanAlignment(
            gt_span=gt_span,
            tts_span=tts_span,
            asr_span=tts_span,
            alignment_confidence=0.95,
            associated_with_corruption=True,
            model2_term_training_eligible=True,
            reason="asr_contains_tts_surface",
        )
    if gt_span in asr_hypothesis:
        return CorruptionSpanAlignment(
            gt_span=gt_span,
            tts_span=tts_span,
            asr_span=gt_span,
            alignment_confidence=0.4,
            associated_with_corruption=False,
            model2_term_training_eligible=False,
            reason="asr_recovered_gt_term",
        )

    # Alignment-based: find REPLACE spans whose target relates to term
    spans = align_codepoints(asr_hypothesis, ground_truth_text)
    best = None
    for sp in spans:
        tgt = sp.target_text or ""
        src = sp.source_text or ""
        if tgt == gt_span or gt_span in tgt or tgt in gt_span:
            best = sp
            break
        if tts_span and (src == tts_span or tts_span in src):
            best = sp
            break
    if best is not None:
        return CorruptionSpanAlignment(
            gt_span=gt_span,
            tts_span=tts_span,
            asr_span=best.source_text or "",
            alignment_confidence=0.75,
            associated_with_corruption=True,
            model2_term_training_eligible=bool(best.source_text),
            reason="align_replace_near_term",
        )

    # Fallback: whole-utterance differs
    differs = "".join(asr_hypothesis.split()) != "".join(ground_truth_text.split())
    return CorruptionSpanAlignment(
        gt_span=gt_span,
        tts_span=tts_span,
        asr_span=asr_hypothesis,
        alignment_confidence=0.2 if differs else 0.0,
        associated_with_corruption=False,
        model2_term_training_eligible=False,
        reason="term_span_unresolved_keep_raw" if differs else "no_asr_diff",
    )
