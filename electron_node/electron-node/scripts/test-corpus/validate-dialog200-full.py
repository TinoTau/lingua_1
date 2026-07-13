#!/usr/bin/env python3
"""Validate restored_full_v1 dialog_200 corpus."""
from __future__ import annotations

import base64
import json
import random
import sys
import urllib.request
import wave
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
DIALOG_DIR = REPO / "test wav" / "dialog_200"
MANIFEST_PATH = DIALOG_DIR / "cases.manifest.json"
FW_URL = "http://127.0.0.1:6007/utterance"


def load_manifest():
    raw = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    cases = raw["cases"] if isinstance(raw, dict) else raw
    meta = raw if isinstance(raw, dict) else {}
    return meta, cases


def post_fw(wav_path: Path, trace_id: str) -> dict:
    with wave.open(str(wav_path), "rb") as w:
        sr = w.getframerate()
        pcm = w.readframes(w.getnframes())
    b64 = base64.b64encode(pcm).decode()
    body = json.dumps(
        {
            "job_id": trace_id,
            "src_lang": "zh",
            "audio": b64,
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
    ).encode()
    req = urllib.request.Request(FW_URL, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode())


def main() -> int:
    errors = []
    meta, cases = load_manifest()

    if meta.get("caseCount") != 200:
        errors.append(f"caseCount={meta.get('caseCount')} != 200")
    if meta.get("isFullCorpus") is not True:
        errors.append(f"isFullCorpus={meta.get('isFullCorpus')} != true")
    if meta.get("version") != "restored_full_v1":
        errors.append(f"version={meta.get('version')} != restored_full_v1")
    if len(cases) != 200:
        errors.append(f"cases array len={len(cases)} != 200")

    for i in range(1, 201):
        cid = f"d{i:03d}"
        wav = DIALOG_DIR / f"dialog_{cid}.wav"
        if not wav.is_file():
            errors.append(f"missing wav {wav.name}")
            continue
        if wav.stat().st_size < 1000:
            errors.append(f"too small {wav.name}")

    id_set = {c["id"] for c in cases}
    for i in range(1, 201):
        if f"d{i:03d}" not in id_set:
            errors.append(f"missing case d{i:03d}")

    for c in cases:
        audio = c.get("file") or c.get("audio")
        if not audio:
            errors.append(f"{c['id']} missing audio/file")
            continue
        p = DIALOG_DIR / audio
        if not p.is_file():
            errors.append(f"{c['id']} audio not found: {audio}")
        for field in ("text", "expectedText"):
            if not c.get(field):
                errors.append(f"{c['id']} missing {field}")
        if c.get("language") != "zh":
            errors.append(f"{c['id']} language != zh")

    sample_ids = random.sample([f"d{i:03d}" for i in range(1, 201)], 5)
    fw_samples = []
    try:
        urllib.request.urlopen("http://127.0.0.1:6007/health", timeout=5)
        fw_up = True
    except Exception:
        fw_up = False
        errors.append("FW worker not reachable for sample validation")

    if fw_up:
        for cid in sample_ids:
            wav = DIALOG_DIR / f"dialog_{cid}.wav"
            try:
                resp = post_fw(wav, f"validate-{cid}")
                tone = resp.get("tone") or {}
                fw_samples.append(
                    {
                        "id": cid,
                        "httpOk": True,
                        "textLen": len(resp.get("text") or ""),
                        "toneEnabled": tone.get("toneEnabled"),
                        "sliceCount": tone.get("sliceCount"),
                    }
                )
                if not resp.get("text"):
                    errors.append(f"FW sample {cid}: empty asr text")
            except Exception as exc:
                errors.append(f"FW sample {cid}: {exc}")
                fw_samples.append({"id": cid, "httpOk": False, "error": str(exc)})

    report = {
        "manifestOk": len(errors) == 0,
        "wavCount": len(list(DIALOG_DIR.glob("dialog_d*.wav"))),
        "errors": errors,
        "fwSampleIds": sample_ids,
        "fwSamples": fw_samples,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
