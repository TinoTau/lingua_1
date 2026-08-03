#!/usr/bin/env python3
"""TEMP: FW-direct Tone full-chain evidence collector (no Decision change).

Posts dialog_200 wavs to http://127.0.0.1:6007/utterance and saves:
  ASR words+timestamps, acousticToneSlices+posterior, text.

Then invokes Node analyzer for WordTimeSpan / Pattern / Readiness metrics.
"""
from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import wave
from pathlib import Path
from typing import Any, Dict, List, Tuple

ROOT = Path(__file__).resolve().parents[3]
DIALOG = ROOT / "test wav" / "dialog_200"
OUT = Path(__file__).resolve().parent / "tone_full_chain_runtime_2026_07_29"
FW_URL = os.environ.get("TONE_FW_URL", "http://127.0.0.1:6007/utterance")
LIMIT = int(os.environ.get("PROBE_LIMIT", "20"))

PREFERRED = [
    "d001", "d002", "d003", "d004", "d005",
    "d010", "d019", "d025", "d040", "d055",
    "d064", "d080", "d100", "d109", "d120",
    "d140", "d154", "d170", "d190", "d199",
]


def read_wav_b64(path: Path) -> Tuple[str, int, float]:
    with wave.open(str(path), "rb") as wf:
        sr = wf.getframerate()
        ch = wf.getnchannels()
        n = wf.getnframes()
        frames = wf.readframes(n)
        duration = n / float(sr)
    if ch > 1:
        import array

        samples = array.array("h")
        samples.frombytes(frames)
        mono = array.array("h")
        for i in range(0, len(samples), ch):
            mono.append(int(sum(samples[i : i + ch]) / ch))
        frames = mono.tobytes()
    return base64.b64encode(frames).decode("ascii"), sr, duration


def post_utterance(audio_b64: str, sr: int, trace_id: str) -> Dict[str, Any]:
    body = json.dumps(
        {
            "job_id": trace_id,
            "src_lang": "zh",
            "audio": audio_b64,
            "audio_format": "pcm16",
            "sample_rate": sr,
            "task": "transcribe",
            "condition_on_previous_text": False,
            "use_context_buffer": False,
            "use_text_context": False,
            "beam_size": 1,
            "temperature": 0,
            "trace_id": trace_id,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        FW_URL,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        return json.loads(resp.read().decode("utf-8"))


def pick_cases() -> List[Dict[str, Any]]:
    manifest = json.loads((DIALOG / "cases.manifest.json").read_text(encoding="utf-8"))
    by_id = {c["id"]: c for c in manifest.get("cases", [])}
    out: List[Dict[str, Any]] = []
    for cid in PREFERRED:
        if cid in by_id:
            out.append(by_id[cid])
        if len(out) >= LIMIT:
            break
    for c in manifest.get("cases", []):
        if len(out) >= LIMIT:
            break
        if c["id"] not in {x["id"] for x in out}:
            out.append(c)
    return out[:LIMIT]


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    cases = pick_cases()
    print(f"[fw-probe] url={FW_URL} limit={len(cases)} out={OUT}")

    # health
    health_url = FW_URL.rsplit("/", 1)[0] + "/health"
    try:
        with urllib.request.urlopen(health_url, timeout=5) as resp:
            health = json.loads(resp.read().decode("utf-8"))
        print("[fw-probe] health", json.dumps(health.get("readiness", health), ensure_ascii=False))
    except Exception as e:
        print("[fw-probe] FW health FAIL", e)
        return 1

    rows = []
    for c in cases:
        cid = c["id"]
        wav = DIALOG / (c.get("file") or c.get("audio"))
        print(f"[fw-probe] {cid} {wav.name}")
        try:
            audio_b64, sr, duration = read_wav_b64(wav)
            t0 = time.perf_counter()
            data = post_utterance(audio_b64, sr, f"tone-full-chain-{cid}-{int(time.time())}")
            ms = int((time.perf_counter() - t0) * 1000)
        except Exception as e:
            row = {"utteranceId": cid, "error": str(e), "audioPath": str(wav)}
            rows.append(row)
            (OUT / f"{cid}.fw.json").write_text(json.dumps(row, ensure_ascii=False, indent=2), encoding="utf-8")
            print("  ERROR", e)
            continue

        tone = data.get("tone") or {}
        segments = data.get("segments") or []
        text = data.get("text") or data.get("raw_text") or ""
        # count words
        words = []
        for seg in segments:
            for w in seg.get("words") or []:
                words.append(w)
        slices = tone.get("acousticToneSlices") or tone.get("acoustic_tone_slices") or []
        row = {
            "utteranceId": cid,
            "audioPath": str(wav),
            "audioDurationSec": duration,
            "sampleRate": sr,
            "fwLatencyMs": ms,
            "expectedText": c.get("utterance") or c.get("text"),
            "rawText": text,
            "segments": segments,
            "utterance_tone": tone,
            "wordCount": len(words),
            "sliceCount": len(slices),
            "toneEnabled": tone.get("toneEnabled", tone.get("tone_enabled")),
            "skippedReason": tone.get("skippedReason", tone.get("skipped_reason")),
            "toneConfidenceAvg": tone.get("toneConfidenceAvg", tone.get("tone_confidence_avg")),
            "diagnostics": data.get("diagnostics"),
        }
        rows.append(row)
        (OUT / f"{cid}.fw.json").write_text(json.dumps(row, ensure_ascii=False, indent=2), encoding="utf-8")
        print(
            f"  text_len={len(text)} words={len(words)} slices={len(slices)} "
            f"toneEnabled={row['toneEnabled']} skipped={row['skippedReason']} ms={ms}"
        )

    index = {"generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "fwUrl": FW_URL, "cases": rows}
    (OUT / "fw_index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    print("[fw-probe] saved", OUT / "fw_index.json")

    # Node analyzer
    analyzer = Path(__file__).with_name("tone-full-chain-analyze-fw-dumps.mjs")
    electron_node = ROOT / "electron_node" / "electron-node"
    cmd = ["node", str(analyzer), str(OUT)]
    print("[fw-probe] running analyzer", cmd)
    env = os.environ.copy()
    env.pop("ELECTRON_RUN_AS_NODE", None)
    subprocess.check_call(cmd, cwd=str(electron_node), env=env)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
