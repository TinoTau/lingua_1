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
from tone_module.tone_types import (
    AcousticToneSlice,
    ToneEvidenceProductionDiagnostic,
    ToneEvidenceProductionStatus,
    TonePosterior,
    UtteranceAcousticTonePayload,
)

logger = logging.getLogger(__name__)

MIN_SLICE_SEC = P1_MIN_SLICE_SEC


def _is_zh_language(language: Optional[str], src_lang: Optional[str]) -> bool:
    lang = (language or src_lang or "").strip().lower()
    if not lang or lang == "auto":
        return False
    return lang.startswith("zh")


def _iter_words_with_segment(
    segments: Sequence[SegmentInfo],
) -> Iterable[Tuple[int, WordInfo]]:
    for seg_idx, seg in enumerate(segments or []):
        words = getattr(seg, "words", None) or []
        for w in words:
            yield seg_idx, w


def _posterior_from_probs(probs: np.ndarray) -> TonePosterior:
    return TonePosterior(
        t1=float(probs[0]),
        t2=float(probs[1]),
        t3=float(probs[2]),
        t4=float(probs[3]),
        t5=float(probs[4]),
    )


def _diag(
    *,
    word: str,
    start: float,
    end: float,
    segment_index: int,
    status: ToneEvidenceProductionStatus,
    error_code: Optional[str] = None,
) -> ToneEvidenceProductionDiagnostic:
    return ToneEvidenceProductionDiagnostic(
        word=word,
        start=float(start),
        end=float(end),
        duration=float(end) - float(start),
        segment_index=segment_index,
        status=status,
        error_code=error_code,
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
    Evidence production diagnostics are on payload.evidence_production (not slices).
    """
    started = time.perf_counter()
    evidence: List[ToneEvidenceProductionDiagnostic] = []

    if processed_audio is None or len(processed_audio) == 0:
        ms = int((time.perf_counter() - started) * 1000)
        return (
            UtteranceAcousticTonePayload(
                tone_enabled=False,
                skipped_reason="no_audio",
                evidence_production=evidence,
            ),
            ms,
        )

    if not _is_zh_language(language, src_lang):
        ms = int((time.perf_counter() - started) * 1000)
        return (
            UtteranceAcousticTonePayload(
                tone_enabled=False,
                skipped_reason="non_zh",
                evidence_production=evidence,
            ),
            ms,
        )

    words_with_seg = list(_iter_words_with_segment(segments))
    if not words_with_seg:
        ms = int((time.perf_counter() - started) * 1000)
        return (
            UtteranceAcousticTonePayload(
                tone_enabled=False,
                skipped_reason="no_timestamps",
                evidence_production=evidence,
            ),
            ms,
        )

    classifier = get_tone_classifier()
    if not classifier.ready:
        ms = int((time.perf_counter() - started) * 1000)
        return (
            UtteranceAcousticTonePayload(
                tone_enabled=False,
                skipped_reason="model_error",
                evidence_production=evidence,
            ),
            ms,
        )

    feature_rows: List[np.ndarray] = []
    valid_words: List[WordInfo] = []
    valid_seg_indices: List[int] = []

    for seg_idx, w in words_with_seg:
        token = (w.word or "").strip()
        if not token or w.start is None or w.end is None:
            evidence.append(
                _diag(
                    word=token or "",
                    start=float(w.start) if w.start is not None else 0.0,
                    end=float(w.end) if w.end is not None else 0.0,
                    segment_index=seg_idx,
                    status="invalid_word_time",
                    error_code="missing_word_or_time",
                )
            )
            continue

        start = float(w.start)
        end = float(w.end)
        dur = end - start
        if dur < MIN_SLICE_SEC:
            evidence.append(
                _diag(
                    word=token,
                    start=start,
                    end=end,
                    segment_index=seg_idx,
                    status="short_duration_skipped",
                    error_code="below_min_slice_sec",
                )
            )
            continue

        try:
            feature_rows.append(extract_feature(processed_audio, sample_rate, w))
        except ValueError as exc:
            err_name = type(exc).__name__
            err_msg = str(exc).strip().splitlines()[0][:120] if str(exc) else err_name
            evidence.append(
                _diag(
                    word=token,
                    start=start,
                    end=end,
                    segment_index=seg_idx,
                    status="feature_extraction_failed",
                    error_code=f"{err_name}:{err_msg}" if err_msg else err_name,
                )
            )
            continue
        valid_words.append(w)
        valid_seg_indices.append(seg_idx)

    if not feature_rows:
        ms = int((time.perf_counter() - started) * 1000)
        return (
            UtteranceAcousticTonePayload(
                tone_enabled=False,
                skipped_reason="no_timestamps",
                evidence_production=evidence,
            ),
            ms,
        )

    feature_batch = np.stack(feature_rows, axis=0)
    posteriors = classifier.predict_batch(feature_batch)
    if not isinstance(posteriors, np.ndarray):
        posteriors = np.asarray(posteriors)

    n_valid = len(valid_words)
    n_post = int(posteriors.shape[0]) if posteriors.ndim >= 1 else 0
    if n_post != n_valid:
        logger.warning(
            "[%s] ToneModule posterior/valid_words length mismatch: valid=%d posteriors=%d",
            trace_id,
            n_valid,
            n_post,
        )
        # Do not silent-zip truncate: only emit slices for paired rows; mark the rest.
        paired = min(n_valid, n_post)
        acoustic_slices: List[AcousticToneSlice] = []
        confidences: List[float] = []
        for i in range(paired):
            w = valid_words[i]
            probs = posteriors[i]
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
            evidence.append(
                _diag(
                    word=(w.word or "").strip(),
                    start=float(w.start),
                    end=float(w.end),
                    segment_index=valid_seg_indices[i],
                    status="slice_created",
                )
            )
        for i in range(paired, n_valid):
            w = valid_words[i]
            evidence.append(
                _diag(
                    word=(w.word or "").strip(),
                    start=float(w.start),
                    end=float(w.end),
                    segment_index=valid_seg_indices[i],
                    status="inference_output_missing",
                    error_code=f"posterior_len_{n_post}_valid_len_{n_valid}",
                )
            )
        acoustic_slices.sort(key=lambda s: s.start)
        avg_conf = float(sum(confidences) / len(confidences)) if confidences else None
        ms = int((time.perf_counter() - started) * 1000)
        return (
            UtteranceAcousticTonePayload(
                tone_enabled=len(acoustic_slices) > 0,
                acoustic_tone_slices=acoustic_slices,
                slice_count=len(acoustic_slices),
                tone_confidence_avg=avg_conf,
                skipped_reason=None if acoustic_slices else "no_timestamps",
                evidence_production=evidence,
            ),
            ms,
        )

    acoustic_slices = []
    confidences = []
    for w, probs, seg_idx in zip(valid_words, posteriors, valid_seg_indices):
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
        evidence.append(
            _diag(
                word=(w.word or "").strip(),
                start=float(w.start),
                end=float(w.end),
                segment_index=seg_idx,
                status="slice_created",
            )
        )

    acoustic_slices.sort(key=lambda s: s.start)
    avg_conf = float(sum(confidences) / len(confidences)) if confidences else None
    ms = int((time.perf_counter() - started) * 1000)

    payload = UtteranceAcousticTonePayload(
        tone_enabled=True,
        acoustic_tone_slices=acoustic_slices,
        slice_count=len(acoustic_slices),
        tone_confidence_avg=avg_conf,
        evidence_production=evidence,
    )
    logger.info(
        "[%s] ToneModule P1: slices=%d inference_ms=%d avg_conf=%.3f evidence=%d",
        trace_id,
        len(acoustic_slices),
        ms,
        avg_conf or 0.0,
        len(evidence),
    )
    return payload, ms
