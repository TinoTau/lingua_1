#!/usr/bin/env python3
"""
ToneModule P0 — Runtime Integration & Acceptance Audit (FW side).
Outputs JSON to stdout or --out file. No new features; read-only validation + diagnostics.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import random
import re
import statistics
import struct
import sys
import time
import urllib.error
import urllib.request
import wave
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

_SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(_SERVICE_ROOT))

from shared_types import SegmentInfo, WordInfo
from text_deduplicator import deduplicate_text
from tone_module.inference import run_tone_inference

PROJECT_ROOT = _SERVICE_ROOT.parents[2]
DIALOG_DIR = PROJECT_ROOT / "test wav" / "dialog_200"
MANIFEST_PATH = DIALOG_DIR / "cases.manifest.json"
FW_PORT = int(os.getenv("FASTER_WHISPER_VAD_PORT", "6007"))
FW_URL = f"http://127.0.0.1:{FW_PORT}/utterance"


def _read_wav_pcm16(path: Path) -> Tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as wf:
        sr = wf.getframerate()
        ch = wf.getnchannels()
        frames = wf.readframes(wf.getnframes())
    samples = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    if ch > 1:
        samples = samples.reshape(-1, ch).mean(axis=1)
    return samples, sr


def _pcm_to_b64(pcm_f32: np.ndarray, sr: int) -> str:
  pcm16 = (np.clip(pcm_f32, -1.0, 1.0) * 32767.0).astype(np.int16)
  return base64.b64encode(pcm16.tobytes()).decode("ascii")


def _http_post_utterance(
    audio_b64: str,
    *,
    src_lang: str = "zh",
    sample_rate: int = 16000,
    trace_id: str = "tone-audit",
) -> Dict[str, Any]:
    body = json.dumps(
        {
            "job_id": trace_id,
            "src_lang": src_lang,
            "audio": audio_b64,
            "audio_format": "pcm16",
            "sample_rate": sample_rate,
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
    with urllib.request.urlopen(req, timeout=180) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _wait_health(timeout_sec: int = 300) -> bool:
    url = f"http://127.0.0.1:{FW_PORT}/health"
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=5) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            time.sleep(2)
    return False


def _char_word_segments(text: str, duration: float) -> List[SegmentInfo]:
    """Fallback: evenly split CJK chars when HTTP words missing (diagnostic only)."""
    chars = [c for c in text if "\u4e00" <= c <= "\u9fff"]
    if not chars or duration <= 0:
        return []
    step = duration / len(chars)
    words = []
    for i, ch in enumerate(chars):
        words.append(WordInfo(word=ch, start=i * step, end=(i + 1) * step))
    return [SegmentInfo(text=text, start=0.0, end=duration, words=words)]


def _percentiles(values: List[float]) -> Dict[str, float]:
    if not values:
        return {"p50": 0, "p95": 0, "p99": 0, "max": 0, "n": 0}
    s = sorted(values)
    n = len(s)

    def pct(p: float) -> float:
        idx = min(n - 1, max(0, int(round(p * (n - 1)))))
        return float(s[idx])

    return {
        "p50": pct(0.50),
        "p95": pct(0.95),
        "p99": pct(0.99),
        "max": float(s[-1]),
        "n": n,
        "mean": float(statistics.mean(s)),
    }


def _pipeline_trace() -> List[Dict[str, str]]:
    return [
        {"step": 1, "component": "FW Worker", "file": "api_routes.py", "fn": "process_utterance", "note": "perform_asr → run_tone_inference (pre-dedup)"},
        {"step": 2, "component": "ToneModule", "file": "tone_module/inference.py", "fn": "run_tone_inference", "note": "processed_audio + word timestamps"},
        {"step": 3, "component": "HTTP Response", "file": "api_models.py", "field": "UtteranceResponse.tone"},
        {"step": 4, "component": "Node ASR", "file": "faster-whisper-asr-strategy.ts", "field": "ASRResult.tone"},
        {"step": 5, "component": "Orchestrator", "file": "fw-detector-orchestrator.ts", "field": "ctx.asrResult?.tone"},
        {"step": 6, "component": "Rerank Pipeline", "file": "fw-sentence-rerank-pipeline.ts", "fn": "computeToneMatchScore → candidateScore"},
    ]


def audit_tone_token_samples(manifest: List[Dict], n: int = 20, seed: int = 42) -> Dict[str, Any]:
    rng = random.Random(seed)
    items = [x for x in manifest if (DIALOG_DIR / x["file"]).is_file()]
    sample = rng.sample(items, min(n, len(items)))
    rows = []
    fw_up = _wait_health(timeout_sec=10)
    for item in sample:
        wav = DIALOG_DIR / item["file"]
        row: Dict[str, Any] = {
            "id": item["id"],
            "manifestText": item["utterance"],
            "rawAsrText": None,
            "toneEnabled": False,
            "toneSliceCount": 0,
            "toneConfidenceAvg": None,
            "skippedReason": None,
            "httpOk": False,
        }
        if not fw_up:
            row["skippedReason"] = "fw_service_down"
            rows.append(row)
            continue
        try:
            pcm, sr = _read_wav_pcm16(wav)
            resp = _http_post_utterance(_pcm_to_b64(pcm, sr), sample_rate=sr, trace_id=f"tone-audit-{item['id']}")
            row["httpOk"] = True
            row["rawAsrText"] = resp.get("text", "")
            tone = resp.get("tone") or {}
            row["toneEnabled"] = tone.get("toneEnabled", False)
            row["toneSliceCount"] = tone.get("sliceCount", 0)
            row["toneConfidenceAvg"] = tone.get("toneConfidenceAvg")
            row["skippedReason"] = tone.get("skippedReason")
            diag = (resp.get("diagnostics") or {}).get("toneModule") or {}
            row["tone_inference_ms"] = diag.get("tone_inference_ms")
        except Exception as exc:
            row["error"] = str(exc)
        rows.append(row)
    enabled = sum(1 for r in rows if r.get("toneEnabled"))
    return {
        "fwServiceUp": fw_up,
        "sampleCount": len(rows),
        "toneEnabledCount": enabled,
        "rows": rows,
    }


def audit_dedup_decoupling(manifest: List[Dict], seed: int = 7) -> Dict[str, Any]:
    """Verify acoustic slices generated from pre-dedup words; dedup clears segment words but tone unchanged."""
    rng = random.Random(seed)
    items = [x for x in manifest if (DIALOG_DIR / x["file"]).is_file()]
    samples = []
    for item in rng.sample(items, min(30, len(items))):
        wav = DIALOG_DIR / item["file"]
        pcm, sr = _read_wav_pcm16(wav)
        duration = len(pcm) / sr
        if not _wait_health(timeout_sec=5):
            break
        try:
            resp = _http_post_utterance(_pcm_to_b64(pcm, sr), sample_rate=sr, trace_id=f"dedup-{item['id']}")
        except Exception:
            continue
        raw_text = (resp.get("text") or "").strip()
        if not raw_text:
            continue
        deduped = deduplicate_text(raw_text, trace_id=f"dedup-{item['id']}")
        if deduped == raw_text:
            continue
        # Rebuild pre-dedup segments from HTTP segments (words before dedup mutation)
        segs_pre = []
        for seg in resp.get("segments") or []:
            words = seg.get("words")
            if words:
                segs_pre.append(
                    SegmentInfo(
                        text=seg.get("text", ""),
                        start=seg.get("start"),
                        end=seg.get("end"),
                        words=[
                            WordInfo(word=w.get("word", ""), start=w.get("start"), end=w.get("end"))
                            for w in words
                        ],
                    )
                )
        if not segs_pre:
            segs_pre = _char_word_segments(raw_text, duration)
        tone_pre, _ = run_tone_inference(pcm, sr, segs_pre, "zh", "zh", trace_id="dedup-pre")
        tone_post, _ = run_tone_inference(pcm, sr, [], "zh", "zh", trace_id="dedup-post-empty")
        http_slice_count = (resp.get("tone") or {}).get("sliceCount", 0)
        samples.append(
            {
                "id": item["id"],
                "rawTextBeforeDedup": raw_text,
                "textAfterDedup": deduped,
                "dedupChanged": True,
                "httpToneSliceCount": http_slice_count,
                "localPreDedupToneSliceCount": tone_pre.slice_count,
                "postDedupWordsEmptyToneSliceCount": tone_post.slice_count,
                "toneStableDespiteDedupWordsNull": tone_pre.slice_count == http_slice_count,
            }
        )
        if len(samples) >= 5:
            break
    return {"dedupSamples": samples, "found": len(samples)}


def audit_performance(manifest: List[Dict], n: int = 200, seed: int = 99) -> Dict[str, Any]:
    rng = random.Random(seed)
    items = [x for x in manifest if (DIALOG_DIR / x["file"]).is_file()]
    pick = items if n >= len(items) else rng.sample(items, n)
    ms_list: List[float] = []
    fw_up = _wait_health(timeout_sec=10)
    if not fw_up:
        return {"fwServiceUp": False, "percentiles": _percentiles([])}
    for item in pick:
        wav = DIALOG_DIR / item["file"]
        try:
            pcm, sr = _read_wav_pcm16(wav)
            resp = _http_post_utterance(_pcm_to_b64(pcm, sr), sample_rate=sr, trace_id=f"perf-{item['id']}")
            diag = (resp.get("diagnostics") or {}).get("toneModule") or {}
            if diag.get("tone_inference_ms") is not None:
                ms_list.append(float(diag["tone_inference_ms"]))
        except Exception:
            continue
    pct = _percentiles(ms_list)
    pct["targetMs"] = 20
    pct["passP95Le20"] = pct.get("p95", 999) <= 20
    return {"fwServiceUp": True, "utteranceCount": len(ms_list), "percentiles": pct}


def audit_fail_open() -> Dict[str, Any]:
    cases = []
    if not _wait_health(timeout_sec=10):
        return {"fwServiceUp": False, "cases": []}

    # non_zh
    try:
        pcm = np.zeros(16000, dtype=np.float32)
        resp = _http_post_utterance(_pcm_to_b64(pcm, 16000), src_lang="en", trace_id="fail-en")
        cases.append(
            {
                "case": "non_zh",
                "asrTextReturned": resp.get("text") is not None,
                "toneEnabled": (resp.get("tone") or {}).get("toneEnabled"),
                "skippedReason": (resp.get("tone") or {}).get("skippedReason"),
            }
        )
    except Exception as exc:
        cases.append({"case": "non_zh", "error": str(exc)})

    # no_timestamps: direct inference empty words
    payload, _ = run_tone_inference(np.zeros(16000, dtype=np.float32), 16000, [], "zh", "zh")
    cases.append(
        {
            "case": "no_timestamps_direct",
            "toneEnabled": payload.tone_enabled,
            "skippedReason": payload.skipped_reason,
            "toneSliceCount": payload.slice_count,
        }
    )

    # no_audio
    payload2, _ = run_tone_inference(np.array([], dtype=np.float32), 16000, [], "zh", "zh")
    cases.append(
        {
            "case": "no_audio_direct",
            "toneEnabled": payload2.tone_enabled,
            "skippedReason": payload2.skipped_reason,
        }
    )

    # model_error simulation: temporarily break path not allowed; document classifier bootstrap fallback
    cases.append(
        {
            "case": "model_error_note",
            "note": "model_error only when classifier.ready=False; bundled npz present in repo",
            "defaultModelExists": (_SERVICE_ROOT / "tone_module" / "models" / "tone_cnn_p0.npz").is_file(),
        }
    )
    return {"fwServiceUp": True, "cases": cases}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="")
    parser.add_argument("--part", default="all", choices=["all", "trace", "tokens", "dedup", "perf", "fail"])
    args = parser.parse_args()

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    report: Dict[str, Any] = {
        "audit": "ToneModule P0 Runtime Acceptance (FW)",
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "fwPort": FW_PORT,
    }

    if args.part in ("all", "trace"):
        report["pipelineTrace"] = _pipeline_trace()
        report["fwHealth"] = _wait_health(timeout_sec=15)

    if args.part in ("all", "tokens"):
        report["toneTokenSample20"] = audit_tone_token_samples(manifest, n=20)

    if args.part in ("all", "dedup"):
        report["dedupValidation"] = audit_dedup_decoupling(manifest)

    if args.part in ("all", "perf"):
        report["performanceDialog200"] = audit_performance(manifest, n=200)

    if args.part in ("all", "fail"):
        report["failOpen"] = audit_fail_open()

    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
