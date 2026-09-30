# -*- coding: utf-8 -*-
"""Mine ACTIVE-relation candidates from frozen Lexicon (read-only; no Corruptor in mine loop)."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path

from training.model2.phonetic.syllables import parse_raw_pinyin
from training.model2.pronunciation.syllable_substitution import (
    apply_family_to_parts,
    parse_syllable,
)

ACTIVE = ("n_l", "z_zh", "ch_c", "sh_s", "eng_en", "in_ing", "h_f")


def _applicable(pinyin_key: str, tone_key: str, family: str) -> bool:
    syls = parse_raw_pinyin(tone_key or pinyin_key) or []
    for s in syls:
        parts = parse_syllable(s)
        if parts and apply_family_to_parts(parts, family) is not None:
            return True
    return False


def load_lexicon_rows(sqlite_path: Path, min_len: int = 2, max_len: int = 4):
    con = sqlite3.connect(f"file:{sqlite_path.as_posix()}?mode=ro", uri=True)
    con.execute("PRAGMA query_only=ON")
    rows = con.execute(
        "SELECT id, word, pinyin_key, tone_pinyin_key, prior_score FROM base_lexicon "
        "WHERE enabled=1 AND COALESCE(is_alias,0)=0 "
        "AND length(word) BETWEEN ? AND ?",
        (min_len, max_len),
    ).fetchall()
    con.close()
    return rows


def mine_relation_surfaces(
    *,
    rows,
    family: str,
    exclude_surfaces: set[str],
    limit: int = 80,
    seed: int = 20260911,
) -> list[dict]:
    prelim: list[tuple[float, str, str]] = []
    seen: set[str] = set()
    for term_id, word, pk, tpk, prior in rows:
        if word in exclude_surfaces or word in seen:
            continue
        if not _applicable(pk or "", tpk or "", family):
            continue
        h = int(hashlib.sha256(f"{seed}|{family}|{word}".encode()).hexdigest()[:8], 16)
        score = float(prior or 0.0) * 100.0 + (h % 1000) / 10000.0
        prelim.append((score, word, str(term_id)))
        seen.add(word)
    prelim.sort(key=lambda x: (-x[0], x[1]))
    return [
        {"surface": w, "term_id": tid, "score": sc}
        for sc, w, tid in prelim[:limit]
    ]


def filter_build_to_lexicon(sqlite_path: Path, build_banks: dict[str, list[str]]) -> dict[str, list[str]]:
    rows = load_lexicon_rows(sqlite_path)
    in_lex = {r[1] for r in rows}
    out: dict[str, list[str]] = {}
    used: set[str] = set()
    for fam, surfaces in build_banks.items():
        kept = [s for s in surfaces if s in in_lex]
        if len(kept) < 12:
            mined = mine_relation_surfaces(
                rows=rows, family=fam, exclude_surfaces=set(kept) | used, limit=40
            )
            for m in mined:
                if m["surface"] not in kept:
                    kept.append(m["surface"])
                if len(kept) >= 16:
                    break
        out[fam] = kept[:16]
        used.update(out[fam])
    return out


def build_eval_pools(
    sqlite_path: Path,
    build_surfaces_by_family: dict[str, list[str]],
    *,
    seed: int = 20260911,
    per_family: int = 40,
) -> dict[str, list[dict]]:
    """Return fam -> [{surface, term_id}] lexicon-eligible, disjoint from build universe."""
    rows = load_lexicon_rows(sqlite_path)
    global_exclude: set[str] = set()
    for surfaces in build_surfaces_by_family.values():
        global_exclude.update(surfaces)

    pools: dict[str, list[dict]] = {}
    for fam in ACTIVE:
        exclude = set(global_exclude) | set(build_surfaces_by_family.get(fam, []))
        mined = mine_relation_surfaces(
            rows=rows,
            family=fam,
            exclude_surfaces=exclude,
            limit=per_family,
            seed=seed,
        )
        pools[fam] = [{"surface": m["surface"], "term_id": m["term_id"]} for m in mined]
        global_exclude.update(m["surface"] for m in mined)
    return pools


def materialize_term_banks_file(
    sqlite_path: Path,
    static_build: dict[str, list[str]],
    out_path: Path,
    *,
    seed: int = 20260911,
) -> dict:
    build = filter_build_to_lexicon(sqlite_path, static_build)
    eval_pools = build_eval_pools(sqlite_path, build, seed=seed, per_family=40)
    payload = {
        "seed": seed,
        "lexicon": str(sqlite_path),
        "selection_basis": [
            "lexicon_membership",
            "active_relation_applicability",
            "profile_eval_isolation",
            "deterministic_seed_rank",
        ],
        "forbidden_selection_signals": ["asr", "model2", "kenlm", "final_repair"],
        "build": build,
        "eval": {k: [x["surface"] for x in v] for k, v in eval_pools.items()},
        "eval_term_ids": {k: [x["term_id"] for x in v] for k, v in eval_pools.items()},
    }
    # isolation assert
    for fam in ACTIVE:
        inter = set(payload["build"][fam]) & set(payload["eval"][fam])
        if inter:
            raise RuntimeError(f"build/eval overlap {fam}: {inter}")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload
