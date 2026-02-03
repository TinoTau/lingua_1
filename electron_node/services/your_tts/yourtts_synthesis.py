#!/usr/bin/env python3
"""
YourTTS 语音合成核心逻辑
"""
from typing import List, Tuple, Optional
import numpy as np
import torch


def do_synthesize(
    tts_model,
    text: str,
    speaker_wav: Optional[str],
    speaker: Optional[str],
    language: str,
) -> Tuple[List[float], bool]:
    """
    执行合成：调用 TTS 模型并返回音频列表与是否使用了参考音频。

    Args:
        tts_model: 已加载的 TTS 模型
        text: 要合成的文本
        speaker_wav: 参考音频 WAV 文件路径，或 None
        speaker: 预置说话者名称，或 None
        language: 语言代码

    Returns:
        (audio_list, used_reference)
    """
    if speaker_wav:
        wav = tts_model.tts(
            text=text,
            speaker_wav=speaker_wav,
            language=language
        )
    elif speaker:
        wav = tts_model.tts(
            text=text,
            speaker=speaker,
            language=language
        )
    else:
        wav = tts_model.tts(
            text=text,
            language=language
        )

    if isinstance(wav, np.ndarray):
        audio_list = [float(x) for x in wav.flatten()]
    elif isinstance(wav, torch.Tensor):
        audio_array = wav.cpu().numpy()
        audio_list = [float(x) for x in audio_array.flatten()]
    else:
        audio_list = [float(x) for x in wav]

    used_reference = speaker_wav is not None
    return audio_list, used_reference
