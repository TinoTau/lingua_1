# -*- coding: utf-8 -*-
"""Extract phonetic pairs from 100k RETRY spans (referenceReachable=YES)."""
from __future__ import annotations

import json
import random
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
SRC = REPO / "training/model3_dataset/model3_v1_synthetic_100k"
OUT = REPO / "training/model3_dataset/model3_v1_anchor_contrast_pilot/_seed_pairs.json"


def main():
    pairs = {}
    for split in ("train", "dev", "test"):
        for p in sorted((SRC / split).glob("shard-*.jsonl")):
            with p.open(encoding="utf-8") as f:
                for line in f:
                    if not line.strip():
                        continue
                    o = json.loads(line)
                    for sp in o.get("spans") or []:
                        if sp.get("label") != "RETRY":
                            continue
                        ref = sp.get("referenceSurface")
                        err = sp.get("surface")
                        if not ref or not err or ref == err:
                            continue
                        if (sp.get("repairability") or {}).get("referenceReachable") != "YES":
                            continue
                        fam = sp.get("corruptionFamily") or "unknown"
                        if fam == "ORTHOGRAPHIC_DE_DI_DE":
                            continue
                        # key by surfaces only — allow many contexts later
                        key = f"{err}|{ref}"
                        if key not in pairs:
                            pairs[key] = {
                                "keep_surface": err,
                                "retry_reference": ref,
                                "error_surface": err,
                                "family": fam,
                            }
    rows = list(pairs.values())
    random.Random(42).shuffle(rows)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"n_pairs": len(rows), "families": dict(Counter(r["family"] for r in rows))}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
