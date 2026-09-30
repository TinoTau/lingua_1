"""Phoneme realizer — Backend B (espeak cmn via training-only Piper path)."""

from __future__ import annotations

import json
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from training.model2.adapters.piper_tts_client import parse_wav_header
from training.model2.constants import DEFAULT_TTS_VOICE
from training.model2.pronunciation.espeak_cmn import apply_family_to_espeak
from training.model2.pronunciation.pronunciation_syllable import PronunciationSyllable

PHONEME_REALIZER_VERSION = "phoneme-realizer-v1"


@dataclass
class PhonemeRealization:
    ok: bool
    phonemes: list[str]
    backend_path: str  # HTTP | LOCAL
    status: str
    notes: str = ""
    wav_bytes: bytes = field(default=b"", repr=False)

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "phonemes": self.phonemes,
            "backend_path": self.backend_path,
            "status": self.status,
            "notes": self.notes,
            "backend": "PHONEME",
            "version": PHONEME_REALIZER_VERSION,
            "wav_bytes_len": len(self.wav_bytes),
        }


class PhonemeRealizer:
    """Build corrupted espeak sequences and synthesize via training-only API or local Piper."""

    def __init__(
        self,
        *,
        base_url: str = "http://127.0.0.1:5009",
        voice: str = DEFAULT_TTS_VOICE,
        model_path: Optional[Path] = None,
        prefer_http: bool = True,
        timeout_s: float = 60.0,
    ):
        self.base_url = base_url.rstrip("/")
        self.voice = voice
        self.model_path = model_path
        self.prefer_http = prefer_http
        self.timeout_s = timeout_s
        self._local_voice = None
        self._http_pron_ok: Optional[bool] = None

    def phonemize_text(self, text: str) -> list[str]:
        if self.prefer_http and self._http_available():
            payload = json.dumps({"text": text, "voice": self.voice}, ensure_ascii=False).encode()
            req = urllib.request.Request(
                f"{self.base_url}/tts-phonemize",
                data=payload,
                headers={"Content-Type": "application/json; charset=utf-8"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            sents = data.get("sentences") or [[]]
            # join sentences with space
            out: list[str] = []
            for i, s in enumerate(sents):
                if i and out and out[-1] != " ":
                    out.append(" ")
                out.extend(s)
            return out
        voice = self._get_local_voice()
        sents = voice.phonemize(text)
        out = []
        for i, s in enumerate(sents):
            if i and out:
                out.append(" ")
            out.extend(s)
        return out

    def build_sentence_phonemes(
        self,
        *,
        ground_truth_text: str,
        ground_truth_term: str,
        canonical_syllables: list[PronunciationSyllable],
        corrupted_syllables: list[PronunciationSyllable],
        family: str,
        corrupted_positions: list[int],
    ) -> list[str]:
        """Phonemize GT text; replace term-char phoneme spans for corrupted positions."""
        if ground_truth_term not in ground_truth_text:
            return self.phonemize_text(ground_truth_text)
        # Per-character rebuild for the term span
        left, _, right = ground_truth_text.partition(ground_truth_term)
        parts: list[str] = []
        if left:
            parts.extend(self.phonemize_text(left))
            if parts and parts[-1] != " ":
                parts.append(" ")
        term_chars = list(ground_truth_term)
        for i, ch in enumerate(term_chars):
            if i > 0:
                parts.append(" ")
            can = canonical_syllables[i] if i < len(canonical_syllables) else None
            if i in corrupted_positions and can is not None:
                base_ph = self.phonemize_text(ch)
                # single syllable expected
                ph = apply_family_to_espeak(base_ph, family, can)
                parts.extend(ph)
            else:
                parts.extend(self.phonemize_text(ch))
        if right:
            if parts and parts[-1] != " ":
                parts.append(" ")
            parts.extend(self.phonemize_text(right))
        return parts

    def synthesize_phonemes(self, phonemes: list[str]) -> PhonemeRealization:
        if not phonemes:
            return PhonemeRealization(False, [], "NONE", "UNREALIZABLE_BY_CURRENT_BACKEND", "empty")
        if self.prefer_http and self._http_available():
            try:
                wav = self._http_synth(phonemes)
                return PhonemeRealization(True, phonemes, "HTTP", "PHONEME_REALIZED", wav_bytes=wav)
            except Exception as e:
                # fall through to local
                notes = f"http_failed:{e}"
            else:
                notes = ""
        else:
            notes = "http_unavailable"
        try:
            wav = self._local_synth(phonemes)
            return PhonemeRealization(
                True, phonemes, "LOCAL", "PHONEME_REALIZED", notes=notes, wav_bytes=wav
            )
        except Exception as e:
            return PhonemeRealization(
                False,
                phonemes,
                "LOCAL",
                "UNREALIZABLE_BY_CURRENT_BACKEND",
                notes=f"{notes}; local_failed:{e}",
            )

    def _http_available(self) -> bool:
        if self._http_pron_ok is not None:
            return self._http_pron_ok
        try:
            # probe with tiny request — may 404 if service not restarted
            req = urllib.request.Request(
                f"{self.base_url}/tts-phonemize",
                data=json.dumps({"text": "一", "voice": self.voice}).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                self._http_pron_ok = resp.status == 200
        except Exception:
            self._http_pron_ok = False
        return self._http_pron_ok

    def _http_synth(self, phonemes: list[str]) -> bytes:
        payload = json.dumps(
            {"voice": self.voice, "phonemes": phonemes, "note": "TRAINING_ONLY"},
            ensure_ascii=False,
        ).encode()
        req = urllib.request.Request(
            f"{self.base_url}/tts-pronunciation",
            data=payload,
            headers={"Content-Type": "application/json; charset=utf-8"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:
            return resp.read()

    def _default_model_path(self) -> Path:
        if self.model_path:
            return self.model_path
        root = Path(__file__).resolve().parents[3]
        return (
            root
            / "electron_node/services/piper_tts/models/zh/zh_CN-huayan-medium/zh_CN-huayan-medium.onnx"
        )

    def _get_local_voice(self):
        if self._local_voice is None:
            from piper.voice import PiperVoice

            mp = self._default_model_path()
            self._local_voice = PiperVoice.load(str(mp), config_path=str(mp) + ".json", use_cuda=False)
        return self._local_voice

    def _local_synth(self, phonemes: list[str]) -> bytes:
        import numpy as np
        from piper.config import SynthesisConfig

        import io
        import wave

        voice = self._get_local_voice()
        ids = voice.phonemes_to_ids(phonemes)
        audio = voice.phoneme_ids_to_audio(ids, SynthesisConfig())
        pcm = (np.clip(audio, -1, 1) * 32767).astype(np.int16)
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(voice.config.sample_rate)
            w.writeframes(pcm.tobytes())
        return buf.getvalue()
