# -*- coding: utf-8 -*-
"""Narrow reference-source adapter for acoustic training materialization."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from training.model3_dataset.acoustic_training.family_identity import semantic_family_id
from training.model3_dataset.acoustic_training.holdout_registry import (
    PROTECTED_CASE_IDS,
    check_holdout,
    load_protected_texts,
)

REPO = Path(__file__).resolve().parents[3]
POOL = REPO / "docs/user_correction/model3/model3_certified_base_pool_v2.jsonl"


def load_references(
    n: int,
    *,
    source_pool_id: str = "model3_certified_base_pool_v2",
    pool_path: Path | None = None,
    exclude_dialog_200_source: bool = True,
) -> list[dict]:
    """Load certified references; excludes protected holdout texts/ids."""
    path = pool_path or POOL
    prot = load_protected_texts()
    out: list[dict] = []
    if not path.exists():
        return out
    with path.open(encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            o = json.loads(line)
            text = (o.get("normalized") or o.get("text") or "").strip()
            if not text:
                continue
            src = (o.get("source") or "").lower()
            if exclude_dialog_200_source and ("dialog_200" in src or "dialog200" in src):
                continue
            rid = str(o.get("id") or hashlib.md5(text.encode()).hexdigest()[:12])
            if check_holdout(reference_id=rid, reference_text=text):
                continue
            if text in prot or rid in PROTECTED_CASE_IDS:
                continue
            fam = semantic_family_id(rid, text)
            out.append(
                {
                    "referenceId": rid,
                    "referenceText": text,
                    "sourceCorpus": o.get("source") or source_pool_id,
                    "sourcePoolId": source_pool_id,
                    "semanticFamilyId": fam,
                    "protection": {"holdout": False},
                }
            )
            if len(out) >= n:
                break
    return out
