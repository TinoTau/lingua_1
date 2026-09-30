#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Shared Chinese sentence cleaning for KenLM Corpus V1."""
from __future__ import annotations

import hashlib
import re
import unicodedata

URL_RE = re.compile(r"https?://\S+|www\.\S+", re.I)
HTML_RE = re.compile(r"<[^>]+>")
WIKI_LINK_RE = re.compile(r"\[\[[^\]]*\|([^\]]+)\]\]|\[\[([^\]]+)\]\]")
WIKI_FILE_RE = re.compile(r"\[\[(?:File|Image|文件|档案|圖片|图片):[^\]]*\]\]", re.I)
WIKI_CAT_RE = re.compile(r"\[\[(?:Category|分类|分類):[^\]]*\]\]", re.I)
WIKI_TEMPLATE_RE = re.compile(r"\{\{[^{}]*\}\}")
REF_RE = re.compile(r"<ref[^>]*>.*?</ref>|<ref[^/]*/>", re.I | re.S)
TABLE_ROW_RE = re.compile(r"^\s*[|!].*$", re.M)
MULTI_WS = re.compile(r"\s+")
SENT_SPLIT_RE = re.compile(r"(?<=[。！？；!?])")
NON_CN_JUNK = re.compile(r"[\u0000-\u0008\u000b\u000c\u000e-\u001f]")

MIN_CHARS = 4
MAX_CHARS = 256


def nfkc(s: str) -> str:
    return unicodedata.normalize("NFKC", s or "")


def strip_wiki_markup(text: str) -> str:
    t = text or ""
    t = REF_RE.sub(" ", t)
    t = HTML_RE.sub(" ", t)
    # repeatedly strip simple templates
    for _ in range(8):
        n = WIKI_TEMPLATE_RE.sub(" ", t)
        if n == t:
            break
        t = n
    t = WIKI_FILE_RE.sub(" ", t)
    t = WIKI_CAT_RE.sub(" ", t)
    t = WIKI_LINK_RE.sub(lambda m: m.group(1) or m.group(2) or "", t)
    t = TABLE_ROW_RE.sub(" ", t)
    t = URL_RE.sub(" ", t)
    t = t.replace("'''", "").replace("''", "")
    t = NON_CN_JUNK.sub(" ", t)
    t = MULTI_WS.sub(" ", t)
    return t.strip()


def chinese_char_count(s: str) -> int:
    return sum(1 for ch in s if "\u4e00" <= ch <= "\u9fff")


def looks_garbled(s: str) -> bool:
    if not s:
        return True
    # too many replacement / private-use / weird symbols
    bad = sum(1 for ch in s if ord(ch) in (0xFFFD,) or "\ue000" <= ch <= "\uf8ff")
    if bad >= 2:
        return True
    # low Chinese ratio for supposedly Chinese sentence
    cn = chinese_char_count(s)
    if cn < 4:
        return True
    if cn / max(len(s), 1) < 0.35:
        return True
    # ad-ish patterns
    low = s.lower()
    for kw in ("点击领取", "免费下载", "加微信", "淘宝券", "优惠券", "广告招商"):
        if kw in s:
            return True
    if "javascript:" in low or "onclick=" in low:
        return True
    return False


def clean_sentence(s: str) -> str | None:
    t = nfkc(s)
    t = URL_RE.sub(" ", t)
    t = HTML_RE.sub(" ", t)
    t = MULTI_WS.sub(" ", t).strip()
    t = t.strip(" \t\r\n\"'`")
    if not t:
        return None
    # length by unicode chars (spaces removed for length gate)
    compact = re.sub(r"\s+", "", t)
    n = len(compact)
    if n < MIN_CHARS or n > MAX_CHARS:
        return None
    if looks_garbled(t):
        return None
    return t


def split_sentences(text: str) -> list[str]:
    text = MULTI_WS.sub(" ", text or "").strip()
    if not text:
        return []
    parts = SENT_SPLIT_RE.split(text)
    out: list[str] = []
    buf = ""
    for p in parts:
        if not p:
            continue
        if p[-1:] in "。！？；!?":
            cand = (buf + p).strip()
            buf = ""
            c = clean_sentence(cand)
            if c:
                out.append(c)
        else:
            buf += p
    if buf.strip():
        c = clean_sentence(buf.strip())
        if c:
            out.append(c)
    return out


def sha1_line(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()
