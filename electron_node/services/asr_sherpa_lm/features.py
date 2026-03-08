"""
Fbank 特征提取，与 sherpa-onnx CTC 模型一致：16k, 80 维, 25ms/10ms。
"""
from typing import Tuple

import numpy as np


# 与 sherpa-onnx FeatureExtractorConfig 对齐
SAMPLE_RATE = 16000
FEATURE_DIM = 80
FRAME_LENGTH = 400  # 25ms @ 16k
FRAME_SHIFT = 160   # 10ms
FMIN = 20
FMAX = 7600         # 16k Nyquist 8000 - 400


def _mel_fbank(sr: int, n_fft: int, n_mels: int, fmin: float, fmax: float) -> np.ndarray:
    """80 维 mel 滤波器组。"""
    try:
        import librosa
    except ImportError:
        raise ImportError("features.py requires librosa: pip install librosa")
    return librosa.filters.mel(sr=sr, n_fft=n_fft, n_mels=n_mels, fmin=fmin, fmax=fmax)


def waveform_to_fbank(audio_float32: np.ndarray, sample_rate: int) -> Tuple[np.ndarray, int]:
    """
    波形 -> fbank (1, T, 80), 与 sherpa-onnx 输入一致。
    返回 (features, num_frames)，features 形状 (1, T, FEATURE_DIM)，dtype float32。
    """
    if sample_rate != SAMPLE_RATE:
        raise ValueError(f"Only sample_rate={SAMPLE_RATE} supported, got {sample_rate}")
    try:
        import librosa
    except ImportError:
        raise ImportError("features.py requires librosa: pip install librosa")

    n_fft = 512
    mel_basis = _mel_fbank(sample_rate, n_fft, FEATURE_DIM, FMIN, FMAX)

    # stft: (n_fft//2+1, T)
    stft = librosa.stft(
        audio_float32,
        n_fft=n_fft,
        hop_length=FRAME_SHIFT,
        win_length=FRAME_LENGTH,
        window="hann",
        center=True,
    )
    # (n_mels, T)
    mel = np.dot(mel_basis, np.abs(stft) ** 2)
    mel = np.maximum(mel, 1e-10)
    log_mel = np.log(mel).astype(np.float32)
    # (1, T, n_mels)
    log_mel = log_mel.T[np.newaxis, :, :]
    num_frames = log_mel.shape[1]
    return log_mel, num_frames
