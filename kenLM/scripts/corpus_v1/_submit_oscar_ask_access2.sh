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

legal_2301 = "I have explicitly check with my jurisdiction and I confirm that downloading OSCAR 2301 is legal in the country/region where I am located right now, and for the use case that I have described above"
legal_2201 = "I have explicitly check with my jurisdiction and I confirm that downloading OSCAR 2201 is legal in the country/region where I am located right now, and for the use case that I have described above"

def post(url, data):
    body=json.dumps(data).encode()
    req=urllib.request.Request(
        url, data=body, method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "lingua-corpus-v1",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            print("OK", url, r.status, r.read()[:500]); return True
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, url, e.read()[:1000]); return False

base={
    "Name": me.get("fullname") or me.get("name"),
    "Email": me.get("email") or f"{me.get('name')}@users.noreply.huggingface.co",
    "Affiliation": "Lingua ASR post-processing R&D",
    "Country": "China",
    "Usecase": "Train Chinese character-level KenLM for ASR sentence reranking; randomly sample ~1M cleaned sentences from OSCAR Chinese Deduplicated; no redistribution of raw dump.",
}

for repo, legal in (
    ("oscar-corpus/OSCAR-2301", legal_2301),
    ("oscar-corpus/OSCAR-2201", legal_2201),
):
    payload=dict(base)
    payload[legal] = "true"
    # also try boolean True variants
    for val in ("true", True, "on", "yes", "I agree"):
        payload[legal] = val
        print("try", repo, "legal_val", val)
        if post(f"https://huggingface.co/datasets/{repo}/ask-access", payload):
            break

# download probe
req=urllib.request.Request(
    "https://huggingface.co/datasets/oscar-corpus/OSCAR-2301/resolve/main/zh_meta/zh_meta_part_1.jsonl.zst",
    headers={"Authorization": f"Bearer {token}"},
)
try:
    with urllib.request.urlopen(req, timeout=60) as r:
        print("DOWNLOAD OK", r.status)
except urllib.error.HTTPError as e:
    print("DOWNLOAD", e.code, e.read()[:250])
PY
