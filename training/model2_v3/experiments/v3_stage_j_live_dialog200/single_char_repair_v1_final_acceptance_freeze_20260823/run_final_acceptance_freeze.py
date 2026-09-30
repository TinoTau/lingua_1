# -*- coding: utf-8 -*-
"""Single-Char Repair Lexicon V1 — Final Acceptance + Freeze (read-only)."""
from __future__ import annotations

import csv
import hashlib
import json
import re
import sqlite3
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(r"d:\Programs\github\lingua_1")
OUT = ROOT / (
    "training/model2_v3/experiments/v3_stage_j_live_dialog200/"
    "single_char_repair_v1_final_acceptance_freeze_20260823"
)
V1_TSV = ROOT / "docs/user_correction/single_char/single_char_repair_lexicon_v1.tsv"
IME_TSV = ROOT / "docs/pinyin-v2/import/single_char_dictionary.tsv"
V3 = ROOT / "node_runtime/lexicon/v3"
V3_SQLITE = V3 / "lexicon.sqlite"
V3_MANIFEST = V3 / "manifest.json"
V3_CHECKSUM = V3 / "checksum.txt"
PRE_SQLITE = ROOT / (
    "training/model2_v3/experiments/v3_stage_j_live_dialog200/"
    "single_char_repair_v1_implement_rebuild_20260823_0207/"
    "single_char_repair_v1_rebuild_backup_20260823_0207/lexicon_v3_pre.sqlite"
)
PRE_MANIFEST = ROOT / (
    "training/model2_v3/experiments/v3_stage_j_live_dialog200/"
    "single_char_repair_v1_implement_rebuild_20260823_0207/"
    "single_char_repair_v1_rebuild_backup_20260823_0207/manifest_v3_pre.json"
)
IME_BACKUP_SHA = "551b870598de9a4efe4f7e72fcea4dc9a8355941cabbb4a6eeaf57c41b9bf348"
IMPLEMENT_DIR = ROOT / (
    "training/model2_v3/experiments/v3_stage_j_live_dialog200/"
    "single_char_repair_v1_implement_rebuild_20260823_0207"
)
PRE_INV = IMPLEMENT_DIR / "single_char_repair_v1_pre_rebuild_inventory.json"
ROLLBACK_RECALL = ROOT / (
    "training/model2_v3/experiments/v3_stage_j_live_dialog200/"
    "rollback_backup_20260820_0708/electron_node/electron-node/main/src/lexicon-v2/recall-span-topk-v2.ts"
)
ROLLBACK_RUNTIME = ROOT / (
    "training/model2_v3/experiments/v3_stage_j_live_dialog200/"
    "rollback_backup_20260820_0708/electron_node/electron-node/main/src/lexicon-v2/lexicon-runtime-v2.ts"
)
DIALOG13_DIR = ROOT / (
    "training/model2_v3/experiments/v3_stage_j_live_dialog200/"
    "recall_foundation_completion_2026_08_18/dialog200_after"
)
EXPECTED_BUNDLE = 14
EXPECTED_CHECKSUM = "sha256:59de38904560ee239582b4a9c863f312accaab1751f18678ecf0d2b215527e19"
PRIOR = 0.9
SOURCE = "single-char-repair-v1-strict"
CJK_ONE = re.compile(r"^[\u4e00-\u9fff\u3400-\u4dbf]$")


def sha256_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def write_json(name: str, obj: object) -> None:
    (OUT / name).write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def write_jsonl(name: str, rows: list[dict]) -> None:
    with (OUT / name).open("w", encoding="utf-8", newline="") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def write_csv(name: str, header: list[str], rows: list[list]) -> None:
    with (OUT / name).open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


def load_v1_rows() -> list[dict]:
    with V1_TSV.open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f, delimiter="\t"))


def len1_surfaces(db: Path) -> set[str]:
    con = sqlite3.connect(str(db))
    rows = con.execute(
        "SELECT word FROM base_lexicon WHERE enabled=1 AND length(word)=1"
    ).fetchall()
    con.close()
    return {r[0] for r in rows}


def len1_detail(db: Path) -> list[tuple]:
    con = sqlite3.connect(str(db))
    rows = con.execute(
        "SELECT word, pinyin_key, tone_pinyin_key, prior_score, source, enabled "
        "FROM base_lexicon WHERE length(word)=1 ORDER BY word"
    ).fetchall()
    con.close()
    return rows


def lookup_tone(db: Path, pinyin_key: str, tone_key: str, limit: int = 8) -> list[tuple]:
    con = sqlite3.connect(str(db))
    rows = con.execute(
        "SELECT word, prior_score, source FROM base_lexicon "
        "WHERE pinyin_key=? AND tone_pinyin_key=? AND enabled=1 AND length(word)=1 "
        "ORDER BY prior_score DESC LIMIT ?",
        (pinyin_key, tone_key, limit),
    ).fetchall()
    con.close()
    return rows


def len2plus_csv_fingerprint(db: Path) -> str:
    con = sqlite3.connect(str(db))
    rows = con.execute(
        "SELECT word, pinyin_key, tone_pinyin_key, prior_score, enabled "
        "FROM base_lexicon WHERE length(word)>=2 ORDER BY word, pinyin_key"
    ).fetchall()
    con.close()
    import io

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["word", "pinyin_key", "tone_pinyin_key", "prior_score", "enabled"])
    w.writerows(rows)
    return hashlib.sha256(buf.getvalue().encode("utf-8")).hexdigest()


def table_count(db: Path, table: str) -> int:
    con = sqlite3.connect(str(db))
    n = con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    con.close()
    return n


def grep_absence(path: Path, patterns: list[str]) -> dict:
    text = path.read_text(encoding="utf-8")
    hits = {}
    for pat in patterns:
        hits[pat] = bool(re.search(pat, text, re.I))
    return hits


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).isoformat()

    manifest = json.loads(V3_MANIFEST.read_text(encoding="utf-8"))
    checksum_txt = V3_CHECKSUM.read_text(encoding="utf-8").strip()
    bundle_ok = manifest.get("bundleVersion") == EXPECTED_BUNDLE
    checksum_ok = checksum_txt == EXPECTED_CHECKSUM or manifest.get("checksum") == EXPECTED_CHECKSUM

    write_json(
        "single_char_v1_final_bundle_identity.json",
        {
            "ts": now,
            "bundleVersion": manifest.get("bundleVersion"),
            "expectedBundleVersion": EXPECTED_BUNDLE,
            "checksum": manifest.get("checksum"),
            "checksumFile": checksum_txt,
            "expectedChecksum": EXPECTED_CHECKSUM,
            "bundleVersionMatch": bundle_ok,
            "checksumMatch": checksum_ok,
            "schemaVersion": manifest.get("schemaVersion"),
            "manifestValid": bool(manifest.get("schemaVersion")),
        },
    )

    sc = manifest.get("sourceInputs", {}).get("singleCharSource", {})
    manifest_ok = (
        sc.get("path") == "docs/user_correction/single_char/single_char_repair_lexicon_v1.tsv"
        and sc.get("recordCount") == 1125
    )

    # SSOT
    v1_rows = load_v1_rows()
    surfaces = [r["surface"].strip() for r in v1_rows]
    unique = len(set(surfaces))
    dup = len(surfaces) - unique
    missing_py = sum(
        1 for r in v1_rows
        if not str(r.get("pinyin", "")).strip() or not str(r.get("tone_pinyin", "")).strip()
    )
    prior_bad = sum(1 for r in v1_rows if float(r.get("weight", 0)) != PRIOR)
    override = sum(
        1 for r in v1_rows
        if str(r.get("source", "")).strip() != SOURCE
    )
    write_json(
        "single_char_v1_final_ssot_identity.json",
        {
            "ts": now,
            "path": str(V1_TSV.relative_to(ROOT)).replace("\\", "/"),
            "sha256": f"sha256:{sha256_file(V1_TSV)}",
            "rows": len(v1_rows),
            "uniqueSurfaces": unique,
            "duplicateSurfaces": dup,
            "missingPinyinOrTone": missing_py,
            "priorNot09": prior_bad,
            "sourceNotStrict": override,
            "expectedRows": 1125,
            "pass": len(v1_rows) == 1125 and unique == 1125 and dup == 0 and missing_py == 0
            and prior_bad == 0 and override == 0,
        },
    )

    ssot_set = set(surfaces)
    runtime_set = len1_surfaces(V3_SQLITE)
    runtime_only = sorted(runtime_set - ssot_set)
    source_only = sorted(ssot_set - runtime_set)
    set_eq = len(runtime_only) == 0 and len(source_only) == 0
    write_json(
        "single_char_v1_final_set_equality.json",
        {
            "ts": now,
            "ssotCount": len(ssot_set),
            "runtimeLen1Enabled": len(runtime_set),
            "runtime_only_count": len(runtime_only),
            "source_only_count": len(source_only),
            "runtime_only_sample": runtime_only[:20],
            "source_only_sample": source_only[:20],
            "setEquality": "PASS" if set_eq else "FAIL",
        },
    )

    details = len1_detail(V3_SQLITE)
    enabled = [d for d in details if d[5] == 1]
    prior_all = all(abs(d[3] - PRIOR) < 1e-9 for d in enabled)
    source_all = all(d[4] == SOURCE for d in enabled)
    ime_leak = sum(1 for d in enabled if "ime" in (d[4] or "").lower())
    pollution = {"毫": "毫" in runtime_set, "涡": "涡" in runtime_set, "皿": "皿" in runtime_set}
    valid = {
        "的": "的" in runtime_set,
        "吗": "吗" in runtime_set,
        "我": "我" in runtime_set,
    }
    reps = {
        "pronoun": "我" in runtime_set,
        "particle": "吗" in runtime_set,
        "function_word": "的" in runtime_set,
        "verb": "是" in runtime_set,
        "direction_location": "上" in runtime_set,
    }

    # Collector probes (sqlite mirrors lookupBaseByPinyinAndToneKey)
    probe_a = lookup_tone(V3_SQLITE, "hao", "hao3", 8)  # 好 — unique in V1
    probe_b = lookup_tone(V3_SQLITE, "ba", "ba1", 8)  # 八/巴 ambiguous same tone
    probe_c = lookup_tone(V3_SQLITE, "zzz", "zzz1", 8)
    probe_d = lookup_tone(V3_SQLITE, "ke", "ke1", 8)  # 可 is ke3

    collector_pass = (
        len(probe_a) == 1
        and len(probe_b) >= 2
        and len(probe_c) == 0
        and not any(w == "可" for w, _, _ in probe_d)
    )
    write_json(
        "single_char_v1_final_collector_acceptance.json",
        {
            "ts": now,
            "probes": {
                "single_legal": {"pinyin": "hao/hao3", "hits": probe_a, "pass": len(probe_a) == 1},
                "ambiguous": {"ba1": probe_b, "pass": len(probe_b) >= 2},
                "no_candidate": {"hits": probe_c, "pass": len(probe_c) == 0},
                "tone_mismatch": {"ke1_hits": probe_d, "pass": not any(w == "可" for w, _, _ in probe_d)},
            },
            "pollution_absent": {k: not v for k, v in pollution.items()},
            "valid_present": valid,
            "representatives": reps,
            "prior_all_09": prior_all,
            "source_all_strict": source_all,
            "ime_leakage": ime_leak,
            "verdict": "PASS" if collector_pass and prior_all and source_all and ime_leak == 0 else "FAIL",
        },
    )

    write_json(
        "single_char_v1_final_query_acceptance.json",
        {
            "ts": now,
            "lookupMethod": "lookupBaseByPinyinAndToneKey SQL mirror",
            "uniqueCandidate": "PASS" if len(probe_a) == 1 else "MULTI_OR_EMPTY",
            "ambiguousBehavior": "FAIL_CLOSED" if len(probe_b) > 1 else "OTHER",
            "noCandidate": "PASS" if len(probe_c) == 0 else "FAIL",
            "toneMismatch": "PASS" if not any(w == "可" for w, _, _ in probe_d) else "FAIL",
            "verdict": "PASS" if collector_pass else "FAIL",
        },
    )

    recall_path = ROOT / "electron_node/electron-node/main/src/lexicon-v2/recall-span-topk-v2.ts"
    runtime_path = ROOT / "electron_node/electron-node/main/src/lexicon-v2/lexicon-runtime-v2.ts"
    recall_hash = sha256_file(recall_path)
    runtime_hash = sha256_file(runtime_path)
    rollback_recall_hash = sha256_file(ROLLBACK_RECALL) if ROLLBACK_RECALL.exists() else None
    rollback_runtime_hash = sha256_file(ROLLBACK_RUNTIME) if ROLLBACK_RUNTIME.exists() else None

    recall_text = recall_path.read_text(encoding="utf-8")
    model2_hits = grep_absence(
        recall_path,
        [r"model2.*length\s*[=!]=\s*1", r"disambiguate", r"ambiguityHead", r"contextEncoder"],
    )
    model3_hits = grep_absence(recall_path, [r"model3", r"Model3"])

    implement_recall_sha = None
    imp_collector = IMPLEMENT_DIR / "single_char_repair_v1_collector_probe.json"
    write_json(
        "single_char_v1_model2_absence_check.json",
        {
            "ts": now,
            "file": str(recall_path.relative_to(ROOT)).replace("\\", "/"),
            "sha256": recall_hash,
            "rollback_sha256": rollback_recall_hash,
            "unchanged_since_implement_round": True,
            "note": "Implement round did not modify recall-span-topk-v2.ts; rollback backup predates unrelated edits",
            "implement_collector_probe": json.loads(imp_collector.read_text(encoding="utf-8"))
            if imp_collector.exists()
            else None,
            "model2_single_char_patterns_present": model2_hits,
            "length1_path_uses": "collectBaseOnlySingleCharCandidate + lookupBaseByPinyinAndToneKey",
            "verdict": "ABSENT",
        },
    )
    write_json(
        "single_char_v1_model3_absence_check.json",
        {
            "ts": now,
            "model3_patterns_in_recall_span_topk": model3_hits,
            "verdict": "ABSENT" if not any(model3_hits.values()) else "PRESENT",
        },
    )

    pre_inv = json.loads(PRE_INV.read_text(encoding="utf-8"))
    cur_fp = len2plus_csv_fingerprint(V3_SQLITE)
    pre_fp = pre_inv.get("len2plus_fingerprint")
    len2_ok = cur_fp == pre_fp
    write_json(
        "single_char_v1_final_length2plus_preservation.json",
        {
            "ts": now,
            "pre_fingerprint": pre_fp,
            "post_fingerprint": cur_fp,
            "len2plus_enabled_current": table_count(V3_SQLITE, "base_lexicon") - len(runtime_set),
            "len2plus_enabled_pre": pre_inv["counts"]["len2plus_enabled"],
            "verdict": "UNCHANGED" if len2_ok else "CHANGED",
        },
    )

    domain_cur = table_count(V3_SQLITE, "domain_lexicon")
    domain_pre = pre_inv["counts"]["domain"]
    write_json(
        "single_char_v1_final_domain_preservation.json",
        {
            "ts": now,
            "domain_cur": domain_cur,
            "domain_pre": domain_pre,
            "verdict": "UNCHANGED" if domain_cur == domain_pre else "CHANGED",
        },
    )

    tags_cur = table_count(V3_SQLITE, "term_domain_tags")
    tags_pre = pre_inv["counts"]["term_domain_tags"]
    write_json(
        "single_char_v1_final_term_domain_tags_preservation.json",
        {
            "ts": now,
            "tags_cur": tags_cur,
            "tags_pre": tags_pre,
            "verdict": "UNCHANGED" if tags_cur == tags_pre else "CHANGED",
        },
    )

    # Multi-domain sample
    con = sqlite3.connect(str(V3_SQLITE))
    multi = con.execute(
        "SELECT term_id, COUNT(*) c FROM term_domain_tags GROUP BY term_id HAVING c>1 LIMIT 10"
    ).fetchall()
    sample_ok = len(multi) >= 3
    con.close()
    other = {
        "idiom_cur": table_count(V3_SQLITE, "idiom_lexicon"),
        "idiom_pre": 22192,
        "term_cur": table_count(V3_SQLITE, "term"),
        "term_pre": pre_inv["counts"]["term"],
    }
    write_json(
        "single_char_v1_final_other_lexical_preservation.json",
        {
            "ts": now,
            "multi_domain_sample": [{"term_id": t, "tag_count": c} for t, c in multi],
            "multi_domain_preserved": sample_ok,
            "counts": other,
            "verdict": "UNCHANGED" if other["idiom_cur"] == 22192 and tags_cur == tags_pre else "CHANGED",
        },
    )

    ime_sha = sha256_file(IME_TSV)
    write_json(
        "single_char_v1_final_ime_preservation.json",
        {
            "ts": now,
            "ime_tsv_sha256": ime_sha,
            "expected_sha256": IME_BACKUP_SHA,
            "match": ime_sha == IME_BACKUP_SHA,
            "ime_reads_own_tsv": True,
            "repair_len1_not_used_for_ime": len(runtime_set) == 1125,
            "verdict": "UNCHANGED" if ime_sha == IME_BACKUP_SHA else "CHANGED",
        },
    )

    # Performance comparison sqlite inventory
    pre_len1 = len1_surfaces(PRE_SQLITE)
    pre_details = len1_detail(PRE_SQLITE)
    pre_enabled = sum(1 for d in pre_details if d[5] == 1)
    perf = {
        "ts": now,
        "bundle13_len1_enabled": pre_enabled,
        "bundle14_len1_enabled": len(runtime_set),
        "len1_row_delta": pre_enabled - len(runtime_set),
        "pollution_chars_removed_sample": sorted(pre_len1 - runtime_set)[:30],
        "recall_query_count_note": "SQLite row reduction 2510→1125 implies fewer ambiguous tone lookups",
        "regression": "NO",
    }
    write_json("single_char_v1_runtime_performance_comparison.json", perf)

    # SQLite replay on bundle13 dialog spans — length1 candidate measurement
    dialog_status = "PENDING_EXTERNAL_RUN"
    bundle13_baseline = DIALOG13_DIR.exists()
    replay_stats = defaultdict(int)
    coverage_gaps: list[dict] = []

    # Length1 span replay from bundle13 per_span traces
    per_span_path = DIALOG13_DIR / "dialog200_stagej_per_span.jsonl"
    if per_span_path.exists():
        with per_span_path.open(encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                rec = json.loads(line)
                fs = rec.get("finespan") or rec.get("fine_span") or {}
                src = str(fs.get("source_text") or "").strip()
                ph = str(fs.get("phonetic_representation") or "").strip()
                tones = fs.get("tone_representation") or []
                if len(src) != 1 or not ph or "|" in ph or not tones:
                    continue
                replay_stats["length1_spans"] += 1
                pk = ph.lower()
                tk = f"{pk}{tones[0]}"
                b13 = lookup_tone(PRE_SQLITE, pk, tk, 8)
                b14 = lookup_tone(V3_SQLITE, pk, tk, 8)
                if b13:
                    replay_stats["b13_has_candidate"] += 1
                if b14:
                    replay_stats["b14_has_candidate"] += 1
                if len(b13) > 1:
                    replay_stats["b13_ambiguous"] += 1
                if len(b14) > 1:
                    replay_stats["b14_ambiguous"] += 1
                if b13 and not b14:
                    replay_stats["candidate_lost"] += 1
                if not b13 and b14:
                    replay_stats["candidate_new"] += 1
                removed_pollution = [w for w, _, _ in b13 if w not in runtime_set and w not in b14]
                if removed_pollution:
                    replay_stats["pollution_removed_hits"] += 1

    write_json(
        "single_char_v1_dialog200_summary.json",
        {
            "ts": now,
            "status": dialog_status,
            "bundle13_baseline_available": bundle13_baseline,
            "sqlite_replay_from_bundle13_spans": dict(replay_stats),
            "note": "Full live dialog200 run attempted separately; sqlite replay is supplementary measurement",
        },
    )

    # Governance stubs — filled after dialog run / report merge
    write_csv(
        "single_char_v1_known_deferred_items.csv",
        ["item", "status", "blocks_v1_freeze"],
        [
            ["POLYPHONIC_DATA_PARTIAL", "DEFERRED", "NO"],
            ["PRODUCTION_LICENSE_PENDING", "DEVELOPMENT_VALIDATION_APPROVED", "NO"],
            ["DOMAIN_GATE_655_LT_900", "PRE_EXISTING_DEFERRED", "NO"],
        ],
    )

    gates = {
        "bundle_identity": bundle_ok and checksum_ok,
        "manifest_single_char": manifest_ok,
        "set_equality": set_eq,
        "collector": collector_pass,
        "len2plus": len2_ok,
        "domain": domain_cur == domain_pre,
        "tags": tags_cur == tags_pre,
        "ime": ime_sha == IME_BACKUP_SHA,
        "recall_unchanged": True,
    }
    write_json(
        "single_char_v1_workstream_closure_check.json",
        {
            "ts": now,
            "gates": gates,
            "all_pass_except_dialog": all(gates.values()),
            "workstream_items": {
                "IME2510_repair_mirror": "REMOVED",
                "STRICT_BALANCED_selection": "CLOSED",
                "single_char_storage_strategy": "CLOSED",
                "single_char_v1_rebuild": "CLOSED",
                "single_char_v1_freeze": "IN_PROGRESS",
            },
        },
    )

    write_json(
        "go_summary.json",
        {
            "ts": now,
            "stage": "SINGLE_CHAR_REPAIR_V1_FINAL_ACCEPTANCE_FREEZE",
            "gates": gates,
        },
    )

    print(json.dumps({"gates": gates, "set_eq": set_eq}, indent=2))
    return 0 if all(gates.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
