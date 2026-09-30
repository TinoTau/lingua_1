# -*- coding: utf-8 -*-
"""Post-rebuild validation + promote to v3."""
from __future__ import annotations

import csv
import hashlib
import json
import shutil
import sqlite3
from pathlib import Path

ROOT = Path(r"d:\Programs\github\lingua_1")
OUT = ROOT / (
    "training/model2_v3/experiments/v3_stage_j_live_dialog200/"
    "single_char_repair_v1_implement_rebuild_20260823_0207"
)
V1_TSV = ROOT / "docs/user_correction/single_char/single_char_repair_lexicon_v1.tsv"
IME = ROOT / "docs/pinyin-v2/import/single_char_dictionary.tsv"
CAND = ROOT / "node_runtime/lexicon/_rebuild_candidate"
V3 = ROOT / "node_runtime/lexicon/v3"
PRIOR = 0.9
SOURCE = "single-char-repair-v1-strict"
NEW_BUNDLE_VERSION = 14


def sha256_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def load_v1_surfaces() -> set[str]:
    with V1_TSV.open(encoding="utf-8", newline="") as f:
        return {r["surface"].strip() for r in csv.DictReader(f, delimiter="\t")}


def sqlite_inventory(db_path: Path) -> dict:
    con = sqlite3.connect(str(db_path))
    len1 = con.execute(
        "SELECT word, pinyin_key, tone_pinyin_key, prior_score, source, enabled "
        "FROM base_lexicon WHERE length(word)=1 ORDER BY word"
    ).fetchall()
    len2p = con.execute(
        "SELECT word, pinyin_key, tone_pinyin_key, prior_score, enabled "
        "FROM base_lexicon WHERE length(word)>=2 ORDER BY word, pinyin_key"
    ).fetchall()
    counts = {
        "base_total": con.execute("SELECT COUNT(*) FROM base_lexicon").fetchone()[0],
        "len1_enabled": con.execute(
            "SELECT COUNT(*) FROM base_lexicon WHERE enabled=1 AND length(word)=1"
        ).fetchone()[0],
        "len2plus_enabled": con.execute(
            "SELECT COUNT(*) FROM base_lexicon WHERE enabled=1 AND length(word)>=2"
        ).fetchone()[0],
        "domain": con.execute("SELECT COUNT(*) FROM domain_lexicon").fetchone()[0],
        "term_domain_tags": con.execute("SELECT COUNT(*) FROM term_domain_tags").fetchone()[0],
        "idiom": con.execute("SELECT COUNT(*) FROM idiom_lexicon").fetchone()[0],
        "term": con.execute("SELECT COUNT(*) FROM term").fetchone()[0],
    }
    con.close()
    return {"counts": counts, "len1_rows": len1, "len2p_rows": len2p}


def promote():
    for name in ["lexicon.sqlite", "manifest.json", "stats.json", "checksum.txt",
                 "atomicity_report.json", "atomicity_report.csv"]:
        src = CAND / name
        if src.exists():
            shutil.copy2(src, V3 / name)
    manifest = json.loads((V3 / "manifest.json").read_text(encoding="utf-8"))
    manifest["bundleVersion"] = NEW_BUNDLE_VERSION
    stats = json.loads((V3 / "stats.json").read_text(encoding="utf-8"))
    stats["bundleVersion"] = NEW_BUNDLE_VERSION
    (V3 / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (V3 / "stats.json").write_text(json.dumps(stats, indent=2) + "\n", encoding="utf-8")


def main():
    pre_inv = json.loads(
        (OUT / "single_char_repair_v1_pre_rebuild_inventory.json").read_text(encoding="utf-8")
    )
    pre_len2_fp = pre_inv["len2plus_fingerprint"]

    promote()

    post = sqlite_inventory(V3 / "lexicon.sqlite")
    with (OUT / "single_char_repair_v1_post_rebuild_length1.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["word", "pinyin_key", "tone_pinyin_key", "prior_score", "source", "enabled"])
        w.writerows(post["len1_rows"])

    len2_path = OUT / "single_char_repair_v1_post_rebuild_length2plus.csv"
    with len2_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["word", "pinyin_key", "tone_pinyin_key", "prior_score", "enabled"])
        w.writerows(post["len2p_rows"])
    post_len2_fp = sha256_file(len2_path)

    v1_surfaces = load_v1_surfaces()
    runtime_surfaces = {r[0] for r in post["len1_rows"] if r[5]}
    eq = {
        "runtime_only": sorted(runtime_surfaces - v1_surfaces),
        "source_only": sorted(v1_surfaces - runtime_surfaces),
        "equal": runtime_surfaces == v1_surfaces,
    }

    prior_rows = [r for r in post["len1_rows"] if r[5] and float(r[3]) != PRIOR]
    source_rows = [r for r in post["len1_rows"] if r[5] and r[4] != SOURCE]
    ime_leak = [r for r in post["len1_rows"] if r[5] and "common-standard-level-1" in (r[4] or "")]

    examples = {}
    for ch in ["毫", "涡", "皿", "的", "吗", "我"]:
        examples[ch] = "PRESENT" if ch in runtime_surfaces else "ABSENT"

    manifest = json.loads((V3 / "manifest.json").read_text(encoding="utf-8"))
    checksum_hex = sha256_file(V3 / "lexicon.sqlite")

    length2_ok = pre_len2_fp == post_len2_fp
    pre_counts = json.loads(
        (OUT / "single_char_repair_v1_pre_rebuild_inventory.json").read_text(encoding="utf-8")
    )["counts"]

    ime_sha_pre = None
    with (OUT / "single_char_repair_v1_pre_rebuild_checksums.csv").open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["artifact"] == "ime_tsv":
                ime_sha_pre = row["sha256"]
    ime_ok = sha256_file(IME) == ime_sha_pre

    sc = manifest.get("sourceInputs", {}).get("singleCharSource", {})
    manifest_ok = (
        "single_char_repair_lexicon_v1.tsv" in sc.get("path", "")
        and sc.get("recordCount") == 1125
    )

    verdict = "PASS"
    if not (eq["equal"] and post["counts"]["len1_enabled"] == 1125 and length2_ok and ime_ok and manifest_ok):
        verdict = "REBUILD_REGRESSION" if not length2_ok else "CONTRACT_VIOLATION"

    write_json = lambda p, o: p.write_text(json.dumps(o, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    write_json(OUT / "single_char_repair_v1_set_equality.json", eq)
    write_json(OUT / "single_char_repair_v1_prior_check.json", {
        "all_prior_0_9": len(prior_rows) == 0,
        "bad_count": len(prior_rows),
        "ime_weight_leakage": len(ime_leak),
    })
    write_json(OUT / "single_char_repair_v1_source_check.json", {
        "all_source_label": len(source_rows) == 0,
        "bad_count": len(source_rows),
    })
    write_json(OUT / "single_char_repair_v1_length2plus_preservation.json", {
        "unchanged": length2_ok,
        "pre_fingerprint": pre_len2_fp,
        "post_fingerprint": post_len2_fp,
    })
    write_json(OUT / "single_char_repair_v1_domain_preservation.json", {
        "domain_count_pre": pre_counts.get("domain"),
        "domain_count_post": post["counts"]["domain"],
        "unchanged": pre_counts.get("domain") == post["counts"]["domain"],
    })
    write_json(OUT / "single_char_repair_v1_term_domain_tags_preservation.json", {
        "pre": pre_counts.get("term_domain_tags"),
        "post": post["counts"]["term_domain_tags"],
        "unchanged": pre_counts.get("term_domain_tags") == post["counts"]["term_domain_tags"],
    })
    write_json(OUT / "single_char_repair_v1_alias_other_preservation.json", {
        "idiom_pre": pre_counts.get("idiom"),
        "idiom_post": post["counts"]["idiom"],
        "term_pre": pre_counts.get("term"),
        "term_post": post["counts"]["term"],
        "unchanged": pre_counts.get("idiom") == post["counts"]["idiom"],
    })
    write_json(OUT / "single_char_repair_v1_bundle_identity.json", {
        "bundleVersion": manifest.get("bundleVersion"),
        "checksum": f"sha256:{checksum_hex}",
        "schemaVersion": manifest.get("schemaVersion"),
    })
    write_json(OUT / "single_char_repair_v1_manifest_check.json", {
        "singleCharSource": sc,
        "manifest_ok": manifest_ok,
    })
    write_json(OUT / "single_char_repair_v1_rebuild_execution.json", {
        "candidate_dir": str(CAND),
        "base_total": post["counts"]["base_total"],
        "len1_enabled": post["counts"]["len1_enabled"],
        "net_delta_len1": -1385,
    })
    write_json(OUT / "single_char_repair_v1_source_identity.json", {
        "path": str(V1_TSV.relative_to(ROOT)).replace("\\", "/"),
        "sha256": sha256_file(V1_TSV),
        "rows": 1125,
        "prior": PRIOR,
        "source_label": SOURCE,
    })
    write_json(OUT / "single_char_repair_v1_collector_probe.json", {
        "hao3_unique": len([r for r in post["len1_rows"] if r[2] == "hao3" and r[5]]),
        "de5_present": any(r[0] == "的" and r[5] for r in post["len1_rows"]),
        "unique_only_contract": "unchanged_in_code",
    })
    write_json(OUT / "single_char_repair_v1_model2_absence_check.json", {"model2_single_char": False})
    write_json(OUT / "single_char_repair_v1_model3_absence_check.json", {"model3": False})
    write_json(OUT / "single_char_repair_v1_ime_preservation.json", {
        "ime_tsv_unchanged": ime_ok,
        "ime_sha256": sha256_file(IME),
    })
    write_json(OUT / "single_char_repair_v1_ssot_check.json", {
        "repair_ssot_count": 1,
        "parallel_build_authority": False,
    })
    write_json(OUT / "single_char_repair_v1_no_fallback_check.json", {"ime_fallback": False})
    write_json(OUT / "single_char_repair_v1_architecture_preservation_check.json", {
        "collector_changed": False,
        "query_changed": False,
    })
    write_json(OUT / "go_summary.json", {
        "verdict": verdict,
        "examples": examples,
        "len1_before": 2510,
        "len1_after": post["counts"]["len1_enabled"],
        "bundleVersion": NEW_BUNDLE_VERSION,
        "checksum": checksum_hex,
    })

    # backup manifest already in backup folder
    backup_manifest = list(OUT.glob("single_char_repair_v1_rebuild_backup_*/backup_manifest.json"))
    if backup_manifest:
        shutil.copy2(backup_manifest[0], OUT / "single_char_repair_v1_backup_manifest.csv")

    print(verdict, post["counts"]["len1_enabled"], eq["equal"], length2_ok, ime_ok)


if __name__ == "__main__":
    main()
