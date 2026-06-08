#!/usr/bin/env python3
"""Sample toneTokens from FW HTTP for reliability audit."""
from __future__ import annotations

import base64
import json
import random
import sys
import urllib.request
import wave
from pathlib import Path

import numpy as np

PROJECT = Path(__file__).resolve().parents[4]
DIALOG = PROJECT / "test wav" / "dialog_200"
MANIFEST = json.loads((DIALOG / "cases.manifest.json").read_text(encoding="utf-8"))
FW_URL = "http://127.0.0.1:6007/utterance"


def read_wav(path: Path):
    with wave.open(str(path), "rb") as wf:
        sr = wf.getframerate()
        ch = wf.getnchannels()
        frames = wf.readframes(wf.getnframes())
    s = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    if ch > 1:
        s = s.reshape(-1, ch).mean(axis=1)
    return s, sr


def post(pcm, sr, tid):
    b64 = base64.b64encode((np.clip(pcm, -1, 1) * 32767).astype(np.int16).tobytes()).decode()
    body = json.dumps(
        {
            "job_id": tid,
            "src_lang": "zh",
            "audio": b64,
            "audio_format": "pcm16",
            "sample_rate": sr,
            "task": "transcribe",
            "use_context_buffer": False,
            "use_text_text": False,
            "use_text_context": False,
            "beam_size": 1,
            "temperature": 0,
            "trace_id": tid,
        }
    ).encode()
    req = urllib.request.Request(FW_URL, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=180) as resp:
        return json.loads(resp.read().decode())


def argmax_tone(post):
    keys = ["t1", "t2", "t3", "t4", "t5"]
    i = max(range(5), key=lambda j: post.get(keys[j], 0))
    return i + 1, post.get(keys[i], 0)


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 100
    rng = random.Random(42)
    items = [x for x in MANIFEST if (DIALOG / x["file"]).exists()]
    rng.shuffle(items)
    tokens = []
    for item in items:
        if len(tokens) >= n:
            break
        pcm, sr = read_wav(DIALOG / item["file"])
        try:
            resp = post(pcm, sr, f"rel-{item['id']}")
        except Exception:
            continue
        tone = resp.get("tone") or {}
        if not tone.get("toneEnabled"):
            continue
        for tok in tone.get("toneTokens") or []:
            pred, conf = argmax_tone(tok.get("tonePosterior") or {})
            tokens.append(
                {
                    "caseId": item["id"],
                    "token": tok.get("token"),
                    "predictedTone": pred,
                    "confidence": tok.get("confidence"),
                    "tonePosterior": tok.get("tonePosterior"),
                }
            )
            if len(tokens) >= n:
                break
    high = sum(1 for t in tokens if (t["confidence"] or 0) >= 0.75)
    mid = sum(1 for t in tokens if 0.45 <= (t["confidence"] or 0) < 0.75)
    low = len(tokens) - high - mid
    out = {
        "sampled": len(tokens),
        "highConfidence": high,
        "midConfidence": mid,
        "lowConfidence": low,
        "tokens": tokens[:30],
        "note": "Manual Mandarin plausibility review: automated audit uses confidence tiers; ASR-char may not match spoken tone for wrong characters",
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
