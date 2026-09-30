#!/usr/bin/env bash
set -euo pipefail
ROOT=/mnt/d/Programs/github/lingua_1
PY="$ROOT/kenLM/.venv/bin/python"
export HF_TOKEN="$(cat /mnt/c/Users/tinot/.cache/huggingface/token 2>/dev/null || true)"
export HUGGING_FACE_HUB_TOKEN="$HF_TOKEN"
cd "$ROOT"
mkdir -p kenLM/corpus/v1_raw
exec "$PY" -u kenLM/scripts/corpus_v1/sample_oscar_zh.py \
  --target 1000000 \
  --out kenLM/corpus/v1_raw/oscar_sentences.txt \
  2>&1 | tee kenLM/corpus/v1_raw/oscar_sample.log
