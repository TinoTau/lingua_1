"""Patch batch1-1b-stage4 for Mandatory Tone Recall (1.1C) without encoding corruption."""
from __future__ import annotations

import pathlib
import re

path = pathlib.Path(
    r"d:/Programs/github/lingua_1/electron_node/electron-node/main/src/lexicon-v2/batch1-1b-stage4-generalization.audit.test.ts"
)
text = path.read_text(encoding="utf-8")

# Add tone=1 to 3-arg recall1(...) calls only.
text2 = re.sub(
    r"recall1\(([^,\n]+), ([^,\n]+), ([^,\n\)]+)\)",
    r"recall1(\1, \2, \3, 1)",
    text,
)

# Restore intentional no-pattern call for Fail Closed assertion.
old_plain = "const plain评 = recall1(rt, 'pt', '评', 1);"
new_plain = "const plain评 = recall1(rt, 'pt', '评');"
if old_plain not in text2:
    raise SystemExit("plain评 call not found after rewrite")
text2 = text2.replace(old_plain, new_plain, 1)

# Update H section expectations to Fail Closed.
old_h = """    // plain: 平/坪/评 all length1 → surface exact 评
    expect(plain评[0]?.hotword.word).toBe('评');
    // tone1: eligible 平+坪 (ambiguous); exact 评 under pt1 miss → empty (NOT silent plain)
    expect(tone1评).toHaveLength(0);
    expect(rt.lookupBaseByExactSurfacePinyinAndTone('pt', 'pt1', '评', 1)).toHaveLength(0);
    expect(tone2评[0]?.hotword.word).toBe('评');

    const supports = rt.supportsToneFirstRecall();
    rt.supportsToneFirstRecall = () => false;
    const unsupported = recall1(rt, 'pt', '评', 2);
    PLAIN_TONE.push({
      id: 'tone_unsupported_outer_fallback',
      supportsBefore: supports,
      hits: unsupported.map((h) => h.hotword.word),
      stage: unsupported[0]?.toneLookupStage ?? null,
      ownership:
        'outer collectBaseOnlySingleCharCandidate uses plain when !supportsToneFirstRecall — not exact API',
      deferred: 'Batch 1.1C',
    });
    rt.supportsToneFirstRecall = () => supports;"""

new_h = """    // Batch 1.1C: no pattern → Empty (not plain exact)
    expect(plain评).toHaveLength(0);
    // tone1: eligible 平+坪 (ambiguous); exact 评 under pt1 miss → empty (NOT silent plain)
    expect(tone1评).toHaveLength(0);
    expect(rt.lookupBaseByExactSurfacePinyinAndTone('pt', 'pt1', '评', 1)).toHaveLength(0);
    expect(tone2评[0]?.hotword.word).toBe('评');

    const supports = rt.supportsToneFirstRecall();
    rt.supportsToneFirstRecall = () => false;
    const unsupported = recall1(rt, 'pt', '评', 2);
    PLAIN_TONE.push({
      id: 'tone_runtime_unsupported_fail_closed',
      supportsBefore: supports,
      hits: unsupported.map((h) => h.hotword.word),
      stage: unsupported[0]?.toneLookupStage ?? null,
      ownership: 'Mandatory Tone Recall (1.1C): runtime_unsupported → Empty; Plain SQL = 0',
    });
    expect(unsupported).toHaveLength(0);
    rt.supportsToneFirstRecall = () => supports;"""

if old_h not in text2:
    raise SystemExit("H section block not found")
text2 = text2.replace(old_h, new_h, 1)

# Also update PLAIN_TONE push id for plain_sees
text2 = text2.replace(
    "id: 'plain_sees_评'",
    "id: 'no_pattern_fail_closed'",
    1,
)

# Sanity: fromCodePoint must not have been corrupted
if "fromCodePoint(spec.base + 90, 1)" in text2:
    raise SystemExit("fromCodePoint corruption detected")
if "\ufffd" in text2:
    raise SystemExit("replacement char detected")

path.write_text(text2, encoding="utf-8")
print("patched ok", path.stat().st_size)
print("recall1 4-arg approx", len(re.findall(r"recall1\([^)]+, 1\)", text2)))
