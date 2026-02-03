# -*- coding: utf-8 -*-
"""
从网上抓取中英文新闻文本，生成 KenLM 训练语料。仅输出新闻句，不补模板。

用法：
  python fetch_news_corpus.py [选项]
  选项：--no-articles  不抓新闻正文，仅用 RSS 标题+摘要（更快，但新闻句少）。

- 中文：RSS 多源 + 对部分条目抓取正文（需 pip install requests readability-lxml）。
- 英文：多 RSS 源。
输出：data/zh_sentences_large.txt、data/en_sentences_large.txt（行数由抓取结果决定，可能几万行）。
"""
import os
import re
import sys
import time

try:
    import feedparser
except ImportError:
    print("请先安装 feedparser: pip install feedparser", file=sys.stderr)
    sys.exit(1)

try:
    import requests
except ImportError:
    requests = None

try:
    from readability import Document
except ImportError:
    Document = None

# 中文新闻 RSS
ZH_RSS_URLS = [
    "http://www.xinhuanet.com/politics/news_politics.xml",
    "http://www.xinhuanet.com/world/news_world.xml",
    "http://www.xinhuanet.com/local/news_province.xml",
    "http://www.xinhuanet.com/finance/news_finance.xml",
    "http://www.xinhuanet.com/fortune/news_fortune.xml",
    "http://www.xinhuanet.com/mil/news_mil.xml",
    "http://www.xinhuanet.com/legal/news_legal.xml",
    "http://www.xinhuanet.com/house/news_house.xml",
    "http://www.xinhuanet.com/overseas/news_overseas.xml",
    "https://www.chinanews.com.cn/rss/scroll-news.xml",
]

# 英文新闻 RSS
EN_RSS_URLS = [
    "https://feeds.bbci.co.uk/news/rss.xml",
    "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
    "https://www.theguardian.com/world/rss",
    "https://feeds.bbci.co.uk/news/world/rss.xml",
    "https://feeds.bbci.co.uk/news/business/rss.xml",
]

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")

ZH_FETCH_ARTICLE_MAX_ENTRIES = 150
FETCH_DELAY_SEC = 0.2


def strip_html(text):
    if not text:
        return ""
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"&nbsp;|&lt;|&gt;|&amp;|&quot;|&#?\w+;", " ", text)
    return " ".join(text.split())


def zh_sentences_from_text(text):
    if not text or not text.strip():
        return []
    text = strip_html(text)
    parts = re.split(r"([。！？])", text)
    out = []
    buf = ""
    for i, p in enumerate(parts):
        buf += p
        if p in "。！？" or (i == len(parts) - 1 and buf.strip()):
            s = buf.strip()
            if len(s) >= 2:
                out.append(s)
            buf = ""
    if buf.strip() and len(buf.strip()) >= 2:
        out.append(buf.strip())
    return out


def en_sentences_from_text(text):
    if not text or not text.strip():
        return []
    text = strip_html(text)
    parts = re.split(r"(?<=[.!?])\s+", text)
    out = []
    for s in parts:
        s = s.strip()
        if len(s) >= 3:
            out.append(s)
    return out


def fetch_article_text(url, timeout=10):
    if not requests or not Document:
        return []
    try:
        r = requests.get(url, timeout=timeout, headers={"User-Agent": "Mozilla/5.0 (compatible; KenLM-corpus/1.0)"})
        r.raise_for_status()
        r.encoding = r.apparent_encoding or "utf-8"
        doc = Document(r.text)
        html = doc.summary()
        text = strip_html(html)
        if not text or len(text) < 10:
            return []
        return zh_sentences_from_text(text)
    except Exception:
        return []


def fetch_feed(url, lang, fetch_articles_for_zh=False, max_article_entries=0):
    lines = []
    try:
        d = feedparser.parse(url, request_headers={"User-Agent": "Mozilla/5.0 (compatible; KenLM-corpus/1.0)"})
    except Exception as e:
        print(f"  [skip] {url}: {e}", file=sys.stderr)
        return lines
    if getattr(d, "bozo", False) and not d.entries:
        print(f"  [skip] {url}: parse error", file=sys.stderr)
        return lines
    article_count = 0
    for e in d.entries:
        title = getattr(e, "title", "") or ""
        summary = getattr(e, "summary", "") or getattr(e, "description", "") or ""
        full = f"{title}。{summary}" if lang == "zh" else f"{title}. {summary}"
        if lang == "zh":
            lines.extend(zh_sentences_from_text(full))
        else:
            lines.extend(en_sentences_from_text(full))
        if lang == "zh" and fetch_articles_for_zh and max_article_entries > 0 and article_count < max_article_entries:
            link = getattr(e, "link", "") or ""
            if link and link.startswith("http"):
                time.sleep(FETCH_DELAY_SEC)
                article_sentences = fetch_article_text(link)
                if article_sentences:
                    lines.extend(article_sentences)
                    article_count += 1
                    if article_count % 20 == 0:
                        print(f"    fetched {article_count} articles, +{len(article_sentences)} sentences")
    return lines


def fetch_zh_news(fetch_articles=True, max_article_entries=ZH_FETCH_ARTICLE_MAX_ENTRIES):
    all_lines = []
    per_feed = max(5, max_article_entries // len(ZH_RSS_URLS)) if max_article_entries else 0
    for url in ZH_RSS_URLS:
        print(f"  Fetching ZH: {url[:65]}...")
        lines = fetch_feed(url, "zh", fetch_articles_for_zh=fetch_articles and bool(Document and requests), max_article_entries=per_feed)
        all_lines.extend(lines)
        print(f"    got {len(lines)} sentences, total {len(all_lines)}")
    return all_lines


def fetch_en_news():
    all_lines = []
    for url in EN_RSS_URLS:
        print(f"  Fetching EN: {url[:65]}...")
        lines = fetch_feed(url, "en")
        all_lines.extend(lines)
        print(f"    got {len(lines)} sentences, total {len(all_lines)}")
    return all_lines


def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    fetch_articles = True
    if len(sys.argv) > 1 and "--no-articles" in sys.argv:
        fetch_articles = False
    if fetch_articles and (not requests or not Document):
        print("Tip: pip install requests readability-lxml 可抓取新闻正文，增加新闻句数。", file=sys.stderr)

    print("Fetching Chinese news (RSS + article content)...")
    zh_lines = fetch_zh_news(fetch_articles=fetch_articles)
    zh_path = os.path.join(DATA_DIR, "zh_sentences_large.txt")
    with open(zh_path, "w", encoding="utf-8") as f:
        for line in zh_lines:
            f.write(line.strip() + "\n")
    print(f"ZH: {len(zh_lines)} lines -> {zh_path} ({os.path.getsize(zh_path) / (1024*1024):.2f} MB)")

    print("Fetching English news...")
    en_lines = fetch_en_news()
    en_path = os.path.join(DATA_DIR, "en_sentences_large.txt")
    with open(en_path, "w", encoding="utf-8") as f:
        for line in en_lines:
            f.write(line.strip() + "\n")
    print(f"EN: {len(en_lines)} lines -> {en_path} ({os.path.getsize(en_path) / (1024*1024):.2f} MB)")
    print("Done. Run train_all_kenlm.ps1 (or train_zh_large.sh / train_en_large.sh in WSL) to train.")


if __name__ == "__main__":
    main()
