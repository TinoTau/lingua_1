#!/usr/bin/env bash
# kenLM 目录：下载语料（若缺）→ 编译 KenLM → 训练 zh_char_3gram
set -euo pipefail

KENLM_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$KENLM_ROOT/.." && pwd)"
CORPUS_RAW="${CORPUS_RAW:-$KENLM_ROOT/corpus/zh_sentences.raw.txt}"
CORPUS_CHAR="$KENLM_ROOT/corpus/corpus.char.txt"
MODEL_DIR="$KENLM_ROOT/model"
ARPA="$MODEL_DIR/zh_char_3gram.arpa"
TRIE_BIN="$MODEL_DIR/zh_char_3gram.trie.bin"
KENLM_SRC="$KENLM_ROOT/kenlm"
KENLM_BUILD="$KENLM_SRC/build"

mkdir -p "$KENLM_ROOT/corpus" "$MODEL_DIR"

PYTHON="${PYTHON:-python3}"
VENV="$KENLM_ROOT/.venv"
if [ ! -x "$VENV/bin/python" ]; then
  echo "[kenLM] create venv $VENV"
  "$PYTHON" -m venv "$VENV"
  "$VENV/bin/pip" install -q datasets
  PYTHON="$VENV/bin/python"
elif [ -x "$VENV/bin/python" ]; then
  PYTHON="$VENV/bin/python"
fi

# --- 语料 ---
if [ ! -s "$CORPUS_RAW" ]; then
  echo "[kenLM] corpus missing, try download (python datasets)..."
  "$PYTHON" -m pip install -q datasets 2>/dev/null || "$VENV/bin/pip" install -q datasets
  "$PYTHON" "$KENLM_ROOT/scripts/download_corpus.py" || true
fi
if [ ! -s "$CORPUS_RAW" ]; then
  echo "[kenLM] fallback: copy addons sample corpus"
  cp -f "$REPO_ROOT/addons/char-lm/data/zh_sentences.txt" "$CORPUS_RAW"
fi

echo "[kenLM] build char corpus..."
"$PYTHON" "$REPO_ROOT/scripts/kenlm/build_char_corpus.py" \
  --input "$CORPUS_RAW" \
  --output "$CORPUS_CHAR"

# --- KenLM 编译 ---
if [ ! -x "$KENLM_BUILD/bin/lmplz" ] && [ ! -x "$KENLM_BUILD/bin/Release/lmplz.exe" ]; then
  echo "[kenLM] clone & build KenLM (first time, may take several minutes)..."
  if [ ! -d "$KENLM_SRC/.git" ]; then
    git clone --depth 1 https://github.com/kpu/kenlm.git "$KENLM_SRC"
  fi
  mkdir -p "$KENLM_BUILD"
  cd "$KENLM_BUILD"
  cmake ..
  cmake --build . -j"$(nproc 2>/dev/null || echo 4)"
  cd "$KENLM_ROOT"
fi

if [ -x "$KENLM_BUILD/bin/lmplz" ]; then
  export KENLM_BIN="$KENLM_BUILD/bin"
elif [ -x "$KENLM_BUILD/bin/Release/lmplz.exe" ]; then
  export KENLM_BIN="$KENLM_BUILD/bin/Release"
else
  echo "Error: lmplz not found under $KENLM_BUILD" >&2
  exit 1
fi

LMPLZ="$KENLM_BIN/lmplz"
BUILD_BINARY="$KENLM_BIN/build_binary"
TRIE_TMP="/tmp/zh_char_3gram.trie.bin.$$"

echo "[kenLM] lmplz -o 3 ..."
"$LMPLZ" -o 3 -S 50% -T /tmp --text "$CORPUS_CHAR" --arpa "$ARPA"

echo "[kenLM] build_binary trie ..."
"$BUILD_BINARY" trie "$ARPA" "$TRIE_TMP"
mv -f "$TRIE_TMP" "$TRIE_BIN"

echo ""
echo "Done."
echo "  ARPA:  $ARPA"
echo "  Trie:  $TRIE_BIN"
echo "  Query: $KENLM_BIN/query"
ls -lh "$ARPA" "$TRIE_BIN"
