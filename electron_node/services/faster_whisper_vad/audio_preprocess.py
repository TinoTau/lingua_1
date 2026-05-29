"""
P0 音频前处理：16k mono float32、峰值归一化、首尾静音裁剪（保守）。
"""
from __future__ import annotations

import numpy as np

TARGET_PEAK_DBFS = -3.0
SILENCE_THRESHOLD_DBFS = -40.0
MIN_SILENCE_RUN_MS = 80


def _dbfs_from_peak(peak: float) -> float:
    if peak <= 1e-9:
        return -120.0
    return 20.0 * np.log10(peak)


def _peak_normalize(audio: np.ndarray, target_dbfs: float = TARGET_PEAK_DBFS) -> tuple[np.ndarray, dict]:
    peak_before = float(np.max(np.abs(audio))) if audio.size else 0.0
    rms_before = float(np.sqrt(np.mean(audio ** 2))) if audio.size else 0.0
    target_peak = 10 ** (target_dbfs / 20.0)
    clipped = False
    if peak_before > 1e-9:
        gain = target_peak / peak_before
        out = (audio * gain).astype(np.float32)
        if np.max(np.abs(out)) > 1.0:
            out = np.clip(out, -1.0, 1.0)
            clipped = True
    else:
        out = audio.astype(np.float32, copy=False)
    peak_after = float(np.max(np.abs(out))) if out.size else 0.0
    rms_after = float(np.sqrt(np.mean(out ** 2))) if out.size else 0.0
    return out, {
        "peak_before": round(_dbfs_from_peak(peak_before), 1),
        "peak_after": round(_dbfs_from_peak(peak_after), 1),
        "rms_before": round(_dbfs_from_peak(rms_before), 1),
        "rms_after": round(_dbfs_from_peak(rms_after), 1),
        "clipped": clipped,
    }


def _trim_leading_trailing_silence(
    audio: np.ndarray, sample_rate: int
) -> tuple[np.ndarray, dict]:
    if audio.size == 0:
        return audio, {"leading_ms": 0, "trailing_ms": 0}
    threshold = 10 ** (SILENCE_THRESHOLD_DBFS / 20.0)
    min_run = max(1, int(sample_rate * MIN_SILENCE_RUN_MS / 1000))
    abs_audio = np.abs(audio)
    speech = abs_audio > threshold

    leading_ms = 0
    start = 0
    for i in range(0, len(speech) - min_run, min_run):
        if np.any(speech[i : i + min_run]):
            start = i
            leading_ms = int(start / sample_rate * 1000)
            break
    else:
        return audio, {"leading_ms": 0, "trailing_ms": 0}

    trailing_ms = 0
    end = len(audio)
    for i in range(len(speech) - min_run, 0, -min_run):
        if np.any(speech[i : i + min_run]):
            end = min(len(audio), i + min_run)
            trailing_ms = int((len(audio) - end) / sample_rate * 1000)
            break

    if end <= start:
        return audio, {"leading_ms": leading_ms, "trailing_ms": trailing_ms}

    trimmed = audio[start:end].astype(np.float32, copy=False)
    return trimmed, {"leading_ms": leading_ms, "trailing_ms": trailing_ms}


def preprocess_pcm_f32(
    audio: np.ndarray, sample_rate: int, target_sample_rate: int = 16000
) -> tuple[np.ndarray, int, dict]:
    """统一为 mono float32，可选重采样到 target_sample_rate。"""
    if audio.ndim > 1:
        audio = np.mean(audio, axis=-1)
    audio = audio.astype(np.float32, copy=False)
    if audio.dtype != np.float32:
        audio = audio.astype(np.float32)

    sr = sample_rate
    diagnostics: dict = {
        "audio_format": {
            "sample_rate": target_sample_rate,
            "channels": 1,
            "dtype": "float32",
        },
    }

    audio, level = _peak_normalize(audio)
    diagnostics["audio_level"] = level

    audio, trim = _trim_leading_trailing_silence(audio, sr)
    diagnostics["silence_trim"] = trim

    return audio, sr, diagnostics
