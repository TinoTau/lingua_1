#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""将原始语料归一化：去空行、NFKC、UTF-8 输出。"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from lib.tokenize_char import normalize_line  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description='Normalize raw KenLM corpus lines')
    parser.add_argument('--input', required=True, help='Raw UTF-8 text, one sentence per line')
    parser.add_argument('--output', required=True, help='Normalized lines')
    args = parser.parse_args()

    inp = Path(args.input)
    out = Path(args.output)
    if not inp.is_file():
        print(f'Error: input not found: {inp}', file=sys.stderr)
        return 1

    out.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with inp.open('r', encoding='utf-8') as f_in, out.open('w', encoding='utf-8') as f_out:
        for line in f_in:
            t = normalize_line(line)
            if not t:
                continue
            f_out.write(t + '\n')
            count += 1
    print(f'Wrote {out} ({count} lines)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
