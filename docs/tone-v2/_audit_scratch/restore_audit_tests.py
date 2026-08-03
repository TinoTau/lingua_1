import json
import pathlib
import re

TRANSCRIPT = pathlib.Path(
    r"C:/Users/tinot/.cursor/projects/d-Programs-github-lingua-1/agent-transcripts/9ab6499b-cb9f-4b5d-9ecb-a860d97290f8/9ab6499b-cb9f-4b5d-9ecb-a860d97290f8.jsonl"
)


def restore_latest_write(suffix: str, dest: pathlib.Path) -> None:
    out = None
    with TRANSCRIPT.open("r", encoding="utf-8") as f:
        for line in f:
            if suffix not in line:
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
                if path.replace("\\", "/").endswith(suffix):
                    out = inp.get("contents")
    if not out:
        raise SystemExit(f"NOT_FOUND {suffix}")
    dest.write_text(out, encoding="utf-8")
    print("restored", dest, dest.stat().st_size)


restore_latest_write(
    "batch1-1b-stage4-generalization.audit.test.ts",
    pathlib.Path(
        r"d:/Programs/github/lingua_1/electron_node/electron-node/main/src/lexicon-v2/batch1-1b-stage4-generalization.audit.test.ts"
    ),
)

# Try restore 1.1a from Write; if missing, try reading from localhistory or git objects won't work for untracked.
restore_latest_write(
    "batch1-1a-stage4-generalization.audit.test.ts",
    pathlib.Path(
        r"d:/Programs/github/lingua_1/electron_node/electron-node/main/src/lexicon-v2/batch1-1a-stage4-generalization.audit.test.ts"
    ),
)
