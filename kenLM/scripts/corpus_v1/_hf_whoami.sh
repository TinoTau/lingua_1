#!/usr/bin/env bash
set -euo pipefail
PY=/mnt/d/Programs/github/lingua_1/kenLM/.venv/bin/python
export HF_TOKEN="$(cat /mnt/c/Users/tinot/.cache/huggingface/token)"
"$PY" - <<'PY'
from huggingface_hub import whoami, HfApi
import os
token=os.environ["HF_TOKEN"]
print(whoami(token=token))
api=HfApi(token=token)
try:
    api.dataset_info("oscar-corpus/OSCAR-2301")
    print("OSCAR-2301 accessible")
except Exception as e:
    print("OSCAR-2301 not accessible:", e)
PY
echo "--- gitee probe ---"
curl -I -L --max-time 30 "https://gitee.com/hf-datasets/OSCAR-2301" | head -20 || true
curl -I -L --max-time 30 "https://gitee.com/hf-datasets/OSCAR-2301/raw/main/zh_meta/zh_meta_part_1.jsonl.zst" | head -20 || true
