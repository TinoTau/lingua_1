#!/usr/bin/env bash
# OSCAR sample via HF mirror if hub.main is unreachable.
set -euo pipefail
ROOT=/mnt/d/Programs/github/lingua_1
PY="$ROOT/kenLM/.venv/bin/python"
if [ -z "${HF_TOKEN:-}" ]; then
  echo "HF_TOKEN required" >&2
  exit 2
fi
export HUGGING_FACE_HUB_TOKEN="$HF_TOKEN"
export HF_HUB_TOKEN="$HF_TOKEN"
# Prefer mirror when huggingface.co resets connections
export HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"
echo "[oscar] HF_ENDPOINT=$HF_ENDPOINT"
cd "$ROOT"
mkdir -p kenLM/corpus/v1_raw

"$PY" - <<'PY'
import os, time
from huggingface_hub import login, whoami, HfApi
token = os.environ["HF_TOKEN"]
for attempt in range(5):
    try:
        login(token=token, add_to_git_credential=False)
        print("whoami", whoami(token=token))
        break
    except Exception as e:
        print(f"login attempt {attempt+1} failed: {e}")
        time.sleep(3 + attempt * 2)
else:
    raise SystemExit("login failed")

api = HfApi(token=token, endpoint=os.environ.get("HF_ENDPOINT", "https://huggingface.co"))
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
