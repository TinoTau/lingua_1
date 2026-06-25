#!/usr/bin/env python3
"""Generate Industry Expansion Pack V2 theme seed .txt files (900-1100 terms each)."""
from __future__ import annotations

import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
THEMES_DIR = (
    SCRIPT_DIR.parents[2]
    / "docs"
    / "lexicon-assets"
    / "industry_pack_v2"
    / "themes"
)
VOCAB_DIR = SCRIPT_DIR / "vocab_data"

DOMAINS = [
    "tech_ai",
    "meeting",
    "medical",
    "transport",
    "tourism_hotel",
    "tourism_pickup",
    "tourism_route",
    "tourism_transport",
    "coffee",
    "milk_tea",
    "bakery",
    "food_order",
]

TARGET_MIN = 900
TARGET_MAX = 1100

CJK_RE = re.compile(r"[\u4e00-\u9fff]")
COMPOUND_BLOCK = re.compile(r"中选择|顺手|打包|堂食|点餐|菜单|收据|带走|外卖|排号|发票")
PHRASE_MARKERS = re.compile(r"[请吗呢吧啊]|确认|事件|怎么|什么|可以|需要|预订|改签|播放器|吗$|女$")
PHRASE_SUFFIX = re.compile(r"(服务|确认)$")
GENERIC_BLOCK = {"服务", "工作", "发布", "模型", "优化", "下文"}


def cjk_count(word: str) -> int:
    return len(CJK_RE.findall(word))


def reject_term(word: str) -> bool:
    w = word.strip()
    if not w:
        return True
    if w in GENERIC_BLOCK:
        return True
    if COMPOUND_BLOCK.search(w):
        return True
    if PHRASE_MARKERS.search(w):
        return True
    if len(w) >= 3 and PHRASE_SUFFIX.search(w):
        return True
    if w.endswith("的") or w.endswith("了"):
        return True
    n = cjk_count(w)
    if n < 2 or n > 5:
        return True
    if n != len(w):
        return True
    return False


def load_domain_terms(domain: str) -> list[str]:
    path = VOCAB_DIR / f"{domain}.txt"
    if not path.exists():
        raise FileNotFoundError(path)
    terms: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        w = line.strip()
        if w and not reject_term(w):
            terms.append(w)
    return terms


def write_domain_file(domain: str, terms: list[str]) -> int:
    THEMES_DIR.mkdir(parents=True, exist_ok=True)
    out = THEMES_DIR / f"{domain}.txt"
    unique = list(dict.fromkeys(terms))
    out.write_text("\n".join(unique) + "\n", encoding="utf-8")
    return len(unique)


def main() -> int:
    global_used: set[str] = set()
    summary: list[tuple[str, int]] = []
    errors: list[str] = []

    for domain in DOMAINS:
        raw = load_domain_terms(domain)
        picked: list[str] = []
        for t in raw:
            if t in global_used:
                continue
            picked.append(t)
            global_used.add(t)
        count = len(picked)
        if count < TARGET_MIN:
            errors.append(f"{domain}: only {count} unique terms (need {TARGET_MIN}+)")
        if count > TARGET_MAX:
            picked = picked[:TARGET_MAX]
            count = len(picked)
        write_domain_file(domain, picked)
        summary.append((domain, count))

    print("=== Industry Pack V2 Theme Seeds ===")
    total = 0
    for domain, count in summary:
        print(f"  {domain}: {count}")
        total += count
    print(f"  TOTAL: {total}")
    if errors:
        print("\nWARNINGS:")
        for e in errors:
            print(f"  - {e}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
