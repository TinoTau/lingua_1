#!/usr/bin/env bash
set -euo pipefail
ROOT=/mnt/d/Programs/github/lingua_1
PY="$ROOT/kenLM/.venv/bin/python"
cd "$ROOT"
mkdir -p kenLM/corpus/v1_raw
# Prefer first mirror if primary is slow; urllib uses DEFAULT_URL unless overridden
export PYTHONUNBUFFERED=1
# Download shard pack from latest dump (still "latest"), then full if needed.
# Primary: full articles dump.
URL="${WIKI_URL:-https://dumps.wikimedia.org/zhwiki/latest/zhwiki-latest-pages-articles.xml.bz2}"
# Fallback mirror
# URL=https://mirror.accum.se/mirror/wikimedia.org/dumps/zhwiki/latest/zhwiki-latest-pages-articles.xml.bz2
exec "$PY" -u kenLM/scripts/corpus_v1/build_wikipedia_sentences.py \
  --url "$URL" \
  --dump kenLM/corpus/v1_raw/zhwiki-latest-pages-articles.xml.bz2 \
  --out kenLM/corpus/v1_raw/wikipedia_sentences.txt \
  2>&1 | tee kenLM/corpus/v1_raw/wikipedia_build.log
