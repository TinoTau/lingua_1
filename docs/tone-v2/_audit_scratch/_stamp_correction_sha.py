# -*- coding: utf-8 -*-
from pathlib import Path

CORR = "0e3bcab1a2e76ea32cbd85fef228c10c3fbfc406"
ROOT = Path(r"d:\Programs\github\lingua_1")
PACK = ROOT / "docs/acceptance/Freeze/2026-08-05_FW_V4_ASR_PostProcess_Framework_Freeze"

# resolved_identity
p = PACK / "resolved_identity.json"
t = p.read_text(encoding="utf-8")
if "PENDING_CORRECTION_COMMIT" in t:
    p.write_text(t.replace("PENDING_CORRECTION_COMMIT", CORR), encoding="utf-8")
    print("resolved_identity stamped")
else:
    print("resolved_identity already stamped or missing placeholder")

# identity_correction_log — replace the table cell about correction commit
p = PACK / "identity_correction_log.md"
t = p.read_text(encoding="utf-8")
needle = "| Identity Documentation Correction Commit | 见 `resolved_identity.json`（提交后写入；不冒充 Runtime Freeze） |"
repl = f"| Identity Documentation Correction Commit | `{CORR}` |"
if needle in t:
    p.write_text(t.replace(needle, repl), encoding="utf-8")
    print("identity_correction_log stamped")
else:
    print("identity_correction_log needle miss")

# RECOVERY
p = PACK / "RECOVERY.md"
t = p.read_text(encoding="utf-8")
old = "Identity Documentation Correction Commit: see resolved_identity.json"
new = f"Identity Documentation Correction Commit: {CORR}"
if old in t:
    p.write_text(t.replace(old, new), encoding="utf-8")
    print("RECOVERY stamped")
else:
    print("RECOVERY needle miss")

# report — add correction SHA near header if needed
p = PACK / "report.md"
t = p.read_text(encoding="utf-8")
if "Identity Documentation Correction Commit" not in t:
    insert = f"| Identity Documentation Correction Commit | `{CORR}` |\n"
    t = t.replace(
        f"| Runtime Freeze Commit | `6889fe16790587df7e711d5ad35b1e50ea53037c` |\n",
        f"| Runtime Freeze Commit | `6889fe16790587df7e711d5ad35b1e50ea53037c` |\n{insert}",
    )
    p.write_text(t, encoding="utf-8")
    print("report stamped")
else:
    print("report already has correction commit line")

# snapshot summary
p = ROOT / "docs/framework_snapshots/FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05/FRAMEWORK_FREEZE_SUMMARY.md"
t = p.read_text(encoding="utf-8")
old = "| Identity Documentation Correction Commit | 见 Pack `resolved_identity.json`（不冒充 Runtime Freeze Commit；不移动 Tag） |"
new = f"| Identity Documentation Correction Commit | `{CORR}`（不冒充 Runtime Freeze Commit；不移动 Tag） |"
if old in t:
    p.write_text(t.replace(old, new), encoding="utf-8")
    print("snapshot summary stamped")
else:
    print("snapshot summary miss")

# entry summary
p = ROOT / "docs/framework_snapshots/FRAMEWORK_FREEZE_SUMMARY.md"
t = p.read_text(encoding="utf-8")
old = "| Identity Documentation Correction | Pack `resolved_identity.json` · does **not** move Tag · does **not** change frozen runtime |"
new = f"| Identity Documentation Correction Commit | `{CORR}` · does **not** move Tag · does **not** change frozen runtime |"
if old in t:
    p.write_text(t.replace(old, new), encoding="utf-8")
    print("entry summary stamped")
else:
    print("entry summary miss; content snippet:")
    for line in t.splitlines():
        if "Identity" in line or "Correction" in line:
            print(repr(line))

# current INDEX
p = ROOT / "docs/current/INDEX.md"
t = p.read_text(encoding="utf-8")
old = "| Identity Documentation Correction | [`../acceptance/Freeze/2026-08-05_FW_V4_ASR_PostProcess_Framework_Freeze/resolved_identity.json`](../acceptance/Freeze/2026-08-05_FW_V4_ASR_PostProcess_Framework_Freeze/resolved_identity.json) — **does not** change frozen runtime; **does not** move Tag |"
new = f"| Identity Documentation Correction Commit | `{CORR}` — **does not** change frozen runtime; **does not** move Tag; see [`resolved_identity.json`](../acceptance/Freeze/2026-08-05_FW_V4_ASR_PostProcess_Framework_Freeze/resolved_identity.json) |"
if old in t:
    p.write_text(t.replace(old, new), encoding="utf-8")
    print("current INDEX stamped")
else:
    print("current INDEX miss")

# docs INDEX
p = ROOT / "docs/INDEX.md"
t = p.read_text(encoding="utf-8")
old = "| Identity correction pack | [`acceptance/Freeze/2026-08-05_FW_V4_ASR_PostProcess_Framework_Freeze/resolved_identity.json`](./acceptance/Freeze/2026-08-05_FW_V4_ASR_PostProcess_Framework_Freeze/resolved_identity.json) — correction commit ≠ Runtime Freeze Commit |"
new = f"| Identity Documentation Correction Commit | `{CORR}` — ≠ Runtime Freeze Commit; see [`resolved_identity.json`](./acceptance/Freeze/2026-08-05_FW_V4_ASR_PostProcess_Framework_Freeze/resolved_identity.json) |"
if old in t:
    p.write_text(t.replace(old, new), encoding="utf-8")
    print("docs INDEX stamped")
else:
    print("docs INDEX miss")

# FROZEN.md already partially updated by previous script — ensure concrete SHA
p = ROOT / "docs/fw-detector/freeze/FROZEN.md"
t = p.read_text(encoding="utf-8")
if CORR not in t:
    t2 = t.replace(
        "Identity Documentation Correction Commit: see\n  docs/acceptance/Freeze/2026-08-05_FW_V4_ASR_PostProcess_Framework_Freeze/resolved_identity.json",
        f"Identity Documentation Correction Commit: {CORR}",
    )
    if t2 == t:
        t2 = t.replace(
            "Identity Documentation Correction Commit: 0e3bcab1a2e76ea32cbd85fef228c10c3fbfc406",
            f"Identity Documentation Correction Commit: {CORR}",
        )
    # previous script may have put only 'see' path replacement incorrectly
    if "Identity Documentation Correction Commit:" in t and CORR not in t:
        import re
        t2 = re.sub(
            r"Identity Documentation Correction Commit:.*?(?=\nThe correction)",
            f"Identity Documentation Correction Commit: {CORR}\n",
            t,
            count=1,
            flags=re.S,
        )
    p.write_text(t2 if 't2' in dir() else t, encoding="utf-8")
    print("FROZEN stamped/checked")
else:
    print("FROZEN already has CORR")

# Refresh content_manifest for changed FROZEN SSOT paths
import csv, hashlib
manifest = PACK / "content_manifest.csv"
rows = []
with manifest.open(encoding="utf-8-sig", newline="") as f:
    for r in csv.DictReader(f):
        path = ROOT / r["relativePath"]
        if path.exists() and r.get("freezeStatus") == "FROZEN":
            r["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
        rows.append(r)
fields = list(rows[0].keys())
with manifest.open("w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=fields)
    w.writeheader()
    w.writerows(rows)
print("manifest refreshed")
