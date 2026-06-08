"""ToneModule P0 — batch inference on processed_audio + word timestamps."""
from __future__ import annotations

import logging
import time
from typing import Iterable, List, Optional, Sequence, Tuple

import numpy as np

from shared_types import SegmentInfo, WordInfo
from tone_module.classifier import get_tone_classifier
from tone_module.mel import extract_mel_features
from tone_module.tone_types import TonePosterior, ToneToken, UtteranceTonePayload

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
) -> Tuple[UtteranceTonePayload, int]:
    """
    Generate toneTokens from processed_audio BEFORE dedup.

    Returns (payload, tone_inference_ms).
    """
    started = time.perf_counter()

    if processed_audio is None or len(processed_audio) == 0:
        ms = int((time.perf_counter() - started) * 1000)
        return UtteranceTonePayload(tone_enabled=False, skipped_reason="no_audio"), ms

    if not _is_zh_language(language, src_lang):
        ms = int((time.perf_counter() - started) * 1000)
        return UtteranceTonePayload(tone_enabled=False, skipped_reason="non_zh"), ms

    words = list(_iter_words(segments))
    if not words:
        ms = int((time.perf_counter() - started) * 1000)
        return UtteranceTonePayload(tone_enabled=False, skipped_reason="no_timestamps"), ms

    classifier = get_tone_classifier()
    if not classifier.ready:
        ms = int((time.perf_counter() - started) * 1000)
        return UtteranceTonePayload(tone_enabled=False, skipped_reason="model_error"), ms

    slices: List[np.ndarray] = []
    valid_words: List[WordInfo] = []
    for w in words:
        dur = float(w.end) - float(w.start)
        if dur < MIN_SLICE_SEC:
            continue
        slices.append(_slice_audio(processed_audio, sample_rate, float(w.start), float(w.end)))
        valid_words.append(w)

    if not slices:
        ms = int((time.perf_counter() - started) * 1000)
        return UtteranceTonePayload(tone_enabled=False, skipped_reason="no_timestamps"), ms

    mel_batch = np.stack([extract_mel_features(s, sample_rate) for s in slices], axis=0)
    posteriors = classifier.predict_batch(mel_batch)

    tone_tokens: List[ToneToken] = []
    confidences: List[float] = []
    for w, probs in zip(valid_words, posteriors):
        confidence = float(np.max(probs))
        tone_tokens.append(
            ToneToken(
                token=w.word.strip(),
                start=float(w.start),
                end=float(w.end),
                tone_posterior=_posterior_from_probs(probs),
                confidence=confidence,
            )
        )
        confidences.append(confidence)

    tone_tokens.sort(key=lambda t: t.start)
    avg_conf = float(sum(confidences) / len(confidences)) if confidences else None
    ms = int((time.perf_counter() - started) * 1000)

    payload = UtteranceTonePayload(
        tone_enabled=True,
        tone_tokens=tone_tokens,
        tone_token_count=len(tone_tokens),
        tone_confidence_avg=avg_conf,
    )
    logger.info(
        "[%s] ToneModule P0: tokens=%d inference_ms=%d avg_conf=%.3f",
        trace_id,
        len(tone_tokens),
        ms,
        avg_conf or 0.0,
    )
    return payload, ms
