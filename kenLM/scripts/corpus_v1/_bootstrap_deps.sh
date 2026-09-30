#!/usr/bin/env bash
set -euo pipefail
TOKEN_C="/mnt/c/Users/tinot/.cache/huggingface/token"
TOKEN_H="$HOME/.cache/huggingface/token"
if [ -f "$TOKEN_C" ]; then echo "token_c=$(wc -c < "$TOKEN_C")"; export HF_TOKEN="$(cat "$TOKEN_C")"; fi
if [ -f "$TOKEN_H" ]; then echo "token_h=$(wc -c < "$TOKEN_H")"; export HF_TOKEN="$(cat "$TOKEN_H")"; fi
PY=/mnt/d/Programs/github/lingua_1/kenLM/.venv/bin/python
"$PY" -m pip -q install 'datasets>=2.14' 'huggingface_hub' 'mwparserfromhell' 'zstandard' 2>&1 | tail -20
"$PY" - <<'PY'
import os
print("HF_TOKEN set", bool(os.environ.get("HF_TOKEN")))
import datasets
print("datasets", datasets.__version__)
PY
