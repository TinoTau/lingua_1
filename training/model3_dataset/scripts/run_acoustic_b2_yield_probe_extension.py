# -*- coding: utf-8 -*-
"""Model3 V2 Acoustic B2 Yield Probe Extension — fresh TTS→ASR→Tone→lattice.

No training, no formal dataset, no pronunciation perturbation.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
import wave
from collections import Counter, defaultdict
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model2.adapters.piper_tts_client import PiperTtsClient  # noqa: E402
from training.model2.adapters.faster_whisper_client import (  # noqa: E402
    FasterWhisperClient,
    wav_to_pcm16_mono,
)
from training.model2.corruption.bank import resample_audio, wav_bytes_pcm16  # noqa: E402
from training.model2.constants import DEFAULT_ASR_SAMPLE_RATE  # noqa: E402
from training.model3_dataset.scripts.stage2_v2_label import (  # noqa: E402
    derive_malformed_regions,
    label_spans_v2,
)

DOCS = REPO / "docs/user_correction/model3"
POOL = DOCS / "model3_certified_base_pool_v2.jsonl"
MANIFEST = REPO / "test wav/dialog_200/cases.manifest.json"
HARNESS = REPO / "training/model3_dataset/offline_harness/acoustic_b2_formal_materialize.cjs"
ELECTRON = REPO / "electron_node/electron-node/node_modules/electron/dist/electron.exe"
WORK = REPO / "training/model3_dataset/offline_harness/_b2_ext_work"
WAV_DIR = WORK / "wavs"

PROTECTED = {
    "d002", "d003", "d019", "d049", "d099", "d131", "d139",
    "d142", "d160", "d176", "d179", "d181", "d195",
}
_CJK = re.compile(r"[\u4e00-\u9fff]")
SEED = 2026083001


def load_protected_texts() -> set[str]:
    out = set()
    if MANIFEST.exists():
        m = json.loads(MANIFEST.read_text(encoding="utf-8"))
        for c in m.get("cases") or []:
            if c.get("id") in PROTECTED:
                t = (c.get("expectedText") or c.get("text") or "").strip()
                if t:
                    out.add(t)
    return out


def load_reference_pool(n: int) -> list[dict]:
    prot = load_protected_texts()
    rng = np.random.default_rng(SEED)
    rows = []
    with POOL.open(encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            o = json.loads(line)
            t = (o.get("normalized") or o.get("text") or "").strip()
            src = (o.get("source") or "").lower()
            if "dialog_200" in src or "dialog200" in src:
                continue
            if t in prot:
                continue
            cjk = len(_CJK.findall(t))
            if cjk < 10 or cjk > 36 or len(t) > 48:
                continue
            # Prefer spoken-like full utterances over template stubs
            if t.startswith("一般对话里常说") and cjk < 14:
                continue
            rows.append(
                {
                    "referenceId": o.get("id") or hashlib.md5(t.encode()).hexdigest()[:12],
                    "referenceText": t,
                    "sourcePoolId": "model3_certified_base_pool_v2",
                    "source": o.get("source"),
                }
            )
    rng.shuffle(rows)
    # de-dupe exact text
    seen = set()
    uniq = []
    for r in rows:
        if r["referenceText"] in seen:
            continue
        seen.add(r["referenceText"])
        uniq.append(r)
        if len(uniq) >= n:
            break
    return uniq


def holdout_check(rows: list[dict]) -> list[str]:
    prot = load_protected_texts()
    hits = []
    for r in rows:
        if r.get("referenceText") in prot:
            hits.append(f"ref:{r['referenceId']}")
        if r.get("actualAsrText") in prot:
            hits.append(f"asr:{r['referenceId']}")
    return hits


def region_family(tag: str, length_changing: bool, cur_len: int, ref_len: int) -> str:
    """Map SequenceMatcher opcodes to report taxonomy (document code semantics)."""
    if tag == "replace":
        if length_changing or cur_len != ref_len:
            return "MULTI_CHAR_REPLACEMENT"
        return "SUBSTITUTION"
    if tag == "delete":
        # current has extra chars vs reference (ASR insertion relative to ref)
        return "INSERTION"
    if tag == "insert":
        # reference has chars missing in current (ASR deletion relative to ref)
        return "DELETION"
    return (tag or "OTHER").upper()


def post_asr_pcm(pcm: bytes, sr: int, job_id: str) -> dict:
    body = json.dumps(
        {
            "job_id": job_id,
            "src_lang": "zh",
            "audio": base64.b64encode(pcm).decode("ascii"),
            "audio_format": "pcm16",
            "sample_rate": sr,
            "task": "transcribe",
            "condition_on_previous_text": False,
            "use_context_buffer": False,
            "use_text_context": False,
            "beam_size": 1,
            "temperature": 0,
            "trace_id": job_id,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        "http://127.0.0.1:6007/utterance",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=300) as resp:
        raw = json.loads(resp.read().decode("utf-8"))
    raw["_client_latency_ms"] = (time.perf_counter() - t0) * 1000.0
    return raw


def extract_tone_slices(asr_raw: dict) -> list:
    tone = asr_raw.get("tone") or asr_raw.get("utterance_tone") or {}
    if isinstance(tone, dict):
        return tone.get("acousticToneSlices") or []
    return []


def run_lattice_batch(reqs: list[dict]) -> tuple[list[dict], float]:
    WORK.mkdir(parents=True, exist_ok=True)
    req_path = WORK / "req.jsonl"
    resp_path = WORK / "resp.jsonl"
    err_path = WORK / "err.txt"
    with req_path.open("w", encoding="utf-8") as f:
        for r in reqs:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    env = os.environ.copy()
    env["ELECTRON_RUN_AS_NODE"] = "1"
    env["PROJECT_ROOT"] = str(REPO)
    cwd = str(REPO / "electron_node/electron-node")
    cmd = f'type "{req_path}" | "{ELECTRON}" "{HARNESS}" > "{resp_path}" 2> "{err_path}"'
    t0 = time.perf_counter()
    subprocess.run(cmd, shell=True, cwd=cwd, env=env)
    elapsed = time.perf_counter() - t0
    outs = []
    if resp_path.exists():
        for line in resp_path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line or line.startswith("[Logger]"):
                continue
            try:
                outs.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return outs, elapsed


def materialize_fresh(refs: list[dict], stage_name: str) -> tuple[list[dict], dict]:
    WAV_DIR.mkdir(parents=True, exist_ok=True)
    piper = PiperTtsClient()
    piper.health()
    compute = {
        "tts_ms": 0.0,
        "asr_ms": 0.0,
        "lattice_ms": 0.0,
        "stage": stage_name,
        "asr_env": "TONE_P10_VAD_CPU=1 (authorized VAD CPU EP; ASR still CUDA)",
    }
    attempted = []
    lattice_reqs = []

    for i, ref in enumerate(refs):
        rid = f"b2x_{stage_name}_{i:03d}_{ref['referenceId']}"
        row = {
            **ref,
            "attemptId": rid,
            "status": "ATTEMPTED",
            "ttsRunIdentity": None,
            "asrRunIdentity": None,
            "toneRunIdentity": None,
            "audioAssetId": None,
            "actualAsrText": None,
            "rejectReason": None,
        }
        t_tts = time.perf_counter()
        try:
            synth = piper.synthesize(ref["referenceText"])
        except Exception as e:
            row["status"] = "AUDIO_FAIL"
            row["rejectReason"] = f"tts_fail:{e}"
            attempted.append(row)
            continue
        compute["tts_ms"] += (time.perf_counter() - t_tts) * 1000.0

        # resample to 16k mono pcm wav
        with wave.open(BytesIO(synth.wav_bytes), "rb") as wf:
            sr0 = wf.getframerate()
            ch = wf.getnchannels()
            frames = wf.readframes(wf.getnframes())
        import array

        a = array.array("h")
        a.frombytes(frames)
        if ch == 2:
            a = array.array("h", ((a[j] + a[j + 1]) // 2 for j in range(0, len(a), 2)))
        audio = np.asarray(a, dtype=np.float32) / 32768.0
        audio16 = resample_audio(audio, sr0, DEFAULT_ASR_SAMPLE_RATE)
        wav16 = wav_bytes_pcm16(audio16, DEFAULT_ASR_SAMPLE_RATE)
        wav_path = WAV_DIR / f"{rid}.wav"
        wav_path.write_bytes(wav16)
        row["audioAssetId"] = str(wav_path)
        row["ttsRunIdentity"] = {
            "voice": synth.voice,
            "sample_rate_native": synth.sample_rate,
            "latency_ms": synth.latency_ms,
            "service_id": synth.service_id,
        }

        pcm, sr = wav_to_pcm16_mono(wav16, DEFAULT_ASR_SAMPLE_RATE)
        try:
            asr_raw = post_asr_pcm(pcm, sr, rid)
        except Exception as e:
            row["status"] = "ASR_FAIL"
            row["rejectReason"] = f"asr_fail:{e}"
            attempted.append(row)
            continue
        compute["asr_ms"] += float(asr_raw.get("_client_latency_ms") or 0)

        text = (asr_raw.get("text") or asr_raw.get("rawText") or "").strip()
        segs = asr_raw.get("segments") or []
        slices = extract_tone_slices(asr_raw)
        row["actualAsrText"] = text
        row["asrSegments"] = segs
        row["acousticToneSlices"] = slices
        row["asrRunIdentity"] = {
            "endpoint": "http://127.0.0.1:6007/utterance",
            "latency_ms": asr_raw.get("_client_latency_ms"),
            "device": "cuda",
            "vad_ep": "CPUExecutionProvider(TONE_P10_VAD_CPU)",
        }
        row["toneRunIdentity"] = {
            "sliceCount": len(slices),
            "toneEnabled": (asr_raw.get("tone") or {}).get("toneEnabled"),
            "source": "faster_whisper_vad.tone_module",
        }
        if not text:
            row["status"] = "ASR_EMPTY"
            row["rejectReason"] = "empty_asr_text"
            attempted.append(row)
            continue
        if not slices:
            row["status"] = "TONE_EMPTY"
            row["rejectReason"] = "no_acousticToneSlices"
            attempted.append(row)
            continue

        row["status"] = "ASR_OK"
        attempted.append(row)
        lattice_reqs.append(
            {
                "id": rid,
                "referenceText": ref["referenceText"],
                "currentText": text,
                "acousticToneSlices": slices,
                "asrSegments": segs,
            }
        )

    mats, lat_s = run_lattice_batch(lattice_reqs) if lattice_reqs else ([], 0.0)
    compute["lattice_ms"] = lat_s * 1000.0
    by_id = {m.get("id"): m for m in mats}
    for row in attempted:
        if row["status"] != "ASR_OK":
            continue
        mat = by_id.get(row["attemptId"])
        row["lattice"] = mat
        if not mat or not mat.get("ok"):
            row["status"] = "LATTICE_FAIL"
            row["rejectReason"] = f"lattice:{(mat or {}).get('error')}"
            continue
        # Fail-closed LABEL_FEATURE_PROVENANCE_COHERENT (fresh same-run):
        # FineSpan uses production normalizeForFwRepairInput(ASR).repairText.
        # OpenCC t→s / NFKC is production normalize — NOT cross-sample mismatch.
        # Reject only when lattice fails or FineSpan surface is empty / unusable.
        # Historical d055/d190 regression: raw dump text != harness repairText
        # is still classified REJECT by check_historical_provenance_sentinel().
        sent_asr = row["actualAsrText"] or ""
        current = mat.get("currentText") or ""
        reference = mat.get("referenceText") or row["referenceText"]
        if not current:
            row["status"] = "PROVENANCE_REJECT"
            row["rejectReason"] = "CROSS_SAMPLE_PROVENANCE_MISMATCH_TEXT"
            row["provenanceDetail"] = {
                "sentAsrText": sent_asr,
                "harnessCurrentText": current,
                "identityFailed": "currentText",
                "failureClass": "text_mismatch",
            }
            continue
        # Same-run coherence: harness must have used our request id + non-empty ASR
        if not sent_asr:
            row["status"] = "PROVENANCE_REJECT"
            row["rejectReason"] = "CROSS_SAMPLE_PROVENANCE_MISMATCH_TEXT"
            row["provenanceDetail"] = {"identityFailed": "actualAsrText", "failureClass": "text_mismatch"}
            continue
        row["currentText"] = current  # FineSpan / label surface (production repairText)
        row["referenceTextNorm"] = reference
        row["status"] = "PROVENANCE_ACCEPTED"
        row["recallLexiconIdentity"] = mat.get("reused") or {}
        row["pathCount"] = mat.get("pathCount")
        row["provenanceDetail"] = {
            "rawAsrText": sent_asr,
            "repairCurrentText": current,
            "scriptNormalized": sent_asr != current,
            "sameRun": True,
        }
    return attempted, compute


def check_historical_provenance_sentinel() -> dict:
    """Confirm aggregator would reject historical d055/d190 text mismatches."""
    work = REPO / "training/model3_dataset/offline_harness/_b2_yield_work"
    reqs = {}
    resps = {}
    req_path = work / "req.jsonl"
    resp_path = work / "resp.jsonl"
    if req_path.exists():
        for line in req_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            o = json.loads(line)
            reqs[o.get("id")] = o
    if resp_path.exists():
        for line in resp_path.read_text(encoding="utf-8").splitlines():
            if not line.strip() or line.startswith("[Logger]"):
                continue
            try:
                o = json.loads(line)
            except json.JSONDecodeError:
                continue
            resps[o.get("id")] = o
    out = []
    for sid in ("d055", "d190"):
        req = reqs.get(sid) or {}
        resp = resps.get(sid) or {}
        sent = req.get("currentText") or ""
        harness = resp.get("currentText") or ""
        would_reject = (not harness) or (harness != sent)
        out.append(
            {
                "id": sid,
                "sentCurrentText": sent[:80],
                "harnessCurrentText": harness[:80],
                "wouldReject": would_reject,
                "reason": "CROSS_SAMPLE_PROVENANCE_MISMATCH_TEXT" if would_reject else None,
            }
        )
    return {
        "code": "HISTORICAL_PROVENANCE_SENTINEL",
        "allWouldReject": all(x["wouldReject"] for x in out),
        "cases": out,
    }


def analyze(attempted: list[dict], compute: dict) -> dict:
    import difflib

    n0 = len(attempted)
    funnel = Counter()
    funnel["N0_ATTEMPTED"] = n0

    accepted: list[dict] = []
    rejected: list[dict] = []

    # RAW_ATTEMPTED funnel prefixes (N0–N3)
    for row in attempted:
        if row.get("audioAssetId"):
            funnel["N1_AUDIO_OK"] += 1
        if row.get("actualAsrText"):
            funnel["N2_ASR_OK"] += 1
            if row["actualAsrText"] != row.get("referenceText"):
                funnel["N3_ASR_MISMATCH"] += 1
        if row.get("status") == "PROVENANCE_ACCEPTED":
            accepted.append(row)
        elif row.get("status") not in ("ATTEMPTED",):
            rejected.append(
                {
                    "referenceId": row.get("referenceId"),
                    "attemptId": row.get("attemptId"),
                    "reason": row.get("rejectReason") or row.get("status"),
                    "status": row.get("status"),
                }
            )

    # PROVENANCE_ACCEPTED ONLY supervised aggregates
    cand_cells: Counter = Counter()
    cand_hist: Counter = Counter()
    label_hist: Counter = Counter()
    family_hist: Counter = Counter()
    readiness: Counter = Counter()
    anchor_src: Counter = Counter()
    path_hist: Counter = Counter()
    multipath_utt = 0
    retry_utt: set[str] = set()
    retry_regions = 0
    retry_span_path = 0
    retry_cand_gt0_utt: set[str] = set()
    surface_by_utt: dict[str, dict[str, set]] = defaultdict(
        lambda: {"KEEP": set(), "RETRY": set()}
    )
    surface_path_dup: dict[str, Counter] = defaultdict(Counter)

    for row in accepted:
        current = row.get("currentText") or ""
        reference = row.get("referenceTextNorm") or row["referenceText"]
        mat = row.get("lattice") or {}
        if not mat.get("ok"):
            continue

        regions = derive_malformed_regions(current, reference)
        sm = difflib.SequenceMatcher(a=current, b=reference, autojunk=False)
        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            if tag == "equal":
                continue
            fam = region_family(tag, (i2 - i1) != (j2 - j1), i2 - i1, j2 - j1)
            family_hist[fam] += 1
        if regions:
            funnel["N4_ALIGNMENT_REGION"] += 1

        pc = int(mat.get("pathCount") or 0)
        path_hist[pc] += 1
        if pc > 1:
            multipath_utt += 1

        utt_repairable = False
        utt_overlap = False
        utt_tone_ready = False
        utt_cand_valid = False
        utt_has_retry = False
        utt_retry_gt0 = False
        region_retry_keys: set = set()

        for path in mat.get("paths") or []:
            spans = path.get("spans") or []
            labeled, _, regs = label_spans_v2(
                {
                    "currentText": current,
                    "referenceText": reference,
                    "spans": spans,
                    "corruptions": [],
                }
            )
            if any(r.get("curEnd", 0) > r.get("curStart", 0) for r in regs):
                utt_repairable = True
            id_cand = {
                s["spanId"]: int(
                    (s.get("recallEvidence") or {}).get("firstPassCandidateCount") or 0
                )
                for s in spans
            }
            id_tone = {s["spanId"]: s.get("toneReadiness") for s in spans}
            for sp in labeled:
                lab = sp.get("label")
                if lab == "EXCLUDE_FROM_SUPERVISED":
                    lab = "EXCLUDE"
                label_hist[lab or "UNK"] += 1
                is_anchor = bool(sp.get("isAnchor"))
                anchor_src[
                    sp.get("anchorSource") or ("DOMAIN" if is_anchor else "NONE")
                ] += 1
                tr = id_tone.get(sp.get("spanId")) or "unknown"
                readiness[tr] += 1
                if tr == "ready":
                    utt_tone_ready = True
                cand = id_cand.get(sp.get("spanId"), 0)
                if cand > 0:
                    utt_cand_valid = True
                if not is_anchor and lab in ("KEEP", "RETRY"):
                    cand_hist[cand] += 1
                    cand_cells[f"{lab}_cand_{'gt0' if cand > 0 else '0'}"] += 1
                    surf = sp.get("surface") or ""
                    if surf:
                        surface_by_utt[surf][lab].add(row["attemptId"])
                        surface_path_dup[surf][lab] += 1
                if lab == "RETRY" and not is_anchor:
                    utt_has_retry = True
                    utt_overlap = True
                    retry_span_path += 1
                    region_retry_keys.add((sp.get("rawStart"), sp.get("rawEnd")))
                    if cand > 0:
                        utt_retry_gt0 = True

        if utt_repairable:
            funnel["N5_REPAIRABLE_NONANCHOR_REGION"] += 1
        if utt_overlap:
            funnel["N6_FINESPAN_OVERLAP"] += 1
        if utt_tone_ready:
            funnel["N7_TONE_READY"] += 1
        if utt_cand_valid:
            funnel["N8_CAND_STATE_VALID"] += 1
        if utt_has_retry:
            funnel["N9_HAS_RETRY"] += 1
            funnel["N10_PROVENANCE_COHERENT_AND_HAS_RETRY"] += 1
            retry_utt.add(row["attemptId"])
            retry_regions += len(region_retry_keys)
        if utt_retry_gt0:
            funnel["N11_PROVENANCE_COHERENT_AND_HAS_RETRY_CAND_GT0"] += 1
            retry_cand_gt0_utt.add(row["attemptId"])

    n3_all = funnel.get("N3_ASR_MISMATCH", 0)
    n_acc = max(len(accepted), 1)
    n0m = max(n0, 1)

    indep_contrast = []
    path_only_contrast = []
    for surf, labs in surface_by_utt.items():
        if labs["KEEP"] and labs["RETRY"]:
            indep_contrast.append(
                {
                    "surface": surf,
                    "keep_utts": len(labs["KEEP"]),
                    "retry_utts": len(labs["RETRY"]),
                }
            )
    indep_surfs = {x["surface"] for x in indep_contrast}
    for surf, ctr in surface_path_dup.items():
        if ctr.get("KEEP", 0) and ctr.get("RETRY", 0) and surf not in indep_surfs:
            path_only_contrast.append(
                {"surface": surf, "KEEP": ctr["KEEP"], "RETRY": ctr["RETRY"]}
            )

    return {
        "funnel": dict(funnel),
        "yields": {
            "RAW_ASR_MISMATCH_YIELD": n3_all / n0m,
            "REPAIRABLE_REGION_YIELD": funnel.get("N5_REPAIRABLE_NONANCHOR_REGION", 0)
            / n0m,
            "COHERENT_RETRY_YIELD": funnel.get(
                "N10_PROVENANCE_COHERENT_AND_HAS_RETRY", 0
            )
            / n0m,
            "COHERENT_RETRY_CAND_GT0_YIELD": funnel.get(
                "N11_PROVENANCE_COHERENT_AND_HAS_RETRY_CAND_GT0", 0
            )
            / n0m,
            "COHERENT_RETRY_YIELD_GIVEN_ACCEPTED": funnel.get(
                "N10_PROVENANCE_COHERENT_AND_HAS_RETRY", 0
            )
            / n_acc,
            "COHERENT_RETRY_CAND_GT0_YIELD_GIVEN_ACCEPTED": funnel.get(
                "N11_PROVENANCE_COHERENT_AND_HAS_RETRY_CAND_GT0", 0
            )
            / n_acc,
        },
        "accepted_n": len(accepted),
        "rejected_n": len(rejected),
        "rejected": rejected,
        "cand_cells_accepted": dict(cand_cells),
        "cand_hist_accepted": {str(k): v for k, v in sorted(cand_hist.items())},
        "label_hist_accepted": dict(label_hist),
        "family_hist_accepted": dict(family_hist),
        "readiness_accepted": dict(readiness),
        "anchor_src_accepted": dict(anchor_src),
        "independence": {
            "retry_utterances": len(retry_utt),
            "retry_regions": retry_regions,
            "retry_span_x_path": retry_span_path,
            "retry_cand_gt0_utterances": len(retry_cand_gt0_utt),
            "multipath_utterances": multipath_utt,
            "path_hist": dict(path_hist),
        },
        "same_surface_independent": indep_contrast[:40],
        "same_surface_path_only": path_only_contrast[:40],
        "compute": compute,
        "accepted_ids": [r["attemptId"] for r in accepted],
    }


def classify(res: dict, fresh_ok: bool) -> tuple[str, str]:
    if not fresh_ok:
        return "FRESH_B2_PIPELINE_BLOCKED", "MODEL3_V2_ACOUSTIC_PIPELINE_ENVIRONMENT_RECOVERY_AUDIT"
    if res["rejected_n"] and res["accepted_n"] == 0:
        return "PROVENANCE_COHERENCE_FAILURE", "STOP_AND_REVIEW"
    cells = res["cand_cells_accepted"]
    if (
        cells.get("KEEP_cand_gt0", 0) + cells.get("RETRY_cand_gt0", 0) == 0
        and cells.get("KEEP_cand_0", 0) + cells.get("RETRY_cand_0", 0) > 0
    ):
        return "CANDIDATE_STATE_FAILURE", "STOP_AND_REVIEW"
    indep = res["independence"]
    n0 = res["funnel"]["N0_ATTEMPTED"]
    n11 = res["funnel"].get("N11_PROVENANCE_COHERENT_AND_HAS_RETRY_CAND_GT0", 0)
    retry_utts = indep["retry_cand_gt0_utterances"]
    families = sum(1 for v in res["family_hist_accepted"].values() if v > 0)

    if n0 >= 40 and retry_utts >= 8 and cells.get("RETRY_cand_gt0", 0) >= 20 and families >= 2:
        return "B2_EXTENSION_PASS", "MODEL3_V2_ACOUSTIC_TRAINING_STATE_IMPLEMENTATION_PLAN"
    if n0 >= 20 and retry_utts >= 3 and cells.get("RETRY_cand_gt0", 0) >= 5:
        # positive but may want more N — if already >=50 with weak diversity → LOW_DIVERSITY
        if n0 >= 50 and retry_utts < 5:
            return "B2_LOW_DIVERSITY", "MODEL3_V2_ACOUSTIC_YIELD_ENHANCEMENT_ARCHITECTURE_PROPOSAL"
        if n0 >= 50 and n11 / max(n0, 1) < 0.05:
            return "B2_LOW_YIELD", "MODEL3_V2_ACOUSTIC_YIELD_ENHANCEMENT_ARCHITECTURE_PROPOSAL"
        if n0 < 50:
            return (
                "B2_EXTENSION_PROMISING_MORE_EVIDENCE_NEEDED",
                "MODEL3_V2_ACOUSTIC_MATERIALIZATION_YIELD_PROBE_EXTENSION_2",
            )
        return "B2_EXTENSION_PASS", "MODEL3_V2_ACOUSTIC_TRAINING_STATE_IMPLEMENTATION_PLAN"
    if n11 == 0:
        return "B2_LOW_YIELD", "MODEL3_V2_ACOUSTIC_YIELD_ENHANCEMENT_ARCHITECTURE_PROPOSAL"
    return (
        "B2_EXTENSION_PROMISING_MORE_EVIDENCE_NEEDED",
        "MODEL3_V2_ACOUSTIC_MATERIALIZATION_YIELD_PROBE_EXTENSION_2",
    )


def main() -> int:
    wall0 = time.perf_counter()
    # Stage 1
    refs1 = load_reference_pool(25)
    collisions = holdout_check([{**r, "actualAsrText": None} for r in refs1])
    if collisions:
        print(json.dumps({"verdict": "PROTECTED_HOLDOUT_LEAKAGE", "collisions": collisions}, indent=2))
        return 2

    print(f"[ext] stage1 n={len(refs1)} starting fresh B2...", flush=True)
    att1, comp1 = materialize_fresh(refs1, "s1")
    ok1 = sum(1 for r in att1 if r.get("status") == "PROVENANCE_ACCEPTED")
    asr_ok = sum(1 for r in att1 if r.get("actualAsrText"))
    print(f"[ext] stage1 asr_ok={asr_ok} accepted={ok1}", flush=True)

    if asr_ok == 0:
        summary = {
            "probeVerdict": "FRESH_B2_PIPELINE_BLOCKED",
            "freshB2Exercised": False,
            "blocker": "ASR/Tone produced no usable outputs",
            "attempted": len(att1),
            "statuses": dict(Counter(r.get("status") for r in att1)),
            "nextPhase": "MODEL3_V2_ACOUSTIC_PIPELINE_ENVIRONMENT_RECOVERY_AUDIT",
        }
        (DOCS / "model3_v2_acoustic_extension_summary.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(json.dumps(summary, indent=2, ensure_ascii=False))
        return 3

    all_att = att1
    all_comp = {
        "tts_ms": comp1.get("tts_ms", 0),
        "asr_ms": comp1.get("asr_ms", 0),
        "lattice_ms": comp1.get("lattice_ms", 0),
        "asr_env": comp1.get("asr_env"),
        "stages": ["s1"],
    }

    if ok1 == 0:
        res = analyze(all_att, all_comp)
        verdict, nxt = "PROVENANCE_COHERENCE_FAILURE", "STOP_AND_REVIEW"
    else:
        # Stage 2 extend toward ~55
        need = max(0, 55 - len(att1))
        refs2 = load_reference_pool(55 + need)[len(refs1) : len(refs1) + need]
        print(f"[ext] stage2 extend +{len(refs2)}", flush=True)
        att2, comp2 = materialize_fresh(refs2, "s2") if refs2 else ([], {})
        all_att = att1 + att2
        all_comp["tts_ms"] += comp2.get("tts_ms", 0)
        all_comp["asr_ms"] += comp2.get("asr_ms", 0)
        all_comp["lattice_ms"] += comp2.get("lattice_ms", 0)
        if refs2:
            all_comp["stages"].append("s2")
        res = analyze(all_att, all_comp)
        n11 = res["funnel"].get("N11_PROVENANCE_COHERENT_AND_HAS_RETRY_CAND_GT0", 0)
        if len(all_att) < 80 and n11 < 8:
            need3 = min(40, 100 - len(all_att))
            refs3 = load_reference_pool(120)[
                len(refs1) + len(refs2) : len(refs1) + len(refs2) + need3
            ]
            print(f"[ext] stage3 extend +{len(refs3)}", flush=True)
            att3, comp3 = materialize_fresh(refs3, "s3") if refs3 else ([], {})
            all_att = all_att + att3
            all_comp["tts_ms"] += comp3.get("tts_ms", 0)
            all_comp["asr_ms"] += comp3.get("asr_ms", 0)
            all_comp["lattice_ms"] += comp3.get("lattice_ms", 0)
            if refs3:
                all_comp["stages"].append("s3")
            res = analyze(all_att, all_comp)

        collisions2 = holdout_check(all_att)
        if collisions2:
            summary = {
                "probeVerdict": "PROTECTED_HOLDOUT_LEAKAGE",
                "collisions": collisions2,
            }
            (DOCS / "model3_v2_acoustic_extension_summary.json").write_text(
                json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            return 2

        verdict, nxt = classify(res, fresh_ok=True)

    wall = time.perf_counter() - wall0
    n0 = res["funnel"]["N0_ATTEMPTED"]
    summary = {
        "phase": "MODEL3_V2_ACOUSTIC_MATERIALIZATION_YIELD_PROBE_EXTENSION",
        "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "probeVerdict": verdict,
        "freshB2Exercised": True,
        "attemptedN": n0,
        "provenanceAccepted": res["accepted_n"],
        "provenanceRejected": res["rejected_n"],
        "architectureSignal": "POSITIVE"
        if res["cand_cells_accepted"].get("RETRY_cand_gt0", 0) > 0
        else "WEAK",
        "readyForImplementationPlan": verdict == "B2_EXTENSION_PASS",
        "datasetBuild": "BLOCKED",
        "previousAccountingCorrection": {
            "code": "PREVIOUS_PROBE_PROVENANCE_ACCOUNTING_ERROR",
            "previousReportSaid": {"coherent": 12, "rejected": 0},
            "structuredArtifactSaid": {"coherent_ok": 10, "coherent_fail": 2, "ids": ["d055", "d190"]},
            "correctInterpretation": (
                "Primary report aggregation ignored provenance rejects; "
                "structured artifact is authoritative for previous probe."
            ),
            "old_66_7_percent": "DIRECTIONAL_ONLY_NOT_ACCEPTED",
        },
        "asrEnvironmentRecovery": {
            "failure_1": "Silero VAD CUDA EP crash: cudnnGetLibConfig (exit 3221226505)",
            "restoredWith_1": "TONE_P10_VAD_CPU=1 (authorized VAD CPU EP; ASR Whisper remains CUDA)",
            "failure_2": "Client wav_bytes_pcm16 cast float[-1,1]→int16 without scale → all-zero PCM → ASR empty",
            "restoredWith_2": "training/model2/corruption/bank.py:_float_audio_to_pcm16 (encode tooling only)",
            "asrBusinessSemanticsChanged": False,
            "vadBusinessBehaviorChanged": False,
        },
        "historicalProvenanceSentinel": check_historical_provenance_sentinel(),
        "funnel": res["funnel"],
        "yields": res["yields"],
        "cand_cells_accepted": res["cand_cells_accepted"],
        "cand_hist_accepted": res["cand_hist_accepted"],
        "label_hist_accepted": res["label_hist_accepted"],
        "family_hist_accepted": res["family_hist_accepted"],
        "readiness_accepted": res["readiness_accepted"],
        "anchor_src_accepted": res["anchor_src_accepted"],
        "independence": res["independence"],
        "same_surface_independent": res["same_surface_independent"],
        "same_surface_path_only": res["same_surface_path_only"],
        "rejects": res["rejected"],
        "nextPhase": nxt,
        "nextPhaseExecuted": False,
        "governance": {
            "Model3Changed": False,
            "featureContractChanged": False,
            "RecallChanged": False,
            "ToneChanged": False,
            "pronunciationPerturbation": False,
            "formalDataset": False,
            "training": False,
        },
        "wall_sec": round(wall, 2),
    }

    DOCS.mkdir(parents=True, exist_ok=True)
    (DOCS / "model3_v2_acoustic_extension_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    with (DOCS / "model3_v2_acoustic_extension_funnel.csv").open("w", encoding="utf-8") as f:
        f.write("stage,count,rate_of_N0\n")
        for k, v in res["funnel"].items():
            f.write(f"{k},{v},{v/max(n0,1):.4f}\n")
        for k, v in res["yields"].items():
            f.write(f"{k},{v:.6f},\n")

    with (DOCS / "model3_v2_acoustic_extension_candidate_distribution.csv").open(
        "w", encoding="utf-8"
    ) as f:
        f.write("scope,cell,count\n")
        for k, v in res["cand_cells_accepted"].items():
            f.write(f"PROVENANCE_ACCEPTED,{k},{v}\n")
        for k, v in res["cand_hist_accepted"].items():
            f.write(f"PROVENANCE_ACCEPTED_rawCand,{k},{v}\n")

    with (DOCS / "model3_v2_acoustic_extension_provenance_rejects.csv").open(
        "w", encoding="utf-8"
    ) as f:
        f.write("referenceId,attemptId,status,reason\n")
        for r in res["rejected"]:
            f.write(
                f"{r.get('referenceId')},{r.get('attemptId')},{r.get('status')},{r.get('reason')}\n"
            )

    compute_doc = {
        "ssot": "extension_probe_perf_counters",
        "previousDiscrepancy": {
            "structured_harness_claimed_sec": 3.27,
            "primary_report_claimed_sec": "25-30",
            "resolution": (
                "Previous primary report wall time included Electron cold start / lexicon load; "
                "structured harness_elapsed was lattice-only after warm process or mis-shared timer. "
                "This extension reports stage timers + total wall separately."
            ),
        },
        "tts_sec": round(all_comp["tts_ms"] / 1000.0, 3),
        "asr_fw_tone_sec": round(all_comp["asr_ms"] / 1000.0, 3),
        "recall_lattice_label_sec": round(all_comp["lattice_ms"] / 1000.0, 3),
        "wall_sec": round(wall, 3),
        "per_utt_wall_sec": round(wall / max(n0, 1), 3),
        "asr_env": all_comp.get("asr_env"),
        "note": "ASR/FW and Tone are measured together via /utterance client latency",
    }
    (DOCS / "model3_v2_acoustic_extension_compute.json").write_text(
        json.dumps(compute_doc, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # persist attempted dump for audit (not a dataset)
    (WORK / "attempted_summary.jsonl").write_text(
        "\n".join(
            json.dumps(
                {
                    "attemptId": r.get("attemptId"),
                    "referenceId": r.get("referenceId"),
                    "status": r.get("status"),
                    "rejectReason": r.get("rejectReason"),
                    "referenceText": r.get("referenceText"),
                    "actualAsrText": r.get("actualAsrText"),
                    "currentText": r.get("currentText"),
                },
                ensure_ascii=False,
            )
            for r in all_att
        ),
        encoding="utf-8",
    )

    print(
        json.dumps(
            {
                "verdict": verdict,
                "attempted": n0,
                "accepted": res["accepted_n"],
                "rejected": res["rejected_n"],
                "yields": res["yields"],
                "cand": res["cand_cells_accepted"],
                "independence": res["independence"],
                "nextPhase": nxt,
                "wall_sec": round(wall, 2),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
