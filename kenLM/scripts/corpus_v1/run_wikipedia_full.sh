#!/usr/bin/env bash
# Download full latest zhwiki pages-articles dump via curl, then extract sentences.
set -euo pipefail
ROOT=/mnt/d/Programs/github/lingua_1
RAW="$ROOT/kenLM/corpus/v1_raw"
PY="$ROOT/kenLM/.venv/bin/python"
BASE="https://dumps.wikimedia.org/zhwiki/latest"
FILE="zhwiki-latest-pages-articles.xml.bz2"
mkdir -p "$RAW"
export PYTHONUNBUFFERED=1
cd "$RAW"
rm -f "${FILE}.part" || true
echo "[wiki] curl download $FILE"
curl -L --retry 8 --retry-delay 10 -C - -o "$FILE" "$BASE/$FILE"
ls -lh "$FILE"
echo "[wiki] extract sentences..."
"$PY" -u "$ROOT/kenLM/scripts/corpus_v1/build_wikipedia_sentences.py" \
  --skip-download \
  --dump "$RAW/$FILE" \
  --out "$RAW/wikipedia_sentences.txt" \
  2>&1 | tee "$RAW/wikipedia_build.log"
wc -l "$RAW/wikipedia_sentences.txt" | tee "$RAW/wikipedia_linecount.txt"
echo "[wiki] DONE"
