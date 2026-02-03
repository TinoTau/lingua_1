#!/usr/bin/env bash
# 中文大语料：生成语料 -> 字符级 tokenize -> lmplz -> build_binary trie -> 复制到 semantic_repair_en_zh/models
# 在 WSL/Linux/macOS 下执行；需先安装 KenLM 并设置 KENLM_BIN

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
DATA_DIR="$BASE_DIR/data"
# 合并服务模型目录（相对于 addons/char-lm）
TARGET_DIR="$BASE_DIR/../../electron_node/services/semantic_repair_en_zh/models"
KENLM_BIN="${KENLM_BIN:-$BASE_DIR/kenlm/build/bin}"

mkdir -p "$DATA_DIR"
mkdir -p "$TARGET_DIR"

# 1) 语料：若不存在则先抓取新闻（仅新闻，不补模板）
if [ ! -f "$DATA_DIR/zh_sentences_large.txt" ]; then
  python3 "$SCRIPT_DIR/fetch_news_corpus.py"
fi

# 2) 字符级 tokenize
python3 "$SCRIPT_DIR/tokenize.py" zh_sentences_large.txt zh_char_tokenized_large.txt

# 3) lmplz（--prune 0 0 1 保留更多 n-gram，模型更大；欲几十 MB 需用真实/大规模语料 + --prune 0 0 0）
#    可选：PRUNE_ZH="0 0 0" 或 LMPLZ_ORDER=4 以进一步增大
TOKENIZED="$DATA_DIR/zh_char_tokenized_large.txt"
ARPA_TMP="/tmp/zh_char_3gram_large.arpa.$$"
TRIE_TMP="/tmp/zh_char_3gram_large.trie.bin.$$"
PRUNE_ZH="${PRUNE_ZH:-0 0 1}"
LMPLZ_ORDER_ZH="${LMPLZ_ORDER_ZH:-3}"

if [ -n "$KENLM_BIN" ] && [ -d "$KENLM_BIN" ]; then
  LMPLZ="$KENLM_BIN/lmplz"
  BUILD_BINARY="$KENLM_BIN/build_binary"
else
  LMPLZ="lmplz"
  BUILD_BINARY="build_binary"
fi

echo "Training Chinese char ${LMPLZ_ORDER_ZH}-gram (prune $PRUNE_ZH, this may take several minutes)..."
cat "$TOKENIZED" | $LMPLZ -o "$LMPLZ_ORDER_ZH" -S 50% -T /tmp --prune $PRUNE_ZH --discount_fallback > "$ARPA_TMP"

# 4) build_binary trie（先写 /tmp 再 mv，避免 WSL 挂载路径问题）
$BUILD_BINARY trie "$ARPA_TMP" "$TRIE_TMP"
mv "$TRIE_TMP" "$TARGET_DIR/zh_char_3gram.trie.bin"
rm -f "$ARPA_TMP"

echo "Done. Chinese model -> $TARGET_DIR/zh_char_3gram.trie.bin"
ls -la "$TARGET_DIR/zh_char_3gram.trie.bin"
