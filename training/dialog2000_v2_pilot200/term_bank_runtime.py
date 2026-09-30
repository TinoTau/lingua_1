# -*- coding: utf-8 -*-
"""Load lexicon-eligible generated term banks (freeze-correction)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from training.dialog2000_v2_pilot200.term_banks import TERM_BANKS as STATIC_TERM_BANKS

GENERATED_BANKS_PATH = Path(__file__).resolve().parent / "generated_term_banks_v1.json"


def load_term_banks(path: Path | None = None) -> dict[str, Any]:
    p = path or GENERATED_BANKS_PATH
    if not p.is_file():
        # fallback static (may have low lexicon eligibility — correction build should regenerate)
        return {
            "build": {k: v["build"] for k, v in STATIC_TERM_BANKS.items()},
            "eval": {k: v["eval"] for k, v in STATIC_TERM_BANKS.items()},
            "source": "static_fallback",
        }
    data = json.loads(p.read_text(encoding="utf-8"))
    return {
        "build": data["build"],
        "eval": data["eval"],
        "eval_term_ids": data.get("eval_term_ids") or {},
        "source": str(p),
        "selection_basis": data.get("selection_basis") or [],
        "forbidden_selection_signals": data.get("forbidden_selection_signals") or [],
    }
