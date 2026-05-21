#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""下载中文新闻语料到 kenLM/corpus（包装 addons/char-lm/download_corpus.py）"""
import os
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
KENLM_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
CORPUS_DIR = os.path.join(KENLM_ROOT, 'corpus')
OUT = os.path.join(CORPUS_DIR, 'zh_sentences.raw.txt')

os.makedirs(CORPUS_DIR, exist_ok=True)

src = os.path.join(ROOT, 'addons', 'char-lm', 'scripts', 'download_corpus.py')
if not os.path.isfile(src):
    print(f'Missing {src}', file=sys.stderr)
    sys.exit(1)

print('Downloading Chinese news corpus to', OUT)
rc = subprocess.call([sys.executable, src, '--out', OUT], cwd=os.path.dirname(src))
if rc != 0:
    sys.exit(rc)

if os.path.isfile(OUT):
    with open(OUT, 'r', encoding='utf-8') as f:
        n = sum(1 for line in f if line.strip())
    print(f'Corpus ready: {n} lines -> {OUT}')
else:
    print('Download failed: no output file', file=sys.stderr)
    sys.exit(1)
