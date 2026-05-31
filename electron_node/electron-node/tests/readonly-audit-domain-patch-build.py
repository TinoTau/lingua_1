#!/usr/bin/env python3
"""Read-only audit: domain_patch build chain (2026-05-31)."""
import json
import sqlite3
from collections import Counter
from pathlib import Path

ROOT = Path(r"D:\Programs\github\lingua_1")
ASSETS = ROOT / "electron_node" / "docs" / "lexicon-assets" / "p1_3_generic_zh_lexicon_v2_fw_domains" / "p1_3_lexicon_zh_v2"
SQLITE = ROOT / "node_runtime" / "lexicon" / "v2_shadow" / "lexicon_v2.sqlite"
MANIFEST = ROOT / "node_runtime" / "lexicon" / "v2_shadow" / "manifest_v2.json"
STATS = ROOT / "node_runtime" / "lexicon" / "v2_shadow" / "stats_v2.json"
REJECTED = ROOT / "node_runtime" / "lexicon" / "v2_shadow" / "rejected_v2.jsonl"


def load_jsonl(p: Path):
    rows = []
    for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        rows.append(json.loads(line))
    return rows


def audit_combined(path: Path, label: str):
    rows = load_jsonl(path)
    types = Counter(r.get("type", "?") for r in rows)
    layers = Counter((r.get("lexiconLayer") or r.get("lexicon_layer") or "?").lower() for r in rows)
    domain_patch = sum(1 for r in rows if (r.get("lexiconLayer") or "").lower() in ("domain_patch", "domain"))
    non_general = sum(
        1
        for r in rows
        if any(d != "general" for d in (r.get("domains") or []))
    )
    print(f"\n=== {label} ===")
    print("path:", path)
    print("total lines:", len(rows))
    print("type counts:", dict(types))
    print("lexiconLayer counts:", dict(layers))
    print("domain_patch/domain layer rows:", domain_patch)
    print("domains != general rows:", non_general)
    print("first 5 samples:")
    for r in rows[:5]:
        print(
            " ",
            r.get("word"),
            "layer=",
            r.get("lexiconLayer"),
            "domains=",
            r.get("domains"),
            "repairTarget=",
            r.get("repairTarget"),
        )
    return rows


def main():
    print("=== PART 1: DOMAIN PATCH SOURCES ===")
    patch_dir = ASSETS / "domain_patch_zh_v2"
    for name in ["entries.jsonl", "rejected.jsonl", "manifest.json", "stats.json"]:
        p = patch_dir / name
        print(f"{name}: exists={p.exists()}", end="")
        if p.suffix == ".jsonl":
            n = sum(1 for l in p.read_text(encoding="utf-8").splitlines() if l.strip())
            print(f" lines={n}")
        else:
            print()
    patch_rows = load_jsonl(patch_dir / "entries.jsonl")
    print("patch sample entries:")
    for r in patch_rows:
        print(
            f"  word={r['word']} layer={r.get('lexiconLayer')} domains={r.get('domains')} "
            f"repairTarget={r.get('repairTarget')} enabled={r.get('enabled')} aliases={r.get('aliases')}"
        )

    print("\n=== PART 3/4: COMBINED FILES ===")
    combined = audit_combined(ASSETS / "combined_entries.jsonl", "combined_entries")
    combined_patch = audit_combined(ASSETS / "combined_with_domain_patch_entries.jsonl", "combined_with_domain_patch")

    patch_words = {r["word"] for r in patch_rows}
    in_combined = [w for w in patch_words if any(r.get("word") == w and (r.get("lexiconLayer") or "").lower() == "domain_patch" for r in combined)]
    in_combined_any = [w for w in patch_words if any(r.get("word") == w for r in combined)]
    print("\npatch words in combined as domain_patch:", in_combined)
    print("patch words in combined (any layer):", in_combined_any)

    print("\n=== PART 6: SQLITE ===")
    con = sqlite3.connect(SQLITE)
    for t in ["base_lexicon", "domain_lexicon", "idiom_lexicon"]:
        total = con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        alias = con.execute(f"SELECT COUNT(*) FROM {t} WHERE is_alias=1").fetchone()[0]
        print(f"{t}: total={total} alias={alias}")
    domain_sample = con.execute(
        "SELECT domain_id, word, pinyin_key, repair_target, is_alias FROM domain_lexicon LIMIT 20"
    ).fetchall()
    print("domain_lexicon sample (first 20):", domain_sample)

    print("\n=== PART 8: MANIFEST / STATS ===")
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    stats = json.loads(STATS.read_text(encoding="utf-8"))
    print("manifest seed_path:", manifest.get("seed_path"))
    print("manifest schemaVersion:", manifest.get("schemaVersion"))
    print("manifest domain rowCount:", manifest.get("tables", {}).get("domain_lexicon", {}).get("rowCount"))
    print("stats domain:", stats.get("tables", {}).get("domain_lexicon"))
    print("rejectStats domain_*:", {k: v for k, v in stats.get("rejectStats", {}).items() if "domain" in k and v})

    if REJECTED.exists():
        rej = [json.loads(l) for l in REJECTED.read_text(encoding="utf-8").splitlines() if l.strip()]
        print("rejected_v2.jsonl count:", len(rej))
        layer_words = Counter(r.get("word", "")[:10] for r in rej[:20])
    else:
        print("rejected_v2.jsonl: missing")


if __name__ == "__main__":
    main()
