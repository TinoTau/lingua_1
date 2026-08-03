import json
from pathlib import Path

p = Path(r"d:/Programs/github/lingua_1/docs/tone-v2/_audit_scratch/batch11c_regression.json")
data = json.loads(p.read_text(encoding="utf-8"))
fails = []
for suite in data.get("testResults", []):
    name = Path(suite["name"]).name
    for a in suite.get("assertionResults", []):
        if a.get("status") == "failed":
            fails.append(f"{name} :: {a.get('title') or a.get('fullName')}")
out = Path(r"d:/Programs/github/lingua_1/docs/tone-v2/_audit_scratch/batch11c_regression_fails.txt")
out.write_text(
    f"suitesFailed={data.get('numFailedTestSuites')} testsFailed={data.get('numFailedTests')} passed={data.get('numPassedTests')}\n"
    + "\n".join(fails),
    encoding="utf-8",
)
print(out.read_text(encoding="utf-8")[:3000])
