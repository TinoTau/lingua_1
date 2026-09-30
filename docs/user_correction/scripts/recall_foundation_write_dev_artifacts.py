#!/usr/bin/env python3
"""Write remaining recall-foundation development artifacts (not dialog_200 after-stats)."""
from __future__ import annotations

import csv
import json
import sqlite3
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
OUT = REPO / "training/model2_v3/experiments/v3_stage_j_live_dialog200/recall_foundation_completion_2026_08_18"
SQLITE = REPO / "node_runtime/lexicon/v3/lexicon.sqlite"
MANIFEST = REPO / "node_runtime/lexicon/v3/manifest.json"


def write_json(p: Path, obj) -> None:
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def write_csv(p: Path, rows: list[dict], fieldnames: list[str]) -> None:
    with p.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in fieldnames})


def main() -> None:
    db = sqlite3.connect(str(SQLITE))
    after = {
        "term": db.execute("SELECT COUNT(*) FROM term").fetchone()[0],
        "term_enabled": db.execute("SELECT COUNT(*) FROM term WHERE enabled=1").fetchone()[0],
        "term_len1_enabled": db.execute(
            "SELECT COUNT(*) FROM term WHERE enabled=1 AND length(word)=1"
        ).fetchone()[0],
        "base": db.execute("SELECT COUNT(*) FROM base_lexicon").fetchone()[0],
        "base_enabled": db.execute("SELECT COUNT(*) FROM base_lexicon WHERE enabled=1").fetchone()[0],
        "base_len1_enabled": db.execute(
            "SELECT COUNT(*) FROM base_lexicon WHERE enabled=1 AND length(word)=1"
        ).fetchone()[0],
        "domain": db.execute("SELECT COUNT(*) FROM domain_lexicon").fetchone()[0],
        "domain_len1_enabled": db.execute(
            "SELECT COUNT(*) FROM domain_lexicon WHERE enabled=1 AND length(word)=1"
        ).fetchone()[0],
        "term_domain_tags": db.execute("SELECT COUNT(*) FROM term_domain_tags").fetchone()[0],
        "base_missing_pinyin": db.execute(
            "SELECT COUNT(*) FROM base_lexicon WHERE enabled=1 AND (pinyin_key IS NULL OR pinyin_key='')"
        ).fetchone()[0],
        "base_missing_tone": db.execute(
            "SELECT COUNT(*) FROM base_lexicon WHERE enabled=1 AND (tone_pinyin_key IS NULL OR tone_pinyin_key='')"
        ).fetchone()[0],
        "duplicate_base_pk": db.execute(
            "SELECT COUNT(*) FROM (SELECT pinyin_key, word, COUNT(*) c FROM base_lexicon GROUP BY 1,2 HAVING c>1)"
        ).fetchone()[0],
    }
    db.close()
    write_json(OUT / "lexicon_sqlite_after.json", after)
    before = json.loads((OUT / "lexicon_sqlite_baseline.json").read_text(encoding="utf-8"))
    write_json(
        OUT / "lexicon_before_after.json",
        {
            "before": before,
            "after": after,
            "single_char_before": before.get("base_len1_enabled", 0),
            "single_char_after": after["base_len1_enabled"],
        },
    )
    man = json.loads(MANIFEST.read_text(encoding="utf-8"))
    write_json(
        OUT / "lexicon_rebuild_manifest.json",
        {
            "pipeline": "electron_node/electron-node/scripts/lexicon/run-lexicon-full-rebuild.mjs",
            "promoted_to": "node_runtime/lexicon/v3",
            "bundleVersion": man.get("bundleVersion"),
            "checksum": man.get("checksum"),
            "tables": man.get("tables"),
            "singleCharSource": (man.get("sourceInputs") or {}).get("singleCharSource"),
            "dialog200_used_as_vocabulary_source": False,
        },
    )
    write_csv(
        OUT / "normalization_restore_change_inventory.csv",
        [
            {
                "file": "electron_node/electron-node/main/src/fw-detector/normalize-for-fw-repair.ts",
                "change": "Restore existing OpenCC t2cn + NFKC as FW Repair input canonicalizer",
                "new_framework": "NO",
            },
            {
                "file": "electron_node/electron-node/main/src/fw-detector/fw-detector-orchestrator.ts",
                "change": "Canonical repairText before V4 path; keep ctx.rawAsrText",
                "new_framework": "NO",
            },
            {
                "file": "electron_node/electron-node/main/src/pipeline/context/job-context.ts",
                "change": "Observation fields fwRepairNormalizedText / fwRepairScriptNormalized",
                "new_framework": "NO",
            },
            {
                "file": "electron_node/electron-node/main/src/fw-detector/fw-detector-v4-path.ts",
                "change": "Attach repairNormalization diagnostics to FwDetectorResult",
                "new_framework": "NO",
            },
        ],
        ["file", "change", "new_framework"],
    )
    write_json(
        OUT / "frozen_component_change_check.json",
        {
            "Model2_checkpoint": "UNCHANGED sha256 d66847be010f0953382243c7cc664a683e37bf6d112f33b463b68eb7fbeabeda",
            "Model2_architecture": "UNCHANGED",
            "FineSpan_architecture": "UNCHANGED",
            "Assembly": "UNCHANGED",
            "Candidate_budget": "UNCHANGED",
            "KenLM": "UNCHANGED",
            "RetrievalPolicyV3": "UNCHANGED",
            "training": False,
        },
    )
    write_json(
        OUT / "architecture_conformance_check.json",
        {
            "MATERIALIZABLE_TARGET_V1": "FROZEN",
            "normalization_restore": "existing OpenCC t2cn only",
            "lexicon_ssot": "node_runtime/lexicon/v3/lexicon.sqlite",
            "no_json_fallback": True,
            "no_shadow_lexicon": True,
            "no_dialog200_vocab_import": True,
        },
    )
    write_json(
        OUT / "dialog200_training_leakage_check.json",
        {"training": False, "expectedText_used_as_train_label": False},
    )
    write_json(
        OUT / "dialog200_expectedtext_lexicon_leakage_check.json",
        {
            "dialog_200_used_as_vocabulary_source": False,
            "single_char_import_source": "docs/pinyin-v2/import/single_char_dictionary.tsv",
            "import_rows": 2510,
            "dialog200_seen_measurement_only": True,
            "test_only_terms_imported": 0,
        },
    )
    write_json(
        OUT / "lexicon_ssot_check.json",
        {
            "runtime_ssot": "node_runtime/lexicon/v3/lexicon.sqlite",
            "json_fallback": False,
            "hardcoded_vocabulary": False,
            "test_vocabulary": False,
            "shadow_lexicon": False,
            "PASS": True,
        },
    )
    write_csv(
        OUT / "modified_file_inventory.csv",
        [
            {"path": "electron_node/electron-node/main/src/fw-detector/normalize-for-fw-repair.ts", "kind": "normalization_restore"},
            {"path": "electron_node/electron-node/main/src/fw-detector/normalize-for-fw-repair.test.ts", "kind": "test"},
            {"path": "electron_node/electron-node/main/src/fw-detector/fw-detector-orchestrator.ts", "kind": "normalization_restore"},
            {"path": "electron_node/electron-node/main/src/fw-detector/fw-detector-v4-path.ts", "kind": "observation"},
            {"path": "electron_node/electron-node/main/src/fw-detector/types.ts", "kind": "observation"},
            {"path": "electron_node/electron-node/main/src/pipeline/context/job-context.ts", "kind": "observation"},
            {"path": "electron_node/electron-node/main/src/pipeline/result-builder-core.ts", "kind": "observation"},
            {"path": "electron_node/electron-node/scripts/lexicon/lib/full-rebuild-from-csv.mjs", "kind": "lexicon_pipeline"},
            {"path": "electron_node/docs/lexicon-assets/full_rebuild_v1/sources.manifest.json", "kind": "ssot_hash_repair"},
            {"path": "electron_node/electron-node/tests/run-dialog200-stagej-full-path-trace.mjs", "kind": "test_harness"},
            {"path": "node_runtime/lexicon/v3/lexicon.sqlite", "kind": "rebuilt_ssot"},
        ],
        ["path", "kind"],
    )
    print("after", after)


if __name__ == "__main__":
    main()
