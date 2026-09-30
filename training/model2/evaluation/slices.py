"""Slice metrics: seen/unseen term, split holdouts."""

from __future__ import annotations

from typing import Any, Callable


def term_surface_from_id(term_id: str | None) -> str | None:
    if not term_id:
        return None
    # term_id format: type:domain:surface:pinyin
    parts = term_id.split(":")
    if len(parts) >= 3:
        return parts[2]
    return term_id


def build_seen_term_set(train_rows: list[dict[str, Any]]) -> set[str]:
    seen: set[str] = set()
    for r in train_rows:
        if r.get("split") != "train":
            continue
        if not r.get("is_term_positive"):
            continue
        tid = r.get("target_term_id")
        surf = term_surface_from_id(tid)
        if surf:
            seen.add(surf)
    return seen


def slice_rows(
    rows: list[dict[str, Any]],
    *,
    split: str | None = None,
    seen_terms: set[str] | None = None,
    unseen: bool | None = None,
    ambiguous: bool | None = None,
    source_type: str = "TTS_ASR_SYNTHETIC",
    allow_leak: bool = False,
) -> list[dict[str, Any]]:
    from training.model2.ambiguity.taxonomy import is_ambiguous_class

    out = []
    for r in rows:
        if not (
            r.get("is_term_positive")
            and r.get("source_type") == source_type
            and r.get("target_in_pool")
        ):
            continue
        if not allow_leak and r.get("context_target_leak"):
            continue
        if split is not None and r.get("split") != split:
            continue
        surf = term_surface_from_id(r.get("target_term_id"))
        if unseen is True and seen_terms is not None:
            if surf in seen_terms:
                continue
        if unseen is False and seen_terms is not None:
            if surf not in seen_terms:
                continue
        if ambiguous is True and not is_ambiguous_class(r.get("ambiguity_class") or ""):
            continue
        if ambiguous is False and is_ambiguous_class(r.get("ambiguity_class") or ""):
            continue
        out.append(r)
    return out
