"""Piper TTS HTTP client — production service only, no TTS fallback."""

from __future__ import annotations

import hashlib
import json
import struct
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from training.model2.constants import (
    DEFAULT_TTS_PORT,
    DEFAULT_TTS_SERVICE_ID,
    DEFAULT_TTS_VOICE,
)


class PiperUnavailableError(RuntimeError):
    pass


class PiperInvalidAudioError(RuntimeError):
    pass


@dataclass
class PiperSynthResult:
    wav_bytes: bytes
    sample_rate: int
    channels: int
    voice: str
    latency_ms: float
    model_path: Optional[str] = None
    model_sha256: Optional[str] = None
    service_id: str = DEFAULT_TTS_SERVICE_ID
    service_version: Optional[str] = None


def parse_wav_header(wav_bytes: bytes) -> tuple[int, int, int]:
    if len(wav_bytes) < 44 or wav_bytes[:4] != b"RIFF" or wav_bytes[8:12] != b"WAVE":
        raise PiperInvalidAudioError("invalid WAV container")
    offset = 12
    sr, ch, bits = 16000, 1, 16
    while offset + 8 <= len(wav_bytes):
        chunk_id = wav_bytes[offset : offset + 4]
        chunk_size = struct.unpack_from("<I", wav_bytes, offset + 4)[0]
        if chunk_id == b"fmt " and chunk_size >= 16:
            ch = struct.unpack_from("<H", wav_bytes, offset + 10)[0]
            sr = struct.unpack_from("<I", wav_bytes, offset + 12)[0]
            bits = struct.unpack_from("<H", wav_bytes, offset + 22)[0]
        elif chunk_id == b"data":
            break
        offset += 8 + chunk_size
    if bits != 16:
        raise PiperInvalidAudioError(f"expected 16-bit PCM, got bits={bits}")
    if ch not in (1, 2):
        raise PiperInvalidAudioError(f"unexpected channels={ch}")
    return sr, ch, bits


class PiperTtsClient:
    def __init__(
        self,
        base_url: str = f"http://127.0.0.1:{DEFAULT_TTS_PORT}",
        voice: str = DEFAULT_TTS_VOICE,
        timeout_s: float = 60.0,
        retries: int = 2,
        expected_sample_rate: Optional[int] = None,
        service_json_path: Optional[Path] = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.voice = voice
        self.timeout_s = timeout_s
        self.retries = retries
        self.expected_sample_rate = expected_sample_rate
        self.service_meta = self._load_service_meta(service_json_path)

    @staticmethod
    def _load_service_meta(path: Optional[Path]) -> dict[str, Any]:
        if path is None:
            path = (
                Path(__file__).resolve().parents[3]
                / "electron_node"
                / "services"
                / "piper_tts"
                / "service.json"
            )
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8"))
        return {"id": DEFAULT_TTS_SERVICE_ID, "version": None, "port": DEFAULT_TTS_PORT}

    def health(self) -> dict[str, Any]:
        try:
            with urllib.request.urlopen(f"{self.base_url}/health", timeout=self.timeout_s) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            raise PiperUnavailableError(f"Piper health failed: {e}") from e

    def voices(self) -> dict[str, Any]:
        with urllib.request.urlopen(f"{self.base_url}/voices", timeout=self.timeout_s) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def lock_config(self) -> dict[str, Any]:
        health = self.health()
        if health.get("status") not in ("ok", "healthy"):
            raise PiperUnavailableError(f"Piper not ready: {health}")
        voices = self.voices().get("voices") or []
        voice_entry = next((v for v in voices if v.get("name") == self.voice), None)
        model_path = voice_entry.get("path") if voice_entry else None
        model_sha = None
        if model_path and Path(model_path).is_file():
            model_sha = hashlib.sha256(Path(model_path).read_bytes()).hexdigest()
        return {
            "tts_service_id": self.service_meta.get("id", DEFAULT_TTS_SERVICE_ID),
            "tts_service_version": self.service_meta.get("version"),
            "tts_port": self.service_meta.get("port", DEFAULT_TTS_PORT),
            "tts_voice_id": self.voice,
            "tts_model_id": self.voice,
            "tts_model_path": model_path,
            "tts_model_sha256": model_sha,
            "tts_health": health,
            "base_url": self.base_url,
        }

    def synthesize(self, text: str, voice: Optional[str] = None) -> PiperSynthResult:
        voice = voice or self.voice
        payload = json.dumps({"text": text, "voice": voice}, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            f"{self.base_url}/tts",
            data=payload,
            headers={"Content-Type": "application/json; charset=utf-8"},
            method="POST",
        )
        last_err: Optional[Exception] = None
        for attempt in range(self.retries + 1):
            t0 = time.perf_counter()
            try:
                with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:
                    wav_bytes = resp.read()
                latency_ms = (time.perf_counter() - t0) * 1000.0
                sr, ch, _ = parse_wav_header(wav_bytes)
                if self.expected_sample_rate is not None and sr != self.expected_sample_rate:
                    raise PiperInvalidAudioError(
                        f"unexpected sample_rate={sr}, expected={self.expected_sample_rate}"
                    )
                return PiperSynthResult(
                    wav_bytes=wav_bytes,
                    sample_rate=sr,
                    channels=ch,
                    voice=voice,
                    latency_ms=latency_ms,
                    service_id=self.service_meta.get("id", DEFAULT_TTS_SERVICE_ID),
                    service_version=self.service_meta.get("version"),
                )
            except urllib.error.HTTPError as e:
                last_err = e
                if e.code >= 500 and attempt < self.retries:
                    time.sleep(0.5 * (attempt + 1))
                    continue
                raise PiperUnavailableError(f"Piper HTTP {e.code}: {e.read()[:200]!r}") from e
            except urllib.error.URLError as e:
                last_err = e
                if attempt < self.retries:
                    time.sleep(0.5 * (attempt + 1))
                    continue
                raise PiperUnavailableError(f"Piper unavailable: {e}") from e
            except PiperInvalidAudioError:
                raise
            except Exception as e:
                last_err = e
                if attempt < self.retries:
                    time.sleep(0.5 * (attempt + 1))
                    continue
                raise PiperUnavailableError(f"Piper failed: {e}") from e
        raise PiperUnavailableError(f"Piper failed after retries: {last_err}")
