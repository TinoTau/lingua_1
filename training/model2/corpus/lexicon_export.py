"""Read-only lexicon term export for Model2 probe (no new vocabulary SSOT)."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any, Optional


def default_lexicon_paths(repo_root: Path) -> dict[str, Path]:
    v3 = repo_root / "node_runtime" / "lexicon" / "v3"
    return {
        "sqlite": v3 / "lexicon.sqlite",
        "manifest": v3 / "manifest.json",
    }


def load_lexicon_snapshot_meta(manifest_path: Path) -> dict[str, Any]:
    return json.loads(manifest_path.read_text(encoding="utf-8"))


def export_domain_terms(
    sqlite_path: Path,
    *,
    min_chars: int = 2,
    max_chars: int = 5,
    limit: Optional[int] = None,
) -> list[dict[str, Any]]:
    conn = sqlite3.connect(str(sqlite_path))
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        SELECT word, domain_id, pinyin_key, tone_pinyin_key, prior_score, source
        FROM domain_lexicon
        WHERE enabled = 1 AND COALESCE(is_alias, 0) = 0
        ORDER BY prior_score DESC, word ASC
        """
    ).fetchall()
    out: list[dict[str, Any]] = []
    for r in rows:
        w = r["word"]
        n = len(w)
        if n < min_chars or n > max_chars:
            continue
        out.append(
            {
                "term": w,
                "domain_tags": [r["domain_id"]],
                "term_type": "domain",
                "source": r["source"] or "domain_lexicon",
                "pinyin_key": r["pinyin_key"],
                "tone_pinyin_key": r["tone_pinyin_key"],
                "prior_score": r["prior_score"],
            }
        )
        if limit is not None and len(out) >= limit:
            break
    conn.close()
    return out


def export_base_background(
    sqlite_path: Path,
    *,
    limit: int = 200,
) -> list[dict[str, Any]]:
    conn = sqlite3.connect(str(sqlite_path))
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        SELECT word, pinyin_key, prior_score, source
        FROM base_lexicon
        WHERE enabled = 1
        ORDER BY prior_score DESC, word ASC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    out = [
        {
            "term": r["word"],
            "domain_tags": [],
            "term_type": "base",
            "source": r["source"] or "base_lexicon",
            "pinyin_key": r["pinyin_key"],
            "prior_score": r["prior_score"],
        }
        for r in rows
    ]
    conn.close()
    return out


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
