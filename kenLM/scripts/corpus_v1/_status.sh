#!/usr/bin/env bash
set -euo pipefail
RAW=/mnt/d/Programs/github/lingua_1/kenLM/corpus/v1_raw
echo "=== v1_raw ==="
ls -lh "$RAW" 2>/dev/null || echo missing
echo "=== linecounts ==="
wc -l "$RAW/wikipedia_sentences.txt" 2>/dev/null || echo no_wiki_sents
wc -l "$RAW/oscar_sentences.txt" 2>/dev/null || echo no_oscar_sents
echo "=== dump size ==="
ls -lh "$RAW"/zhwiki-latest-pages-articles.xml.bz2* 2>/dev/null || echo no_dump
echo "=== model ==="
ls -lh /mnt/d/Programs/github/lingua_1/kenLM/model/corpus_v1 2>/dev/null || echo no_model
echo "=== processes ==="
ps aux | grep -E 'curl|wikipedia|oscar|lmplz|sample_oscar|build_wikipedia' | grep -v grep || echo none
