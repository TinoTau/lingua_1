from pathlib import Path

lines = []
for name in [
    "batch1-1a-stage4-generalization.audit.test.ts",
    "batch1-1b-stage4-generalization.audit.test.ts",
]:
    p = Path(r"d:/Programs/github/lingua_1/electron_node/electron-node/main/src/lexicon-v2") / name
    t = p.read_text(encoding="utf-8")
    lines.append(f"{name} box={t.count(chr(0x25A2))} fffd={t.count(chr(0xFFFD))}")
    for i, l in enumerate(t.splitlines(), 1):
        if "windowText:" in l and ("25a2" in repr(l).lower() or "\u25a2" in l or "▢" in l):
            lines.append(f"  {i}:{l}")
        if "surface:" in l and ("\u25a2" in l or "▢" in l):
            lines.append(f"  {i}:{l}")
        if "windowText: '" in l:
            # dump codepoints of windowText literals that are short
            import re

            m = re.search(r"windowText: '([^']*)'", l)
            if m and len(m.group(1)) <= 2:
                cps = " ".join(f"U+{ord(c):04X}" for c in m.group(1))
                lines.append(f"  {i}: windowText cps={cps} line={l.strip()}")

Path(r"d:/Programs/github/lingua_1/docs/tone-v2/_audit_scratch/box_check.txt").write_text(
    "\n".join(lines), encoding="utf-8"
)
print("wrote", len(lines))
