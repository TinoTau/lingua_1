# -*- coding: utf-8 -*-
"""Expand reachable phonetic contrast seed pairs beyond the sparse 100k RETRY set.

Harvests (errorSurface, referenceSurface, family) via ACTIVE_SET_V1 syllable
substitution + lexicon. Reachability is re-validated later by Stage2 harness
labeling (RETRY requires referenceReachable=YES).
"""
from __future__ import annotations

import json
import random
import sys
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model2.pronunciation.syllable_substitution import apply_family_to_syllable
from training.model3_error_text.generator.corrupt import annotate_sentence
from training.model3_error_text.generator.families import ACTIVE_FAMILIES_V1
from training.model3_error_text.generator.lexicon_resolve import (
    LexiconSurfaceResolver,
    default_sqlite_path,
)

OUT = REPO / "training/model3_dataset/model3_v1_anchor_contrast_pilot/_seed_pairs.json"
PREV = OUT
POOL = REPO / "docs/user_correction/model3/model3_certified_base_pool_v2.jsonl"
SRC100K = REPO / "training/model3_dataset/model3_v1_synthetic_100k"


def load_existing() -> dict[str, dict]:
    pairs: dict[str, dict] = {}
    if PREV.exists():
        for row in json.loads(PREV.read_text(encoding="utf-8")):
            key = f"{row['error_surface']}|{row['retry_reference']}"
            pairs[key] = row
    # also scan 100k
    for split in ("train", "dev", "test"):
        d = SRC100K / split
        if not d.exists():
            continue
        for p in sorted(d.glob("shard-*.jsonl")):
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
                        key = f"{err}|{ref}"
                        if key not in pairs:
                            pairs[key] = {
                                "keep_surface": err,
                                "retry_reference": ref,
                                "error_surface": err,
                                "family": fam,
                                "source": "synthetic_100k",
                            }
    return pairs


def chars_from_pool(limit: int = 4000) -> list[str]:
    seen = []
    bag = set()
    if POOL.exists():
        with POOL.open(encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                try:
                    o = json.loads(line)
                except json.JSONDecodeError:
                    continue
                text = o.get("text") or o.get("referenceText") or o.get("sentence") or ""
                for ch in text:
                    if "\u4e00" <= ch <= "\u9fff" and ch not in bag:
                        bag.add(ch)
                        seen.append(ch)
                        if len(seen) >= limit:
                            return seen
    return seen


def main() -> None:
    resolver = LexiconSurfaceResolver(default_sqlite_path(REPO))
    pairs = load_existing()
    print(f"seed_from_100k_and_prev={len(pairs)}", flush=True)

    lex_chars = [
        r[0]
        for r in resolver._con.execute(
            "SELECT word FROM base_lexicon WHERE enabled=1 AND length(word)=1 "
            "ORDER BY prior_score DESC LIMIT 3000"
        ).fetchall()
    ]
    pool_chars = chars_from_pool(5000)
    # prefer short contentful chars — skip ultra-weak function words
    weak = set("的了吗呢吧啊呀嘛着过很就都也还把被让给与和对在是有不没我你他她它们")
    chars = []
    seen = set()
    for ch in lex_chars + pool_chars:
        if ch in weak or ch in seen:
            continue
        seen.add(ch)
        chars.append(ch)

    fam_counter = Counter()
    added = 0
    # Multi-candidate harvest: same reference syllable family → several error surfaces.
    # Still ACTIVE_SET_V1 / lexicon-grounded; not an arbitrary error dictionary.
    for ch in chars:
        annos, _impl, _meta = annotate_sentence(ch)
        if not annos:
            continue
        anno = annos[0]
        if anno.skip_reason:
            continue
        for fam_name in ACTIVE_FAMILIES_V1:
            corrupted = apply_family_to_syllable(anno.source_tone, fam_name)
            if corrupted is None or corrupted == anno.source_tone:
                continue
            cands = resolver.lookup_len1_by_tone_key(corrupted, limit=12)
            taken = 0
            for word, _prior, _src in cands:
                if word == ch or word in weak or ch in weak:
                    continue
                err, ref = word, ch
                key = f"{err}|{ref}"
                if key in pairs:
                    continue
                pairs[key] = {
                    "keep_surface": err,
                    "retry_reference": ref,
                    "error_surface": err,
                    "family": fam_name,
                    "source": "lexicon_multicand_harvest",
                }
                fam_counter[fam_name] += 1
                added += 1
                taken += 1
                if taken >= 4:
                    break

    rows = list(pairs.values())
    random.Random(2026082415).shuffle(rows)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                "n_pairs": len(rows),
                "added_lexicon": added,
                "families": dict(Counter(r["family"] for r in rows)),
                "added_by_family": dict(fam_counter),
            },
            ensure_ascii=False,
            indent=2,
        ),
        flush=True,
    )
    resolver.close()


if __name__ == "__main__":
    main()
