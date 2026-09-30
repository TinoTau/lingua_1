#!/usr/bin/env python3
"""Phase 7A — Stage B Baseline V1 (listwise BOUND, init from Stage A Baseline)."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Reuse Phase 6C listwise orchestrator with baseline paths.
from training.model2.scripts.train_stage_b_listwise import main as listwise_main


if __name__ == "__main__":
    # Default argv if user runs with no args
    if len(sys.argv) == 1:
        sys.argv.extend(
            [
                "--accent-dir",
                str(ROOT / "training/model2/dataset/baseline_v1"),
                "--rows-dir",
                str(ROOT / "training/model2/dataset/baseline_v1/stage_b_trainrows"),
                "--stage-a-ckpt",
                str(ROOT / "training/model2/experiments/stage_a_baseline_v1/model2-stageA-baseline-m0.pt"),
                "--out-dir",
                str(ROOT / "training/model2/experiments/stage_b_baseline_v1"),
                "--epochs",
                "30",
            ]
        )
    raise SystemExit(listwise_main())
