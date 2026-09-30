#!/usr/bin/env bash
# Usage: HF_TOKEN=... bash run_oscar_with_token.sh
# Token must be provided via environment — never commit.
set -euo pipefail
ROOT=/mnt/d/Programs/github/lingua_1
PY="$ROOT/kenLM/.venv/bin/python"
if [ -z "${HF_TOKEN:-}" ]; then
  echo "HF_TOKEN required" >&2
  exit 2
fi
export HUGGING_FACE_HUB_TOKEN="$HF_TOKEN"
export HF_HUB_TOKEN="$HF_TOKEN"
cd "$ROOT"
mkdir -p kenLM/corpus/v1_raw
"$PY" - <<'PY'
import os
from huggingface_hub import login, whoami, HfApi
login(token=os.environ["HF_TOKEN"], add_to_git_credential=False)
print("whoami", whoami())
api = HfApi(token=os.environ["HF_TOKEN"])
for ds in ("oscar-corpus/OSCAR-2301", "oscar-corpus/OSCAR-2201", "oscar"):
    try:
        info = api.dataset_info(ds)
        print(f"OK {ds} gated={getattr(info, 'gated', None)}")
    except Exception as e:
        print(f"FAIL {ds}: {e}")
PY
exec "$PY" -u kenLM/scripts/corpus_v1/sample_oscar_zh.py \
  --target 1000000 \
  --out kenLM/corpus/v1_raw/oscar_sentences.txt \
  2>&1 | tee kenLM/corpus/v1_raw/oscar_sample.log
