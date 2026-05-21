#!/usr/bin/env bash
# 对已训练的 trie 模型跑一条 query smoke（需 query 在 PATH 或 KENLM_QUERY_PATH）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TRIE="${CHAR_LM_PATH:-$REPO_ROOT/models/kenlm/zh_char_3gram/zh_char_3gram.trie.bin}"
QUERY="${KENLM_QUERY_PATH:-query}"

if [ ! -f "$TRIE" ]; then
  echo "Skip: trie not found: $TRIE" >&2
  echo "Train first: bash scripts/kenlm/train_zh_char_3gram.sh" >&2
  exit 0
fi

LINE=$(python3 -c "
import sys
sys.path.insert(0, '$SCRIPT_DIR')
from lib.tokenize_char import tokenize_line
print(tokenize_line('我们要做候选生成'))
")
echo "stdin: $LINE"
echo "$LINE" | "$QUERY" "$TRIE" | head -n 3
