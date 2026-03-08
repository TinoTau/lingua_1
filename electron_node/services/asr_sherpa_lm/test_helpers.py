"""ASR Sherpa-LM 单元测试辅助：生成 PCM16 base64 等"""
import base64

import numpy as np

SAMPLE_RATE = 16000


def generate_pcm16_base64(duration_sec: float = 0.5, sample_rate: int = 16000) -> str:
    """生成 PCM16 测试音频的 base64。"""
    samples = int(sample_rate * duration_sec)
    t = np.linspace(0, duration_sec, samples, False)
    audio = np.sin(2 * np.pi * 440.0 * t)
    pcm16 = (audio * 32767).astype(np.int16)
    return base64.b64encode(pcm16.tobytes()).decode("utf-8")
