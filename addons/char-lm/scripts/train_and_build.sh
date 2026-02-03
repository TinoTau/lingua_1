#!/usr/bin/env bash
# 字符级 LM 训练 + 剪裁 + 生成 trie.bin（在 WSL/Linux/macOS 下执行）
# 需先安装 KenLM: git clone https://github.com/kpu/kenlm && cd kenlm/build && cmake .. && make -j

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
DATA_DIR="$BASE_DIR/data"
MODELS_DIR="$BASE_DIR/models"
KENLM_BIN="${KENLM_BIN:-}"

mkdir -p "$MODELS_DIR"

# 1) Tokenize
if [ ! -f "$DATA_DIR/zh_sentences.txt" ]; then
  echo "Error: $DATA_DIR/zh_sentences.txt not found. Add corpus first." >&2
  exit 1
fi
python3 "$SCRIPT_DIR/tokenize.py"

# 2) lmplz (train + prune)
TOKENIZED="$DATA_DIR/zh_char_tokenized.txt"
ARPA="$MODELS_DIR/zh_char_3gram.arpa"
TRIE_BIN="$MODELS_DIR/zh_char_3gram.trie.bin"

if [ -n "$KENLM_BIN" ]; then
  LMPLZ="$KENLM_BIN/lmplz"
  BUILD_BINARY="$KENLM_BIN/build_binary"
else
  LMPLZ="lmplz"
  BUILD_BINARY="build_binary"
fi

# KenLM 的 build_binary 在 Windows 挂载路径上可能写失败，先写到 /tmp 再 cp
TRIE_TMP="/tmp/zh_char_3gram.trie.bin.$$"
cat "$TOKENIZED" | $LMPLZ -o 3 -S 50% -T /tmp --prune 0 0 1 > "$ARPA"

# 3) build_binary trie（先写 /tmp 再 mv，避免 WSL 挂载路径问题）
$BUILD_BINARY trie "$ARPA" "$TRIE_TMP" && mv "$TRIE_TMP" "$TRIE_BIN"

echo "Done. Model: $TRIE_BIN"
echo "Node: set CHAR_LM_PATH=$TRIE_BIN"
