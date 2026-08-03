import json
import pathlib

p = pathlib.Path(
    r"C:/Users/tinot/.cursor/projects/d-Programs-github-lingua-1/agent-transcripts/9ab6499b-cb9f-4b5d-9ecb-a860d97290f8/9ab6499b-cb9f-4b5d-9ecb-a860d97290f8.jsonl"
)
target_suffix = "batch1-1b-stage4-generalization.audit.test.ts"
out = None
with p.open("r", encoding="utf-8") as f:
    for line in f:
        if target_suffix not in line:
            continue
        if '"name":"Write"' not in line and '"name": "Write"' not in line:
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue
        content = obj.get("message", {}).get("content", [])
        if not isinstance(content, list):
            continue
        for part in content:
            if part.get("type") != "tool_use" or part.get("name") != "Write":
                continue
            inp = part.get("input", {})
            path = inp.get("path", "")
            if path.endswith(target_suffix):
                out = inp.get("contents")
                print("found write len", len(out or ""))

if not out:
    raise SystemExit("NOT_FOUND")

dest = pathlib.Path(
    r"d:/Programs/github/lingua_1/electron_node/electron-node/main/src/lexicon-v2/batch1-1b-stage4-generalization.audit.test.ts"
)
dest.write_text(out, encoding="utf-8")
print("restored", dest.stat().st_size)
