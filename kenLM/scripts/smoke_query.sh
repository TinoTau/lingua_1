#!/usr/bin/env bash
set -euo pipefail
KENLM_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$KENLM_ROOT/.." && pwd)"
export CHAR_LM_PATH="${CHAR_LM_PATH:-$KENLM_ROOT/model/zh_char_3gram.trie.bin}"
export KENLM_QUERY_PATH="${KENLM_QUERY_PATH:-$KENLM_ROOT/kenlm/build/bin/query}"
PYTHON="${KENLM_ROOT}/.venv/bin/python"
[ -x "$PYTHON" ] || PYTHON=python3
LINE=$("$PYTHON" -c "
import sys
sys.path.insert(0, '$REPO_ROOT/scripts/kenlm')
from lib.tokenize_char import tokenize_line
print(tokenize_line('我们要做候选生成'))
")
echo "stdin: $LINE"
echo "$LINE" | "$KENLM_QUERY_PATH" "$CHAR_LM_PATH" | head -3
