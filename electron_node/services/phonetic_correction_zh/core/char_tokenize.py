# -*- coding: utf-8 -*-
"""字符级 tokenize，与 KenLM 训练一致：CJK + 字母数字 + 保留标点，空格分隔。"""

KEEP_PUNCT = set("，。！？；：、""''（）()《》<>【】[]—-…·,.!?;:\"'")


def tokenize_for_lm(text: str) -> str:
    t = text.strip()
    if not t:
        return ""
    out = []
    for ch in t:
        if "\u4e00" <= ch <= "\u9fff":
            out.append(ch)
        elif ch.isalnum():
            out.append(ch)
        elif ch in KEEP_PUNCT:
            out.append(ch)
    return " ".join(out)
