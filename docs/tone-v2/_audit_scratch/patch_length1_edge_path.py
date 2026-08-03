"""Patch length1-recall-edge-path for Mandatory Tone Recall (UTF-8 safe)."""
from __future__ import annotations

import re
from pathlib import Path

path = Path(
    r"d:/Programs/github/lingua_1/electron_node/electron-node/main/src/fw-detector/span-assembly-v4/length1-recall-edge-path.sqlite.integration.test.ts"
)
text = path.read_text(encoding="utf-8")

if "makeCharToneFixtures" not in text:
    text = text.replace(
        "import { recallTopKForWindows } from './recall-topk-for-windows';\n",
        "import { recallTopKForWindows } from './recall-topk-for-windows';\n"
        "import { makeCharToneFixtures } from './test-tone-fixtures';\n",
    )

helper = """
function toneArgs(rawText: string, tones: Array<1 | 2 | 3 | 4 | 5>) {
  const fix = makeCharToneFixtures(rawText, tones);
  return {
    toneTimestampOnlyEnabled: true as const,
    acousticSlices: fix.acousticSlices,
    wordTimeSpans: fix.wordTimeSpans,
  };
}

"""
if "function toneArgs(" not in text:
    text = text.replace(
        "describe('Batch 1.0C Edge/Path/Vote/call-site (SQLite)', () => {",
        helper + "describe('Batch 1.0C Edge/Path/Vote/call-site (SQLite)', () => {",
    )

TONE_BY_RAW = {
    "我": [3],
    "甲乙": [3, 3],
    "点": [3],
    "零": [1],
    "甲乙丙丁戊": [3, 3, 3, 1, 4],
    "高速": [1, 4],
    "你要吗？": [3, 4, 5, 1],
}


def find_raw(preceding: str, body: str) -> str:
    m = re.search(r"rawText: '([^']+)'", body)
    if m:
        return m.group(1)
    # Look farther back for const rawText = '...'
    m = re.search(r"const rawText = '([^']+)';", preceding)
    if m:
        # last assignment before the call
        return re.findall(r"const rawText = '([^']+)';", preceding)[-1]
    raise SystemExit(f"rawText not found; body={body[:120]!r} prev={preceding[-120]!r}")


pattern = re.compile(
    r"recallTopKForWindows\(\{\n(?P<body>.*?)\n(?P<indent>\s*)toneTimestampOnlyEnabled: false,\n(?P<tail>.*?)\}\);",
    re.S,
)

out = []
last = 0
count = 0
for m in pattern.finditer(text):
    out.append(text[last : m.start()])
    preceding = text[max(0, m.start() - 1200) : m.start()]
    body = m.group("body")
    indent = m.group("indent")
    tail = m.group("tail")
    raw = find_raw(preceding, body)
    tones = TONE_BY_RAW.get(raw)
    if tones is None:
        raise SystemExit(f"no tones for {raw!r}")
    tone_lit = "[" + ", ".join(str(t) for t in tones) + "]"
    # Prefer identifier when body uses rawText shorthand
    raw_arg = "rawText" if re.search(r"^\s*rawText,", body, re.M) or "rawText," in body.split("\n")[0] else f"'{raw}'"
    if "rawText," in body or re.match(r"\s*rawText,", body):
        raw_arg = "rawText"
    else:
        raw_arg = f"'{raw}'"
    block = (
        "recallTopKForWindows({\n"
        f"{body}\n"
        f"{indent}...toneArgs({raw_arg}, {tone_lit}),\n"
        f"{tail}}});"
    )
    out.append(block)
    last = m.end()
    count += 1
out.append(text[last:])
text2 = "".join(out)
print("patched", count)
print("remaining false", text2.count("toneTimestampOnlyEnabled: false"))
path.write_text(text2, encoding="utf-8")
