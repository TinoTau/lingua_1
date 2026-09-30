#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Download + extract Chinese Wikipedia latest pages-articles dump into cleaned sentences.
Streams bz2 XML; strips wiki markup; emits UTF-8 one sentence per line.
"""
from __future__ import annotations

import argparse
import bz2
import os
import re
import sys
import time
import urllib.request
from pathlib import Path
from xml.etree.ElementTree import iterparse

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from clean_zh import clean_sentence, sha1_line, split_sentences, strip_wiki_markup  # noqa: E402

DEFAULT_URL = "https://dumps.wikimedia.org/zhwiki/latest/zhwiki-latest-pages-articles.xml.bz2"
NS = "{http://www.mediawiki.org/xml/export-0.11/}"
# Some dumps use 0.10 — match tag ends
TITLE_END = "title"
TEXT_END = "text"
NS_END = "ns"
REDIRECT_END = "redirect"


def localname(tag: str) -> str:
    if "}" in tag:
        return tag.rsplit("}", 1)[-1]
    return tag


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 1_000_000:
        print(f"[wiki] reuse existing {dest} ({dest.stat().st_size} bytes)")
        return
    tmp = dest.with_suffix(dest.suffix + ".part")
    print(f"[wiki] downloading {url}")
    print(f"[wiki] -> {tmp}")
    req = urllib.request.Request(url, headers={"User-Agent": "lingua-kenlm-corpus-v1/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp, open(tmp, "wb") as out:
        total = resp.headers.get("Content-Length")
        total_i = int(total) if total and total.isdigit() else None
        done = 0
        t0 = time.time()
        while True:
            chunk = resp.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)
            done += len(chunk)
            if done % (50 * 1024 * 1024) < len(chunk):
                rate = done / max(time.time() - t0, 1)
                pct = f"{100.0 * done / total_i:.1f}%" if total_i else "?"
                print(f"[wiki] {done/1e9:.2f} GB ({pct}) @ {rate/1e6:.1f} MB/s")
    tmp.replace(dest)
    print(f"[wiki] downloaded {dest.stat().st_size} bytes")


def extract_sentences(dump_path: Path, out_path: Path, seen_path: Path | None = None) -> dict:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    seen: set[str] = set()
    if seen_path and seen_path.exists():
        # optional resume hash store not loaded fully to save RAM — use bloom-like size limit
        pass

    pages = 0
    kept_pages = 0
    sentences = 0
    skipped_redirect = 0
    skipped_ns = 0

    opener = bz2.open if str(dump_path).endswith(".bz2") else open
    with opener(dump_path, "rt", encoding="utf-8", errors="replace") as fp, open(
        out_path, "w", encoding="utf-8", newline="\n"
    ) as out:
        title = None
        ns = None
        text = None
        is_redirect = False
        for event, elem in iterparse(fp, events=("end",)):
            tag = localname(elem.tag)
            if tag == "title":
                title = (elem.text or "").strip()
            elif tag == "ns":
                ns = (elem.text or "").strip()
            elif tag == "redirect":
                is_redirect = True
            elif tag == "text":
                text = elem.text or ""
            elif tag == "page":
                pages += 1
                if is_redirect:
                    skipped_redirect += 1
                elif ns != "0":
                    skipped_ns += 1
                elif text and title:
                    # skip titles that look like lists-only? keep natural prose
                    body = strip_wiki_markup(text)
                    # drop category / file leftover lines
                    body = re.sub(r"(?m)^(分类|分類|Category)\s*:.*$", " ", body)
                    sents = split_sentences(body)
                    wrote = 0
                    for s in sents:
                        h = sha1_line(s)
                        if h in seen:
                            continue
                        seen.add(h)
                        out.write(s + "\n")
                        sentences += 1
                        wrote += 1
                    if wrote:
                        kept_pages += 1
                if pages % 5000 == 0:
                    print(
                        f"[wiki] pages={pages} kept_pages={kept_pages} sentences={sentences} uniq={len(seen)}"
                    )
                # reset
                title = None
                ns = None
                text = None
                is_redirect = False
                elem.clear()

    stats = {
        "pages": pages,
        "kept_pages": kept_pages,
        "skipped_redirect": skipped_redirect,
        "skipped_ns": skipped_ns,
        "sentences": sentences,
        "unique_hashes": len(seen),
        "out": str(out_path),
    }
    print("[wiki] done", stats)
    return stats


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument(
        "--dump",
        default=str(ROOT / "corpus" / "v1_raw" / "zhwiki-latest-pages-articles.xml.bz2"),
    )
    ap.add_argument(
        "--out",
        default=str(ROOT / "corpus" / "v1_raw" / "wikipedia_sentences.txt"),
    )
    ap.add_argument("--skip-download", action="store_true")
    args = ap.parse_args()
    dump = Path(args.dump)
    if not args.skip_download:
        download(args.url, dump)
    if not dump.exists():
        print("missing dump", dump, file=sys.stderr)
        return 1
    extract_sentences(dump, Path(args.out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
