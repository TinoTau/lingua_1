# -*- coding: utf-8 -*-
import subprocess
from pathlib import Path

root = Path(r"d:\Programs\github\lingua_1")
pack = root / "docs/acceptance/Freeze/2026-08-05_FW_V4_ASR_PostProcess_Framework_Freeze"

# Stage identity + report only (manifest unchanged for these small docs if not listed)
subprocess.check_call(
    ["git", "add",
     str(pack / "baseline_identity.json"),
     str(pack / "report.md")],
    cwd=root,
)
subprocess.check_call(["git", "commit", "--amend", "--no-edit"], cwd=root)

tag = "FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05"
subprocess.call(["git", "tag", "-d", tag], cwd=root)
msg = """ASR post-processing framework freeze
Tone / Exact Recall / Lexicon / Domain Vote
SameDomain Bucket / Assembly / CrossPath / KenLM
Repair Selection Metadata
Documentation SSOT synchronized
"""
subprocess.check_call(["git", "tag", "-a", tag, "-m", msg], cwd=root)

head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
peel = subprocess.check_output(["git", "rev-list", "-n", "1", tag], cwd=root, text=True).strip()
print("HEAD", head)
print("PEEL", peel)
print("MATCH", head == peel)
