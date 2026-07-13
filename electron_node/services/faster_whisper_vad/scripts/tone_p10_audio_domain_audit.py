#!/usr/bin/env python3
"""P10 — Raw WAV vs Node/FW Runtime processed audio impact audit (standalone).

Does NOT modify production Runtime. Uses production FW preprocessing functions
and optional HTTP to FW (:6007) / Node test server (:5020).
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import struct
import sys
import time
import urllib.error
import urllib.request
import wave
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

# FW service root on sys.path
_FW_ROOT = Path(__file__).resolve().parents[1]
_REPO_ROOT = _FW_ROOT.parents[2]
if str(_FW_ROOT) not in sys.path:
    sys.path.insert(0, str(_FW_ROOT))

from audio_preprocess import preprocess_pcm_f32, _peak_normalize, _trim_leading_trailing_silence  # noqa: E402
from scipy import signal as scipy_signal  # noqa: E402
from shared_types import WordInfo  # noqa: E402
from tone_module.backends.numpy_p1 import infer_batch  # noqa: E402
from tone_module.feature_v2 import extract_feature  # noqa: E402
from tone_module.loader_v1 import ToneModelLoaderV1  # noqa: E402

D001_TRACE_PATH = (
    _REPO_ROOT
    / "electron_node"
    / "electron-node"
    / "tests"
    / "experiments"
    / "d001-timestamp-tone-probe-trace.json"
)

DIALOG_DIR = _REPO_ROOT / "test wav" / "dialog_200"
MANIFEST_PATH = DIALOG_DIR / "cases.manifest.json"
ARTIFACT_PATH = _FW_ROOT / "tone_module" / "models" / "tone_cnn_p1_v1_full.npz"
DEFAULT_OUT = _REPO_ROOT / "tmp" / "tone_p10_audio_domain_audit"
FW_URL = os.environ.get("TONE_P10_FW_URL", "http://127.0.0.1:6007/utterance")
NODE_URL = os.environ.get("TONE_P10_NODE_URL", "http://127.0.0.1:5020/run-pipeline-with-audio")


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_wav(path: Path) -> Tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as wf:
        sr = wf.getframerate()
        ch = wf.getnchannels()
        sw = wf.getsampwidth()
        n = wf.getnframes()
        raw = wf.readframes(n)
    if sw == 2:
        pcm = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    elif sw == 4:
        pcm = np.frombuffer(raw, dtype=np.float32)
    else:
        raise ValueError(f"unsupported sample width: {sw}")
    if ch > 1:
        pcm = pcm.reshape(-1, ch).mean(axis=1)
    return pcm.astype(np.float32, copy=False), int(sr)


def audio_stats(audio: np.ndarray, sr: int) -> dict:
    if audio.size == 0:
        return {
            "sampleCount": 0,
            "durationSec": 0.0,
            "min": 0.0,
            "max": 0.0,
            "rms": 0.0,
            "peakDbfs": -120.0,
            "dcMean": 0.0,
            "clipped": False,
        }
    peak = float(np.max(np.abs(audio)))
    rms = float(np.sqrt(np.mean(audio.astype(np.float64) ** 2)))
    peak_db = 20.0 * np.log10(max(peak, 1e-12))
    return {
        "sampleCount": int(len(audio)),
        "durationSec": round(len(audio) / float(sr), 4),
        "min": float(np.min(audio)),
        "max": float(np.max(audio)),
        "rms": round(rms, 6),
        "peakDbfs": round(peak_db, 2),
        "dcMean": round(float(np.mean(audio)), 8),
        "clipped": bool(np.any(np.abs(audio) > 1.0)),
    }


def _energy_vad_segments(
    audio: np.ndarray, sample_rate: int, *, threshold_dbfs: float = -40.0, min_run_ms: int = 80
) -> List[Tuple[int, int]]:
    """Audit-only energy VAD (mirrors silence-trim threshold; avoids GPU Silero import)."""
    if audio.size == 0:
        return []
    threshold = 10 ** (threshold_dbfs / 20.0)
    min_run = max(1, int(sample_rate * min_run_ms / 1000))
    speech = np.abs(audio) > threshold
    segments: List[Tuple[int, int]] = []
    i = 0
    n = len(speech)
    while i < n:
        while i < n and not speech[i]:
            i += 1
        if i >= n:
            break
        start = i
        while i < n and speech[i]:
            i += 1
        end = i
        if end - start >= min_run:
            segments.append((start, end))
    return segments


def _concat_vad_segments(audio: np.ndarray, segments: List[Tuple[int, int]]) -> np.ndarray:
    if not segments:
        return audio
    parts = [audio[s:e] for s, e in segments]
    if not parts:
        return audio
    return np.concatenate(parts).astype(np.float32, copy=False)


def resample_if_needed(audio: np.ndarray, sr: int, target_sr: int) -> Tuple[np.ndarray, int, bool]:
    if sr == target_sr:
        return audio, sr, False
    n = int(len(audio) * target_sr / sr)
    out = scipy_signal.resample(audio, max(n, 1)).astype(np.float32)
    return out, target_sr, True


def build_fw_stages(
    raw: np.ndarray,
    sr: int,
    *,
    target_sr: int = 16000,
    use_context_buffer: bool = False,
    trace_id: str = "p10-audit",
) -> dict:
    """Replay production FW preprocessing using the same functions as api_routes."""
    stages: dict[str, Any] = {}

    a0 = raw.astype(np.float32, copy=False)
    stages["A0_original_input"] = {
        "audio": a0,
        "sr": sr,
        "stats": audio_stats(a0, sr),
        "owner": "disk_wav",
    }

    a4, sr4, did_resample = resample_if_needed(a0, sr, target_sr)
    stages["A4_resampled"] = {
        "audio": a4,
        "sr": sr4,
        "stats": audio_stats(a4, sr4),
        "resampled": did_resample,
        "owner": "fw_decode_path",
    }

    normalized, norm_diag = _peak_normalize(a4)
    stages["A5_peak_normalized"] = {
        "audio": normalized,
        "sr": sr4,
        "stats": audio_stats(normalized, sr4),
        "normalization": norm_diag,
        "owner": "audio_preprocess",
    }

    trimmed, trim_diag = _trim_leading_trailing_silence(normalized, sr4)
    stages["A6_silence_trimmed"] = {
        "audio": trimmed,
        "sr": sr4,
        "stats": audio_stats(trimmed, sr4),
        "trim": trim_diag,
        "owner": "audio_preprocess",
    }

    # Full preprocess_pcm_f32 (should match A5+A6 for mono float32)
    pp_audio, pp_sr, pp_diag = preprocess_pcm_f32(a4.copy(), sr4, target_sr)
    stages["A6b_preprocess_pcm_f32"] = {
        "audio": pp_audio,
        "sr": pp_sr,
        "stats": audio_stats(pp_audio, pp_sr),
        "diagnostics": pp_diag,
        "owner": "audio_preprocess",
    }

    # Audit-only: energy VAD approximates Silero path when GPU VAD unavailable offline.
    vad_segments = _energy_vad_segments(pp_audio, pp_sr)
    stages["A7_vad_segments"] = {
        "segments": [
            {
                "startSample": int(s),
                "endSample": int(e),
                "startSec": round(s / pp_sr, 4),
                "endSec": round(e / pp_sr, 4),
                "durationSec": round((e - s) / pp_sr, 4),
            }
            for s, e in vad_segments
        ],
        "segmentCount": len(vad_segments),
        "owner": "audit_energy_vad",
        "note": "offline audit proxy; production uses Silero VAD in utterance_audio.prepare_audio_with_context",
    }

    audio_with_context = pp_audio
    if use_context_buffer:
        stages["_context_buffer"] = {"enabled": True, "note": "not simulated in offline audit"}
    if not vad_segments:
        processed = audio_with_context
        vad_mode = "fallback_full_audio"
    else:
        processed = _concat_vad_segments(audio_with_context, vad_segments)
        vad_mode = "B_vad_concatenate"
        if len(processed) < int(pp_sr * 0.5):
            processed = audio_with_context
            vad_mode = "fallback_too_short_after_vad"
    stages["A8_vad_concatenated_processed"] = {
        "audio": processed,
        "sr": pp_sr,
        "stats": audio_stats(processed, pp_sr),
        "owner": "utterance_audio",
    }
    stages["A9_asr_input"] = stages["A8_vad_concatenated_processed"]
    stages["A10_tone_input"] = stages["A8_vad_concatenated_processed"]

    removed = stages["A6b_preprocess_pcm_f32"]["stats"]["sampleCount"] - stages["A8_vad_concatenated_processed"]["stats"]["sampleCount"]
    stages["_summary"] = {
        "rawDurationSec": stages["A0_original_input"]["stats"]["durationSec"],
        "processedDurationSec": stages["A8_vad_concatenated_processed"]["stats"]["durationSec"],
        "removedByVadSamples": int(max(0, removed)),
        "removedByVadSec": round(max(0, removed) / pp_sr, 4),
        "vadSegmentCount": len(vad_segments),
        "peakNormalizeGainDb": round(
            (stages["A5_peak_normalized"]["normalization"].get("peak_after", 0) or 0)
            - (stages["A5_peak_normalized"]["normalization"].get("peak_before", 0) or 0),
            2,
        ),
        "leadingTrimMs": stages["A6_silence_trimmed"]["trim"].get("leading_ms", 0),
        "trailingTrimMs": stages["A6_silence_trimmed"]["trim"].get("trailing_ms", 0),
        "mode": vad_mode,
        "vadProxy": "energy_threshold",
    }
    return stages


def load_d001_trace_words() -> List[WordInfo]:
    if not D001_TRACE_PATH.is_file():
        return []
    data = json.loads(D001_TRACE_PATH.read_text(encoding="utf-8"))
    words: List[WordInfo] = []
    for seg in data.get("segments") or []:
        for w in seg.get("words") or []:
            token = (w.get("word") or "").strip(" ,")
            if not token or w.get("start") is None or w.get("end") is None:
                continue
            words.append(
                WordInfo(
                    word=token,
                    start=float(w["start"]),
                    end=float(w["end"]),
                    probability=w.get("probability"),
                )
            )
    return words


def iter_words_from_segments(segments: List[dict]) -> List[WordInfo]:
    words: List[WordInfo] = []
    for seg in segments or []:
        for w in seg.get("words") or []:
            token = (w.get("word") or "").strip()
            if not token or w.get("start") is None or w.get("end") is None:
                continue
            words.append(
                WordInfo(
                    word=token,
                    start=float(w["start"]),
                    end=float(w["end"]),
                    probability=w.get("probability"),
                )
            )
    return words


def post_fw_utterance(pcm: np.ndarray, sr: int, fixture_id: str, timeout: float = 180.0) -> Optional[dict]:
    b64 = base64.b64encode((np.clip(pcm, -1, 1) * 32767).astype(np.int16).tobytes()).decode()
    body = json.dumps(
        {
            "job_id": f"p10-{fixture_id}",
            "trace_id": f"p10-{fixture_id}",
            "src_lang": "zh",
            "audio": b64,
            "audio_format": "pcm16",
            "sample_rate": sr,
            "task": "transcribe",
            "use_context_buffer": False,
            "use_text_context": False,
            "condition_on_previous_text": False,
            "beam_size": 1,
            "temperature": 0,
            "skip_text_dedup": True,
        }
    ).encode()
    req = urllib.request.Request(
        FW_URL, data=body, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None


def post_node_pipeline(wav_path: Path, timeout: float = 300.0) -> Optional[dict]:
    body = json.dumps(
        {
            "wavPath": str(wav_path.resolve()),
            "srcLang": "zh",
            "tgtLang": "en",
            "is_manual_cut": True,
            "use_lexicon": True,
            "enableKenLMGate": False,
        }
    ).encode()
    req = urllib.request.Request(
        NODE_URL, data=body, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None


def feature_metrics(a: np.ndarray, b: np.ndarray) -> dict:
    diff = np.abs(a.astype(np.float64) - b.astype(np.float64))
    mel_mae = float(diff[:, :80].mean()) if a.shape == b.shape else None
    f0_mae = float(diff[:, 80:].mean()) if a.shape == b.shape else None
    return {
        "shapeA": list(a.shape),
        "shapeB": list(b.shape),
        "maxAbsDiff": float(diff.max()) if diff.size else 0.0,
        "meanAbsDiff": float(diff.mean()) if diff.size else 0.0,
        "melMae": mel_mae,
        "f0Mae": f0_mae,
        "bitEqual": bool(np.array_equal(a, b)),
    }


def posterior_metrics(p_raw: np.ndarray, p_rt: np.ndarray) -> dict:
    argmax_raw = int(np.argmax(p_raw)) + 1
    argmax_rt = int(np.argmax(p_rt)) + 1
    sorted_raw = np.sort(p_raw)[::-1]
    sorted_rt = np.sort(p_rt)[::-1]
    return {
        "posteriorRaw": [float(x) for x in p_raw],
        "posteriorRuntime": [float(x) for x in p_rt],
        "l1": float(np.abs(p_raw - p_rt).sum()),
        "maxAbs": float(np.abs(p_raw - p_rt).max()),
        "argmaxRaw": argmax_raw,
        "argmaxRuntime": argmax_rt,
        "argmaxChanged": argmax_raw != argmax_rt,
        "confidenceRaw": float(p_raw.max()),
        "confidenceRuntime": float(p_rt.max()),
        "marginRaw": float(sorted_raw[0] - sorted_raw[1]) if len(sorted_raw) > 1 else 0.0,
        "marginRuntime": float(sorted_rt[0] - sorted_rt[1]) if len(sorted_rt) > 1 else 0.0,
    }


@dataclass
class WordAuditRow:
    word: str
    start: float
    end: float
    durationSec: float
    featureRawVsRuntime: dict
    posteriorRawVsRuntime: dict


@dataclass
class FixtureAudit:
    fixtureId: str
    scenario: str
    wavPath: str
    utterance: str
    stageSummary: dict
    stageStats: dict
    fwHttpAvailable: bool
    nodeHttpAvailable: bool
    wordCount: int
    words: List[WordAuditRow] = field(default_factory=list)
    aggregate: dict = field(default_factory=dict)
    nodeE2E: Optional[dict] = None
    errors: List[str] = field(default_factory=list)


def select_fixtures(manifest: dict, limit: int) -> List[dict]:
    cases = manifest.get("cases") or []
    priority_ids = {
        "d001",  # cafe tone-sensitive
        "d049", "d050", "d051", "d052", "d053", "d054", "d055",  # homophone block
    }
    homophone = [c for c in cases if c.get("scenario") == "lexicon_homophone"]
    cafe = [c for c in cases if c.get("scenario") == "cafe"]
    picked: List[dict] = []
    seen = set()

    def add(case: dict) -> None:
        cid = case.get("id")
        if not cid or cid in seen:
            return
        if not (DIALOG_DIR / case["file"]).exists():
            return
        seen.add(cid)
        picked.append(case)

    for cid in priority_ids:
        for c in cases:
            if c.get("id") == cid:
                add(c)
    for c in homophone:
        add(c)
    for c in cafe:
        add(c)
    for c in cases:
        add(c)
        if len(picked) >= limit:
            break
    return picked[:limit]


def audit_fixture(
    case: dict,
    weights,
    *,
    try_http: bool,
) -> FixtureAudit:
    fid = case["id"]
    wav_path = DIALOG_DIR / case["file"]
    raw, sr = read_wav(wav_path)
    stages = build_fw_stages(raw, sr, trace_id=f"p10-{fid}")

    stage_stats = {k: v.get("stats") for k, v in stages.items() if isinstance(v, dict) and "stats" in v}
    fixture = FixtureAudit(
        fixtureId=fid,
        scenario=str(case.get("scenario") or ""),
        wavPath=str(wav_path),
        utterance=str(case.get("utterance") or case.get("text") or ""),
        stageSummary=stages["_summary"],
        stageStats=stage_stats,
        fwHttpAvailable=False,
        nodeHttpAvailable=False,
        wordCount=0,
    )

    words: List[WordInfo] = []
    fw_resp = None
    if try_http:
        # Node path sends wav->opus->pcm16; FW-direct uses trimmed continuous pcm before VAD is NOT what Node sends.
        # FW HTTP receives pcm16 of *decoded* utterance; production path is decode->preprocess->VAD inside FW.
        # So we post raw pcm16 continuous (as audit_tone_reliability) — FW replicates full internal chain.
        pcm_for_http = stages["A0_original_input"]["audio"]
        sr_http = stages["A0_original_input"]["sr"]
        if sr_http != 16000:
            pcm_for_http, sr_http, _ = resample_if_needed(pcm_for_http, sr_http, 16000)
        fw_resp = post_fw_utterance(pcm_for_http, sr_http, fid)
        fixture.fwHttpAvailable = fw_resp is not None
        if fw_resp:
            words = iter_words_from_segments(fw_resp.get("segments") or [])

        node_resp = post_node_pipeline(wav_path)
        fixture.nodeHttpAvailable = node_resp is not None
        if node_resp:
            fixture.nodeE2E = {
                "hasResult": True,
                "keys": sorted(node_resp.keys())[:20],
            }

    if not words and fid == "d001":
        words = load_d001_trace_words()
        if words:
            fixture.errors.append("wordinfo_source:d001_historical_trace")

    if not words:
        fixture.errors.append(
            "no_wordinfo: skipped word-level feature/posterior (FW HTTP unavailable; no historical trace)"
        )

    raw_audio = stages["A0_original_input"]["audio"]
    raw_sr = stages["A0_original_input"]["sr"]
    if raw_sr != 16000:
        raw_audio, raw_sr, _ = resample_if_needed(raw_audio, raw_sr, 16000)

    rt_audio = stages["A8_vad_concatenated_processed"]["audio"]
    rt_sr = stages["A8_vad_concatenated_processed"]["sr"]

    norm_only = stages["A5_peak_normalized"]["audio"]
    trimmed = stages["A6_silence_trimmed"]["audio"]

    argmax_changes = 0
    posterior_changes = 0
    max_tensor = 0.0
    rows: List[WordAuditRow] = []

    for w in words:
        if (w.end or 0) - (w.start or 0) < 0.02:
            continue
        try:
            f_raw = extract_feature(raw_audio, raw_sr, w)
            f_rt = extract_feature(rt_audio, rt_sr, w)
            f_norm = extract_feature(norm_only, rt_sr, w)
            f_trim = extract_feature(trimmed, rt_sr, w)
        except ValueError as exc:
            fixture.errors.append(f"extract_skip:{w.word}:{exc}")
            continue

        fm = feature_metrics(f_raw, f_rt)
        max_tensor = max(max_tensor, fm["maxAbsDiff"])
        p_raw = infer_batch(f_raw[None], weights)[0]
        p_rt = infer_batch(f_rt[None], weights)[0]
        pm = posterior_metrics(p_raw, p_rt)
        if pm["argmaxChanged"]:
            argmax_changes += 1
        if pm["maxAbs"] > 1e-4:
            posterior_changes += 1

        rows.append(
            WordAuditRow(
                word=w.word,
                start=float(w.start or 0),
                end=float(w.end or 0),
                durationSec=round(float(w.end or 0) - float(w.start or 0), 4),
                featureRawVsRuntime=fm,
                posteriorRawVsRuntime=pm,
            )
        )

        # decomposition probes (first word only stored in aggregate)
        if len(rows) == 1:
            fixture.aggregate["decomposition_first_word"] = {
                "word": w.word,
                "raw_vs_norm": feature_metrics(f_raw, f_norm),
                "raw_vs_trim": feature_metrics(f_raw, f_trim),
                "norm_vs_trim": feature_metrics(f_norm, f_trim),
            }

    fixture.words = rows
    fixture.wordCount = len(rows)
    fixture.aggregate.update(
        {
            "argmaxChangeCount": argmax_changes,
            "argmaxChangeRate": round(argmax_changes / max(len(rows), 1), 4),
            "posteriorChangeCount": posterior_changes,
            "maxFeatureAbsDiff": round(max_tensor, 6),
            "fwToneEnabled": (fw_resp or {}).get("tone", {}).get("toneEnabled") if fw_resp else None,
            "fwSliceCount": (fw_resp or {}).get("tone", {}).get("sliceCount") if fw_resp else None,
        }
    )
    return fixture


def save_fixture_out(base: Path, fixture: FixtureAudit) -> None:
    fix_dir = base / fixture.fixtureId
    for sub in ("input", "fw", "features", "posterior", "recall"):
        (fix_dir / sub).mkdir(parents=True, exist_ok=True)
    summary_path = fix_dir / "summary.json"
    payload = asdict(fixture)
    summary_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def aggregate_report(fixtures: List[FixtureAudit]) -> dict:
    with_words = [f for f in fixtures if f.wordCount > 0]
    total_words = sum(f.wordCount for f in with_words)
    total_argmax = sum(f.aggregate.get("argmaxChangeCount", 0) for f in with_words)
    vad_removed = [f.stageSummary.get("removedByVadSec", 0) for f in fixtures]
    return {
        "fixtureCount": len(fixtures),
        "fixturesWithWordInfo": len(with_words),
        "totalWordsAudited": total_words,
        "overallArgmaxChangeRate": round(total_argmax / max(total_words, 1), 4),
        "vadRemovedSecMean": round(float(np.mean(vad_removed)) if vad_removed else 0.0, 4),
        "vadRemovedSecMax": round(float(np.max(vad_removed)) if vad_removed else 0.0, 4),
        "fwHttpSuccessCount": sum(1 for f in fixtures if f.fwHttpAvailable),
        "nodeHttpSuccessCount": sum(1 for f in fixtures if f.nodeHttpAvailable),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="P10 audio domain audit")
    parser.add_argument("--limit", type=int, default=25)
    parser.add_argument("--out", type=str, default=str(DEFAULT_OUT))
    parser.add_argument("--no-http", action="store_true", help="Skip FW/Node HTTP (stages only)")
    args = parser.parse_args()

    if not MANIFEST_PATH.is_file():
        print(f"manifest not found: {MANIFEST_PATH}", file=sys.stderr)
        return 2
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    cases = select_fixtures(manifest, args.limit)

    loader = ToneModelLoaderV1()
    load = loader.load(str(ARTIFACT_PATH))
    if not load.ready or load.weights is None:
        print(f"artifact load failed: {load.load_error}", file=sys.stderr)
        return 2
    weights = load.weights

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    fixtures: List[FixtureAudit] = []
    started = time.perf_counter()
    for case in cases:
        fx = audit_fixture(case, weights, try_http=not args.no_http)
        fixtures.append(fx)
        save_fixture_out(out_dir, fx)
        print(
            f"[{fx.fixtureId}] words={fx.wordCount} vad_removed={fx.stageSummary.get('removedByVadSec')}s "
            f"argmax_rate={fx.aggregate.get('argmaxChangeRate')} fw={fx.fwHttpAvailable} node={fx.nodeHttpAvailable}"
        )

    report = {
        "timestamp": _utc_now(),
        "audit": "Tone_V2_P10_Raw_WAV_vs_Node_Runtime_Audio_Impact",
        "manifest": str(MANIFEST_PATH),
        "artifact": str(ARTIFACT_PATH),
        "fwUrl": FW_URL,
        "nodeUrl": NODE_URL,
        "elapsedSec": round(time.perf_counter() - started, 2),
        "aggregate": aggregate_report(fixtures),
        "fixtures": [asdict(f) for f in fixtures],
    }
    (out_dir / "audit_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report["aggregate"], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
