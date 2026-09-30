#!/usr/bin/env bash
set -euo pipefail
PY=/mnt/d/Programs/github/lingua_1/kenLM/.venv/bin/python
export HF_TOKEN="$(cat /mnt/c/Users/tinot/.cache/huggingface/token 2>/dev/null || true)"
"$PY" -c 'import datasets,sys; print(sys.executable, datasets.__version__)'
echo "--- curl wiki ---"
curl -I -L --max-time 25 "https://dumps.wikimedia.org/zhwiki/latest/zhwiki-latest-pages-articles1.xml-p1p187712.bz2" | head -15 || true
echo "--- curl mirror ---"
curl -I -L --max-time 25 "https://mirror.accum.se/mirror/wikimedia.org/dumps/zhwiki/latest/zhwiki-latest-pages-articles1.xml-p1p187712.bz2" | head -15 || true
