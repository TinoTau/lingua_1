"""80-dim Mel feature extraction for ToneModule P0."""
from __future__ import annotations

import numpy as np
from scipy.signal import stft

SAMPLE_RATE = 16000
N_FFT = 512
HOP_LENGTH = 160
N_MELS = 80
FMIN = 50.0
FMAX = 7600.0


def _hz_to_mel(hz: np.ndarray) -> np.ndarray:
    return 2595.0 * np.log10(1.0 + hz / 700.0)


def _mel_to_hz(mel: np.ndarray) -> np.ndarray:
    return 700.0 * (10.0 ** (mel / 2595.0) - 1.0)


def _mel_filterbank(n_mels: int, n_fft: int, sr: int) -> np.ndarray:
    fmax = min(FMAX, sr / 2.0)
    mel_points = np.linspace(_hz_to_mel(np.array([FMIN]))[0], _hz_to_mel(np.array([fmax]))[0], n_mels + 2)
    hz_points = _mel_to_hz(mel_points)
    bins = np.floor((n_fft + 1) * hz_points / sr).astype(int)
    fb = np.zeros((n_mels, n_fft // 2 + 1), dtype=np.float32)
    for i in range(n_mels):
        left, center, right = bins[i], bins[i + 1], bins[i + 2]
        if center <= left or right <= center:
            continue
        for j in range(left, center):
            if 0 <= j < fb.shape[1]:
                fb[i, j] = (j - left) / max(center - left, 1)
        for j in range(center, right):
            if 0 <= j < fb.shape[1]:
                fb[i, j] = (right - j) / max(right - center, 1)
    return fb


_MEL_FB = _mel_filterbank(N_MELS, N_FFT, SAMPLE_RATE)


def extract_mel_features(audio: np.ndarray, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    """Return (N_MELS,) mean-pooled log-mel vector for one word slice."""
    if audio.size == 0:
        return np.zeros(N_MELS, dtype=np.float32)
    if sample_rate != SAMPLE_RATE:
        # P0 expects 16 kHz processed_audio; simple resample ratio for safety.
        ratio = SAMPLE_RATE / float(sample_rate)
        new_len = max(1, int(len(audio) * ratio))
        audio = np.interp(
            np.linspace(0, len(audio) - 1, new_len),
            np.arange(len(audio)),
            audio.astype(np.float64),
        ).astype(np.float32)
    if len(audio) < N_FFT:
        pad = N_FFT - len(audio)
        audio = np.pad(audio, (0, pad), mode="constant")
    _, _, zxx = stft(
        audio,
        fs=SAMPLE_RATE,
        nperseg=N_FFT,
        noverlap=N_FFT - HOP_LENGTH,
        boundary=None,
    )
    power = (np.abs(zxx) ** 2).astype(np.float32)
    mel = _MEL_FB @ power
    mel = np.log10(np.maximum(mel, 1e-10))
    return mel.mean(axis=1).astype(np.float32)
