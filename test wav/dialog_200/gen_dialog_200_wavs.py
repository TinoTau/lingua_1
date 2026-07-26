#!/usr/bin/env python3
"""Thin wrapper — regenerate dialog_200 wav via restore-dialog200-full.py."""
import subprocess
import sys
from pathlib import Path

SCRIPT = (
    Path(__file__).resolve().parents[2]
    / "electron_node"
    / "electron-node"
    / "scripts"
    / "test-corpus"
    / "restore-dialog200-full.py"
)
sys.exit(subprocess.call([sys.executable, str(SCRIPT), *sys.argv[1:]]))
