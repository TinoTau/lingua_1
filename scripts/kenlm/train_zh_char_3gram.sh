#!/usr/bin/env bash
# Recover V2 Sentence KenLM — 中文字符级 3-gram 训练（WSL / Linux / macOS）
#
# 前置：KenLM 已编译，且 lmplz、build_binary 在 PATH 或 KENLM_BIN 下。
#   git clone https://github.com/kpu/kenlm && cd kenlm/build && cmake .. && cmake --build . -j
#   export KENLM_BIN="$PWD/bin"
#
# 用法（仓库根 lingua_1）：
#   bash scripts/kenlm/train_zh_char_3gram.sh
#   INPUT=/path/to/raw.txt bash scripts/kenlm/train_zh_char_3gram.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CORPUS_CHAR="${CORPUS_CHAR:-$REPO_ROOT/models/kenlm/corpus/corpus.char.txt}"
OUT_DIR="${OUT_DIR:-$REPO_ROOT/models/kenlm/zh_char_3gram}"
INPUT_RAW="${INPUT:-$REPO_ROOT/addons/char-lm/data/zh_sentences.txt}"

ARPA="$OUT_DIR/zh_char_3gram.arpa"
TRIE_BIN="$OUT_DIR/zh_char_3gram.trie.bin"
TRIE_TMP="/tmp/zh_char_3gram.trie.bin.$$"

if [ -n "${KENLM_BIN:-}" ]; then
  LMPLZ="$KENLM_BIN/lmplz"
  BUILD_BINARY="$KENLM_BIN/build_binary"
else
  LMPLZ="lmplz"
  BUILD_BINARY="build_binary"
fi

command -v python3 >/dev/null 2>&1 || { echo "python3 required" >&2; exit 1; }
command -v "$LMPLZ" >/dev/null 2>&1 || {
  echo "lmplz not found. Set KENLM_BIN or add KenLM build/bin to PATH." >&2
  exit 1
}
command -v "$BUILD_BINARY" >/dev/null 2>&1 || {
  echo "build_binary not found. Set KENLM_BIN or add KenLM build/bin to PATH." >&2
  exit 1
}

mkdir -p "$OUT_DIR" "$(dirname "$CORPUS_CHAR")"

echo "[kenlm-train] input raw: $INPUT_RAW"
python3 "$SCRIPT_DIR/build_char_corpus.py" --input "$INPUT_RAW" --output "$CORPUS_CHAR"

if [ ! -s "$CORPUS_CHAR" ]; then
  echo "Error: empty corpus: $CORPUS_CHAR" >&2
  exit 1
fi

echo "[kenlm-train] lmplz -o 3 ..."
"$LMPLZ" -o 3 -S 50% -T /tmp --text "$CORPUS_CHAR" --arpa "$ARPA"

echo "[kenlm-train] build_binary trie ..."
"$BUILD_BINARY" trie "$ARPA" "$TRIE_TMP"
mv -f "$TRIE_TMP" "$TRIE_BIN"

echo ""
echo "Done."
echo "  ARPA:      $ARPA"
echo "  Trie:      $TRIE_BIN"
echo ""
echo "Node / Electron（示例，按本机路径修改）："
echo "  export PROJECT_ROOT=\"$REPO_ROOT\""
echo "  export CHAR_LM_PATH=\"$TRIE_BIN\""
echo "  export KENLM_QUERY_PATH=\"\${KENLM_BIN:-/path/to/kenlm/build/bin}/query\""
