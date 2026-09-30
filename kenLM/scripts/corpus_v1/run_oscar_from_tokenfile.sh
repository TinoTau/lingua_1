#!/usr/bin/env bash
set -euo pipefail
ROOT=/mnt/d/Programs/github/lingua_1
PY="$ROOT/kenLM/.venv/bin/python"
TOKEN_FILE="${1:-/tmp/hf_token_corpus_v1.txt}"
if [ ! -s "$TOKEN_FILE" ]; then
  echo "missing token file $TOKEN_FILE" >&2
  exit 2
fi
export HF_TOKEN="$(tr -d '\r\n' < "$TOKEN_FILE")"
export HUGGING_FACE_HUB_TOKEN="$HF_TOKEN"
export HF_HUB_TOKEN="$HF_TOKEN"
# Official hub (mirror rejected this token)
unset HF_ENDPOINT || true
echo "[oscar] token_len=${#HF_TOKEN} prefix=${HF_TOKEN:0:5}"
cd "$ROOT"
mkdir -p kenLM/corpus/v1_raw

"$PY" - <<'PY'
import os, time
from huggingface_hub import whoami, HfApi
token = os.environ["HF_TOKEN"].strip()
print("token_len", len(token))
for attempt in range(8):
    try:
        info = whoami(token=token)
        print("whoami", info.get("name"), info.get("fullname"))
        break
    except Exception as e:
        print(f"whoami attempt {attempt+1}: {type(e).__name__}: {e}")
        time.sleep(2 + attempt)
else:
    raise SystemExit(2)

api = HfApi(token=token)
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
