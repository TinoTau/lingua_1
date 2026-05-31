#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""P1 Build / Bundle freeze acceptance — readonly SQLite + manifest audit."""
import json
import sqlite3
from pathlib import Path

ROOT = Path(r"D:\Programs\github\lingua_1")
DB = ROOT / "node_runtime" / "lexicon" / "v2_shadow" / "lexicon_v2.sqlite"
MANIFEST = ROOT / "node_runtime" / "lexicon" / "v2_shadow" / "manifest_v2.json"
OUT = ROOT / "electron_node" / "electron-node" / "tests" / "p1-freeze-audit.json"

PATCH_MARKER = "domain_patch_zh_v2"


def table_columns(conn, table):
    return [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]


def cnt(conn, table, where=""):
    q = f"SELECT COUNT(*) FROM {table}"
    if where:
        q += f" WHERE {where}"
    return conn.execute(q).fetchone()[0]


def main():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row

    seed_inputs = manifest.get("seed_inputs") or []
    patch_in_seed = any(PATCH_MARKER in str(p).replace("/", "\\") for p in seed_inputs)

    base_cols = table_columns(conn, "base_lexicon")
    domain_cols = table_columns(conn, "domain_lexicon")
    has_tone = "tone_pinyin_key" in base_cols

    def tone_coverage(table):
        if "tone_pinyin_key" not in table_columns(conn, table):
            return {"column": False, "total": cnt(conn, table), "with_tone": 0, "coverage_pct": 0.0}
        total = cnt(conn, table)
        with_tone = cnt(
            conn,
            table,
            "tone_pinyin_key IS NOT NULL AND TRIM(tone_pinyin_key) != ''",
        )
        return {
            "column": True,
            "total": total,
            "with_tone": with_tone,
            "coverage_pct": round(100.0 * with_tone / total, 2) if total else 0.0,
        }

    domain_by_id = [
        {"domain_id": r[0], "count": r[1]}
        for r in conn.execute(
            "SELECT domain_id, COUNT(*) FROM domain_lexicon GROUP BY domain_id ORDER BY COUNT(*) DESC"
        ).fetchall()
    ]

    restaurant = conn.execute(
        """
        SELECT
          SUM(CASE WHEN is_alias=0 THEN 1 ELSE 0 END) AS canonical,
          SUM(CASE WHEN is_alias=1 THEN 1 ELSE 0 END) AS alias,
          COUNT(*) AS total
        FROM domain_lexicon WHERE domain_id='restaurant'
        """
    ).fetchone()

    repair_dist = {}
    for table in ("base_lexicon", "domain_lexicon", "idiom_lexicon"):
        if "repair_target" in table_columns(conn, table):
            rows = conn.execute(
                f"SELECT repair_target, COUNT(*) c FROM {table} GROUP BY repair_target ORDER BY repair_target"
            ).fetchall()
            repair_dist[table] = {str(r[0]): r[1] for r in rows}

    runtime_reads_jsonl = False  # lexicon-runtime-v2 loads SQLite bundle only

    out = {
        "schemaVersion": manifest.get("schemaVersion"),
        "seed_inputs": seed_inputs,
        "domain_patch_in_seed_inputs": patch_in_seed,
        "tables": {
            "base_lexicon": manifest.get("tables", {}).get("base_lexicon", {}).get("rowCount")
            or cnt(conn, "base_lexicon"),
            "idiom_lexicon": manifest.get("tables", {}).get("idiom_lexicon", {}).get("rowCount")
            or cnt(conn, "idiom_lexicon"),
            "domain_lexicon": manifest.get("tables", {}).get("domain_lexicon", {}).get("rowCount")
            or cnt(conn, "domain_lexicon"),
            "industry_routing_lexicon": manifest.get("tables", {})
            .get("industry_routing_lexicon", {})
            .get("rowCount")
            or cnt(conn, "industry_routing_lexicon"),
        },
        "domain_id_distribution": domain_by_id,
        "restaurant": {
            "canonical": restaurant["canonical"] or 0,
            "alias": restaurant["alias"] or 0,
            "total": restaurant["total"] or 0,
        },
        "tone_pinyin_key_coverage": {
            "base_lexicon": tone_coverage("base_lexicon"),
            "domain_lexicon": tone_coverage("domain_lexicon"),
            "has_tone_column": has_tone,
        },
        "repair_target_distribution": repair_dist,
        "runtime_reads_jsonl": runtime_reads_jsonl,
        "sqlite_path": str(DB),
        "manifest_createdAt": manifest.get("createdAt"),
    }

    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(out, ensure_ascii=False, indent=2))
    conn.close()


if __name__ == "__main__":
    main()
