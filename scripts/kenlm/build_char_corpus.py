#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""归一化 + 字符级 tokenize，生成 KenLM 训练用 corpus.char.txt。"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from lib.tokenize_char import normalize_line, tokenize_line  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description='Build char-level tokenized corpus for KenLM')
    parser.add_argument(
        '--input',
        help='Raw corpus (default: repo addons/char-lm/data/zh_sentences.txt)',
    )
    parser.add_argument(
        '--output',
        help='Tokenized output (default: models/kenlm/corpus/corpus.char.txt)',
    )
    args = parser.parse_args()

    repo_root = SCRIPT_DIR.parent.parent
    inp = Path(args.input) if args.input else repo_root / 'addons' / 'char-lm' / 'data' / 'zh_sentences.txt'
    out = (
        Path(args.output)
        if args.output
        else repo_root / 'models' / 'kenlm' / 'corpus' / 'corpus.char.txt'
    )

    if not inp.is_file():
        print(f'Error: input not found: {inp}', file=sys.stderr)
        print('Provide --input or add addons/char-lm/data/zh_sentences.txt', file=sys.stderr)
        return 1

    out.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with inp.open('r', encoding='utf-8') as f_in, out.open('w', encoding='utf-8') as f_out:
        for line in f_in:
            norm = normalize_line(line)
            if not norm:
                continue
            tok = tokenize_line(norm)
            if not tok:
                continue
            f_out.write(tok + '\n')
            count += 1
    print(f'Wrote {out} ({count} lines)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
