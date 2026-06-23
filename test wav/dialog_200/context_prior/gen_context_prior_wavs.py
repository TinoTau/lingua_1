#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""合成 Context Prior E2E 激活测试 WAV（Piper TTS 5009），与 gen_dialog_200_wavs.py 同链路。"""
import json
import struct
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

TARGET_SR = 16000
MAX_EDGE_SILENCE_MS = 300
TTS_URL = "http://127.0.0.1:5009"
VOICE = "zh_CN-huayan-medium"
OUT_DIR = Path(__file__).resolve().parent
MANIFEST_PATH = OUT_DIR / "context_prior_manifest.json"
REPORT_PATH = OUT_DIR / "CONTEXT_PRIOR_AUDIO_GENERATION_REPORT.md"

CASES = [
    ("cp_001", "cp_001_hotel_latte.wav", "帮我确认酒店订单，然后给我来一个蓝莓马芬和中杯拿铁。"),
    ("cp_002", "cp_002_airport_coffee.wav", "机场接送确认以后，再帮我点一份蓝莓马芬和咖啡。"),
    ("cp_003", "cp_003_hotel_americano.wav", "我想预订明天的酒店，不过现在先来一杯热美式。"),
    ("cp_004", "cp_004_pickup_breakfast.wav", "接机服务安排好了没有，如果好了我再点一份早餐套餐。"),
    ("cp_005", "cp_005_hotel_frontdesk.wav", "中杯少糖拿铁送到酒店前台。"),
    ("cp_006", "cp_006_travel_coffee.wav", "帮我预订酒店顺便点一杯咖啡。"),
    ("cp_007", "cp_007_airport_breakfast.wav", "接送服务确认以后我要点早餐。"),
    ("cp_008", "cp_008_hotel_muffin.wav", "我要确认酒店订单，再买一个蓝莓马芬。"),
    ("cp_009", "cp_009_pickup_latte.wav", "帮我安排接机，然后来一杯拿铁。"),
    ("cp_010", "cp_010_hotel_coffee.wav", "酒店确认好了以后给我来一杯热咖啡。"),
]


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


def duration_sec(pcm16: bytes, sample_rate: int) -> float:
    return len(pcm16) / 2 / sample_rate


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    try:
        if http_get(f"{TTS_URL}/health") != 200:
            raise RuntimeError("health not 200")
    except Exception as e:
        print(f"Piper TTS 不可用 ({TTS_URL}): {e}", file=sys.stderr)
        print("请先启动节点并确保 Piper TTS(5009) 已就绪。", file=sys.stderr)
        return 1

    manifest = []
    rows = []
    t0 = time.time()
    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    for case_id, filename, text in CASES:
        out_path = OUT_DIR / filename
        print(f"合成 {filename}: {text}")
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
        dur = duration_sec(pcm, TARGET_SR)
        manifest.append({"id": case_id, "file": filename, "text": text})
        rows.append(
            {
                "id": case_id,
                "file": filename,
                "text": text,
                "duration_sec": round(dur, 3),
                "sample_rate": TARGET_SR,
                "channels": 1,
                "path": str(out_path),
            }
        )
        print(f"  -> {out_path} ({dur:.2f}s)")

    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    report_lines = [
        "# Context Prior E2E Activation — Audio Generation Report",
        "",
        f"- **Generated at (UTC):** {generated_at}",
        f"- **TTS tool:** Piper HTTP (`{TTS_URL}`)",
        f"- **Voice:** `{VOICE}`",
        f"- **Reference script:** `test wav/dialog_200/gen_dialog_200_wavs.py` (same Piper chain)",
        f"- **Generator:** `gen_context_prior_wavs.py`",
        f"- **Wall clock:** {time.time() - t0:.1f}s",
        "",
        "## Output directory",
        "",
        f"`{OUT_DIR}`",
        "",
        "## Manifest",
        "",
        f"`{MANIFEST_PATH}`",
        "",
        "## Generated files",
        "",
        "| File | Text | Duration (s) | Sample rate |",
        "|------|------|--------------|-------------|",
    ]
    for r in rows:
        report_lines.append(
            f"| `{r['file']}` | {r['text']} | {r['duration_sec']} | {r['sample_rate']} Hz mono |"
        )
    report_lines.extend(
        [
            "",
            "## ffprobe validation",
            "",
            "Run after generation:",
            "",
            "```powershell",
            f'ffprobe -hide_banner -show_streams "{OUT_DIR / "*.wav"}"',
            "```",
            "",
            "Expected per file: `codec_name=pcm_s16le`, `sample_rate=16000`, `channels=1`.",
            "",
        ]
    )
    REPORT_PATH.write_text("\n".join(report_lines), encoding="utf-8")

    print(f"\nManifest: {MANIFEST_PATH}")
    print(f"Report:   {REPORT_PATH}")
    print(json.dumps(rows, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
