#!/usr/bin/env bash
set -euo pipefail
PY=/mnt/d/Programs/github/lingua_1/kenLM/.venv/bin/python
TOKEN="$(tr -d '\r\n' < /tmp/hf_token_corpus_v1.txt)"
export HF_TOKEN="$TOKEN"
"$PY" - <<'PY'
import os, json, urllib.request
from huggingface_hub import HfApi, hf_api
token=os.environ["HF_TOKEN"]
api=HfApi(token=token)
repo="oscar-corpus/OSCAR-2301"
# Try request access helpers across hub versions
methods=[m for m in dir(api) if "access" in m.lower() or "gate" in m.lower()]
print("access-related methods:", methods)
for mname in ("request_access", "accept_access_request", "create_access_request"):
    fn=getattr(api, mname, None)
    if not fn:
        continue
    try:
        print("calling", mname)
        print(fn(repo_id=repo, repo_type="dataset"))
    except TypeError as e:
        try:
            print(fn(repo))
        except Exception as e2:
            print(mname, "failed", e, e2)
    except Exception as e:
        print(mname, "error", e)

# Direct HTTP ask-for-access / user-access
for url in (
    f"https://huggingface.co/datasets/{repo}/ask-access",
    f"https://huggingface.co/api/datasets/{repo}/user-access-request",
    f"https://huggingface.co/api/datasets/{repo}/user-access-request/pending",
):
    req=urllib.request.Request(url, method="POST", headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }, data=b"{}")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            print(url, r.status, r.read()[:300])
    except Exception as e:
        print(url, "->", e)

# Check current user permission
req=urllib.request.Request(
    f"https://huggingface.co/api/datasets/{repo}",
    headers={"Authorization": f"Bearer {token}"},
)
with urllib.request.urlopen(req, timeout=60) as r:
    data=json.loads(r.read().decode())
    print("gated", data.get("gated"), "siblings_sample", [s.get("rfilename") for s in (data.get("siblings") or [])[:5]])
PY

echo "=== gitee zh_meta listing probe ==="
curl -fsSL --max-time 40 "https://gitee.com/hf-datasets/OSCAR-2301/tree/main/zh_meta" 2>/dev/null | head -c 2000 || echo gitee_fail
curl -I -L --max-time 30 "https://gitee.com/hf-datasets/OSCAR-2301/repository/archive/main.zip" 2>&1 | head -20 || true
