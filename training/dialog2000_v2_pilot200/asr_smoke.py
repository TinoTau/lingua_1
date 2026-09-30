# -*- coding: utf-8 -*-
"""Real Faster-Whisper ASR smoke on Pilot200 WAVs — compatibility only."""

from __future__ import annotations

import json
from pathlib import Path

from training.model2.adapters.faster_whisper_client import FasterWhisperClient

REPO = Path(__file__).resolve().parents[2]
DATASET = REPO / "test wav" / "LINGUA_DIALOG2000_V2_PILOT200"
OUT = DATASET / "validation" / "real_asr_audio_smoke.json"

# Deterministic smoke set: clean + surface corruptor + phoneme + multi-relation
SMOKE_CASE_IDS = [
    "p2_u001_008",  # likely clean (early clean slots)
    "p2_u001_001",  # n_l target
    "p2_u002_001",  # z_zh
    "p2_u003_001",  # eng_en
    "p2_u004_001",  # ch_c
    "p2_u005_001",  # sh_s
    "p2_u001_020",
    "p2_u002_020",
]


def pick_smoke_cases(cases: list[dict], n: int = 8) -> list[dict]:
    by_id = {c["caseId"]: c for c in cases}
    selected = []
    for cid in SMOKE_CASE_IDS:
        if cid in by_id:
            selected.append(by_id[cid])
    # ensure backend diversity
    backends = {c.get("ttsBackend") for c in selected}
    if "PHONEME_REALIZER" not in backends:
        for c in cases:
            if c.get("ttsBackend") == "PHONEME_REALIZER":
                selected.append(c)
                break
    if "CORRUPTOR_SURFACE_PIPER" not in backends:
        for c in cases:
            if c.get("ttsBackend") == "CORRUPTOR_SURFACE_PIPER":
                selected.append(c)
                break
    if "PIPER_TTS_SURFACE" not in backends:
        for c in cases:
            if c.get("ttsBackend") == "PIPER_TTS_SURFACE" or c.get("expectedBehaviorClass") == "CLEAN_PRESERVE":
                selected.append(c)
                break
    # dedupe preserve order
    seen = set()
    out = []
    for c in selected:
        if c["caseId"] in seen:
            continue
        seen.add(c["caseId"])
        out.append(c)
        if len(out) >= n:
            break
    return out


def run_smoke(asr_url: str = "http://127.0.0.1:6007") -> dict:
    cases_path = DATASET / "cases" / "cases.jsonl"
    cases = [json.loads(l) for l in cases_path.read_text(encoding="utf-8").splitlines() if l.strip()]
    sample = pick_smoke_cases(cases, n=8)
    client = FasterWhisperClient(base_url=asr_url)
    try:
        health = client.health()
    except Exception as e:
        return {
            "REAL_ASR_AUDIO_SMOKE": "FAIL",
            "SMOKE_CASE_COUNT": 0,
            "reason": f"ASR unavailable: {e}",
        }

    results = []
    ok = 0
    for c in sample:
        wav_path = DATASET / c["audioPath"]
        row = {
            "caseId": c["caseId"],
            "ttsBackend": c.get("ttsBackend"),
            "relationFamily": c.get("relationFamily"),
            "expectedBehaviorClass": c.get("expectedBehaviorClass"),
            "audioPath": str(wav_path),
        }
        try:
            wav = wav_path.read_bytes()
            hyp = client.transcribe_wav(wav, job_id=f"smoke-{c['caseId']}")
            text = (hyp.text or "").strip()
            row["ok"] = bool(text is not None) and hyp is not None
            row["rawAsrLen"] = len(text)
            # Do NOT store ASR text into dataset selection artifacts beyond smoke report
            row["rawAsrPreview"] = text[:40]
            if row["ok"]:
                ok += 1
        except Exception as e:
            row["ok"] = False
            row["error"] = str(e)
        results.append(row)

    status = "PASS" if ok == len(sample) and len(sample) >= 5 else "FAIL"
    doc = {
        "REAL_ASR_AUDIO_SMOKE": status,
        "SMOKE_CASE_COUNT": len(sample),
        "SMOKE_OK_COUNT": ok,
        "asr_health": health if isinstance(health, dict) else str(health),
        "note": "SMOKE_ONLY_NOT_BASELINE — ASR output must not drive dataset retargeting",
        "cases": results,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    return doc


if __name__ == "__main__":
    print(json.dumps(run_smoke(), ensure_ascii=False, indent=2))
