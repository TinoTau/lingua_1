# -*- coding: utf-8 -*-
"""PCM encode SSOT — re-export bank encoder; no duplicate implementation."""
from __future__ import annotations

from training.model2.corruption.bank import (  # noqa: F401
    _float_audio_to_pcm16,
    wav_bytes_pcm16,
    write_wav_pcm16,
)

__all__ = ["_float_audio_to_pcm16", "wav_bytes_pcm16", "write_wav_pcm16"]
