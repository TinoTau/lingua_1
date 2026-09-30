"""Production faster-whisper-vad HTTP client — no ASR fallback."""

from __future__ import annotations

import base64
import json
import time
import urllib.error
import urllib.request
import wave
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path
from typing import Any, Optional

from training.model2.constants import (
    DEFAULT_ASR_PORT,
    DEFAULT_ASR_SAMPLE_RATE,
    DEFAULT_ASR_SERVICE_ID,
)


class AsrUnavailableError(RuntimeError):
    pass


class AsrInvalidResponseError(RuntimeError):
    pass


@dataclass
class AsrWord:
    word: str
    start: Optional[float] = None
    end: Optional[float] = None
    probability: Optional[float] = None


@dataclass
class AsrHypothesis:
    text: str
    language: Optional[str]
    duration: float
    words: list[AsrWord] = field(default_factory=list)
    segments: list[dict[str, Any]] = field(default_factory=list)
    diagnostics: Optional[dict[str, Any]] = None
    latency_ms: float = 0.0
    raw: Optional[dict[str, Any]] = None


def wav_to_pcm16_mono(wav_bytes: bytes, expected_sr: int = DEFAULT_ASR_SAMPLE_RATE) -> tuple[bytes, int]:
    with wave.open(BytesIO(wav_bytes), "rb") as wf:
        sr = wf.getframerate()
        ch = wf.getnchannels()
        sw = wf.getsampwidth()
        frames = wf.readframes(wf.getnframes())
    if sw != 2:
        raise AsrInvalidResponseError(f"PCM width {sw} not supported")
    if sr != expected_sr:
        raise AsrInvalidResponseError(f"sample_rate {sr} != expected {expected_sr}")
    if ch == 1:
        return frames, sr
    if ch == 2:
        import array

        a = array.array("h")
        a.frombytes(frames)
        mono = array.array("h", ((a[i] + a[i + 1]) // 2 for i in range(0, len(a), 2)))
        return mono.tobytes(), sr
    raise AsrInvalidResponseError(f"channels={ch}")


class FasterWhisperClient:
    def __init__(
        self,
        base_url: str = f"http://127.0.0.1:{DEFAULT_ASR_PORT}",
        timeout_s: float = 120.0,
        retries: int = 1,
        sample_rate: int = DEFAULT_ASR_SAMPLE_RATE,
        service_json_path: Optional[Path] = None,
        language: str = "zh",
        beam_size: Optional[int] = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.timeout_s = timeout_s
        self.retries = retries
        self.sample_rate = sample_rate
        self.language = language
        self.beam_size = beam_size
        self.service_meta = self._load_service_meta(service_json_path)

    @staticmethod
    def _load_service_meta(path: Optional[Path]) -> dict[str, Any]:
        if path is None:
            path = (
                Path(__file__).resolve().parents[3]
                / "electron_node"
                / "services"
                / "faster_whisper_vad"
                / "service.json"
            )
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8"))
        return {
            "id": DEFAULT_ASR_SERVICE_ID,
            "version": None,
            "port": DEFAULT_ASR_PORT,
            "env": {},
        }

    def health(self) -> dict[str, Any]:
        try:
            with urllib.request.urlopen(f"{self.base_url}/health", timeout=self.timeout_s) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            raise AsrUnavailableError(f"ASR health failed: {e}") from e

    def lock_config(self) -> dict[str, Any]:
        health = self.health()
        if health.get("status") not in ("ok", "healthy"):
            raise AsrUnavailableError(f"ASR not ready: {health}")
        env = self.service_meta.get("env") or {}
        model_path = health.get("asr_model_path")
        if not model_path:
            raise AsrUnavailableError("ASR health missing asr_model_path — cannot lock model")
        compute = health.get("compute_type") or env.get("ASR_COMPUTE_TYPE")
        if not compute:
            raise AsrUnavailableError("ASR health missing compute_type — cannot lock config")
        return {
            "asr_service_id": self.service_meta.get("id", DEFAULT_ASR_SERVICE_ID),
            "asr_service_version": self.service_meta.get("version"),
            "asr_port": self.service_meta.get("port", DEFAULT_ASR_PORT),
            "asr_model_id": Path(str(model_path)).name,
            "asr_model_path": model_path,
            "asr_model_version": env.get("ASR_MODEL"),
            "asr_compute_type": compute,
            "asr_beam_size_service_default": env.get("ASR_BEAM_SIZE"),
            "asr_device": health.get("device"),
            "asr_health": health,
            "base_url": self.base_url,
            "language": self.language,
        }

    def transcribe_wav(
        self,
        wav_bytes: bytes,
        job_id: str,
        *,
        language: Optional[str] = None,
    ) -> AsrHypothesis:
        pcm, sr = wav_to_pcm16_mono(wav_bytes, expected_sr=self.sample_rate)
        return self.transcribe_pcm16(pcm, job_id=job_id, sample_rate=sr, language=language)

    def transcribe_pcm16(
        self,
        pcm16: bytes,
        job_id: str,
        *,
        sample_rate: int = DEFAULT_ASR_SAMPLE_RATE,
        language: Optional[str] = None,
    ) -> AsrHypothesis:
        lang = language or self.language
        body: dict[str, Any] = {
            "job_id": job_id,
            "src_lang": lang,
            "language": lang,
            "audio": base64.b64encode(pcm16).decode("ascii"),
            "audio_format": "pcm16",
            "sample_rate": sample_rate,
            "task": "transcribe",
            "condition_on_previous_text": False,
            "use_context_buffer": False,
            "use_text_context": False,
            "skip_text_dedup": True,
        }
        if self.beam_size is not None:
            body["beam_size"] = self.beam_size
        payload = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            f"{self.base_url}/utterance",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        last_err: Optional[Exception] = None
        for attempt in range(self.retries + 1):
            t0 = time.perf_counter()
            try:
                with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                latency_ms = (time.perf_counter() - t0) * 1000.0
                return self._parse_response(data, latency_ms)
            except urllib.error.HTTPError as e:
                last_err = e
                if e.code >= 500 and attempt < self.retries:
                    time.sleep(0.5 * (attempt + 1))
                    continue
                raise AsrUnavailableError(f"ASR HTTP {e.code}: {e.read()[:300]!r}") from e
            except urllib.error.URLError as e:
                last_err = e
                if attempt < self.retries:
                    time.sleep(0.5 * (attempt + 1))
                    continue
                raise AsrUnavailableError(f"ASR unavailable: {e}") from e
            except AsrInvalidResponseError:
                raise
            except Exception as e:
                last_err = e
                if attempt < self.retries:
                    time.sleep(0.5 * (attempt + 1))
                    continue
                raise AsrUnavailableError(f"ASR failed: {e}") from e
        raise AsrUnavailableError(f"ASR failed after retries: {last_err}")

    @staticmethod
    def _parse_response(data: dict[str, Any], latency_ms: float) -> AsrHypothesis:
        if "text" not in data:
            raise AsrInvalidResponseError("missing text field")
        words: list[AsrWord] = []
        for seg in data.get("segments") or []:
            for w in seg.get("words") or []:
                words.append(
                    AsrWord(
                        word=str(w.get("word") or w.get("text") or ""),
                        start=w.get("start"),
                        end=w.get("end"),
                        probability=w.get("probability"),
                    )
                )
        return AsrHypothesis(
            text=str(data.get("text") or "").strip(),
            language=data.get("language"),
            duration=float(data.get("duration") or 0.0),
            words=words,
            segments=list(data.get("segments") or []),
            diagnostics=data.get("diagnostics"),
            latency_ms=latency_ms,
            raw=data,
        )
