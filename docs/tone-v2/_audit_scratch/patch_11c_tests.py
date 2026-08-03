"""Safe UTF-8 patches for Batch 1.1C Mandatory Tone Recall test updates."""
from __future__ import annotations

import pathlib
import re

ROOT = pathlib.Path(r"d:/Programs/github/lingua_1/electron_node/electron-node/main/src/lexicon-v2")


def patch_11b_stage4() -> None:
    path = ROOT / "batch1-1b-stage4-generalization.audit.test.ts"
    text = path.read_text(encoding="utf-8")

    text2 = re.sub(
        r"recall1\(([^,\n]+), ([^,\n]+), ([^,\n\)]+)\)",
        r"recall1(\1, \2, \3, 1)",
        text,
    )
    text2 = text2.replace(
        "const plain评 = recall1(rt, 'pt', '评', 1);",
        "const plain评 = recall1(rt, 'pt', '评');",
        1,
    )
    text2 = text2.replace("id: 'plain_sees_评'", "id: 'no_pattern_fail_closed'", 1)

    # Fail Closed expectations
    text2 = text2.replace(
        "expect(plain评[0]?.hotword.word).toBe('评');",
        "expect(plain评).toHaveLength(0);",
        1,
    )
    text2 = text2.replace(
        "id: 'tone_unsupported_outer_fallback'",
        "id: 'tone_runtime_unsupported_fail_closed'",
        1,
    )
    text2 = text2.replace(
        "'outer collectBaseOnlySingleCharCandidate uses plain when !supportsToneFirstRecall — not exact API'",
        "'Mandatory Tone Recall (1.1C): runtime_unsupported → Empty; Plain SQL = 0'",
        1,
    )
    text2 = text2.replace("      deferred: 'Batch 1.1C',\n", "", 1)

    insert = "    expect(unsupported).toHaveLength(0);\n"
    anchor = "    rt.supportsToneFirstRecall = () => supports;\n\n    const db = new Database"
    if insert.strip() not in text2 and anchor in text2:
        text2 = text2.replace(anchor, insert + anchor, 1)

    if "fromCodePoint(spec.base + 90, 1)" in text2:
        raise SystemExit("fromCodePoint corruption")
    if "\ufffd" in text2:
        raise SystemExit("replacement char")

    path.write_text(text2, encoding="utf-8")
    print("patched 1.1b stage4", path.stat().st_size)


def patch_11a_stage4() -> None:
    path = ROOT / "batch1-1a-stage4-generalization.audit.test.ts"
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

    text2 = re.sub(
        r"const hits = recallSpanTopKV2\(rt, \{[\s\S]*?domainIds: \[\],\n    \}\)\.hits;",
        add_tone,
        text,
    )
    if "\ufffd" in text2:
        raise SystemExit("1.1a replacement char")
    path.write_text(text2, encoding="utf-8")
    print("patched 1.1a stage4", path.stat().st_size)
    print("tone patterns", text2.count("acousticTonePattern"))


patch_11b_stage4()
patch_11a_stage4()
