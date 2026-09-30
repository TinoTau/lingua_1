# -*- coding: utf-8 -*-
"""Single-char Repair V1 implement: backup, materialize TSV, pre/post validation."""
from __future__ import annotations

import csv
import hashlib
import json
import re
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(r"d:\Programs\github\lingua_1")
STRICT = ROOT / "docs/user_correction/single_char/Lingua_single_char_repair_lexicon_strict_v1.csv"
IME = ROOT / "docs/pinyin-v2/import/single_char_dictionary.tsv"
V1_TSV = ROOT / "docs/user_correction/single_char/single_char_repair_lexicon_v1.tsv"
BUILD_JS = ROOT / "electron_node/electron-node/scripts/lexicon/lib/full-rebuild-from-csv.mjs"
EXPORT_JS = ROOT / "electron_node/electron-node/scripts/pinyin-ime-v2/lib/dict-export-core.mjs"
V3 = ROOT / "node_runtime/lexicon/v3"
REBUILD_OUT = ROOT / "node_runtime/lexicon/_rebuild_candidate"
PRIOR = 0.9
SOURCE = "single-char-repair-v1-strict"
TS = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M")
OUT = ROOT / (
    "training/model2_v3/experiments/v3_stage_j_live_dialog200/"
    f"single_char_repair_v1_implement_rebuild_{TS}"
)
BACKUP = OUT / f"single_char_repair_v1_rebuild_backup_{TS}"


def sha256_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def split_py(py: str) -> tuple[str, str]:
    raw = (py or "").strip().lower()
    m = re.match(r"^([a-z]+)([1-5])$", raw)
    if m:
        return m.group(1), raw
    return raw, raw


def materialize_v1_tsv() -> list[dict]:
    rows = []
    for r in csv.DictReader(STRICT.open(encoding="utf-8-sig")):
        w = r["word"].strip()
        syll, tone_py = split_py(r["pinyin"].strip())
        rows.append(
            {
                "surface": w,
                "canonical": w,
                "pinyin": syll,
                "tone_pinyin": tone_py,
                "weight": str(PRIOR),
                "source": SOURCE,
            }
        )
    rows.sort(key=lambda x: (x["surface"], x["pinyin"]))
    with V1_TSV.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(
            f,
            fieldnames=["surface", "canonical", "pinyin", "tone_pinyin", "weight", "source"],
            delimiter="\t",
        )
        w.writeheader()
        w.writerows(rows)
    return rows


def validate_v1(rows: list[dict]) -> dict:
    surfaces = [r["surface"] for r in rows]
    bad_prior = [r for r in rows if float(r["weight"]) != PRIOR]
    return {
        "rows": len(rows),
        "unique_surfaces": len(set(surfaces)),
        "duplicates": len(surfaces) - len(set(surfaces)),
        "bad_prior": len(bad_prior),
        "pass": len(rows) == 1125 and len(set(surfaces)) == 1125 and not bad_prior,
    }


def sqlite_inventory(db_path: Path) -> dict:
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    def q(sql):
        return con.execute(sql).fetchone()[0]

    len1 = con.execute(
        "SELECT word, pinyin_key, tone_pinyin_key, prior_score, source, enabled "
        "FROM base_lexicon WHERE length(word)=1 ORDER BY word"
    ).fetchall()
    len2p = con.execute(
        "SELECT word, pinyin_key, tone_pinyin_key, prior_score, enabled "
        "FROM base_lexicon WHERE length(word)>=2 ORDER BY word, pinyin_key"
    ).fetchall()
    info = {
        "base_total": q("SELECT COUNT(*) FROM base_lexicon"),
        "base_enabled": q("SELECT COUNT(*) FROM base_lexicon WHERE enabled=1"),
        "len1_enabled": q(
            "SELECT COUNT(*) FROM base_lexicon WHERE enabled=1 AND length(word)=1"
        ),
        "len2plus_enabled": q(
            "SELECT COUNT(*) FROM base_lexicon WHERE enabled=1 AND length(word)>=2"
        ),
        "domain": q("SELECT COUNT(*) FROM domain_lexicon"),
        "idiom": q("SELECT COUNT(*) FROM idiom_lexicon"),
        "term_domain_tags": q("SELECT COUNT(*) FROM term_domain_tags"),
        "term": q("SELECT COUNT(*) FROM term"),
    }
    con.close()
    return {"counts": info, "len1_rows": len1, "len2p_rows": len2p}


def backup_files():
    BACKUP.mkdir(parents=True, exist_ok=True)
    copies = [
        (BUILD_JS, "full-rebuild-from-csv.mjs"),
        (EXPORT_JS, "dict-export-core.mjs"),
        (IME, "single_char_dictionary.tsv"),
        (STRICT, "Lingua_single_char_repair_lexicon_strict_v1.csv"),
        (V3 / "manifest.json", "manifest_v3_pre.json"),
        (V3 / "lexicon.sqlite", "lexicon_v3_pre.sqlite"),
        (V3 / "checksum.txt", "checksum_v3_pre.txt"),
    ]
    manifest = []
    for src, name in copies:
        if src.exists():
            dst = BACKUP / name
            shutil.copy2(src, dst)
            manifest.append({"file": str(src.relative_to(ROOT)), "backup": name, "sha256": sha256_file(src)})
    (BACKUP / "backup_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return manifest


def export_len1_csv(rows, path: Path):
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["word", "pinyin_key", "tone_pinyin_key", "prior_score", "source", "enabled"])
        for r in rows:
            w.writerow(r)


def export_len2_csv(rows, path: Path):
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["word", "pinyin_key", "tone_pinyin_key", "prior_score", "enabled"])
        for r in rows:
            w.writerow(r)


def set_equality(runtime_surfaces: set[str], source_surfaces: set[str]) -> dict:
    return {
        "runtime_only": sorted(runtime_surfaces - source_surfaces),
        "source_only": sorted(source_surfaces - runtime_surfaces),
        "equal": runtime_surfaces == source_surfaces,
        "runtime_count": len(runtime_surfaces),
        "source_count": len(source_surfaces),
    }


def main_phase_pre():
    OUT.mkdir(parents=True, exist_ok=True)
    backup_files()
    pre_inv = sqlite_inventory(V3 / "lexicon.sqlite")
    export_len1_csv(pre_inv["len1_rows"], OUT / "single_char_repair_v1_pre_rebuild_length1.csv")
    export_len2_csv(pre_inv["len2p_rows"], OUT / "single_char_repair_v1_pre_rebuild_length2plus.csv")
    pre_json = {
        "counts": pre_inv["counts"],
        "len1_surface_set": sorted({r[0] for r in pre_inv["len1_rows"] if r[5]}),
        "len2plus_fingerprint": sha256_file(OUT / "single_char_repair_v1_pre_rebuild_length2plus.csv"),
    }
    (OUT / "single_char_repair_v1_pre_rebuild_inventory.json").write_text(
        json.dumps(pre_json, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    checksum_rows = []
    for label, p in [
        ("active_sqlite", V3 / "lexicon.sqlite"),
        ("manifest", V3 / "manifest.json"),
        ("ime_tsv", IME),
        ("strict_csv", STRICT),
        ("build_js", BUILD_JS),
        ("export_js", EXPORT_JS),
    ]:
        if p.exists():
            checksum_rows.append({"artifact": label, "path": str(p.relative_to(ROOT)), "sha256": sha256_file(p)})
    with (OUT / "single_char_repair_v1_pre_rebuild_checksums.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["artifact", "path", "sha256"])
        w.writeheader()
        w.writerows(checksum_rows)
    rows = materialize_v1_tsv()
    val = validate_v1(rows)
    val["file"] = str(V1_TSV.relative_to(ROOT))
    val["sha256"] = sha256_file(V1_TSV)
    (OUT / "single_char_repair_v1_build_source_validation.json").write_text(
        json.dumps(val, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    if not val["pass"]:
        raise SystemExit("V1 source validation FAILED")
    print("PRE_OK", val)


if __name__ == "__main__":
    main_phase_pre()
