#!/usr/bin/env python3
"""Test-only: P1 offline infer on raw vs FW-preprocessed audio using FW WordInfo."""
from __future__ import annotations

import argparse
import json
import sys
import wave
from pathlib import Path

import numpy as np

_FW_ROOT = Path(__file__).resolve().parents[1]
_REPO_ROOT = _FW_ROOT.parents[2]
if str(_FW_ROOT) not in sys.path:
    sys.path.insert(0, str(_FW_ROOT))

from audio_preprocess import preprocess_pcm_f32  # noqa: E402
from scipy import signal as scipy_signal  # noqa: E402
from shared_types import WordInfo  # noqa: E402
from tone_module.backends.numpy_p1 import infer_batch  # noqa: E402
from tone_module.feature_v2 import extract_feature  # noqa: E402
from tone_module.loader_v1 import ToneModelLoaderV1  # noqa: E402

ARTIFACT = _FW_ROOT / "tone_module" / "models" / "tone_cnn_p1_v1_full.npz"


def read_wav(path: Path):
    with wave.open(str(path), "rb") as wf:
        sr = wf.getframerate()
        ch = wf.getnchannels()
        sw = wf.getsampwidth()
        n = wf.getnframes()
        raw = wf.readframes(n)
    if sw == 2:
        pcm = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    else:
        raise ValueError("unsupported width")
    if ch > 1:
        pcm = pcm.reshape(-1, ch).mean(axis=1)
    return pcm.astype(np.float32, copy=False), int(sr)


def resample_if_needed(audio, sr, target=16000):
    if sr == target:
        return audio, sr
    n = int(len(audio) * target / sr)
    return scipy_signal.resample(audio, max(n, 1)).astype(np.float32), target


def load_words(segments_path: Path):
    data = json.loads(segments_path.read_text(encoding="utf-8"))
    words = []
    for seg in data or []:
        for w in seg.get("words") or []:
            token = (w.get("word") or "").strip()
            if token and w.get("start") is not None and w.get("end") is not None:
                words.append(WordInfo(word=token, start=float(w["start"]), end=float(w["end"]), probability=w.get("probability")))
    return words


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--wav", required=True)
    ap.add_argument("--segments", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    wav_path = Path(args.wav)
    raw, sr = read_wav(wav_path)
    raw, sr = resample_if_needed(raw, sr)
    processed, psr, _ = preprocess_pcm_f32(raw.copy(), sr, 16000)

    loader = ToneModelLoaderV1()
    load = loader.load(str(ARTIFACT))
    if not load.ready or load.weights is None:
        print(json.dumps({"error": load.load_error}), file=sys.stderr)
        return 2
    weights = load.weights

    words = load_words(Path(args.segments))
    rows = []
    changes = 0
    for w in words:
        if (w.end or 0) - (w.start or 0) < 0.02:
            continue
        try:
            f_raw = extract_feature(raw, sr, w)
            f_rt = extract_feature(processed, psr, w)
        except ValueError:
            continue
        p_raw = infer_batch(f_raw[None], weights)[0]
        p_rt = infer_batch(f_rt[None], weights)[0]
        a_raw = int(np.argmax(p_raw)) + 1
        a_rt = int(np.argmax(p_rt)) + 1
        changed = a_raw != a_rt
        if changed:
            changes += 1
        rows.append({
            "word": w.word,
            "start": w.start,
            "end": w.end,
            "argmaxRaw": a_raw,
            "argmaxRuntime": a_rt,
            "argmaxChanged": changed,
            "posteriorRaw": [float(x) for x in p_raw],
            "posteriorRuntime": [float(x) for x in p_rt],
            "featureMaxAbsDiff": float(np.abs(f_raw - f_rt).max()),
        })

    out = {
        "artifact": str(ARTIFACT),
        "wordCount": len(rows),
        "words": rows,
        "aggregate": {
            "argmaxChangeCount": changes,
            "argmaxChangeRate": round(changes / max(len(rows), 1), 4),
        },
    }
    Path(args.out).write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(out["aggregate"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
