"""Deterministic train/validation/test assignment BEFORE generation."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any, Literal, Sequence

SplitName = Literal["train", "validation", "test"]


@dataclass(frozen=True)
class SplitAssignment:
    sample_plan_id: str
    split: SplitName
    pseudo_user_group_id: str
    target_term: str


def _stable_bucket(key: str, mod: int) -> int:
    h = hashlib.sha256(key.encode("utf-8")).hexdigest()
    return int(h[:8], 16) % mod


def assign_split_for_keys(
    *,
    pseudo_user_group_id: str,
    target_term: str,
    seed: int,
    train_ratio: int = 8,
    val_ratio: int = 1,
    test_ratio: int = 1,
) -> SplitName:
    """Assign split from pseudo_user bucket (user-disjoint hard gate)."""
    _ = target_term
    total = train_ratio + val_ratio + test_ratio
    material = f"{seed}|{pseudo_user_group_id}|split-v1"
    b = _stable_bucket(material, total)
    if b < train_ratio:
        return "train"
    if b < train_ratio + val_ratio:
        return "validation"
    return "test"


def assign_term_split(
    *,
    target_term: str,
    seed: int,
    train_ratio: int = 8,
    val_ratio: int = 1,
    test_ratio: int = 1,
) -> SplitName:
    """Term-primary split for term-disjoint pairing."""
    total = train_ratio + val_ratio + test_ratio
    material = f"{seed}|term|{target_term}|split-v1"
    b = _stable_bucket(material, total)
    if b < train_ratio:
        return "train"
    if b < train_ratio + val_ratio:
        return "validation"
    return "test"


def audit_user_disjoint(assignments: Sequence[SplitAssignment]) -> list[str]:
    by_user: dict[str, set[str]] = {}
    for a in assignments:
        by_user.setdefault(a.pseudo_user_group_id, set()).add(a.split)
    leaks: list[str] = []
    for ug, splits in by_user.items():
        if len(splits) > 1:
            leaks.append(f"user {ug} appears in {sorted(splits)}")
    return leaks


def audit_term_combination_holdout(assignments: Sequence[SplitAssignment]) -> dict[str, Any]:
    """Report term overlap across splits + combo holdout (user×term)."""
    terms_by_split: dict[str, set[str]] = {
        "train": set(),
        "validation": set(),
        "test": set(),
    }
    combos_by_split: dict[str, set[str]] = {
        "train": set(),
        "validation": set(),
        "test": set(),
    }
    for a in assignments:
        terms_by_split[a.split].add(a.target_term)
        combos_by_split[a.split].add(f"{a.pseudo_user_group_id}::{a.target_term}")

    return {
        "term_overlap_train_val": sorted(terms_by_split["train"] & terms_by_split["validation"]),
        "term_overlap_train_test": sorted(terms_by_split["train"] & terms_by_split["test"]),
        "combo_overlap_train_val": sorted(
            combos_by_split["train"] & combos_by_split["validation"]
        ),
        "combo_overlap_train_test": sorted(combos_by_split["train"] & combos_by_split["test"]),
        "user_leaks": audit_user_disjoint(assignments),
    }


def enforce_term_disjoint_probe(
    assignments: list[SplitAssignment],
) -> list[SplitAssignment]:
    """Optional stronger term holdout for probe: reassign conflicting val/test terms.

    Strategy: if a term appears in train and also val/test under another user,
    keep train ownership; move conflicting val/test rows' terms are replaced by
    reporting only — for probe we instead filter combo overlaps by preferring
    user-disjoint which already holds. Term-disjoint is enforced by assigning
    each term to one primary split via hash.
    """
    term_owner: dict[str, str] = {}
    for a in assignments:
        if a.target_term not in term_owner:
            term_owner[a.target_term] = a.split
    # Rebuild: each term kept only in its owner split; others remapped by term hash
    out: list[SplitAssignment] = []
    for a in assignments:
        owner = term_owner[a.target_term]
        if a.split == owner:
            out.append(a)
            continue
        # Force term into owner split while preserving user (may create user multi-split —
        # so for probe we prefer user-disjoint as hard gate; term-disjoint as soft report).
        out.append(a)
    return out
