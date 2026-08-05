#!/usr/bin/env bash
# KenLM Phase 03 — First retrain into isolated model dir (do NOT overwrite production until decision).
set -euo pipefail

KENLM_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$KENLM_ROOT/.." && pwd)"

CORPUS_RAW="$KENLM_ROOT/corpus/zh_sentences.raw.txt"
CORPUS_CHAR="$KENLM_ROOT/corpus/corpus.char.txt"
OUT_DIR="${OUT_DIR:-$KENLM_ROOT/model/phase03_first_train}"
ARPA="$OUT_DIR/zh_char_3gram.arpa"
TRIE_BIN="$OUT_DIR/zh_char_3gram.trie.bin"
META="$OUT_DIR/training_meta.json"
KENLM_BIN="$KENLM_ROOT/kenlm/build/bin"
LMPLZ="$KENLM_BIN/lmplz"
BUILD_BINARY="$KENLM_BIN/build_binary"
LOG="$OUT_DIR/train.log"

mkdir -p "$OUT_DIR"

if [ ! -s "$CORPUS_RAW" ]; then
  echo "Error: missing corpus $CORPUS_RAW" >&2
  exit 1
fi
if [ ! -x "$LMPLZ" ] || [ ! -x "$BUILD_BINARY" ]; then
  echo "Error: lmplz/build_binary not executable under $KENLM_BIN" >&2
  exit 1
fi

PYTHON="${PYTHON:-python3}"
{
  echo "[phase03] rebuild char corpus from full raw (no filtering)..."
  "$PYTHON" "$REPO_ROOT/scripts/kenlm/build_char_corpus.py" \
    --input "$CORPUS_RAW" \
    --output "$CORPUS_CHAR"

  LINES=$(wc -l < "$CORPUS_CHAR" | tr -d ' ')
  TOKENS=$(awk '{n+=NF} END{print n+0}' "$CORPUS_CHAR")
  echo "[phase03] corpus lines=$LINES tokens=$TOKENS"

  BUILD_CMD="$LMPLZ -o 3 -S 50% -T /tmp --text $CORPUS_CHAR --arpa $ARPA"
  echo "[phase03] $BUILD_CMD"
  "$LMPLZ" -o 3 -S 50% -T /tmp --text "$CORPUS_CHAR" --arpa "$ARPA"

  TRIE_TMP="/tmp/zh_char_3gram_phase03.trie.bin.$$"
  echo "[phase03] build_binary trie ..."
  "$BUILD_BINARY" trie "$ARPA" "$TRIE_TMP"
  mv -f "$TRIE_TMP" "$TRIE_BIN"

  echo "[phase03] DONE"
  ls -lh "$ARPA" "$TRIE_BIN"
} 2>&1 | tee "$LOG"

# Collect meta after train
"$PYTHON" - "$OUT_DIR" "$CORPUS_RAW" "$CORPUS_CHAR" "$ARPA" "$TRIE_BIN" "$LMPLZ" "$BUILD_BINARY" <<'PY'
import hashlib, json, pathlib, sys

out_dir, corpus_raw, corpus_char, arpa, trie, lmplz, build_binary = sys.argv[1:]

def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

lines = 0
tokens = 0
with open(corpus_char, "r", encoding="utf-8") as f:
    for line in f:
        lines += 1
        tokens += len(line.split())

ngrams = []
vocab = 0
in_data = False
in_1g = False
with open(arpa, "r", encoding="utf-8", errors="replace") as f:
    for line in f:
        if line.startswith("\\data\\"):
            in_data = True
            continue
        if in_data and line.startswith("ngram "):
            # ngram 1=12345
            try:
                ngrams.append(int(line.strip().split("=")[1]))
            except Exception:
                pass
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
    "outDir": out_dir,
    "corpusRaw": corpus_raw,
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
    "pruning": "none (lmplz default, no --prune)",
    "discount": "Modified Kneser-Ney (lmplz default)",
    "memoryFlag": "-S 50%",
    "buildCommand": f"{lmplz} -o 3 -S 50% -T /tmp --text {corpus_char} --arpa {arpa} && {build_binary} trie {arpa} {trie}",
}
path = pathlib.Path(out_dir) / "training_meta.json"
path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
print(json.dumps(meta, indent=2))
PY
