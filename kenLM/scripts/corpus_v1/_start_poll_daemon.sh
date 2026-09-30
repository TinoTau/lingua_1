#!/usr/bin/env bash
set -euo pipefail
printf %s "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" > /tmp/hf_token_corpus_v1.txt
chmod 600 /tmp/hf_token_corpus_v1.txt
LOG=/mnt/d/Programs/github/lingua_1/kenLM/corpus/v1_raw/oscar_poll.log
nohup bash /mnt/d/Programs/github/lingua_1/kenLM/scripts/corpus_v1/poll_oscar_then_sample.sh >> "$LOG" 2>&1 &
echo $! > /tmp/oscar_poll.pid
echo "started pid=$(cat /tmp/oscar_poll.pid)"
sleep 3
tail -5 "$LOG"
