#!/usr/bin/env bash
# KenLM Corpus Rebuild V1 — archive old corpus, train from corpus_v1.char.txt
set -euo pipefail
KENLM_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPO_ROOT="$(cd "$KENLM_ROOT/.." && pwd)"
PY="${PY:-$KENLM_ROOT/.venv/bin/python}"
LMPLZ="$KENLM_ROOT/kenlm/build/bin/lmplz"
BUILD_BINARY="$KENLM_ROOT/kenlm/build/bin/build_binary"

CORPUS_DIR="$KENLM_ROOT/corpus"
ARCHIVE="$CORPUS_DIR/archive_legacy_news_v0"
V1_CHAR="$CORPUS_DIR/v1/corpus_v1.char.txt"
OUT_DIR="$KENLM_ROOT/model/corpus_v1"
ARPA="$OUT_DIR/zh_char_3gram.arpa"
TRIE="$OUT_DIR/zh_char_3gram.trie.bin"
META="$OUT_DIR/training_meta.json"
LOG="$OUT_DIR/train.log"

mkdir -p "$ARCHIVE" "$OUT_DIR" "$CORPUS_DIR/v1" "$CORPUS_DIR/v1_raw"

# Archive legacy corpus (do not use for training)
for f in zh_sentences.raw.txt corpus.char.txt; do
  if [ -f "$CORPUS_DIR/$f" ] && [ ! -f "$ARCHIVE/$f" ]; then
    echo "[archive] $f -> $ARCHIVE/"
    mv -f "$CORPUS_DIR/$f" "$ARCHIVE/$f"
  elif [ -f "$CORPUS_DIR/$f" ] && [ -f "$ARCHIVE/$f" ]; then
    echo "[archive] already archived; removing active $f"
    rm -f "$CORPUS_DIR/$f"
  fi
done
# Pointer so old paths don't silently reappear as active training input
cat > "$CORPUS_DIR/LEGACY_ARCHIVED.txt" <<EOF
Legacy news corpus archived to archive_legacy_news_v0/ on $(date -Iseconds).
Active Corpus V1 lives under corpus/v1/.
EOF

if [ ! -s "$V1_CHAR" ]; then
  echo "Missing $V1_CHAR" >&2
  exit 1
fi

{
  echo "[train] lmplz -o 3 from $V1_CHAR"
  # --discount_fallback: large Chinese char corpora can trip BadDiscountException;
  # still Modified Kneser-Ney with KenLM's documented fallback discounts.
  "$LMPLZ" -o 3 -S 50% -T /tmp --discount_fallback --text "$V1_CHAR" --arpa "$ARPA"
  TMP="/tmp/zh_char_3gram_v1.trie.bin.$$"
  "$BUILD_BINARY" trie "$ARPA" "$TMP"
  mv -f "$TMP" "$TRIE"
  ls -lh "$ARPA" "$TRIE"
} 2>&1 | tee "$LOG"

"$PY" - "$OUT_DIR" "$V1_CHAR" "$ARPA" "$TRIE" "$LMPLZ" "$BUILD_BINARY" <<'PY'
import hashlib, json, pathlib, sys
out_dir, corpus_char, arpa, trie, lmplz, build_binary = sys.argv[1:]

def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

lines = tokens = 0
with open(corpus_char, "r", encoding="utf-8") as f:
    for line in f:
        lines += 1
        tokens += len(line.split())

ngrams = []
vocab = 0
in_data = in_1g = False
with open(arpa, "r", encoding="utf-8", errors="replace") as f:
    for line in f:
        if line.startswith("\\data\\"):
            in_data = True
            continue
        if in_data and line.startswith("ngram "):
            ngrams.append(int(line.strip().split("=")[1]))
            continue
        if line.startswith("\\1-grams:"):
            in_data = False
            in_1g = True
            continue
        if in_1g and line.startswith("\\2-grams:"):
            break
        if in_1g and line.strip() and not line.startswith("\\"):
            vocab += 1

meta = {
    "corpusChar": corpus_char,
    "corpusLines": lines,
    "tokenCount": tokens,
    "vocabularySize": vocab,
    "ngramCountsByOrder": ngrams,
    "ngramCountSum": sum(ngrams),
    "arpaPath": arpa,
    "arpaSizeBytes": pathlib.Path(arpa).stat().st_size,
    "arpaSha256": sha256(arpa),
    "binaryPath": trie,
    "binarySizeBytes": pathlib.Path(trie).stat().st_size,
    "binarySha256": sha256(trie),
    "ngramOrder": 3,
    "pruning": "none",
    "discount": "Modified Kneser-Ney (lmplz default)",
    "buildCommand": f"{lmplz} -o 3 -S 50% -T /tmp --text {corpus_char} --arpa {arpa} && {build_binary} trie {arpa} {trie}",
}
pathlib.Path(out_dir, "training_meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
print(json.dumps(meta, indent=2))
PY

echo "[train] DONE"
