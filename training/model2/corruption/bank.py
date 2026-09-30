"""Deterministic acoustic corruption bank V1 (NONE/SPEED/VOLUME/NOISE/REVERB[/PITCH])."""

from __future__ import annotations

import hashlib
import math
import struct
import wave
from dataclasses import asdict, dataclass
from io import BytesIO
from pathlib import Path
from typing import Any, Optional

import numpy as np

CORRUPTION_BANK_VERSION = "acoustic-corruption-v1"


@dataclass(frozen=True)
class CorruptionSpec:
    strategy: str
    level: str
    params: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {"strategy": self.strategy, "level": self.level, "params": dict(self.params)}


# Bounded discrete levels only
LEVELS: dict[str, dict[str, dict[str, Any]]] = {
    "NONE": {"default": {}},
    "SPEED": {
        "slow_0p9": {"rate": 0.9},
        "fast_1p1": {"rate": 1.1},
    },
    "VOLUME": {
        "quiet_0p5": {"gain": 0.5},
        "loud_1p5": {"gain": 1.5},
    },
    "NOISE": {
        "snr_20db": {"snr_db": 20.0},
        "snr_10db": {"snr_db": 10.0},
    },
    "REVERB": {
        "light": {"decay": 0.35, "delay_ms": 40},
        "medium": {"decay": 0.5, "delay_ms": 80},
    },
    "PITCH": {
        "down_semitone": {"semitones": -1.0},
        "up_semitone": {"semitones": 1.0},
    },
}


def list_specs(include_pitch: bool = True) -> list[CorruptionSpec]:
    out: list[CorruptionSpec] = []
    for strategy, levels in LEVELS.items():
        if strategy == "PITCH" and not include_pitch:
            continue
        for level, params in levels.items():
            out.append(CorruptionSpec(strategy=strategy, level=level, params=params))
    return out


def resolve_spec(strategy: str, level: str) -> CorruptionSpec:
    strategy = strategy.upper()
    if strategy not in LEVELS:
        raise ValueError(f"unknown corruption strategy: {strategy}")
    if level not in LEVELS[strategy]:
        raise ValueError(f"unknown level {level} for {strategy}")
    return CorruptionSpec(strategy=strategy, level=level, params=dict(LEVELS[strategy][level]))


def _seed_rng(seed: int, *parts: Any) -> np.random.Generator:
    material = "|".join([str(seed), *[str(p) for p in parts], CORRUPTION_BANK_VERSION])
    digest = hashlib.sha256(material.encode("utf-8")).digest()
    seed_u64 = int.from_bytes(digest[:8], "little")
    return np.random.default_rng(seed_u64)


def read_wav_pcm16(path_or_bytes) -> tuple[np.ndarray, int]:
    if isinstance(path_or_bytes, (bytes, bytearray)):
        bio = BytesIO(path_or_bytes)
    else:
        bio = open(path_or_bytes, "rb")
    with wave.open(bio, "rb") as wf:
        if wf.getsampwidth() != 2:
            raise ValueError(f"expected 16-bit PCM, got sampwidth={wf.getsampwidth()}")
        if wf.getnchannels() not in (1, 2):
            raise ValueError(f"unsupported channels={wf.getnchannels()}")
        sr = wf.getframerate()
        raw = wf.readframes(wf.getnframes())
        ch = wf.getnchannels()
    audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32)
    if ch == 2:
        audio = audio.reshape(-1, 2).mean(axis=1)
    return audio, sr


def _float_audio_to_pcm16(audio: np.ndarray) -> np.ndarray:
    """Encode mono float audio to int16 PCM.

    Accepts either normalized float in approx [-1, 1] or already int16-scaled floats.
    """
    x = np.asarray(audio, dtype=np.float32)
    if x.size == 0:
        return np.zeros(0, dtype=np.int16)
    peak = float(np.max(np.abs(x)))
    if peak <= 1.0 + 1e-3:
        return (np.clip(x, -1.0, 1.0) * 32767.0).astype(np.int16)
    return np.clip(x, -32768, 32767).astype(np.int16)


def write_wav_pcm16(path: Path, audio: np.ndarray, sample_rate: int) -> None:
    pcm = _float_audio_to_pcm16(audio)
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm.tobytes())


def wav_bytes_pcm16(audio: np.ndarray, sample_rate: int) -> bytes:
    pcm = _float_audio_to_pcm16(audio)
    bio = BytesIO()
    with wave.open(bio, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm.tobytes())
    return bio.getvalue()


def resample_audio(audio: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
    if orig_sr == target_sr:
        return audio.astype(np.float32)
    if len(audio) == 0:
        return audio.astype(np.float32)
    n = max(1, int(round(len(audio) * target_sr / orig_sr)))
    idx = np.linspace(0, len(audio) - 1, n)
    return np.interp(idx, np.arange(len(audio)), audio.astype(np.float32)).astype(np.float32)


def apply_corruption(
    audio: np.ndarray,
    sample_rate: int,
    spec: CorruptionSpec,
    seed: int,
    sample_plan_id: str = "",
) -> tuple[np.ndarray, dict[str, Any]]:
    meta = {
        "bank_version": CORRUPTION_BANK_VERSION,
        **spec.to_dict(),
        "seed": seed,
        "note": (
            "Acoustic corruption may induce real ASR errors but MUST NOT be "
            "interpreted as specific pronunciation confusions (n/l, zh/z, tone)."
        ),
    }
    if spec.strategy == "NONE":
        return audio.copy(), meta

    rng = _seed_rng(seed, sample_plan_id, spec.strategy, spec.level)
    x = audio.astype(np.float32)

    if spec.strategy == "SPEED":
        rate = float(spec.params["rate"])
        n = max(1, int(round(len(x) / rate)))
        idx = np.linspace(0, len(x) - 1, n)
        y = np.interp(idx, np.arange(len(x)), x)
        return y, meta

    if spec.strategy == "VOLUME":
        gain = float(spec.params["gain"])
        return x * gain, meta

    if spec.strategy == "NOISE":
        snr_db = float(spec.params["snr_db"])
        signal_power = float(np.mean(x * x) + 1e-12)
        noise_power = signal_power / (10 ** (snr_db / 10.0))
        noise = rng.normal(0.0, math.sqrt(noise_power), size=len(x)).astype(np.float32)
        return x + noise, meta

    if spec.strategy == "REVERB":
        decay = float(spec.params["decay"])
        delay = max(1, int(sample_rate * float(spec.params["delay_ms"]) / 1000.0))
        y = x.copy()
        if delay < len(y):
            y[delay:] += decay * x[:-delay]
        return y, meta

    if spec.strategy == "PITCH":
        # Lightweight resampling pitch shift (duration changes slightly) — no large DSP deps.
        semitones = float(spec.params["semitones"])
        factor = 2 ** (semitones / 12.0)
        n = max(1, int(round(len(x) / factor)))
        idx = np.linspace(0, len(x) - 1, n)
        y = np.interp(idx, np.arange(len(x)), x)
        # Time-stretch back toward original length via linear resample
        idx2 = np.linspace(0, len(y) - 1, len(x))
        y2 = np.interp(idx2, np.arange(len(y)), y)
        return y2.astype(np.float32), meta

    raise ValueError(f"unhandled strategy {spec.strategy}")
