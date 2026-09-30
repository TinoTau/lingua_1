#!/usr/bin/env bash
# Once OSCAR access is approved, randomly sample ~1M sentences from zh_meta parts.
set -euo pipefail
ROOT=/mnt/d/Programs/github/lingua_1
PY="$ROOT/kenLM/.venv/bin/python"
RAW="$ROOT/kenLM/corpus/v1_raw"
TOKEN="$(tr -d '\r\n' < /tmp/hf_token_corpus_v1.txt)"
export HF_TOKEN="$TOKEN"
export HUGGING_FACE_HUB_TOKEN="$TOKEN"
mkdir -p "$RAW/oscar_parts"
cd "$ROOT"

"$PY" - <<'PY'
import os, json, random, time, urllib.request, urllib.error
from pathlib import Path
import sys
sys.path.insert(0, "/mnt/d/Programs/github/lingua_1/kenLM/scripts/corpus_v1")
from clean_zh import split_sentences, sha1_line

token=os.environ["HF_TOKEN"]
raw=Path("/mnt/d/Programs/github/lingua_1/kenLM/corpus/v1_raw")
parts_dir=raw/"oscar_parts"
out=raw/"oscar_sentences.txt"
target=1_000_000
seed=20260804
rng=random.Random(seed)

# list zh parts
req=urllib.request.Request(
    "https://huggingface.co/api/datasets/oscar-corpus/OSCAR-2301",
    headers={"Authorization": f"Bearer {token}"},
)
with urllib.request.urlopen(req, timeout=90) as r:
    meta=json.loads(r.read().decode())
zh=[s["rfilename"] for s in meta.get("siblings") or [] if s["rfilename"].startswith("zh_meta/zh_meta_part_") and s["rfilename"].endswith(".jsonl.zst")]
zh=sorted(zh, key=lambda x: int(x.split("_part_")[1].split(".")[0]))
print("zh_parts", len(zh))
rng.shuffle(zh)

# probe access
probe=zh[0]
preq=urllib.request.Request(
    f"https://huggingface.co/datasets/oscar-corpus/OSCAR-2301/resolve/main/{probe}",
    headers={"Authorization": f"Bearer {token}"},
)
try:
    with urllib.request.urlopen(preq, timeout=60) as r:
        print("access OK", probe, r.status)
except urllib.error.HTTPError as e:
    body=e.read()[:300]
    print("ACCESS_PENDING_OR_DENIED", e.code, body)
    raise SystemExit(3)

# stream-sample across random parts until target
try:
    import zstandard as zstd
except ImportError:
    raise SystemExit("pip install zstandard")

seen=set(); kept=0; docs=0
with out.open("w", encoding="utf-8", newline="\n") as fout:
    for fname in zh:
        if kept >= target:
            break
        url=f"https://huggingface.co/datasets/oscar-corpus/OSCAR-2301/resolve/main/{fname}"
        local=parts_dir/Path(fname).name
        print(f"[oscar] fetch {fname}")
        req=urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req, timeout=600) as resp, open(local, "wb") as f:
            while True:
                chunk=resp.read(1024*1024)
                if not chunk: break
                f.write(chunk)
        dctx=zstd.ZstdDecompressor()
        with open(local, "rb") as f:
            with dctx.stream_reader(f) as reader:
                import io
                text_stream=io.TextIOWrapper(reader, encoding="utf-8", errors="replace")
                for line in text_stream:
                    if kept >= target: break
                    line=line.strip()
                    if not line: continue
                    try:
                        obj=json.loads(line)
                    except Exception:
                        continue
                    content=obj.get("content") or obj.get("text") or ""
                    docs += 1
                    for s in split_sentences(content):
                        h=sha1_line(s)
                        if h in seen: continue
                        # random accept for diversity inside huge docs
                        if kept > target*0.85 and rng.random() > 0.4:
                            continue
                        seen.add(h)
                        fout.write(s+"\n")
                        kept += 1
                        if kept >= target: break
                    if docs % 5000 == 0:
                        print(f"[oscar] docs={docs} kept={kept}")
        # delete part to save disk after consuming
        try: local.unlink()
        except Exception: pass
        print(f"[oscar] after {fname}: kept={kept}")

stats={"sentences_kept": kept, "docs_seen": docs, "source": "oscar-corpus/OSCAR-2301 zh_meta", "unique": len(seen)}
(raw/"oscar_sentences.stats.json").write_text(json.dumps(stats, indent=2)+"\n", encoding="utf-8")
print(stats)
if kept <= 0:
    raise SystemExit(2)
PY
