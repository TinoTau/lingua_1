"""ToneModule — P1 Full Runtime inference on processed_audio + FW WordInfo."""
from __future__ import annotations

import logging
import time
from typing import Iterable, List, Optional, Sequence, Tuple

import numpy as np

from shared_types import SegmentInfo, WordInfo
from tone_module.classifier import get_tone_classifier
from tone_module.contract import P1_MIN_SLICE_SEC
from tone_module.feature_v2 import extract_feature
from tone_module.tone_types import AcousticToneSlice, TonePosterior, UtteranceAcousticTonePayload

logger = logging.getLogger(__name__)

MIN_SLICE_SEC = P1_MIN_SLICE_SEC


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

    Feature contract: feature_v2.extract_feature(processed_audio, sample_rate, word_info).

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

    feature_rows: List[np.ndarray] = []
    valid_words: List[WordInfo] = []
    for w in words:
        dur = float(w.end) - float(w.start)
        if dur < MIN_SLICE_SEC:
            continue
        try:
            feature_rows.append(extract_feature(processed_audio, sample_rate, w))
        except ValueError:
            continue
        valid_words.append(w)

    if not feature_rows:
        ms = int((time.perf_counter() - started) * 1000)
        return UtteranceAcousticTonePayload(tone_enabled=False, skipped_reason="no_timestamps"), ms

    feature_batch = np.stack(feature_rows, axis=0)
    posteriors = classifier.predict_batch(feature_batch)

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
        "[%s] ToneModule P1: slices=%d inference_ms=%d avg_conf=%.3f",
        trace_id,
        len(acoustic_slices),
        ms,
        avg_conf or 0.0,
    )
    return payload, ms
