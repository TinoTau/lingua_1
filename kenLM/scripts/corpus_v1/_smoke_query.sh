#!/usr/bin/env bash
set -euo pipefail
QUERY=/mnt/d/Programs/github/lingua_1/kenLM/kenlm/build/bin/query
MODEL=/mnt/d/Programs/github/lingua_1/kenLM/model/corpus_v1/zh_char_3gram.trie.bin
# char-tokenized "你好世界"
printf '%s\n' '你 好 世 界' | "$QUERY" -v summary "$MODEL"
