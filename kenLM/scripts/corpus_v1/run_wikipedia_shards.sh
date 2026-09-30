#!/usr/bin/env bash
# Download + extract all zhwiki-latest-pages-articlesN shards (latest dump partitions).
set -euo pipefail
ROOT=/mnt/d/Programs/github/lingua_1
RAW="$ROOT/kenLM/corpus/v1_raw"
PY="$ROOT/kenLM/.venv/bin/python"
BASE="https://dumps.wikimedia.org/zhwiki/latest"
mkdir -p "$RAW"
export PYTHONUNBUFFERED=1

# Discover shard names from index HTML
INDEX="$RAW/zhwiki_latest_index.html"
curl -fsSL "$BASE/" -o "$INDEX"
mapfile -t SHARDS < <(grep -oE 'zhwiki-latest-pages-articles[0-9]+\.xml-p[0-9]+p[0-9]+\.bz2' "$INDEX" | sort -u)
if [ "${#SHARDS[@]}" -eq 0 ]; then
  echo "No shards found; falling back to full dump"
  SHARDS=("zhwiki-latest-pages-articles.xml.bz2")
fi
echo "[wiki] shards=${#SHARDS[@]}"
printf '%s\n' "${SHARDS[@]}" | tee "$RAW/wiki_shards.list"

: > "$RAW/wikipedia_sentences.txt"
for shard in "${SHARDS[@]}"; do
  dest="$RAW/$shard"
  echo "[wiki] fetch $shard"
  curl -L --retry 5 --retry-delay 5 -C - -o "$dest" "$BASE/$shard"
  echo "[wiki] extract $shard"
  "$PY" -u "$ROOT/kenLM/scripts/corpus_v1/build_wikipedia_sentences.py" \
    --skip-download \
    --dump "$dest" \
    --out "$RAW/_wiki_part_${shard}.txt"
  cat "$RAW/_wiki_part_${shard}.txt" >> "$RAW/wikipedia_sentences.txt"
  rm -f "$RAW/_wiki_part_${shard}.txt"
  # keep dump shards for reproducibility (large); optional delete:
  # rm -f "$dest"
done

# Dedup sentences after concat
"$PY" - <<'PY'
from pathlib import Path
import sys
sys.path.insert(0, "/mnt/d/Programs/github/lingua_1/kenLM/scripts/corpus_v1")
from clean_zh import sha1_line, clean_sentence
src = Path("/mnt/d/Programs/github/lingua_1/kenLM/corpus/v1_raw/wikipedia_sentences.txt")
tmp = src.with_suffix(".dedup.txt")
seen=set(); n=0; kept=0
with src.open("r", encoding="utf-8", errors="replace") as f, tmp.open("w", encoding="utf-8", newline="\n") as out:
    for line in f:
        n+=1
        s=clean_sentence(line)
        if not s: continue
        h=sha1_line(s)
        if h in seen: continue
        seen.add(h); out.write(s+"\n"); kept+=1
tmp.replace(src)
print({"scanned":n,"kept":kept})
PY

wc -l "$RAW/wikipedia_sentences.txt" | tee "$RAW/wikipedia_linecount.txt"
echo "[wiki] DONE"
