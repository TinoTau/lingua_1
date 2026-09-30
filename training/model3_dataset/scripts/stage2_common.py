# -*- coding: utf-8 -*-
"""Shared Stage2 helpers: labeling, validation, harness."""
from __future__ import annotations

import json
import os
import subprocess
import time
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
ELECTRON = (
    REPO / "electron_node/electron-node/node_modules/electron/dist/electron.exe"
)
HARNESS = REPO / "training/model3_dataset/offline_harness/stage2_materialize.cjs"

from training.model3_dataset.scripts.stage2_v2_label import (  # noqa: E402
    LABEL_CONTRACT_VERSION,
    derive_malformed_regions,
    label_spans_v2,
    relabel_sample_v2,
    region_retry_applicable,
)


def label_spans(mat: dict) -> tuple[list[dict], Counter]:
    """V2 label contract (region supervision projected onto existing FineSpans)."""
    spans_out, stats, _regions = label_spans_v2(mat)
    mat["malformedRegions"] = _regions
    return spans_out, stats


def label_spans_v1_legacy(mat: dict) -> tuple[list[dict], Counter]:
    """Frozen V1 exact-span contract — audit / comparison only."""
    spans_out = []
    stats: Counter = Counter()
    for s in mat.get("spans") or []:
        is_anchor = bool(s.get("isAnchor"))
        surface = s.get("surface") or ""
        ref = s.get("referenceSurface")
        if ref is None:
            ref = surface
        reach = (s.get("repairability") or {}).get("referenceReachable", "UNKNOWN")
        phonetic = bool(s.get("phoneticCompatible"))
        family = s.get("corruptionFamily") or ""
        ortho = family == "ORTHOGRAPHIC_DE_DI_DE"

        if is_anchor:
            label, tm, lc = "MASKED", 0, None
        elif reach == "UNKNOWN" and ref != surface:
            label, tm, lc = "EXCLUDE_FROM_SUPERVISED", 0, None
        elif (
            not is_anchor
            and ref != surface
            and phonetic
            and not ortho
            and reach == "YES"
        ):
            label, tm, lc = "RETRY", 1, "RETRY"
        elif not is_anchor and ref == surface:
            label, tm, lc = "KEEP", 1, "A"
        elif not is_anchor and ref != surface and (not phonetic or ortho):
            label, tm, lc = "KEEP", 1, "B"
        elif not is_anchor and reach == "NO":
            label, tm, lc = "KEEP", 1, "D"
        else:
            label, tm, lc = "KEEP", 1, "B"

        stats[label] += 1
        spans_out.append(
            {
                "spanId": s["spanId"],
                "surface": surface,
                "rawStart": s["rawStart"],
                "rawEnd": s["rawEnd"],
                "syllableStart": s.get("syllableStart"),
                "syllableEnd": s.get("syllableEnd"),
                "isAnchor": is_anchor,
                "anchorSource": s.get("anchorSource") or "NONE",
                "targetMask": tm,
                "label": label,
                "labelClass": lc,
                "referenceSurface": ref,
                "pinyinEvidence": s.get("pinyinEvidence"),
                "toneEvidence": s.get("toneEvidence"),
                "acousticEvidence": s.get("acousticEvidence"),
                "pronunciationEvidence": s.get("pronunciationEvidence"),
                "recallEvidence": s.get("recallEvidence"),
                "repairability": s.get("repairability"),
                "phoneticCompatible": phonetic,
                "corruptionFamily": family or None,
            }
        )
    return spans_out, stats


def validate_sample(sample: dict) -> list[str]:
    errs = []
    if sample.get("schemaVersion") != "MODEL3_TRAINING_SAMPLE_V1":
        errs.append("schemaVersion")
    for s in sample.get("spans") or []:
        if s.get("isAnchor") and s.get("label") == "RETRY":
            errs.append("anchor_retry")
        if s.get("label") == "RETRY" and not s.get("regionRetryApplicable"):
            errs.append("retry_without_region")
        if s.get("label") == "MASKED" and s.get("targetMask") != 0:
            errs.append("masked_targetmask")
        if s.get("isAnchor") and s.get("targetMask") != 0:
            errs.append("anchor_targetmask")
        cur = sample.get("currentText") or ""
        if s["rawStart"] < 0 or s["rawEnd"] > len(cur) or s["rawStart"] > s["rawEnd"]:
            errs.append("bad_offset")
        elif cur[s["rawStart"] : s["rawEnd"]] != s.get("surface"):
            errs.append("surface_mismatch")
    fa = sample.get("featureAvailability") or {}
    if fa.get("toneAcoustic") or fa.get("asrConfidence"):
        errs.append("fake_acoustic")
    if sample.get("evidenceLevel") == "SYNTHETIC_TEXT":
        if sample.get("model2AnchorStatus") not in ("UNAVAILABLE", None):
            if sample.get("model2AnchorStatus") == "RUNTIME_CONFIRMED":
                errs.append("forged_model2")
    return errs


def run_harness(
    requests: list[dict],
    resp_path: Path,
    work_dir: Path,
    worker_id: int = 0,
) -> list[dict]:
    work_dir.mkdir(parents=True, exist_ok=True)
    req_path = work_dir / f"_harness_req_{worker_id}.jsonl"
    err_path = work_dir / f"_harness_err_{worker_id}.txt"
    with req_path.open("w", encoding="utf-8") as f:
        for r in requests:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    env = os.environ.copy()
    env["ELECTRON_RUN_AS_NODE"] = "1"
    env["PROJECT_ROOT"] = str(REPO)
    cwd = str(REPO / "electron_node/electron-node")
    cmd = f'type "{req_path}" | "{ELECTRON}" "{HARNESS}" > "{resp_path}" 2> "{err_path}"'
    t0 = time.time()
    proc = subprocess.run(cmd, shell=True, cwd=cwd, env=env)
    elapsed = time.time() - t0
    print(f"harness worker={worker_id} exit={proc.returncode} elapsed={elapsed:.1f}s n={len(requests)}")
    outs = []
    if resp_path.exists():
        with resp_path.open(encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("[Logger]"):
                    continue
                try:
                    outs.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    return outs


def build_sample(
    mat: dict,
    spans: list[dict],
    meta: dict,
    sample_id: str,
    split: str,
    gen_version: str,
    dataset_version: str,
    sidecar_ref: str | None,
) -> dict:
    return {
        "schemaVersion": "MODEL3_TRAINING_SAMPLE_V1",
        "sampleId": sample_id,
        "sourceSampleId": meta["sourceSampleId"],
        "sourceCorpus": meta["sourceCorpus"],
        "evidenceLevel": "SYNTHETIC_TEXT",
        "referenceText": mat["referenceText"],
        "currentText": mat["currentText"],
        "audioRef": None,
        "domainEvidence": mat["domainEvidence"],
        "model2AnchorStatus": "UNAVAILABLE",
        "spans": spans,
        "split": split,
        "groupKeys": {
            "sourceSentenceId": meta["sourceSentenceId"],
            "contrastGroupId": meta.get("contrastGroupId"),
            "splitGroupKey": meta.get("splitGroupKey") or meta["sourceSentenceId"],
            "surfacePairKey": meta.get("surfacePairKey"),
        },
        "heldOutAxes": meta.get("heldOutAxes") or [],
        "featureAvailability": mat["featureAvailability"],
        "provenance": {
            "generatorVersion": gen_version,
            "labelMaterializerVersion": gen_version,
            "labelContractVersion": LABEL_CONTRACT_VERSION,
            "datasetVersion": dataset_version,
            "errorTextSampleId": meta["sourceSampleId"],
            "auditSidecarRef": sidecar_ref,
            "source_type": meta.get("source_type"),
            "shard": meta.get("shard"),
            "malformedRegions": mat.get("malformedRegions") or [],
        },
    }
