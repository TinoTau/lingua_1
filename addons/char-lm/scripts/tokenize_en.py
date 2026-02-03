# -*- coding: utf-8 -*-
"""
英文语料按词 tokenize：小写、按空格分词，用于 KenLM 词级训练。
"""
import sys
import os

def tokenize_line(line: str) -> str:
    t = line.strip()
    if not t:
        return ""
    # 简单按空格和标点分词，保留字母数字，小写
    out = []
    for w in t.replace(".", " . ").replace("?", " ? ").replace("!", " ! ").replace(",", " , ").split():
        w = w.lower()
        if w:
            out.append(w)
    return " ".join(out)

def main():
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    src = os.path.join(base, "data", "en_sentences_large.txt")
    dst = os.path.join(base, "data", "en_word_tokenized.txt")
    if not os.path.exists(src):
        print(f"Error: {src} not found", file=sys.stderr)
        sys.exit(1)
    count = 0
    with open(src, "r", encoding="utf-8") as f_in, open(dst, "w", encoding="utf-8") as f_out:
        for line in f_in:
            t = tokenize_line(line)
            if t:
                f_out.write(t + "\n")
                count += 1
    print(f"Wrote {dst} ({count} lines)")

if __name__ == "__main__":
    main()
