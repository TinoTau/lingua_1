#!/usr/bin/env python3
"""READ-ONLY single-char lexicon runtime state audit. No writes to sqlite."""

from __future__ import annotations

import csv
import hashlib
import json
import re
import sqlite3
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
OUT = (
    ROOT
    / "training/model2_v3/experiments/v3_stage_j_live_dialog200"
    / "single_char_lexicon_runtime_state_audit_2026_08_21"
)
OUT.mkdir(parents=True, exist_ok=True)

DB = ROOT / "node_runtime/lexicon/v3/lexicon.sqlite"
MANIFEST = ROOT / "node_runtime/lexicon/v3/manifest.json"
TSV = ROOT / "docs/pinyin-v2/import/single_char_dictionary.tsv"
STRICT = ROOT / "docs/user_correction/single_char/Lingua_single_char_repair_lexicon_strict_v1.csv"
BALANCED = ROOT / "docs/user_correction/single_char/Lingua_single_char_repair_lexicon_balanced_v1.csv"
CLD = ROOT / "docs/user_correction/single_char/Lingua_single_char_repair_lexicon_CLD_audit_v1.csv"
HAN = re.compile(r"^[\u4e00-\u9fff]$")


def dump(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", path.name, flush=True)


def load_cld_words(path: Path) -> set[str]:
    words: set[str] = set()
    with path.open(encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            w = (row.get("word") or row.get("surface") or "").strip()
            if HAN.fullmatch(w):
                words.add(w)
    return words


def main() -> int:
    assert DB.is_file(), DB
    uri = f"file:{DB.as_posix()}?mode=ro"
    con = sqlite3.connect(uri, uri=True)
    con.row_factory = sqlite3.Row
    cols = [r[1] for r in con.execute("PRAGMA table_info(base_lexicon)")]
    rows = [
        dict(r)
        for r in con.execute(
            """SELECT id, pinyin_key, tone_pinyin_key, word, normalized, prior_score,
                      repair_target, enabled, aliases, source, canonical_word, is_alias
               FROM base_lexicon WHERE length(word)=1"""
        )
    ]
    enabled = [r for r in rows if int(r["enabled"] or 0) == 1]
    disabled = [r for r in rows if int(r["enabled"] or 0) != 1]
    eligible = [
        r
        for r in enabled
        if r.get("is_alias") in (0, None, False, "0") and float(r.get("prior_score") or 0) > 0
    ]
    dom = con.execute(
        "SELECT COUNT(*) AS c FROM domain_lexicon WHERE length(word)=1 AND enabled=1"
    ).fetchone()[0]
    idiom = con.execute(
        "SELECT COUNT(*) AS c FROM idiom_lexicon WHERE length(word)=1 AND enabled=1"
    ).fetchone()[0]

    inv_path = OUT / "current_runtime_single_char_inventory.csv"
    fields = [
        "term_id",
        "surface",
        "canonical_surface",
        "pinyin",
        "tone",
        "prior_score",
        "enabled",
        "source",
        "lexicon_type",
        "is_alias",
        "repair_target",
        "normalized",
    ]
    with inv_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in enabled:
            w.writerow(
                {
                    "term_id": r["id"],
                    "surface": r["word"],
                    "canonical_surface": r.get("canonical_word") or r["word"],
                    "pinyin": r.get("pinyin_key") or "",
                    "tone": r.get("tone_pinyin_key") or "",
                    "prior_score": r.get("prior_score"),
                    "enabled": r.get("enabled"),
                    "source": r.get("source") or "",
                    "lexicon_type": "base_lexicon",
                    "is_alias": r.get("is_alias"),
                    "repair_target": r.get("repair_target"),
                    "normalized": r.get("normalized") or "",
                }
            )

    src_c = Counter((r.get("source") or "") for r in enabled)
    chars = {r["word"] for r in enabled}
    tones = {(r.get("pinyin_key"), r.get("tone_pinyin_key")) for r in enabled}
    poly = Counter(r["word"] for r in enabled)
    poly_n = sum(1 for _ch, c in poly.items() if c > 1)
    priors = Counter(str(r.get("prior_score")) for r in enabled)

    tsv_chars: set[str] = set()
    tsv_n = 0
    with TSV.open(encoding="utf-8") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            s = (row.get("surface") or "").strip()
            if HAN.fullmatch(s):
                tsv_chars.add(s)
                tsv_n += 1

    strict = load_cld_words(STRICT)
    bal = load_cld_words(BALANCED)
    cld = load_cld_words(CLD)
    rt = chars
    only_rt = sorted(rt - tsv_chars)
    only_2510 = sorted(tsv_chars - rt)

    def cmp(name: str, s: set[str]) -> dict:
        return {
            "name": name,
            "set_size": len(s),
            "runtime_size": len(rt),
            "overlap": len(rt & s),
            "runtime_only": len(rt - s),
            "set_only": len(s - rt),
            "jaccard": round(len(rt & s) / len(rt | s), 4) if (rt | s) else 0,
            "exact_set_equal": rt == s,
            "runtime_subset_of_set": rt <= s,
            "set_subset_of_runtime": s <= rt,
        }

    cmp_strict = cmp("STRICT", strict)
    cmp_bal = cmp("BALANCED", bal)
    cmp_cld = cmp("FULL_CLD", cld)
    cmp_2510 = {
        "overlap": len(rt & tsv_chars),
        "runtime_only_count": len(only_rt),
        "ime2510_only_count": len(only_2510),
        "runtime_only_sample": only_rt[:40],
        "ime2510_only_sample": only_2510[:40],
        "exact_set_equal": rt == tsv_chars,
        "runtime_is_basically_2510": len(rt & tsv_chars) >= 0.95 * max(len(rt), 1)
        and len(only_rt) <= 50,
        "tsv_row_count": tsv_n,
        "tsv_unique_chars": len(tsv_chars),
    }

    examples = {}
    for ch in ["毫", "涡", "皿", "酯"]:
        matches = [r for r in enabled if r["word"] == ch]
        examples[ch] = {
            "present": bool(matches),
            "rows": [
                {
                    "id": r["id"],
                    "source": r.get("source"),
                    "prior": r.get("prior_score"),
                    "pinyin": r.get("pinyin_key"),
                    "tone": r.get("tone_pinyin_key"),
                }
                for r in matches
            ],
            "in_2510": ch in tsv_chars,
            "in_strict": ch in strict,
            "in_balanced": ch in bal,
            "in_cld": ch in cld,
        }

    wordhood_cols = [
        c
        for c in cols
        if any(k in c.lower() for k in ["wordhood", "pos", "freq", "cld", "eligibility", "lexical"])
    ]
    h = hashlib.sha256(DB.read_bytes()).hexdigest()
    man = json.loads(MANIFEST.read_text(encoding="utf-8"))

    dump(
        OUT / "inventory_stats.json",
        {
            "enabled_rows": len(enabled),
            "unique_chars": len(chars),
            "unique_pinyin_tone": len(tones),
            "disabled_rows": len(disabled),
            "polyphonic_surfaces_multi_rows": poly_n,
            "source_breakdown": dict(src_c),
            "prior_score_distribution": dict(priors),
            "filterEligible_like": len(eligible),
            "domain_l1_enabled": dom,
            "idiom_l1_enabled": idiom,
        },
    )
    dump(OUT / "runtime_vs_ime2510_comparison.json", cmp_2510)
    dump(OUT / "runtime_vs_strict_comparison.json", cmp_strict)
    dump(OUT / "runtime_vs_balanced_comparison.json", cmp_bal)
    dump(OUT / "runtime_vs_full_cld_comparison.json", cmp_cld)
    dump(
        OUT / "runtime_vs_cld_derived_sets.json",
        {"2510": cmp_2510, "strict": cmp_strict, "balanced": cmp_bal, "full_cld": cmp_cld},
    )
    dump(OUT / "single_char_runtime_example_character_check.json", examples)
    dump(
        OUT / "single_char_runtime_wordhood_evidence.json",
        {
            "table_columns": cols,
            "wordhood_related_columns": wordhood_cols,
            "NO_WORDHOOD_EVIDENCE_IN_RUNTIME": len(wordhood_cols) == 0,
            "source_field_values": dict(src_c),
            "note": "base_lexicon has source string only; no POS/CLD/wordhood columns",
        },
    )
    dump(
        OUT / "single_char_runtime_bundle_identity.json",
        {
            "path": str(DB).replace("\\", "/"),
            "manifest": str(MANIFEST).replace("\\", "/"),
            "schemaVersion": man.get("schemaVersion"),
            "bundleVersion": man.get("bundleVersion"),
            "bundleTag": man.get("bundleTag"),
            "buildTime": man.get("buildTime"),
            "checksum_manifest": man.get("checksum"),
            "checksum_computed_sha256": "sha256:" + h,
            "checksum_match": man.get("checksum") == ("sha256:" + h),
            "tables": man.get("tables"),
            "singleCharSource": (man.get("sourceInputs") or {}).get("singleCharSource"),
            "rebuild_sources": (man.get("rebuild") or {}).get("sources"),
        },
    )
    dump(
        OUT / "go_summary.json",
        {
            "verdict": "FILTER_NOT_IMPLEMENTED",
            "enabled_length1": len(enabled),
            "unique_chars": len(chars),
            "sources": dict(src_c),
            "vs_2510": cmp_2510,
            "vs_strict": cmp_strict,
            "vs_balanced": cmp_bal,
            "vs_cld": cmp_cld,
            "bundleVersion": man.get("bundleVersion"),
            "db_sha256": h,
            "domain_l1_enabled": dom,
            "idiom_l1_enabled": idiom,
            "cld_imported": False,
            "filtering_reached_runtime": False,
        },
    )
    con.close()
    print(
        "DONE enabled",
        len(enabled),
        "unique",
        len(chars),
        "vs2510 equal",
        cmp_2510["exact_set_equal"],
        "strict overlap",
        cmp_strict["overlap"],
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
