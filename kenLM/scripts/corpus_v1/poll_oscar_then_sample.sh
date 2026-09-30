#!/usr/bin/env bash
# Poll HF until OSCAR-2301 download is allowed, then sample.
set -euo pipefail
TOKEN="$(tr -d '\r\n' < /tmp/hf_token_corpus_v1.txt)"
for i in $(seq 1 60); do
  code=$(curl -s -o /tmp/oscar_probe_body.txt -w "%{http_code}" \
    -H "Authorization: Bearer $TOKEN" \
    "https://huggingface.co/datasets/oscar-corpus/OSCAR-2301/resolve/main/zh_meta/zh_meta_part_1.jsonl.zst" || true)
  echo "[poll $i] http=$code"
  if [ "$code" = "200" ] || [ "$code" = "302" ]; then
    echo "ACCESS_GRANTED"
    exec bash /mnt/d/Programs/github/lingua_1/kenLM/scripts/corpus_v1/sample_oscar_parts.sh
  fi
  head -c 200 /tmp/oscar_probe_body.txt; echo
  sleep 60
done
echo "STILL_PENDING after 60 minutes"
exit 3
