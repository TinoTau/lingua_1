"""Fbank 特征提取：16k, 80 维，与 Conformer small 模型 test.py 对齐（含 CMVN）。"""
from typing import Tuple

import librosa
import numpy as np

from config import FEATURE_DIM, SAMPLE_RATE

FRAME_LENGTH = 400
FRAME_SHIFT = 160
FMIN = 20
FMAX = 7600


def _mel_fbank(sr: int, n_fft: int, n_mels: int, fmin: float, fmax: float) -> np.ndarray:
    return librosa.filters.mel(sr=sr, n_fft=n_fft, n_mels=n_mels, fmin=fmin, fmax=fmax)


def waveform_to_fbank(audio_float32: np.ndarray, sample_rate: int) -> Tuple[np.ndarray, int]:
    if sample_rate != SAMPLE_RATE:
        raise ValueError(f"Only sample_rate={SAMPLE_RATE} supported, got {sample_rate}")
    n_fft = 512
    mel_basis = _mel_fbank(sample_rate, n_fft, FEATURE_DIM, FMIN, FMAX)
    stft = librosa.stft(
        audio_float32,
        n_fft=n_fft,
        hop_length=FRAME_SHIFT,
        win_length=FRAME_LENGTH,
        window="hann",
        center=True,
    )
    mel = np.dot(mel_basis, np.abs(stft) ** 2)
    mel = np.maximum(mel, 1e-10)
    log_mel = np.log(mel).astype(np.float32)
    # (T, 80)，按帧做 CMVN，与模型 test.py 一致
    mean = log_mel.mean(axis=0, keepdims=True)
    std = log_mel.std(axis=0, keepdims=True) + 1e-5
    log_mel = (log_mel - mean) / std
    out = log_mel.T[np.newaxis, :, :]
    return out, out.shape[1]
