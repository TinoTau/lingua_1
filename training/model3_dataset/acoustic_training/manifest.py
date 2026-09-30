# -*- coding: utf-8 -*-
"""Run manifest + idempotent resume ledger."""
from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from training.model3_dataset.acoustic_training.serializer import (
    FEATURE_CONTRACT,
    LABEL_CONTRACT,
    PIPELINE_VERSION,
)


def empty_manifest(run_id: str, **kwargs: Any) -> dict:
    return {
        "pipelineVersion": PIPELINE_VERSION,
        "runId": run_id,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "sourcePoolId": kwargs.get("sourcePoolId"),
        "audioMaterializerIdentity": kwargs.get("audioMaterializerIdentity", "piper_tts"),
        "asrConfigIdentity": kwargs.get("asrConfigIdentity", "faster_whisper_vad_/utterance"),
        "asrEnvIdentity": kwargs.get("asrEnvIdentity"),
        "toneIdentity": kwargs.get("toneIdentity", "production_ToneModule"),
        "recallLexiconIdentity": kwargs.get("recallLexiconIdentity"),
        "featureContractIdentity": FEATURE_CONTRACT,
        "labelContractIdentity": LABEL_CONTRACT,
        "provenanceContractIdentity": "MODEL3_V2_TRAINING_PROVENANCE_CONTRACT",
        "attempted": 0,
        "materialized": 0,
        "hardRejected": 0,
        "semanticExcluded": 0,
        "supervisedAccepted": 0,
        "hardRejectReasons": {},
        "semanticExcludeReasons": {},
        "completedKeys": [],
    }


def load_manifest(path: Path) -> dict:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return empty_manifest("unknown")


def save_manifest(path: Path, manifest: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


def resume_key(semantic_family_id: str, materialization_run_id: str) -> str:
    return f"{semantic_family_id}::{materialization_run_id}"


def update_counts(manifest: dict, disposition: str, code: str | None = None) -> None:
    manifest["attempted"] = int(manifest.get("attempted") or 0) + 1
    if disposition == "HARD_REJECT":
        manifest["hardRejected"] = int(manifest.get("hardRejected") or 0) + 1
        reasons = Counter(manifest.get("hardRejectReasons") or {})
        reasons[code or "UNKNOWN"] += 1
        manifest["hardRejectReasons"] = dict(reasons)
    elif disposition == "SEMANTIC_EXCLUDE":
        manifest["materialized"] = int(manifest.get("materialized") or 0) + 1
        manifest["semanticExcluded"] = int(manifest.get("semanticExcluded") or 0) + 1
        reasons = Counter(manifest.get("semanticExcludeReasons") or {})
        reasons[code or "NO_REPAIRABLE_TARGET"] += 1
        manifest["semanticExcludeReasons"] = dict(reasons)
    elif disposition == "SUPERVISED_ACCEPTED":
        manifest["materialized"] = int(manifest.get("materialized") or 0) + 1
        manifest["supervisedAccepted"] = int(manifest.get("supervisedAccepted") or 0) + 1
