#!/usr/bin/env bash
# Corpus V1 = Wikipedia only (OSCAR abandoned by operator decision).
set -euo pipefail
ROOT=/mnt/d/Programs/github/lingua_1
PY="$ROOT/kenLM/.venv/bin/python"
RAW="$ROOT/kenLM/corpus/v1_raw/wikipedia_sentences.txt"
export PYTHONUNBUFFERED=1

echo "[v1] merge wikipedia-only corpus..."
"$PY" -u "$ROOT/kenLM/scripts/corpus_v1/merge_corpus_v1.py" \
  --wiki "$RAW" \
  --oscar /dev/null \
  --raw-out "$ROOT/kenLM/corpus/v1/corpus_v1.raw.txt" \
  --char-out "$ROOT/kenLM/corpus/v1/corpus_v1.char.txt" \
  --stats-out "$ROOT/kenLM/corpus/v1/corpus_v1.stats.json" \
  2>&1 | tee "$ROOT/kenLM/corpus/v1/merge.log" || true
