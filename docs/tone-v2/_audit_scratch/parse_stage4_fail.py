from pathlib import Path
import re

text = Path(r"d:/Programs/github/lingua_1/docs/tone-v2/_audit_scratch/stage4_fail.txt").read_text(
    encoding="utf-8", errors="replace"
)
out = []
for m in re.finditer(r"(FAIL|PASS) .+", text):
    out.append(m.group(0)[:200])
for m in re.finditer(r"^\s*[×✕●].+", text, re.M):
    out.append(m.group(0)[:200])
for m in re.finditer(r"Expected:.*|Received:.*|Tests:.*", text):
    out.append(m.group(0)[:200])

# also capture test names that failed via "● "
for line in text.splitlines():
    if "FAIL " in line or line.strip().startswith("×") or "● " in line or "✕ " in line:
        out.append(line.strip()[:220])
    if "Expected:" in line or "Received:" in line or line.startswith("Tests:"):
        out.append(line.strip()[:220])

Path(r"d:/Programs/github/lingua_1/docs/tone-v2/_audit_scratch/stage4_fail_summary.txt").write_text(
    "\n".join(dict.fromkeys(out)), encoding="utf-8"
)
print("lines", len(out))
