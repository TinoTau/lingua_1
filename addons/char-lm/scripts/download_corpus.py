# -*- coding: utf-8 -*-
"""
从 Hugging Face 下载中文/英文语料，按句写入 data/zh_sentences_large.txt 或 en。
无需爬虫，直接下载现成语料。依赖：pip install datasets

用法：
  python download_corpus.py              # 下载中文新闻摘要数据集，写入 zh_sentences_large.txt
  python download_corpus.py --append     # 追加到已有文件
  python download_corpus.py --out zh_my.txt  # 指定输出文件
"""
import json
import os
import re
import sys

# 避免本仓库 scripts/ 下的 tokenize.py 遮蔽标准库 tokenize，导致 datasets/pandas 报错
_script_dir = os.path.dirname(os.path.abspath(__file__))
while _script_dir in sys.path:
    sys.path.remove(_script_dir)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")


def zh_sentences_from_text(text):
    """按 。！？ 分句。"""
    if not text or not text.strip():
        return []
    text = re.sub(r"\s+", " ", text).strip()
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
    """按 . ! ? 分句，保留句末标点。"""
    if not text or not text.strip():
        return []
    text = re.sub(r"\s+", " ", text).strip()
    parts = re.split(r"(?<=[.!?])\s+", text)
    out = []
    for s in parts:
        s = s.strip()
        if len(s) >= 3:
            out.append(s)
    return out


def download_chinese_news_summary(append=False, out_path=None):
    """下载 feilongfl/ChineseNewsSummary，按句写入文件。"""
    try:
        from datasets import load_dataset
    except ImportError:
        print("请先安装: pip install datasets", file=sys.stderr)
        sys.exit(1)
    out_path = out_path or os.path.join(DATA_DIR, "zh_sentences_large.txt")
    os.makedirs(DATA_DIR, exist_ok=True)
    mode = "a" if append else "w"
    existing = set()
    if append and os.path.isfile(out_path):
        with open(out_path, "r", encoding="utf-8") as f:
            existing = set(line.strip() for line in f if line.strip())
    print("Loading feilongfl/ChineseNewsSummary from Hugging Face...")
    ds = load_dataset("feilongfl/ChineseNewsSummary", split="train")
    lines = []
    for row in ds:
        # 列名为 instruction / input / output；output 为 JSON 含 title、summary
        out_raw = (row.get("output") or "").strip()
        title, summary = "", ""
        if out_raw:
            try:
                obj = json.loads(out_raw)
                title = (obj.get("title") or "").strip()
                summary = (obj.get("summary") or "").strip()
            except (json.JSONDecodeError, TypeError):
                summary = out_raw
        if title and title not in existing:
            lines.append(title)
            existing.add(title)
        for s in zh_sentences_from_text(summary):
            if s not in existing:
                lines.append(s)
                existing.add(s)
        # input 列为新闻正文，可再分句以增加语料量
        inp = (row.get("input") or "").strip()
        if inp and len(inp) > 50:
            for s in zh_sentences_from_text(inp):
                if len(s) >= 4 and s not in existing:
                    lines.append(s)
                    existing.add(s)
    with open(out_path, mode, encoding="utf-8") as f:
        for line in lines:
            f.write(line + "\n")
    print(f"Wrote {len(lines)} lines -> {out_path} ({os.path.getsize(out_path) / (1024*1024):.2f} MB)")
    return len(lines)


def download_english_news(append=False, out_path=None):
    """下载 ag_news 英文新闻，按句写入 en_sentences_large.txt。"""
    try:
        from datasets import load_dataset
    except ImportError:
        print("请先安装: pip install datasets", file=sys.stderr)
        sys.exit(1)
    out_path = out_path or os.path.join(DATA_DIR, "en_sentences_large.txt")
    os.makedirs(DATA_DIR, exist_ok=True)
    mode = "a" if append else "w"
    existing = set()
    if append and os.path.isfile(out_path):
        with open(out_path, "r", encoding="utf-8") as f:
            existing = set(line.strip() for line in f if line.strip())
    print("Loading ag_news (English) from Hugging Face...")
    ds = load_dataset("ag_news", split="train")
    lines = []
    for row in ds:
        text = (row.get("text") or "").strip()
        if not text:
            continue
        text = re.sub(r"[\n\\]+", " ", text)
        for s in en_sentences_from_text(text):
            if s not in existing:
                lines.append(s)
                existing.add(s)
    with open(out_path, mode, encoding="utf-8") as f:
        for line in lines:
            f.write(line + "\n")
    print(f"Wrote {len(lines)} lines -> {out_path} ({os.path.getsize(out_path) / (1024*1024):.2f} MB)")
    return len(lines)


def main():
    append = "--append" in sys.argv
    en_only = "--en" in sys.argv
    out_path = None
    for i, arg in enumerate(sys.argv):
        if arg == "--out" and i + 1 < len(sys.argv):
            out_path = sys.argv[i + 1]
            break
    if en_only:
        n = download_english_news(append=append, out_path=out_path)
        print(f"Done. Total {n} sentences. Run train_en_large.sh in WSL to train.")
    else:
        n = download_chinese_news_summary(append=append, out_path=out_path)
        print(f"Done. Total {n} sentences. Run train_zh_large.sh in WSL to train.")


if __name__ == "__main__":
    main()
