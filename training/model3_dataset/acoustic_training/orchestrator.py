# -*- coding: utf-8 -*-
"""Formal B2 acoustic training-state orchestrator — coordinates owners only."""
from __future__ import annotations

import json
import os
import subprocess
import time
import urllib.request
from pathlib import Path
from typing import Any

from training.model2.adapters.faster_whisper_client import (
    FasterWhisperClient,
    wav_to_pcm16_mono,
)
from training.model2.constants import DEFAULT_ASR_SAMPLE_RATE
from training.model3_dataset.acoustic_training.audio_materializer import materialize_audio
from training.model3_dataset.acoustic_training.family_identity import (
    assign_split,
    materialization_run_id,
    semantic_family_id,
)
from training.model3_dataset.acoustic_training.holdout_registry import check_holdout
from training.model3_dataset.acoustic_training.manifest import (
    empty_manifest,
    load_manifest,
    resume_key,
    save_manifest,
    update_counts,
)
from training.model3_dataset.acoustic_training.provenance import (
    classify_supervised_outcome,
    validate_label_feature_provenance_coherent,
    validate_text_identity,
)
from training.model3_dataset.acoustic_training.serializer import (
    CandidateStateError,
    serialize_path_samples,
)
from training.model3_dataset.scripts.stage2_v2_label import label_spans_v2

REPO = Path(__file__).resolve().parents[3]
HARNESS = REPO / "training/model3_dataset/offline_harness/acoustic_b2_formal_materialize.cjs"
# Legacy probe harness — redirect note only; formal owner is HARNESS above.
LEGACY_PROBE_HARNESS = REPO / "training/model3_dataset/offline_harness/acoustic_b2_materialize.cjs"
ELECTRON = REPO / "electron_node/electron-node/node_modules/electron/dist/electron.exe"
WORK = REPO / "training/model3_dataset/offline_harness/_b2_formal_work"


def run_formal_lattice_batch(reqs: list[dict]) -> tuple[list[dict], float]:
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
    # Gate0 acceptance must never silently disable Model2.
    env.pop("MODEL2_RUNTIME_DISABLED", None)
    cwd = str(REPO / "electron_node/electron-node")
    cmd = f'type "{req_path}" | "{ELECTRON}" "{HARNESS}" > "{resp_path}" 2> "{err_path}"'
    t0 = time.perf_counter()
    # Per-utterance Model2 load can be slow on first call; allow generous batch budget.
    timeout_s = max(300, 180 * max(1, len(reqs)))
    try:
        subprocess.run(cmd, shell=True, cwd=cwd, env=env, timeout=timeout_s)
    except subprocess.TimeoutExpired:
        # Infrastructure recovery only — kill stuck electron/model2 host tree.
        subprocess.run(
            ["taskkill", "/F", "/T", "/IM", "electron.exe"],
            capture_output=True,
            check=False,
        )
    elapsed = time.perf_counter() - t0
    outs: list[dict] = []
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


def _extract_tone_slices(asr_raw: dict) -> list:
    tone = asr_raw.get("tone") or {}
    if isinstance(tone, dict):
        return tone.get("acousticToneSlices") or []
    return []


def materialize_utterance_from_parts(
    *,
    reference: dict,
    raw_actual_asr_text: str,
    asr_segments: list,
    acoustic_tone_slices: list,
    audio_meta: dict | None = None,
    asr_run_identity: dict | None = None,
    asr_env_identity: str | None = None,
    lattice: dict | None = None,
    formal_lattice_attested: bool = False,
) -> dict[str, Any]:
    """Core post-ASR materialization + label + provenance (testable without live ASR).

    When ``lattice`` is injected without ``formal_lattice_attested=True``, the result
    is marked ``TEST_FIXTURE`` and must not be consumed as Gate0 formal acceptance
    evidence. Same-run formal harness outputs may be attached with attestation.
    """
    rid = reference["referenceId"]
    ref_text = reference["referenceText"]
    near = reference.get("near_dup_key") or reference.get("nearDupKey")
    if near:
        fam = semantic_family_id(rid, ref_text, near_dup_key=str(near))
    else:
        fam = reference.get("semanticFamilyId") or semantic_family_id(rid, ref_text)

    hit = check_holdout(
        reference_id=rid,
        reference_text=ref_text,
        asr_text=raw_actual_asr_text,
    )
    if hit:
        return {"disposition": "HARD_REJECT", "reject": hit, "referenceId": rid}

    if not raw_actual_asr_text:
        return {
            "disposition": "HARD_REJECT",
            "reject": {"code": "ASR_FAILED", "kind": "HARD_REJECT"},
            "referenceId": rid,
        }
    if not acoustic_tone_slices:
        return {
            "disposition": "HARD_REJECT",
            "reject": {"code": "TONE_STATE_MISSING", "kind": "HARD_REJECT"},
            "referenceId": rid,
        }

    lattice_injected = lattice is not None
    if lattice is None:
        mats, _ = run_formal_lattice_batch(
            [
                {
                    "id": rid,
                    "referenceText": ref_text,
                    "rawActualAsrText": raw_actual_asr_text,
                    "acousticToneSlices": acoustic_tone_slices,
                    "asrSegments": asr_segments,
                    "userProfile": None,
                }
            ]
        )
        lattice = mats[0] if mats else {"ok": False, "error": "FINESPAN_MATERIALIZATION_FAILED"}
        evidence_source = lattice.get("evidenceSource") or "FORMAL_FRESH_MATERIALIZATION"
    elif formal_lattice_attested:
        evidence_source = "FORMAL_FRESH_MATERIALIZATION"
        lattice = {**lattice, "evidenceSource": evidence_source}
    else:
        # Fixture / unit-test injection — never claim formal Gate0 evidence.
        evidence_source = "TEST_FIXTURE"
        lattice = {**lattice, "evidenceSource": evidence_source}

    if not lattice.get("ok"):
        code = lattice.get("error") or "FINESPAN_MATERIALIZATION_FAILED"
        if code in (
            "TONE_STATE_MISSING",
            "MODEL3_CURRENT_TEXT_IDENTITY_INVALID",
            "RECALL_STATE_INVALID",
        ):
            pass
        else:
            code = "FINESPAN_MATERIALIZATION_FAILED"
        return {
            "disposition": "HARD_REJECT",
            "reject": {"code": code, "kind": "HARD_REJECT", "detail": lattice.get("message")},
            "referenceId": rid,
            "evidenceSource": evidence_source,
            "ownerDiagnostics": lattice.get("ownerDiagnostics"),
            "ownerExecution": lattice.get("ownerExecution"),
        }

    model3_current = lattice.get("model3CurrentText") or lattice.get("currentText") or ""
    ti = validate_text_identity(
        raw_actual_asr_text=raw_actual_asr_text,
        model3_current_text=model3_current,
        harness_current_text=lattice.get("currentText") or model3_current,
    )
    if ti:
        return {
            "disposition": "HARD_REJECT",
            "reject": ti,
            "referenceId": rid,
            "evidenceSource": evidence_source,
        }

    hit2 = check_holdout(
        reference_id=rid,
        reference_text=ref_text,
        asr_text=raw_actual_asr_text,
        current_text=model3_current,
    )
    if hit2:
        return {
            "disposition": "HARD_REJECT",
            "reject": hit2,
            "referenceId": rid,
            "evidenceSource": evidence_source,
        }

    asr_id = asr_run_identity or {"endpoint": "fixture"}
    tone_id = {
        "sliceCount": len(acoustic_tone_slices),
        "source": "faster_whisper_vad.tone_module_or_fixture",
    }
    audio_asset = (audio_meta or {}).get("audioAssetId")
    run_id = materialization_run_id(
        semantic_family_id_value=fam,
        audio_asset_id=audio_asset,
        asr_run_identity=asr_id,
        tone_run_identity=tone_id,
    )
    split = assign_split(fam)

    utt: dict[str, Any] = {
        "referenceId": rid,
        "referenceText": lattice.get("referenceText") or ref_text,
        "rawActualAsrText": raw_actual_asr_text,
        "model3CurrentText": model3_current,
        "currentText": model3_current,
        "semanticFamilyId": fam,
        "materializationRunId": run_id,
        "split": split,
        "sourceCorpus": reference.get("sourceCorpus"),
        "sourcePoolId": reference.get("sourcePoolId"),
        "near_dup_key": near,
        "evidenceLevel": (audio_meta or {}).get("evidenceLevel") or "TTS_ASR",
        "evidenceSource": evidence_source,
        "audioAssetId": audio_asset,
        "asrRunIdentity": asr_id,
        "fwTimestampIdentity": {"segmentCount": len(asr_segments)},
        "toneRunIdentity": tone_id,
        "asrEnvIdentity": asr_env_identity,
        "recallLexiconIdentity": (lattice.get("reused") or {}),
        "lattice": lattice,
        "ownerDiagnostics": lattice.get("ownerDiagnostics") or {},
        "ownerExecution": lattice.get("ownerExecution") or {},
        "model2AnchorStatus": lattice.get("model2AnchorStatus") or "UNAVAILABLE",
        "domainEvidence": lattice.get("domainEvidence"),
        "featureAvailability": lattice.get("featureAvailability"),
        "latticeInjected": lattice_injected,
    }

    prov = validate_label_feature_provenance_coherent(utt)
    if prov:
        return {
            "disposition": "HARD_REJECT",
            "reject": prov,
            "referenceId": rid,
            "utt": utt,
            "evidenceSource": evidence_source,
        }

    labeled_paths = []
    for path in lattice.get("paths") or []:
        labeled, _, _regs = label_spans_v2(
            {
                "currentText": model3_current,
                "referenceText": utt["referenceText"],
                "spans": path.get("spans") or [],
                "corruptions": [],
            }
        )
        by_id = {s.get("spanId"): s for s in (path.get("spans") or [])}
        for sp in labeled:
            src = by_id.get(sp.get("spanId")) or {}
            sp["packedInfer"] = src.get("packedInfer") or src.get("packedInferFields")
            sp["packedInferFields"] = sp["packedInfer"]
            sp["toneReadiness"] = src.get("toneReadiness")
            sp["recallEvidence"] = src.get("recallEvidence")
            sp["seqIndex"] = src.get("seqIndex")
            sp["anchorSource"] = src.get("anchorSource") or sp.get("anchorSource")
            if "isAnchor" in src:
                sp["isAnchor"] = src.get("isAnchor")
        labeled_paths.append(
            {
                "pathId": path.get("pathId"),
                "pathIndex": path.get("pathIndex"),
                "retainedDomains": path.get("retainedDomains") or [],
                "spans": labeled,
            }
        )
    utt["labeledPaths"] = labeled_paths
    outcome = classify_supervised_outcome(labeled_paths)
    samples: list = []
    if outcome["kind"] == "SUPERVISED_ACCEPTED":
        try:
            samples = serialize_path_samples(utt)
        except CandidateStateError as e:
            return {
                "disposition": "HARD_REJECT",
                "reject": {"code": e.code, "kind": "HARD_REJECT", "detail": e.detail},
                "referenceId": rid,
                "utt": utt,
                "evidenceSource": evidence_source,
            }
    return {
        "disposition": outcome["kind"],
        "code": outcome.get("code"),
        "counts": outcome.get("counts"),
        "utt": utt,
        "samples": samples,
        "referenceId": rid,
        "evidenceSource": evidence_source,
    }



def materialize_fresh_batch(
    references: list[dict],
    *,
    run_id: str,
    wav_dir: Path | None = None,
    manifest_path: Path | None = None,
    asr_env_identity: str | None = None,
) -> dict:
    """Full fresh B2: Piper → ASR → formal harness → labels (bounded; not dataset build).

    Lattice is batched in one formal harness process so Model2 loads once.
    """
    wav_dir = wav_dir or (WORK / "wavs")
    manifest_path = manifest_path or (WORK / f"manifest_{run_id}.json")
    manifest = load_manifest(manifest_path) if manifest_path.exists() else empty_manifest(
        run_id,
        sourcePoolId=(references[0].get("sourcePoolId") if references else None),
        asrEnvIdentity=asr_env_identity or os.environ.get("TONE_P10_VAD_CPU"),
    )
    completed = set(manifest.get("completedKeys") or [])
    asr_client = FasterWhisperClient(timeout_s=300)

    # Phase 1: audio + ASR (no lattice yet)
    pending: list[dict[str, Any]] = []
    early_results: list[dict[str, Any]] = []
    for i, ref in enumerate(references):
        try:
            audio = materialize_audio(
                ref["referenceText"], out_dir=wav_dir, asset_stem=f"{run_id}_{i:03d}"
            )
        except Exception as e:
            update_counts(manifest, "HARD_REJECT", "AUDIO_MATERIALIZATION_FAILED")
            early_results.append(
                {
                    "disposition": "HARD_REJECT",
                    "reject": {"code": "AUDIO_MATERIALIZATION_FAILED", "detail": str(e)},
                    "referenceId": ref["referenceId"],
                    "evidenceSource": "FORMAL_FRESH_MATERIALIZATION",
                }
            )
            continue

        try:
            pcm, sr = wav_to_pcm16_mono(audio["audioBytes"], DEFAULT_ASR_SAMPLE_RATE)
            hyp = asr_client.transcribe_pcm16(pcm, job_id=f"{run_id}_{i}", sample_rate=sr)
        except Exception as e:
            update_counts(manifest, "HARD_REJECT", "ASR_FAILED")
            early_results.append(
                {
                    "disposition": "HARD_REJECT",
                    "reject": {"code": "ASR_FAILED", "detail": str(e)},
                    "referenceId": ref["referenceId"],
                    "evidenceSource": "FORMAL_FRESH_MATERIALIZATION",
                }
            )
            continue

        raw = hyp.raw or {}
        slices = _extract_tone_slices(raw)
        asr_id = {
            "endpoint": asr_client.base_url + "/utterance",
            "latency_ms": hyp.latency_ms,
            "device": "cuda",
        }
        if not hyp.text:
            update_counts(manifest, "HARD_REJECT", "ASR_FAILED")
            early_results.append(
                {
                    "disposition": "HARD_REJECT",
                    "reject": {"code": "ASR_FAILED", "detail": "empty_asr_text"},
                    "referenceId": ref["referenceId"],
                    "evidenceSource": "FORMAL_FRESH_MATERIALIZATION",
                }
            )
            continue
        if not slices:
            update_counts(manifest, "HARD_REJECT", "TONE_STATE_MISSING")
            early_results.append(
                {
                    "disposition": "HARD_REJECT",
                    "reject": {"code": "TONE_STATE_MISSING", "kind": "HARD_REJECT"},
                    "referenceId": ref["referenceId"],
                    "evidenceSource": "FORMAL_FRESH_MATERIALIZATION",
                }
            )
            continue

        pending.append(
            {
                "ref": ref,
                "audio": audio,
                "hyp": hyp,
                "slices": slices,
                "asr_id": asr_id,
            }
        )

    # Phase 2: one formal harness batch (Model2 loads once)
    lattice_by_id: dict[str, dict] = {}
    lattice_elapsed = 0.0
    if pending:
        reqs = [
            {
                "id": p["ref"]["referenceId"],
                "referenceText": p["ref"]["referenceText"],
                "rawActualAsrText": p["hyp"].text,
                "acousticToneSlices": p["slices"],
                "asrSegments": p["hyp"].segments,
                "userProfile": None,
            }
            for p in pending
        ]
        mats, lattice_elapsed = run_formal_lattice_batch(reqs)
        for m in mats:
            mid = m.get("id")
            if mid is not None:
                lattice_by_id[str(mid)] = m

    # Phase 3: label + provenance with attested formal lattices
    results = list(early_results)
    for p in pending:
        rid = p["ref"]["referenceId"]
        lat = lattice_by_id.get(str(rid)) or {
            "ok": False,
            "error": "FINESPAN_MATERIALIZATION_FAILED",
            "evidenceSource": "FORMAL_FRESH_MATERIALIZATION",
        }
        out = materialize_utterance_from_parts(
            reference=p["ref"],
            raw_actual_asr_text=p["hyp"].text,
            asr_segments=p["hyp"].segments,
            acoustic_tone_slices=p["slices"],
            audio_meta=p["audio"],
            asr_run_identity=p["asr_id"],
            asr_env_identity=asr_env_identity,
            lattice=lat,
            formal_lattice_attested=True,
        )
        fam = (out.get("utt") or {}).get("semanticFamilyId") or p["ref"].get("semanticFamilyId")
        mrid = (out.get("utt") or {}).get("materializationRunId")
        if fam and mrid:
            key = resume_key(fam, mrid)
            if key in completed:
                out = {**out, "resumed": True}
            else:
                completed.add(key)
                update_counts(
                    manifest,
                    out["disposition"],
                    out.get("code") or (out.get("reject") or {}).get("code"),
                )
        else:
            update_counts(
                manifest,
                out["disposition"],
                out.get("code") or (out.get("reject") or {}).get("code"),
            )
        results.append(out)

    manifest["completedKeys"] = sorted(completed)
    manifest["latticeBatchElapsedSec"] = lattice_elapsed
    save_manifest(manifest_path, manifest)
    return {"manifest": manifest, "results": results}
