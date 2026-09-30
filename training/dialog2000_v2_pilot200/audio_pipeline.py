# -*- coding: utf-8 -*-
"""Audio generation: Corruptor surface → Piper /tts, else PhonemeRealizer."""

from __future__ import annotations

import hashlib
import json
import struct
import urllib.request
from pathlib import Path
from typing import Any

from training.dialog2000_v2_pilot200.constants import TARGET_SR, TTS_URL, TTS_VOICE
from training.model2.phonetic.syllables import syllables_from_text_tone_num
from training.model2.pronunciation.corruptor import PronunciationCorruptorV1
from training.model2.pronunciation.phoneme_realizer import PhonemeRealizer
from training.model2.pronunciation.pronunciation_syllable import PronunciationSyllable
from training.model2.pronunciation.realizer import PronunciationRealizer


def parse_wav(wav_bytes: bytes):
    if wav_bytes[:4] != b"RIFF" or wav_bytes[8:12] != b"WAVE":
        raise ValueError("Invalid WAV")
    sr, ch, data_offset, data_size = 16000, 1, None, 0
    offset = 12
    while offset + 8 <= len(wav_bytes):
        chunk_id = wav_bytes[offset : offset + 4].decode("ascii", errors="ignore")
        chunk_size = struct.unpack_from("<I", wav_bytes, offset + 4)[0]
        if chunk_id == "fmt " and chunk_size >= 16:
            ch = struct.unpack_from("<H", wav_bytes, offset + 10)[0]
            sr = struct.unpack_from("<I", wav_bytes, offset + 12)[0]
        elif chunk_id == "data":
            data_offset = offset + 8
            data_size = chunk_size
            break
        offset += 8 + chunk_size
    pcm = wav_bytes[data_offset : data_offset + data_size]
    return sr, ch, pcm


def resample_pcm16(pcm16: bytes, orig_sr: int, target_sr: int) -> bytes:
    if orig_sr == target_sr:
        return pcm16
    import audioop

    return audioop.ratecv(pcm16, 2, 1, orig_sr, target_sr, None)[0]


def write_wav(path: Path, pcm16: bytes, sample_rate: int, channels: int = 1) -> None:
    size = len(pcm16)
    header = bytearray(44)
    header[0:4] = b"RIFF"
    struct.pack_into("<I", header, 4, 36 + size)
    header[8:12] = b"WAVE"
    header[12:16] = b"fmt "
    struct.pack_into("<I", header, 16, 16)
    struct.pack_into("<H", header, 20, 1)
    struct.pack_into("<H", header, 22, channels)
    struct.pack_into("<I", header, 24, sample_rate)
    struct.pack_into("<I", header, 28, sample_rate * channels * 2)
    struct.pack_into("<H", header, 32, channels * 2)
    struct.pack_into("<H", header, 34, 16)
    header[36:40] = b"data"
    struct.pack_into("<I", header, 40, size)
    path.write_bytes(bytes(header) + pcm16)


def tts_health(url: str = TTS_URL) -> bool:
    try:
        req = urllib.request.Request(f"{url.rstrip('/')}/health", method="GET")
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status == 200
    except Exception:
        return False


def tts_piper(text: str, *, url: str = TTS_URL, voice: str = TTS_VOICE) -> bytes:
    body = json.dumps({"text": text, "voice": voice}).encode("utf-8")
    req = urllib.request.Request(
        f"{url.rstrip('/')}/tts",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        return resp.read()


def normalize_wav_bytes(wav_bytes: bytes) -> tuple[bytes, dict[str, Any]]:
    sr, ch, pcm = parse_wav(wav_bytes)
    if sr != TARGET_SR:
        pcm = resample_pcm16(pcm, sr, TARGET_SR)
        sr = TARGET_SR
    if ch != 1:
        import audioop

        pcm = audioop.tomono(pcm, 2, 0.5, 0.5)
        ch = 1
    duration = len(pcm) / 2 / sr
    # rebuild wav
    import io

    buf = io.BytesIO()
    # write via temp path helper
    size = len(pcm)
    header = bytearray(44)
    header[0:4] = b"RIFF"
    struct.pack_into("<I", header, 4, 36 + size)
    header[8:12] = b"WAVE"
    header[12:16] = b"fmt "
    struct.pack_into("<I", header, 16, 16)
    struct.pack_into("<H", header, 20, 1)
    struct.pack_into("<H", header, 22, 1)
    struct.pack_into("<I", header, 24, sr)
    struct.pack_into("<I", header, 28, sr * 2)
    struct.pack_into("<H", header, 32, 2)
    struct.pack_into("<H", header, 34, 16)
    header[36:40] = b"data"
    struct.pack_into("<I", header, 40, size)
    out = bytes(header) + pcm
    meta = {
        "sample_rate": sr,
        "channels": 1,
        "duration": round(duration, 3),
        "byte_size": len(out),
        "sha256": hashlib.sha256(out).hexdigest(),
    }
    return out, meta


class AudioPipeline:
    def __init__(self, tts_url: str = TTS_URL, voice: str = TTS_VOICE):
        self.tts_url = tts_url
        self.voice = voice
        self.corruptor = PronunciationCorruptorV1()
        self.phoneme = PhonemeRealizer(base_url=tts_url, voice=voice, prefer_http=True)
        self.realizer = PronunciationRealizer(phoneme=self.phoneme)

    def synthesize_clean(self, reference_text: str, out_path: Path) -> dict[str, Any]:
        wav = tts_piper(reference_text, url=self.tts_url, voice=self.voice)
        data, meta = normalize_wav_bytes(wav)
        out_path.write_bytes(data)
        meta.update(
            {
                "perturbationApplied": False,
                "tts_backend": "PIPER_TTS_SURFACE",
                "tts_input_text": reference_text,
            }
        )
        return meta

    def synthesize_perturbed(
        self,
        *,
        reference_text: str,
        target_term: str,
        family: str,
        out_path: Path,
    ) -> dict[str, Any]:
        plan = self.corruptor.corrupt(
            ground_truth_text=reference_text,
            ground_truth_term=target_term,
            family=family,
        )
        if plan.realizable and plan.tts_input_text:
            wav = tts_piper(plan.tts_input_text, url=self.tts_url, voice=self.voice)
            data, meta = normalize_wav_bytes(wav)
            out_path.write_bytes(data)
            meta.update(
                {
                    "perturbationApplied": True,
                    "tts_backend": "CORRUPTOR_SURFACE_PIPER",
                    "tts_input_text": plan.tts_input_text,
                    "tts_surface": plan.tts_surface,
                    "relationDirection": family,
                    "corrupted_positions": plan.corrupted_positions,
                    "corruptor_version": plan.corruptor_version,
                }
            )
            return meta

        # Phoneme fallback (still acoustic path; not text-only ASR injection)
        toned = syllables_from_text_tone_num(target_term) or []
        cans: list[PronunciationSyllable] = []
        for s in toned:
            ps = PronunciationSyllable.from_compact(s)
            if ps:
                cans.append(ps)
        if not cans:
            # last resort: clean TTS of reference — mark unrealizable
            meta = self.synthesize_clean(reference_text, out_path)
            meta.update(
                {
                    "perturbationApplied": False,
                    "perturbation_failed": True,
                    "unrealizable_reason": plan.unrealizable_reason or "NO_SYLLABLES",
                }
            )
            return meta
        mask = [True] * len(cans)
        rplan = self.realizer.realize_term_corruption(
            ground_truth_text=reference_text,
            ground_truth_term=target_term,
            family=family,
            canonical_syllables=cans,
            apply_mask=mask,
            force_phoneme=True,
        )
        if rplan.backend == "PHONEME" and rplan.phoneme_result and rplan.phoneme_result.ok:
            data, meta = normalize_wav_bytes(rplan.phoneme_result.wav_bytes)
            out_path.write_bytes(data)
            meta.update(
                {
                    "perturbationApplied": True,
                    "tts_backend": "PHONEME_REALIZER",
                    "tts_input_text": reference_text,
                    "relationDirection": family,
                    "corrupted_positions": rplan.corrupted_positions,
                    "phonemes": rplan.phonemes,
                }
            )
            return meta

        meta = self.synthesize_clean(reference_text, out_path)
        meta.update(
            {
                "perturbationApplied": False,
                "perturbation_failed": True,
                "unrealizable_reason": rplan.notes or plan.unrealizable_reason,
                "tts_backend": "FALLBACK_CLEAN",
            }
        )
        return meta
