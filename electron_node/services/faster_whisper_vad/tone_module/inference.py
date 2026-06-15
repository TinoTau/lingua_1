"""ToneModule — batch inference on processed_audio + word timestamps."""
from __future__ import annotations

import logging
import time
from typing import Iterable, List, Optional, Sequence, Tuple

import numpy as np

from shared_types import SegmentInfo, WordInfo
from tone_module.classifier import get_tone_classifier
from tone_module.mel import extract_mel_features
from tone_module.tone_types import AcousticToneSlice, TonePosterior, UtteranceAcousticTonePayload

logger = logging.getLogger(__name__)

MIN_SLICE_SEC = 0.02


def _is_zh_language(language: Optional[str], src_lang: Optional[str]) -> bool:
    lang = (language or src_lang or "").strip().lower()
    if not lang or lang == "auto":
        return False
    return lang.startswith("zh")


def _iter_words(segments: Sequence[SegmentInfo]) -> Iterable[WordInfo]:
    for seg in segments or []:
        words = getattr(seg, "words", None) or []
        for w in words:
            if w.word and w.start is not None and w.end is not None:
                yield w


def _slice_audio(audio: np.ndarray, sample_rate: int, start: float, end: float) -> np.ndarray:
    s = max(0, int(start * sample_rate))
    e = max(s + 1, int(end * sample_rate))
    e = min(e, len(audio))
    return audio[s:e]


def _posterior_from_probs(probs: np.ndarray) -> TonePosterior:
    return TonePosterior(
        t1=float(probs[0]),
        t2=float(probs[1]),
        t3=float(probs[2]),
        t4=float(probs[3]),
        t5=float(probs[4]),
    )


def run_tone_inference(
    processed_audio: np.ndarray,
    sample_rate: int,
    segments: Sequence[SegmentInfo],
    language: Optional[str],
    src_lang: Optional[str],
    trace_id: str = "",
) -> Tuple[UtteranceAcousticTonePayload, int]:
    """
    Generate acousticToneSlices from processed_audio + FW word timestamps.

    Returns (payload, tone_inference_ms).
    """
    started = time.perf_counter()

    if processed_audio is None or len(processed_audio) == 0:
        ms = int((time.perf_counter() - started) * 1000)
        return UtteranceAcousticTonePayload(tone_enabled=False, skipped_reason="no_audio"), ms

    if not _is_zh_language(language, src_lang):
        ms = int((time.perf_counter() - started) * 1000)
        return UtteranceAcousticTonePayload(tone_enabled=False, skipped_reason="non_zh"), ms

    words = list(_iter_words(segments))
    if not words:
        ms = int((time.perf_counter() - started) * 1000)
        return UtteranceAcousticTonePayload(tone_enabled=False, skipped_reason="no_timestamps"), ms

    classifier = get_tone_classifier()
    if not classifier.ready:
        ms = int((time.perf_counter() - started) * 1000)
        return UtteranceAcousticTonePayload(tone_enabled=False, skipped_reason="model_error"), ms

    slices_audio: List[np.ndarray] = []
    valid_words: List[WordInfo] = []
    for w in words:
        dur = float(w.end) - float(w.start)
        if dur < MIN_SLICE_SEC:
            continue
        slices_audio.append(_slice_audio(processed_audio, sample_rate, float(w.start), float(w.end)))
        valid_words.append(w)

    if not slices_audio:
        ms = int((time.perf_counter() - started) * 1000)
        return UtteranceAcousticTonePayload(tone_enabled=False, skipped_reason="no_timestamps"), ms

    mel_batch = np.stack([extract_mel_features(s, sample_rate) for s in slices_audio], axis=0)
    posteriors = classifier.predict_batch(mel_batch)

    acoustic_slices: List[AcousticToneSlice] = []
    confidences: List[float] = []
    for w, probs in zip(valid_words, posteriors):
        confidence = float(np.max(probs))
        acoustic_slices.append(
            AcousticToneSlice(
                start=float(w.start),
                end=float(w.end),
                tone_posterior=_posterior_from_probs(probs),
                confidence=confidence,
            )
        )
        confidences.append(confidence)

    acoustic_slices.sort(key=lambda s: s.start)
    avg_conf = float(sum(confidences) / len(confidences)) if confidences else None
    ms = int((time.perf_counter() - started) * 1000)

    payload = UtteranceAcousticTonePayload(
        tone_enabled=True,
        acoustic_tone_slices=acoustic_slices,
        slice_count=len(acoustic_slices),
        tone_confidence_avg=avg_conf,
    )
    logger.info(
        "[%s] ToneModule Phase3: slices=%d inference_ms=%d avg_conf=%.3f",
        trace_id,
        len(acoustic_slices),
        ms,
        avg_conf or 0.0,
    )
    return payload, ms
