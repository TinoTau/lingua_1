"""
Scan markdown files under central_server/docs and report missing relative links.

Usage (from repo root):
  python central_server/docs/_tools/check_md_links.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path


LINK_RE = re.compile(r"\[[^\]]*\]\(([^)]+)\)")


def is_ignorable(link: str) -> bool:
    if not link:
        return True
    if link.startswith("#"):
        return True
    if "://" in link:
        return True
    if link.startswith("mailto:"):
        return True
    # treat absolute paths as out of scope for this check
    if link.startswith("/"):
        return True
    return False


def main() -> int:
    repo_root = Path(__file__).resolve().parents[3]
    docs_root = repo_root / "central_server" / "docs"
    md_files = sorted(docs_root.rglob("*.md"))

    missing: list[tuple[Path, str]] = []

    for f in md_files:
        try:
            txt = f.read_text(encoding="utf-8")
        except Exception:
            txt = f.read_text(encoding="utf-8", errors="ignore")

        for m in LINK_RE.finditer(txt):
            raw = m.group(1).strip()
            link = raw.split("#", 1)[0].split("?", 1)[0].strip()

            if is_ignorable(raw) or is_ignorable(link):
                continue

            target = (f.parent / link)
            if not target.exists():
                missing.append((f, raw))

    print(f"checked={len(md_files)} missing_links={len(missing)}")
    for f, raw in missing:
        rel = f.relative_to(repo_root).as_posix()
        print(f"- {rel}: {raw}")

    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())


