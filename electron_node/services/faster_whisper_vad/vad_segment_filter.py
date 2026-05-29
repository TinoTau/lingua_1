"""
P0 VAD 段后处理：过滤过短段、合并过近间隙、边界 padding。
"""
from __future__ import annotations

from typing import List, Tuple

from config import (
    VAD_MIN_SPEECH_DURATION_MS,
    VAD_MIN_SILENCE_DURATION_MS,
    VAD_SPEECH_PAD_MS,
)


def refine_vad_segments(
    segments: List[Tuple[int, int]],
    sample_rate: int,
    min_speech_ms: int | None = None,
    min_silence_ms: int | None = None,
    pad_ms: int | None = None,
    audio_len: int | None = None,
) -> List[Tuple[int, int]]:
    if not segments:
        return segments

    min_speech_ms = min_speech_ms if min_speech_ms is not None else VAD_MIN_SPEECH_DURATION_MS
    min_silence_ms = min_silence_ms if min_silence_ms is not None else VAD_MIN_SILENCE_DURATION_MS
    pad_ms = pad_ms if pad_ms is not None else VAD_SPEECH_PAD_MS

    min_speech_samples = int(sample_rate * min_speech_ms / 1000)
    min_gap_samples = int(sample_rate * min_silence_ms / 1000)
    pad_samples = int(sample_rate * pad_ms / 1000)

    filtered = [(s, e) for s, e in segments if (e - s) >= min_speech_samples]
    if not filtered:
        filtered = list(segments)

    merged: List[Tuple[int, int]] = []
    for start, end in sorted(filtered, key=lambda x: x[0]):
        if not merged:
            merged.append([start, end])
            continue
        prev_start, prev_end = merged[-1]
        if start - prev_end < min_gap_samples:
            merged[-1][1] = max(prev_end, end)
        else:
            merged.append([start, end])

    if audio_len is not None and audio_len > 0:
        padded: List[Tuple[int, int]] = []
        for start, end in merged:
            s = max(0, start - pad_samples)
            e = min(audio_len, end + pad_samples)
            padded.append((s, e))
        return padded

    return [(s, e) for s, e in merged]
