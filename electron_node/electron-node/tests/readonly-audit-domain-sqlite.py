#!/usr/bin/env python3
"""Readonly SQLite audit for P4 domain_lexicon investigation."""
import json
import sqlite3
from pathlib import Path

ROOT = Path(r"D:\Programs\github\lingua_1")
DB = ROOT / "node_runtime" / "lexicon" / "v2_shadow" / "lexicon_v2.sqlite"
MANIFEST = ROOT / "node_runtime" / "lexicon" / "v2_shadow" / "manifest_v2.json"
SEED = ROOT / "electron_node" / "docs" / "lexicon-assets" / "p1_3_generic_zh_lexicon_v2_fw_domains" / "p1_3_lexicon_zh_v2" / "combined_entries.jsonl"

conn = sqlite3.connect(DB)
c = conn.cursor()

def cnt(table, where=""):
    q = f"SELECT COUNT(*) FROM {table}"
    if where:
        q += f" WHERE {where}"
    return c.execute(q).fetchone()[0]

print("=== PART 1: SQLITE STATS ===")
print("sqlite_path:", DB)
print("manifest exists:", MANIFEST.exists())
print("base_lexicon total:", cnt("base_lexicon"))
print("base is_alias=1:", cnt("base_lexicon", "is_alias=1"))
print("base repair_target=1:", cnt("base_lexicon", "repair_target=1"))
print("base repair_target=0:", cnt("base_lexicon", "repair_target=0"))
print("domain_lexicon total:", cnt("domain_lexicon"))
print("domain is_alias=1:", cnt("domain_lexicon", "is_alias=1"))
print("idiom_lexicon total:", cnt("idiom_lexicon"))
print("industry_routing total:", cnt("industry_routing_lexicon"))

print("\n=== PART 2: DOMAIN BY domain_id ===")
rows = c.execute(
    "SELECT domain_id, COUNT(*) FROM domain_lexicon GROUP BY domain_id ORDER BY COUNT(*) DESC"
).fetchall()
if not rows:
    print("(empty - no rows in domain_lexicon)")
else:
    for domain_id, n in rows:
        print(domain_id, n)

print("\n=== PART 3: MANIFEST ===")
manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
print("schemaVersion:", manifest.get("schemaVersion"))
print("createdAt:", manifest.get("createdAt"))
print("seed_path:", manifest.get("seed_path"))
print("domain_lexicon manifest rowCount:", manifest.get("tables", {}).get("domain_lexicon", {}).get("rowCount"))
print("rejectStats common5_deferred:", manifest.get("rejectStats", {}).get("common5_deferred"))

print("\n=== PART 5: RECALL SQL SIMULATION (sample words) ===")
samples = [
    ("美食", "mei|shi", 2),
    ("美式", "mei|shi", 2),
    ("拿铁", "na|tie", 2),
    ("大杯", "da|bei", 2),
    ("钟贝", "zhong|bei", 2),
    ("讨论", "tao|lun", 2),
]
for word, key, tl in samples:
    base_n = c.execute(
        "SELECT COUNT(*) FROM base_lexicon WHERE pinyin_key=? AND length(word)=? AND enabled=1",
        (key, tl),
    ).fetchone()[0]
    domain_n = c.execute(
        "SELECT COUNT(*) FROM domain_lexicon WHERE pinyin_key=? AND length(word)=? AND enabled=1",
        (key, tl),
    ).fetchone()[0]
    base_words = [
        r[0]
        for r in c.execute(
            "SELECT word FROM base_lexicon WHERE pinyin_key=? AND length(word)=? AND enabled=1 ORDER BY prior_score DESC LIMIT 8",
            (key, tl),
        ).fetchall()
    ]
    domain_words = [
        r[0]
        for r in c.execute(
            "SELECT word, domain_id FROM domain_lexicon WHERE pinyin_key=? AND length(word)=? AND enabled=1 ORDER BY prior_score DESC LIMIT 8",
            (key, tl),
        ).fetchall()
    ]
    print(f"\nword={word} pinyin_key={key}")
    print(f"  base SQL count={base_n} top={base_words[:5]}")
    print(f"  domain SQL count={domain_n} top={domain_words}")

print("\n=== SEED LAYER STATS (first pass) ===")
layer_counts = {}
domain_layer_with_domains = 0
base_layer_with_domains = 0
lines = 0
for line in SEED.open(encoding="utf-8"):
    lines += 1
    row = json.loads(line)
    layer = (row.get("lexiconLayer") or row.get("lexicon_layer") or "").strip() or "(none)"
    layer_counts[layer] = layer_counts.get(layer, 0) + 1
    doms = row.get("domains") or []
    if layer == "base" and doms:
        base_layer_with_domains += 1
    if layer in ("domain", "domain_patch") and doms:
        domain_layer_with_domains += 1
print("seed lines:", lines)
print("layer counts:", layer_counts)
print("rows lexiconLayer=base with domains[]:", base_layer_with_domains)
print("rows lexiconLayer=domain* with domains[]:", domain_layer_with_domains)

conn.close()
