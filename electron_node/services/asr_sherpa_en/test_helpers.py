"""ASR Sherpa English CTC 单元测试辅助：生成 PCM16 base64"""
import base64

import numpy as np

from config import SAMPLE_RATE


def generate_pcm16_base64(duration_sec: float = 0.5, sample_rate: int = SAMPLE_RATE) -> str:
    samples = int(sample_rate * duration_sec)
    t = np.linspace(0, duration_sec, samples, False)
    audio = np.sin(2 * np.pi * 440.0 * t)
    pcm16 = (audio * 32767).astype(np.int16)
    return base64.b64encode(pcm16.tobytes()).decode("utf-8")
