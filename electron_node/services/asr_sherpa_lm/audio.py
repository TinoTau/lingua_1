"""
ASR Sherpa-LM 服务 - 音频解码
Base64 PCM16 -> float32 [-1, 1]，与 asr-sherpa-en / asr-sherpa-lm 契约一致。
"""
import base64
from typing import Tuple

import numpy as np


def decode_pcm16_base64(audio_b64: str, sample_rate: int) -> Tuple[np.ndarray, float]:
    """将 base64 PCM16 解码为 float32 数组，返回 (samples_float32, duration_sec)。"""
    raw = base64.b64decode(audio_b64)
    if len(raw) % 2 != 0:
        raise ValueError("PCM16 data length must be even")
    samples_int16 = np.frombuffer(raw, dtype=np.int16)
    samples_float32 = samples_int16.astype(np.float32) / 32768.0
    duration_sec = len(samples_float32) / float(sample_rate)
    return samples_float32, duration_sec
