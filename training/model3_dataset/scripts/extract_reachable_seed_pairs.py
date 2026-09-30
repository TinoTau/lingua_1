# -*- coding: utf-8 -*-
"""Extract contrast families that survived reachability filter (RETRY materialized)."""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
OUT = REPO / "training/model3_dataset/model3_v1_anchor_contrast_pilot"
SEED_IN = OUT / "_seed_pairs.json"
SEED_OK = OUT / "_seed_pairs_reachable.json"


def main() -> None:
    sidecar = []
    with (OUT / "anchor_provenance_sidecar.jsonl").open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                sidecar.append(json.loads(line))
    by_fam = Counter()
    for r in sidecar:
        if r.get("roleInPair") != "RETRY":
            continue
        if r.get("contrastStrength") not in ("STRONG", "MEDIUM"):
            continue
        fam = r.get("contrastFamilyKey")
        if not fam:
            cg = r.get("contrastGroupId") or ""
            # cg:{err}|{ref}:STRONG:r0
            if cg.startswith("cg:"):
                rest = cg[3:]
                # strip :STRONG|:MEDIUM|:NONE and :rN
                for tag in (":STRONG:", ":MEDIUM:", ":NONE:"):
                    if tag in rest:
                        fam = rest.split(tag)[0]
                        break
                if not fam and "|" in rest:
                    fam = rest.rsplit(":", 2)[0] if rest.count(":") >= 2 else rest
        if fam:
            by_fam[fam] += 1
    all_seeds = {
        f"{r['error_surface']}|{r['retry_reference']}": r
        for r in json.loads(SEED_IN.read_text(encoding="utf-8"))
    }
    ok = []
    seen = set()
    for k, n in by_fam.items():
        if n <= 0:
            continue
        if k in all_seeds and k not in seen:
            row = dict(all_seeds[k])
            row["source"] = (row.get("source") or "") + "+reachable_pilot"
            ok.append(row)
            seen.add(k)
        elif "|" in k and k not in seen:
            err, ref = k.split("|", 1)
            ok.append(
                {
                    "keep_surface": err,
                    "retry_reference": ref,
                    "error_surface": err,
                    "family": "unknown",
                    "source": "sidecar_reachable",
                }
            )
            seen.add(k)
    SEED_OK.write_text(json.dumps(ok, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                "reachable_families": len(ok),
                "retry_sidecar_rows": sum(by_fam.values()),
                "sample_keys": list(by_fam.keys())[:5],
            },
            indent=2,
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
