# -*- coding: utf-8 -*-
"""
字符级 tokenize：与 KenLM 训练/推理一致。汉字、字母数字、保留标点，空格分隔。
"""
import sys
import os

# 保留标点（与节点端 char-tokenize.ts 一致）
KEEP_PUNCT = set('，。！？；：、""\'\'（）()《》<>【】[]—-…·,.!?;:"\'')


def tokenize(line: str) -> str:
    line = line.strip()
    if not line:
        return ''
    out = []
    for ch in line:
        if '\u4e00' <= ch <= '\u9fff':
            out.append(ch)
        elif ch.isalnum():
            out.append(ch)
        elif ch in KEEP_PUNCT:
            out.append(ch)
    return ' '.join(out)


def main():
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    # 支持可选参数：tokenize.py [src文件名] [dst文件名]，均在 data/ 下
    src = os.path.join(base, "data", sys.argv[1] if len(sys.argv) > 1 else "zh_sentences.txt")
    dst = os.path.join(base, "data", sys.argv[2] if len(sys.argv) > 2 else "zh_char_tokenized.txt")
    if not os.path.exists(src):
        print(f'Error: {src} not found', file=sys.stderr)
        sys.exit(1)
    count = 0
    with open(src, 'r', encoding='utf-8') as f_in, open(dst, 'w', encoding='utf-8') as f_out:
        for line in f_in:
            t = tokenize(line)
            if t:
                f_out.write(t + '\n')
                count += 1
    print(f'Wrote {dst} ({count} lines)')


if __name__ == '__main__':
    main()
