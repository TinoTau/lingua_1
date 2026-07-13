#!/usr/bin/env python3
"""Restore dialog_200 smoke corpus (manifest + d001 wav). Idempotent."""
from __future__ import annotations

import json
import shutil
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
DIALOG_DIR = REPO / "test wav" / "dialog_200"
UTTERANCE_SOURCE = (
    REPO
    / "electron_node"
    / "electron-node"
    / "tests"
    / "experiments"
    / "tone-module-p1-dialog-fw-scan.json"
)
SOURCE_WAV = DIALOG_DIR / "context_prior" / "cp_001_hotel_latte.wav"
TARGET_WAV = DIALOG_DIR / "dialog_d001.wav"
MANIFEST_PATH = DIALOG_DIR / "cases.manifest.json"

D001_UTTERANCE = "你好，我想点一杯热拿铁，中杯，少糖。顺便问一下今天有蓝莓马芬吗？"


def _load_d001_utterance() -> str:
    if UTTERANCE_SOURCE.is_file():
        data = json.loads(UTTERANCE_SOURCE.read_text(encoding="utf-8"))
        for case in data.get("cases", []):
            if case.get("id") == "d001" and case.get("utterance"):
                return str(case["utterance"])
    return D001_UTTERANCE


def main() -> None:
    DIALOG_DIR.mkdir(parents=True, exist_ok=True)
    utterance = _load_d001_utterance()

    if not SOURCE_WAV.is_file():
        raise SystemExit(f"source wav missing: {SOURCE_WAV}")

    shutil.copy2(SOURCE_WAV, TARGET_WAV)

    manifest = {
        "corpus": "dialog_200",
        "version": "restored_smoke_v1",
        "caseCount": 1,
        "isFullCorpus": False,
        "restoredAt": "2026-06-28",
        "audioSourceNote": (
            "dialog_d001.wav copied from context_prior/cp_001_hotel_latte.wav; "
            "utterance text from tone-module-p1-dialog-fw-scan.json (historical d001)."
        ),
        "cases": [
            {
                "id": "d001",
                "file": "dialog_d001.wav",
                "audio": "dialog_d001.wav",
                "utterance": utterance,
                "text": utterance,
                "expectedText": utterance,
                "language": "zh",
                "scenario": "cafe",
                "sourceAudio": "context_prior/cp_001_hotel_latte.wav",
            }
        ],
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"restored {TARGET_WAV} ({TARGET_WAV.stat().st_size} bytes)")
    print(f"restored {MANIFEST_PATH}")


if __name__ == "__main__":
    main()
