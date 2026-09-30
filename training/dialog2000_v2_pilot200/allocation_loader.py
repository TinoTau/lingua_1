# -*- coding: utf-8 -*-
"""Expand frozen Case_Allocation.csv into 200 deterministic slots."""

from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class AllocationSlot:
    user_id: str
    dominant_relations: tuple[str, ...]
    profile_stage_focus: str
    relation_family: str | None
    domain: str
    case_class: str
    split: str
    notes: str


def load_allocation(csv_path: Path) -> list[AllocationSlot]:
    slots: list[AllocationSlot] = []
    with csv_path.open(encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            uid = (row.get("userId") or "").strip()
            if not uid.startswith("U00"):
                continue
            if "TOTAL" in uid:
                continue
            count = int(row["approx_count"])
            rel_raw = (row.get("relation_family") or "").strip()
            relation = None if rel_raw in ("", "NONE", "null") else rel_raw
            dom = tuple(
                x for x in (row.get("dominant_relations") or "").replace("|", ",").split(",") if x.strip()
            )
            # CSV stores "n_l|in_ing" in one field — DictReader may keep quotes
            dom_field = (row.get("dominant_relations") or "").strip().strip('"')
            if "|" in dom_field:
                dom = tuple(x.strip() for x in dom_field.split("|") if x.strip())
            for _ in range(count):
                slots.append(
                    AllocationSlot(
                        user_id=uid,
                        dominant_relations=dom,
                        profile_stage_focus=(row.get("profile_stage_focus") or "").strip(),
                        relation_family=relation,
                        domain=(row.get("domain") or "").strip(),
                        case_class=(row.get("case_class") or "").strip(),
                        split=(row.get("split") or "").strip(),
                        notes=(row.get("notes") or "").strip(),
                    )
                )
    if len(slots) != 200:
        raise RuntimeError(f"allocation expanded to {len(slots)} != 200")
    return slots
