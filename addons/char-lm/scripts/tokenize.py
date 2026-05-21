# -*- coding: utf-8 -*-
"""
字符级 tokenize：委托仓库根 scripts/kenlm/lib（与 Node char-tokenize.ts 一致）。
"""
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, '..', '..', '..'))
sys.path.insert(0, os.path.join(REPO_ROOT, 'scripts', 'kenlm'))

from lib.tokenize_char import tokenize_line  # noqa: E402


def main():
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    src = os.path.join(base, 'data', sys.argv[1] if len(sys.argv) > 1 else 'zh_sentences.txt')
    dst = os.path.join(base, 'data', sys.argv[2] if len(sys.argv) > 2 else 'zh_char_tokenized.txt')
    if not os.path.exists(src):
        print(f'Error: {src} not found', file=sys.stderr)
        sys.exit(1)
    count = 0
    with open(src, 'r', encoding='utf-8') as f_in, open(dst, 'w', encoding='utf-8') as f_out:
        for line in f_in:
            t = tokenize_line(line)
            if t:
                f_out.write(t + '\n')
                count += 1
    print(f'Wrote {dst} ({count} lines)')


if __name__ == '__main__':
    main()
