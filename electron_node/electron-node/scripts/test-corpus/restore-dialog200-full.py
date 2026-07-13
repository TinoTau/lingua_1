#!/usr/bin/env python3
"""Restore dialog_200 full corpus: 200 wav + cases.manifest.json (restored_full_v1).

Text SSOT: tone-module-p1-dialog-fw-scan.json (200 utterances)
Scenario SSOT: raw-log-delta-gate3-dialog200-batch-result.json
Audio: Piper TTS HTTP :5009 (16kHz mono wav), same chain as context_prior/gen_context_prior_wavs.py
"""
from __future__ import annotations

import argparse
import json
import struct
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
DIALOG_DIR = REPO / "test wav" / "dialog_200"
UTTERANCE_SOURCE = (
    REPO
    / "electron_node"
    / "electron-node"
    / "tests"
    / "experiments"
    / "tone-module-p1-dialog-fw-scan.json"
)
SCENARIO_SOURCE = (
    REPO
    / "electron_node"
    / "electron-node"
    / "tests"
    / "raw-log-delta-gate3-dialog200-batch-result.json"
)
MANIFEST_PATH = DIALOG_DIR / "cases.manifest.json"

TARGET_SR = 16000
MAX_EDGE_SILENCE_MS = 300
TTS_URL = "http://127.0.0.1:5009"
VOICE = "zh_CN-huayan-medium"


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


def trim_edge_silence(pcm16: bytes, sample_rate: int, max_edge_ms: int = MAX_EDGE_SILENCE_MS) -> bytes:
    import audioop

    samples = len(pcm16) // 2
    if samples == 0:
        return pcm16
    rms_window = max(1, int(sample_rate * 0.01))
    threshold = 350
    max_edge = int(sample_rate * max_edge_ms / 1000)

    def leading_silence_frames() -> int:
        pos = 0
        while pos < samples:
            chunk = pcm16[pos * 2 : (pos + rms_window) * 2]
            if not chunk:
                break
            if audioop.rms(chunk, 2) > threshold:
                return pos
            pos += rms_window
        return samples

    def trailing_silence_frames() -> int:
        pos = samples
        while pos > 0:
            start = max(0, pos - rms_window)
            chunk = pcm16[start * 2 : pos * 2]
            if not chunk:
                break
            if audioop.rms(chunk, 2) > threshold:
                return samples - pos
            pos -= rms_window
        return samples

    lead = leading_silence_frames()
    trail = trailing_silence_frames()
    keep_lead = min(lead, max_edge)
    keep_trail = min(trail, max_edge)
    start = max(0, lead - keep_lead)
    end = min(samples, samples - trail + keep_trail)
    if end <= start:
        return pcm16
    return pcm16[start * 2 : end * 2]


def write_wav(path: Path, pcm16: bytes, sample_rate: int, channels: int = 1):
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


def http_get(url: str, timeout: int = 8) -> int:
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.status


def tts_piper(text: str) -> bytes:
    body = json.dumps({"text": text, "voice": VOICE}).encode("utf-8")
    req = urllib.request.Request(
        f"{TTS_URL.rstrip('/')}/tts",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        return resp.read()


def load_cases() -> list[dict]:
    scan = json.loads(UTTERANCE_SOURCE.read_text(encoding="utf-8"))
    batch = json.loads(SCENARIO_SOURCE.read_text(encoding="utf-8"))
    utterances = {c["id"]: c["utterance"] for c in scan.get("cases", [])}
    scenarios = {c["id"]: c.get("scenario", "general") for c in batch.get("cases", [])}
    cases = []
    for i in range(1, 201):
        cid = f"d{i:03d}"
        text = utterances.get(cid)
        if not text:
            raise SystemExit(f"missing utterance for {cid} in {UTTERANCE_SOURCE}")
        cases.append(
            {
                "id": cid,
                "file": f"dialog_{cid}.wav",
                "audio": f"dialog_{cid}.wav",
                "utterance": text,
                "text": text,
                "expectedText": text,
                "language": "zh",
                "scenario": scenarios.get(cid, "general"),
                "sourceAudio": "generated_piper_restored_full_v1",
            }
        )
    return cases


def synthesize_wav(text: str, out_path: Path) -> dict:
    wav_bytes = tts_piper(text)
    sr, ch, pcm = parse_wav(wav_bytes)
    if sr != TARGET_SR:
        pcm = resample_pcm16(pcm, sr, TARGET_SR)
        sr = TARGET_SR
    if ch != 1:
        import audioop

        pcm = audioop.tomono(pcm, 2, 0.5, 0.5)
        ch = 1
    pcm = trim_edge_silence(pcm, TARGET_SR)
    write_wav(out_path, pcm, TARGET_SR, 1)
    duration = len(pcm) / 2 / TARGET_SR
    return {"bytes": out_path.stat().st_size, "duration_sec": round(duration, 3), "sample_rate": TARGET_SR}


def main() -> int:
    parser = argparse.ArgumentParser(description="Restore dialog_200 full corpus (200 wav + manifest)")
    parser.add_argument("--skip-existing", action="store_true", help="Skip wav if file already exists")
    parser.add_argument("--only", type=str, default="", help="Comma-separated ids e.g. d001,d002")
    args = parser.parse_args()

    DIALOG_DIR.mkdir(parents=True, exist_ok=True)

    try:
        if http_get(f"{TTS_URL}/health") != 200:
            raise RuntimeError("health not 200")
    except Exception as exc:
        print(f"Piper TTS unavailable ({TTS_URL}): {exc}", file=sys.stderr)
        print("Start Electron Node with piper-tts enabled (port 5009).", file=sys.stderr)
        return 1

    cases = load_cases()
    only_set = {x.strip() for x in args.only.split(",") if x.strip()} if args.only else None
    generated = 0
    skipped = 0
    t0 = time.time()

    for case in cases:
        cid = case["id"]
        if only_set and cid not in only_set:
            continue
        out_path = DIALOG_DIR / case["file"]
        if args.skip_existing and out_path.is_file() and out_path.stat().st_size > 1000:
            skipped += 1
            continue
        print(f"[{cid}] synthesizing: {case['utterance'][:48]}…")
        meta = synthesize_wav(case["utterance"], out_path)
        case["wavBytes"] = meta["bytes"]
        case["durationSec"] = meta["duration_sec"]
        generated += 1

    restored_at = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    manifest = {
        "corpus": "dialog_200",
        "version": "restored_full_v1",
        "caseCount": 200,
        "isFullCorpus": True,
        "restoredAt": restored_at,
        "textSource": str(UTTERANCE_SOURCE.relative_to(REPO)).replace("\\", "/"),
        "scenarioSource": str(SCENARIO_SOURCE.relative_to(REPO)).replace("\\", "/"),
        "audioSource": "piper_tts_http_5009",
        "audioSourceNote": (
            f"Piper TTS ({TTS_URL}, voice={VOICE}) → 16kHz mono wav; "
            "text aligned per utterance (not copied/reused across cases)."
        ),
        "cases": cases,
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    elapsed = time.time() - t0
    print(f"manifest: {MANIFEST_PATH}")
    print(f"generated={generated} skipped={skipped} elapsed={elapsed:.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
