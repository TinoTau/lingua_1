#!/usr/bin/env bash
set -euo pipefail
PY=/mnt/d/Programs/github/lingua_1/kenLM/.venv/bin/python
TOKEN="$(tr -d '\r\n' < /tmp/hf_token_corpus_v1.txt)"
export HF_TOKEN="$TOKEN"
"$PY" - <<'PY'
import os, json, urllib.request, urllib.error
from huggingface_hub import whoami
token=os.environ["HF_TOKEN"]
me=whoami(token=token)
print("user", me)

payload={
    "Name": me.get("fullname") or me.get("name") or "Zhiqi Tao",
    "Email": (me.get("email") or f"{me.get('name')}@users.noreply.huggingface.co"),
    "Affiliation": "Lingua ASR post-processing R&D",
    "Country": "China",
    "Usecase": (
        "Train a Chinese character-level 3-gram KenLM for offline ASR sentence reranking research. "
        "We will randomly sample about 1 million cleaned Chinese sentences from OSCAR Chinese Deduplicated "
        "and will not redistribute the raw OSCAR dump."
    ),
    # common alternates
    "name": me.get("fullname") or me.get("name"),
    "email": me.get("email") or f"{me.get('name')}@users.noreply.huggingface.co",
    "affiliation": "Lingua ASR post-processing R&D",
    "country": "China",
    "usecase": (
        "Train Chinese KenLM for ASR repair; sample ~1M sentences from OSCAR zh deduplicated; no redistribution."
    ),
}

def post(url, data):
    body=json.dumps(data).encode()
    req=urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "lingua-corpus-v1",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            print("OK", url, r.status, r.read()[:500])
            return True
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, url, e.read()[:800])
        return False

# Try both dataset pages
for repo in ("oscar-corpus/OSCAR-2301", "oscar-corpus/OSCAR-2201", "oscar"):
    post(f"https://huggingface.co/datasets/{repo}/ask-access", payload)

# Probe download again
req=urllib.request.Request(
    "https://huggingface.co/datasets/oscar-corpus/OSCAR-2301/resolve/main/zh_meta/zh_meta_part_1.jsonl.zst",
    headers={"Authorization": f"Bearer {token}", "User-Agent": "lingua-corpus-v1"},
)
try:
    with urllib.request.urlopen(req, timeout=60) as r:
        print("DOWNLOAD OK status", r.status, "len", r.headers.get("Content-Length"))
except urllib.error.HTTPError as e:
    print("DOWNLOAD still", e.code, e.read()[:300])
PY
