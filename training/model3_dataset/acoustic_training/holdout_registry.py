# -*- coding: utf-8 -*-
"""Centralized Model3 protected holdout registry — no case branches in generators."""
from __future__ import annotations

import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DOCS = REPO / "docs/user_correction/model3"
MANIFEST = REPO / "test wav/dialog_200/cases.manifest.json"

# Authoritative protected inventory (governance SSOT until registry file supersedes).
PROTECTED_CASE_IDS: frozenset[str] = frozenset(
    {
        "d002",
        "d003",
        "d019",
        "d049",
        "d099",
        "d131",
        "d139",
        "d142",
        "d160",
        "d176",
        "d179",
        "d181",
        "d195",
    }
)

_REGISTRY_PATH = DOCS / "model3_v2_protection_registry.json"


def load_protected_texts() -> set[str]:
    texts: set[str] = set()
    if _REGISTRY_PATH.exists():
        data = json.loads(_REGISTRY_PATH.read_text(encoding="utf-8"))
        for t in data.get("protectedExactTexts") or []:
            if t:
                texts.add(str(t).strip())
        return texts
    if MANIFEST.exists():
        m = json.loads(MANIFEST.read_text(encoding="utf-8"))
        for c in m.get("cases") or []:
            if c.get("id") in PROTECTED_CASE_IDS:
                t = (c.get("expectedText") or c.get("text") or "").strip()
                if t:
                    texts.add(t)
    return texts


def ensure_registry_file() -> Path:
    """Write/refresh centralized registry from authoritative inventory (idempotent)."""
    texts = sorted(load_protected_texts())
    payload = {
        "registryId": "MODEL3_V2_PROTECTION_REGISTRY",
        "status": "AUTHORITATIVE",
        "protectedCaseIds": sorted(PROTECTED_CASE_IDS),
        "protectedExactTexts": texts,
        "nearDuplicatePolicy": "same_semanticFamilyId_or_exclude",
        "note": "Do not scatter case-id conditionals in materializers; call check_holdout.",
    }
    DOCS.mkdir(parents=True, exist_ok=True)
    _REGISTRY_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return _REGISTRY_PATH


def check_holdout(
    *,
    reference_id: str | None,
    reference_text: str | None,
    asr_text: str | None = None,
    current_text: str | None = None,
) -> dict | None:
    """Return HARD_REJECT detail if protected collision; else None."""
    prot_texts = load_protected_texts()
    rid = (reference_id or "").strip()
    if rid in PROTECTED_CASE_IDS:
        return {
            "code": "PROTECTED_HOLDOUT_COLLISION",
            "kind": "HARD_REJECT",
            "identityFailed": "referenceId",
            "detail": rid,
        }
    for label, text in (
        ("referenceText", reference_text),
        ("rawActualAsrText", asr_text),
        ("model3CurrentText", current_text),
    ):
        t = (text or "").strip()
        if t and t in prot_texts:
            return {
                "code": "PROTECTED_HOLDOUT_COLLISION",
                "kind": "HARD_REJECT",
                "identityFailed": label,
                "detail": t[:80],
            }
    return None
