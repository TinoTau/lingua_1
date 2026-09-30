# -*- coding: utf-8 -*-
"""Piper audio materializer — orchestration only."""
from __future__ import annotations

import hashlib
from io import BytesIO
from pathlib import Path

import array
import numpy as np
import wave

from training.model2.adapters.piper_tts_client import PiperTtsClient
from training.model2.constants import DEFAULT_ASR_SAMPLE_RATE
from training.model2.corruption.bank import resample_audio
from training.model3_dataset.acoustic_training.pcm_encode import wav_bytes_pcm16


def materialize_audio(
    reference_text: str,
    *,
    out_dir: Path,
    asset_stem: str,
) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    piper = PiperTtsClient()
    piper.health()
    synth = piper.synthesize(reference_text)
    with wave.open(BytesIO(synth.wav_bytes), "rb") as wf:
        sr0 = wf.getframerate()
        ch = wf.getnchannels()
        frames = wf.readframes(wf.getnframes())
    a = array.array("h")
    a.frombytes(frames)
    if ch == 2:
        a = array.array("h", ((a[j] + a[j + 1]) // 2 for j in range(0, len(a), 2)))
    audio = np.asarray(a, dtype=np.float32) / 32768.0
    audio16 = resample_audio(audio, sr0, DEFAULT_ASR_SAMPLE_RATE)
    wav16 = wav_bytes_pcm16(audio16, DEFAULT_ASR_SAMPLE_RATE)
    digest = hashlib.sha256(wav16).hexdigest()[:16]
    path = out_dir / f"{asset_stem}_{digest}.wav"
    path.write_bytes(wav16)
    return {
        "audioAssetId": str(path),
        "audioBytes": wav16,
        "audioSourceProvenance": {
            "source": "PIPER_TTS",
            "voice": synth.voice,
            "service_id": synth.service_id,
            "sha256_16": digest,
        },
        "ttsRunIdentity": {
            "voice": synth.voice,
            "sample_rate_native": synth.sample_rate,
            "latency_ms": synth.latency_ms,
            "service_id": synth.service_id,
        },
        "evidenceLevel": "TTS_ASR",
    }
