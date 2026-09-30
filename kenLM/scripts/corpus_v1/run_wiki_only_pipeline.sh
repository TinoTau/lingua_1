#!/usr/bin/env bash
# Full Wikipedia-only Corpus V1: merge → train
set -euo pipefail
ROOT=/mnt/d/Programs/github/lingua_1
PY="$ROOT/kenLM/.venv/bin/python"
export PYTHONUNBUFFERED=1

echo "[v1] merge wikipedia-only..."
"$PY" -u "$ROOT/kenLM/scripts/corpus_v1/merge_corpus_v1.py" --wiki-only \
  2>&1 | tee "$ROOT/kenLM/corpus/v1/merge.log"

echo "[v1] train kenlm..."
bash "$ROOT/kenLM/scripts/corpus_v1/train_corpus_v1.sh" \
  2>&1 | tee -a "$ROOT/kenLM/model/corpus_v1/pipeline.log"

echo "[v1] PIPELINE_DONE"
ls -lh "$ROOT/kenLM/corpus/v1" "$ROOT/kenLM/model/corpus_v1"
