"""Add acousticTonePattern to 1.1A stage4 recalls that lack one (UTF-8 safe)."""
from __future__ import annotations

import pathlib
import re

path = pathlib.Path(
    r"d:/Programs/github/lingua_1/electron_node/electron-node/main/src/lexicon-v2/batch1-1a-stage4-generalization.audit.test.ts"
)
text = path.read_text(encoding="utf-8")


def add_tone(m: re.Match[str]) -> str:
    block = m.group(0)
    if "acousticTonePattern" in block:
        return block
    return block.replace(
        "domainIds: [],\n    }).hits;",
        "domainIds: [],\n      acousticTonePattern: [1],\n    }).hits;",
        1,
    )


text2, n = re.subn(
    r"const hits = recallSpanTopKV2\(rt, \{[\s\S]*?domainIds: \[\],\n    \}\)\.hits;",
    add_tone,
    text,
)
path.write_text(text2, encoding="utf-8")
print("replacements", n)
print("tone patterns", text2.count("acousticTonePattern"))
