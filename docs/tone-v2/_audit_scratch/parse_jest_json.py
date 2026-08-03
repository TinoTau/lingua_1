import json
from pathlib import Path

data = json.loads(
    Path(r"d:/Programs/github/lingua_1/docs/tone-v2/_audit_scratch/stage4_jest.json").read_text(
        encoding="utf-8"
    )
)
lines = []
for suite in data.get("testResults", []):
    name = Path(suite["name"]).name
    for a in suite.get("assertionResults", []):
        if a.get("status") != "failed":
            continue
        lines.append(f"FAIL {name} :: {a.get('fullName')}")
        for msg in a.get("failureMessages", [])[:1]:
            # keep first ~800 chars
            lines.append(msg[:800].replace("\n", " | "))
        lines.append("")

Path(r"d:/Programs/github/lingua_1/docs/tone-v2/_audit_scratch/stage4_fail_parsed.txt").write_text(
    "\n".join(lines), encoding="utf-8"
)
print("failed", sum(1 for s in data.get('testResults',[]) for a in s.get('assertionResults',[]) if a.get('status')=='failed'))
