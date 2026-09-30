#!/usr/bin/env python3
"""After TTS generation: trainrows → dataset gate → (if PASS) Stage A scale train."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def run(script: str) -> int:
    cmd = [sys.executable, str(ROOT / "training/model2/scripts" / script)]
    print("RUN", script, flush=True)
    return subprocess.call(cmd, cwd=str(ROOT))


def main() -> int:
    rc = run("build_scale_trainrows.py")
    if rc != 0:
        return rc
    rc = run("dataset_gate_scale.py")
    if rc != 0:
        print("DATASET GATE FAIL — stopping before training", flush=True)
        return rc
    return run("train_stage_a_scale.py")


if __name__ == "__main__":
    raise SystemExit(main())
