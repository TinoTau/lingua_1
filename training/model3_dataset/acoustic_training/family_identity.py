# -*- coding: utf-8 -*-
"""semanticFamilyId vs materializationRunId — split locking SSOT."""
from __future__ import annotations

import hashlib
import json
from typing import Any


def _norm_text(s: str) -> str:
    return "".join((s or "").split())


def semantic_family_id(
    reference_id: str,
    reference_text: str,
    *,
    near_dup_key: str | None = None,
) -> str:
    """Split-locking family: same reference (or near-dup key) → same family.

    MUST NOT include audio/ASR/materialization run identities.
    """
    key = near_dup_key or f"{reference_id}|{_norm_text(reference_text)}"
    return "sf_" + hashlib.sha256(key.encode("utf-8")).hexdigest()[:24]


def materialization_run_id(
    *,
    semantic_family_id_value: str,
    audio_asset_id: str | None,
    asr_run_identity: dict | None,
    tone_run_identity: dict | None,
    audio_config_id: str = "piper_default",
    asr_config_id: str = "fw_vad_production",
) -> str:
    """Concrete acoustic/materialization run identity (not used for split)."""
    payload = {
        "semanticFamilyId": semantic_family_id_value,
        "audioAssetId": audio_asset_id,
        "audioConfigId": audio_config_id,
        "asrConfigId": asr_config_id,
        "asrRunIdentity": asr_run_identity or {},
        "toneRunIdentity": tone_run_identity or {},
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
    return "mr_" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


def assign_split(semantic_family_id_value: str, *, seed: int = 2026083002) -> str:
    """Deterministic train/dev/test from semanticFamilyId only."""
    h = int(hashlib.sha256(f"{seed}:{semantic_family_id_value}".encode()).hexdigest()[:8], 16)
    r = h % 100
    if r < 80:
        return "train"
    if r < 90:
        return "dev"
    return "test"


def assert_split_locked(
    rows: list[dict[str, Any]],
) -> list[str]:
    """Return error strings if same semanticFamilyId maps to multiple splits."""
    by_fam: dict[str, set[str]] = {}
    for r in rows:
        fam = r.get("semanticFamilyId")
        sp = r.get("split")
        if not fam or not sp:
            continue
        by_fam.setdefault(str(fam), set()).add(str(sp))
    errs = []
    for fam, splits in by_fam.items():
        if len(splits) > 1:
            errs.append(f"SPLIT_LEAK family={fam} splits={sorted(splits)}")
    return errs
