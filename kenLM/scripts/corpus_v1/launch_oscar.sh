#!/usr/bin/env bash
# Launcher: reads token from first argument or HF_TOKEN env (not stored in repo).
set -euo pipefail
if [ -n "${1:-}" ]; then
  export HF_TOKEN="$1"
fi
exec bash /mnt/d/Programs/github/lingua_1/kenLM/scripts/corpus_v1/run_oscar_with_token.sh
