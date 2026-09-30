#!/usr/bin/env bash
set -euo pipefail
PY=/mnt/d/Programs/github/lingua_1/kenLM/.venv/bin/python
TOKEN="$(tr -d '\r\n' < /tmp/hf_token_corpus_v1.txt)"
export HF_TOKEN="$TOKEN"
"$PY" - <<'PY'
import os, json, urllib.request, urllib.error
token=os.environ["HF_TOKEN"]

def req(url, method="GET", data=None, headers=None):
    h={"Authorization": f"Bearer {token}", "User-Agent": "lingua-corpus-v1"}
    if headers: h.update(headers)
    body=None
    if data is not None:
        body=json.dumps(data).encode()
        h["Content-Type"]="application/json"
    r=urllib.request.Request(url, data=body, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=90) as resp:
            raw=resp.read()
            print(method, url, resp.status, raw[:400])
            return resp.status, raw
    except urllib.error.HTTPError as e:
        print(method, url, "HTTP", e.code, e.read()[:400])
        return e.code, b""
    except Exception as e:
        print(method, url, type(e).__name__, e)
        return None, b""

# Attempt various agree/access endpoints
for method,url,data in [
    ("POST", "https://huggingface.co/api/datasets/oscar-corpus/OSCAR-2301/user-access-request", {"reason":"Training Chinese character-level KenLM for ASR post-correction research. Non-commercial academic/product R&D."}),
    ("PUT", "https://huggingface.co/api/datasets/oscar-corpus/OSCAR-2301/user-access-request", {"status":"pending"}),
    ("POST", "https://huggingface.co/datasets/oscar-corpus/OSCAR-2301/ask-access", {"reason":"KenLM Chinese corpus training for ASR repair benchmark."}),
    ("POST", "https://huggingface.co/api/datasets/oscar/user-access-request", {"reason":"Chinese KenLM training"}),
]:
    req(url, method=method, data=data)

# List zh files
status, raw = req("https://huggingface.co/api/datasets/oscar-corpus/OSCAR-2301")
if raw:
    data=json.loads(raw.decode())
    zh=[s["rfilename"] for s in data.get("siblings") or [] if s.get("rfilename","").startswith("zh")]
    print("zh_files", len(zh))
    for f in zh[:30]:
        print(" ", f)
    open("/tmp/oscar2301_zh_files.txt","w").write("\n".join(zh)+"\n")

# Try resolve one small/non-zh file vs zh file
for f in ["README.md"] + (zh[:1] if raw else []):
    url=f"https://huggingface.co/datasets/oscar-corpus/OSCAR-2301/resolve/main/{f}"
    req(url)
PY
